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
