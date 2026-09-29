import type {
  RepositoryContextCandidate,
  RepositoryContextCandidateKind,
  RepositoryContextDrop,
  RepositoryContextDropReason,
  RepositoryContextOutcome,
} from "../domain/review-pass.types.js";

/**
 * Pure selection-order, budget, and outcome-resolution logic for read-only
 * repository context (#106). Deliberately holds **no** parsing or binding
 * logic — that is `src/review/symbol-resolver.ts`'s job (D2). This module
 * never reads a file and never touches the network.
 */

/**
 * One symbol reference the changed lines depend on, identified before
 * resolution. `id` is an opaque identity distinguishing two references that
 * share a `symbolName` but bind to different declarations (a shadowed local,
 * for instance) — see the module-resolution contract's "distinct referenced
 * symbol" note. `changedPath`/`changedLine` are the **earliest** changed
 * line that names the reference — priority key 1, known at request time
 * before any resolution happens.
 */
export interface RepositoryContextRequestedReference {
  id: number;
  kind: RepositoryContextCandidateKind;
  symbolName: string;
  changedPath: string;
  changedLine: number;
}

/**
 * The resolver's per-reference outcome (D5, D2). Exactly one of these exists
 * per requested reference — a resolver that reaches a final result for a
 * reference always emits one, whether the reference bound to a declaration or
 * was dropped for one of the three pre-budget reasons (`time_budget`,
 * `read_failed`, `ambiguous_resolution`). The two budget-only reasons
 * (`candidate_count_budget`, `character_budget`) are never emitted here —
 * they belong to {@link applyRepositoryContextBudgets}.
 */
export type RepositoryContextResolution =
  | { id: number; path: string; line: number; endLine: number; text: string }
  | {
      id: number;
      reason: Exclude<
        RepositoryContextDropReason,
        "candidate_count_budget" | "character_budget"
      >;
    };

/**
 * A resolved candidate that still carries its requesting reference's changed-
 * line position, so {@link compareRepositoryContextCandidates} can apply
 * priority key 1. Structurally a superset of {@link RepositoryContextCandidate}:
 * every consumer that only needs the four record/prompt fields (`kind`,
 * `symbolName`, `path`/`line`/`endLine`, `text`) can use one directly.
 */
export interface OrderedRepositoryContextCandidate extends RepositoryContextCandidate {
  changedPath: string;
  changedLine: number;
}

/**
 * Pairs each requested reference with its resolution: a candidate when the
 * resolver bound it to a declaration, or a drop when it did not. A drop's
 * `path`/`line` carry the **reference's** identity (the changed line that
 * names it) rather than an empty or placeholder location, per the
 * module-resolution contract — there is no candidate location to record for
 * a reference whose declaring file was never read.
 *
 * Defensive fallback: a requested reference with no matching resolution
 * entry at all (a resolver defect, never expected in production) is dropped
 * `ambiguous_resolution` rather than silently omitted, so every requested
 * reference is always accounted for in the output.
 */
export function buildRepositoryContextCandidates(
  requested: RepositoryContextRequestedReference[],
  resolved: RepositoryContextResolution[],
): { candidates: OrderedRepositoryContextCandidate[]; drops: RepositoryContextDrop[] } {
  const byId = new Map(resolved.map((entry) => [entry.id, entry]));
  const candidates: OrderedRepositoryContextCandidate[] = [];
  const drops: RepositoryContextDrop[] = [];

  for (const ref of requested) {
    const outcome = byId.get(ref.id);
    if (outcome && "path" in outcome) {
      candidates.push({
        kind: ref.kind,
        symbolName: ref.symbolName,
        path: outcome.path,
        line: outcome.line,
        endLine: outcome.endLine,
        text: outcome.text,
        changedPath: ref.changedPath,
        changedLine: ref.changedLine,
      });
      continue;
    }
    drops.push({
      kind: ref.kind,
      symbolName: ref.symbolName,
      path: ref.changedPath,
      line: ref.changedLine,
      reason: outcome?.reason ?? "ambiguous_resolution",
    });
  }

  return { candidates, drops };
}

/**
 * The spec's three priority keys, in order (**Context Selection Order** →
 * Priority): changed-line position (changed file path ascending, then line
 * ascending), then candidate location (path ascending, then line ascending),
 * then symbol name ascending as the final tie-break. The former `kind` key is
 * gone with call sites (Post-Merge Amendment item 5) and is not reintroduced.
 */
export function compareRepositoryContextCandidates(
  a: OrderedRepositoryContextCandidate,
  b: OrderedRepositoryContextCandidate,
): number {
  return (
    a.changedPath.localeCompare(b.changedPath) ||
    a.changedLine - b.changedLine ||
    a.path.localeCompare(b.path) ||
    a.line - b.line ||
    a.symbolName.localeCompare(b.symbolName)
  );
}

export interface RepositoryContextBudgetLimits {
  maxCandidates: number;
  maxChars: number;
}

/**
 * Takes candidates in priority order until the candidate count budget or the
 * character budget would be exceeded (**Context Selection Order** →
 * Dropping). Once either budget stops the take, **every** remaining
 * candidate — including the one that triggered the stop — is dropped whole,
 * never truncated, and never re-evaluated against the other budget: the spec
 * takes a deterministic prefix, not a best-fit selection (D5, E9).
 */
export function applyRepositoryContextBudgets(
  ordered: OrderedRepositoryContextCandidate[],
  limits: RepositoryContextBudgetLimits,
): { selected: OrderedRepositoryContextCandidate[]; drops: RepositoryContextDrop[] } {
  const selected: OrderedRepositoryContextCandidate[] = [];
  const drops: RepositoryContextDrop[] = [];
  let charsUsed = 0;
  let stopReason: RepositoryContextDropReason | undefined;

  for (const candidate of ordered) {
    if (!stopReason) {
      if (selected.length >= limits.maxCandidates) {
        stopReason = "candidate_count_budget";
      } else if (charsUsed + candidate.text.length > limits.maxChars) {
        stopReason = "character_budget";
      }
    }

    if (stopReason) {
      drops.push({
        kind: candidate.kind,
        symbolName: candidate.symbolName,
        path: candidate.path,
        line: candidate.line,
        reason: stopReason,
      });
      continue;
    }

    selected.push(candidate);
    charsUsed += candidate.text.length;
  }

  return { selected, drops };
}

export interface RepositoryContextOutcomeInput {
  candidatesRequested: number;
  candidatesResolved: number;
}

/**
 * The last three tests of the spec's ordered outcome decision (Statuses /
 * Enum Values → Valid transitions) — the tests that decide `used` /
 * `partial` / `unavailable` / `nothing_to_resolve` once a pass is known to
 * have reached review execution on a same-repository head with the feature
 * enabled. The earlier tests (`not_applicable`, `fork_excluded`, `off`) are
 * pass-wiring concerns, decided in `run-review-pass.ts` before this function
 * is ever called (AC3, AC10, AC19).
 */
export function resolveRepositoryContextOutcome(
  input: RepositoryContextOutcomeInput,
): RepositoryContextOutcome {
  if (input.candidatesRequested === 0) {
    return "nothing_to_resolve";
  }
  if (input.candidatesResolved === input.candidatesRequested) {
    return "used";
  }
  if (input.candidatesResolved === 0) {
    return "unavailable";
  }
  return "partial";
}
