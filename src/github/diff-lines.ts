import type { ChangedFile } from "../domain/review-pass.types.js";

/** Any line that looks like an attempt at a unified-diff hunk header (`@@ -`). */
const HEADER_ATTEMPT = /^@@ -/;
/** A well-formed unified-diff hunk header. Capture group 1 is the new-side start line. */
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Returns the set of right-side (new file) line numbers a review comment
 * may attach to, given one file's unified-diff `patch` text. See the
 * implementation plan's parser-risk addendum, rows P1-P16, for the full
 * edge-case table this function is built against.
 */
export function parseCommentableLines(patch: string | undefined): Set<number> {
  const commentable = new Set<number>();
  if (!patch) {
    return commentable; // P10, P11
  }

  const lines = patch.split(/\r\n|\n/);
  // null: not currently inside a recognised hunk (before the first header,
  // inside a malformed hunk, or the file has no hunks at all).
  let rightLine: number | null = null;

  for (const line of lines) {
    if (HEADER_ATTEMPT.test(line)) {
      const match = HUNK_HEADER.exec(line);
      // A malformed header (P14) sets rightLine back to null so its body is
      // skipped without throwing, while a later well-formed header can still
      // resume parsing (P6 resets per header rather than accumulating).
      rightLine = match ? parseInt(match[1], 10) : null;
      continue;
    }
    if (rightLine === null) {
      continue; // P15, P16
    }
    if (line.startsWith("\\")) {
      continue; // P8 "\ No newline at end of file"
    }
    if (line.startsWith("-")) {
      continue; // P7 deletion — does not advance the right-side counter
    }
    // Context or addition line (P9: a "+@@ ..." content line lands here too,
    // because HEADER_ATTEMPT only matches lines starting with "@@ -").
    commentable.add(rightLine);
    rightLine += 1;
  }

  return commentable;
}

/**
 * Maps each changed file to its commentable line set, keyed by the file's
 * current path — a renamed file's lines are always keyed to `path`, never
 * `previousPath` (P13).
 */
export function buildCommentableLinesByFile(
  files: ChangedFile[],
): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const file of files) {
    map.set(file.path, parseCommentableLines(file.patch));
  }
  return map;
}
