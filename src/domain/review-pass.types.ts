import type { RepositoryContextBudgetName, RondaConfig } from "../config/config.types.js";
import type { DeadlineClock } from "../core/pass-deadline.js";
import type { ModelClient } from "../inference/model-client.js";
import type { SweepListResult } from "../review/sweep-categories.js";
import type { Severity } from "./severity.js";

/**
 * Name of the single check run Ronda creates or updates per head SHA.
 * Declared once here and imported everywhere it is used (publisher, reader,
 * adoption docs consumption contract).
 */
export const CHECK_RUN_NAME = "Ronda review";

/**
 * The one documented phrase that triggers a manual pass. Declared here
 * (rather than in `src/cli/resolve-trigger.ts`, where it is re-exported for
 * callers) because `src/core/summary.ts` also needs it for the "manually
 * requested" note and the failure re-run hint, and `src/core/` must not
 * import from `src/cli/`.
 */
export const REVIEW_COMMAND = "/ronda review";

/**
 * Review pass outcome. `queued` and `running` are in-process/log-only states
 * — see the plan's "Pass outcome decision matrix": only `succeeded`,
 * `failed`, and `skipped` are ever published.
 */
export type PassOutcome =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export type FailureReason =
  | "timed_out"
  | "model_unavailable"
  | "credential_missing"
  | "credential_invalid"
  | "unusable_output"
  | "changes_too_large"
  | "unexpected_error";

export type SkipReason =
  | "draft_pull_request"
  | "superseded_head_sha"
  | "already_reviewed_automatically";

export type TriggerMode = "automatic" | "manual";

export interface Finding {
  path: string;
  /** null when the finding could not be mapped to a commentable diff line. */
  line: number | null;
  severity: Severity;
  title: string;
  body: string;
}

export interface ChangedFile {
  /** Current filename. Findings are always keyed to this, never previousPath. */
  path: string;
  previousPath?: string;
  status: string;
  /** Undefined for binary files or diffs GitHub declines to return. */
  patch?: string;
  additions: number;
  deletions: number;
}

export interface PullRequestMetadata {
  number: number;
  title: string;
  body: string;
  draft: boolean;
  headSha: string;
  /** Head branch name (for stage resolution). Empty when unavailable. */
  headBranch: string;
  /**
   * `owner/repo` of the pull request head's repository (#106, D6). Empty when
   * unavailable — an absent, empty, or unreadable head repository (a deleted
   * fork, for instance) is treated as fork-originated, never as
   * same-repository, so an unknown origin can never be the one
   * configuration-independent way a fork read happens (AC10). The
   * same-repository test compares this value case-insensitively against
   * `${owner}/${repo}`.
   */
  headRepoFullName: string;
}

export interface ReviewPassInput {
  owner: string;
  repo: string;
  pullNumber: number;
  trigger: TriggerMode;
  /**
   * The head SHA carried by the triggering `pull_request` webhook event, when
   * available. `issue_comment` payloads never include one. Used only as a
   * fallback so a failed *first* `readPullRequest` call — which means no SHA
   * has been read from the API yet — can still publish a `Review failed`
   * check run against the commit the trigger named, instead of publishing
   * nothing. Superseded by the SHA `readPullRequest` returns as soon as that
   * call succeeds.
   */
  headSha?: string;
}

export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

export interface PublishReviewInput {
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  summaryBody: string;
  inlineComments: InlineComment[];
  /**
   * Rendered with every finding folded into the summary and no inline
   * comments. Used for the single fallback attempt after an HTTP 422 from
   * the primary payload, so no finding is lost.
   */
  fallbackSummaryBody: string;
}

export interface PublishCheckRunInput {
  owner: string;
  repo: string;
  headSha: string;
  /** When present, the publisher updates this check run instead of creating a new one. */
  existingCheckRunId: number | null;
  title: string;
  summary: string;
  conclusion: "success" | "failure";
  startedAt: string;
  completedAt: string;
  detailsUrl?: string;
}

/**
 * The GitHub-facing port `runReviewPass` depends on. Implemented in
 * `src/github/` and composed from `src/cli/review-pr.ts`; every method is
 * injected so tests run with no network.
 *
 * Every method accepts an optional `signal` so `run-review-pass.ts` can
 * thread the pass deadline's `AbortSignal` through the GitHub phase, not
 * just the model call — otherwise GitHub API latency or retries could push
 * a pass past its budget with the in-process deadline never firing. Passing
 * `undefined` (the default) preserves today's unbounded behaviour for any
 * caller that does not have a deadline to offer.
 */
