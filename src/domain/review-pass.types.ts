import type { RondaConfig } from "../config/config.types.js";
import type { ModelClient } from "../inference/model-client.js";
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
}

export interface ReviewPassInput {
  owner: string;
  repo: string;
  pullNumber: number;
  trigger: TriggerMode;
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
 */
export interface GithubOperations {
  readPullRequest(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<PullRequestMetadata>;
  readChangedFiles(
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<ChangedFile[]>;
  findExistingCheckRun(
    owner: string,
    repo: string,
    headSha: string,
  ): Promise<number | null>;
  publishReview(input: PublishReviewInput): Promise<void>;
  publishCheckRun(input: PublishCheckRunInput): Promise<void>;
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
}

export interface ReviewPassResult {
  outcome: PassOutcome;
  failureReason?: FailureReason;
  skipReason?: SkipReason;
  findings: Finding[];
  malformedCount: number;
  coercedSeverityCount: number;
  duplicateCount: number;
  durationMs: number;
}
