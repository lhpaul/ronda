import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import type { Worker, WorkerOptions } from "node:worker_threads";
import {
  activeRepositoryContextCompilerWorkerCount,
  createWorkerCompilerSession,
  decideCompileOutcome,
  isFindCandidatesResult,
  isResolutionList,
  REPOSITORY_CONTEXT_COMPILE_STOP_GRACE_MS,
  RepositoryContextIsolationError,
  spawnCompilerWorker,
  type CompileOutcome,
  type CompileStopBound,
  type CompilerStopReason,
  type CompilerWorkerHandle,
  type CompilerWorkerSpawn,
  type FindCandidatesInput,
  type ResolveCandidatesInput,
} from "../../../src/review/repository-context-compiler.js";
import {
  buildSourceFileSet,
  identifyCandidates,
  resolveSymbols,
  type RepositoryContextReadFile,
} from "../../../src/review/symbol-resolver.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTROLLABLE_ENTRY_URL = pathToFileURL(
  join(HERE, "..", "..", "fixtures", "repository-context", "compiler-worker", "controllable-compiler-worker.ts"),
).href;
const MISSING_ENTRY_URL = pathToFileURL(
  join(HERE, "..", "..", "fixtures", "repository-context", "compiler-worker", "does-not-exist.ts"),
).href;
const RESOLUTION_FIXTURE_DIR = join(HERE, "..", "..", "fixtures", "repository-context", "resolution");

/** D4: a main-thread timer must fire no later than this after its due time while a compile runs. */
const AC3_TIMER_LATENESS_BOUND_MS = 200;
/** D4: the deliberately slow compile used for the responsiveness check. */
const AC3_SLOW_COMPILE_MS = 3_000;

const CALLER_TEXT = ['import { helper } from "./util.js";', "", "export function run(): number {", "  return helper(1);", "}"].join(
  "\n",
);
const UTIL_TEXT = "export function helper(x: number): number {\n  return x + 1;\n}\n";

function findInput(): FindCandidatesInput {
  return {
    changedSourceTexts: new Map([["src/caller.ts", CALLER_TEXT]]),
    changedLinesByFile: new Map([["src/caller.ts", new Set([4])]]),
  };
}

async function resolveInputFor(requested: ResolveCandidatesInput["requested"]): Promise<ResolveCandidatesInput> {
  const files = new Map([
    ["src/caller.ts", CALLER_TEXT],
    ["src/util.ts", UTIL_TEXT],
  ]);
  const readFile: RepositoryContextReadFile = async (path) => files.get(path);
  const closure = await buildSourceFileSet(new Map([["src/caller.ts", CALLER_TEXT]]), readFile, 60_000);
  return {
    fileSet: closure.fileSet,
    requested,
    bookkeeping: {
      resolvedSpecifierKeys: closure.resolvedSpecifierKeys,
      refusedSpecifierKeys: closure.refusedSpecifierKeys,
      attemptedSpecifierKeys: closure.attemptedSpecifierKeys,
    },
  };
}

const HELPER_REFERENCE = {
  id: 0,
  kind: "definition" as const,
  symbolName: "helper",
  changedPath: "src/caller.ts",
  changedLine: 4,
  anchorPos: 82,
  specifierKey: "src/caller.ts::./util.js",
};