export interface GithubOperations {
  readPullRequest(
    owner: string,
    repo: string,
    pullNumber: number,
    signal?: AbortSignal,
  ): Promise<PullRequestMetadata>;
  readChangedFiles(
    owner: string,
    repo: string,
    pullNumber: number,
    signal?: AbortSignal,
  ): Promise<ChangedFile[]>;
  readFileAtRef(
    owner: string,
    repo: string,
    path: string,
    ref: string,
    signal?: AbortSignal,
    options?: { failOnUnusable?: boolean; oversizedMaxBytes?: number },
  ): Promise<string | undefined>;
  findExistingCheckRun(
    owner: string,
    repo: string,
    headSha: string,
    signal?: AbortSignal,
  ): Promise<number | null>;
  publishReview(input: PublishReviewInput, signal?: AbortSignal): Promise<void>;
  publishCheckRun(input: PublishCheckRunInput, signal?: AbortSignal): Promise<void>;
}

export interface Clock {
  now(): number;
  isoNow(): string;
}

export interface Logger {
  event(name: string, fields: Record<string, unknown>): void;
}

export interface ReviewPassDeps {
  github: GithubOperations;
  model: ModelClient;
  config: RondaConfig;
  clock: Clock;
  logger: Logger;
  /** Actions run URL used as the check run's "details" link, when known. */
  detailsUrl?: string;
  /**
   * Called after the pull-request review is public and before publishing the
   * terminal check run. Webhook callers use this to persist check-run recovery
   * state so a process crash cannot rerun the full review for the same head.
   */
  onReviewPublished?: (checkRunInput: PublishCheckRunInput) => void | Promise<void>;
  /**
   * Overrides the timer implementation `createPassDeadline` uses. Absent in
   * production (the real, `unref`-ed system timer is used). Tests that need
   * to exercise a real elapsed-time expiry inject a short, non-`unref`-able
   * timer here instead — a real `unref`-ed timer as the sole active handle
   * in an otherwise-idle test process can trigger Node's test runner to
   * treat the process as exiting early (`beforeExit` firing before the
   * timer callback runs), which is an artifact of the test process having
   * nothing else keeping the event loop alive, not a product bug.
   */
  deadlineClock?: DeadlineClock;
  /**
   * Overrides the sweep category-list loader (#105). Absent in production,
   * where the real, module-relative `loadSweepList` reads the committed
   * artifact. The optional `path` is the direct-loader seam; a pass-level test
   * cannot reach a malformed list through it alone, so this dependency is what
   * drives the AC19 degrade path end to end — a loader returning each
   * malformed shape, or one that throws to cover the unreadable case — with
   * the committed artifact untouched. Same optional test-injection pattern as
   * `deadlineClock`.
   */
  loadSweepList?: (options?: { path?: string }) => SweepListResult | Promise<SweepListResult>;
}

/**
 * One swept category of the recorded list (#105). Every field is required and
 * carries its own value — a category's description, failure shape,
 * finding-instance count, and evidence source are never inferred from one
 * another (AC4, AC5), so the loader validates each in its own right (AC19).
 *
 * `matchTerms` are lowercase literal substrings the classifier matches against
 * a finding's own text; they are the list's classification vocabulary and are
 * never published (AC20 attributes findings to categories, it does not quote
 * the terms).
 */
export interface SweepCategory {
  /** The evidence identifier — the name used in the source corpus. */
  identifier: string;
  displayLabel: string;
  description: string;
  failureShape: string;
  evidenceSource: string;
  /** Positive integer. Zero is not allowed (AC19): a category is justified by the findings behind it. */
  findingInstanceCount: number;
  matchTerms: string[];
}

export interface SweepCategoryList {
  /** Non-blank scalar string, compared by exact equality; a value is never reused (AC7). */
  version: string;
  categories: SweepCategory[];
}

/**
 * The per-category result code values (Statuses / Enum Values). Terminal
 * per-pass results, not lifecycle states: a pass writes one per category when
 * it records the pass and never transitions it afterward.
 */
export type SweepCategoryPassOutcome =
  | "produced_findings"
  | "produced_none"
  | "not_determined";

/**
 * One published finding's attribution in the per-category pass record (AC20).
 * Carries the finding's publication index and its category identifiers, never
 * the finding's own text — the record is logged through `sweep_pass_record`,
 * so it stays free of review content.
 */
export interface SweepFindingAttribution {
  /** Position of the finding in the pass's published findings. */
  publicationIndex: number;
  /**
   * One or more swept category identifiers, or an empty array when the finding
   * matches none of them, which the review summary reports as uncategorized.
   */
  categories: string[];
}

/**
 * AC1's per-category pass record: every category the pass reached, with what
 * it established for each, plus every published finding's attribution (AC20).
 */
export interface SweepPassRecord {
  listVersion: string;
  categories: Array<{
    identifier: string;
    outcome: SweepCategoryPassOutcome;
  }>;
  findings: SweepFindingAttribution[];
  uncategorizedFindingCount: number;
}

