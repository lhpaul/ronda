#!/usr/bin/env node
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Octokit } from "@octokit/rest";
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
import { readRepositoryFileAtRef } from "../github/repo-content-reader.js";
import {
  DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
  DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS,
  DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
} from "../config/load-config.js";
import { createOpenAiCompatibleClient } from "../inference/openai-compatible-client.js";
import type { GithubOperations, ReviewPassResult } from "../domain/review-pass.types.js";
import type { ModelClient } from "../inference/model-client.js";
import type { RondaConfig } from "../config/config.types.js";

/**
 * AC22's non-publishing control pass. Reviews a real head under one arm of
 * repository context and writes its result — findings plus its
 * repository-context record — only to a committed evidence file, never to
 * GitHub. Operator-initiated only: no trigger or workflow invokes this
 * command.
 *
 * Invocation contract:
 *
 *   npm run quality:control-pass -- --pr <number> --repository-context on|off [--repo <owner/repo>] [--out <path>]
 */

export const DEFAULT_CONTROL_PASS_OUT_PATH = "docs/testing/ronda/repository-context-control-passes.jsonl";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export class ControlPassUsageError extends Error {}

export interface ControlPassOptions {
  pullNumber: number;
  repositoryContext: "on" | "off";
  repo: string;
  outPath: string;
}

/** Parses and validates argv. Throws {@link ControlPassUsageError} on any invalid or missing required option. */
export function parseControlPassArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ControlPassOptions {
  let pullNumberRaw: string | undefined;
  let repositoryContextRaw: string | undefined;
  let repo = env.GITHUB_REPOSITORY;
  let outPath = DEFAULT_CONTROL_PASS_OUT_PATH;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--pr" && next !== undefined) {
      pullNumberRaw = next;
      index += 1;
    } else if (arg === "--repository-context" && next !== undefined) {
      repositoryContextRaw = next;
      index += 1;
    } else if (arg === "--repo" && next !== undefined) {
      repo = next;
      index += 1;
    } else if (arg === "--out" && next !== undefined) {
      outPath = next;
      index += 1;
    }
  }

  const usage =
    "Usage: quality:control-pass -- --pr <number> --repository-context on|off [--repo <owner/repo>] [--out <path>]";

  if (pullNumberRaw === undefined || !/^\d+$/.test(pullNumberRaw)) {
    throw new ControlPassUsageError(`--pr is required and must be a positive integer. ${usage}`);
  }
  if (repositoryContextRaw !== "on" && repositoryContextRaw !== "off") {
    // Deliberately no default (D3, AC15): an implicit arm cannot be paired
    // with anything, and a control pass whose arm is guessed is worthless
    // evidence.
    throw new ControlPassUsageError(`--repository-context is required and must be "on" or "off". ${usage}`);
  }
  if (!repo) {
    throw new ControlPassUsageError(`--repo is required when GITHUB_REPOSITORY is not set. ${usage}`);
  }

  return { pullNumber: parseInt(pullNumberRaw, 10), repositoryContext: repositoryContextRaw, repo, outPath };
}

/** Refuses a path that resolves outside the repository root (an operator-specific path never becomes the destination). */
export function resolveControlPassOutPath(outPath: string, repoRoot: string = REPO_ROOT): string {
  const resolved = resolve(repoRoot, outPath);
  const rel = relative(repoRoot, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ControlPassUsageError(`--out resolves outside the repository root: ${outPath}`);
  }
  return resolved;
}

/**
 * Same-repository-head test (AC10), duplicated from `run-review-pass.ts`
 * rather than imported, so this CLI's own fork refusal does not depend on
 * that module's internal (unexported) helper.
 */
function isSameRepositoryHead(headRepoFullName: string, owner: string, repo: string): boolean {
  return headRepoFullName.toLowerCase() === `${owner}/${repo}`.toLowerCase();
}

/**
 * Wraps the real Octokit client so every write-shaped call is refused and
 * counted rather than sent — defense in depth for the no-write guarantee
 * (AC22), independent of and in addition to the pure, local
 * `publishReview`/`publishCheckRun` implementations below. `onWriteAttempt`
 * is called before the refusal throws, so the counter reflects an attempt
 * even though the call never reaches GitHub.
 */
export function createNoWriteOctokit(real: Octokit, onWriteAttempt: () => void): Octokit {
  const refuse = async (): Promise<never> => {
    onWriteAttempt();
    throw new Error("Control pass refused a GitHub write attempt");
  };
  return {
    ...real,
    pulls: { ...real.pulls, createReview: refuse },
    checks: { ...real.checks, create: refuse, update: refuse },
    issues: { ...real.issues, createComment: refuse },
  } as unknown as Octokit;
}

interface ControlPassRecord {
  recordedAt: string;
  owner: string;
  repo: string;
  pullNumber: number;
  headSha: string;
  arm: "on" | "off";
  outcome: ReviewPassResult["outcome"];
  findingCount: number;
  repositoryContext: ReviewPassResult["repositoryContext"];
}

export interface RunControlPassDeps {
  octokit: Octokit;
  githubToken: string;
  /** Called whenever the wrapped octokit refuses a write attempt (see `createNoWriteOctokit`). */
  getWriteAttempts: () => number;
  /** Test-only seam: bypasses `loadConfig()` (the real environment / operator config file) when supplied. */
  configOverride?: RondaConfig;
  /** Test-only seam: bypasses the real HTTP-backed model client when supplied. */
  modelOverride?: ModelClient;
}

