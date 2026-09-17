import type { Octokit } from "@octokit/rest";
import type { PublishCheckRunInput } from "../domain/review-pass.types.js";
import { createGithubClient } from "../github/github-client.js";
import {
  findExistingRondaReview,
  readPullRequest,
} from "../github/pull-request-reader.js";
import type { WebhookReviewJob } from "./webhook-job.js";
import { createGithubAppJwt, createInstallationAccessToken } from "./github-app-auth.js";
import type { WebhookConfig } from "./webhook-config.js";

export type WebhookRecoveryOutcome =
  | "resumed"
  | "reconciled_existing_review"
  | "reconciliation_failed";

export interface WebhookQueueRecoveryStore {
  loadInProgressEntries?: () => WebhookReviewJob[];
  retry: (deliveryId: string) => boolean;
  markPublished: (deliveryId: string, reviewedHeadSha?: string) => boolean;
  markCheckPending?: (deliveryId: string, checkRunInput: PublishCheckRunInput) => boolean;
  complete: (deliveryId: string) => boolean;
}

export interface WebhookQueueRecoveryResult {
  jobsToRun: WebhookReviewJob[];
  suppressedReviewKeys: string[];
}

export interface WebhookQueueRecoveryDeps {
  findExistingRondaReview?: typeof findExistingRondaReview;
  readPullRequest?: typeof readPullRequest;
  createInstallationOctokit?: (
    job: WebhookReviewJob,
    signal: AbortSignal,
  ) => Promise<Octokit>;
}

function reviewSuppressionKey(job: WebhookReviewJob, reviewedHeadSha?: string): string | undefined {
  const headSha = reviewedHeadSha ?? job.headSha;
  if (headSha === undefined) {
    return undefined;
  }
  return `${job.owner}/${job.repo}#${job.pullNumber}@${headSha}`;
}

export async function recoverInProgressWebhookJobs(
  config: WebhookConfig,
  queueStore: WebhookQueueRecoveryStore,
  log: Pick<Console, "error" | "log">,
  deps: WebhookQueueRecoveryDeps = {},
): Promise<WebhookQueueRecoveryResult> {
  const loadInProgress = queueStore.loadInProgressEntries;
  if (loadInProgress === undefined) {
    return { jobsToRun: [], suppressedReviewKeys: [] };
  }

  const inProgressJobs = loadInProgress();
  if (inProgressJobs.length === 0) {
    return { jobsToRun: [], suppressedReviewKeys: [] };
  }

  const findReview = deps.findExistingRondaReview ?? findExistingRondaReview;
  const readPr = deps.readPullRequest ?? readPullRequest;
  const createOctokit =
    deps.createInstallationOctokit ??
    (async (job: WebhookReviewJob, signal: AbortSignal) => {
      const appJwt = createGithubAppJwt({
        appId: config.githubAppId,
        privateKey: config.githubPrivateKey,
      });
      const installationToken = await createInstallationAccessToken({
        appJwt,
        installationId: job.installationId,
        apiUrl: config.githubApiUrl,
        signal,
      });
      return createGithubClient({
        token: installationToken,
        apiUrl: config.githubApiUrl,
      }).octokit;
    });

  const appTokenSignal = AbortSignal.timeout(config.githubAppTokenTimeoutMs);

  const jobsToRun: WebhookReviewJob[] = [];
  const suppressedReviewKeys: string[] = [];

  for (const job of inProgressJobs) {
    let headSha = job.headSha;
    let outcome: WebhookRecoveryOutcome = "resumed";

    try {
      const octokit = await createOctokit(job, appTokenSignal);

      if (headSha === undefined) {
        const metadata = await readPr(
          octokit,
          job.owner,
          job.repo,
          job.pullNumber,
          appTokenSignal,
        );
        headSha = metadata.headSha;
      }

      const existingReview = await findReview(
        octokit,
        job.owner,
        job.repo,
        job.pullNumber,
        headSha,
        appTokenSignal,
      );

      if (existingReview !== null) {
        outcome = "reconciled_existing_review";
        const reviewedHeadSha = existingReview.headSha;
        const reviewKey = reviewSuppressionKey(job, reviewedHeadSha);
        if (reviewKey !== undefined) {
          suppressedReviewKeys.push(reviewKey);
        }

        if (job.checkRunInput !== undefined) {
          if (queueStore.markCheckPending?.(job.deliveryId, job.checkRunInput) !== true) {
            throw new Error(
              `Failed to persist check-pending recovery for webhook delivery ${job.deliveryId}`,
            );
          }
          jobsToRun.push({ ...job, headSha: reviewedHeadSha, checkRunInput: job.checkRunInput });
        } else {
          if (!queueStore.markPublished(job.deliveryId, reviewedHeadSha)) {
            throw new Error(
              `Failed to mark reconciled webhook delivery ${job.deliveryId} published`,
            );
          }
          if (!queueStore.complete(job.deliveryId)) {
            throw new Error(
              `Failed to complete reconciled webhook delivery ${job.deliveryId}`,
            );
          }
        }
      } else {
        if (!queueStore.retry(job.deliveryId)) {
          throw new Error(`Failed to mark webhook delivery ${job.deliveryId} pending for resume`);
        }
        jobsToRun.push({ ...job, ...(headSha !== undefined ? { headSha } : {}) });
      }
    } catch (error) {
      outcome = "reconciliation_failed";
      log.error("Ronda webhook startup recovery failed for delivery", {
        deliveryId: job.deliveryId,
        owner: job.owner,
        repo: job.repo,
        pullNumber: job.pullNumber,
        headSha,
        error,
      });
      throw error;
    } finally {
      log.log("Ronda webhook queue recovery", {
        deliveryId: job.deliveryId,
        owner: job.owner,
        repo: job.repo,
        pullNumber: job.pullNumber,
        headSha,
        outcome,
      });
    }
  }

  return { jobsToRun, suppressedReviewKeys };
}
