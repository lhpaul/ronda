import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Octokit } from "@octokit/rest";
import {
  ControlPassUsageError,
  createNoWriteOctokit,
  parseControlPassArgs,
  resolveControlPassOutPath,
  runControlPass,
  type ControlPassOptions,
} from "../../../src/cli/control-pass.js";
import type { RondaConfig } from "../../../src/config/config.types.js";
import type { ModelClient } from "../../../src/inference/model-client.js";
import {
  DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
  DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS,
  DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
} from "../../../src/config/load-config.js";

function testConfig(): RondaConfig {
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
  };
}

function testModel(): ModelClient {
  return {
    modelName: "fake-model",
    async complete() {
      return { content: JSON.stringify({ findings: [] }) };
    },
  };
}

// --- parseControlPassArgs --------------------------------------------------

test("parseControlPassArgs requires --pr as a positive integer", () => {
  assert.throws(() => parseControlPassArgs(["--repository-context", "on", "--repo", "lhpaul/ronda"]), ControlPassUsageError);
  assert.throws(
    () => parseControlPassArgs(["--pr", "abc", "--repository-context", "on", "--repo", "lhpaul/ronda"]),
    ControlPassUsageError,
  );
});

test("parseControlPassArgs requires --repository-context to be exactly on or off, with no default", () => {
  assert.throws(() => parseControlPassArgs(["--pr", "1", "--repo", "lhpaul/ronda"]), ControlPassUsageError);
  assert.throws(
    () => parseControlPassArgs(["--pr", "1", "--repository-context", "maybe", "--repo", "lhpaul/ronda"]),
    ControlPassUsageError,
  );
});

test("parseControlPassArgs requires --repo when GITHUB_REPOSITORY is unset", () => {
  assert.throws(() => parseControlPassArgs(["--pr", "1", "--repository-context", "on"], {}), ControlPassUsageError);
});

test("parseControlPassArgs defaults --repo from GITHUB_REPOSITORY and --out from the recorded default", () => {
  const options = parseControlPassArgs(["--pr", "42", "--repository-context", "off"], {
    GITHUB_REPOSITORY: "lhpaul/ronda",
  });
  assert.deepEqual(options, {
    pullNumber: 42,
    repositoryContext: "off",
    repo: "lhpaul/ronda",
    outPath: "docs/testing/ronda/repository-context-control-passes.jsonl",
  });
});

test("parseControlPassArgs accepts an explicit --out override", () => {
  const options = parseControlPassArgs([
    "--pr",
    "1",
    "--repository-context",
    "on",
    "--repo",
    "lhpaul/ronda",
    "--out",
    "docs/testing/ronda/custom.jsonl",
  ]);
  assert.equal(options.outPath, "docs/testing/ronda/custom.jsonl");
});

// --- resolveControlPassOutPath ---------------------------------------------

test("resolveControlPassOutPath accepts a path inside the repository root", () => {
  const resolved = resolveControlPassOutPath("docs/testing/ronda/x.jsonl", "/repo");
  assert.equal(resolved, "/repo/docs/testing/ronda/x.jsonl");
});

test("resolveControlPassOutPath refuses a path escaping the repository root", () => {
  assert.throws(() => resolveControlPassOutPath("../../etc/passwd", "/repo"), ControlPassUsageError);
  assert.throws(() => resolveControlPassOutPath("/etc/passwd", "/repo"), ControlPassUsageError);
});

// --- createNoWriteOctokit ---------------------------------------------------

function createFakeOctokit(): Octokit {
  return {
    pulls: {
      get: async () => ({
        data: {
          number: 1,
          title: "t",
          body: "",
          draft: false,
          head: { sha: "a".repeat(40), repo: { full_name: "lhpaul/ronda" } },
        },
      }),
      listFiles: () => undefined,
      createReview: async () => ({ data: {} }),
    },
    checks: {
      listForRef: async () => ({ data: { check_runs: [] } }),
      create: async () => ({ data: {} }),
      update: async () => ({ data: {} }),
    },
    issues: {
      createComment: async () => ({ data: {} }),
    },
    paginate: async () => [],
  } as unknown as Octokit;
}

test("createNoWriteOctokit refuses every write method and counts each attempt", async () => {
  let attempts = 0;
  const wrapped = createNoWriteOctokit(createFakeOctokit(), () => {
    attempts += 1;
  });
  await assert.rejects(() => wrapped.pulls.createReview({} as never));
  await assert.rejects(() => wrapped.checks.create({} as never));
  await assert.rejects(() => wrapped.checks.update({} as never));
  await assert.rejects(() => wrapped.issues.createComment({} as never));
  assert.equal(attempts, 4);
});

test("createNoWriteOctokit still delegates read methods to the real client", async () => {
  const wrapped = createNoWriteOctokit(createFakeOctokit(), () => undefined);
  const response = await wrapped.pulls.get({} as never);
  assert.equal((response as { data: { number: number } }).data.number, 1);
});

// --- runControlPass (AC22) -------------------------------------------------

const TEST_OUT_PATH = "tests/unit/cli/.control-pass-test-output.jsonl";
const REPO_ROOT = join(new URL("../../../", import.meta.url).pathname);

function baseOptions(overrides: Partial<ControlPassOptions> = {}): ControlPassOptions {
  return {
    pullNumber: 7,
    repositoryContext: "on",
    repo: "lhpaul/ronda",
    outPath: TEST_OUT_PATH,
    ...overrides,
  };
}

function cleanupOutFile(): void {
  const full = join(REPO_ROOT, TEST_OUT_PATH);
  if (existsSync(full)) {
    rmSync(full);
  }
}

test("runControlPass records one JSON line and never writes to GitHub", async (t) => {
  t.after(cleanupOutFile);
  cleanupOutFile();
  const octokit = createFakeOctokit();
  const exitCode = await runControlPass(baseOptions(), {
    octokit,
    githubToken: "test-token",
    getWriteAttempts: () => 0,
    configOverride: testConfig(),
    modelOverride: testModel(),
  });
  assert.equal(exitCode, 0);
  const full = join(REPO_ROOT, TEST_OUT_PATH);
  assert.ok(existsSync(full));
  const lines = readFileSync(full, "utf8").trim().split("\n");
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.pullNumber, 7);
  assert.equal(record.arm, "on");
  assert.ok("outcome" in record);
});

test("runControlPass refuses a fork-originated head before any further read", async () => {
  const octokit = {
    pulls: {
      get: async () => ({
        data: {
          number: 7,
          title: "t",
          body: "",
          draft: false,
          head: { sha: "a".repeat(40), repo: { full_name: "someone-else/ronda" } },
        },
      }),
      listFiles: () => {
        throw new Error("must not be called for a fork head");
      },
    },
  } as unknown as Octokit;
  const exitCode = await runControlPass(baseOptions(), {
    octokit,
    githubToken: "test-token",
    getWriteAttempts: () => 0,
  });
  assert.equal(exitCode, 1);
});

test("runControlPass exits non-zero when the no-write counter is non-zero at the end of the run", async (t) => {
  t.after(cleanupOutFile);
  cleanupOutFile();
  const octokit = createFakeOctokit();
  const exitCode = await runControlPass(baseOptions(), {
    octokit,
    githubToken: "test-token",
    getWriteAttempts: () => 1,
    configOverride: testConfig(),
    modelOverride: testModel(),
  });
  assert.equal(exitCode, 1);
});
