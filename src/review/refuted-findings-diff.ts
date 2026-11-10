const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Maps new-side line numbers to their source text (added and context lines). */
export function parseDiffNewSideLines(patch: string | undefined): Map<number, string> {
  const out = new Map<number, string>();
  if (!patch) return out;
  let right: number | null = null;
  for (const line of patch.split(/\r\n|\n/)) {
    if (line.startsWith("@@ -")) {
      const match = HUNK_HEADER.exec(line);
      right = match ? parseInt(match[1], 10) : null;
      continue;
    }
    if (right === null || line.startsWith("\\") || line.startsWith("-")) continue;
    out.set(right, line.slice(1));
    right += 1;
  }
  return out;
}
