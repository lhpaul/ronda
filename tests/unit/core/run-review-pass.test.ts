import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ReviewPublishedCheckRunError,
  runReviewPass,
} from "../../../src/core/run-review-pass.js";
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
import type { ModelClient, ModelCompletion } from "../../../src/inference/model-client.js";
import type { RondaConfig } from "../../../src/config/config.types.js";
import {
  DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
  DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
} from "../../../src/config/load-config.js";
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
    headBranch: "feature/test",
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
  readFileAtRef?: (
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ) => Promise<string | undefined>;
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
    async readFileAtRef(owner, repo, path, ref, signal) {
      throwIfAborted(signal);
      if (options.readFileAtRef) {
        return options.readFileAtRef(owner, repo, path, ref);
      }
      return undefined;
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
    async complete(_request, signal): Promise<ModelCompletion> {
      calls += 1;
      if (options.hangUntilAborted) {
        return await new Promise<ModelCompletion>((_resolve, reject) => {
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
      return { content: options.response ?? '{"findings":[]}' };
    },
  };
  return { model, callCount: () => calls };
}

function createConfig(overrides: Partial<RondaConfig> = {}): RondaConfig {
  return {
    model: { apiKey: "test-key", baseUrl: "https://example.test/v1", modelName: "fake-model" },
    passTimeoutMs: 600_000,
    maxPatchChars: 400_000,
    maxAuthoritativeDocCount: DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
    maxAuthoritativeDocChars: DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
    durabilityMode: "default",
    durabilityModeDefault: false,
    sweepMode: "off",
    sweepModeRaw: undefined,
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

test("onReviewPublished runs after review publication and before check-run publication", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  const { model } = createFakeModel({ response: multiFindingResponse });
  const events: string[] = [];
  let recoveryInput: PublishCheckRunInput | undefined;

  github.ops.publishReview = async (input) => {
    events.push("publishReview");
    github.publishedReviews.push(input);
  };
  github.ops.publishCheckRun = async (input) => {
    events.push("publishCheckRun");
    github.checkRunAttempts.push(input);
    github.publishedCheckRuns.push(input);
  };

  await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      onReviewPublished: (checkRunInput) => {
        events.push("onReviewPublished");
        recoveryInput = checkRunInput;
      },
    }),
  );

  assert.deepEqual(events, ["publishReview", "onReviewPublished", "publishCheckRun"]);
  assert.equal(recoveryInput?.headSha, HEAD_SHA);
  assert.equal(github.publishedCheckRuns[0], recoveryInput);
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
    ReviewPublishedCheckRunError,
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
  assert.equal(result.terminalCheckRunPublished, false);
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
  assert.equal(result.terminalCheckRunPublished, true);
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
    ReviewPublishedCheckRunError,
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

test("authoritative docs: webhook changes fetch catalog files and attach them to the model prompt", async () => {
  const { FAKE_AUTHORITATIVE_DOC_CONTENT_BY_PATH } = await import(
    "../../support/fake-authoritative-docs.js"
  );
  let lastUserPrompt = "";
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: [
      {
        path: "src/webhook/webhook-server.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "+// webhook tweak",
      },
    ],
    readFileAtRef: async (_owner, _repo, path) => FAKE_AUTHORITATIVE_DOC_CONTENT_BY_PATH[path],
  });
  const { model } = createFakeModel({
    response: '{"findings":[]}',
  });
  const originalComplete = model.complete.bind(model);
  model.complete = async (request, signal) => {
    lastUserPrompt = request.userPrompt;
    return originalComplete(request, signal);
  };

  const logEvents: Array<{ name: string; fields: Record<string, unknown> }> = [];
  const logger: Logger = {
    event(name, fields) {
      logEvents.push({ name, fields });
    },
  };

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model, logger }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.match(lastUserPrompt, /### \[binding\] docs\/constitution\.md/);
  assert.ok(logEvents.some((entry) => entry.name === "authoritative_docs_selection"));
});

test("authoritative docs: irrelevant paths stay diff-only without doc fetch errors", async () => {
  let readFileCalls = 0;
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: [
      {
        path: "src/domain/severity.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "+// noop",
      },
    ],
    readFileAtRef: async () => {
      readFileCalls += 1;
      return "should-not-happen";
    },
  });
  let lastUserPrompt = "";
  const { model } = createFakeModel({ response: '{"findings":[]}' });
  const originalComplete = model.complete.bind(model);
  model.complete = async (request, signal) => {
    lastUserPrompt = request.userPrompt;
    return originalComplete(request, signal);
  };

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(readFileCalls, 0);
  assert.doesNotMatch(lastUserPrompt, /Authoritative repository documentation/);
});

