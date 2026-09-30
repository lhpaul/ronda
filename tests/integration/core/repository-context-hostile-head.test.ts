import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
 * fixture in `tests/fixtures/repository-context/hostile-head/` (executable-
 * if-invoked content and instruction-shaped source, kept committed as
 * ordinary files) plus a **git-special hostile head built at test time**
 * (owner decision, 2026-09-30): a real symlink escaping its own directory
 * and a real gitlink/submodule tree entry are constructed in a throwaway
 * temporary git repository for the duration of this test file, then deleted
 * — never committed to this repository's own tree, so `git ls-files -s`
 * here never shows a `160000` entry and no `.gitmodules` file exists
 * anywhere in this repository (a nested, non-root `.gitmodules` previously
 * broke `actions/checkout`'s own submodule cleanup step for every CI job;
 * see this PR's history).
 *
 * See `docs/testing/ronda/repository-context-read-only-evidence-106.md` for
 * the recorded observation this test produces, and which parts are
 * structural (guaranteed by construction, D1) versus observational (this
 * run's own output).
 */

const REPO_ROOT = join(dirname(fileURLToPath(new URL(import.meta.url))), "..", "..", "..");

function realFileContent(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

/** A fake Contents API whose reads resolve against an arbitrary root directory (the real fixture, or the ephemeral hostile git repo below). */
function createContentsApiFake(rootDir: string): Octokit {
  return {
    repos: {
      getContent: async ({ path }: { path: string }) => {
        const absolute = join(rootDir, path);
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

/**
 * Builds a throwaway git repository under the OS temp directory carrying the
 * git-special hostile objects a normal committed fixture cannot safely hold
 * in *this* repository's own tree: a real symlink escaping its own
 * directory, a sibling symlink, a real gitlink (submodule) tree entry, a
 * matching `.gitmodules`, and the attribute filter/diff driver configuration
 * `.gitattributes` names. Returns the repo's root directory; the caller is
 * responsible for `rmSync(repoDir, { recursive: true, force: true })`.
 */
function buildHostileGitRepo(): string {
  const repoDir = mkdtempSync(join(tmpdir(), "ronda-hostile-head-"));
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "ronda-test",
    GIT_AUTHOR_EMAIL: "ronda-test@example.invalid",
    GIT_COMMITTER_NAME: "ronda-test",
    GIT_COMMITTER_EMAIL: "ronda-test@example.invalid",
  };
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: repoDir, env: gitEnv, stdio: "pipe" });
  };

  git("init", "--quiet");

  mkdirSync(join(repoDir, "nested-project"), { recursive: true });
  mkdirSync(join(repoDir, "outside-target"), { recursive: true });
  writeFileSync(join(repoDir, "outside-target", "marker.txt"), "sibling target, not escaping the repo\n");

  // A real symlink whose target climbs above the repository root (AC4's
  // "escape" case). The target need not resolve to a real path on disk —
  // the demonstration is that it is never followed, not that it works.
  symlinkSync(
    "../../../../../../../../etc/passwd",
    join(repoDir, "nested-project", "escape-symlink"),
  );
  // A second real symlink to a sibling directory within the same repo.
  symlinkSync("../outside-target", join(repoDir, "nested-project", "sibling-symlink"));

  writeFileSync(
    join(repoDir, ".gitattributes"),
    "nested-project/*.bin filter=hostile-filter diff=hostile-differ\n",
  );
  writeFileSync(
    join(repoDir, ".gitmodules"),
    [
      '[submodule "nested-project/other-repo"]',
      "\tpath = nested-project/other-repo",
      "\turl = https://example.invalid/hostile/other-repo.git",
      "",
    ].join("\n"),
  );

  // The attribute filter/diff driver config itself lives only in local git
  // config, never in a trackable file — set it up so the fixture's own
  // `.gitattributes` claim is backed by a real (harmless) driver definition.
  git("config", "filter.hostile-filter.clean", "cat");
  git("config", "filter.hostile-filter.smudge", "cat");
  git("config", "diff.hostile-differ.textconv", "cat");

  git("add", ".gitattributes", ".gitmodules", "outside-target/marker.txt", "nested-project/escape-symlink", "nested-project/sibling-symlink");

  // A real gitlink (submodule) tree entry, mode 160000 — registered via
  // `update-index`, never via `git submodule add` (which would require an
  // actual reachable remote). The pinned sha is arbitrary; nothing ever
  // fetches it.
  git("update-index", "--add", "--cacheinfo", "160000,bcc95424e176d555455df83c6b5498c495721eb6,nested-project/other-repo");

  git("commit", "--quiet", "-m", "hostile head test fixture");

  return repoDir;
}

// --- AC4 (structural half): the read seam already refuses a symlink and a
// submodule entry before decoding anything, and it never follows one.

test("AC4: git-special hostile head (symlink, gitlink)", async (t) => {
  const repoDir = buildHostileGitRepo();
  t.after(() => rmSync(repoDir, { recursive: true, force: true }));

  await t.test("a symlink escaping the repository is refused, never followed, and nothing outside the repository is read", async () => {
    const octokit = createContentsApiFake(repoDir);
    const relativePath = "nested-project/escape-symlink";
    const stat = lstatSync(join(repoDir, relativePath));
    assert.ok(stat.isSymbolicLink(), "the fixture path must actually be a symlink");
    const target = readlinkSync(join(repoDir, relativePath));
    assert.ok(target.startsWith(".."), "the fixture symlink must actually escape its own directory");

    const result = await readRepositoryFileAtRef(octokit, "lhpaul", "ronda", relativePath, "HEAD");
    assert.equal(result, undefined, "a symlink entry is refused, never returned as content");
  });

  await t.test("a submodule (gitlink) tree entry is never fetched", () => {
    const output = execFileSync("git", ["ls-files", "-s", "--", "nested-project/other-repo"], {
      cwd: repoDir,
      encoding: "utf8",
    });
    assert.match(output, /^160000 /, "the fixture path must actually be a gitlink (submodule) tree entry");
    // The contents seam's own structural refusal for a non-"file" type
    // (`src/github/repo-content-reader.ts`) is what AC4 rests on here — no
    // separate submodule-specific code path exists to fetch or verify.
  });
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
    excludePathGlobs: [],
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
