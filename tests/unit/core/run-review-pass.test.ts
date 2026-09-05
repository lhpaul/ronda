import { test } from "node:test";
import assert from "node:assert/strict";
import { runReviewPass } from "../../../src/core/run-review-pass.js";
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

interface FakeGithubOptions {
  pullRequest: PullRequestMetadata;
  changedFiles?: ChangedFile[];
  existingCheckRunId?: number | null;
  /** When true, the second `readPullRequest` call (the pre-publication re-read) reports a moved head SHA. */
  supersedeOnReRead?: boolean;
}

interface FakeGithub {
  ops: GithubOperations;
  publishedReviews: PublishReviewInput[];
  publishedCheckRuns: PublishCheckRunInput[];
}

function createFakeGithub(options: FakeGithubOptions): FakeGithub {
  const publishedReviews: PublishReviewInput[] = [];
  const publishedCheckRuns: PublishCheckRunInput[] = [];
  let readCount = 0;

  const ops: GithubOperations = {
    async readPullRequest() {
      readCount += 1;
      if (readCount > 1 && options.supersedeOnReRead) {
        return { ...options.pullRequest, headSha: `${options.pullRequest.headSha}-moved` };
      }
      return options.pullRequest;
    },
    async readChangedFiles() {
      return options.changedFiles ?? [];
    },
    async findExistingCheckRun() {
      return options.existingCheckRunId ?? null;
    },
    async publishReview(input) {
      publishedReviews.push(input);
    },
    async publishCheckRun(input) {
      publishedCheckRuns.push(input);
    },
  };

  return { ops, publishedReviews, publishedCheckRuns };
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
