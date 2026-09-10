import { test } from "node:test";
import assert from "node:assert/strict";
import { runReviewPass } from "../../../src/core/run-review-pass.js";
import { GithubClientError } from "../../../src/github/github-client.js";
import { ModelClientError } from "../../../src/inference/model-client.js";
import type {
  ChangedFile,
  GithubOperations,
  Logger,
  PublishCheckRunInput,
  PublishReviewInput,
  PullRequestMetadata,
  ReviewPassDeps,
} from "../../../src/domain/review-pass.types.js";
import type { ModelClient } from "../../../src/inference/model-client.js";
import type { RondaConfig } from "../../../src/config/config.types.js";
import type { DeadlineClock, DeadlineTimerHandle } from "../../../src/core/pass-deadline.js";

/**
 * A short, real timer that the process treats as an active handle (unlike
 * production's `unref`-ed deadline timer). `createPassDeadline` always
 * calls `timer.unref?.()` on whatever `setTimeout` returns; here that call
 * hits this wrapper's no-op instead of `Timeout.prototype.unref`, so the
 * real underlying timer keeps the event loop alive for the few milliseconds
 * the test needs. Without this, an `unref`-ed real timer as the *only*
 * active handle in an idle test process can trigger Node's test runner to
 * treat the process as exiting before the timer callback ever runs
 * ("Promise resolution is still pending but the event loop has already
 * resolved") — a test-process artifact, not a product bug.
 */
function createFastDeadlineClock(fireAfterMs: number): DeadlineClock {
  return {
    setTimeout: (callback) => {
      const real = setTimeout(callback, fireAfterMs);
      return { real, unref: () => undefined } as DeadlineTimerHandle & { real: NodeJS.Timeout };
    },
    clearTimeout: (handle) => {
      clearTimeout((handle as DeadlineTimerHandle & { real: NodeJS.Timeout }).real);
    },
  };
}

const HEAD_SHA = "a".repeat(40);

function createPullRequest(overrides: Partial<PullRequestMetadata> = {}): PullRequestMetadata {
  return {
    number: 1,
    title: "Add a feature",
    body: "Description",
    draft: false,
    headSha: HEAD_SHA,
    ...overrides,
  };
}

type GithubCallName =
  | "readPullRequest"
  | "readChangedFiles"
  | "findExistingCheckRun"
  | "publishReview"
  | "publishCheckRun";

interface FakeGithubOptions {
  pullRequest: PullRequestMetadata;
  changedFiles?: ChangedFile[];
  existingCheckRunId?: number | null;
  /** When true, the second `readPullRequest` call (the pre-publication re-read) reports a moved head SHA. */
  supersedeOnReRead?: boolean;
  /**
   * Number of leading `publishCheckRun` calls that throw before one
   * succeeds. `0` (the default) never fails. Every attempt — failing or
   * not — is recorded in `checkRunAttempts`.
   */
  publishCheckRunFailTimes?: number;
  publishCheckRunError?: unknown;
  /** When set, the (single) `publishReview` call throws this instead of succeeding. */
  publishReviewError?: unknown;
  /**
   * Calls named here never resolve on their own — only aborting the
   * `signal` passed to that call settles it (mirrors `createFakeModel`'s
   * `hangUntilAborted`). Used to prove the pass deadline now bounds the
   * GitHub phase, not only the model call.
   */
  hangUntilAbortedOn?: GithubCallName[];
}

interface FakeGithub {
  ops: GithubOperations;
  publishedReviews: PublishReviewInput[];
  publishedCheckRuns: PublishCheckRunInput[];
  /** Every `publishCheckRun` attempt, including ones that threw. */
  checkRunAttempts: PublishCheckRunInput[];
  /** The `signal` argument observed on each call to each method, in call order. */
  signalsSeen: Record<GithubCallName, Array<AbortSignal | undefined>>;
}

/**
 * Rejects with the same `GithubClientError` shape the real GitHub client
 * boundary (`withAbortMapping` in `src/github/github-client.ts`) raises when
 * a call is aborted mid-flight — not a bare `Error` — so tests that hang a
 * GitHub call until the deadline fires exercise `runReviewPass`'s
 * abort-classification path exactly the way the production client would.
 */
function hangUntilAbortedSignal(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (!signal) {
      return;
    }
    signal.addEventListener(
      "abort",
      () =>
        reject(
          new GithubClientError("timed_out", "GitHub request was aborted before it completed"),
        ),
      { once: true },
    );
  });
}

