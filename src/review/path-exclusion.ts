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
 * Translates one glob pattern into an anchored `RegExp`. Supports `**`
 * (any number of path segments, including none), `*` (any run of characters
 * within one segment), and `?` (one character). Every other regex
 * metacharacter in the literal segments is escaped. No external dependency:
 * the supported vocabulary is exactly what this repository's own default and
 * configured patterns need (see `DEFAULT_EXCLUDED_PATH_GLOBS` and #134's
 * `docs/testing/ronda/**\/*.json` / `tests/fixtures/recall-benchmark/**`
 * examples).
 */
function globToRegExp(glob: string): RegExp {
  let pattern = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        // `**` — greedily match across path separators, including zero segments.
        // Swallow an immediately following slash so `**/foo` also matches `foo`.
        i += 1;
        if (glob[i + 1] === "/") {
          i += 1;
          pattern += "(?:.*/)?";
        } else {
          pattern += ".*";
        }
      } else {
        pattern += "[^/]*";
      }
    } else if (char === "?") {
      pattern += "[^/]";
    } else {
      pattern += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${pattern}$`);
}

/** Matches a repository-relative changed-file path against one glob pattern. */
export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
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
