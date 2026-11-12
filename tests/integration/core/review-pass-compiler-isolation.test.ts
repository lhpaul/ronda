import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { runReviewPass } from "../../../src/core/run-review-pass.js";
import {
  DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
  DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
} from "../../../src/config/load-config.js";
import type {
  ChangedFile,
  GithubOperations,
  Logger,
  PublishCheckRunInput,
  PublishReviewInput,
  PullRequestMetadata,
  ReviewPassDeps,
  ReviewPassResult,
} from "../../../src/domain/review-pass.types.js";
import { ModelClientError, type ModelClient } from "../../../src/inference/model-client.js";
import type { RondaConfig } from "../../../src/config/config.types.js";
import type { DeadlineClock, DeadlineTimerHandle } from "../../../src/core/pass-deadline.js";
import {
  activeRepositoryContextCompilerWorkerCount,
  createWorkerCompilerSession,
  REPOSITORY_CONTEXT_COMPILE_STOP_GRACE_MS,
  type RepositoryContextCompilerFactory,
} from "../../../src/review/repository-context-compiler.js";
import { withOuterAbortSignal } from "../../../src/webhook/webhook-job.js";
import {
  captureUncaught,
  CONTROLLABLE_ENTRY_URL,
  MISSING_ENTRY_URL,
  recordingSpawn,
  waitFor,
} from "../../support/compiler-worker-test-helpers.js";
import { createScriptedCompilerSessions } from "../../support/scripted-compiler-session.js";

/**
 * Pass-level tests for terminable repository-context compiler work (#131):
 * stops at the budget (AC1, AC2), isolation failures (AC4, AC5), cleanup
 * (AC7), no-start passes (AC8), log content (AC10), and stop precedence
 * (AC12). Real controllable workers are used wherever the behaviour under
 * test is the worker's; the scripted session only where a case needs exact
 * event ordering.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const PLANTED_CREDENTIAL = "sk-planted-credential-131-do-not-log";
const STOP_GRACE = REPOSITORY_CONTEXT_COMPILE_STOP_GRACE_MS;
const INPUT = { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" as const };
const HEAD_SHA = "a".repeat(40);

const CALLER_TEXT = ['import { helper } from "./util.js";', "", "export function run(): number {", "  return helper(1);", "}"].join(
  "\n",
);
const UTIL_TEXT = "export function helper(x: number): number {\n  return x + 1;\n}\n";
/** Lines of file text that must never appear in a log event (AC10). */
const FILE_TEXT_MARKERS = ["return helper(1);", "return x + 1;", 'import { helper } from "./util.js";'];

function pullRequest(overrides: Partial<PullRequestMetadata> = {}): PullRequestMetadata {
  return {
    number: 1,
    title: "Change",
    body: "",
    draft: false,
    headSha: HEAD_SHA,
    headBranch: "feature/test",
    headRepoFullName: "lhpaul/ronda",
    ...overrides,
  };
}

function changedFile(path: string, patchedLines: number[]): ChangedFile {
  const body = patchedLines.map(() => "+line").join("\n");
  return {
    path,
    status: "modified",
    additions: patchedLines.length,
    deletions: 0,
    patch: `@@ -1,0 +${patchedLines[0]},${patchedLines.length} @@\n${body}`,
  };
}

function createFakeGithub(
  options: {
    pullRequest?: PullRequestMetadata;
    changedFiles?: ChangedFile[];
    repoFiles?: Map<string, string>;
    /** Head SHA returned by the pre-publication re-read; differs from the first to supersede. */
    latestHeadSha?: string;
  } = {},
): { ops: GithubOperations; publishedReviews: PublishReviewInput[]; publishedCheckRuns: PublishCheckRunInput[] } {
  const publishedReviews: PublishReviewInput[] = [];
  const publishedCheckRuns: PublishCheckRunInput[] = [];
  const pr = options.pullRequest ?? pullRequest();
  let reads = 0;
  const repoFiles =
    options.repoFiles ??
    new Map([
      ["src/caller.ts", CALLER_TEXT],
      ["src/util.ts", UTIL_TEXT],
    ]);
  const ops: GithubOperations = {
    async readPullRequest() {
      reads += 1;
      return reads > 1 && options.latestHeadSha ? { ...pr, headSha: options.latestHeadSha } : pr;
    },
    async readChangedFiles() {
      return options.changedFiles ?? [changedFile("src/caller.ts", [4])];
    },
    async readFileAtRef(_owner, _repo, path) {
      return repoFiles.get(path);
    },
    async findExistingCheckRun() {
      return null;
    },
    async publishReview(reviewInput) {
      publishedReviews.push(reviewInput);
    },
    async publishCheckRun(checkRunInput) {
      publishedCheckRuns.push(checkRunInput);
    },
  };
  return { ops, publishedReviews, publishedCheckRuns };
}