/**
 * Real `fetch`/Octokit calls reject synchronously when given a signal that
 * is *already* aborted before the call even starts (not only when it
 * aborts mid-flight). Mirroring that here means a deadline that fires
 * during one GitHub call also correctly short-circuits the *next* GitHub
 * call in the same pass, instead of that next fake silently ignoring an
 * already-aborted signal and letting the pass limp forward.
 */
function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new GithubClientError("timed_out", "GitHub request was aborted before it completed");
  }
}

function createFakeGithub(options: FakeGithubOptions): FakeGithub {
  const publishedReviews: PublishReviewInput[] = [];
  const publishedCheckRuns: PublishCheckRunInput[] = [];
  const checkRunAttempts: PublishCheckRunInput[] = [];
  const signalsSeen: Record<GithubCallName, Array<AbortSignal | undefined>> = {
    readPullRequest: [],
    readChangedFiles: [],
    findExistingCheckRun: [],
    publishReview: [],
    publishCheckRun: [],
  };
  const hangOn = new Set(options.hangUntilAbortedOn ?? []);
  let readCount = 0;
  let publishCheckRunCallCount = 0;

  const ops: GithubOperations = {
    async readPullRequest(_owner, _repo, _pullNumber, signal) {
      signalsSeen.readPullRequest.push(signal);
      throwIfAborted(signal);
      if (hangOn.has("readPullRequest")) {
        return hangUntilAbortedSignal(signal);
      }
      readCount += 1;
      if (readCount > 1 && options.supersedeOnReRead) {
        return { ...options.pullRequest, headSha: `${options.pullRequest.headSha}-moved` };
      }
      return options.pullRequest;
    },
    async readChangedFiles(_owner, _repo, _pullNumber, signal) {
      signalsSeen.readChangedFiles.push(signal);
      throwIfAborted(signal);
      if (hangOn.has("readChangedFiles")) {
        return hangUntilAbortedSignal(signal);
      }
      return options.changedFiles ?? [];
    },
    async findExistingCheckRun(_owner, _repo, _headSha, signal) {
      signalsSeen.findExistingCheckRun.push(signal);
      throwIfAborted(signal);
      if (hangOn.has("findExistingCheckRun")) {
        return hangUntilAbortedSignal(signal);
      }
      return options.existingCheckRunId ?? null;
    },
    async publishReview(input, signal) {
      signalsSeen.publishReview.push(signal);
      throwIfAborted(signal);
      if (options.publishReviewError !== undefined) {
        throw options.publishReviewError;
      }
      publishedReviews.push(input);
    },
    async publishCheckRun(input, signal) {
      signalsSeen.publishCheckRun.push(signal);
      throwIfAborted(signal);
      checkRunAttempts.push(input);
      publishCheckRunCallCount += 1;
      if (publishCheckRunCallCount <= (options.publishCheckRunFailTimes ?? 0)) {
        throw options.publishCheckRunError ?? new Error("simulated check-run publish failure");
      }
      publishedCheckRuns.push(input);
    },
  };

  return { ops, publishedReviews, publishedCheckRuns, checkRunAttempts, signalsSeen };
}

function createFakeModel(options: {
  modelName?: string;
  response?: string;
  error?: unknown;
  /** When true, `complete` never resolves on its own — only the abort signal settles it. */
  hangUntilAborted?: boolean;
}): { model: ModelClient; callCount: () => number } {
  let calls = 0;
  const model: ModelClient = {
    modelName: options.modelName ?? "fake-model",
    async complete(_request, signal) {
      calls += 1;
      if (options.hangUntilAborted) {
        return await new Promise<string>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => reject(new ModelClientError("timed_out", "aborted before completion")),
            { once: true },
          );
        });
      }
      if (options.error) {
        throw options.error;
      }
      return options.response ?? '{"findings":[]}';
    },
  };
  return { model, callCount: () => calls };
}

function createConfig(overrides: Partial<RondaConfig> = {}): RondaConfig {
  return {
    model: { apiKey: "test-key", baseUrl: "https://example.test/v1", modelName: "fake-model" },
    passTimeoutMs: 600_000,
    maxPatchChars: 400_000,
    ...overrides,
  };
}

function createLogger(): Logger {
  return { event: () => undefined };
}

