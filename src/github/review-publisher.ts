import type { Octokit } from "@octokit/rest";
import type { PublishReviewInput } from "../domain/review-pass.types.js";
import { withRetry } from "./github-client.js";

/** Thrown when both the primary payload and the no-inline-comments fallback are rejected. */
export class ReviewPublishError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ReviewPublishError";
    this.status = status;
  }
}

function statusOf(error: unknown): number | undefined {
  return (error as { status?: number } | undefined)?.status;
}

/**
 * Publishes one pull-request review carrying the summary and every mapped
 * inline comment atomically. On HTTP 422 (a line the API rejects as not
 * part of the diff) it makes exactly one fallback attempt with no inline
 * comments, using `fallbackSummaryBody` — which folds every finding into
 * the summary — so no finding is lost. If that fallback also fails, the
 * pass fails with `unexpected_error` naming the HTTP status rather than
 * retrying again or silently dropping findings.
 */
export async function publishReview(
  octokit: Octokit,
  input: PublishReviewInput,
  signal?: AbortSignal,
): Promise<void> {
  try {
    await withRetry(() =>
      octokit.pulls.createReview({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullNumber,
        commit_id: input.headSha,
        event: "COMMENT",
        body: input.summaryBody,
        comments: input.inlineComments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: "RIGHT" as const,
          body: comment.body,
        })),
        request: { signal },
      }),
    );
    return;
  } catch (error) {
    if (statusOf(error) !== 422 || input.inlineComments.length === 0) {
      throw error;
    }
    // Fall through to the summary-only fallback attempt below.
  }

  try {
    await withRetry(() =>
      octokit.pulls.createReview({
        owner: input.owner,
        repo: input.repo,
        pull_number: input.pullNumber,
        commit_id: input.headSha,
        event: "COMMENT",
        body: input.fallbackSummaryBody,
        comments: [],
        request: { signal },
      }),
    );
  } catch (error) {
    const status = statusOf(error);
    throw new ReviewPublishError(
      `Review publication failed after the no-inline-comments fallback (HTTP ${status ?? "unknown"})`,
      status,
    );
  }
}
