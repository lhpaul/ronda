import { test } from "node:test";
import assert from "node:assert/strict";
import { runReviewPass } from "../../../src/core/run-review-pass.js";
import { GithubClientError } from "../../../src/github/github-client.js";
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
import type { ModelClient, ModelCompletion } from "../../../src/inference/model-client.js";
import type { ReviewPrompt } from "../../../src/inference/review-prompt.js";
import type { RondaConfig } from "../../../src/config/config.types.js";
import type { DeadlineClock, DeadlineTimerHandle } from "../../../src/core/pass-deadline.js";

/**
 * A real timer the process treats as an *active* handle, unlike
 * production's `unref`-ed deadline timer. `createPassDeadline` always calls
 * `timer.unref?.()` on whatever `setTimeout` returns; here that call hits
 * this wrapper's no-op instead of `Timeout.prototype.unref`, so the real
 * underlying timer keeps the event loop alive until it fires — the actual
 * requested `ms` is preserved unchanged, only `unref` is neutralised.
 * Without this, a real `unref`-ed timer as the *only* active handle in an
 * otherwise-idle process (exactly what a test with a never-resolving-on-
 * its-own hanging promise produces) can trigger Node's test runner to treat
 * the process as exiting before the timer callback ever runs ("Promise
 * resolution is still pending but the event loop has already resolved") —
 * a test-process/CI-runner-speed artifact, not a product bug. Same pattern
 * as `tests/unit/core/run-review-pass.test.ts`'s `createFastDeadlineClock`,
 * generalised to preserve the caller's real `ms` instead of a fixed one,
 * since this file's tests rely on two *different* budgets (context vs.
 * pass) racing each other for real.
 */