interface LogEvent {
  name: string;
  fields: Record<string, unknown>;
}

function createRecordingLogger(events: LogEvent[]): Logger {
  return {
    event(name, fields) {
      events.push({ name, fields });
    },
  };
}

function sweepEvents(events: LogEvent[]): LogEvent[] {
  return events.filter(
    (entry) => entry.name === "sweep_pass_record" || entry.name.startsWith("sweep"),
  );
}

const sweepRecord = {
  version: "sweep-categories-v1",
  categories: [
    {
      identifier: "unbounded-retry",
      displayLabel: "Unbounded retry",
      description: "A retry loop with no bound.",
      failureShape: "The loop never terminates.",
      evidenceSource: "PR #1",
      findingInstanceCount: 2,
      matchTerms: ["bug"],
    },
    {
      identifier: "silent-swallow",
      displayLabel: "Silent swallow",
      description: "An error swallowed without a record.",
      failureShape: "No log line.",
      evidenceSource: "PR #2",
      findingInstanceCount: 1,
      // Matches nothing in the fixture responses below.
      matchTerms: ["never-matches-anything"],
    },
  ],
};

function loadValidSweepList(): () => Promise<{ ok: true; list: typeof sweepRecord }> {
  return async () => ({ ok: true, list: sweepRecord });
}

test("sweep AC1: an enabled pass with a valid list records the per-category outcome on both surfaces", async () => {
  const events: LogEvent[] = [];
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  const { model } = createFakeModel({ response: multiFindingResponse });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      logger: createRecordingLogger(events),
      config: createConfig({ sweepMode: "on" }),
      loadSweepList: loadValidSweepList(),
    }),
  );

  assert.equal(result.outcome, "succeeded");
  // One review published, as an enabled pass must still publish.
  assert.equal(github.publishedReviews.length, 1);
  // The record names the list version and every category's outcome: matched
  // by the "bug" term, and unmatched by the term nothing carries.
  assert.deepEqual(result.sweep?.record?.categories, [
    { identifier: "unbounded-retry", outcome: "produced_findings" },
    { identifier: "silent-swallow", outcome: "produced_none" },
  ]);
  // Attribution is per published finding, by publication index — never the
  // finding's own text.
  assert.deepEqual(result.sweep?.record?.findings, [
    { publicationIndex: 0, categories: ["unbounded-retry"] },
    { publicationIndex: 1, categories: [] },
    { publicationIndex: 2, categories: [] },
  ]);
  assert.equal(result.sweep?.record?.uncategorizedFindingCount, 2);
  assert.equal(result.sweep?.degraded, undefined);

  // Both surfaces carry it: the check-run output and the logs.
  const checkRun = github.publishedCheckRuns[0];
  assert.match(checkRun.summary, /Category-forced sweep:/);
  assert.match(checkRun.summary, /- unbounded-retry: produced_findings/);
  assert.match(checkRun.summary, /- silent-swallow: produced_none/);
  assert.match(checkRun.summary, /Uncategorized findings: 2/);
  const logged = events.find((entry) => entry.name === "sweep_pass_record");
  assert.ok(logged, "the per-category record is logged");
  assert.equal(logged.fields.listVersion, "sweep-categories-v1");
  // The log line carries identifiers and indexes, never finding text.
  const serialized = JSON.stringify(logged.fields);
  assert.doesNotMatch(serialized, /Fix this/);
  assert.doesNotMatch(serialized, /nit pick/);

  // AC3: the published body states only that the sweep ran and its version.
  const review = github.publishedReviews[0];
  assert.match(review.summaryBody, /Category list version: `sweep-categories-v1`/);
  assert.doesNotMatch(review.summaryBody, /unbounded-retry/);
  assert.doesNotMatch(review.summaryBody, /Unbounded retry/);
});

