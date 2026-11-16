#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Octokit } from "@octokit/rest";
import { createSystemClock } from "../core/clock.js";
import { createLogger } from "../core/logger.js";
import { runReviewPass } from "../core/run-review-pass.js";
import { describeConfigLoadFailure, loadConfig } from "../config/load-config.js";
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
import type { ChangedFile, GithubOperations, ReviewPassResult } from "../domain/review-pass.types.js";
import type { Severity } from "../domain/severity.js";
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
 *   npm run quality:control-pass -- --pr <number> --repository-context on|off [--repo <owner/repo>] [--out <path>] [--plant-fixture <path>]
 *
 * `--plant-fixture` (#142) appends one committed synthetic changed file to the
 * pull request's real changed-file list for this run alone, in memory, so a
 * control pass can show that a known defect in a non-excluded file is still
 * reported alongside path exclusion. Nothing is pushed to the pull request;
 * the record names the fixture so a planted pass is never mistaken for a
 * plain one.
 */

export const DEFAULT_CONTROL_PASS_OUT_PATH = "docs/testing/ronda/repository-context-control-passes.jsonl";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export class ControlPassUsageError extends Error {}

export interface ControlPassOptions {
  pullNumber: number;
  repositoryContext: "on" | "off";
  repo: string;
  outPath: string;
  /** Repository-relative path to a committed planted-changed-file fixture (#142). */
  plantFixturePath?: string;
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
  let plantFixturePath: string | undefined;

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
    } else if (arg === "--plant-fixture" && next !== undefined) {
      plantFixturePath = next;
      index += 1;
    }
  }

  const usage =
    "Usage: quality:control-pass -- --pr <number> --repository-context on|off [--repo <owner/repo>] [--out <path>] [--plant-fixture <path>]";

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

  const options: ControlPassOptions = {
    pullNumber: parseInt(pullNumberRaw, 10),
    repositoryContext: repositoryContextRaw,
    repo,
    outPath,
  };
  if (plantFixturePath !== undefined) {
    options.plantFixturePath = plantFixturePath;
  }
  return options;
}

/** Refuses a path that resolves outside the repository root (an operator-specific path never becomes the destination). */
export function resolveControlPassOutPath(outPath: string, repoRoot: string = REPO_ROOT): string {
  return resolveInsideRepo("--out", outPath, repoRoot);
}

function resolveInsideRepo(flag: string, path: string, repoRoot: string): string {
  const resolved = resolve(repoRoot, path);
  const rel = relative(repoRoot, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ControlPassUsageError(`${flag} resolves outside the repository root: ${path}`);
  }
  return resolved;
}

/**
 * A committed planted-changed-file fixture (#142): one synthetic changed file
 * plus a statement of the defect it plants, so the evidence record can say
 * what a reviewer was expected to find.
 */
export interface PlantedFixture {
  path: string;
  patch: string;
  additions: number;
  defect: string;
}

/**
 * Reads and validates a planted fixture. Only a repository-relative fixture
 * file is accepted, and the planted path must be a plain repository-relative
 * path, so the fixture cannot point the pass at anything outside the repository.
 */
export function loadPlantedFixture(fixturePath: string, repoRoot: string = REPO_ROOT): PlantedFixture {
  const resolved = resolveInsideRepo("--plant-fixture", fixturePath, repoRoot);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(resolved, "utf8"));
  } catch (error) {
    throw new ControlPassUsageError(`--plant-fixture could not be read as JSON: ${fixturePath} (${String(error)})`);
  }
  const candidate = parsed as Partial<PlantedFixture> | null;
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    typeof candidate.path !== "string" ||
    candidate.path === "" ||
    candidate.path.startsWith("/") ||
    candidate.path.split("/").includes("..") ||
    typeof candidate.patch !== "string" ||
    candidate.patch === "" ||
    typeof candidate.additions !== "number" ||
    !Number.isInteger(candidate.additions) ||
    candidate.additions < 0 ||
    typeof candidate.defect !== "string" ||
    candidate.defect === ""
  ) {
    throw new ControlPassUsageError(
      `--plant-fixture must hold { path, patch, additions, defect } with a repository-relative path: ${fixturePath}`,
    );
  }
  return {
    path: candidate.path,
    patch: candidate.patch,
    additions: candidate.additions,
    defect: candidate.defect,
  };
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
  /**
   * Cost fields for the AC14 cost arms (#132): wall-clock time of the review
   * pass itself, the inference requests it issued, the configured model name
   * and every distinct provider-reported model identity those requests
   * returned (empty when the endpoint reported none), and the sweep mode the
   * pass ran under, so two arms' configurations can be compared field by field.
   */
  elapsedMs: number;
  modelCallCount: number;
  modelName: string;
  reportedModels: string[];
  sweepMode: RondaConfig["sweepMode"];
  /**
   * Path-exclusion evidence (#142): the exclusion globs the pass ran under,
   * every finding's location and title (bodies omitted to keep the record
   * small), and the review summary body the pass would have published —
   * which names the excluded files — captured locally instead of being sent
   * anywhere. `null` when the pass ended before composing a review.
   */
  excludePathGlobs: string[];
  findings: Array<{ path: string; line: number | null; severity: Severity; title: string }>;
  summary: string | null;
  /** Present only for a pass run with `--plant-fixture`. */
  plantedFixture?: { fixturePath: string; path: string; defect: string };
}

