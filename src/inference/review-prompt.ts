import type { ChangedFile } from "../domain/review-pass.types.js";

export interface BuildReviewPromptInput {
  title: string;
  body: string;
  changedFiles: ChangedFile[];
  maxPatchChars: number;
}

export interface ReviewPrompt {
  systemPrompt: string;
  userPrompt: string;
}

/** Thrown when the combined patch text exceeds `maxPatchChars`. Never silently truncated. */
export class ChangesTooLargeError extends Error {}

const SYSTEM_PROMPT = `You are Ronda, a comment-only GitHub pull-request reviewer. You never suggest a commit or a merge; you only report findings for a human or another automated fixer to act on.

Respond with ONLY a single JSON object matching this exact contract and nothing else — no prose, no Markdown fence:
{"findings":[{"path":"relative/file/path","line":42,"severity":"blocking"|"important"|"nit","title":"Short imperative title","body":"Why this matters and what to do about it."}]}

Severity meanings:
- "blocking": a correctness, security, or data-loss problem the author should fix before merging.
- "important": a real problem worth fixing that does not by itself block the merge.
- "nit": style, naming, or clarity. Informational.

If you find nothing, respond with {"findings":[]}. Use "line" as the right-side (new file) line number the finding applies to, or omit it when the finding does not map to one line.`;

/**
 * Composes the system instruction and the user message (title, body, and
 * every changed file's path, status, and patch). Fails fast with
 * `ChangesTooLargeError` when the combined patch text exceeds the budget
 * rather than silently truncating it.
 */
export function buildReviewPrompt(input: BuildReviewPromptInput): ReviewPrompt {
  const patchSections = input.changedFiles.map((file) => {
    const patch = file.patch ?? "(no textual diff available for this file)";
    return `### ${file.path} (${file.status})\n${patch}`;
  });
  const combined = patchSections.join("\n\n");

  if (combined.length > input.maxPatchChars) {
    throw new ChangesTooLargeError(
      `Combined patch text is ${combined.length} characters, exceeding the ${input.maxPatchChars} character budget`,
    );
  }

  const userPrompt = [
    `Pull request title: ${input.title}`,
    "Pull request description:",
    input.body.trim().length > 0 ? input.body : "(no description provided)",
    "",
    "Changed files:",
    combined.length > 0 ? combined : "(no changed files)",
  ].join("\n");

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}
