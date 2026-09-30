import { test } from "node:test";
import assert from "node:assert/strict";
import { runReviewPass } from "../../../src/core/run-review-pass.js";
import type {
  ChangedFile,
  GithubOperations,
  Logger,
  PublishCheckRunInput,
  PublishReviewInput,
  PullRequestMetadata,
} from "../../../src/domain/review-pass.types.js";
import type { ModelClient, ModelCompletion } from "../../../src/inference/model-client.js";
import type { ReviewPrompt } from "../../../src/inference/review-prompt.js";
import type { RondaConfig } from "../../../src/config/config.types.js";
import {
  DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
  DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS,
  DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
} from "../../../src/config/load-config.js";

// #134: review path-exclusion end to end through `runReviewPass` — proves the
// excluded content never reaches the model prompt, a real defect in a
// non-excluded file is still reported, and an all-excluded PR's published
// summary states the exclusion rather than looking like a clean review.

const HEAD_SHA = "b".repeat(40);

function createPullRequest(): PullRequestMetadata {
  return {
    number: 7,
    title: "Commit sweep campaign evidence",
    body: "Description",
    draft: false,
    headSha: HEAD_SHA,
    headBranch: "feature/evidence",
    headRepoFullName: "lhpaul/ronda",
  };
}

function createFakeGithub(changedFiles: ChangedFile[]): {
  ops: GithubOperations;
  publishedReviews: PublishReviewInput[];
  publishedCheckRuns: PublishCheckRunInput[];
} {
  const publishedReviews: PublishReviewInput[] = [];
  const publishedCheckRuns: PublishCheckRunInput[] = [];
  const ops: GithubOperations = {
    async readPullRequest() {
      return createPullRequest();
    },
    async readChangedFiles() {
      return changedFiles;
    },
    async readFileAtRef() {
      return undefined;
    },
    async findExistingCheckRun() {
      return null;
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

function createFakeModel(response: string): { model: ModelClient; requests: ReviewPrompt[] } {
  const requests: ReviewPrompt[] = [];
  const model: ModelClient = {
    modelName: "fake-model",
    async complete(request): Promise<ModelCompletion> {
      requests.push(request);
      return { content: response };
    },
  };
  return { model, requests };
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
    repositoryContextMode: "off",
    repositoryContextModeRaw: undefined,
    maxRepositoryContextCandidates: DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES,
    maxRepositoryContextChars: DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS,
    repositoryContextTimeBudgetMs: DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
    repositoryContextBudgetFallbacks: [],
    excludePathGlobs: [],
    ...overrides,
  };
}

function createLogger(): Logger {
  return { event: () => undefined };
}

const EXCLUDED_EVIDENCE_FILE: ChangedFile = {
  path: "docs/testing/ronda/sweep-on-precision.json",
  status: "added",
  additions: 400,
  deletions: 0,
  // The seeded recall-benchmark fixture text a real evidence file carries —
  // the exact content this issue exists to keep out of the model prompt.
  patch:
    '@@ -0,0 +1,3 @@\n+{"seeded_defect":"Hardcoded sensitive credential exposed in logging","planted_text":"const API_SECRET = \'sk-planted-credential-do-not-flag\';"}',
};

const REAL_DEFECT_FILE: ChangedFile = {
  path: "src/core/example-inverted-check.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: "@@ -10,1 +10,1 @@\n-if (session.expiresAt > now) {\n+if (session.expiresAt < now) {",
};

const findingOnRealDefectFile = JSON.stringify({
  findings: [
    {
      path: "src/core/example-inverted-check.ts",
      line: 10,
      severity: "blocking",
      title: "Inverted session-expiry check",
      body: "The comparison operator is inverted; expired sessions are treated as valid.",
    },
  ],
});

test("path exclusion: a real defect in a non-excluded .ts file is still reported alongside excluded evidence — isolating proof", async () => {
  const github = createFakeGithub([EXCLUDED_EVIDENCE_FILE, REAL_DEFECT_FILE]);
  const { model, requests } = createFakeModel(findingOnRealDefectFile);

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github: github.ops,
      model,
      config: createConfig({
        excludePathGlobs: ["docs/testing/ronda/**/*.json"],
      }),
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger: createLogger(),
    },
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].path, "src/core/example-inverted-check.ts");

  // The isolating half: without the exclusion configured, the excluded
  // file's planted text would reach the prompt. With it configured, it must
  // not.
  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0].userPrompt, /sk-planted-credential-do-not-flag/);
  assert.match(requests[0].userPrompt, /example-inverted-check\.ts/);

  const summary = github.publishedReviews[0].summaryBody;
  assert.match(summary, /### Excluded from review/);
  assert.match(summary, /1 file\(s\) excluded before review/);
  assert.match(summary, /sweep-on-precision\.json/);
});