test("sweep AC19: an enabled pass with a malformed list publishes normally and records sweep-did-not-run on both surfaces", async () => {
  const events: LogEvent[] = [];
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  const { model } = createFakeModel({ response: multiFindingResponse });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      logger: createRecordingLogger(events),
      config: createConfig({ sweepMode: "on" }),
      loadSweepList: async () => ({
        ok: false,
        reason: "malformed",
        detail: "categories[0].matchTerms must be a non-empty array",
      }),
    }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(github.publishedReviews.length, 1);
  assert.deepEqual(result.sweep, {
    degraded: {
      kind: "sweep-did-not-run",
      reason: "malformed",
      detail: "categories[0].matchTerms must be a non-empty array",
    },
  });
  assert.equal(result.sweep?.record, undefined);
  // No list version is reported as used: the pass used none.
  assert.doesNotMatch(github.publishedReviews[0].summaryBody, /Category list version/);
  assert.doesNotMatch(github.publishedCheckRuns[0].summary, /Category list version/);
  assert.match(github.publishedCheckRuns[0].summary, /Category-forced sweep: sweep-did-not-run/);
  assert.match(github.publishedCheckRuns[0].summary, /Reason: malformed/);
  const logged = events.find((entry) => entry.name === "sweep-did-not-run");
  assert.ok(logged, "the degraded record is logged");
  assert.equal(logged.fields.reason, "malformed");
});

test("sweep AC19: a list loader that throws degrades to an unreadable record instead of failing the pass", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  const { model } = createFakeModel({ response: multiFindingResponse });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      config: createConfig({ sweepMode: "on" }),
      loadSweepList: async () => {
        throw new Error("the loader threw");
      },
    }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(result.sweep, {
    degraded: {
      kind: "sweep-did-not-run",
      reason: "unreadable",
      detail: "the list loader threw before returning a result",
    },
  });
});

test("sweep AC19: a thrown loader error's own text reaches no surface", async () => {
  const events: LogEvent[] = [];
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  const { model } = createFakeModel({ response: multiFindingResponse });
  await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      logger: createRecordingLogger(events),
      config: createConfig({ sweepMode: "on" }),
      loadSweepList: async () => {
        throw new Error("loader exploded at /home/operator/private/list.json");
      },
    }),
  );

  // The error's text can carry a local path, so it is never copied into the
  // record: not the check run, not the review, not any log field.
  for (const surface of [
    github.publishedCheckRuns[0].summary,
    github.publishedReviews[0].summaryBody,
    JSON.stringify(events),
  ]) {
    assert.doesNotMatch(surface, /operator|exploded/);
  }
});

test("sweep AC18: an unrecognized enablement value reviews without the sweep and records the fact, never the value", async () => {
  const events: LogEvent[] = [];
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  const { model } = createFakeModel({ response: multiFindingResponse });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      logger: createRecordingLogger(events),
      config: createConfig({ sweepMode: "off", sweepModeRaw: "sometime" }),
      loadSweepList: async () => {
        throw new Error("the list must never load when enablement is unrecognized");
      },
    }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(github.publishedReviews.length, 1);
  assert.deepEqual(result.sweep, { degraded: { kind: "sweep_enablement_unrecognized" } });
  assert.match(
    github.publishedCheckRuns[0].summary,
    /Category-forced sweep: an unrecognized enablement value was supplied; no sweep ran\./,
  );
  // The review body never carries a degraded state at all.
  assert.doesNotMatch(github.publishedReviews[0].summaryBody, /Category-forced sweep/);
  // The raw operator value appears on no surface: not the check run, not the
  // review, not any log field.
  for (const surface of [
    github.publishedCheckRuns[0].summary,
    github.publishedReviews[0].summaryBody,
    JSON.stringify(events),
  ]) {
    assert.doesNotMatch(surface, /sometime/);
  }
  assert.ok(events.some((entry) => entry.name === "sweep_enablement_unrecognized"));
});

