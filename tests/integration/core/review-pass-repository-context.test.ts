import { test } from "node:test";
import assert from "node:assert/strict";
import { runReviewPass } from "../../../src/core/run-review-pass.js";
import { RepositoryFileUnusableError } from "../../../src/github/repo-content-reader.js";
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
} from "../../../src/domain/review-pass.types.js";
import type { ModelClient } from "../../../src/inference/model-client.js";
import type { RondaConfig } from "../../../src/config/config.types.js";

const HEAD_SHA = "a".repeat(40);

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
  // A minimal one-hunk patch whose right-side lines are exactly `patchedLines`.
  const body = patchedLines.map(() => "+line").join("\n");
  return {
    path,
    status: "modified",
    additions: patchedLines.length,
    deletions: 0,
    patch: `@@ -1,0 +${patchedLines[0]},${patchedLines.length} @@\n${body}`,
  };
}

interface FakeGithubInput {
  pullRequest: PullRequestMetadata;
  changedFiles: ChangedFile[];
  repoFiles?: Map<string, string>;
  unusablePaths?: Set<string>;
  transientFailurePaths?: Set<string>;
}

function createFakeGithub(input: FakeGithubInput): {
  ops: GithubOperations;
  publishedReviews: PublishReviewInput[];
  publishedCheckRuns: PublishCheckRunInput[];
} {
  const publishedReviews: PublishReviewInput[] = [];
  const publishedCheckRuns: PublishCheckRunInput[] = [];
  const ops: GithubOperations = {
    async readPullRequest() {
      return input.pullRequest;
    },
    async readChangedFiles() {
      return input.changedFiles;
    },
    async readFileAtRef(_owner, _repo, path, _ref, _signal, options) {
      if (input.transientFailurePaths?.has(path)) {
        throw new Error("transient 503");
      }
      if (input.unusablePaths?.has(path)) {
        if (options?.failOnUnusable) {
          throw new RepositoryFileUnusableError(path, "type:symlink");
        }
        return undefined;
      }
      return input.repoFiles?.get(path);
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

function createFakeModel(): ModelClient {
  return {
    modelName: "fake-model",
    async complete() {
      return { content: JSON.stringify({ findings: [] }) };
    },
  };
}

function createLogger(): { logger: Logger; events: Array<{ name: string; fields: Record<string, unknown> }> } {
  const events: Array<{ name: string; fields: Record<string, unknown> }> = [];
  return { logger: { event: (name, fields) => events.push({ name, fields }) }, events };
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
    maxRepositoryContextCandidates: 12,
    maxRepositoryContextChars: 24_000,
    repositoryContextTimeBudgetMs: 120_000,
    repositoryContextBudgetFallbacks: [],
    ...overrides,
  };
}

function deps(github: GithubOperations, config: RondaConfig): ReviewPassDeps {
  const { logger } = createLogger();
  return {
    github,
    model: createFakeModel(),
    config,
    clock: { now: () => 0, isoNow: () => "2026-01-01T00:00:00.000Z" },
    logger,
  };
}

const CALLER_TEXT = ['import { helper } from "./util.js";', "", "export function run(): number {", "  return helper(1);", "}"].join(
  "\n",
);
const UTIL_TEXT = "export function helper(x: number): number {\n  return x + 1;\n}\n";

// --- Scenario 3: outcome ordering, end to end -----------------------------

test("fork_excluded: a fork-originated head reads no repository context at the most permissive configuration", async () => {
  const changed = [changedFile("src/caller.ts", [4])];
  const github = createFakeGithub({
    pullRequest: pullRequest({ headRepoFullName: "someone-else/ronda" }),
    changedFiles: changed,
    repoFiles: new Map([
      ["src/caller.ts", CALLER_TEXT],
      ["src/util.ts", UTIL_TEXT],
    ]),
  });
  const config = createConfig({
    repositoryContextMode: "on",
    maxRepositoryContextCandidates: 1_000,
    maxRepositoryContextChars: 1_000_000,
    repositoryContextTimeBudgetMs: 600_000,
  });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(github.ops, config),
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.repositoryContext, undefined);
});

test("off: a validly disabled switch emits no repository-context record", async () => {
  const changed = [changedFile("src/caller.ts", [4])];
  const github = createFakeGithub({
    pullRequest: pullRequest(),
    changedFiles: changed,
    repoFiles: new Map([
      ["src/caller.ts", CALLER_TEXT],
      ["src/util.ts", UTIL_TEXT],
    ]),
  });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(github.ops, createConfig({ repositoryContextMode: "off" })),
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.repositoryContext, undefined);
});

test("not_applicable: a draft pull request never reaches the repository-context phase", async () => {
  const github = createFakeGithub({ pullRequest: pullRequest({ draft: true }), changedFiles: [] });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(github.ops, createConfig({ repositoryContextMode: "on" })),
  );
  assert.equal(result.outcome, "skipped");
  assert.equal(result.repositoryContext, undefined);
});

test("an unrecognized switch value emits a degraded record, released once the request is issued", async () => {
  const github = createFakeGithub({ pullRequest: pullRequest(), changedFiles: [] });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(github.ops, createConfig({ repositoryContextMode: "off", repositoryContextModeRaw: "banana" })),
  );
  assert.equal(result.outcome, "succeeded");
  assert.deepEqual(result.repositoryContext?.degraded, { kind: "repository_context_switch_unrecognized" });
  assert.equal(result.repositoryContext?.record, undefined);
});