test("path exclusion: without the exclusion configured, the planted text reaches the prompt — the isolating negative", async () => {
  const github = createFakeGithub([EXCLUDED_EVIDENCE_FILE, REAL_DEFECT_FILE]);
  const { model, requests } = createFakeModel(findingOnRealDefectFile);

  await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github: github.ops,
      model,
      config: createConfig({ excludePathGlobs: [] }),
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger: createLogger(),
    },
  );

  assert.equal(requests.length, 1);
  assert.match(requests[0].userPrompt, /sk-planted-credential-do-not-flag/);
});

test("path exclusion: a PR whose every changed file is excluded publishes a summary saying so, not a clean review", async () => {
  const github = createFakeGithub([EXCLUDED_EVIDENCE_FILE]);
  const { model, requests } = createFakeModel('{"findings":[]}');

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github: github.ops,
      model,
      config: createConfig({ excludePathGlobs: ["docs/testing/ronda/**/*.json"] }),
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger: createLogger(),
    },
  );

  assert.equal(result.outcome, "succeeded");
  // The model is still called (with an empty changed-file section) — the
  // pass still owes a terminal outcome — but its request carries none of the
  // excluded file's content.
  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0].userPrompt, /sk-planted-credential-do-not-flag/);

  const summary = github.publishedReviews[0].summaryBody;
  assert.match(summary, /Every changed file was excluded from review/);
  assert.doesNotMatch(summary, /^No findings\.$/m);
  assert.match(summary, /### Excluded from review/);
  assert.match(summary, /1 file\(s\) excluded before review/);
});

test("path exclusion: findings returned by the model are discarded when every changed file is excluded", async () => {
  const github = createFakeGithub([EXCLUDED_EVIDENCE_FILE]);
  // A valid-looking finding on a path outside the (empty) included set — the
  // shape a hallucination or an injection in the PR text could produce.
  const { model } = createFakeModel(findingOnRealDefectFile);

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github: github.ops,
      model,
      config: createConfig({ excludePathGlobs: ["docs/testing/ronda/**/*.json"] }),
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger: createLogger(),
    },
  );

  assert.equal(result.outcome, "succeeded");
  const published = github.publishedReviews[0];
  assert.equal(published.inlineComments.length, 0);
  assert.match(published.summaryBody, /Every changed file was excluded from review/);
  assert.doesNotMatch(published.summaryBody, /Inverted session-expiry check/);
});

test("path exclusion: a model finding targeting an excluded path is discarded even when other files remain included", async () => {
  const github = createFakeGithub([EXCLUDED_EVIDENCE_FILE, REAL_DEFECT_FILE]);
  const { model } = createFakeModel(
    JSON.stringify({
      findings: [
        {
          path: EXCLUDED_EVIDENCE_FILE.path,
          line: null,
          severity: "blocking",
          title: "Hardcoded credential in evidence record",
          body: "The recorded evidence contains a credential.",
        },
        ...JSON.parse(findingOnRealDefectFile).findings,
      ],
    }),
  );

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github: github.ops,
      model,
      config: createConfig({ excludePathGlobs: ["docs/testing/ronda/**/*.json"] }),
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger: createLogger(),
    },
  );

  assert.equal(result.outcome, "succeeded");
  const published = github.publishedReviews[0];
  assert.doesNotMatch(published.summaryBody, /Hardcoded credential in evidence record/);
  assert.equal(published.inlineComments.length, 1);
  assert.equal(published.inlineComments[0].path, REAL_DEFECT_FILE.path);
});

test("path exclusion: default lockfile exclusion applies even with no repository-configured globs", async () => {
  const lockfile: ChangedFile = {
    path: "package-lock.json",
    status: "modified",
    additions: 50,
    deletions: 10,
    patch: "@@ -1,1 +1,1 @@\n-old\n+new",
  };
  const github = createFakeGithub([lockfile, REAL_DEFECT_FILE]);
  const { model, requests } = createFakeModel(findingOnRealDefectFile);

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github: github.ops,
      model,
      config: createConfig(),
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger: createLogger(),
    },
  );

  assert.equal(result.outcome, "succeeded");
  assert.doesNotMatch(requests[0].userPrompt, /### package-lock\.json/);
  assert.match(requests[0].userPrompt, /example-inverted-check\.ts/);
  assert.match(github.publishedReviews[0].summaryBody, /package-lock\.json/);
});
