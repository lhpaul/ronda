import { Worker, type WorkerOptions } from "node:worker_threads";
import type { RepositoryContextResolution } from "./repository-context.js";
import type {
  FindCandidatesResult,
  InternalRequestedReference,
  ResolveSymbolsBookkeeping,
} from "./symbol-resolver.js";

/**
 * Terminable repository-context compiler work (#131). The two compiler steps
 * of read-only repository context — finding candidates and resolving them —
 * run in a per-pass `node:worker_threads` worker that the review pass
 * terminates the moment a stop signal fires (the context time budget, the
 * pass deadline, or a webhook watchdog abort), instead of judging the
 * compile's result only after it finishes.
 *
 * Reads never happen here: only file text the pass has already read through
 * its own read seam crosses into the worker. The worker gets an empty
 * environment and its output streams are discarded, so no credential reaches
 * it and no loader or runtime message (which can carry a local path) reaches
 * the logs.
 *
 * Every request settles exactly once with one {@link CompileOutcome},
 * decided by {@link decideCompileOutcome}; the session's public methods
 * never throw or reject.
 */

/** Which compile a request runs. */
export type CompilerPhase = "finding_candidates" | "resolving_candidates";

/** What stopped a compile, in precedence order (D5). */
export type CompilerStopReason = "watchdog_abort" | "pass_deadline" | "context_time_budget";

/** How the isolated execution context failed. */
export type CompilerIsolationFailure = "could_not_start" | "stopped_unexpectedly";

/** One reason the pass may stop a compile, and the signal that says it applies. */
export interface CompileStopBound {
  reason: CompilerStopReason;
  signal: AbortSignal;
}

export type CompileOutcome<T> =
  | { kind: "result"; value: T }
  | { kind: "stopped"; reason: CompilerStopReason }
  | { kind: "isolation_failed"; failure: CompilerIsolationFailure };

export interface FindCandidatesInput {
  changedSourceTexts: Map<string, string>;
  changedLinesByFile: Map<string, Set<number>>;
}

export interface ResolveCandidatesInput {
  fileSet: Map<string, string>;
  requested: InternalRequestedReference[];
  /** Only the three bookkeeping sets of `BuildSourceFileSetResult`, never the whole object. */
  bookkeeping: ResolveSymbolsBookkeeping;
}

export interface RepositoryContextCompilerSession {
  findCandidates(
    input: FindCandidatesInput,
    stops: readonly CompileStopBound[],
  ): Promise<CompileOutcome<FindCandidatesResult>>;
  resolveCandidates(
    input: ResolveCandidatesInput,
    stops: readonly CompileStopBound[],
  ): Promise<CompileOutcome<RepositoryContextResolution[]>>;
  /** Ends the session and its worker, if any. Idempotent; never throws. */
  close(): void;
}

export type RepositoryContextCompilerFactory = () => RepositoryContextCompilerSession;

/** Main thread to worker. */
export interface CompilerRequestMessage {
  type: "find" | "resolve";
  seq: number;
  input: FindCandidatesInput | ResolveCandidatesInput;
}

/**
 * D3: the contract for how promptly a stop takes effect, measured from the
 * stop signal. The session never waits for termination — it settles the
 * request inside the stop handler and calls `terminate()` without awaiting —
 * so both "outcome settled" and "worker exited" land well inside this.
 */
export const REPOSITORY_CONTEXT_COMPILE_STOP_GRACE_MS = 250;

/** The production worker entry, loaded by the bootstrap under `tsx` (D2). */
export const REPOSITORY_CONTEXT_COMPILER_ENTRY_URL = new URL(
  "./repository-context-compiler-worker.ts",
  import.meta.url,
).href;

const BOOTSTRAP_URL = new URL("./repository-context-compiler-bootstrap.mjs", import.meta.url);

/**
 * D12: the error the repository-context phase throws into its own existing
 * failure path for an isolation failure. Its message is fixed text naming
 * only the failure kind — never the worker's own error text, exit code, or
 * output, which can carry local paths.
 */
export class RepositoryContextIsolationError extends Error {
  constructor(readonly failure: CompilerIsolationFailure) {
    super(
      failure === "could_not_start"
        ? "Repository-context compiler could not start"
        : "Repository-context compiler stopped unexpectedly",
    );
    this.name = "RepositoryContextIsolationError";
  }
}

