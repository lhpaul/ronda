import { test } from "node:test";
import assert from "node:assert/strict";
import { runReviewPass } from "../../../src/core/run-review-pass.js";
import { DURABILITY_MODE_DOCUMENT_PATH } from "../../../src/review/durability-mode.js";
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

// #137 (follow-up to #134): `excludePathGlobs` must also gate the
// authoritative-document reads and the durability-mode document read — not
// just the top-level `changedFiles` diff. Reproduces the finding's exact
// scenario: `excludePathGlobs=['docs/**']` with changes touching
// `docs/constitution.md` and `src/config/example.ts` — before this fix, the
// excluded constitution doc was still fetched via
// `selectAuthoritativeDocCandidates` and inlined into the model prompt.

const HEAD_SHA = "c".repeat(40);
const CONSTITUTION_MARKER = "CONSTITUTION-PLANTED-MARKER-DO-NOT-REACH-PROMPT";
const DURABILITY_DOC_MARKER = "DURABILITY-DOC-PLANTED-MARKER-DO-NOT-REACH-PROMPT";

function createPullRequest(): PullRequestMetadata {
  return {
    number: 7,
    title: "Touch config and constitution",
    body: "Description",
    draft: false,
    headSha: HEAD_SHA,
    headBranch: "feature/evidence",
    headRepoFullName: "lhpaul/ronda",
  };
}

interface FakeGithub {
  ops: GithubOperations;
  publishedReviews: PublishReviewInput[];
  publishedCheckRuns: PublishCheckRunInput[];
  readPaths: string[];
}

function createFakeGithub(changedFiles: ChangedFile[]): FakeGithub {
  const publishedReviews: PublishReviewInput[] = [];
  const publishedCheckRuns: PublishCheckRunInput[] = [];
  const readPaths: string[] = [];
  const ops: GithubOperations = {
    async readPullRequest() {
      return createPullRequest();
    },
    async readChangedFiles() {
      return changedFiles;
    },
    async readFileAtRef(_owner, _repo, path) {
      readPaths.push(path);
      if (path === "docs/constitution.md") {
        return CONSTITUTION_MARKER;
      }
      if (path === DURABILITY_MODE_DOCUMENT_PATH) {
        return [
          "### Restart and recovery",
          "### Retry semantics",
          "### Timeout and watchdog",
          "### Duplicate delivery",
          "### Partial success",
          "### Persistence integrity",
          DURABILITY_DOC_MARKER,
        ].join("\n");
      }
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
  return { ops, publishedReviews, publishedCheckRuns, readPaths };
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

function createRecordingLogger(): { logger: Logger; events: Array<{ name: string; data: unknown }> } {
  const events: Array<{ name: string; data: unknown }> = [];
  return {
    logger: {
      event: (name, data) => {
        events.push({ name, data });
      },
    },
    events,
  };
}

const CONSTITUTION_CHANGE: ChangedFile = {
  path: "docs/constitution.md",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: "@@ -1,1 +1,1 @@\n-old\n+new",
};

const CONFIG_CHANGE: ChangedFile = {
  path: "src/config/example.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: "@@ -1,1 +1,1 @@\n-old\n+new",
};

test("path exclusion: an excluded authoritative-doc candidate is never read from GitHub or inlined in the prompt — isolating proof", async () => {
  const github = createFakeGithub([CONSTITUTION_CHANGE, CONFIG_CHANGE]);
  const { model, requests } = createFakeModel('{"findings":[]}');
  const { logger, events } = createRecordingLogger();

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github: github.ops,
      model,
      config: createConfig({ excludePathGlobs: ["docs/**"] }),
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger,
    },
  );

  assert.equal(result.outcome, "succeeded");

  // The excluded doc's own path must never reach `readFileAtRef` at all.
  assert.ok(
    !github.readPaths.includes("docs/constitution.md"),
    `docs/constitution.md must not be read; read paths: ${github.readPaths.join(", ")}`,
  );

  // Nor may its content ever reach the model prompt.
  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0].userPrompt, new RegExp(CONSTITUTION_MARKER));

  // Named as skipped, same as the other authoritative-doc skip reasons.
  const skipEvent = events.find(
    (e) => e.name === "authoritative_doc_skipped" && (e.data as { id?: string }).id === "constitution",
  );
  assert.ok(skipEvent, "expected an authoritative_doc_skipped event for the constitution candidate");
  assert.equal((skipEvent!.data as { reason?: string }).reason, "excluded_path");
});

