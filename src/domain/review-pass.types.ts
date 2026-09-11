import type { RondaConfig } from "../config/config.types.js";
import type { DeadlineClock } from "../core/pass-deadline.js";
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
}

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
}
