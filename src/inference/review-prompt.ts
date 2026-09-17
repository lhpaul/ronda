import type { ChangedFile } from "../domain/review-pass.types.js";

export interface AuthoritativeDocExcerpt {
  id: string;
  path: string;
  role: "binding" | "advisory";
  text: string;
}

export interface BuildReviewPromptInput {
  title: string;
  body: string;
  changedFiles: ChangedFile[];
  maxPatchChars: number;
  authoritativeDocs?: AuthoritativeDocExcerpt[];
  maxAuthoritativeDocCount?: number;
  maxAuthoritativeDocChars?: number;
}

export interface ReviewPrompt {
  systemPrompt: string;
  userPrompt: string;
}

/** Thrown when the combined patch text exceeds `maxPatchChars`. Never silently truncated. */
export class ChangesTooLargeError extends Error {}

/** Thrown when authoritative doc excerpts exceed configured budgets (defensive double-check). */
export class AuthoritativeDocsTooLargeError extends Error {}

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

function assertAuthoritativeDocBudget(input: BuildReviewPromptInput): void {
  const docs = input.authoritativeDocs;
  if (!docs || docs.length === 0) {
    return;
  }
  const maxCount = input.maxAuthoritativeDocCount ?? Number.POSITIVE_INFINITY;
  const maxChars = input.maxAuthoritativeDocChars ?? Number.POSITIVE_INFINITY;
  const charTotal = docs.reduce((sum, doc) => sum + doc.text.length, 0);
  if (docs.length > maxCount || charTotal > maxChars) {
    throw new AuthoritativeDocsTooLargeError(
      `Authoritative doc excerpts are ${docs.length} doc(s) / ${charTotal} characters, exceeding the ${maxCount} doc / ${maxChars} character budget`,
    );
  }
}

function renderAuthoritativeDocSections(docs: AuthoritativeDocExcerpt[]): string[] {
  const binding = docs.filter((doc) => doc.role === "binding");
  const advisory = docs.filter((doc) => doc.role === "advisory");
  const sections: string[] = [];

  if (binding.length > 0) {
    sections.push(
      "## Authoritative repository documentation (binding)",
      "Each excerpt is a product or review constraint. Do not recommend changes that violate these rules.",
      "",
    );
    for (const doc of binding) {
      sections.push(`### [binding] ${doc.path}`, doc.text, "");
    }
  }

  if (advisory.length > 0) {
    sections.push(
      "## Authoritative repository documentation (advisory)",
      "Use for context; prefer explicit diff evidence when they disagree.",
      "",
    );
    for (const doc of advisory) {
      sections.push(`### [advisory] ${doc.path}`, doc.text, "");
    }
  }

  return sections;
}

/**
 * Composes the system instruction and the user message (title, body, and
 * every changed file's path, status, and patch). Fails fast with
 * `ChangesTooLargeError` when the combined patch text exceeds the budget
 * rather than silently truncating it.
 */
export function buildReviewPrompt(input: BuildReviewPromptInput): ReviewPrompt {
  assertAuthoritativeDocBudget(input);

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

  const docSections =
    input.authoritativeDocs && input.authoritativeDocs.length > 0
      ? renderAuthoritativeDocSections(input.authoritativeDocs)
      : [];

  const userPrompt = [
    `Pull request title: ${input.title}`,
    "Pull request description:",
    input.body.trim().length > 0 ? input.body : "(no description provided)",
    "",
    "Changed files:",
    combined.length > 0 ? combined : "(no changed files)",
    ...docSections,
  ].join("\n");

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}
