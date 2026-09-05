import { readFileSync } from "node:fs";
import { createSystemClock } from "../core/clock.js";
import { createLogger } from "../core/logger.js";
import { runReviewPass } from "../core/run-review-pass.js";
import { ConfigLoadError, loadConfig } from "../config/load-config.js";
import { createGithubClient } from "../github/github-client.js";
import {
  findExistingCheckRun,
  readChangedFiles,
  readPullRequest,
} from "../github/pull-request-reader.js";
import { publishReview } from "../github/review-publisher.js";
import { publishCheckRun } from "../github/check-run-publisher.js";
import { createOpenAiCompatibleClient } from "../inference/openai-compatible-client.js";
import type { GithubOperations } from "../domain/review-pass.types.js";
import type { RondaConfig } from "../config/config.types.js";
import { resolveTrigger } from "./resolve-trigger.js";

/**
 * Action entrypoint. Translates GitHub Actions environment variables and
 * the event payload into one `runReviewPass` call, then maps the outcome to
 * a process exit code. Contains no review logic of its own — everything
 * product-relevant lives in `src/core/`, `src/github/`, and `src/inference/`
 * so the later long-running webhook process can reuse it unchanged.
 */
export async function main(): Promise<number> {
  const githubToken = process.env.GITHUB_TOKEN ?? "";
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const eventName = process.env.GITHUB_EVENT_NAME ?? "";
  const eventPath = process.env.GITHUB_EVENT_PATH ?? "";
  const runId = process.env.GITHUB_RUN_ID ?? "";
  const serverUrl = process.env.GITHUB_SERVER_URL ?? "https://github.com";
  const apiUrl = process.env.GITHUB_API_URL;

  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    console.error(`GITHUB_REPOSITORY is not set to an "owner/repo" value: "${repository}"`);
    return 1;
  }
  if (!eventPath) {
    console.error("GITHUB_EVENT_PATH is not set.");
    return 1;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(readFileSync(eventPath, "utf8"));
  } catch (error) {
    console.error(`Failed to read or parse GITHUB_EVENT_PATH: ${String(error)}`);
    return 1;
  }

  const decision = resolveTrigger(eventName, payload);
  if (!decision.shouldRun || decision.pullNumber === undefined || decision.trigger === undefined) {
    console.log(`Ronda: no pass started (${decision.reason ?? "trigger did not match"})`);
    return 0;
  }

  const { octokit } = createGithubClient({ token: githubToken, apiUrl });
  const github: GithubOperations = {
    readPullRequest: (o, r, n) => readPullRequest(octokit, o, r, n),
    readChangedFiles: (o, r, n) => readChangedFiles(octokit, o, r, n),
    findExistingCheckRun: (o, r, sha) => findExistingCheckRun(octokit, o, r, sha),
    publishReview: (reviewInput) => publishReview(octokit, reviewInput),
    publishCheckRun: (checkRunInput) => publishCheckRun(octokit, checkRunInput),
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

  const model = createOpenAiCompatibleClient({
    apiKey: config.model.apiKey,
    baseUrl: config.model.baseUrl,
    modelName: config.model.modelName,
  });

  const detailsUrl = runId ? `${serverUrl}/${owner}/${repo}/actions/runs/${runId}` : undefined;
  const logger = createLogger([config.model.apiKey, githubToken]);

  const result = await runReviewPass(
    { owner, repo, pullNumber: decision.pullNumber, trigger: decision.trigger },
    { github, model, config, clock: createSystemClock(), logger, detailsUrl },
  );

  console.log(`Ronda: pass outcome = ${result.outcome}`);
  return result.outcome === "failed" ? 1 : 0;
}

/* c8 ignore start -- process wiring; exercised by the smoke runbook, not unit tests. */
if (process.argv[1] && process.argv[1].endsWith("review-pr.ts")) {
  process.on("unhandledRejection", (reason) => {
    console.error("Ronda: unhandled rejection", reason);
    process.exitCode = 1;
  });

  process.on("uncaughtException", (error) => {
    console.error("Ronda: uncaught exception", error);
    process.exitCode = 1;
  });

  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error("Ronda: fatal error", error);
      process.exitCode = 1;
    });
}
/* c8 ignore stop */
