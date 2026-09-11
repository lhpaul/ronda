import { createSystemClock } from "../core/clock.js";
import { createLogger } from "../core/logger.js";
import { runReviewPass } from "../core/run-review-pass.js";
import { ConfigLoadError, loadConfig } from "../config/load-config.js";
import type { RondaConfig } from "../config/config.types.js";
import type {
  GithubOperations,
  PublishCheckRunInput,
  ReviewPassInput,
} from "../domain/review-pass.types.js";
import { createGithubClient } from "../github/github-client.js";
import { publishCheckRun } from "../github/check-run-publisher.js";
import { publishReview } from "../github/review-publisher.js";
import {
  findExistingCheckRun,
  readChangedFiles,
  readPullRequest,
} from "../github/pull-request-reader.js";
import { createOpenAiCompatibleClient } from "../inference/openai-compatible-client.js";
import type { ModelClient } from "../inference/model-client.js";
import { resolveTrigger } from "../cli/resolve-trigger.js";
import { createGithubAppJwt, createInstallationAccessToken } from "./github-app-auth.js";
import type { WebhookConfig } from "./webhook-config.js";

const TERMINAL_CHECK_RUN_TIMEOUT_MS = 30_000;

type CheckRunLookup = (options?: { appId?: number }) => Promise<number | null>;

export interface WebhookReviewJob extends ReviewPassInput {
  installationId: number;
  deliveryId: string;
  checkRunInput?: PublishCheckRunInput;
}

export interface WebhookReviewJobResult {
  terminalCheckRunPublished: boolean;
  reviewedHeadSha?: string;
}

export interface WebhookJobDecision {
  shouldRun: boolean;
  job?: WebhookReviewJob;
  reason?: string;
}

interface RepositoryPayload {
  full_name?: string;
}

interface InstallationPayload {
  id?: number;
}

interface WebhookPayload {
  repository?: RepositoryPayload;
  installation?: InstallationPayload;
}