test("sweep AC1: a failure after the list load but before the review request emits no sweep metadata at all", async () => {
  // The authoritative-doc fetch runs after the list load and before
  // `deps.model.complete`, so throwing there lands exactly in the window AC1
  // says owes nothing: this pass never issued a review request.
  const events: LogEvent[] = [];
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: [
      {
        path: "src/webhook/webhook-server.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "+// webhook tweak",
      },
    ],
    readFileAtRef: async () => {
      throw new Error("authoritative doc fetch failed");
    },
  });
  const { model } = createFakeModel({ response: multiFindingResponse });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      logger: createRecordingLogger(events),
      config: createConfig({ sweepMode: "on" }),
      loadSweepList: loadValidSweepList(),
    }),
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.sweep, undefined);
  assert.deepEqual(sweepEvents(events), []);
  assert.doesNotMatch(github.publishedCheckRuns[0].summary, /Category-forced sweep/);

  // Byte for byte the same as the identical failure with the sweep off: this
  // pass owes no sweep metadata, so nothing about it may differ from a
  // pre-feature run.
  const withoutSweepEvents: LogEvent[] = [];
  const withoutSweepGithub = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: [
      {
        path: "src/webhook/webhook-server.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "+// webhook tweak",
      },
    ],
    readFileAtRef: async () => {
      throw new Error("authoritative doc fetch failed");
    },
  });
  const withoutSweep = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: withoutSweepGithub.ops,
      model: createFakeModel({ response: multiFindingResponse }).model,
      logger: createRecordingLogger(withoutSweepEvents),
      config: createConfig({ sweepMode: "off", sweepModeRaw: undefined }),
    }),
  );
  assert.equal(withoutSweep.outcome, "failed");
  assert.equal(
    github.publishedCheckRuns[0].summary,
    withoutSweepGithub.publishedCheckRuns[0].summary,
  );
  assert.equal(github.publishedCheckRuns[0].title, withoutSweepGithub.publishedCheckRuns[0].title);
  assert.deepEqual(sweepEvents(withoutSweepEvents), []);
});

test("sweep AC1: a degraded pass that dies before the review request also emits nothing", async () => {
  // Same window, unrecognized-enablement branch: the degraded record is held
  // pending and must not be emitted for a pass that never issued its request.
  const events: LogEvent[] = [];
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: [
      {
        path: "src/webhook/webhook-server.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "+// webhook tweak",
      },
    ],
    readFileAtRef: async () => {
      throw new Error("authoritative doc fetch failed");
    },
  });
  const { model } = createFakeModel({ response: multiFindingResponse });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      logger: createRecordingLogger(events),
      config: createConfig({ sweepMode: "off", sweepModeRaw: "sometime" }),
    }),
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.sweep, undefined);
  assert.deepEqual(sweepEvents(events), []);
});

test("sweep AC1: a failure with no finding result records not_determined on the logs only", async () => {
  const events: LogEvent[] = [];
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  const { model } = createFakeModel({
    error: new ModelClientError("model_unavailable", "model is down"),
  });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      logger: createRecordingLogger(events),
      config: createConfig({ sweepMode: "on" }),
      loadSweepList: loadValidSweepList(),
    }),
  );

  assert.equal(result.outcome, "failed");
  assert.equal(result.failureReason, "model_unavailable");
  // The check run is the failure check run, whose outcome is not a review, so
  // the record is logs-only (AC1).
  assert.doesNotMatch(github.publishedCheckRuns[0].summary, /Category-forced sweep/);
  const logged = events.find((entry) => entry.name === "sweep_pass_record");
  assert.ok(logged);
  assert.deepEqual(logged.fields.categories, [
    { identifier: "unbounded-retry", outcome: "not_determined" },
    { identifier: "silent-swallow", outcome: "not_determined" },
  ]);
});

test("sweep AC1: a failure after the response is parsed but before publication keeps the ordinary outcomes", async () => {
  // The request went out and the response classified, so the pass reached
  // every category it carried. It fails before publication, so the record is
  // logs-only — but the outcomes are the ordinary ones, not `not_determined`.
  const events: LogEvent[] = [];
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
    publishReviewError: new Error("publication exploded"),
  });
  const { model } = createFakeModel({ response: multiFindingResponse });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      logger: createRecordingLogger(events),
      config: createConfig({ sweepMode: "on" }),
      loadSweepList: loadValidSweepList(),
    }),
  );

  assert.equal(result.outcome, "failed");
  const logged = events.find((entry) => entry.name === "sweep_pass_record");
  assert.ok(logged);
  assert.deepEqual(logged.fields.categories, [
    { identifier: "unbounded-retry", outcome: "produced_findings" },
    { identifier: "silent-swallow", outcome: "produced_none" },
  ]);
  assert.doesNotMatch(github.publishedCheckRuns[0].summary, /Category-forced sweep/);
});

