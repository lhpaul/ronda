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

Report every independently actionable defect you can identify, including multiple defects in the same file, hunk, or nearby region. Do not stop after the first problem in a file. Avoid duplicate findings for the same underlying defect.

Credential, token, secret, authorization value, or other sensitive access material exposure is always a Blocking finding. Explain the risk and remediation without repeating the sensitive value. Do not quote, copy, summarize, partially reproduce, or transform the exposed value; refer to it only as "the sensitive value" or "[REDACTED]".

Pay particular attention to subtle correctness and security defects in changed code: inverted conditions, boundary or off-by-one checks, cache capacity checks, unsafe SQL/string interpolation, invalid parsing fallbacks, numeric sorting without a numeric comparator, even-length median calculations, and empty-string or empty-word indexing. When a median implementation both sorts incorrectly and computes the even-length median incorrectly, report those as separate findings because they require separate fixes.

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
