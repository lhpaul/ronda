/**
 * Closed Codex GitHub reviewer alias list (AC39).
 * Compared case- and leading/trailing-whitespace-insensitively.
 * Expanding this list is a deliberate source change, not runtime config.
 */
export const CODEX_GITHUB_REVIEWER_ALIASES = [
  "chatgpt-codex-connector[bot]",
  "chatgpt-codex-connector",
  "codex-github",
  "codex",
] as const;

export type CodexGithubReviewerAlias =
  (typeof CODEX_GITHUB_REVIEWER_ALIASES)[number];

export function normalizeReviewerName(value: string): string {
  return value.trim().toLowerCase();
}

export function isCodexGithubReviewer(reviewer: string): boolean {
  const normalized = normalizeReviewerName(reviewer);
  return CODEX_GITHUB_REVIEWER_ALIASES.some(
    (alias) => normalizeReviewerName(alias) === normalized,
  );
}
