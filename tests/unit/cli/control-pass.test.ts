import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Octokit } from "@octokit/rest";
import {
  ControlPassUsageError,
  countingModelClient,
  createNoWriteOctokit,
  loadPlantedFixture,
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

test("runControlPass records the AC14 cost fields: elapsed time, model calls, and model identity (#132)", async (t) => {
  t.after(cleanupOutFile);
  cleanupOutFile();
  let calls = 0;
  const model: ModelClient = {
    modelName: "fake-model",
    async complete() {
      calls += 1;
      return { content: JSON.stringify({ findings: [] }), reportedModel: "fake-model-2026-01-01" };
    },
  };
  const exitCode = await runControlPass(baseOptions({ repositoryContext: "off" }), {
    octokit: createFakeOctokit(),
    githubToken: "test-token",
    getWriteAttempts: () => 0,
    configOverride: testConfig(),
    modelOverride: model,
  });
  assert.equal(exitCode, 0);
  const record = JSON.parse(readFileSync(join(REPO_ROOT, TEST_OUT_PATH), "utf8").trim().split("\n")[0]);
  assert.equal(record.arm, "off");
  assert.equal(record.modelCallCount, calls);
  assert.ok(calls >= 1);
  assert.equal(record.modelName, "fake-model");
  assert.deepEqual(record.reportedModels, ["fake-model-2026-01-01"]);
  assert.equal(typeof record.elapsedMs, "number");
  assert.ok(record.elapsedMs >= 0);
  assert.equal(record.sweepMode, testConfig().sweepMode);
});

test("countingModelClient counts requests and collects distinct reported models", async () => {
  const replies = ["a", undefined, "a", "b"];
  let index = 0;
  const counting = countingModelClient({
    modelName: "m",
    async complete() {
      const reportedModel = replies[index++];
      return reportedModel === undefined ? { content: "" } : { content: "", reportedModel };
    },
  });
  const signal = new AbortController().signal;
  for (let i = 0; i < 4; i += 1) {
    await counting.model.complete({ systemPrompt: "", userPrompt: "" }, signal);
  }
  assert.equal(counting.calls(), 4);
  assert.deepEqual(counting.reportedModels(), ["a", "b"]);
  assert.equal(counting.model.modelName, "m");
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

// --- path-exclusion evidence and planted fixture (#142) ---------------------

test("parseControlPassArgs accepts an optional --plant-fixture and omits it otherwise", () => {
  const withFixture = parseControlPassArgs([
    "--pr",
    "119",
    "--repository-context",
    "off",
    "--repo",
    "lhpaul/ronda",
    "--plant-fixture",
    "tests/fixtures/review-path-exclusion/planted-defect.json",
  ]);
  assert.equal(withFixture.plantFixturePath, "tests/fixtures/review-path-exclusion/planted-defect.json");
  const without = parseControlPassArgs(["--pr", "119", "--repository-context", "off", "--repo", "lhpaul/ronda"]);
  assert.equal("plantFixturePath" in without, false);
});

test("loadPlantedFixture reads the committed #142 fixture", () => {
  const fixture = loadPlantedFixture("tests/fixtures/review-path-exclusion/planted-defect.json", REPO_ROOT);
  assert.equal(fixture.path, "src/review/excluded-bytes.ts");
  assert.ok(fixture.patch.startsWith("@@ -0,0 +1,"));
  assert.ok(fixture.defect.length > 0);
});

test("loadPlantedFixture refuses a fixture outside the repository and an unsafe planted path", () => {
  assert.throws(() => loadPlantedFixture("../outside.json", REPO_ROOT), ControlPassUsageError);
  const dir = mkdtempSync(join(tmpdir(), "control-pass-fixture-"));
  try {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify({ path: "../escape.ts", patch: "@@ -0,0 +1 @@\n+x", additions: 1, defect: "d" }));
    assert.throws(() => loadPlantedFixture("bad.json", dir), ControlPassUsageError);
    for (const path of ["src/./a.ts", "src//a.ts", "src/a.ts/", "src\\a.ts", "src/../a.ts"]) {
      writeFileSync(bad, JSON.stringify({ path, patch: "@@ -0,0 +1 @@\n+x", additions: 1, defect: "d" }));
      assert.throws(() => loadPlantedFixture("bad.json", dir), ControlPassUsageError, path);
    }
    writeFileSync(bad, JSON.stringify({ path: "src/a.ts", patch: "", additions: 1, defect: "d" }));
    assert.throws(() => loadPlantedFixture("bad.json", dir), ControlPassUsageError);
    writeFileSync(bad, "not json");
    assert.throws(() => loadPlantedFixture("bad.json", dir), ControlPassUsageError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createOctokitWithFiles(files: Array<{ filename: string; patch: string }>): Octokit {
  const base = createFakeOctokit() as unknown as Record<string, unknown>;
  return {
    ...base,
    paginate: async () =>
      files.map((file) => ({ filename: file.filename, status: "added", patch: file.patch, additions: 1, deletions: 0 })),
  } as unknown as Octokit;
}

test("runControlPass records exclusion globs, findings, the excluded-files summary, and the planted fixture", async (t) => {
  t.after(cleanupOutFile);
  cleanupOutFile();
  let promptSeen = "";
  const model: ModelClient = {
    modelName: "fake-model",
    async complete(request) {
      promptSeen = request.userPrompt;
      return {
        content: JSON.stringify({
          findings: [
            {
              path: "docs/testing/ronda/sweep-on-extended.json",
              line: 1,
              severity: "important",
              title: "Excluded-path finding",
              body: "Must be discarded.",
            },
            {
              path: "src/review/excluded-bytes.ts",
              line: 10,
              severity: "blocking",
              title: "Off-by-one loop reads past the end of the array",
              body: "`index <= listed.length` reads an undefined element.",
            },
          ],
        }),
      };
    },
  };
  const octokit = createOctokitWithFiles([
    { filename: "docs/testing/ronda/sweep-on-extended.json", patch: "@@ -0,0 +1 @@\n+{}" },
    { filename: "docs/testing/README.md", patch: "@@ -0,0 +1 @@\n+# Testing" },
  ]);
  const exitCode = await runControlPass(
    baseOptions({ repositoryContext: "off", plantFixturePath: "tests/fixtures/review-path-exclusion/planted-defect.json" }),
    {
      octokit,
      githubToken: "test-token",
      getWriteAttempts: () => 0,
      configOverride: { ...testConfig(), excludePathGlobs: ["docs/testing/ronda/**/*.json"] },
      modelOverride: model,
    },
  );
  assert.equal(exitCode, 0);
  assert.ok(promptSeen.includes("src/review/excluded-bytes.ts"));
  assert.ok(!promptSeen.includes("docs/testing/ronda/sweep-on-extended.json"));
  const record = JSON.parse(readFileSync(join(REPO_ROOT, TEST_OUT_PATH), "utf8").trim().split("\n")[0]);
  assert.deepEqual(record.excludePathGlobs, ["docs/testing/ronda/**/*.json"]);
  assert.deepEqual(
    record.findings.map((finding: { path: string }) => finding.path),
    ["src/review/excluded-bytes.ts"],
  );
  assert.equal(record.findings[0].line, 10);
  assert.equal("body" in record.findings[0], false);
  assert.equal(typeof record.summary, "string");
  assert.ok(record.summary.includes("Excluded from review"));
  assert.ok(record.summary.includes("docs/testing/ronda/sweep-on-extended.json"));
  assert.deepEqual(record.plantedFixture, {
    fixturePath: "tests/fixtures/review-path-exclusion/planted-defect.json",
    path: "src/review/excluded-bytes.ts",
    defect: loadPlantedFixture("tests/fixtures/review-path-exclusion/planted-defect.json", REPO_ROOT).defect,
  });
});

test("runControlPass records an empty exclusion list, findings, and summary but no plantedFixture on a plain run", async (t) => {
  t.after(cleanupOutFile);
  cleanupOutFile();
  const exitCode = await runControlPass(baseOptions({ repositoryContext: "off" }), {
    octokit: createOctokitWithFiles([{ filename: "src/a.ts", patch: "@@ -0,0 +1 @@\n+export const a = 1;" }]),
    githubToken: "test-token",
    getWriteAttempts: () => 0,
    configOverride: testConfig(),
    modelOverride: testModel(),
  });
  assert.equal(exitCode, 0);
  const record = JSON.parse(readFileSync(join(REPO_ROOT, TEST_OUT_PATH), "utf8").trim().split("\n")[0]);
  assert.deepEqual(record.excludePathGlobs, []);
  assert.deepEqual(record.findings, []);
  assert.equal(typeof record.summary, "string");
  assert.ok(!record.summary.includes("Excluded from review"));
  assert.equal("plantedFixture" in record, false);
});

test("loadPlantedFixture refuses a non-integer or negative additions count", () => {
  const dir = mkdtempSync(join(tmpdir(), "control-pass-fixture-"));
  try {
    const bad = join(dir, "bad.json");
    for (const additions of [-1, 1.5]) {
      writeFileSync(bad, JSON.stringify({ path: "src/a.ts", patch: "@@ -0,0 +1 @@\n+x", additions, defect: "d" }));
      assert.throws(() => loadPlantedFixture("bad.json", dir), ControlPassUsageError);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runControlPass fails rather than replacing a real changed file that collides with the planted path", async (t) => {
  t.after(cleanupOutFile);
  cleanupOutFile();
  let modelCalls = 0;
  const exitCode = await runControlPass(
    baseOptions({ repositoryContext: "off", plantFixturePath: "tests/fixtures/review-path-exclusion/planted-defect.json" }),
    {
      octokit: createOctokitWithFiles([
        { filename: "src/review/excluded-bytes.ts", patch: "@@ -0,0 +1 @@\n+export const real = 1;" },
      ]),
      githubToken: "test-token",
      getWriteAttempts: () => 0,
      configOverride: testConfig(),
      modelOverride: {
        modelName: "fake-model",
        async complete() {
          modelCalls += 1;
          return { content: JSON.stringify({ findings: [] }) };
        },
      },
    },
  );
  assert.equal(exitCode, 1);
  assert.equal(modelCalls, 0);
  const record = JSON.parse(readFileSync(join(REPO_ROOT, TEST_OUT_PATH), "utf8").trim().split("\n")[0]);
  assert.equal(record.outcome, "failed");
});

test("runControlPass refuses an unreadable --plant-fixture before reading the pull request", async () => {
  const octokit = {
    pulls: {
      get: async () => {
        throw new Error("must not be called when the fixture is invalid");
      },
    },
  } as unknown as Octokit;
  const exitCode = await runControlPass(baseOptions({ plantFixturePath: "tests/fixtures/review-path-exclusion/missing.json" }), {
    octokit,
    githubToken: "test-token",
    getWriteAttempts: () => 0,
  });
  assert.equal(exitCode, 1);
});