function baseDeps(overrides: Partial<ReviewPassDeps> = {}): ReviewPassDeps {
  const { model } = createFakeModel({});
  return {
    github: createFakeGithub({ pullRequest: createPullRequest() }).ops,
    model,
    config: createConfig(),
    clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
    logger: createLogger(),
    ...overrides,
  };
}

const multiFindingResponse = JSON.stringify({
  findings: [
    { path: "src/a.ts", line: 2, severity: "blocking", title: "Bug", body: "Fix this" },
    { path: "src/b.ts", line: 5, severity: "important", title: "Improve", body: "Consider X" },
    { path: "src/a.ts", line: 99, severity: "nit", title: "Style", body: "nit pick" },
  ],
});

const changedFilesWithPatch: ChangedFile[] = [
  {
    path: "src/a.ts",
    status: "modified",
    additions: 2,
    deletions: 0,
    patch: "@@ -1,2 +1,2 @@\n context\n+added",
  },
  { path: "src/b.ts", status: "modified", additions: 1, deletions: 0 },
];

test("Scenario 1: a ready PR with findings publishes one review and one successful check run", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  const { model } = createFakeModel({ response: multiFindingResponse });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(github.publishedReviews.length, 1);
  assert.equal(github.publishedCheckRuns.length, 1);
  assert.equal(github.publishedCheckRuns[0].conclusion, "success");
});

test("Scenario 2: findings on a changed line are inline; others land in the summary; the total matches", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  const { model } = createFakeModel({ response: multiFindingResponse });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.findings.length, 3);
  assert.equal(github.publishedReviews[0].inlineComments.length, 1);
  assert.equal(github.publishedReviews[0].inlineComments[0].path, "src/a.ts");
  assert.equal(github.publishedReviews[0].inlineComments[0].line, 2);
  const summaryBulletCount = (github.publishedReviews[0].summaryBody.match(/^- \*\*/gm) ?? [])
    .length;
  assert.equal(summaryBulletCount, 2);
});

test("Scenario 3: each severity renders its display label with correct counts", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  const { model } = createFakeModel({ response: multiFindingResponse });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.outcome, "succeeded");
  const summary = github.publishedReviews[0].summaryBody;
  assert.match(summary, /Blocking \| 1/);
  assert.match(summary, /Important \| 1/);
  assert.match(summary, /Nit \| 1/);
});

test("Scenario 4: a pass with zero findings publishes a 'no findings' review and Review posted", async () => {
  const github = createFakeGithub({ pullRequest: createPullRequest() });
  const { model } = createFakeModel({ response: '{"findings":[]}' });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.match(github.publishedReviews[0].summaryBody, /No findings\./);
  assert.equal(github.publishedCheckRuns[0].title, "Review posted — no findings");
});

test("Scenario 5: a draft pull request publishes nothing, automatic or manual", async () => {
  for (const trigger of ["automatic", "manual"] as const) {
    const github = createFakeGithub({ pullRequest: createPullRequest({ draft: true }) });
    const { model, callCount } = createFakeModel({});

    const result = await runReviewPass(
      { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger },
      baseDeps({ github: github.ops, model }),
    );

    assert.equal(result.outcome, "skipped");
    assert.equal(result.skipReason, "draft_pull_request");
    assert.equal(github.publishedReviews.length, 0);
    assert.equal(github.publishedCheckRuns.length, 0);
    assert.equal(callCount(), 0);
  }
});

test("Scenario 6: a blank API key fails with credential_missing and publishes no review", async () => {
  const github = createFakeGithub({ pullRequest: createPullRequest() });
  const { model, callCount } = createFakeModel({});

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      config: createConfig({ model: { apiKey: "", baseUrl: "https://x.test", modelName: "m" } }),
    }),
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.failureReason, "credential_missing");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 1);
  assert.equal(github.publishedCheckRuns[0].conclusion, "failure");
  assert.equal(callCount(), 0);
});

test("Scenario 7: an expired deadline fails with timed_out and publishes only a check run", async () => {
  const github = createFakeGithub({ pullRequest: createPullRequest() });
  const { model } = createFakeModel({ hangUntilAborted: true });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      config: createConfig({ passTimeoutMs: 5 }),
      deadlineClock: createFastDeadlineClock(5),
    }),
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.failureReason, "timed_out");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 1);
  assert.equal(github.publishedCheckRuns[0].conclusion, "failure");
});