/**
 * Wraps a model client so the control pass can report how many inference
 * requests the pass issued and which model identities the provider reported
 * (#132). Pure pass-through otherwise.
 */
export function countingModelClient(model: ModelClient): {
  model: ModelClient;
  calls: () => number;
  reportedModels: () => string[];
} {
  let calls = 0;
  const reported = new Set<string>();
  return {
    model: {
      modelName: model.modelName,
      async complete(request, signal) {
        calls += 1;
        const completion = await model.complete(request, signal);
        if (completion.reportedModel !== undefined) {
          reported.add(completion.reportedModel);
        }
        return completion;
      },
    },
    calls: () => calls,
    reportedModels: () => [...reported].sort(),
  };
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
  let planted: PlantedFixture | undefined;
  try {
    outFilePath = resolveControlPassOutPath(options.outPath);
    if (options.plantFixturePath !== undefined) {
      planted = loadPlantedFixture(options.plantFixturePath);
    }
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
      const { loadError, loadErrorDetail } = describeConfigLoadFailure(error);
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
        loadErrorDetail,
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

  const baseModel =
    runDeps.modelOverride ??
    createOpenAiCompatibleClient({
      apiKey: config.model.apiKey,
      baseUrl: config.model.baseUrl,
      modelName: config.model.modelName,
    });

  // Pure, local, non-publishing implementations (AC22): findings and the
  // check-run text are captured for the evidence record instead of being
  // sent anywhere. Neither ever calls `octokit`.
  let capturedSummary: string | null = null;
  const github: GithubOperations = {
    readPullRequest: (o, r, n, signal) => readPullRequest(octokit, o, r, n, signal),
    readChangedFiles: async (o, r, n, signal) => {
      const files = await readChangedFiles(octokit, o, r, n, signal);
      if (planted === undefined) {
        return files;
      }
      const plantedFile: ChangedFile = {
        path: planted.path,
        status: "added",
        patch: planted.patch,
        additions: planted.additions,
        deletions: 0,
      };
      return [...files.filter((file) => file.path !== planted.path), plantedFile];
    },
    readFileAtRef: (o, r, path, ref, signal, opts) => readRepositoryFileAtRef(octokit, o, r, path, ref, signal, opts),
    findExistingCheckRun: (o, r, sha, signal) => findExistingCheckRun(octokit, o, r, sha, signal),
    publishReview: async (input) => {
      capturedSummary = input.summaryBody;
    },
    publishCheckRun: async () => undefined,
  };

  const counting = countingModelClient(baseModel);
  const model = counting.model;

  const logger = createLogger([config.model.apiKey, githubToken]);
  const startedAt = Date.now();
  const result = await runReviewPass(
    { owner, repo, pullNumber: options.pullNumber, trigger: "manual" },
    { github, model, config, clock: createSystemClock(), logger },
  );
  const elapsedMs = Date.now() - startedAt;

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
    elapsedMs,
    modelCallCount: counting.calls(),
    modelName: config.model.modelName,
    reportedModels: counting.reportedModels(),
    sweepMode: config.sweepMode,
    excludePathGlobs: [...config.excludePathGlobs],
    findings: result.findings.map((finding) => ({
      path: finding.path,
      line: finding.line,
      severity: finding.severity,
      title: finding.title,
    })),
    summary: capturedSummary,
  };
  if (planted !== undefined && options.plantFixturePath !== undefined) {
    record.plantedFixture = { fixturePath: options.plantFixturePath, path: planted.path, defect: planted.defect };
  }

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
