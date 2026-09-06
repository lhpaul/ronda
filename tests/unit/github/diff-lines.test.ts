import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildCommentableLinesByFile,
  parseCommentableLines,
} from "../../../src/github/diff-lines.js";

const fixturesPath = fileURLToPath(
  new URL("../../fixtures/patches.json", import.meta.url),
);
const patches = JSON.parse(readFileSync(fixturesPath, "utf8")) as Record<string, string>;

function assertLines(actual: Set<number>, expected: number[]): void {
  assert.deepEqual([...actual].sort((a, b) => a - b), expected);
}

test("P1: mixed context, addition, and deletion advances right-side numbers on context/addition only", () => {
  assertLines(parseCommentableLines(patches.P1), [1, 2, 3, 4]);
});

test("P2: omitted counts default to 1; the single right-side line is commentable", () => {
  assertLines(parseCommentableLines(patches.P2), [1]);
});

test("P3: new file — every added line is commentable", () => {
  assertLines(
    parseCommentableLines(patches.P3),
    Array.from({ length: 12 }, (_, index) => index + 1),
  );
});

test("P4: file emptied — empty set", () => {
  assertLines(parseCommentableLines(patches.P4), []);
});

test("P5: trailing hunk-header text is ignored, not parsed as a diff line", () => {
  assertLines(parseCommentableLines(patches.P5), [10, 11, 12]);
});

test("P6: two hunks — the right-side counter resets from each header", () => {
  assertLines(parseCommentableLines(patches.P6), [1, 2, 10, 11]);
});

test("P7: a deletion line does not advance the right-side counter", () => {
  assertLines(parseCommentableLines(patches.P7), [1, 2]);
});

test("P8: '\\ No newline at end of file' is ignored", () => {
  assertLines(parseCommentableLines(patches.P8), [1, 2]);
});

test("P9: a content line starting with '@@' is treated as content, not a header", () => {
  assertLines(parseCommentableLines(patches.P9), [1, 2]);
});

test("P10: undefined patch (binary file) yields an empty set", () => {
  assertLines(parseCommentableLines(undefined), []);
});

test("P11: empty-string patch yields an empty set", () => {
  assertLines(parseCommentableLines(patches.P11), []);
});

test("P12: CRLF line endings parse identically to LF", () => {
  assertLines(parseCommentableLines(patches.P12), [1, 2]);
});

test("P13: a renamed file's lines are keyed to the new filename, never previousPath", () => {
  const byFile = buildCommentableLinesByFile([
    {
      path: "new/name.ts",
      previousPath: "old/name.ts",
      status: "renamed",
      patch: patches.P13,
      additions: 1,
      deletions: 0,
    },
  ]);
  assert.equal(byFile.has("new/name.ts"), true);
  assert.equal(byFile.has("old/name.ts"), false);
  assertLines(byFile.get("new/name.ts") as Set<number>, [1, 2]);
});

test("P14: a malformed header is skipped without throwing; later well-formed hunks still parse", () => {
  assertLines(parseCommentableLines(patches.P14), [5, 6]);
});

test("P15: a combined-diff header is not recognised as a hunk header — empty set", () => {
  assertLines(parseCommentableLines(patches.P15), []);
});

test("P16: lines before the first hunk header are ignored", () => {
  assertLines(parseCommentableLines(patches.P16), [1, 2]);
});