/**
 * The two degraded records (Operational Visibility). They are distinct records
 * rather than one record with reason values, and neither appears in the review
 * body. Both are emitted only by a pass that reaches review execution.
 */
export type SweepDegradedRecord =
  | {
      /** AC19: the list could not be read, was empty, or was malformed. No list version is reported as used. */
      kind: "sweep-did-not-run";
      reason: "unreadable" | "empty" | "malformed";
      detail: string;
    }
  | {
      /** AC18: a non-empty enablement value was unrecognized. The raw value is never carried here. */
      kind: "sweep_enablement_unrecognized";
    };

/**
 * Read-only repository context (#106). Four recorded outcomes; three further
 * cases (`off`, `fork_excluded`, `not_applicable`) emit no record at all
 * (Statuses / Enum Values), so they are not members of this type.
 */
export type RepositoryContextOutcome =
  | "used"
  | "partial"
  | "unavailable"
  | "nothing_to_resolve";

/**
 * Single-member union, kept as a named type rather than a literal so
 * follow-up #129 (call-site context) can add `"call_site"` without reshaping
 * the record (Post-Merge Amendment item 5).
 */
export type RepositoryContextCandidateKind = "definition";

/** The spec's five recorded drop reasons (Context Selection Order → Dropping). Closed — no sixth is introduced. */
export type RepositoryContextDropReason =
  | "candidate_count_budget"
  | "character_budget"
  | "time_budget"
  | "read_failed"
  | "ambiguous_resolution";

/**
 * One resolved candidate: the definition a changed line depends on, bound by
 * the reviewed language's own compiler (D2). `text` is the excerpt body and
 * is the **only** field carrying one — it never reaches a record, a log, or
 * a review (the business rule on excerpt bodies).
 */
export interface RepositoryContextCandidate {
  kind: RepositoryContextCandidateKind;
  symbolName: string;
  path: string;
  line: number;
  endLine: number;
  text: string;
}

/**
 * One dropped candidate or reference. `path`/`line` identify the changed
 * line's reference when the declaring file was never read (a `time_budget`
 * drop, for instance) and the candidate's own location otherwise — never an
 * empty or placeholder location (module-resolution contract).
 */
export interface RepositoryContextDrop {
  kind: RepositoryContextCandidateKind;
  symbolName: string;
  path: string;
  line: number;
  reason: RepositoryContextDropReason;
}

/**
 * The per-pass repository-context record (Operational Visibility). Carries
 * counts, identifiers, and budget figures only — never an excerpt body,
 * credential value, or operator-specific path.
 */
export interface RepositoryContextPassRecord {
  outcome: RepositoryContextOutcome;
  candidatesRequested: number;
  candidatesResolved: number;
  drops: RepositoryContextDrop[];
  /**
   * Paths of changed source files whose read failed **transiently** (past the
   * bounded retry) — additive beyond the spec's listed record contents, so a
   * pass whose changed file could not be read is never indistinguishable from
   * one whose changed lines genuinely named nothing (D5, E16).
   */
  unreadableChangedFilePaths: string[];
  /**
   * Number of GitHub content requests the pass made, probes included — a
   * probe that 404s counts (owner decision, 2026-09-29). The operator's
   * early-warning signal for the rate-limit risk in Risks & Mitigations.
   */
  contentRequestCount: number;
  charsUsed: number;
  maxCandidates: number;
  maxChars: number;
  timeBudgetMs: number;
  timeUsedMs: number;
  budgetFallbacks: RepositoryContextBudgetName[];
}

/** AC21: a non-empty unrecognized switch value. The raw value is never carried here. */
export type RepositoryContextDegradedRecord = {
  kind: "repository_context_switch_unrecognized";
};

export interface ReviewPassResult {
  outcome: PassOutcome;
  failureReason?: FailureReason;
  skipReason?: SkipReason;
  reviewedHeadSha?: string;
  terminalCheckRunPublished?: boolean;
  findings: Finding[];
  malformedCount: number;
  coercedSeverityCount: number;
  duplicateCount: number;
  durationMs: number;
  /**
   * Sweep metadata for a pass that reached review execution with the sweep
   * enabled (AC1). Absent for a pre-review skip and for a terminal failure
   * before review execution — those passes emit no sweep metadata of any kind.
   * Present either as a pass record or as one of the two degraded records.
   */
  sweep?: {
    record?: SweepPassRecord;
    degraded?: SweepDegradedRecord;
  };
  /**
   * Read-only repository context (#106). Absent for a pre-review skip, a
   * fork-originated head, and a validly disabled switch — those three cases
   * emit no record of any kind (AC10, AC19). Present either as a pass record
   * or as the degraded record, mutually exclusive like `sweep`.
   */
  repositoryContext?: {
    record?: RepositoryContextPassRecord;
    degraded?: RepositoryContextDegradedRecord;
  };
}