type CompileEvent<T> =
  | { kind: "stop" }
  | { kind: "failure"; failure: CompilerIsolationFailure }
  | { kind: "message"; value: unknown; isValid: (value: unknown) => value is T };

/**
 * D5: the single stop-precedence rule. The first aborted stop in `stops`
 * order wins (callers list `watchdog_abort`, then `pass_deadline`, then the
 * context deadline); then an isolation failure; then a result that passes
 * validation. A result that fails validation is the isolated execution
 * context stopping unexpectedly. Every event the session receives goes
 * through here, so the order holds whichever event is dispatched first, and
 * a result arriving after its stop already fired is never used.
 */
export function decideCompileOutcome<T>(
  stops: readonly CompileStopBound[],
  event: CompileEvent<T>,
): CompileOutcome<T> {
  const winningStop = stops.find((stop) => stop.signal.aborted);
  if (winningStop) {
    return { kind: "stopped", reason: winningStop.reason };
  }
  if (event.kind === "failure") {
    return { kind: "isolation_failed", failure: event.failure };
  }
  if (event.kind === "message" && event.isValid(event.value)) {
    return { kind: "result", value: event.value };
  }
  return { kind: "isolation_failed", failure: "stopped_unexpectedly" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Exported for tests: is `value` a complete, well-formed answer to a `find` request for `input`? */
export function isFindCandidatesResult(
  value: unknown,
  input: FindCandidatesInput,
): value is FindCandidatesResult {
  if (!isRecord(value) || !Array.isArray(value.requested)) {
    return false;
  }
  if (!isNonNegativeInteger(value.nonRepositoryReferencesSkipped)) {
    return false;
  }
  const ids = new Set<number>();
  for (const entry of value.requested as unknown[]) {
    if (!isRecord(entry)) {
      return false;
    }
    if (!isNonNegativeInteger(entry.id) || ids.has(entry.id)) {
      return false;
    }
    ids.add(entry.id);
    if (entry.kind !== "definition" || typeof entry.symbolName !== "string") {
      return false;
    }
    if (typeof entry.changedPath !== "string" || !input.changedSourceTexts.has(entry.changedPath)) {
      return false;
    }
    if (!isPositiveInteger(entry.changedLine) || !isNonNegativeInteger(entry.anchorPos)) {
      return false;
    }
    if (entry.specifierKey !== undefined && typeof entry.specifierKey !== "string") {
      return false;
    }
  }
  return true;
}

const RESOLUTION_DROP_REASONS: ReadonlySet<unknown> = new Set(["time_budget", "read_failed", "ambiguous_resolution"]);

/** Exported for tests: is `value` exactly one well-formed resolution per requested reference of `input`? */
export function isResolutionList(
  value: unknown,
  input: ResolveCandidatesInput,
): value is RepositoryContextResolution[] {
  if (!Array.isArray(value) || value.length !== input.requested.length) {
    return false;
  }
  const expectedIds = new Set(input.requested.map((ref) => ref.id));
  const seenIds = new Set<number>();
  for (const entry of value as unknown[]) {
    if (!isRecord(entry) || typeof entry.id !== "number" || !expectedIds.has(entry.id) || seenIds.has(entry.id)) {
      return false;
    }
    seenIds.add(entry.id);
    if ("reason" in entry) {
      if (!RESOLUTION_DROP_REASONS.has(entry.reason)) {
        return false;
      }
      continue;
    }
    if (typeof entry.path !== "string" || !input.fileSet.has(entry.path)) {
      return false;
    }
    if (!Number.isInteger(entry.line) || !Number.isInteger(entry.endLine) || typeof entry.text !== "string") {
      return false;
    }
  }
  return true;
}

/** The parts of a `node:worker_threads` `Worker` the session uses — the `spawn` test seam returns one. */
export interface CompilerWorkerHandle {
  on(event: "message" | "messageerror" | "error" | "exit", listener: (arg: unknown) => void): unknown;
  off(event: "message" | "messageerror" | "error" | "exit", listener: (arg: unknown) => void): unknown;
  postMessage(value: unknown): void;
  terminate(): Promise<number>;
}

export type CompilerWorkerSpawn = (bootstrapUrl: URL, options: WorkerOptions) => CompilerWorkerHandle;

/**
 * The production spawn: a real worker whose output streams are drained and
 * discarded (D8), so nothing it prints reaches the process's logs.
 */
export const spawnCompilerWorker: CompilerWorkerSpawn = (bootstrapUrl, options) => {
  const worker = new Worker(bootstrapUrl, options);
  worker.stdout?.resume();
  worker.stderr?.resume();
  return worker;
};

export interface WorkerCompilerSessionOptions {
  /** The worker entry module URL. Default: {@link REPOSITORY_CONTEXT_COMPILER_ENTRY_URL}. */
  entryUrl?: string;
  /** Extra `workerData` fields for a test entry; `entryUrl` always wins. */
  workerData?: Record<string, unknown>;
  /** Test seam replacing `new Worker(...)`. Default: {@link spawnCompilerWorker}. */
  spawn?: CompilerWorkerSpawn;
}

let liveWorkerCount = 0;

/**
 * For tests only (D15): workers spawned by any session that have not yet
 * emitted `exit`. Incremented on a successful spawn, decremented once on the
 * worker's `exit`.
 */
export function activeRepositoryContextCompilerWorkerCount(): number {
  return liveWorkerCount;
}

type SessionState = "unstarted" | "starting" | "busy" | "idle" | "dead" | "closed";

interface InFlightRequest {
  seq: number;
  stops: readonly CompileStopBound[];
  isValid: (value: unknown) => boolean;
  resolve: (outcome: CompileOutcome<unknown>) => void;
  onAbort: () => void;
}

const STOPPED_UNEXPECTEDLY: CompileOutcome<never> = { kind: "isolation_failed", failure: "stopped_unexpectedly" };

/**
 * One per review pass (D1): the worker is spawned lazily on the first
 * request and reused for the pass's second compile; it is never shared with
 * another pass. Implements the plan's **Compiler session lifecycle** table.
 */
export function createWorkerCompilerSession(
  options: WorkerCompilerSessionOptions = {},
): RepositoryContextCompilerSession {
  const spawn = options.spawn ?? spawnCompilerWorker;
  const entryUrl = options.entryUrl ?? REPOSITORY_CONTEXT_COMPILER_ENTRY_URL;

  let state: SessionState = "unstarted";
  let worker: CompilerWorkerHandle | undefined;
  let workerExited = false;
  let terminateRequested = false;
  let nextSeq = 0;
  let inFlight: InFlightRequest | undefined;

  const settle = (request: InFlightRequest, outcome: CompileOutcome<unknown>): void => {
    if (inFlight !== request) {
      return; // already settled: later events for this request are ignored.
    }
    inFlight = undefined;
    for (const stop of request.stops) {
      stop.signal.removeEventListener("abort", request.onAbort);
    }
    if (outcome.kind === "result") {
      state = "idle";
    } else {
      enterClosed();
    }
    request.resolve(outcome);
  };

  // Detaches the session's `message` / `messageerror` listeners and asks the
  // worker to stop, without awaiting. The `exit` and `error` listeners stay
  // attached until the worker's own `exit`: an exception already pending in
  // the worker can still emit `error` after `terminate()`, and with no
  // listener Node would rethrow it on the main thread.
  const stopWorker = (): void => {
    if (!worker) {
      return;
    }
    worker.off("message", onMessage);
    worker.off("messageerror", onMessageError);
    if (workerExited || terminateRequested) {
      return;
    }
    terminateRequested = true;
    try {
      worker.terminate().catch(() => undefined);
    } catch {
      // A worker that cannot even be asked to stop has nothing left to stop.
    }
  };

  const enterClosed = (): void => {
    if (state === "closed") {
      return;
    }
    state = "closed";
    if (inFlight) {
      settle(inFlight, STOPPED_UNEXPECTEDLY);
    }
    stopWorker();
  };

  const becomeDead = (): void => {
    state = "dead";
    stopWorker();
  };

  // Any `error`, `exit`, or `messageerror` while the session is live. With a
  // request in flight it settles through D5; with none (idle) the worker is
  // no longer usable. After `closed` it is ignored — that is all the
  // retained `error` listener does once the request has settled.
  const onFailure = (): void => {
    if (state === "closed" || state === "dead") {
      return;
    }
    if (!inFlight) {
      becomeDead();
      return;
    }
    const failure: CompilerIsolationFailure = state === "starting" ? "could_not_start" : "stopped_unexpectedly";
    settle(inFlight, decideCompileOutcome(inFlight.stops, { kind: "failure", failure }));
  };

  const onError = (): void => onFailure();
  const onMessageError = (): void => onFailure();

  const onExit = (): void => {
    if (!workerExited) {
      workerExited = true;
      liveWorkerCount -= 1;
    }
    worker?.off("exit", onExit);
    worker?.off("error", onError);
    worker?.off("message", onMessage);
    worker?.off("messageerror", onMessageError);
    onFailure();
  };

  const onMessage = (message: unknown): void => {
    if (state === "closed" || state === "dead") {
      return;
    }
    const request = inFlight;
    if (!request) {
      becomeDead(); // a message with no request in flight: the worker is misbehaving.
      return;
    }
    if (state === "starting") {
      if (isRecord(message) && message.type === "ready") {
        state = "busy";
        return;
      }
      settle(request, decideCompileOutcome(request.stops, { kind: "failure", failure: "stopped_unexpectedly" }));
      return;
    }
    if (isRecord(message) && message.type === "result" && message.seq === request.seq) {
      settle(
        request,
        decideCompileOutcome(request.stops, {
          kind: "message",
          value: message.value,
          isValid: (value): value is unknown => request.isValid(value),
        }),
      );
      return;
    }
    // A wrong `seq` or an unknown message type is a malformed answer.
    settle(request, decideCompileOutcome(request.stops, { kind: "failure", failure: "stopped_unexpectedly" }));
  };

  const request = <T>(
    type: CompilerRequestMessage["type"],
    input: CompilerRequestMessage["input"],
    stops: readonly CompileStopBound[],
    isValid: (value: unknown) => boolean,
  ): Promise<CompileOutcome<T>> =>
    new Promise<CompileOutcome<T>>((resolvePromise) => {
      const resolve = (outcome: CompileOutcome<unknown>): void => resolvePromise(outcome as CompileOutcome<T>);

      if (state === "dead" || state === "closed") {
        enterClosed();
        resolve(STOPPED_UNEXPECTEDLY);
        return;
      }
      if (inFlight) {
        // A second request while one is in flight; the first is unaffected.
        resolve(STOPPED_UNEXPECTEDLY);
        return;
      }
      if (stops.some((stop) => stop.signal.aborted)) {
        resolve(decideCompileOutcome(stops, { kind: "stop" }));
        enterClosed();
        return;
      }

      if (state === "unstarted") {
        let spawned: CompilerWorkerHandle;
        try {
          spawned = spawn(BOOTSTRAP_URL, {
            workerData: { ...options.workerData, entryUrl },
            env: {},
            stdout: true,
            stderr: true,
          });
        } catch {
          state = "closed";
          resolve({ kind: "isolation_failed", failure: "could_not_start" });
          return;
        }
        worker = spawned;
        liveWorkerCount += 1;
        // Listeners are attached before the first message is posted.
        spawned.on("message", onMessage);
        spawned.on("messageerror", onMessageError);
        spawned.on("error", onError);
        spawned.on("exit", onExit);
        state = "starting";
      } else {
        state = "busy";
      }

      nextSeq += 1;
      const pending: InFlightRequest = {
        seq: nextSeq,
        stops,
        isValid,
        resolve,
        onAbort: () => settle(pending, decideCompileOutcome(stops, { kind: "stop" })),
      };
      inFlight = pending;
      for (const stop of stops) {
        stop.signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      try {
        // Posted immediately even while starting: Node queues it until the
        // entry listens. `ready` only marks the could-not-start boundary.
        worker?.postMessage({ type, seq: pending.seq, input } satisfies CompilerRequestMessage);
      } catch {
        settle(pending, decideCompileOutcome(stops, { kind: "failure", failure: "stopped_unexpectedly" }));
      }
    });

  return {
    findCandidates: (input, stops) =>
      request<FindCandidatesResult>("find", input, stops, (value) => isFindCandidatesResult(value, input)),
    resolveCandidates: (input, stops) =>
      request<RepositoryContextResolution[]>("resolve", input, stops, (value) => isResolutionList(value, input)),
    close: () => {
      enterClosed();
    },
  };
}