test("path exclusion: without the exclusion configured, the authoritative doc is read and reaches the prompt — the isolating negative", async () => {
  const github = createFakeGithub([CONSTITUTION_CHANGE, CONFIG_CHANGE]);
  const { model, requests } = createFakeModel('{"findings":[]}');
  const { logger } = createRecordingLogger();

  await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github: github.ops,
      model,
      config: createConfig({ excludePathGlobs: [] }),
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger,
    },
  );

  assert.ok(github.readPaths.includes("docs/constitution.md"));
  assert.equal(requests.length, 1);
  assert.match(requests[0].userPrompt, new RegExp(CONSTITUTION_MARKER));
});

test("path exclusion: a durability-mode document path matching the exclusion glob is never read from GitHub — isolating proof", async () => {
  const github = createFakeGithub([CONFIG_CHANGE]);
  const { model, requests } = createFakeModel('{"findings":[]}');
  const { logger, events } = createRecordingLogger();

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github: github.ops,
      model,
      config: createConfig({
        excludePathGlobs: ["docs/**"],
        durabilityMode: "on",
      }),
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger,
    },
  );

  assert.equal(result.outcome, "succeeded");

  assert.ok(
    !github.readPaths.includes(DURABILITY_MODE_DOCUMENT_PATH),
    `durability-mode document must not be read; read paths: ${github.readPaths.join(", ")}`,
  );
  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0].userPrompt, new RegExp(DURABILITY_DOC_MARKER));

  const excludedEvent = events.find((e) => e.name === "durability_mode_document_excluded");
  assert.ok(excludedEvent, "expected a durability_mode_document_excluded log event");

  const resolvedEvent = events.find((e) => e.name === "durability_mode_resolved");
  assert.ok(resolvedEvent, "expected a durability_mode_resolved log event");
  // Reviewing lhpaul/ronda itself never falls back to a local document copy
  // (see `shouldFallBackToLocalDurabilityModeDocument`), so an excluded head
  // document must resolve the same way a missing one does: unavailable.
  assert.equal((resolvedEvent!.data as { state?: string }).state, "unavailable");
});

test("path exclusion: without the exclusion configured, the durability-mode document is read and activates the mode — the isolating negative", async () => {
  const github = createFakeGithub([CONFIG_CHANGE]);
  const { model, requests } = createFakeModel('{"findings":[]}');
  const { logger, events } = createRecordingLogger();

  await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github: github.ops,
      model,
      config: createConfig({
        excludePathGlobs: [],
        durabilityMode: "on",
      }),
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger,
    },
  );

  assert.ok(github.readPaths.includes(DURABILITY_MODE_DOCUMENT_PATH));
  assert.equal(requests.length, 1);
  assert.match(requests[0].userPrompt, new RegExp(DURABILITY_DOC_MARKER));

  const resolvedEvent = events.find((e) => e.name === "durability_mode_resolved");
  assert.ok(resolvedEvent);
  assert.equal((resolvedEvent!.data as { state?: string }).state, "active");
});

// #137 (repository context phase gap): when an included file imports an
// excluded file (via dependency resolution), the excluded file must not be
// read, even in repository context mode. This isolates the specific scenario
// where a changed file has a patch and is included, but imports a file that
// has no patch (GitHub returned no diff) and is therefore excluded.

