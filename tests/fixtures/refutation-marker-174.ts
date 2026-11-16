/**
 * Offline fixture for #174 (refutation-marker dedupe). It reproduces the
 * motivating case from #158: an authorization guard a few lines above a
 * protected write. A maintainer refutes "missing authorization check" because
 * the guard exists; a later commit removes the guard and leaves the write
 * line unchanged. The renewed finding must be published.
 */
import type { ChangedFile, ReviewThread, ReviewThreadComment } from "../../src/domain/review-pass.types.js";

export const FILE_PATH = "src/handlers/update-profile.ts";
export const OTHER_PATH = "src/handlers/delete-profile.ts";

/** 40-line handler. Guard on line 26, protected write on line 30. */
function handlerLines(): string[] {
  const lines: string[] = ["// Profile update handler."];
  for (let i = 2; i <= 23; i += 1) lines.push(`const step${i} = ${i};`);
  lines.push("export async function updateProfile(user: User, input: ProfileInput): Promise<void> {");
  lines.push("  const profile = await profiles.load(input.id);");
  lines.push("  if (profile.ownerId !== user.id) throw new ForbiddenError();");
  lines.push("  const next = { ...profile, name: input.name };");
  lines.push("  audit.record(user.id, profile.id);");
  lines.push("  metrics.increment(\"profile_update\");");
  lines.push("  await profiles.save(next);");
  lines.push("}");
  for (let i = 32; i <= 40; i += 1) lines.push(`const tail${i} = ${i};`);
  return lines;
}

export const GUARD_LINE = 26;
export const WRITE_LINE = 30;

/** Head where the guard exists. */
export const HEAD_WITH_GUARD = `${handlerLines().join("\n")}\n`;

/** Later head: the guard line is removed; the write line text is unchanged (now line 29). */
export const HEAD_GUARD_REMOVED = `${handlerLines()
  .filter((_, index) => index !== GUARD_LINE - 1)
  .join("\n")}\n`;
export const WRITE_LINE_AFTER_REMOVAL = WRITE_LINE - 1;

/** Later head: only the first line changes, outside the cited-code window of line 30. */
export const HEAD_FAR_CHANGE = HEAD_WITH_GUARD.replace("// Profile update handler.", "// Profile update handler (v2).");

/** A changed file whose patch adds every line, so every line is commentable. */
export function addedFile(path: string, text: string): ChangedFile {
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
  return {
    path,
    status: "added",
    patch: `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}`,
    additions: lines.length,
    deletions: 0,
  };
}

export const REFUTED_TITLE = "Profile write is missing an authorization check";

/** The claim a maintainer refutes. */
export function authorizationFinding(line: number = WRITE_LINE, title: string = REFUTED_TITLE) {
  return {
    path: FILE_PATH,
    line,
    severity: "important",
    title,
    body: "`profiles.save` runs without verifying the caller owns the profile.",
  };
}

export const OTHER_CLAIM_FINDING = {
  path: FILE_PATH,
  line: WRITE_LINE,
  severity: "nit",
  title: "Profile write ignores input validation",
  body: "`input.name` is saved without a length check.",
};

export function botRoot(body: string): ReviewThreadComment {
  return { body, authorAssociation: "NONE", authorIsBot: true };
}

export function reply(body: string, authorAssociation = "OWNER"): ReviewThreadComment {
  return { body, authorAssociation, authorIsBot: false };
}

export const REFUTATION_REPLY = reply("/ronda refuted\nThe ownership guard two lines above covers this write.");

/** A resolved Ronda thread on `path` whose root is `rootBody` and whose replies are `replies`. */
export function thread(
  rootBody: string,
  replies: ReviewThreadComment[] = [REFUTATION_REPLY],
  options: { isResolved?: boolean; path?: string; root?: ReviewThreadComment } = {},
): ReviewThread {
  return {
    isResolved: options.isResolved ?? true,
    path: options.path ?? FILE_PATH,
    comments: [options.root ?? botRoot(rootBody), ...replies],
  };
}