test("sweep AC1: a superseded pass logs its per-category record and publishes nothing", async () => {
  const events: LogEvent[] = [];
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
    supersedeOnReRead: true,
  });
  const { model } = createFakeModel({ response: multiFindingResponse });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      logger: createRecordingLogger(events),
      config: createConfig({ sweepMode: "on" }),
      loadSweepList: loadValidSweepList(),
    }),
  );

  assert.equal(result.outcome, "skipped");
  assert.equal(result.skipReason, "superseded_head_sha");
  assert.equal(github.publishedReviews.length, 0);
  assert.equal(github.publishedCheckRuns.length, 0);
  const logged = events.find((entry) => entry.name === "sweep_pass_record");
  assert.ok(logged, "a superseded pass still owes its record");
  assert.equal(logged.fields.headSha, HEAD_SHA);
  assert.deepEqual(result.sweep?.record?.categories, [
    { identifier: "unbounded-retry", outcome: "produced_findings" },
    { identifier: "silent-swallow", outcome: "produced_none" },
  ]);
});

test("sweep AC1: a pre-review skip emits no sweep metadata of any kind", async () => {
  const events: LogEvent[] = [];
  const github = createFakeGithub({
    pullRequest: createPullRequest({ draft: true }),
    changedFiles: changedFilesWithPatch,
  });
  const { model } = createFakeModel({ response: multiFindingResponse });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      logger: createRecordingLogger(events),
      config: createConfig({ sweepMode: "on" }),
      loadSweepList: loadValidSweepList(),
    }),
  );

  assert.equal(result.outcome, "skipped");
  assert.equal(result.skipReason, "draft_pull_request");
  assert.equal(result.sweep, undefined);
  assert.deepEqual(sweepEvents(events), []);
});

test("sweep AC1: an already-reviewed automatic skip emits no sweep metadata of any kind", async () => {
  const events: LogEvent[] = [];
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
    existingCheckRunId: 42,
  });
  const { model } = createFakeModel({ response: multiFindingResponse });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      logger: createRecordingLogger(events),
      config: createConfig({ sweepMode: "on" }),
      loadSweepList: loadValidSweepList(),
    }),
  );

  assert.equal(result.outcome, "skipped");
  assert.equal(result.skipReason, "already_reviewed_automatically");
  assert.equal(result.sweep, undefined);
  assert.deepEqual(sweepEvents(events), []);
  assert.equal(github.publishedCheckRuns.length, 0);
});

test("sweep AC1: a sweep-off pass emits no sweep metadata and no sweep prompt section", async () => {
  const events: LogEvent[] = [];
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: changedFilesWithPatch,
  });
  let lastUserPrompt = "";
  const { model } = createFakeModel({ response: multiFindingResponse });
  const originalComplete = model.complete.bind(model);
  model.complete = async (request, signal) => {
    lastUserPrompt = request.userPrompt;
    return originalComplete(request, signal);
  };
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({
      github: github.ops,
      model,
      logger: createRecordingLogger(events),
      config: createConfig({ sweepMode: "off", sweepModeRaw: undefined }),
    }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.sweep, undefined);
  assert.deepEqual(sweepEvents(events), []);
  assert.doesNotMatch(github.publishedCheckRuns[0].summary, /Category-forced sweep/);
  assert.doesNotMatch(github.publishedReviews[0].summaryBody, /Category-forced sweep/);
  assert.doesNotMatch(lastUserPrompt, /Category-forced sweep/);
});

test("authoritative docs: missing catalog file content still completes the pass", async () => {
  const github = createFakeGithub({
    pullRequest: createPullRequest(),
    changedFiles: [
      {
        path: "src/config/load-config.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "+// config tweak",
      },
    ],
    readFileAtRef: async (_owner, _repo, path) =>
      path === "docs/constitution.md" ? "Binding rules." : undefined,
  });
  const logEvents: Array<{ name: string; fields: Record<string, unknown> }> = [];
  const logger: Logger = {
    event(name, fields) {
      logEvents.push({ name, fields });
    },
  };
  const { model } = createFakeModel({ response: '{"findings":[]}' });

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    baseDeps({ github: github.ops, model, logger }),
  );

  assert.equal(result.outcome, "succeeded");
  assert.ok(logEvents.some((entry) => entry.name === "authoritative_doc_skipped"));
});