export function resolveWebhookJob(
  eventName: string,
  deliveryId: string,
  payload: unknown,
): WebhookJobDecision {
  if (!isRecord(payload)) {
    return { shouldRun: false, reason: "payload must be a JSON object" };
  }

  const trigger = resolveTrigger(eventName, payload);
  if (!trigger.shouldRun || trigger.pullNumber === undefined || trigger.trigger === undefined) {
    return { shouldRun: false, reason: trigger.reason ?? "trigger did not match" };
  }

  const webhookPayload = payload as WebhookPayload;
  const [owner, repo] = (webhookPayload.repository?.full_name ?? "").split("/");
  if (!owner || !repo) {
    return { shouldRun: false, reason: "payload missing repository.full_name" };
  }

  const installationId = webhookPayload.installation?.id;
  if (typeof installationId !== "number") {
    return { shouldRun: false, reason: "payload missing installation.id" };
  }

  return {
    shouldRun: true,
    job: {
      owner,
      repo,
      pullNumber: trigger.pullNumber,
      trigger: trigger.trigger,
      ...(trigger.headSha ? { headSha: trigger.headSha } : {}),
      installationId,
      deliveryId,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function runWebhookReviewJob(
  job: WebhookReviewJob,
  webhookConfig: WebhookConfig,
  signal?: AbortSignal,
): Promise<WebhookReviewJobResult> {
  const appTokenSignal = combineAbortSignals(
    AbortSignal.timeout(webhookConfig.githubAppTokenTimeoutMs),
    signal,
  );
  const appJwt = createGithubAppJwt({
    appId: webhookConfig.githubAppId,
    privateKey: webhookConfig.githubPrivateKey,
  });
  const installationToken = await createInstallationAccessToken({
    appJwt,
    installationId: job.installationId,
    apiUrl: webhookConfig.githubApiUrl,
    signal: appTokenSignal,
  });
  const installationClient = createGithubClient({
    token: installationToken,
    apiUrl: webhookConfig.githubApiUrl,
  });
  if (job.checkRunInput !== undefined) {
    await publishCheckRun(
      installationClient.octokit,
      job.checkRunInput,
      checkRunSignal(signal),
    );
    return {
      terminalCheckRunPublished: true,
      reviewedHeadSha: job.checkRunInput.headSha,
    };
  }

  const githubAppId = Number.parseInt(webhookConfig.githubAppId, 10);

  const github: GithubOperations = {
    readPullRequest: (o, r, n, requestSignal) =>
      readPullRequest(
        installationClient.octokit,
        o,
        r,
        n,
        combineAbortSignals(requestSignal, signal),
      ),
    readChangedFiles: (o, r, n, requestSignal) =>
      readChangedFiles(
        installationClient.octokit,
        o,
        r,
        n,
        combineAbortSignals(requestSignal, signal),
      ),
    findExistingCheckRun: async (o, r, sha, requestSignal) => {
      const combinedSignal = combineAbortSignals(requestSignal, signal);
      const publishingAppId = Number.isFinite(githubAppId) ? githubAppId : undefined;
      return findExistingWebhookCheckRun(job.trigger, publishingAppId, (options) =>
        findExistingCheckRun(installationClient.octokit, o, r, sha, combinedSignal, options),
      );
    },
    publishReview: (reviewInput, requestSignal) =>
      publishReview(
        installationClient.octokit,
        reviewInput,
        combineAbortSignals(requestSignal, signal),
      ),
    publishCheckRun: (checkRunInput, requestSignal) =>
      publishCheckRun(
        installationClient.octokit,
        checkRunInput,
        checkRunSignal(requestSignal),
      ),
  };

  let config: RondaConfig;
  try {
    config = loadConfig();
  } catch (error) {
    const path = error instanceof ConfigLoadError ? error.path : "unknown path";
    config = {
      model: { apiKey: "", baseUrl: "", modelName: "" },
      passTimeoutMs: 600_000,
      maxPatchChars: 400_000,
      loadError: `Failed to load Ronda config file at ${path}`,
    };
  }

  const model = withOuterAbortSignal(
    createOpenAiCompatibleClient({
      apiKey: config.model.apiKey,
      baseUrl: config.model.baseUrl,
      modelName: config.model.modelName,
    }),
    signal,
  );
  const logger = createLogger([config.model.apiKey, installationToken, webhookConfig.githubPrivateKey]);

  const result = await runReviewPass(job, {
    github,
    model,
    config,
    clock: createSystemClock(),
    logger,
    detailsUrl: webhookConfig.detailsUrl,
  });
  logger.event("webhook_review_completed", {
    deliveryId: job.deliveryId,
    owner: job.owner,
    repo: job.repo,
    pullNumber: job.pullNumber,
    outcome: result.outcome,
  });
  if (result.outcome === "failed" && result.terminalCheckRunPublished !== true) {
    throw new Error(
      `Webhook review failed for ${job.owner}/${job.repo}#${job.pullNumber} without a terminal check run`,
    );
  }
  return {
    terminalCheckRunPublished: result.terminalCheckRunPublished === true,
    ...(result.reviewedHeadSha !== undefined ? { reviewedHeadSha: result.reviewedHeadSha } : {}),
  };
}

export async function findExistingWebhookCheckRun(
  trigger: WebhookReviewJob["trigger"],
  githubAppId: number | undefined,
  lookup: CheckRunLookup,
): Promise<number | null> {
  if (trigger === "automatic") {
    const anyExistingCheckRunId = await lookup();
    if (anyExistingCheckRunId !== null) {
      return anyExistingCheckRunId;
    }
  }
  return lookup({ appId: githubAppId });
}

export function withOuterAbortSignal(
  model: ModelClient,
  outerSignal: AbortSignal | undefined,
): ModelClient {
  if (outerSignal === undefined) {
    return model;
  }
  return {
    modelName: model.modelName,
    complete: (request, requestSignal) =>
      model.complete(request, combineAbortSignals(requestSignal, outerSignal) ?? requestSignal),
  };
}

export function checkRunSignal(
  requestSignal: AbortSignal | undefined,
): AbortSignal | undefined {
  const terminalSignal = AbortSignal.timeout(TERMINAL_CHECK_RUN_TIMEOUT_MS);
  if (requestSignal === undefined) {
    return terminalSignal;
  }
  return combineAbortSignals(requestSignal, terminalSignal);
}

function combineAbortSignals(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined,
): AbortSignal | undefined {
  if (first === undefined) {
    return second;
  }
  if (second === undefined) {
    return first;
  }
  return AbortSignal.any([first, second]);
}
