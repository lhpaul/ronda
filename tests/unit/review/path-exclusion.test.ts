import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXCLUDED_PATH_GLOBS,
  filterExcludedFiles,
  matchesGlob,
} from "../../../src/review/path-exclusion.js";
import type { ChangedFile } from "../../../src/domain/review-pass.types.js";

function changedFile(overrides: Partial<ChangedFile> & { path: string }): ChangedFile {
  return {
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: "@@ -1 +1 @@\n-old\n+new",
    ...overrides,
  };
}

test("matchesGlob: a leading-** glob matches at any depth, including the root", () => {
  assert.equal(matchesGlob("package-lock.json", "**/package-lock.json"), true);
  assert.equal(matchesGlob("packages/api/package-lock.json", "**/package-lock.json"), true);
  assert.equal(matchesGlob("package-lock.json.bak", "**/package-lock.json"), false);
});

test("matchesGlob: a trailing-** glob matches every path under a directory", () => {
  assert.equal(matchesGlob("tests/fixtures/recall-benchmark/a.json", "tests/fixtures/recall-benchmark/**"), true);
  assert.equal(
    matchesGlob("tests/fixtures/recall-benchmark/nested/deep/b.json", "tests/fixtures/recall-benchmark/**"),
    true,
  );
  assert.equal(matchesGlob("tests/fixtures/other/a.json", "tests/fixtures/recall-benchmark/**"), false);
});

test("matchesGlob: an internal-** glob composes with a filename pattern", () => {
  assert.equal(matchesGlob("docs/testing/ronda/sweep-on.json", "docs/testing/ronda/**/*.json"), true);
  assert.equal(
    matchesGlob("docs/testing/ronda/nested/dir/sweep-on.json", "docs/testing/ronda/**/*.json"),
    true,
  );
  assert.equal(matchesGlob("docs/testing/ronda/sweep-on.txt", "docs/testing/ronda/**/*.json"), false);
});

test("DEFAULT_EXCLUDED_PATH_GLOBS covers the common lockfiles named in the issue", () => {
  const lockfiles = ["package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
  for (const path of lockfiles) {
    assert.ok(
      DEFAULT_EXCLUDED_PATH_GLOBS.some((glob) => matchesGlob(path, glob)),
      `expected a default glob to exclude ${path}`,
    );
  }
});

test("filterExcludedFiles: a default-glob lockfile is excluded with reason default_glob", () => {
  const files = [changedFile({ path: "package-lock.json" })];
  const result = filterExcludedFiles(files, []);
  assert.equal(result.included.length, 0);
  assert.deepEqual(result.excluded, [{ path: "package-lock.json", reason: "default_glob" }]);
});

test("filterExcludedFiles: a repository-configured glob excludes a recorded-evidence file", () => {
  const files = [
    changedFile({ path: "docs/testing/ronda/sweep-on-precision.json" }),
    changedFile({ path: "tests/fixtures/recall-benchmark/original-thirteen/case-1.json" }),
  ];
  const result = filterExcludedFiles(files, [
    "docs/testing/ronda/**/*.json",
    "tests/fixtures/recall-benchmark/**",
  ]);
  assert.equal(result.included.length, 0);
  assert.equal(result.excluded.length, 2);
  assert.ok(result.excluded.every((file) => file.reason === "configured_glob"));
});

test("filterExcludedFiles: a file GitHub returns with no patch is excluded as no_patch", () => {
  const files = [changedFile({ path: "assets/logo.png", patch: undefined })];
  const result = filterExcludedFiles(files, []);
  assert.equal(result.included.length, 0);
  assert.deepEqual(result.excluded, [{ path: "assets/logo.png", reason: "no_patch" }]);
});

test("filterExcludedFiles: a non-excluded .ts file with a real patch is always included — isolating proof", () => {
  const files = [
    changedFile({ path: "docs/testing/ronda/sweep-on-precision.json" }),
    changedFile({ path: "src/core/run-review-pass.ts" }),
  ];
  const result = filterExcludedFiles(files, ["docs/testing/ronda/**/*.json"]);
  assert.equal(result.included.length, 1);
  assert.equal(result.included[0].path, "src/core/run-review-pass.ts");
  assert.equal(result.excluded.length, 1);
  assert.equal(result.excluded[0].path, "docs/testing/ronda/sweep-on-precision.json");
});

test("filterExcludedFiles: no configured globs leaves default-safe files untouched", () => {
  const files = [changedFile({ path: "src/core/run-review-pass.ts" })];
  const result = filterExcludedFiles(files, []);
  assert.deepEqual(result.included, files);
  assert.deepEqual(result.excluded, []);
});

test("filterExcludedFiles: an empty changed-file list returns empty results without error", () => {
  const result = filterExcludedFiles([], ["**/*.json"]);
  assert.deepEqual(result.included, []);
  assert.deepEqual(result.excluded, []);
});