/**
 * A model that honours its signal, including an abort that arrives after the
 * call started: it answers on a later turn unless the signal aborts first,
 * and rejects as `timed_out` the way the real client does.
 */
function createSignalHonouringModel(): ModelClient {
  return {
    modelName: "fake-model",
    complete(_request, signal) {
      return new Promise((resolvePromise, reject) => {
        const fail = (): void => reject(new ModelClientError("timed_out", "model request aborted"));
        if (signal?.aborted) {
          fail();
          return;
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener("abort", onAbort);
          resolvePromise({ content: JSON.stringify({ findings: [] }) });
        }, 20);
        const onAbort = (): void => {
          clearTimeout(timer);
          fail();
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },
  };
}

interface LoggedEvent {
  name: string;
  fields: Record<string, unknown>;
  at: number;
}

function createLogger(): { logger: Logger; events: LoggedEvent[] } {
  const events: LoggedEvent[] = [];
  return { logger: { event: (name, fields) => events.push({ name, fields, at: performance.now() }) }, events };
}

/**
 * A keep-alive deadline clock (see `review-pass-repository-context.test.ts`)
 * that also records when each timer fired, keyed by its budget. With
 * `suppressFirst`, the first timer armed (the pass's own deadline) never fires.
 */
function recordingDeadlineClock(suppressFirst = false): { clock: DeadlineClock; fired: Array<{ ms: number; at: number }> } {
  const fired: Array<{ ms: number; at: number }> = [];
  let armed = 0;
  return {
    fired,
    clock: {
      setTimeout: (callback, ms) => {
        armed += 1;
        if (suppressFirst && armed === 1) {
          return { unref: () => undefined };
        }
        const real = setTimeout(() => {
          fired.push({ ms, at: performance.now() });
          callback();
        }, ms);
        return { real, unref: () => undefined } as DeadlineTimerHandle & { real: NodeJS.Timeout };
      },
      clearTimeout: (handle) => {
        const real = (handle as DeadlineTimerHandle & { real?: NodeJS.Timeout }).real;
        if (real) {
          clearTimeout(real);
        }
      },
    },
  };
}

function createConfig(overrides: Partial<RondaConfig> = {}): RondaConfig {
  return {
    model: { apiKey: PLANTED_CREDENTIAL, baseUrl: "https://example.test/v1", modelName: "fake-model" },
    passTimeoutMs: 600_000,
    maxPatchChars: 400_000,
    maxAuthoritativeDocCount: DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
    maxAuthoritativeDocChars: DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
    durabilityMode: "default",
    durabilityModeDefault: false,
    sweepMode: "off",
    sweepModeRaw: undefined,
    repositoryContextMode: "on",
    repositoryContextModeRaw: undefined,
    maxRepositoryContextCandidates: 12,
    maxRepositoryContextChars: 24_000,
    repositoryContextTimeBudgetMs: 120_000,
    repositoryContextBudgetFallbacks: [],
    excludePathGlobs: [],
    ...overrides,
  };
}

interface PassRun {
  result: ReviewPassResult;
  events: LoggedEvent[];
  publishedReviews: PublishReviewInput[];
  publishedCheckRuns: PublishCheckRunInput[];
  settledAt: number;
}

async function runPass(options: {
  config?: Partial<RondaConfig>;
  github?: Parameters<typeof createFakeGithub>[0];
  compiler?: RepositoryContextCompilerFactory;
  deadlineClock?: DeadlineClock;
  jobAbortSignal?: AbortSignal;
}): Promise<PassRun> {
  const { logger, events } = createLogger();
  const github = createFakeGithub(options.github);
  const deps: ReviewPassDeps = {
    github: github.ops,
    model: withOuterAbortSignal(createSignalHonouringModel(), options.jobAbortSignal),
    config: createConfig(options.config),
    clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
    logger,
    deadlineClock: options.deadlineClock ?? recordingDeadlineClock().clock,
    ...(options.compiler ? { createRepositoryContextCompiler: options.compiler } : {}),
    ...(options.jobAbortSignal ? { jobAbortSignal: options.jobAbortSignal } : {}),
  };
  const result = await runReviewPass(INPUT, deps);
  return { result, events, ...github, settledAt: performance.now() };
}

function controllableCompiler(
  behaviour: Record<string, unknown>,
  spawn = recordingSpawn().spawn,
): RepositoryContextCompilerFactory {
  return () => createWorkerCompilerSession({ entryUrl: CONTROLLABLE_ENTRY_URL, workerData: { behaviour }, spawn });
}

function eventsNamed(run: PassRun, name: string): LoggedEvent[] {
  return run.events.filter((event) => event.name === name);
}

function passRecord(run: PassRun): Record<string, unknown> {
  const recordEvents = eventsNamed(run, "repository_context_pass_record");
  assert.equal(recordEvents.length, 1, "exactly one repository_context_pass_record");
  return recordEvents[0].fields;
}

/** AC10: no event carries file text, the planted credential, a local path, or a file URL. */
function assertNoLeak(run: PassRun): void {
  const forbidden = [...FILE_TEXT_MARKERS, PLANTED_CREDENTIAL, REPO_ROOT, tmpdir(), "file://"];
  for (const event of run.events) {
    const serialized = JSON.stringify(event);
    for (const needle of forbidden) {
      assert.ok(!serialized.includes(needle), `${event.name} must not contain ${JSON.stringify(needle)}`);
    }
  }
  for (const event of eventsNamed(run, "repository_context_phase_failed")) {
    assert.match(
      String(event.fields.message),
      /^RepositoryContextIsolationError: Repository-context compiler (could not start|stopped unexpectedly)$/,
    );
  }
}

async function assertNoLiveWorkerWithinGrace(): Promise<void> {
  await waitFor(() => activeRepositoryContextCompilerWorkerCount() === 0, STOP_GRACE, "no live worker within the stop grace");
}

// --- AC1: the context time budget stops a slow resolution compile ---------

test("AC1: a resolution compile outrunning the context budget is stopped within the grace; every reference time_budget; review published", async () => {
  const recording = recordingSpawn();
  const deadline = recordingDeadlineClock();
  const budgetMs = 400;
  const { value: run, uncaught } = await captureUncaught(() =>
    runPass({
      config: { repositoryContextTimeBudgetMs: budgetMs },
      compiler: controllableCompiler({ resolve: { kind: "busy", ms: 60_000 } }, recording.spawn),
      deadlineClock: deadline.clock,
    }),
  );
  const contextFired = deadline.fired.find((timer) => timer.ms === budgetMs);
  assert.ok(contextFired, "the context deadline must have fired");
  const stop = eventsNamed(run, "repository_context_compile_stopped");
  assert.deepEqual(
    stop.map((event) => event.fields),
    [{ phase: "resolving_candidates", stoppedBy: "context_time_budget" }],
  );
  assert.ok(stop[0].at - contextFired.at <= STOP_GRACE, `stop logged ${stop[0].at - contextFired.at}ms after expiry`);
  await waitFor(() => recording.exits.length === 1, 5_000, "worker exit");
  assert.ok(recording.exits[0] - contextFired.at <= STOP_GRACE, `worker exited ${recording.exits[0] - contextFired.at}ms after expiry`);

  assert.equal(run.result.outcome, "succeeded");
  assert.equal(run.publishedReviews.length, 1);
  const record = run.result.repositoryContext?.record;
  assert.equal(record?.outcome, "unavailable");
  assert.equal(record?.candidatesRequested, 1);
  assert.equal(record?.drops.length, 1);
  assert.ok(record?.drops.every((drop) => drop.reason === "time_budget"));
  assert.ok((record?.timeUsedMs ?? 0) >= budgetMs, `time used ${record?.timeUsedMs}ms reflects real elapsed time`);
  assert.ok((record?.timeUsedMs ?? 0) < budgetMs + 2_000, `time used ${record?.timeUsedMs}ms is not the full compile`);
  assert.deepEqual(uncaught, []);
  assertNoLeak(run);
  await assertNoLiveWorkerWithinGrace();
});

// --- AC2: the pass deadline stops a slow finding compile ------------------

test("AC2: a finding compile outrunning the pass deadline is stopped within the grace; the pass ends timed_out", async () => {
  const recording = recordingSpawn();
  const deadline = recordingDeadlineClock();
  const passTimeoutMs = 1_500;
  const { value: run, uncaught } = await captureUncaught(() =>
    runPass({
      config: { passTimeoutMs },
      compiler: controllableCompiler({ find: { kind: "busy", ms: 60_000 } }, recording.spawn),
      deadlineClock: deadline.clock,
    }),
  );
  const passFired = deadline.fired.find((timer) => timer.ms === passTimeoutMs);
  assert.ok(passFired, "the pass deadline must have fired");
  const stop = eventsNamed(run, "repository_context_compile_stopped");
  assert.deepEqual(
    stop.map((event) => event.fields),
    [{ phase: "finding_candidates", stoppedBy: "pass_deadline" }],
  );
  assert.ok(stop[0].at - passFired.at <= STOP_GRACE, `stop logged ${stop[0].at - passFired.at}ms after expiry`);
  await waitFor(() => recording.exits.length === 1, 5_000, "worker exit");
  assert.ok(recording.exits[0] - passFired.at <= STOP_GRACE, `worker exited ${recording.exits[0] - passFired.at}ms after expiry`);

  assert.equal(run.result.outcome, "failed");
  assert.equal(run.result.failureReason, "timed_out");
  assert.equal(run.publishedReviews.length, 0);
  assert.equal(run.publishedCheckRuns.length, 1);
  assert.equal(run.publishedCheckRuns[0].conclusion, "failure");
  const record = passRecord(run);
  assert.equal(record.outcome, "unavailable");
  assert.equal(record.candidatesRequested, 0);
  assert.deepEqual(record.drops, []);
  assert.equal(record.contentRequestCount, 1);
  assert.equal(record.timeBudgetMs, 120_000);
  assert.equal(record.timeUsedMs, 0);
  assert.deepEqual(uncaught, []);
  assertNoLeak(run);
  await assertNoLiveWorkerWithinGrace();
});

// --- AC4 / AC5: isolation failures degrade the pass, never fail it -------

test("AC4: a real worker that cannot start degrades to unavailable with no drops, emits start_failed, and publishes", async () => {
  const { value: run, uncaught } = await captureUncaught(() =>
    runPass({ compiler: () => createWorkerCompilerSession({ entryUrl: MISSING_ENTRY_URL }) }),
  );
  assert.equal(run.result.outcome, "succeeded");
  assert.equal(run.publishedReviews.length, 1);
  assert.deepEqual(
    eventsNamed(run, "repository_context_compiler_start_failed").map((event) => event.fields),
    [{ phase: "finding_candidates" }],
  );
  assert.deepEqual(
    eventsNamed(run, "repository_context_phase_failed").map((event) => event.fields),
    [{ message: "RepositoryContextIsolationError: Repository-context compiler could not start" }],
  );
  const record = run.result.repositoryContext?.record;
  assert.equal(record?.outcome, "unavailable");
  assert.equal(record?.candidatesRequested, 0);
  assert.deepEqual(record?.drops, []);
  assert.deepEqual(uncaught, []);
  assertNoLeak(run);
  await assertNoLiveWorkerWithinGrace();
});

test("AC4: a spawn that throws degrades the same way", async () => {
  const run = await runPass({
    compiler: () =>
      createWorkerCompilerSession({
        spawn: () => {
          throw new Error(`cannot start worker from ${REPO_ROOT}`);
        },
      }),
  });
  assert.equal(run.result.outcome, "succeeded");
  assert.equal(run.publishedReviews.length, 1);
  assert.equal(eventsNamed(run, "repository_context_compiler_start_failed").length, 1);
  assert.equal(run.result.repositoryContext?.record?.outcome, "unavailable");
  assertNoLeak(run);
});

for (const kind of ["exit", "malformed"] as const) {
  test(`AC5: a real worker that ${kind === "exit" ? "exits" : "answers malformed"} mid-resolve drops every reference read_failed and publishes`, async () => {
    const { value: run, uncaught } = await captureUncaught(() =>
      runPass({ compiler: controllableCompiler({ resolve: { kind } }) }),
    );
    assert.equal(run.result.outcome, "succeeded");
    assert.equal(run.publishedReviews.length, 1);
    assert.deepEqual(
      eventsNamed(run, "repository_context_compiler_stopped_unexpectedly").map((event) => event.fields),
      [{ phase: "resolving_candidates" }],
    );
    assert.deepEqual(
      eventsNamed(run, "repository_context_phase_failed").map((event) => event.fields),
      [{ message: "RepositoryContextIsolationError: Repository-context compiler stopped unexpectedly" }],
    );
    const record = run.result.repositoryContext?.record;
    assert.equal(record?.outcome, "unavailable");
    assert.equal(record?.candidatesRequested, 1);
    assert.ok((record?.drops.length ?? 0) > 0);
    assert.ok(record?.drops.every((drop) => drop.reason === "read_failed"));
    assert.deepEqual(uncaught, []);
    assertNoLeak(run);
    await assertNoLiveWorkerWithinGrace();
  });
}

// --- AC6 / AC7: the production worker on an ordinary pass, and cleanup ----

test("AC6/AC7: an ordinary pass resolves through the production worker and leaves no worker behind", async () => {
  const run = await runPass({});
  assert.equal(run.result.outcome, "succeeded");
  assert.equal(run.result.repositoryContext?.record?.outcome, "used");
  assert.equal(run.result.repositoryContext?.record?.candidatesResolved, 1);
  assert.equal(eventsNamed(run, "repository_context_compile_stopped").length, 0);
  await assertNoLiveWorkerWithinGrace();
});

test("AC7: a superseded pass leaves no worker behind", async () => {
  const run = await runPass({ github: { latestHeadSha: "b".repeat(40) } });
  assert.equal(run.result.outcome, "skipped");
  assert.equal(run.result.skipReason, "superseded_head_sha");
  assert.equal(run.result.repositoryContext?.record?.outcome, "used");
  await assertNoLiveWorkerWithinGrace();
});

test("AC7: a watchdog abort stops an in-flight compile within the grace of the abort; the pass ends timed_out", async () => {
  const recording = recordingSpawn();
  const watchdog = new AbortController();
  let abortedAt = 0;
  const timer = setTimeout(() => {
    abortedAt = performance.now();
    watchdog.abort(new Error("webhook job watchdog"));
  }, 1_200);
  try {
    const { value: run, uncaught } = await captureUncaught(() =>
      runPass({
        compiler: controllableCompiler({ find: { kind: "busy", ms: 60_000 } }, recording.spawn),
        jobAbortSignal: watchdog.signal,
      }),
    );
    const stop = eventsNamed(run, "repository_context_compile_stopped");
    assert.deepEqual(
      stop.map((event) => event.fields),
      [{ phase: "finding_candidates", stoppedBy: "watchdog_abort" }],
    );
    assert.ok(stop[0].at - abortedAt <= STOP_GRACE, `stop logged ${stop[0].at - abortedAt}ms after the abort`);
    assert.ok(run.settledAt - abortedAt < 5_000, "the aborted job settles promptly");
    await waitFor(() => recording.exits.length === 1, 5_000, "worker exit");
    assert.ok(recording.exits[0] - abortedAt <= STOP_GRACE, `worker exited ${recording.exits[0] - abortedAt}ms after the abort`);
    assert.equal(run.result.outcome, "failed");
    assert.equal(run.result.failureReason, "timed_out");
    assert.deepEqual(uncaught, []);
    assertNoLeak(run);
    await assertNoLiveWorkerWithinGrace();
  } finally {
    clearTimeout(timer);
  }
});

// --- AC8: passes that never need a compile start no session ---------------

test("AC8: repository context off, a fork head, a draft, a pre-review failure, and no eligible source start no compiler session", async () => {
  const cases: Array<{ name: string; options: Parameters<typeof runPass>[0] }> = [
    { name: "off", options: { config: { repositoryContextMode: "off" } } },
    { name: "fork", options: { github: { pullRequest: pullRequest({ headRepoFullName: "someone-else/ronda" }) } } },
    { name: "draft", options: { github: { pullRequest: pullRequest({ draft: true }) } } },
    {
      name: "missing credential",
      options: { config: { model: { apiKey: "", baseUrl: "https://example.test/v1", modelName: "fake-model" } } },
    },
    { name: "no eligible source", options: { github: { changedFiles: [changedFile("docs/readme.md", [1])] } } },
    { name: "eligible file absent at the head", options: { github: { changedFiles: [changedFile("src/missing.ts", [1])] } } },
  ];
  for (const { name, options } of cases) {
    let created = 0;
    const counting: RepositoryContextCompilerFactory = () => {
      created += 1;
      return createWorkerCompilerSession();
    };
    await runPass({ ...options, compiler: counting });
    assert.equal(created, 0, `${name}: no compiler session`);
  }
  assert.equal(activeRepositoryContextCompilerWorkerCount(), 0);
});

// --- D6: the context deadline is labelled by what it really bounds --------

test("D6: when the remaining pass time is the lesser bound, the context deadline stops the compile as pass_deadline", async () => {
  const passTimeoutMs = 400;
  // The pass's own deadline timer is suppressed so only the (clamped) context
  // deadline can fire — isolating its label from the real pass deadline.
  const deadline = recordingDeadlineClock(true);
  const scripted = createScriptedCompilerSessions({ resolve: { kind: "wait_for_stop" } });
  const run = await runPass({
    config: { passTimeoutMs, repositoryContextTimeBudgetMs: 120_000 },
    compiler: scripted.factory,
    deadlineClock: deadline.clock,
  });
  assert.deepEqual(
    eventsNamed(run, "repository_context_compile_stopped").map((event) => event.fields),
    [{ phase: "resolving_candidates", stoppedBy: "pass_deadline" }],
  );
  assert.ok(run.result.repositoryContext?.record?.drops.every((drop) => drop.reason === "time_budget"));
  assert.equal(scripted.closed, 1);
});

// --- AC12: stop precedence and result rules at pass level -----------------

test("AC12: with the pass deadline and the context budget both expired when the compile is stopped, the pass ends timed_out", async () => {
  const scripted = createScriptedCompilerSessions({ resolve: { kind: "after", ms: 700, then: "valid" } });
  const run = await runPass({
    config: { passTimeoutMs: 400, repositoryContextTimeBudgetMs: 100 },
    compiler: scripted.factory,
  });
  assert.deepEqual(
    eventsNamed(run, "repository_context_compile_stopped").map((event) => event.fields),
    [{ phase: "resolving_candidates", stoppedBy: "pass_deadline" }],
  );
  assert.equal(run.result.outcome, "failed");
  assert.equal(run.result.failureReason, "timed_out");
  assert.equal(run.publishedReviews.length, 0);
  assert.equal(scripted.closed, 1);
});

test("AC12: the context budget expiring together with a crash drops every reference time_budget, not read_failed", async () => {
  const scripted = createScriptedCompilerSessions({ resolve: { kind: "after", ms: 300, then: "crash" } });
  const run = await runPass({ config: { repositoryContextTimeBudgetMs: 50 }, compiler: scripted.factory });
  assert.equal(run.result.outcome, "succeeded");
  assert.equal(run.publishedReviews.length, 1);
  assert.equal(eventsNamed(run, "repository_context_compiler_stopped_unexpectedly").length, 0);
  assert.equal(eventsNamed(run, "repository_context_phase_failed").length, 0);
  const record = run.result.repositoryContext?.record;
  assert.equal(record?.outcome, "unavailable");
  assert.ok((record?.drops.length ?? 0) > 0);
  assert.ok(record?.drops.every((drop) => drop.reason === "time_budget"));
});

test("AC12: a result delivered after its phase's budget ran out is not used", async () => {
  const scripted = createScriptedCompilerSessions({ resolve: { kind: "after", ms: 300, then: "valid" } });
  const run = await runPass({ config: { repositoryContextTimeBudgetMs: 50 }, compiler: scripted.factory });
  assert.equal(run.result.outcome, "succeeded");
  assert.equal(run.result.repositoryContext?.record?.candidatesResolved, 0);
  assert.ok(run.result.repositoryContext?.record?.drops.every((drop) => drop.reason === "time_budget"));
  assert.deepEqual(
    eventsNamed(run, "repository_context_compile_stopped").map((event) => event.fields),
    [{ phase: "resolving_candidates", stoppedBy: "context_time_budget" }],
  );
});

test("AC12: a malformed result is recorded as the worker stopping unexpectedly (AC5)", async () => {
  const scripted = createScriptedCompilerSessions({ resolve: { kind: "after", ms: 0, then: "malformed" } });
  const run = await runPass({ compiler: scripted.factory });
  assert.equal(run.result.outcome, "succeeded");
  assert.equal(run.publishedReviews.length, 1);
  assert.equal(eventsNamed(run, "repository_context_compiler_stopped_unexpectedly").length, 1);
  assert.ok(run.result.repositoryContext?.record?.drops.every((drop) => drop.reason === "read_failed"));
  assertNoLeak(run);
});

test("AC12: a malformed finding result degrades with no drops", async () => {
  const scripted = createScriptedCompilerSessions({ find: { kind: "after", ms: 0, then: "malformed" } });
  const run = await runPass({ compiler: scripted.factory });
  assert.equal(run.result.outcome, "succeeded");
  assert.deepEqual(
    eventsNamed(run, "repository_context_compiler_stopped_unexpectedly").map((event) => event.fields),
    [{ phase: "finding_candidates" }],
  );
  assert.deepEqual(run.result.repositoryContext?.record?.drops, []);
  assert.equal(scripted.created, 1);
  assert.equal(scripted.closed, 1);
});