/**
 * The testable core: everything after argv parsing and octokit construction.
 * Split out from `main` so a test can supply a fake `Octokit`-shaped object
 * (implementing only the read methods this command uses) without any
 * network access.
 */
export async function runControlPass(
  options: ControlPassOptions,
  runDeps: RunControlPassDeps,
): Promise<number> {
  const { octokit, githubToken, getWriteAttempts } = runDeps;
  const [owner, repo] = options.repo.split("/");
  if (!owner || !repo) {
    console.error(`--repo must be an "owner/repo" value: "${options.repo}"`);
    return 1;
  }

  let outFilePath: string;
  try {
    outFilePath = resolveControlPassOutPath(options.outPath);
  } catch (error) {
    console.error(error instanceof ControlPassUsageError ? error.message : String(error));
    return 1;
  }

  // AC10: fork heads are refused before any further read — a fork head reads
  // no repository context on either arm, so a control pass on one compares
  // nothing.
  let pr;
  try {
    pr = await readPullRequest(octokit, owner, repo, options.pullNumber);
  } catch (error) {
    console.error(`Failed to read pull request #${options.pullNumber}: ${String(error)}`);
    return 1;
  }
  if (!isSameRepositoryHead(pr.headRepoFullName, owner, repo)) {
    console.error(
      `Pull request #${options.pullNumber}'s head (${pr.headRepoFullName || "(unknown)"}) is not ${owner}/${repo} — refusing a fork-originated control pass.`,
    );
    return 1;
  }

  let config: RondaConfig;
  if (runDeps.configOverride) {
    config = runDeps.configOverride;
  } else {
    try {
      config = loadConfig();
    } catch (error) {
      const loadError =
      error instanceof ConfigLoadError
        ? error.publicMessage
        : "Failed to load Ronda config file at unknown path";
      config = {
        model: { apiKey: "", baseUrl: "", modelName: "" },
        passTimeoutMs: 600_000,
        maxPatchChars: 400_000,
        maxAuthoritativeDocCount: DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
        maxAuthoritativeDocChars: DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
        durabilityMode: "default",
        durabilityModeDefault: false,
        sweepMode: "off",
        sweepModeRaw: undefined,
        repositoryContextMode: "off",
        repositoryContextModeRaw: undefined,
        maxRepositoryContextCandidates: DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES,
        maxRepositoryContextChars: DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS,
        repositoryContextTimeBudgetMs: DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
        repositoryContextBudgetFallbacks: [],
        excludePathGlobs: [],
        loadError,
      };
    }
  }
  // The flag overrides the resolved switch for this run alone, in memory —
  // no configuration file or environment value is written.
  config = {
    ...config,
    repositoryContextMode: options.repositoryContext,
    repositoryContextModeRaw: undefined,
  };

  const model =
    runDeps.modelOverride ??
    createOpenAiCompatibleClient({
      apiKey: config.model.apiKey,
      baseUrl: config.model.baseUrl,
      modelName: config.model.modelName,
    });

  // Pure, local, non-publishing implementations (AC22): findings and the
  // check-run text are captured for the evidence record instead of being
  // sent anywhere. Neither ever calls `octokit`.
  const github: GithubOperations = {
    readPullRequest: (o, r, n, signal) => readPullRequest(octokit, o, r, n, signal),
    readChangedFiles: (o, r, n, signal) => readChangedFiles(octokit, o, r, n, signal),
    readFileAtRef: (o, r, path, ref, signal, opts) => readRepositoryFileAtRef(octokit, o, r, path, ref, signal, opts),
    findExistingCheckRun: (o, r, sha, signal) => findExistingCheckRun(octokit, o, r, sha, signal),
    publishReview: async () => undefined,
    publishCheckRun: async () => undefined,
  };

  const logger = createLogger([config.model.apiKey, githubToken]);
  const result = await runReviewPass(
    { owner, repo, pullNumber: options.pullNumber, trigger: "manual" },
    { github, model, config, clock: createSystemClock(), logger },
  );

  const record: ControlPassRecord = {
    recordedAt: new Date().toISOString(),
    owner,
    repo,
    pullNumber: options.pullNumber,
    headSha: result.reviewedHeadSha ?? pr.headSha,
    arm: options.repositoryContext,
    outcome: result.outcome,
    findingCount: result.findings.length,
    repositoryContext: result.repositoryContext,
  };

  mkdirSync(dirname(outFilePath), { recursive: true });
  appendFileSync(outFilePath, `${JSON.stringify(record)}\n`, "utf8");

  console.log(`Ronda control pass: outcome = ${result.outcome}, recorded to ${outFilePath}`);

  const writeAttempts = getWriteAttempts();
  if (writeAttempts !== 0) {
    console.error(
      `Ronda control pass refused ${writeAttempts} GitHub write attempt(s) — the no-write guarantee failed.`,
    );
    return 1;
  }

  return result.outcome === "failed" ? 1 : 0;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let options: ControlPassOptions;
  try {
    options = parseControlPassArgs(argv);
  } catch (error) {
    console.error(error instanceof ControlPassUsageError ? error.message : String(error));
    return 1;
  }

  const githubToken = process.env.GITHUB_TOKEN ?? "";
  const { octokit: realOctokit } = createGithubClient({ token: githubToken });
  let writeAttempts = 0;
  const octokit = createNoWriteOctokit(realOctokit, () => {
    writeAttempts += 1;
  });

  return runControlPass(options, { octokit, githubToken, getWriteAttempts: () => writeAttempts });
}

if (process.argv[1] && process.argv[1].endsWith("control-pass.ts")) {
  main().then((code) => {
    process.exitCode = code;
  });
}