test("Scenario 8: a manual re-trigger on an already-reviewed commit updates the same check run", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    existingCheckRunId: 555,
  });
  const { model } = createFakeModel({ response: '{"findings":[]}' });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "manual" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(github.publishedReviews.length, 1);
  assert.match(github.publishedReviews[0].summaryBody, /Manually requested/);
  assert.equal(github.publishedCheckRuns.length, 1);
  assert.equal(github.publishedCheckRuns[0].existingCheckRunId, 555);
});

test("Scenario 9: a head SHA that moves before publication publishes neither a review nor a check run", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    supersedeOnReRead: true,
  });
  const { model } = createFakeModel({ response: '{"findings":[]}' });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.outcome, "skipped");
  assert.equal(result.skipReason, "superseded_head_sha");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 0);
});

test("Scenario 10: swapping the ModelClient produces the same summary shape naming the new model", async () => {
  for (const modelName of ["qwen-plus", "a-different-vendor-model"]) {
    const github = createFakeGithub({ pullRequest: createPullRequest() });
    const { model } = createFakeModel({ modelName, response: '{"findings":[]}' });

    const result = await runReviewPass(
      { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
      baseDeps({ github: github.ops, model }),
    );

    assert.equal(result.outcome, "succeeded");
    assert.match(github.publishedReviews[0].summaryBody, new RegExp(`Model: ${modelName}`));
    assert.equal(github.publishedCheckRuns[0].title, "Review posted — no findings");
  }
});

test("Scenario 11: a second automatic event on an already-reviewed head SHA publishes nothing", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    existingCheckRunId: 999,
  });
  const { model, callCount } = createFakeModel({});

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.outcome, "skipped");
  assert.equal(result.skipReason, "already_reviewed_automatically");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 0);
  assert.equal(callCount(), 0);
});

test("a malformed operator config file fails the pass with unexpected_error naming the message, not contents", async () => {
  const github = createFakeGithub({ pullRequest: createPullRequest() });
  const { model } = createFakeModel({});

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      config: createConfig({ loadError: "Failed to load Ronda config file at /tmp/x.json" }),
    }),
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.failureReason, "unexpected_error");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 1);
});

// --- Fix 1: a check-run write failure after a successful review must never
// be reported as a failed pass (the review is already public). ---

test("a check-run write that fails after a successful review is retried once and, on success, still reports succeeded", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    publishCheckRunFailTimes: 1,
  });
  const { model } = createFakeModel({ response: '{"findings":[]}' });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(github.publishedReviews.length, 1);
  assert.equal(github.checkRunAttempts.length, 2);
  assert.equal(github.publishedCheckRuns.length, 1);
  assert.equal(github.publishedCheckRuns[0].conclusion, "success");
});

test("a check-run write that keeps failing after a successful review rejects instead of publishing a contradictory 'Review failed' check run", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    publishCheckRunFailTimes: 2,
    publishCheckRunError: new Error("network blip"),
  });
  const { model } = createFakeModel({ response: '{"findings":[]}' });

  await assert.rejects(
    () =>
      runReviewPass(
        { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
        baseDeps({ github: github.ops, model }),
      ),
    /check run could not be published/,
  );

  // The review was already published and must not be contradicted: exactly
  // one review, and every check-run attempt used the "success" conclusion
  // — `finalizeFailure` (which would use "failure") was never reached.
  assert.equal(github.publishedReviews.length, 1);
  assert.equal(github.checkRunAttempts.length, 2);
  assert.equal(github.publishedCheckRuns.length, 0);
  assert.ok(github.checkRunAttempts.every((attempt) => attempt.conclusion === "success"));
});

// --- Fix 4: the pass deadline must bound the GitHub phase, not only the
// model call, while preserving the markPublishing guarantee (AC9) and the
// superseded-head-SHA guarantee (AC16). ---

test("a deadline that fires while findExistingCheckRun is in flight still ends the pass as timed_out, not a hang", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    hangUntilAbortedOn: ["findExistingCheckRun"],
  });
  const { model, callCount } = createFakeModel({});

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      config: createConfig({ passTimeoutMs: 5 }),
      deadlineClock: createFastDeadlineClock(5),
    }),
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.failureReason, "timed_out");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 1);
  assert.equal(github.publishedCheckRuns[0].conclusion, "failure");
  // The model was never reached — the pass died in the GitHub phase.
  assert.equal(callCount(), 0);
});

