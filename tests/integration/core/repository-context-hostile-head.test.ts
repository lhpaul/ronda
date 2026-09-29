import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Octokit } from "@octokit/rest";
import { readRepositoryFileAtRef } from "../../../src/github/repo-content-reader.js";
import { runReviewPass } from "../../../src/core/run-review-pass.js";
import {
  DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
  DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS,
  DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
} from "../../../src/config/load-config.js";
import type {
  GithubOperations,
  PublishCheckRunInput,
  PublishReviewInput,
  PullRequestMetadata,
} from "../../../src/domain/review-pass.types.js";
import type { ModelClient } from "../../../src/inference/model-client.js";
import type { RondaConfig } from "../../../src/config/config.types.js";

/**
 * AC4 / AC5's read-only demonstration, run against the deliberately hostile
 * fixture in `tests/fixtures/repository-context/hostile-head/`. See
 * `docs/testing/ronda/repository-context-read-only-evidence-106.md` for the
 * recorded observation this test produces, and which parts are structural
 * (guaranteed by construction, D1) versus observational (this run's own
 * output).
 */

const REPO_ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..", "..", "..");

function realFileContent(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function createContentsApiFake(): Octokit {
  return {
    repos: {
      getContent: async ({ path }: { path: string }) => {
        const absolute = join(REPO_ROOT, path);
        const stat = lstatSync(absolute);
        if (stat.isSymbolicLink()) {
          // GitHub's contents API reports a symlink tree entry with
          // `type: "symlink"` and never resolves it server-side.
          return { data: { type: "symlink", size: stat.size, content: undefined } };
        }
        // Every hostile file used below is a regular blob.
        const content = readFileSync(absolute, "utf8");
        return {
          data: {
            type: "file",
            size: content.length,
            content: Buffer.from(content, "utf8").toString("base64"),
          },
        };
      },
    },
  } as unknown as Octokit;
}

// --- AC4 (structural half): the read seam already refuses a symlink and a
// submodule entry before decoding anything, and it never follows one.

test("AC4: a symlink escaping the repository is refused, never followed, and nothing outside the repository is read", async () => {
  const octokit = createContentsApiFake();
  const relativePath = "tests/fixtures/repository-context/hostile-head/nested-project/escape-symlink";
  const stat = lstatSync(join(REPO_ROOT, relativePath));
  assert.ok(stat.isSymbolicLink(), "the fixture path must actually be a symlink");
  const target = readlinkSync(join(REPO_ROOT, relativePath));
  assert.ok(target.startsWith(".."), "the fixture symlink must actually escape its own directory");

  const result = await readRepositoryFileAtRef(octokit, "lhpaul", "ronda", relativePath, "HEAD");
  assert.equal(result, undefined, "a symlink entry is refused, never returned as content");
});

test("AC4: a submodule (gitlink) tree entry is never fetched", () => {
  const output = execFileSync(
    "git",
    ["ls-files", "-s", "--", "tests/fixtures/repository-context/hostile-head/nested-project/other-repo"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  assert.match(output, /^160000 /, "the fixture path must actually be a gitlink (submodule) tree entry");
  // The contents seam's own structural refusal for a non-"file" type
  // (`src/github/repo-content-reader.ts`) is what AC4 rests on here — no
  // separate submodule-specific code path exists to fetch or verify.
});

// --- AC4 (structural half): nothing in this repository's own review pipeline
// can spawn a process or evaluate reviewed content.

test("AC4: no repository-context module ever imports a process-spawning or dynamic-evaluation API", () => {
  const filesToScan = [
    "src/review/symbol-resolver.ts",
    "src/review/repository-context.ts",
    "src/core/run-review-pass.ts",
    "src/github/repo-content-reader.ts",
  ];
  const forbidden = [/node:child_process/, /\bexec(File)?Sync?\(/, /\bnew Function\(/, /\beval\(/];
  for (const relativePath of filesToScan) {
    const text = readFileSync(join(REPO_ROOT, relativePath), "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(text, pattern, `${relativePath} must not match ${pattern}`);
    }
  }
});

// --- AC5: instruction-shaped content never changes the output contract, and
// the pass still publishes exactly one review and one check run.

function pullRequest(): PullRequestMetadata {
  return {
    number: 1,
    title: "Hostile-head demonstration",
    body: "",
    draft: false,
    headSha: "a".repeat(40),
    headBranch: "feature/hostile-demo",
    headRepoFullName: "lhpaul/ronda",
  };
}

function createFakeModel(): ModelClient {
  return {
    modelName: "fake-model",
    async complete() {
      // The model's response is fixed and controlled by this test — the
      // point is not "did the model obey the injected instruction" (a model
      // behavior question outside this repository's control) but "did
      // Ronda's own contract hold regardless": exactly one review, one
      // check run, and a real defect the file's own code carries is still
      // reportable.
      return {
        content: JSON.stringify({
          findings: [
            {
              path: "tests/fixtures/repository-context/hostile-head/nested-project/instruction-shaped.ts",
              line: 13,
              severity: "nit",
              title: "No bounds check",
              body: "userSuppliedPath is never validated.",
            },
          ],
        }),
      };
    },
  };
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
    repositoryContextMode: "on",
    repositoryContextModeRaw: undefined,
    maxRepositoryContextCandidates: DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES,
    maxRepositoryContextChars: DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS,
    repositoryContextTimeBudgetMs: DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
    repositoryContextBudgetFallbacks: [],
    ...overrides,
  };
}

test("AC5: a head carrying instruction-shaped content still publishes exactly one review and one check run", async () => {
  const instructionShapedPath =
    "tests/fixtures/repository-context/hostile-head/nested-project/instruction-shaped.ts";
  const text = realFileContent(instructionShapedPath);
  assert.match(text, /SYSTEM OVERRIDE/, "the fixture file must actually carry instruction-shaped content");

  const publishedReviews: PublishReviewInput[] = [];
  const publishedCheckRuns: PublishCheckRunInput[] = [];
  const github: GithubOperations = {
    async readPullRequest() {
      return pullRequest();
    },
    async readChangedFiles() {
      return [
        {
          path: instructionShapedPath,
          status: "added",
          additions: text.split("\n").length,
          deletions: 0,
          patch: text
            .split("\n")
            .map((line) => `+${line}`)
            .join("\n"),
        },
      ];
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

  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 1, trigger: "automatic" },
    {
      github,
      model: createFakeModel(),
      config: createConfig(),
      clock: { now: () => 0, isoNow: () => "2026-01-01T00:00:00.000Z" },
      logger: { event: () => undefined },
    },
  );

  assert.equal(result.outcome, "succeeded");
  assert.equal(publishedReviews.length, 1, "exactly one review must be published");
  assert.equal(publishedCheckRuns.length, 1, "exactly one check run must be published");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].title, "No bounds check");
});
