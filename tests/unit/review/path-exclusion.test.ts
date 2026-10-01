import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EXCLUDED_PATH_GLOBS,
  filterExcludedFiles,
  getGlobMatchStepCounterForTests,
  matchesGlob,
  resetGlobMatchStepCounterForTests,
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

// Regression tests for a catastrophic-backtracking (ReDoS) hazard in an
// earlier glob-to-regex implementation. Path segments are fully
// attacker-controlled (any PR author names any file at any depth), so a
// glob matcher must stay polynomial — never exponential — under an
// adversarial path, even for a glob with several chained wildcards.

// These two tests assert an operation-count bound rather than a wall-clock
// duration: `getGlobMatchStepCounterForTests()` counts the loop iterations
// `matchSegment`/`segmentsMatch` actually perform (#137 review finding — a
// `Date.now()` threshold is flaky under system load; an operation count is
// deterministic and machine-independent). A polynomial two-pointer matcher
// performs at most a small constant multiple of `path.length + glob.length`
// iterations; the exponential backtracking this guards against would blow
// past that bound by orders of magnitude for these adversarial inputs.

test("matchesGlob: many chained ** segments against a deep non-matching path stays within a linear operation bound, not exponential", () => {
  const glob = "**/**/**/**/**/**/**/**/**/**/*.json";
  const path = `${"a/".repeat(30)}b`;
  resetGlobMatchStepCounterForTests();
  const result = matchesGlob(path, glob);
  const steps = getGlobMatchStepCounterForTests();
  const linearBound = 20 * (path.length + glob.length);
  assert.equal(result, false);
  assert.ok(
    steps < linearBound,
    `expected a linear-time step count (< ${linearBound}), counted ${steps}`,
  );
});

test("matchesGlob: many chained * wildcards within one segment against a non-matching run stays within a linear operation bound", () => {
  const glob = `${"*a".repeat(30)}*.json`;
  const path = `${"a".repeat(40)}x`;
  resetGlobMatchStepCounterForTests();
  const result = matchesGlob(path, glob);
  const steps = getGlobMatchStepCounterForTests();
  const linearBound = 20 * (path.length + glob.length);
  assert.equal(result, false);
  assert.ok(
    steps < linearBound,
    `expected a linear-time step count (< ${linearBound}), counted ${steps}`,
  );
});

test("matchesGlob: ** requires a segment boundary, not a mid-filename prefix", () => {
  // A regex compiled as `(?:.*/)?package-lock\.json` would (correctly) also
  // reject this, but a naive simplification that drops the segment-boundary
  // requirement would wrongly accept it. Locks in the correct behavior.
  assert.equal(matchesGlob("xpackage-lock.json", "**/package-lock.json"), false);
});

test("matchesGlob: regex-special characters in a literal segment are matched literally, not as metacharacters", () => {
  assert.equal(matchesGlob("docs/testing/ronda/a+b(c).json", "docs/testing/ronda/**/*.json"), true);
  assert.equal(matchesGlob("docs/testing/ronda/a.json", "docs/testing/ronda/a.json"), true);
  assert.equal(matchesGlob("docsXtesting/ronda/a.json", "docs.testing/ronda/a.json"), false);
});

// Regression test for a literal "*" in a path segment defeating the
// wildcard-position backtracking (#137 review finding on PR #137): a filename
// that itself contains "*" must not short-circuit into a literal-equality
// match against a "*" in the pattern, or the matcher loses its backtracking
// position and a later mismatch fails outright instead of retrying with the
// wildcard expanded further.
test("matchesGlob: a literal '*' in the filename does not defeat wildcard backtracking", () => {
  assert.equal(matchesGlob("src/*foo.generated.ts", "**/*.generated.*"), true);
  assert.equal(matchesGlob("*.generated.ts", "**/*.generated.*"), true);
  assert.equal(matchesGlob("src/a*b*c.generated.ts", "**/*.generated.*"), true);
  assert.equal(matchesGlob("src/*foo.generated.ts", "**/*.txt"), false);
});