test("a deadline that fires while readChangedFiles is in flight still ends the pass as timed_out, not a hang", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    hangUntilAbortedOn: ["readChangedFiles"],
  });
  const { model, callCount } = createFakeModel({});

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      config: createConfig({ passTimeoutMs: 5 }),
      deadlineClock: createFastDeadlineClock(5),
    }),
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.failureReason, "timed_out");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 1);
  assert.equal(github.publishedCheckRuns[0].conclusion, "failure");
  assert.equal(callCount(), 0);
});

test("Gap 1: a deadline that fires while the very first readPullRequest is in flight classifies as timed_out instead of escaping as a fatal crash, and (no head SHA known) publishes no check run", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    hangUntilAbortedOn: ["readPullRequest"],
  });
  const { model } = createFakeModel({});

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      config: createConfig({ passTimeoutMs: 5 }),
      deadlineClock: createFastDeadlineClock(5),
    }),
  );

  // No head SHA is known from any source (readPullRequest never returned,
  // and the input carries none — this is the issue_comment-trigger shape),
  // so the pass degrades to a logged failure rather than a check-run write.
  assert.equal(result.outcome, "failed");
  assert.equal(result.failureReason, "timed_out");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 0);
});

test("Gap 1 degradation path: the same first-readPullRequest abort, given a headSha from the triggering pull_request event, publishes a Review failed check run against it", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    hangUntilAbortedOn: ["readPullRequest"],
  });
  const { model } = createFakeModel({});
  const eventHeadSha = "c".repeat(40);

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic", headSha: eventHeadSha },
    baseDeps({
      github: github.ops,
      model,
      config: createConfig({ passTimeoutMs: 5 }),
      deadlineClock: createFastDeadlineClock(5),
    }),
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.failureReason, "timed_out");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 1);
  assert.equal(github.publishedCheckRuns[0].headSha, eventHeadSha);
  assert.equal(github.publishedCheckRuns[0].conclusion, "failure");
});

test("Gap 2: findExistingCheckRun aborting fails fast (does not tolerate/continue) — same outcome as Gap 1's fix, now with a known head SHA from the successful first read", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    hangUntilAbortedOn: ["findExistingCheckRun"],
  });
  const { model, callCount } = createFakeModel({});

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      config: createConfig({ passTimeoutMs: 5 }),
      deadlineClock: createFastDeadlineClock(5),
    }),
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.failureReason, "timed_out");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 1);
  assert.equal(github.publishedCheckRuns[0].headSha, HEAD_SHA);
  assert.equal(github.publishedCheckRuns[0].conclusion, "failure");
  // The model was never reached — the lookup abort short-circuited the pass
  // instead of tolerating it and burning the rest of the (already expired)
  // budget on readChangedFiles/the model call.
  assert.equal(callCount(), 0);
});

test("Gap 2 contrast: a genuine non-abort findExistingCheckRun failure keeps the existing tolerant behaviour — the pass still proceeds and succeeds", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  github.ops.findExistingCheckRun = async () => {
    throw new Error("GitHub API returned HTTP 500");
  };
  const { model } = createFakeModel({ response: '{"findings":[]}' });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(github.publishedReviews.length, 1);
  assert.equal(github.publishedCheckRuns.length, 1);
  assert.equal(github.publishedCheckRuns[0].conclusion, "success");
});

// Note: once `markPublishing()` runs (synchronously, immediately before
// `publishReview`), the pass deadline's timer becomes a permanent no-op —
// that is the whole point of the guarantee (AC9). So `publishReview` and the
// terminal success `publishCheckRun` write can never actually observe *this
// pass's own* deadline aborting. The two tests below instead inject the
// `GithubClientError` that the GitHub client boundary (see
// `src/github/github-client.ts`'s `withAbortMapping`, unit-tested directly in
// `tests/unit/github/`) would raise if one of these calls were ever aborted
// by some other caller-supplied signal, proving `runReviewPass` classifies
// that error type correctly at each of these two call sites.