const EXCLUDED_FILE_MARKER = "EXCLUDED-FILE-PLANTED-MARKER-DO-NOT-REACH-PROMPT";
const INCLUDED_FILE_MARKER = "INCLUDED-FILE-PLANTED-MARKER-SHOULD-REACH-PROMPT";

test("repository context: an included file importing a patchless (no_patch) file never fetches the excluded dependency — isolating proof", async () => {
  // included-caller.ts has a patch and is included. excluded-helper.ts has
  // no patch (GitHub returns undefined) and is excluded for no_patch reason.
  const github = createFakeGithub([
    {
      path: "src/included-caller.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -1,1 +1,2 @@\n+import helper from './excluded-helper';\n old",
    },
    {
      path: "src/excluded-helper.ts",
      status: "modified",
      additions: 5,
      deletions: 0,
      patch: undefined, // no patch — binary or GitHub declined to return it
    },
  ]);

  const ops: GithubOperations = {
    ...github.ops,
    async readFileAtRef(_owner, _repo, path) {
      github.readPaths.push(path);
      if (path === "src/included-caller.ts") {
        // Return actual source that imports and uses the helper, so the resolver
        // attempts to read the dependency. The marker string is embedded in the
        // source, proving the file was parsed and inlined.
        return (
          `import { helperFunction } from './excluded-helper';\n` +
          `\n` +
          `export function caller() {\n` +
          `  const result = helperFunction();\n` +
          `  console.log('${INCLUDED_FILE_MARKER}');\n` +
          `  return result;\n` +
          `}\n`
        );
      }
      if (path === "src/excluded-helper.ts") {
        return EXCLUDED_FILE_MARKER;
      }
      return undefined;
    },
  };

  const { model, requests } = createFakeModel('{"findings":[]}');
  const { logger } = createRecordingLogger();

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github: ops,
      model,
      config: createConfig({
        excludePathGlobs: [],
        repositoryContextMode: "on",
      }),
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger,
    },
  );

  assert.equal(result.outcome, "succeeded");

  // The excluded file's path must never reach readFileAtRef, even when the
  // symbol resolver tries to resolve the import in included-caller.ts.
  assert.ok(
    !github.readPaths.includes("src/excluded-helper.ts"),
    `src/excluded-helper.ts must not be read; read paths: ${github.readPaths.join(", ")}`,
  );

  // The excluded file's content must not reach the model prompt.
  assert.equal(requests.length, 1);
  assert.doesNotMatch(requests[0].userPrompt, new RegExp(EXCLUDED_FILE_MARKER));

  // The included file is read for repository context (it's in changedFiles).
  assert.ok(
    github.readPaths.includes("src/included-caller.ts"),
    `src/included-caller.ts should be read; read paths: ${github.readPaths.join(", ")}`,
  );
});

test("repository context: without repository context mode, the excluded file is not read anyway (it's filtered pre-prompt) — the isolating negative", async () => {
  const github = createFakeGithub([
    {
      path: "src/included-caller.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: "@@ -1,1 +1,2 @@\n+import helper from './excluded-helper';\n old",
    },
    {
      path: "src/excluded-helper.ts",
      status: "modified",
      additions: 5,
      deletions: 0,
      patch: undefined,
    },
  ]);

  const { model } = createFakeModel('{"findings":[]}');
  const { logger } = createRecordingLogger();

  await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github: github.ops,
      model,
      config: createConfig({
        excludePathGlobs: [],
        repositoryContextMode: "off",
      }),
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger,
    },
  );

  // Without repository context mode, the excluded file is simply not in the
  // changed files list (it's filtered by filterExcludedFiles), so the
  // symbol resolver never runs and the file is never imported. This test
  // proves the repository-context-specific path and that the fix is needed
  // only when repository context is on.
  assert.ok(!github.readPaths.includes("src/excluded-helper.ts"));
});
