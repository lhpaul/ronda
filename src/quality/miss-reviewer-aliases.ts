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

/**
 * Canonical reviewer spelling for content-based identity (AC39).
 * Codex GitHub aliases collapse to the primary login; all other names are
 * compared case- and whitespace-insensitively via {@link normalizeReviewerName}.
 */
export function canonicalizeReviewerForIdentity(reviewer: string): string {
  const normalized = normalizeReviewerName(reviewer);
  if (
    CODEX_GITHUB_REVIEWER_ALIASES.some(
      (alias) => normalizeReviewerName(alias) === normalized,
    )
  ) {
    return normalizeReviewerName(CODEX_GITHUB_REVIEWER_ALIASES[0]);
  }
  return normalized;
}