test("an abort classified at publishReview (before the review is public) is reported as timed_out, not folded into ReviewPublishError's unexpected_error", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
    publishReviewError: new GithubClientError(
      "timed_out",
      "GitHub request was aborted before it completed",
    ),
  });
  const { model } = createFakeModel({ response: '{"findings":[]}' });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.failureReason, "timed_out");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 1);
  assert.equal(github.publishedCheckRuns[0].headSha, HEAD_SHA);
  assert.equal(github.publishedCheckRuns[0].conclusion, "failure");
});

test("an abort classified at the terminal success publishCheckRun write still respects the markPublishing/reviewPublished guard — it rejects rather than reporting a contradictory failure", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
    publishCheckRunFailTimes: 2,
    publishCheckRunError: new GithubClientError(
      "timed_out",
      "GitHub request was aborted before it completed",
    ),
  });
  const { model } = createFakeModel({ response: '{"findings":[]}' });

  await assert.rejects(
    () =>
      runReviewPass(
        { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
        baseDeps({ github: github.ops, model }),
      ),
    /check run could not be published/,
  );

  // The review published cleanly; the check-run write is what "aborted".
  // The markPublishing guard means this must never surface as a "failed"
  // pass outcome with a contradictory "Review failed" check run, even
  // though the underlying error type is the same `GithubClientError` that
  // classifies as `timed_out` everywhere else in this pass.
  assert.equal(github.publishedReviews.length, 1);
  assert.equal(github.publishedCheckRuns.length, 0);
  assert.ok(github.checkRunAttempts.every((attempt) => attempt.conclusion === "success"));
});

test("the deadline's signal is threaded through every pre-publication GitHub call, as the same instance", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  const { model } = createFakeModel({ response: '{"findings":[]}' });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(github.signalsSeen.readPullRequest.length, 2);
  assert.ok(github.signalsSeen.readPullRequest[0] instanceof AbortSignal);
  assert.ok(github.signalsSeen.findExistingCheckRun[0] instanceof AbortSignal);
  assert.ok(github.signalsSeen.readChangedFiles[0] instanceof AbortSignal);
  assert.ok(github.signalsSeen.publishReview[0] instanceof AbortSignal);
  assert.ok(github.signalsSeen.publishCheckRun[0] instanceof AbortSignal);
  // One deadline per pass — every call shares the exact same signal.
  const allSignals = [
    ...github.signalsSeen.readPullRequest,
    ...github.signalsSeen.findExistingCheckRun,
    ...github.signalsSeen.readChangedFiles,
    ...github.signalsSeen.publishReview,
    ...github.signalsSeen.publishCheckRun,
  ];
  assert.ok(allSignals.every((signal) => signal === allSignals[0]));
});

test("AC9/markPublishing: a deadline that fires during publication (now that it also guards the GitHub phase) still produces a clean succeeded outcome, never a contradictory failure", async () => {
  let fireDeadline: (() => void) | undefined;
  const deadlineClock: DeadlineClock = {
    setTimeout: (callback) => {
      fireDeadline = callback;
      return {} as DeadlineTimerHandle;
    },
    clearTimeout: () => {
      fireDeadline = undefined;
    },
  };

  const github = createFakeGithub({ pullRequest: createPullRequest() });
  const originalPublishReview = github.ops.publishReview;
  github.ops.publishReview = async (input, signal) => {
    // Simulate the deadline timer firing exactly as publication starts —
    // the race `markPublishing` exists to neutralise — now exercised with
    // the same deadline that also guards the GitHub reads above it.
    fireDeadline?.();
    return originalPublishReview(input, signal);
  };

  const { model } = createFakeModel({ response: '{"findings":[]}' });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model, deadlineClock }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(github.publishedReviews.length, 1);
  assert.equal(github.publishedCheckRuns.length, 1);
  assert.equal(github.publishedCheckRuns[0].conclusion, "success");
});

test("AC16: a head SHA that moves before publication still publishes nothing, with the deadline signal threaded through every prior GitHub call", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    supersedeOnReRead: true,
  });
  const { model } = createFakeModel({ response: '{"findings":[]}' });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.outcome, "skipped");
  assert.equal(result.skipReason, "superseded_head_sha");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 0);
  // Both readPullRequest calls (initial + re-read) received the deadline's
  // signal; threading it through did not change the supersede outcome.
  assert.equal(github.signalsSeen.readPullRequest.length, 2);
  assert.ok(github.signalsSeen.readPullRequest[0] instanceof AbortSignal);
  assert.ok(github.signalsSeen.readPullRequest[1] instanceof AbortSignal);
});
