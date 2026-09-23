import type { ChangedFile } from "../domain/review-pass.types.js";
import type {
  AuthoritativeDocCatalogEntry,
  AuthoritativeDocRole,
  AuthoritativeDocSurface,
} from "../domain/authoritative-doc-catalog.js";
import { DEFAULT_AUTHORITATIVE_DOC_CATALOG } from "../domain/authoritative-doc-catalog.js";

export type AuthoritativeDocSkipReason =
  | "not_relevant"
  | "over_doc_count"
  | "over_doc_chars"
  | "unreadable"
  | "empty";

export interface AuthoritativeDocSkip {
  id: string;
  path: string;
  reason: AuthoritativeDocSkipReason;
}

export interface AuthoritativeDocCandidateResult {
  candidates: AuthoritativeDocCatalogEntry[];
  skipped: AuthoritativeDocSkip[];
}

export interface AuthoritativeDocWithText {
  id: string;
  path: string;
  role: AuthoritativeDocRole;
  priority: number;
  text: string | undefined;
}

export interface SelectedAuthoritativeDoc {
  id: string;
  path: string;
  role: AuthoritativeDocRole;
  text: string;
}

export interface AuthoritativeDocSelectionResult {
  selected: SelectedAuthoritativeDoc[];
  skipped: AuthoritativeDocSkip[];
}

export interface AuthoritativeDocBudgetLimits {
  maxAuthoritativeDocCount: number;
  maxAuthoritativeDocChars: number;
}

/** Collects current and previous paths from a pull request file list. */
export function collectChangedPaths(changedFiles: ChangedFile[]): string[] {
  const paths = new Set<string>();
  for (const file of changedFiles) {
    paths.add(file.path);
    if (file.previousPath) {
      paths.add(file.previousPath);
    }
  }
  return [...paths].sort();
}

function normalizeRepoPath(path: string): string {
  return path.replace(/\\/g, "/");
}

function basenameOf(repoPath: string): string {
  const normalized = normalizeRepoPath(repoPath);
  const parts = normalized.split("/");
  return parts[parts.length - 1] ?? repoPath;
}

function isSurfaceActivated(surface: AuthoritativeDocSurface, changedPaths: string[]): boolean {
  for (const rawPath of changedPaths) {
    const path = normalizeRepoPath(rawPath);
    switch (surface) {
      case "webhook_ingress":
        if (path === "src/webhook" || path.startsWith("src/webhook/")) {
          return true;
        }
        break;
      case "review_publication":
        if (path === "src/core/run-review-pass.ts") {
          return true;
        }
        if (path.startsWith("src/github/")) {
          const base = basenameOf(path);
          if (
            base === "review-publisher.ts" ||
            base === "check-run-publisher.ts" ||
            base === "pull-request-reader.ts"
          ) {
            return true;
          }
        }
        break;
      case "review_inference":
        if (path === "src/inference" || path.startsWith("src/inference/")) {
          return true;
        }
        break;
      case "operator_config":
        if (path === "src/config" || path.startsWith("src/config/")) {
          return true;
        }
        break;
      case "workflow_review_contract":
        if (path === "REVIEW.md") {
          return true;
        }
        if (path.startsWith("docs/workflow/") && path.includes("review")) {
          return true;
        }
        break;
      default: {
        const _exhaustive: never = surface;
        return _exhaustive;
      }
    }
  }
  return false;
}

function catalogEntryMatches(
  entry: AuthoritativeDocCatalogEntry,
  activatedSurfaces: Set<AuthoritativeDocSurface>,
): boolean {
  return entry.surfaces.some((surface) => activatedSurfaces.has(surface));
}

function sortCatalogEntries(
  entries: AuthoritativeDocCatalogEntry[],
): AuthoritativeDocCatalogEntry[] {
  return [...entries].sort(
    (left, right) => left.priority - right.priority || left.path.localeCompare(right.path),
  );
}

/**
 * Phase 1: pure relevance selection — no GitHub reads, no char budgets.
 */
export function selectAuthoritativeDocCandidates(
  changedPaths: string[],
  catalog: AuthoritativeDocCatalogEntry[] = DEFAULT_AUTHORITATIVE_DOC_CATALOG,
): AuthoritativeDocCandidateResult {
  const activated = new Set<AuthoritativeDocSurface>();
  for (const surface of [
    "webhook_ingress",
    "review_publication",
    "review_inference",
    "operator_config",
    "workflow_review_contract",
  ] as const) {
    if (isSurfaceActivated(surface, changedPaths)) {
      activated.add(surface);
    }
  }

  const sortedCatalog = sortCatalogEntries(catalog);
  const candidates: AuthoritativeDocCatalogEntry[] = [];
  const skipped: AuthoritativeDocSkip[] = [];

  for (const entry of sortedCatalog) {
    if (catalogEntryMatches(entry, activated)) {
      candidates.push(entry);
    } else {
      skipped.push({ id: entry.id, path: entry.path, reason: "not_relevant" });
    }
  }

  return { candidates, skipped };
}

/**
 * Phase 2: apply operator doc count and character budgets to fetched text.
 */
export function applyAuthoritativeDocBudgets(
  candidates: AuthoritativeDocWithText[],
  limits: AuthoritativeDocBudgetLimits,
): AuthoritativeDocSelectionResult {
  const ordered = [...candidates].sort(
    (left, right) => left.priority - right.priority || left.path.localeCompare(right.path),
  );

  const selected: SelectedAuthoritativeDoc[] = [];
  const skipped: AuthoritativeDocSkip[] = [];
  let runningChars = 0;

  for (const candidate of ordered) {
    if (candidate.text === undefined) {
      skipped.push({ id: candidate.id, path: candidate.path, reason: "unreadable" });
      continue;
    }
    if (candidate.text.length === 0) {
      skipped.push({ id: candidate.id, path: candidate.path, reason: "empty" });
      continue;
    }
    if (selected.length >= limits.maxAuthoritativeDocCount) {
      skipped.push({ id: candidate.id, path: candidate.path, reason: "over_doc_count" });
      continue;
    }
    if (candidate.text.length > limits.maxAuthoritativeDocChars) {
      skipped.push({ id: candidate.id, path: candidate.path, reason: "over_doc_chars" });
      continue;
    }
    if (runningChars + candidate.text.length > limits.maxAuthoritativeDocChars) {
      skipped.push({ id: candidate.id, path: candidate.path, reason: "over_doc_chars" });
      continue;
    }

    selected.push({
      id: candidate.id,
      path: candidate.path,
      role: candidate.role,
      text: candidate.text,
    });
    runningChars += candidate.text.length;
  }

  return { selected, skipped };
}