function stopsFor(reasons: CompilerStopReason[]): { stops: CompileStopBound[]; controllers: Map<CompilerStopReason, AbortController> } {
  const controllers = new Map<CompilerStopReason, AbortController>();
  const stops = reasons.map((reason) => {
    const controller = new AbortController();
    controllers.set(reason, controller);
    return { reason, signal: controller.signal };
  });
  return { stops, controllers };
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) {
      assert.fail(`timed out after ${timeoutMs}ms waiting for: ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function waitForNoLiveWorker(): Promise<void> {
  await waitFor(() => activeRepositoryContextCompilerWorkerCount() === 0, 5_000, "no live compiler worker");
}

/** Blocks the main thread for `ms` (a synchronous sleep). */
function blockMainThread(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// --- D5: stop precedence, exhaustively ------------------------------------

test("D5: decideCompileOutcome applies watchdog, pass deadline, context budget, isolation failure, then a valid result", () => {
  const order: CompilerStopReason[] = ["watchdog_abort", "pass_deadline", "context_time_budget"];
  const abortedSets: CompilerStopReason[][] = [
    [],
    ["watchdog_abort"],
    ["pass_deadline"],
    ["context_time_budget"],
    ["watchdog_abort", "pass_deadline"],
    ["watchdog_abort", "context_time_budget"],
    ["pass_deadline", "context_time_budget"],
    ["watchdog_abort", "pass_deadline", "context_time_budget"],
  ];
  const isValid = (value: unknown): value is string => value === "ok";
  const events = [
    { name: "stop", event: { kind: "stop" as const }, whenNoStop: { kind: "isolation_failed", failure: "stopped_unexpectedly" } },
    {
      name: "could_not_start",
      event: { kind: "failure" as const, failure: "could_not_start" as const },
      whenNoStop: { kind: "isolation_failed", failure: "could_not_start" },
    },
    {
      name: "stopped_unexpectedly",
      event: { kind: "failure" as const, failure: "stopped_unexpectedly" as const },
      whenNoStop: { kind: "isolation_failed", failure: "stopped_unexpectedly" },
    },
    { name: "valid result", event: { kind: "message" as const, value: "ok", isValid }, whenNoStop: { kind: "result", value: "ok" } },
    {
      name: "malformed result",
      event: { kind: "message" as const, value: 42, isValid },
      whenNoStop: { kind: "isolation_failed", failure: "stopped_unexpectedly" },
    },
  ];

  for (const aborted of abortedSets) {
    const { stops, controllers } = stopsFor(order);
    for (const reason of aborted) {
      controllers.get(reason)?.abort();
    }
    for (const { name, event, whenNoStop } of events) {
      const outcome = decideCompileOutcome<string>(stops, event);
      const winner = order.find((reason) => aborted.includes(reason));
      const expected = winner ? { kind: "stopped", reason: winner } : whenNoStop;
      assert.deepEqual(outcome, expected, `aborted=[${aborted.join(",")}] event=${name}`);
    }
  }
});

test("D5: the order is the order of the stops list, not the order the signals aborted in", () => {
  const { stops, controllers } = stopsFor(["watchdog_abort", "pass_deadline", "context_time_budget"]);
  controllers.get("context_time_budget")?.abort();
  controllers.get("pass_deadline")?.abort();
  assert.deepEqual(decideCompileOutcome(stops, { kind: "stop" }), { kind: "stopped", reason: "pass_deadline" });
});

// --- Result validators ------------------------------------------------------

test("isFindCandidatesResult accepts a well-formed answer and rejects every malformed shape", () => {
  const input = findInput();
  const valid = { requested: [HELPER_REFERENCE], nonRepositoryReferencesSkipped: 0 };
  assert.equal(isFindCandidatesResult(valid, input), true);
  assert.equal(isFindCandidatesResult({ requested: [], nonRepositoryReferencesSkipped: 3 }, input), true);
  assert.equal(
    isFindCandidatesResult({ requested: [{ ...HELPER_REFERENCE, specifierKey: undefined }], nonRepositoryReferencesSkipped: 0 }, input),
    true,
  );

  const malformed: Array<[string, unknown]> = [
    ["not an object", "nope"],
    ["null", null],
    ["requested not an array", { requested: "x", nonRepositoryReferencesSkipped: 0 }],
    ["missing skipped count", { requested: [] }],
    ["negative skipped count", { requested: [], nonRepositoryReferencesSkipped: -1 }],
    ["duplicate id", { requested: [HELPER_REFERENCE, HELPER_REFERENCE], nonRepositoryReferencesSkipped: 0 }],
    ["non-integer id", { requested: [{ ...HELPER_REFERENCE, id: 0.5 }], nonRepositoryReferencesSkipped: 0 }],
    ["wrong kind", { requested: [{ ...HELPER_REFERENCE, kind: "usage" }], nonRepositoryReferencesSkipped: 0 }],
    ["non-string symbol", { requested: [{ ...HELPER_REFERENCE, symbolName: 1 }], nonRepositoryReferencesSkipped: 0 }],
    ["path not a changed file", { requested: [{ ...HELPER_REFERENCE, changedPath: "src/other.ts" }], nonRepositoryReferencesSkipped: 0 }],
    ["zero changed line", { requested: [{ ...HELPER_REFERENCE, changedLine: 0 }], nonRepositoryReferencesSkipped: 0 }],
    ["negative anchor", { requested: [{ ...HELPER_REFERENCE, anchorPos: -1 }], nonRepositoryReferencesSkipped: 0 }],
    ["non-string specifier key", { requested: [{ ...HELPER_REFERENCE, specifierKey: 7 }], nonRepositoryReferencesSkipped: 0 }],
    ["entry not an object", { requested: [null], nonRepositoryReferencesSkipped: 0 }],
  ];
  for (const [name, value] of malformed) {
    assert.equal(isFindCandidatesResult(value, input), false, name);
  }
});

test("isResolutionList accepts exactly one well-formed entry per requested reference and rejects the rest", async () => {
  const second = { ...HELPER_REFERENCE, id: 1, symbolName: "run" };
  const input = await resolveInputFor([HELPER_REFERENCE, second]);
  const resolved = { id: 0, path: "src/util.ts", line: 1, endLine: 3, text: "export function helper() {}" };
  const dropped = { id: 1, reason: "ambiguous_resolution" };
  assert.equal(isResolutionList([resolved, dropped], input), true);
  assert.equal(isResolutionList([dropped, resolved], input), true);
  for (const reason of ["time_budget", "read_failed", "ambiguous_resolution"]) {
    assert.equal(isResolutionList([resolved, { id: 1, reason }], input), true, reason);
  }

  const malformed: Array<[string, unknown]> = [
    ["not an array", { 0: resolved }],
    ["missing entry", [resolved]],
    ["extra entry", [resolved, dropped, { id: 2, reason: "read_failed" }]],
    ["duplicate id", [resolved, { ...resolved }]],
    ["unknown id", [resolved, { id: 9, reason: "read_failed" }]],
    ["budget-only drop reason", [resolved, { id: 1, reason: "character_budget" }]],
    ["path outside the file set", [{ ...resolved, path: "src/elsewhere.ts" }, dropped]],
    ["non-integer line", [{ ...resolved, line: 1.5 }, dropped]],
    ["missing text", [{ id: 0, path: "src/util.ts", line: 1, endLine: 3 }, dropped]],
    ["entry not an object", ["x", dropped]],
  ];
  for (const [name, value] of malformed) {
    assert.equal(isResolutionList(value, input), false, name);
  }
});

test("D12: the isolation error carries fixed text naming only the failure kind", () => {
  assert.equal(
    String(new RepositoryContextIsolationError("could_not_start")),
    "RepositoryContextIsolationError: Repository-context compiler could not start",
  );
  assert.equal(
    String(new RepositoryContextIsolationError("stopped_unexpectedly")),
    "RepositoryContextIsolationError: Repository-context compiler stopped unexpectedly",
  );
});

// --- Lifecycle with a fake spawn (exact event ordering) -------------------

class FakeWorker extends EventEmitter implements CompilerWorkerHandle {
  readonly posted: unknown[] = [];
  terminateCalls = 0;
  throwOnPost = false;
  /** Emits `exit` on the next turn after `terminate()`, like a real worker. */
  exitOnTerminate = true;

  postMessage(value: unknown): void {
    if (this.throwOnPost) {
      throw new Error("DataCloneError");
    }
    this.posted.push(value);
  }

  terminate(): Promise<number> {
    this.terminateCalls += 1;
    if (this.exitOnTerminate) {
      setImmediate(() => this.emit("exit", 1));
    }
    return Promise.resolve(1);
  }

  lastSeq(): number {
    const last = this.posted.at(-1) as { seq: number } | undefined;
    assert.ok(last, "a request must have been posted");
    return last.seq;
  }
}

function fakeSpawn(): { spawn: CompilerWorkerSpawn; workers: FakeWorker[]; options: WorkerOptions[] } {
  const workers: FakeWorker[] = [];
  const options: WorkerOptions[] = [];
  return {
    workers,
    options,
    spawn: (_url, workerOptions) => {
      const worker = new FakeWorker();
      workers.push(worker);
      options.push(workerOptions);
      return worker;
    },
  };
}

function settledState<T>(promise: Promise<T>): Promise<"pending" | T> {
  return Promise.race([promise, new Promise<"pending">((resolve) => setImmediate(() => resolve("pending")))]);
}

const VALID_FIND_RESULT = { requested: [HELPER_REFERENCE], nonRepositoryReferencesSkipped: 0 };

test("lifecycle: a request with a stop already aborted settles stopped without spawning", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({ spawn: fake.spawn });
  const { stops, controllers } = stopsFor(["watchdog_abort", "pass_deadline"]);
  controllers.get("pass_deadline")?.abort();
  assert.deepEqual(await session.findCandidates(findInput(), stops), { kind: "stopped", reason: "pass_deadline" });
  assert.equal(fake.workers.length, 0);
  assert.deepEqual(await session.findCandidates(findInput(), []), { kind: "isolation_failed", failure: "stopped_unexpectedly" });
});

test("lifecycle: a spawn that throws settles could_not_start and never rejects", async () => {
  const session = createWorkerCompilerSession({
    spawn: () => {
      throw new Error("cannot create worker at /some/local/path");
    },
  });
  assert.deepEqual(await session.findCandidates(findInput(), []), { kind: "isolation_failed", failure: "could_not_start" });
  assert.equal(activeRepositoryContextCompilerWorkerCount(), 0);
  session.close();
});

test("lifecycle: D8 worker options — empty env, captured streams, entry URL in workerData", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({
    spawn: fake.spawn,
    entryUrl: "file:///entry.ts",
    workerData: { behaviour: {}, entryUrl: "file:///ignored.ts" },
  });
  const pending = session.findCandidates(findInput(), []);
  assert.deepEqual(fake.options[0].env, {});
  assert.equal(fake.options[0].stdout, true);
  assert.equal(fake.options[0].stderr, true);
  assert.deepEqual(fake.options[0].workerData, { behaviour: {}, entryUrl: "file:///entry.ts" });
  assert.equal(fake.options[0].resourceLimits, undefined);
  session.close();
  assert.deepEqual(await pending, { kind: "isolation_failed", failure: "stopped_unexpectedly" });
  await waitForNoLiveWorker();
});

for (const event of ["error", "exit", "messageerror"] as const) {
  test(`lifecycle: ${event} before ready is could_not_start; the worker is terminated and the counter returns to 0`, async () => {
    const fake = fakeSpawn();
    const session = createWorkerCompilerSession({ spawn: fake.spawn });
    const pending = session.findCandidates(findInput(), []);
    assert.equal(activeRepositoryContextCompilerWorkerCount(), 1);
    fake.workers[0].emit(event, event === "exit" ? 1 : new Error("boom"));
    assert.deepEqual(await pending, { kind: "isolation_failed", failure: "could_not_start" });
    if (event !== "exit") {
      assert.equal(fake.workers[0].terminateCalls, 1);
    }
    await waitForNoLiveWorker();
  });

  test(`lifecycle: ${event} while busy is stopped_unexpectedly`, async () => {
    const fake = fakeSpawn();
    const session = createWorkerCompilerSession({ spawn: fake.spawn });
    const pending = session.findCandidates(findInput(), []);
    fake.workers[0].emit("message", { type: "ready" });
    fake.workers[0].emit(event, event === "exit" ? 1 : new Error("boom"));
    assert.deepEqual(await pending, { kind: "isolation_failed", failure: "stopped_unexpectedly" });
    await waitForNoLiveWorker();
  });
}

test("lifecycle: a non-ready message while starting is stopped_unexpectedly", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({ spawn: fake.spawn });
  const pending = session.findCandidates(findInput(), []);
  fake.workers[0].emit("message", { type: "result", seq: 1, value: VALID_FIND_RESULT });
  assert.deepEqual(await pending, { kind: "isolation_failed", failure: "stopped_unexpectedly" });
  await waitForNoLiveWorker();
});

test("lifecycle: a valid result settles, the worker is reused with the next seq, and close terminates it", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({ spawn: fake.spawn });
  const first = session.findCandidates(findInput(), []);
  const worker = fake.workers[0];
  worker.emit("message", { type: "ready" });
  worker.emit("message", { type: "result", seq: worker.lastSeq(), value: VALID_FIND_RESULT });
  assert.deepEqual(await first, { kind: "result", value: VALID_FIND_RESULT });

  const input = await resolveInputFor([HELPER_REFERENCE]);
  const second = session.resolveCandidates(input, []);
  assert.equal(fake.workers.length, 1, "D1: one worker per session");
  assert.equal(worker.lastSeq(), 2);
  const resolutions = [{ id: 0, path: "src/util.ts", line: 1, endLine: 3, text: "x" }];
  worker.emit("message", { type: "result", seq: 2, value: resolutions });
  assert.deepEqual(await second, { kind: "result", value: resolutions });

  assert.equal(worker.terminateCalls, 0);
  session.close();
  session.close();
  assert.equal(worker.terminateCalls, 1);
  await waitForNoLiveWorker();
});

for (const [name, message] of [
  ["a malformed result", { type: "result", seq: 1, value: { requested: "x" } }],
  ["a result with the wrong seq", { type: "result", seq: 7, value: VALID_FIND_RESULT }],
  ["an unknown message type", { type: "progress", seq: 1 }],
  ["a non-object message", "result"],
] as const) {
  test(`lifecycle: ${name} while busy is stopped_unexpectedly`, async () => {
    const fake = fakeSpawn();
    const session = createWorkerCompilerSession({ spawn: fake.spawn });
    const pending = session.findCandidates(findInput(), []);
    fake.workers[0].emit("message", { type: "ready" });
    fake.workers[0].emit("message", message);
    assert.deepEqual(await pending, { kind: "isolation_failed", failure: "stopped_unexpectedly" });
    assert.equal(fake.workers[0].terminateCalls, 1);
    await waitForNoLiveWorker();
  });
}

test("AC12: a result arriving after the stop signal is never used", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({ spawn: fake.spawn });
  const { stops, controllers } = stopsFor(["watchdog_abort", "pass_deadline", "context_time_budget"]);
  const pending = session.findCandidates(findInput(), stops);
  const worker = fake.workers[0];
  worker.emit("message", { type: "ready" });
  controllers.get("context_time_budget")?.abort();
  worker.emit("message", { type: "result", seq: 1, value: VALID_FIND_RESULT });
  assert.deepEqual(await pending, { kind: "stopped", reason: "context_time_budget" });
  assert.equal(worker.terminateCalls, 1);
  await waitForNoLiveWorker();
});

test("AC12: a crash dispatched in the same tick as the context abort, before the session's own abort listener, is time_budget", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({ spawn: fake.spawn });
  const contextController = new AbortController();
  // Registered before the session's listener, so on abort this listener runs
  // first and dispatches the crash while the signal already reads aborted.
  contextController.signal.addEventListener("abort", () => fake.workers[0].emit("exit", 1));
  const passController = new AbortController();
  const pending = session.resolveCandidates(await resolveInputFor([HELPER_REFERENCE]), [
    { reason: "pass_deadline", signal: passController.signal },
    { reason: "context_time_budget", signal: contextController.signal },
  ]);
  fake.workers[0].emit("message", { type: "ready" });
  contextController.abort();
  assert.deepEqual(await pending, { kind: "stopped", reason: "context_time_budget" });
  await waitForNoLiveWorker();
});

test("AC12: with the pass deadline and the context budget both aborted when the compile is stopped, the pass deadline wins", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({ spawn: fake.spawn });
  const { stops, controllers } = stopsFor(["watchdog_abort", "pass_deadline", "context_time_budget"]);
  // The context budget fires first, and the pass deadline expires inside the
  // same dispatch — both are aborted by the time the session decides.
  controllers.get("context_time_budget")?.signal.addEventListener("abort", () => controllers.get("pass_deadline")?.abort());
  const pending = session.resolveCandidates(await resolveInputFor([HELPER_REFERENCE]), stops);
  fake.workers[0].emit("message", { type: "ready" });
  controllers.get("context_time_budget")?.abort();
  assert.deepEqual(await pending, { kind: "stopped", reason: "pass_deadline" });
  await waitForNoLiveWorker();
});

test("lifecycle: a second request while one is in flight settles stopped_unexpectedly and leaves the first alone", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({ spawn: fake.spawn });
  const first = session.findCandidates(findInput(), []);
  const second = session.findCandidates(findInput(), []);
  assert.deepEqual(await second, { kind: "isolation_failed", failure: "stopped_unexpectedly" });
  assert.equal(await settledState(first), "pending");
  fake.workers[0].emit("message", { type: "ready" });
  fake.workers[0].emit("message", { type: "result", seq: 1, value: VALID_FIND_RESULT });
  assert.equal((await first).kind, "result");
  session.close();
  await waitForNoLiveWorker();
});

test("lifecycle: a message or crash while idle makes the session dead; later requests settle stopped_unexpectedly", async () => {
  for (const event of ["message", "error", "exit"] as const) {
    const fake = fakeSpawn();
    const session = createWorkerCompilerSession({ spawn: fake.spawn });
    const first = session.findCandidates(findInput(), []);
    fake.workers[0].emit("message", { type: "ready" });
    fake.workers[0].emit("message", { type: "result", seq: 1, value: VALID_FIND_RESULT });
    assert.equal((await first).kind, "result");
    fake.workers[0].emit(event, event === "message" ? { type: "ready" } : event === "exit" ? 1 : new Error("x"));
    const later = await session.resolveCandidates(await resolveInputFor([HELPER_REFERENCE]), []);
    assert.deepEqual(later, { kind: "isolation_failed", failure: "stopped_unexpectedly" }, event);
    session.close();
    await waitForNoLiveWorker();
  }
});

test("lifecycle: an idle request with a stop already aborted posts nothing and closes", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({ spawn: fake.spawn });
  const first = session.findCandidates(findInput(), []);
  fake.workers[0].emit("message", { type: "ready" });
  fake.workers[0].emit("message", { type: "result", seq: 1, value: VALID_FIND_RESULT });
  await first;
  const { stops, controllers } = stopsFor(["watchdog_abort"]);
  controllers.get("watchdog_abort")?.abort();
  const outcome = await session.resolveCandidates(await resolveInputFor([HELPER_REFERENCE]), stops);
  assert.deepEqual(outcome, { kind: "stopped", reason: "watchdog_abort" });
  assert.equal(fake.workers[0].posted.length, 1);
  assert.equal(fake.workers[0].terminateCalls, 1);
  await waitForNoLiveWorker();
});

test("lifecycle: close() with a request in flight settles it stopped_unexpectedly", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({ spawn: fake.spawn });
  const pending = session.findCandidates(findInput(), []);
  session.close();
  assert.deepEqual(await pending, { kind: "isolation_failed", failure: "stopped_unexpectedly" });
  assert.deepEqual(await session.findCandidates(findInput(), []), { kind: "isolation_failed", failure: "stopped_unexpectedly" });
  await waitForNoLiveWorker();
});

test("lifecycle: a postMessage that throws settles stopped_unexpectedly", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({
    spawn: (url, options) => {
      const worker = fake.spawn(url, options) as FakeWorker;
      worker.throwOnPost = true;
      return worker;
    },
  });
  assert.deepEqual(await session.findCandidates(findInput(), []), { kind: "isolation_failed", failure: "stopped_unexpectedly" });
  await waitForNoLiveWorker();
});

test("teardown race (deterministic): an error emitted after close() and before exit is absorbed, not thrown", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({ spawn: fake.spawn });
  const first = session.findCandidates(findInput(), []);
  const worker = fake.workers[0];
  worker.exitOnTerminate = false;
  worker.emit("message", { type: "ready" });
  worker.emit("message", { type: "result", seq: 1, value: VALID_FIND_RESULT });
  const outcome = await first;
  session.close();
  assert.equal(worker.listenerCount("error"), 1, "the error listener stays attached until exit");
  assert.equal(worker.listenerCount("message"), 0);
  // With no `error` listener, EventEmitter would throw here.
  assert.doesNotThrow(() => worker.emit("error", new Error("pending exception")));
  assert.doesNotThrow(() => worker.emit("message", { type: "result", seq: 1, value: VALID_FIND_RESULT }));
  assert.equal(activeRepositoryContextCompilerWorkerCount(), 1);
  worker.emit("exit", 1);
  assert.equal(worker.listenerCount("error"), 0);
  assert.equal(worker.listenerCount("exit"), 0);
  assert.deepEqual(outcome, { kind: "result", value: VALID_FIND_RESULT });
  assert.equal(activeRepositoryContextCompilerWorkerCount(), 0);
});

test("teardown race (deterministic): an error after an abort-driven stop and before exit leaves the stop outcome unchanged", async () => {
  const fake = fakeSpawn();
  const session = createWorkerCompilerSession({ spawn: fake.spawn });
  const { stops, controllers } = stopsFor(["watchdog_abort"]);
  const pending = session.findCandidates(findInput(), stops);
  const worker = fake.workers[0];
  worker.exitOnTerminate = false;
  worker.emit("message", { type: "ready" });
  controllers.get("watchdog_abort")?.abort();
  assert.doesNotThrow(() => worker.emit("error", new Error("pending exception")));
  worker.emit("exit", 1);
  assert.deepEqual(await pending, { kind: "stopped", reason: "watchdog_abort" });
  assert.equal(activeRepositoryContextCompilerWorkerCount(), 0);
});

// --- Real workers -----------------------------------------------------------

function recordingSpawn(): { spawn: CompilerWorkerSpawn; exits: number[]; errors: number[] } {
  const exits: number[] = [];
  const errors: number[] = [];
  return {
    exits,
    errors,
    spawn: (url, options) => {
      const worker = spawnCompilerWorker(url, options) as Worker;
      worker.once("exit", () => exits.push(performance.now()));
      // Observe `error` emissions without adding a listener (a listener would
      // itself hide a missing one in the session).
      const originalEmit = worker.emit.bind(worker);
      worker.emit = ((event: string | symbol, ...args: unknown[]) => {
        if (event === "error") {
          errors.push(performance.now());
        }
        return originalEmit(event, ...args);
      }) as typeof worker.emit;
      return worker;
    },
  };
}

test("AC9: the production worker entry finds and resolves the helper candidate under this runtime", async () => {
  const session = createWorkerCompilerSession();
  try {
    const found = await session.findCandidates(findInput(), []);
    assert.equal(found.kind, "result", JSON.stringify(found));
    assert.ok(found.kind === "result");
    assert.deepEqual(
      found.value.requested.map((ref) => ref.symbolName),
      ["helper"],
    );
    const resolved = await session.resolveCandidates(await resolveInputFor(found.value.requested), []);
    assert.ok(resolved.kind === "result", JSON.stringify(resolved));
    assert.equal(resolved.value.length, 1);
    assert.ok("path" in resolved.value[0]);
    assert.equal(resolved.value[0].path, "src/util.ts");
    assert.match(resolved.value[0].text, /export function helper/);
  } finally {
    session.close();
  }
  await waitForNoLiveWorker();
});

test("AC6: the worker's candidates and resolutions deep-equal the in-line results on the resolution fixture", async () => {
  const fileNames = ["types.ts", "shared.ts", "inner.ts", "reexport.ts", "overload.ts", "changed.ts"];
  const files = new Map(fileNames.map((name) => [name, readFileSync(join(RESOLUTION_FIXTURE_DIR, name), "utf8")]));
  const readFile: RepositoryContextReadFile = async (path) => files.get(path);
  const changedText = files.get("changed.ts");
  assert.ok(changedText);
  const changedLines = new Map([["changed.ts", new Set(Array.from({ length: changedText.split("\n").length }, (_, i) => i + 1))]]);

  const inline = await identifyCandidates(["changed.ts"], changedLines, readFile);
  const closure = await buildSourceFileSet(inline.changedSourceTexts, readFile, 60_000);
  const inlineResolutions = resolveSymbols(closure.fileSet, inline.requested, closure);

  const session = createWorkerCompilerSession();
  try {
    const found = await session.findCandidates({ changedSourceTexts: inline.changedSourceTexts, changedLinesByFile: changedLines }, []);
    assert.ok(found.kind === "result", JSON.stringify(found));
    assert.deepEqual(found.value.requested, inline.requested);
    assert.equal(found.value.nonRepositoryReferencesSkipped, inline.nonRepositoryReferencesSkipped);
    const resolved = await session.resolveCandidates(
      {
        fileSet: closure.fileSet,
        requested: found.value.requested,
        bookkeeping: {
          resolvedSpecifierKeys: closure.resolvedSpecifierKeys,
          refusedSpecifierKeys: closure.refusedSpecifierKeys,
          attemptedSpecifierKeys: closure.attemptedSpecifierKeys,
        },
      },
      [],
    );
    assert.ok(resolved.kind === "result", JSON.stringify(resolved));
    assert.deepEqual(resolved.value, inlineResolutions);
  } finally {
    session.close();
  }
  await waitForNoLiveWorker();
});

test("AC3: main-thread timers stay on time while a real worker compiles for seconds", async () => {
  const session = createWorkerCompilerSession({
    entryUrl: CONTROLLABLE_ENTRY_URL,
    workerData: { behaviour: { find: { kind: "busy", ms: AC3_SLOW_COMPILE_MS } } },
  });
  const lateness: number[] = [];
  let ticking = true;
  const tick = (): void => {
    const due = performance.now() + 50;
    setTimeout(() => {
      lateness.push(performance.now() - due);
      if (ticking) {
        tick();
      }
    }, 50);
  };
  try {
    const startedAt = performance.now();
    tick();
    const found = await session.findCandidates(findInput(), []);
    ticking = false;
    const elapsed = performance.now() - startedAt;
    assert.equal(found.kind, "result");
    assert.ok(elapsed >= AC3_SLOW_COMPILE_MS, `the compile must really have been slow (took ${elapsed}ms)`);
    assert.ok(lateness.length >= AC3_SLOW_COMPILE_MS / 100, `timers must have kept firing (fired ${lateness.length})`);
    const worst = Math.max(...lateness);
    assert.ok(worst <= AC3_TIMER_LATENESS_BOUND_MS, `worst timer lateness ${worst.toFixed(1)}ms exceeds ${AC3_TIMER_LATENESS_BOUND_MS}ms`);
  } finally {
    ticking = false;
    session.close();
  }
  await waitForNoLiveWorker();
});

test("D3: a stop during a real slow compile settles and the worker exits within the grace of the stop", async () => {
  const recording = recordingSpawn();
  const session = createWorkerCompilerSession({
    entryUrl: CONTROLLABLE_ENTRY_URL,
    workerData: { behaviour: { find: { kind: "busy", ms: 60_000 } } },
    spawn: recording.spawn,
  });
  const { stops, controllers } = stopsFor(["watchdog_abort", "pass_deadline"]);
  const pending = session.findCandidates(findInput(), stops);
  let settledAt = 0;
  void pending.then(() => {
    settledAt = performance.now();
  });
  // Let the worker start and get well into its busy loop.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  const stoppedAt = performance.now();
  controllers.get("pass_deadline")?.abort();
  assert.deepEqual(await pending, { kind: "stopped", reason: "pass_deadline" });
  await waitFor(() => recording.exits.length === 1, 5_000, "worker exit");
  assert.ok(settledAt - stoppedAt <= REPOSITORY_CONTEXT_COMPILE_STOP_GRACE_MS, `settled ${settledAt - stoppedAt}ms after the stop`);
  assert.ok(
    recording.exits[0] - stoppedAt <= REPOSITORY_CONTEXT_COMPILE_STOP_GRACE_MS,
    `worker exited ${recording.exits[0] - stoppedAt}ms after the stop`,
  );
  session.close();
  await waitForNoLiveWorker();
});

test("AC4: a real worker whose entry cannot load settles could_not_start", async () => {
  const session = createWorkerCompilerSession({ entryUrl: MISSING_ENTRY_URL });
  assert.deepEqual(await session.findCandidates(findInput(), []), { kind: "isolation_failed", failure: "could_not_start" });
  session.close();
  await waitForNoLiveWorker();
});

for (const kind of ["exit", "throw", "malformed", "wrong_seq", "unknown_type"] as const) {
  test(`AC5: a real worker that ${kind === "exit" ? "exits" : `answers ${kind}`} mid-resolve settles stopped_unexpectedly`, async () => {
    const session = createWorkerCompilerSession({
      entryUrl: CONTROLLABLE_ENTRY_URL,
      workerData: { behaviour: { resolve: { kind } } },
    });
    try {
      const found = await session.findCandidates(findInput(), []);
      assert.ok(found.kind === "result", JSON.stringify(found));
      const resolved = await session.resolveCandidates(await resolveInputFor(found.value.requested), []);
      assert.deepEqual(resolved, { kind: "isolation_failed", failure: "stopped_unexpectedly" });
    } finally {
      session.close();
    }
    await waitForNoLiveWorker();
  });
}

/**
 * Drives the controllable worker's `handshake_throw`: waits until the worker
 * is parked, lets it throw, then blocks the main thread until the worker's
 * fatal-error report is under way (and briefly past it), so the worker's
 * `error` message is already queued when `stopNow` runs — the stop or close
 * happens strictly before the main thread can see that `error`, and the
 * `error` strictly before `exit` (Node drains a worker's messages before it
 * emits `exit`).
 */
async function throwAfter(handshake: Int32Array, stopNow: () => void): Promise<void> {
  await waitFor(() => Atomics.load(handshake, 0) === 1, 10_000, "worker parked in the handshake");
  Atomics.store(handshake, 1, 1);
  Atomics.notify(handshake, 1);
  assert.equal(Atomics.wait(handshake, 2, 0, 5_000) === "timed-out", false, "the worker must have thrown");
  blockMainThread(100);
  stopNow();
}

async function captureUncaught<T>(run: () => Promise<T>): Promise<{ value: T; uncaught: unknown[] }> {
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown): void => {
    uncaught.push(error);
  };
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUncaught);
  try {
    const value = await run();
    return { value, uncaught };
  } finally {
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onUncaught);
  }
}

test("teardown race (real worker): a worker that throws after close() raises no uncaught exception and exits", async () => {
  const handshake = new Int32Array(new SharedArrayBuffer(12));
  const recording = recordingSpawn();
  const { value: outcome, uncaught } = await captureUncaught(async () => {
    const session = createWorkerCompilerSession({
      entryUrl: CONTROLLABLE_ENTRY_URL,
      workerData: { behaviour: { find: { kind: "handshake_throw", answerFirst: true } }, handshake },
      spawn: recording.spawn,
    });
    const found = await session.findCandidates(findInput(), []);
    await throwAfter(handshake, () => session.close());
    await waitForNoLiveWorker();
    return found;
  });
  assert.equal(outcome.kind, "result");
  assert.deepEqual(uncaught, []);
  assert.equal(recording.errors.length, 1, "the worker's error must really have reached the main thread after close()");
  assert.equal(activeRepositoryContextCompilerWorkerCount(), 0);
});

test("teardown race (real worker): a worker that throws after an abort-driven stop leaves the stop outcome unchanged", async () => {
  const handshake = new Int32Array(new SharedArrayBuffer(12));
  const recording = recordingSpawn();
  const { stops, controllers } = stopsFor(["watchdog_abort", "pass_deadline"]);
  const { value: outcome, uncaught } = await captureUncaught(async () => {
    const session = createWorkerCompilerSession({
      entryUrl: CONTROLLABLE_ENTRY_URL,
      workerData: { behaviour: { find: { kind: "handshake_throw" } }, handshake },
      spawn: recording.spawn,
    });
    const pending: Promise<CompileOutcome<unknown>> = session.findCandidates(findInput(), stops);
    await throwAfter(handshake, () => controllers.get("watchdog_abort")?.abort());
    const settled = await pending;
    await waitForNoLiveWorker();
    session.close();
    return settled;
  });
  assert.deepEqual(outcome, { kind: "stopped", reason: "watchdog_abort" });
  assert.deepEqual(uncaught, []);
  assert.equal(recording.errors.length, 1, "the worker's error must really have reached the main thread after the stop");
  assert.equal(activeRepositoryContextCompilerWorkerCount(), 0);
});