function createKeepAliveDeadlineClock(): DeadlineClock {
  return {
    setTimeout: (callback, ms) => {
      const real = setTimeout(callback, ms);
      return { real, unref: () => undefined } as DeadlineTimerHandle & { real: NodeJS.Timeout };
    },
    clearTimeout: (handle) => {
      clearTimeout((handle as DeadlineTimerHandle & { real: NodeJS.Timeout }).real);
    },
  };
}

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
  /** Never resolves on its own — only when `signal` aborts, mirroring a stalled contents request. */
  hangingPaths?: Set<string>;
  /** Resolves normally, but only after the given delay — simulating a slow (not stalled) read. */
  delayedPaths?: Map<string, number>;
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
    async readFileAtRef(_owner, _repo, path, _ref, signal, options) {
      const delayMs = input.delayedPaths?.get(path);
      if (delayMs !== undefined) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      if (input.hangingPaths?.has(path)) {
        return await new Promise((_resolve, reject) => {
          const onAbort = (): void => reject(new GithubClientError("timed_out", "aborted"));
          if (signal?.aborted) {
            onAbort();
            return;
          }
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
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

/** Same as {@link createFakeModel}, but also captures every prompt it is asked to complete. */
function createRecordingFakeModel(): { model: ModelClient; requests: ReviewPrompt[] } {
  const requests: ReviewPrompt[] = [];
  const model: ModelClient = {
    modelName: "fake-model",
    async complete(request): Promise<ModelCompletion> {
      requests.push(request);
      return { content: JSON.stringify({ findings: [] }) };
    },
  };
  return { model, requests };
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
    excludePathGlobs: [],
    ...overrides,
  };
}

function deps(
  github: GithubOperations,
  config: RondaConfig,
  overrides: Partial<ReviewPassDeps> = {},
): ReviewPassDeps {
  const { logger } = createLogger();
  return {
    github,
    model: createFakeModel(),
    config,
    clock: { now: () => 0, isoNow: () => "2026-01-01T00:00:00.000Z" },
    logger,
    ...overrides,
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

test("a resolution read that finishes past its own context budget is downgraded to time_budget, not reported resolved", async () => {
  // buildSourceFileSet's own per-candidate check runs *before* issuing a
  // read, not after — so a single read that itself takes longer than the
  // remaining budget can "successfully" resolve past the deadline. This
  // proves runRepositoryContextPhase's post-compile check catches that case
  // and never reports it as `used`, even though the resolver itself found
  // a real, correct declaration.
  const github = createFakeGithub({
    pullRequest: pullRequest(),
    changedFiles: [changedFile("src/caller.ts", [4])],
    repoFiles: new Map([
      ["src/caller.ts", CALLER_TEXT],
      ["src/util.ts", UTIL_TEXT],
    ]),
    delayedPaths: new Map([["src/util.ts", 80]]),
  });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(
      github.ops,
      createConfig({
        repositoryContextMode: "on",
        repositoryContextTimeBudgetMs: 20, // comfortably shorter than the 80ms delayed read
        passTimeoutMs: 600_000,
      }),
      { deadlineClock: createKeepAliveDeadlineClock() },
    ),
  );
  assert.equal(result.outcome, "succeeded");
  assert.notEqual(result.repositoryContext?.record?.outcome, "used");
  assert.equal(result.repositoryContext?.record?.candidatesResolved, 0);
  assert.ok(result.repositoryContext?.record?.drops.every((drop) => drop.reason === "time_budget"));
});

test("a slow changed-file read during identification never consumes the context time budget", async () => {
  // Identification (reading src/caller.ts) deliberately takes longer than
  // the configured context budget. If the context deadline were armed
  // before identification (the bug this test guards against), it would
  // already be expired by the time resolution starts, and the fast,
  // otherwise-trivially-resolvable util.ts read would be dropped
  // time_budget instead of resolving.
  const github = createFakeGithub({
    pullRequest: pullRequest(),
    changedFiles: [changedFile("src/caller.ts", [4])],
    repoFiles: new Map([
      ["src/caller.ts", CALLER_TEXT],
      ["src/util.ts", UTIL_TEXT],
    ]),
    delayedPaths: new Map([["src/caller.ts", 120]]),
  });
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(
      github.ops,
      createConfig({
        repositoryContextMode: "on",
        repositoryContextTimeBudgetMs: 60, // shorter than identification's own 120ms delay
        passTimeoutMs: 600_000,
      }),
      { deadlineClock: createKeepAliveDeadlineClock() },
    ),
  );
  assert.equal(result.outcome, "succeeded");
  assert.equal(result.repositoryContext?.record?.outcome, "used");
  assert.equal(result.repositoryContext?.record?.candidatesResolved, 1);
});

test("a stalled candidate-target read aborts at the context time budget, not the (much larger) pass deadline", async () => {
  const github = createFakeGithub({
    pullRequest: pullRequest(),
    changedFiles: [changedFile("src/caller.ts", [4])],
    repoFiles: new Map([["src/caller.ts", CALLER_TEXT]]),
    hangingPaths: new Set(["src/util.ts"]),
  });
  const startedAt = Date.now();
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(
      github.ops,
      createConfig({
        repositoryContextMode: "on",
        repositoryContextTimeBudgetMs: 50,
        passTimeoutMs: 600_000, // the pass's own (much larger) deadline — must never be what unblocks this
      }),
      { deadlineClock: createKeepAliveDeadlineClock() },
    ),
  );
  const elapsedMs = Date.now() - startedAt;
  assert.equal(result.outcome, "succeeded");
  assert.ok(
    elapsedMs < 30_000,
    `expected the stalled read to abort near the 50ms context budget, not the 600000ms pass deadline (took ${elapsedMs}ms)`,
  );
  assert.equal(result.repositoryContext?.record?.outcome, "unavailable");
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

// --- #106/#134: excluded dependency content must never re-enter via the
// resolver, even though `filterExcludedFiles` only ever sees `changedFiles`
// ---------------------------------------------------------------------------

const GENERATED_HELPER_MARKER = "sk-planted-generated-dependency-do-not-leak";
const GENERATED_HELPER_TEXT = `// ${GENERATED_HELPER_MARKER}\nexport function helper(x: number): number {\n  return x + 1;\n}\n`;
const CALLER_OF_GENERATED_TEXT = [
  'import { helper } from "./helper.generated.js";',
  "",
  "export function run(): number {",
  "  return helper(1);",
  "}",
].join("\n");

test("excluded dependency: an included file importing a default-excluded generated file never resolves or reaches the prompt", async () => {
  const github = createFakeGithub({
    pullRequest: pullRequest(),
    changedFiles: [changedFile("src/caller.ts", [4])],
    repoFiles: new Map([
      ["src/caller.ts", CALLER_OF_GENERATED_TEXT],
      // The resolver's module-resolution contract substitutes `.generated.js`
      // → `.generated.ts` the same way it does for plain `.js` → `.ts`; this
      // is the exact file `**/*.generated.*` (a fixed default exclusion,
      // #134) would keep out of the prompt if it had been a *changed* file
      // instead of a same-PR dependency.
      ["src/helper.generated.ts", GENERATED_HELPER_TEXT],
    ]),
  });
  const { model, requests } = createRecordingFakeModel();

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    deps(
      github.ops,
      createConfig({
        repositoryContextMode: "on",
        maxRepositoryContextCandidates: 1_000,
        maxRepositoryContextChars: 1_000_000,
        repositoryContextTimeBudgetMs: 600_000,
      }),
      { model },
    ),
  );

  assert.equal(result.outcome, "succeeded");
  // The isolating half: without the resolver-read exclusion check (the bug
  // this test guards against), this candidate would resolve and its record
  // would report `used`/`candidatesResolved: 1`. With the check applied, the
  // excluded dependency is refused before it is ever read, so it is dropped
  // rather than resolved.
  assert.notEqual(result.repositoryContext?.record?.candidatesResolved, 1);
  assert.equal(result.repositoryContext?.record?.candidatesResolved, 0);

  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0].userPrompt, new RegExp(GENERATED_HELPER_MARKER));
  assert.doesNotMatch(requests[0].userPrompt, /helper\.generated\.ts/);
});