test("nothing_to_resolve: changed lines producing no candidate never read as unavailable", async () => {
  const github = createFakeGithub({
    pullRequest: pullRequest(),
    changedFiles: [changedFile("docs/readme.md", [1])],
  });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(github.ops, createConfig({ repositoryContextMode: "on" })),
  );
  assert.equal(result.repositoryContext?.record?.outcome, "nothing_to_resolve");
  assert.equal(result.repositoryContext?.record?.candidatesRequested, 0);
});

test("used: every requested candidate resolves within budget", async () => {
  const github = createFakeGithub({
    pullRequest: pullRequest(),
    changedFiles: [changedFile("src/caller.ts", [4])],
    repoFiles: new Map([
      ["src/caller.ts", CALLER_TEXT],
      ["src/util.ts", UTIL_TEXT],
    ]),
  });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(github.ops, createConfig({ repositoryContextMode: "on" })),
  );
  assert.equal(result.repositoryContext?.record?.outcome, "used");
  assert.equal(result.repositoryContext?.record?.candidatesRequested, 1);
  assert.equal(result.repositoryContext?.record?.candidatesResolved, 1);
});

// --- Scenario 7: a forced-low time budget --------------------------------

test("scenario 7: a time budget forced to zero yields unavailable and never extends the pass deadline", async () => {
  const github = createFakeGithub({
    pullRequest: pullRequest(),
    changedFiles: [changedFile("src/caller.ts", [4])],
    repoFiles: new Map([
      ["src/caller.ts", CALLER_TEXT],
      ["src/util.ts", UTIL_TEXT],
    ]),
  });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(github.ops, createConfig({ repositoryContextMode: "on", repositoryContextTimeBudgetMs: 0 })),
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.repositoryContext?.record?.outcome, "unavailable");
  assert.ok(result.repositoryContext?.record?.drops.every((drop) => drop.reason === "time_budget"));
});

// --- Scenario 8: read failures split by what failed -----------------------

test("scenario 8a: every candidate-target read denied yields unavailable with read_failed drops", async () => {
  const github = createFakeGithub({
    pullRequest: pullRequest(),
    changedFiles: [changedFile("src/caller.ts", [4])],
    repoFiles: new Map([["src/caller.ts", CALLER_TEXT]]),
    unusablePaths: new Set(["src/util.ts"]),
  });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(github.ops, createConfig({ repositoryContextMode: "on" })),
  );
  assert.equal(result.repositoryContext?.record?.outcome, "unavailable");
  assert.ok(result.repositoryContext?.record?.drops.some((drop) => drop.reason === "read_failed"));
});

test("scenario 8b: an absent changed source file is accounted for and keeps nothing_to_resolve available", async () => {
  const github = createFakeGithub({
    pullRequest: pullRequest(),
    changedFiles: [changedFile("src/missing.ts", [1])],
    repoFiles: new Map(),
  });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(github.ops, createConfig({ repositoryContextMode: "on" })),
  );
  assert.equal(result.repositoryContext?.record?.outcome, "nothing_to_resolve");
  assert.deepEqual(result.repositoryContext?.record?.unreadableChangedFilePaths, []);
});

test("scenario 8c: a transiently-failing changed source file is unaccounted, forbidding nothing_to_resolve", async () => {
  const github = createFakeGithub({
    pullRequest: pullRequest(),
    changedFiles: [changedFile("src/broken.ts", [1])],
    transientFailurePaths: new Set(["src/broken.ts"]),
  });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(github.ops, createConfig({ repositoryContextMode: "on" })),
  );
  assert.notEqual(result.repositoryContext?.record?.outcome, "nothing_to_resolve");
  assert.deepEqual(result.repositoryContext?.record?.unreadableChangedFilePaths, ["src/broken.ts"]);
});

// --- AC11: a repository-context read failure never fails the pass --------

test("AC11: a repository-context read failure never fails the pass or suppresses the review", async () => {
  const github = createFakeGithub({
    pullRequest: pullRequest(),
    changedFiles: [changedFile("src/caller.ts", [4])],
    repoFiles: new Map([["src/caller.ts", CALLER_TEXT]]),
    transientFailurePaths: new Set(["src/util.ts", "src/util.js"]),
  });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(github.ops, createConfig({ repositoryContextMode: "on" })),
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(github.publishedReviews.length, 1);
});

// --- Scenario 10 (partial, structural): no cross-pass state leaks ---------

test("scenario 10: two consecutive passes on different content at the same path never bleed state", async () => {
  const configOn = createConfig({ repositoryContextMode: "on" });

  const firstGithub = createFakeGithub({
    pullRequest: pullRequest({ headSha: "a".repeat(40) }),
    changedFiles: [changedFile("src/caller.ts", [4])],
    repoFiles: new Map([
      ["src/caller.ts", CALLER_TEXT],
      ["src/util.ts", "export function helper(x: number): number {\n  return x + 100;\n}\n"],
    ]),
  });
  const first = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(firstGithub.ops, configOn),
  );

  const secondGithub = createFakeGithub({
    pullRequest: pullRequest({ headSha: "b".repeat(40) }),
    changedFiles: [changedFile("src/caller.ts", [4])],
    repoFiles: new Map([
      ["src/caller.ts", CALLER_TEXT],
      ["src/util.ts", "export function helper(x: number): number {\n  return x - 1;\n}\n"],
    ]),
  });
  const second = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(secondGithub.ops, configOn),
  );

  assert.equal(first.repositoryContext?.record?.outcome, "used");
  assert.equal(second.repositoryContext?.record?.outcome, "used");
});
