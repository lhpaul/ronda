import { REVIEW_COMMAND, type TriggerMode } from "../domain/review-pass.types.js";

export { REVIEW_COMMAND };

export interface TriggerDecision {
  shouldRun: boolean;
  pullNumber?: number;
  trigger?: TriggerMode;
  /** Logged when `shouldRun` is false, or absent for a well-understood no-op. */
  reason?: string;
}

interface PullRequestEventPayload {
  action?: string;
  pull_request?: { number?: number };
}

interface IssueCommentEventPayload {
  action?: string;
  issue?: { number?: number; pull_request?: unknown };
  comment?: { body?: string };
}

/** The four `pull_request` actions the caller workflow subscribes to. */
const PULL_REQUEST_ACTIONS = new Set([
  "opened",
  "reopened",
  "ready_for_review",
  "synchronize",
]);

/**
 * Translates a GitHub Actions event into a pass decision. The draft gate
 * itself is applied later by `runReviewPass`, not here (T8) — this function
 * only decides whether a pass should be attempted at all, and in which
 * trigger mode.
 */
export function resolveTrigger(eventName: string, payload: unknown): TriggerDecision {
  if (eventName === "pull_request") {
    return resolvePullRequestEvent(payload as PullRequestEventPayload);
  }
  if (eventName === "issue_comment") {
    return resolveIssueCommentEvent(payload as IssueCommentEventPayload);
  }
  return { shouldRun: false, reason: `unsupported event: ${eventName}` };
}

function resolvePullRequestEvent(payload: PullRequestEventPayload): TriggerDecision {
  if (!PULL_REQUEST_ACTIONS.has(payload.action ?? "")) {
    return { shouldRun: false, reason: `unsupported pull_request action: ${payload.action}` };
  }
  const pullNumber = payload.pull_request?.number;
  if (typeof pullNumber !== "number") {
    return { shouldRun: false, reason: "pull_request event payload missing pull request number" };
  }
  return { shouldRun: true, pullNumber, trigger: "automatic" };
}

function resolveIssueCommentEvent(payload: IssueCommentEventPayload): TriggerDecision {
  if (payload.action !== "created") {
    return { shouldRun: false, reason: `unsupported issue_comment action: ${payload.action}` };
  }
  if (!payload.issue?.pull_request) {
    return { shouldRun: false, reason: "issue_comment is not on a pull request" };
  }
  const pullNumber = payload.issue.number;
  if (typeof pullNumber !== "number") {
    return { shouldRun: false, reason: "issue_comment event payload missing issue number" };
  }
  const body = payload.comment?.body ?? "";
  if (!matchesReviewCommand(body)) {
    return { shouldRun: false, reason: "comment does not match the review command" };
  }
  return { shouldRun: true, pullNumber, trigger: "manual" };
}

/**
 * True when the first non-empty, non-quoted line of `body` equals
 * `REVIEW_COMMAND` after trimming, compared case-insensitively. Quoted
 * reply lines (starting with `>`) are skipped, not matched.
 */
export function matchesReviewCommand(body: string): boolean {
  const lines = body.split(/\r\n|\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.startsWith(">")) {
      continue;
    }
    return trimmed.toLowerCase() === REVIEW_COMMAND.toLowerCase();
  }
  return false;
}
