import type { ChangedFile } from "../domain/review-pass.types.js";

/** Why a changed file never reached prompt construction (#134). */
export type ExcludedFileReason = "default_glob" | "configured_glob" | "no_patch";

export interface ExcludedFile {
  path: string;
  reason: ExcludedFileReason;
}

export interface PathExclusionResult {
  /** Files that still go into the prompt, unchanged. */
  included: ChangedFile[];
  /** Every excluded file, in the order it was read — always named, never silent. */
  excluded: ExcludedFile[];
}

/**
 * Defaults safe everywhere (#134, proposed change item 1): lockfiles across
 * the common package managers, and generated/minified output conventions.
 * These are never configurable — a repository cannot opt back into reviewing
 * a lockfile diff, matching how `RONDA_REPOSITORY_CONTEXT`'s fork exclusion
 * is a fixed rule rather than a switch.
 */
export const DEFAULT_EXCLUDED_PATH_GLOBS: readonly string[] = [
  "**/package-lock.json",
  "**/npm-shrinkwrap.json",
  "**/pnpm-lock.yaml",
  "**/yarn.lock",
  "**/composer.lock",
  "**/Gemfile.lock",
  "**/Cargo.lock",
  "**/poetry.lock",
  "**/Pipfile.lock",
  "**/mix.lock",
  "**/go.sum",
  "**/*.min.js",
  "**/*.min.css",
  "**/*.map",
  "**/dist/**",
  "**/build/**",
  "**/vendor/**",
  "**/*.generated.*",
];

/**
 * Matches one path segment (no `/`) against one glob segment (no `/`)
 * supporting `*` (any run of characters, including none) and `?` (exactly
 * one character). Implemented as the classic linear two-pointer wildcard
 * algorithm (the same technique as LeetCode 44 "Wildcard Matching") rather
 * than a backtracking regular expression: it remembers only the most recent
 * `*` position and greedily advances, which is polynomial in the length of
 * `text` and `pattern` and cannot exhibit the exponential-time catastrophic
 * backtracking a `[^/]*a[^/]*a[^/]*...` style regex has when matched against
 * an adversarial (fully attacker-controlled, via PR file paths) input — see
 * the regression tests in `path-exclusion.test.ts`.
 */
function matchSegment(text: string, pattern: string): boolean {
  let ti = 0;
  let pi = 0;
  let starIdx = -1;
  let matchIdx = 0;
  while (ti < text.length) {
    if (pi < pattern.length && (pattern[pi] === "?" || pattern[pi] === text[ti])) {
      ti += 1;
      pi += 1;
    } else if (pi < pattern.length && pattern[pi] === "*") {
      starIdx = pi;
      matchIdx = ti;
      pi += 1;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx += 1;
      ti = matchIdx;
    } else {
      return false;
    }
  }
  while (pi < pattern.length && pattern[pi] === "*") {
    pi += 1;
  }
  return pi === pattern.length;
}

/**
 * Matches a sequence of path segments against a sequence of glob segments,
 * where a glob segment that is exactly `**` matches zero or more whole path
 * segments (crossing `/`, unlike a plain `*`). Same linear two-pointer
 * technique as {@link matchSegment}, one level up: at most one pending `**`
 * backtrack point is remembered at a time, so this is polynomial — never
 * exponential — in the number of path and glob segments.
 */
function segmentsMatch(pathSegs: string[], globSegs: string[]): boolean {
  let pi = 0;
  let gi = 0;
  let starIdx = -1;
  let matchIdx = 0;
  while (pi < pathSegs.length) {
    if (gi < globSegs.length && globSegs[gi] !== "**" && matchSegment(pathSegs[pi], globSegs[gi])) {
      pi += 1;
      gi += 1;
    } else if (gi < globSegs.length && globSegs[gi] === "**") {
      starIdx = gi;
      matchIdx = pi;
      gi += 1;
    } else if (starIdx !== -1) {
      gi = starIdx + 1;
      matchIdx += 1;
      pi = matchIdx;
    } else {
      return false;
    }
  }
  while (gi < globSegs.length && globSegs[gi] === "**") {
    gi += 1;
  }
  return gi === globSegs.length;
}

/**
 * Matches a repository-relative changed-file path against one glob pattern.
 * No external dependency: the supported vocabulary (`**` crossing `/`, `*`
 * and `?` within one segment) is exactly what this repository's own default
 * and configured patterns need (see `DEFAULT_EXCLUDED_PATH_GLOBS` and #134's
 * `docs/testing/ronda/**\/*.json` / `tests/fixtures/recall-benchmark/**`
 * examples). Deliberately not regex-based: path segments are fully
 * attacker-controlled (any PR author names any file at any depth), and a
 * naive glob-to-regex translation is a well-known catastrophic-backtracking
 * (ReDoS) hazard once more than a couple of wildcards are chained.
 */
export function matchesGlob(path: string, glob: string): boolean {
  return segmentsMatch(path.split("/"), glob.split("/"));
}

function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}

/**
 * Applies the review path-exclusion step (#134) before prompt construction.
 * Order of checks, each independent and each named on exclusion:
 *
 * 1. Repository-configured globs (operator/workflow input — everything
 *    repository-specific; see `RondaConfig.excludePathGlobs`).
 * 2. Fixed defaults safe everywhere (`DEFAULT_EXCLUDED_PATH_GLOBS`).
 * 3. Files GitHub returns without a `patch` — binary files, or diffs GitHub
 *    declines to return. There is no diff text to review.
 *
 * A file matching more than one check is recorded once, under the
 * highest-priority reason that matched (configured over default over
 * no-patch), so the count in the published summary always equals
 * `excluded.length`.
 */
export function filterExcludedFiles(
  changedFiles: ChangedFile[],
  configuredGlobs: readonly string[],
): PathExclusionResult {
  const included: ChangedFile[] = [];
  const excluded: ExcludedFile[] = [];

  for (const file of changedFiles) {
    if (configuredGlobs.length > 0 && matchesAny(file.path, configuredGlobs)) {
      excluded.push({ path: file.path, reason: "configured_glob" });
      continue;
    }
    if (matchesAny(file.path, DEFAULT_EXCLUDED_PATH_GLOBS)) {
      excluded.push({ path: file.path, reason: "default_glob" });
      continue;
    }
    if (file.patch === undefined) {
      excluded.push({ path: file.path, reason: "no_patch" });
      continue;
    }
    included.push(file);
  }

  return { included, excluded };
}
