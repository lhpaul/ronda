import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeBenchmarkRepositoryContext,
  extractAddedFileText,
} from "../../../src/cli/recall-benchmark.js";
import type { ChangedFile } from "../../../src/domain/review-pass.types.js";

// --- extractAddedFileText --------------------------------------------------

test("extractAddedFileText reconstructs a whole-file-added patch's text", () => {
  const patch = "@@ -0,0 +1,2 @@\n+line one\n+line two\n";
  assert.equal(extractAddedFileText(patch), "line one\nline two");
});

test("extractAddedFileText returns undefined for a patch with context or deletion lines", () => {
  const patch = "@@ -1,2 +1,2 @@\n context\n-old\n+new\n";
  assert.equal(extractAddedFileText(patch), undefined);
});

test("extractAddedFileText returns undefined for an absent patch", () => {
  assert.equal(extractAddedFileText(undefined), undefined);
});

// --- computeBenchmarkRepositoryContext -------------------------------------

test("computeBenchmarkRepositoryContext resolves a candidate when the fixture directory provides one", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-benchmark-repo-context-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "src", "benchmark"), { recursive: true });
  writeFileSync(
    join(dir, "src", "benchmark", "util.ts"),
    "export function helper(x: number): number {\n  return x + 1;\n}\n",
  );

  const changedFiles: ChangedFile[] = [
    {
      path: "src/benchmark/caller.ts",
      status: "added",
      additions: 4,
      deletions: 0,
      patch: [
        "@@ -0,0 +1,4 @@",
        '+import { helper } from "./util.js";',
        "+",
        "+export function run(): number {",
        "+  return helper(1);",
        "+}",
      ].join("\n"),
    },
  ];

  const candidates = await computeBenchmarkRepositoryContext(changedFiles, dir);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].symbolName, "helper");
  assert.equal(candidates[0].path, "src/benchmark/util.ts");
});

test("computeBenchmarkRepositoryContext returns empty when the fixture directory does not exist", async () => {
  const changedFiles: ChangedFile[] = [
    {
      path: "src/benchmark/caller.ts",
      status: "added",
      additions: 1,
      deletions: 0,
      patch: '@@ -0,0 +1,1 @@\n+export const x = 1;',
    },
  ];
  const candidates = await computeBenchmarkRepositoryContext(changedFiles, "tests/fixtures/does-not-exist");
  assert.deepEqual(candidates, []);
});

test("computeBenchmarkRepositoryContext returns empty for the three current AC13 target seeds — none reference an external symbol", async () => {
  const patches: ChangedFile[] = JSON.parse(readFileSync("tests/fixtures/recall-benchmark/patches.json", "utf8"));
  const targetPaths = new Set([
    "src/benchmark/git-history.ts",
    "src/benchmark/output.ts",
    "src/benchmark/guard.ts",
  ]);
  const targetFiles = patches.filter((file) => targetPaths.has(file.path));
  assert.equal(targetFiles.length, 3, "the three AC13 target seed files must exist in the committed fixture");

  const candidates = await computeBenchmarkRepositoryContext(
    targetFiles,
    "tests/fixtures/recall-benchmark/repository-context",
  );
  assert.deepEqual(
    candidates,
    [],
    "AC13 admissibility: the three target seeds' changed lines reference no symbol outside their own file today",
  );
});

// --- #132: the repository-context seed fixture -----------------------------

const CONTEXT_SEEDS_DIR = "tests/fixtures/recall-benchmark/repository-context-seeds";
const CONTEXT_TREE_DIR = "tests/fixtures/recall-benchmark/repository-context";

interface ContextSeedManifest {
  seededDefects: Array<{ id: string; path: string; category: string }>;
  precisionFixtures: Array<{ id: string; changedFiles: ChangedFile[] }>;
}

test("#132 seed fixture: every seed's changed lines resolve the out-of-diff definition that carries its defect", async () => {
  const manifest: ContextSeedManifest = JSON.parse(readFileSync(`${CONTEXT_SEEDS_DIR}/manifest.json`, "utf8"));
  const patches: ChangedFile[] = JSON.parse(readFileSync(`${CONTEXT_SEEDS_DIR}/patches.json`, "utf8"));
  // Each seed's defect is stated only in the body of this definition, which
  // lives in the repository-context tree and never in the seed's own patch.
  const expectedDefinition: Record<string, { symbolName: string; path: string }> = {
    "ctx-state-reconstruction-event-order": {
      symbolName: "listDeployEvents",
      path: "src/benchmark/ctx/deploy-events.ts",
    },
    "ctx-state-reconstruction-first-page": { symbolName: "listReviews", path: "src/benchmark/ctx/review-api.ts" },
    "ctx-lossy-parsing-fatal-level": { symbolName: "parseCheckerLine", path: "src/benchmark/ctx/checker-output.ts" },
    "ctx-lossy-parsing-unrecognised-summary": {
      symbolName: "parseTestSummary",
      path: "src/benchmark/ctx/test-summary.ts",
    },
  };
  assert.deepEqual(
    manifest.seededDefects.map((seed) => seed.id).sort(),
    Object.keys(expectedDefinition).sort(),
  );
  for (const seed of manifest.seededDefects) {
    const file = patches.find((candidate) => candidate.path === seed.path);
    assert.ok(file, `${seed.id}: its changed file must be in patches.json`);
    const expected = expectedDefinition[seed.id];
    assert.ok(
      !(file.patch ?? "").includes(`function ${expected.symbolName}`),
      `${seed.id}: the definition must be outside the diff`,
    );
    const candidates = await computeBenchmarkRepositoryContext([file], CONTEXT_TREE_DIR);
    assert.ok(
      candidates.some((c) => c.symbolName === expected.symbolName && c.path === expected.path),
      `${seed.id}: expected ${expected.symbolName} from ${expected.path}`,
    );
  }
});

test("#132 seed fixture: the clean precision fixture also receives repository context, so paired precision is measured under the arm", async () => {
  const manifest: ContextSeedManifest = JSON.parse(readFileSync(`${CONTEXT_SEEDS_DIR}/manifest.json`, "utf8"));
  assert.equal(manifest.precisionFixtures.length, 1);
  const candidates = await computeBenchmarkRepositoryContext(manifest.precisionFixtures[0].changedFiles, CONTEXT_TREE_DIR);
  assert.ok(candidates.some((c) => c.symbolName === "DeployEvent"));
});

test("#132 seed fixture is separate: the extended fixture's committed manifest and patches are untouched by it", () => {
  const extended = JSON.parse(readFileSync("tests/fixtures/recall-benchmark/manifest.json", "utf8")) as ContextSeedManifest;
  const contextSeeds = JSON.parse(readFileSync(`${CONTEXT_SEEDS_DIR}/manifest.json`, "utf8")) as ContextSeedManifest;
  const extendedIds = new Set(extended.seededDefects.map((seed) => seed.id));
  for (const seed of contextSeeds.seededDefects) {
    assert.equal(extendedIds.has(seed.id), false, `${seed.id} must not be added to the extended fixture`);
  }
  assert.equal(extended.seededDefects.length, 18);
});
