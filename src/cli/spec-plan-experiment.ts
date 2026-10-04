#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { Octokit } from "@octokit/rest";
import { ConfigLoadError, loadConfig } from "../config/load-config.js";
import {
  DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
  DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
  DEFAULT_MAX_PATCH_CHARS,
} from "../config/load-config.js";
import {
  applyAuthoritativeDocBudgets,
  collectChangedPaths,
  selectAuthoritativeDocCandidates,
} from "../core/select-authoritative-docs.js";
import type { ChangedFile } from "../domain/review-pass.types.js";
import { createGithubClient } from "../github/github-client.js";
import { readRepositoryFileAtRef } from "../github/repo-content-reader.js";
import type { ModelClient } from "../inference/model-client.js";
import { createOpenAiCompatibleClient, CHAT_COMPLETION_TEMPERATURE } from "../inference/openai-compatible-client.js";
import { parseModelResponse, UnusableModelOutputError } from "../inference/parse-model-response.js";
import { buildReviewPrompt, ChangesTooLargeError, type ReviewPrompt } from "../inference/review-prompt.js";
import { reviewStageForBranch } from "../review/stage-resolution.js";
import { createNoWriteOctokit } from "./control-pass.js";

/**
 * The spec/plan miss experiment (#143). Re-reviews recorded spec and plan heads
 * under three arms and writes the findings only to a committed evidence file —
 * never a review, check run or comment on GitHub. Operator-initiated only.
 *
 * It is evidence, not a product feature: it reuses `buildReviewPrompt` and the
 * model client as they are, changes no default, and adds no switch to
 * `runReviewPass`.
 *
 *   npm run quality:spec-plan-experiment -- --arm A|B|C [--runs 3] [--head <sha>] [--model <id>] [--dry-run]
 *
 * Arm A is the production prompt unchanged. Arms B and C use the spec/plan
 * prompt below. Arm C names its model with `--model`, pinned by exact id.
 */

export type ExperimentArm = "A" | "B" | "C";
export type ExperimentStage = "spec" | "plan";

export const DEFAULT_HEADS_PATH = "docs/testing/ronda/spec-plan-experiment-heads-143.md";
export const DEFAULT_OUT_PATH = "docs/testing/ronda/spec-plan-experiment-143.jsonl";
export const DEFAULT_REPOSITORY = "lhpaul/ronda";
export const DEFAULT_RUNS = 3;

/** The spec #115 merged, read at its merge commit so later edits cannot leak into the plan replay. */
export const APPROVED_SPEC_PATH =
  "docs/specs/developments/20260925143028_105-category-forced-review-sweep/1_105-category-forced-review-sweep_specs.md";
export const APPROVED_SPEC_REF = "def04bd48cf551c62ff5d00ef4965c6471491600";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export class SpecPlanExperimentUsageError extends Error {}

export interface ExperimentHead {
  pullNumber: number;
  stage: ExperimentStage;
  headSha: string;
  recordedMisses: number;
}

export interface ExperimentOptions {
  arm: ExperimentArm;
  runs: number;
  repo: string;
  headsPath: string;
  outPath: string;
  /** Restrict the run to one committed head. */
  onlyHead?: string;
  /** Arm C's model, pinned by exact id. Required for arm C, refused for A and B. */
  modelName?: string;
  /** Build every prompt and write records, but send no model request. */
  dryRun: boolean;
  /**
   * `synthesize` (default) gives every arm the document text for a file GitHub
   * returned no patch for; `github` reproduces production, which sends that file
   * as "(no textual diff available for this file)".
   */
  patchSource: "synthesize" | "github";
}

/** A model id that ends in a date (`-YYYY-MM-DD` or `-YYYYMMDD`), the form providers use for an immutable snapshot. */
export function isDatedModelId(modelName: string): boolean {
  return /[-@]\d{4}-\d{2}-\d{2}$/.test(modelName) || /[-@]\d{8}$/.test(modelName);
}

export function parseExperimentArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
): ExperimentOptions {
  const usage =
    "Usage: quality:spec-plan-experiment -- --arm A|B|C [--runs <n>] [--head <sha>] [--model <id>] [--patch-source synthesize|github] [--dry-run] [--repo <owner/repo>] [--heads <path>] [--out <path>]";
  let arm: string | undefined;
  let runsRaw: string | undefined;
  let repo = env.GITHUB_REPOSITORY ?? DEFAULT_REPOSITORY;
  let headsPath = DEFAULT_HEADS_PATH;
  let outPath = DEFAULT_OUT_PATH;
  let onlyHead: string | undefined;
  let modelName: string | undefined;
  let dryRun = false;
  let patchSource: "synthesize" | "github" = "synthesize";

  const valueOptions = new Set(["--patch-source", "--arm", "--runs", "--repo", "--heads", "--out", "--head", "--model"]);
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (!valueOptions.has(arg)) {
      throw new SpecPlanExperimentUsageError(`Unknown option "${arg}". ${usage}`);
    }
    // A value is never another option: `--out --dry-run` must not silently
    // turn a dry run into paid model requests.
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new SpecPlanExperimentUsageError(`${arg} requires a value. ${usage}`);
    }
    index += 1;
    if (arg === "--patch-source") {
      if (value !== "synthesize" && value !== "github") {
        throw new SpecPlanExperimentUsageError(`--patch-source must be "synthesize" or "github". ${usage}`);
      }
      patchSource = value;
    } else if (arg === "--arm") {
      arm = value;
    } else if (arg === "--runs") {
      runsRaw = value;
    } else if (arg === "--repo") {
      repo = value;
    } else if (arg === "--heads") {
      headsPath = value;
    } else if (arg === "--out") {
      outPath = value;
    } else if (arg === "--head") {
      onlyHead = value;
    } else {
      modelName = value;
    }
  }

  // No default arm: an arm that is guessed cannot be paired with anything.
  if (arm !== "A" && arm !== "B" && arm !== "C") {
    throw new SpecPlanExperimentUsageError(`--arm is required and must be A, B or C. ${usage}`);
  }
  if (runsRaw !== undefined && !/^[1-9]\d*$/.test(runsRaw)) {
    throw new SpecPlanExperimentUsageError(`--runs must be a positive integer. ${usage}`);
  }
  if (arm === "C" && !dryRun && !modelName) {
    // Arm C's model is the one thing the owner chooses, and it is pinned
    // directly so the model that answered is known. There is no fallback.
    throw new SpecPlanExperimentUsageError(`--model is required for arm C (an exact, dated model id). ${usage}`);
  }
  if (modelName !== undefined && !isDatedModelId(modelName)) {
    // An alias such as `qwen-plus` can move between runs, and then no difference
    // between arms can be attributed to the model that was chosen.
    throw new SpecPlanExperimentUsageError(
      `--model must be an exact dated model id ending in a date (for example name-2025-12-01 or name-20251201), not an alias: "${modelName}". ${usage}`,
    );
  }
  if (arm !== "C" && modelName) {
    throw new SpecPlanExperimentUsageError(`--model is only valid for arm C; arms A and B use the configured model. ${usage}`);
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new SpecPlanExperimentUsageError(`--repo must be an "owner/repo" value. ${usage}`);
  }

  return {
    arm,
    runs: runsRaw ? parseInt(runsRaw, 10) : DEFAULT_RUNS,
    repo,
    headsPath,
    outPath,
    ...(onlyHead ? { onlyHead } : {}),
    ...(modelName ? { modelName } : {}),
    dryRun,
    patchSource,
  };
}

/** Refuses a path that resolves outside the repository root. */
export function resolveRepoPath(path: string, repoRoot: string = REPO_ROOT): string {
  const resolved = resolve(repoRoot, path);
  const rel = relative(repoRoot, resolved);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new SpecPlanExperimentUsageError(`Path resolves outside the repository root: ${path}`);
  }
  return resolved;
}

/**
 * Reads the chosen heads from the committed manifest, so the run can only use
 * the list that was committed before it. Rows look like
 * `| #115 | spec | \`<40-hex sha>\` | 5 | 6 of 99 |`.
 */
export function parseHeadsManifest(markdown: string): ExperimentHead[] {
  const heads: ExperimentHead[] = [];
  const row = /^\|\s*#(\d+)\s*\|\s*(spec|plan)\s*\|\s*`([0-9a-f]{40})`\s*\|\s*(\d+)\s*\|/;
  for (const line of markdown.split("\n")) {
    const match = row.exec(line);
    if (match) {
      heads.push({
        pullNumber: parseInt(match[1], 10),
        stage: match[2] as ExperimentStage,
        headSha: match[3],
        recordedMisses: parseInt(match[4], 10),
      });
    }
  }
  return heads;
}

/** The text of one `## ` section of REVIEW.md, heading included, up to the next `## ` heading. */
export function extractChecklist(reviewMarkdown: string, stage: ExperimentStage): string {
  const heading = stage === "spec" ? "## Spec Review Checklist" : "## Plan Review Checklist";
  const lines = reviewMarkdown.split("\n");
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start < 0) {
    throw new SpecPlanExperimentUsageError(`REVIEW.md has no "${heading}" section`);
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n").trim();
}

/**
 * The spec/plan system prompt (arms B and C). Written once, before any arm
 * runs, and not tuned against the recorded misses. It keeps the production JSON
 * findings contract and severities and replaces "review this code change" with
 * "review this document against the repository's own checklist".
 */
export function buildSpecPlanSystemPrompt(stage: ExperimentStage, checklist: string): string {
  const documentKind = stage === "spec" ? "specification" : "implementation plan";
  const planOnly =
    stage === "plan"
      ? [
          "",
          "The approved specification this plan implements is supplied in the user message as advisory context. A plan is reviewed against that specification: report a place where the plan contradicts it, leaves a specified behaviour unplanned, or plans behaviour the specification does not describe.",
        ]
      : [];
  return [
    `You are Ronda, a comment-only GitHub pull-request reviewer. The change under review adds or edits a ${documentKind}, not source code. You never suggest a commit or a merge; you only report findings for a human or another automated fixer to act on.`,
    "",
    'Respond with ONLY a single JSON object matching this exact contract and nothing else — no prose, no Markdown fence:',
    '{"findings":[{"path":"relative/file/path","line":42,"severity":"blocking"|"important"|"nit","title":"Short imperative title","body":"Why this matters and what to do about it."}]}',
    "",
    "Severity meanings:",
    '- "blocking": a defect in the document the author should fix before it is approved.',
    '- "important": a real problem worth fixing that does not by itself block approval.',
    '- "nit": style, naming, or clarity. Informational.',
    "",
    `Review the ${documentKind} against the checklist below. Read the whole document before reporting: the defects that matter most here are contradictions between sections, cases the document never defines, terms used with two meanings, requirements that cannot be tested as written, and statements that only hold under an unstated assumption. Quote or name the sections that conflict.`,
    "Report every independently actionable defect you can identify, including several in the same section. Avoid duplicate findings for the same underlying defect. Do not report a defect the document already acknowledges and resolves.",
    ...planOnly,
    "",
    "If you find nothing, respond with {\"findings\":[]}. Use \"line\" as the right-side (new file) line number the finding applies to, or omit it when the finding does not map to one line.",
    "",
    "## Review checklist (from the repository's REVIEW.md)",
    checklist,
  ].join("\n");
}

export interface BuildArmPromptInput {
  arm: ExperimentArm;
  stage: ExperimentStage;
  title: string;
  body: string;
  changedFiles: ChangedFile[];
  maxPatchChars: number;
  authoritativeDocs: Array<{ id: string; path: string; role: "binding" | "advisory"; text: string }>;
  checklist: string;
  /** The approved spec, for plan heads under arms B and C. */
  approvedSpec?: { path: string; text: string };
}

/**
 * Arm A is `buildReviewPrompt` exactly as production calls it. Arms B and C keep
 * its user-message assembly and replace only the system prompt; a plan head also
 * receives the approved spec as one more advisory document.
 */
export function buildArmPrompt(input: BuildArmPromptInput): ReviewPrompt {
  const withSpec =
    input.arm !== "A" && input.stage === "plan" && input.approvedSpec
      ? [
          ...input.authoritativeDocs,
          {
            id: "approved-spec",
            path: input.approvedSpec.path,
            role: "advisory" as const,
            text: input.approvedSpec.text,
          },
        ]
      : input.authoritativeDocs;
  const base = buildReviewPrompt({
    title: input.title,
    body: input.body,
    changedFiles: input.changedFiles,
    maxPatchChars: input.maxPatchChars,
    authoritativeDocs: withSpec,
  });
  if (input.arm === "A") {
    return base;
  }
  return {
    systemPrompt: buildSpecPlanSystemPrompt(input.stage, input.checklist),
    userPrompt: base.userPrompt,
  };
}

export interface ExperimentFinding {
  path: string;
  line?: number;
  severity: string;
  title: string;
  body: string;
}

export interface ExperimentRecord {
  recordedAt: string;
  repo: string;
  pullNumber: number;
  stage: ExperimentStage;
  headSha: string;
  arm: ExperimentArm;
  run: number;
  /** The model id requested (arms A/B: the configured model; arm C: `--model`). */
  modelRequested: string;
  /** What the endpoint reported for this response, if anything. */
  modelReported?: string;
  temperature: number;
  checklistSha256: string;
  dryRun: boolean;
  /** Whether files GitHub returned no patch for were sent as document text (`synthesize`) or as production sends them (`github`). */
  patchSource: "synthesize" | "github";
  /** Files that had no GitHub patch (large diffs), whichever way they were sent. */
  filesWithoutGithubPatch: string[];
  outcome: "findings" | "no_findings" | "changes_too_large" | "unusable_output" | "model_error" | "dry_run";
  errorMessage?: string;
  findingCount: number;
  findings: ExperimentFinding[];
  malformedCount: number;
  /** The model client exposes no token usage, so size is recorded in characters. */
  promptChars: number;
  responseChars: number;
  elapsedMs: number;
}

export interface RunExperimentDeps {
  octokit: Octokit;
  /** Called by the no-write wrapper; must stay 0. */
  getWriteAttempts: () => number;
  /** Test-only seam: the model for arms A and B. */
  modelOverride?: ModelClient;
  /** Test-only seam: builds arm C's model from its pinned id. */
  armCModelFactory?: (modelName: string) => ModelClient;
  reviewMarkdown?: string;
  now?: () => number;
}

function toExperimentFinding(finding: {
  path: string;
  line: number | null;
  severity: string;
  title: string;
  body: string;
}): ExperimentFinding {
  return {
    path: finding.path,
    ...(finding.line !== null ? { line: finding.line } : {}),
    severity: finding.severity,
    title: finding.title,
    body: finding.body,
  };
}

export function attemptKey(
  headSha: string,
  arm: ExperimentArm,
  run: number,
  patchSource: "synthesize" | "github",
  modelRequested: string,
): string {
  return `${headSha}|${arm}|${run}|${patchSource}|${modelRequested}`;
}

/** Keys of the attempts already recorded with a usable result (anything but a dry run, model error or unusable output). */
export function completedAttemptKeys(outPath: string): Set<string> {
  const keys = new Set<string>();
  if (!existsSync(outPath)) {
    return keys;
  }
  for (const line of readFileSync(outPath, "utf8").split("\n")) {
    if (line.trim() === "") {
      continue;
    }
    let record: Partial<ExperimentRecord>;
    try {
      record = JSON.parse(line) as Partial<ExperimentRecord>;
    } catch {
      continue;
    }
    if (
      record.dryRun === false &&
      record.outcome !== "model_error" &&
      record.outcome !== "unusable_output" &&
      typeof record.headSha === "string" &&
      (record.arm === "A" || record.arm === "B" || record.arm === "C") &&
      typeof record.run === "number" &&
      (record.patchSource === "synthesize" || record.patchSource === "github") &&
      typeof record.modelRequested === "string"
    ) {
      keys.add(attemptKey(record.headSha, record.arm, record.run, record.patchSource, record.modelRequested));
    }
  }
  return keys;
}

/** A whole-file addition patch for a document GitHub returned no patch for. */
export function synthesizeAddedPatch(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return [`@@ -0,0 +1,${lines.length} @@`, ...lines.map((line) => `+${line}`)].join("\n");
}

/**
 * The diff production would have reviewed at `headSha`: GitHub's three-dot
 * compare from the pull request's base tip, which is the diff against the
 * merge base. Files are paged by hand because the compare endpoint pages its
 * `files` array and `paginate` does not follow it.
 */
async function readChangedFilesAtHead(
  octokit: Octokit,
  owner: string,
  repo: string,
  baseTipSha: string,
  headSha: string,
): Promise<ChangedFile[]> {
  const perPage = 100;
  const changed: ChangedFile[] = [];
  for (let page = 1; page <= 30; page += 1) {
    const response = await octokit.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${baseTipSha}...${headSha}`,
      per_page: perPage,
      page,
    });
    const files = response.data.files ?? [];
    for (const file of files) {
      changed.push({
        path: file.filename,
        previousPath: file.previous_filename,
        status: file.status,
        patch: file.patch,
        additions: file.additions,
        deletions: file.deletions,
      });
    }
    if (files.length < perPage) {
      break;
    }
  }
  return changed;
}

/** The model settings and the production budgets the replay must share with production, so arm A is the same baseline. */
export interface ExperimentConfig {
  modelName: string;
  apiKey: string;
  baseUrl: string;
  maxPatchChars?: number;
  maxAuthoritativeDocCount?: number;
  maxAuthoritativeDocChars?: number;
}

/**
 * The testable core: everything after argv parsing and octokit construction.
 * Returns the records it wrote, and a process exit code.
 */
export async function runExperiment(
  options: ExperimentOptions,
  deps: RunExperimentDeps,
  config: ExperimentConfig,
): Promise<{ code: number; records: ExperimentRecord[] }> {
  const [owner, repo] = options.repo.split("/");
  const now = deps.now ?? (() => Date.now());
  const headsPath = resolveRepoPath(options.headsPath);
  const outPath = resolveRepoPath(options.outPath);

  let heads = parseHeadsManifest(readFileSync(headsPath, "utf8"));
  if (heads.length === 0) {
    throw new SpecPlanExperimentUsageError(`No heads found in ${options.headsPath}`);
  }
  if (options.onlyHead) {
    heads = heads.filter((head) => head.headSha.startsWith(options.onlyHead as string));
    if (heads.length === 0) {
      throw new SpecPlanExperimentUsageError(`--head ${options.onlyHead} matches no committed head`);
    }
  }

  const reviewMarkdown = deps.reviewMarkdown ?? readFileSync(join(REPO_ROOT, "REVIEW.md"), "utf8");

  const modelRequested = options.arm === "C" ? (options.modelName ?? "(dry-run)") : config.modelName;
  let model: ModelClient | undefined;
  if (!options.dryRun) {
    model =
      options.arm === "C"
        ? (deps.armCModelFactory ?? ((name) => createOpenAiCompatibleClient({ ...config, modelName: name })))(
            options.modelName as string,
          )
        : (deps.modelOverride ?? createOpenAiCompatibleClient(config));
  }

  let approvedSpec: { path: string; text: string } | undefined;
  const records: ExperimentRecord[] = [];
  // Resume, not duplicate: an attempt that already has a usable record is not
  // run again, so a rerun after an interruption or a failed attempt cannot give
  // a head more than its fixed number of runs. Failed attempts are retried and
  // the later record supersedes them; dry runs never count.
  const completed = completedAttemptKeys(outPath);

  for (const head of heads) {
    // The head's own branch decides the stage, as production does; the manifest's stage must agree.
    const pull = (await deps.octokit.pulls.get({ owner, repo, pull_number: head.pullNumber })).data;
    const pr = { title: pull.title, body: pull.body ?? "", headBranch: pull.head.ref ?? "" };
    const stage = reviewStageForBranch(pr.headBranch);
    if (stage !== head.stage) {
      throw new SpecPlanExperimentUsageError(
        `#${head.pullNumber} branch "${pr.headBranch}" resolves to stage "${stage}", but the manifest says "${head.stage}"`,
      );
    }
    const githubFiles = await readChangedFilesAtHead(deps.octokit, owner, repo, pull.base.sha, head.headSha);
    // GitHub omits `patch` for a large diff, and production then sends the model
    // "(no textual diff available for this file)" — the document is never seen.
    const filesWithoutGithubPatch = githubFiles
      .filter((file) => file.patch === undefined && file.status !== "removed")
      .map((file) => file.path);
    const changedFiles: ChangedFile[] = [];
    for (const file of githubFiles) {
      if (options.patchSource === "synthesize" && filesWithoutGithubPatch.includes(file.path)) {
        const text = await readRepositoryFileAtRef(deps.octokit, owner, repo, file.path, head.headSha);
        if (text === undefined) {
          throw new SpecPlanExperimentUsageError(`#${head.pullNumber}: ${file.path} has no GitHub patch and is unreadable at ${head.headSha}`);
        }
        changedFiles.push({ ...file, patch: synthesizeAddedPatch(text) });
      } else {
        changedFiles.push(file);
      }
    }

    const readAtHead = (path: string) =>
      readRepositoryFileAtRef(deps.octokit, owner, repo, path, head.headSha);
    const candidates = selectAuthoritativeDocCandidates(collectChangedPaths(changedFiles)).candidates;
    const withText = [];
    for (const candidate of candidates) {
      withText.push({
        id: candidate.id,
        path: candidate.path,
        role: candidate.role,
        priority: candidate.priority,
        text: await readAtHead(candidate.path),
      });
    }
    const authoritativeDocs = applyAuthoritativeDocBudgets(withText, {
      maxAuthoritativeDocCount: config.maxAuthoritativeDocCount ?? DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
      maxAuthoritativeDocChars: config.maxAuthoritativeDocChars ?? DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
    }).selected;

    if (stage === "plan" && options.arm !== "A" && !approvedSpec) {
      const text = await readRepositoryFileAtRef(deps.octokit, owner, repo, APPROVED_SPEC_PATH, APPROVED_SPEC_REF);
      if (text === undefined) {
        throw new SpecPlanExperimentUsageError(`Approved spec ${APPROVED_SPEC_PATH} is unreadable at ${APPROVED_SPEC_REF}`);
      }
      approvedSpec = { path: APPROVED_SPEC_PATH, text };
    }

    const checklist = extractChecklist(reviewMarkdown, stage);
    const checklistSha256 = createHash("sha256").update(checklist).digest("hex");

    for (let run = 1; run <= options.runs; run += 1) {
      if (!options.dryRun && completed.has(attemptKey(head.headSha, options.arm, run, options.patchSource, modelRequested))) {
        continue;
      }
      const base: Omit<ExperimentRecord, "outcome" | "findingCount" | "findings" | "malformedCount" | "promptChars" | "responseChars" | "elapsedMs"> = {
        recordedAt: new Date(now()).toISOString(),
        repo: options.repo,
        pullNumber: head.pullNumber,
        stage,
        headSha: head.headSha,
        arm: options.arm,
        run,
        modelRequested,
        temperature: CHAT_COMPLETION_TEMPERATURE,
        checklistSha256,
        dryRun: options.dryRun,
        patchSource: options.patchSource,
        filesWithoutGithubPatch,
      };
      const finish = (extra: Partial<ExperimentRecord> & Pick<ExperimentRecord, "outcome">): void => {
        records.push({
          ...base,
          findingCount: 0,
          findings: [],
          malformedCount: 0,
          promptChars: 0,
          responseChars: 0,
          elapsedMs: 0,
          ...extra,
        });
      };

      let prompt: ReviewPrompt;
      try {
        prompt = buildArmPrompt({
          arm: options.arm,
          stage,
          title: pr.title,
          body: pr.body,
          changedFiles,
          maxPatchChars: config.maxPatchChars ?? DEFAULT_MAX_PATCH_CHARS,
          authoritativeDocs,
          checklist,
          ...(approvedSpec ? { approvedSpec } : {}),
        });
      } catch (error) {
        if (error instanceof ChangesTooLargeError) {
          // Recorded, not skipped: a spec over the patch budget is itself a result.
          finish({ outcome: "changes_too_large", errorMessage: error.message });
          continue;
        }
        throw error;
      }
      const promptChars = prompt.systemPrompt.length + prompt.userPrompt.length;

      if (!model) {
        finish({ outcome: "dry_run", promptChars });
        continue;
      }

      const started = now();
      let content: string;
      let modelReported: string | undefined;
      try {
        const completion = await model.complete(prompt, AbortSignal.timeout(600_000));
        content = completion.content;
        modelReported = completion.reportedModel;
      } catch (error) {
        finish({ outcome: "model_error", errorMessage: error instanceof Error ? error.message : String(error), promptChars, elapsedMs: now() - started });
        continue;
      }
      const elapsedMs = now() - started;
      try {
        const parsed = parseModelResponse(content, changedFiles);
        finish({
          outcome: parsed.findings.length > 0 ? "findings" : "no_findings",
          ...(modelReported ? { modelReported } : {}),
          findingCount: parsed.findings.length,
          findings: parsed.findings.map(toExperimentFinding),
          malformedCount: parsed.malformedCount,
          promptChars,
          responseChars: content.length,
          elapsedMs,
        });
      } catch (error) {
        if (!(error instanceof UnusableModelOutputError)) {
          throw error;
        }
        finish({
          outcome: "unusable_output",
          errorMessage: error.message,
          ...(modelReported ? { modelReported } : {}),
          promptChars,
          responseChars: content.length,
          elapsedMs,
        });
      }
    }
  }

  mkdirSync(dirname(outPath), { recursive: true });
  appendFileSync(outPath, records.map((record) => `${JSON.stringify(record)}\n`).join(""), "utf8");

  const writeAttempts = deps.getWriteAttempts();
  if (writeAttempts !== 0) {
    console.error(`Spec/plan experiment refused ${writeAttempts} GitHub write attempt(s) — the no-write guarantee failed.`);
    return { code: 1, records };
  }
  console.log(`Spec/plan experiment arm ${options.arm}: ${records.length} record(s) appended to ${outPath}`);
  // Every attempt is recorded either way, but a run that produced no usable
  // result must not read as success to whatever drives the next arm.
  const unusable = records.filter((record) => record.outcome === "model_error" || record.outcome === "unusable_output");
  if (unusable.length > 0) {
    console.error(`${unusable.length} of ${records.length} run(s) produced no usable result (model_error or unusable_output); the arm is incomplete.`);
    return { code: 1, records };
  }
  return { code: 0, records };
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  let options: ExperimentOptions;
  try {
    options = parseExperimentArgs(argv);
  } catch (error) {
    console.error(error instanceof SpecPlanExperimentUsageError ? error.message : String(error));
    return 1;
  }

  const githubToken = process.env.GITHUB_TOKEN ?? "";
  const { octokit: realOctokit } = createGithubClient({ token: githubToken });
  let writeAttempts = 0;
  const octokit = createNoWriteOctokit(realOctokit, () => {
    writeAttempts += 1;
  });

  let modelConfig: ExperimentConfig = { modelName: "(not configured)", apiKey: "", baseUrl: "" };
  try {
    const loaded = loadConfig();
    modelConfig = {
      modelName: loaded.model.modelName,
      apiKey: loaded.model.apiKey,
      baseUrl: loaded.model.baseUrl,
      maxPatchChars: loaded.maxPatchChars,
      maxAuthoritativeDocCount: loaded.maxAuthoritativeDocCount,
      maxAuthoritativeDocChars: loaded.maxAuthoritativeDocChars,
    };
  } catch (error) {
    // A dry run sends no model request, so it may proceed on the built-in
    // budgets; a real run must not guess at the production baseline.
    if (!options.dryRun) {
      console.error(error instanceof ConfigLoadError ? error.publicMessage : "Failed to load Ronda config");
      return 1;
    }
  }
  if (!options.dryRun && !modelConfig.apiKey) {
    console.error("No model credential is configured (RONDA_MODEL_API_KEY or modelApiKey in the operator config file).");
    return 1;
  }

  try {
    const { code } = await runExperiment(options, { octokit, getWriteAttempts: () => writeAttempts }, modelConfig);
    return code;
  } catch (error) {
    console.error(error instanceof SpecPlanExperimentUsageError ? error.message : `Experiment failed: ${String(error)}`);
    return 1;
  }
}

if (process.argv[1] && process.argv[1].endsWith("spec-plan-experiment.ts")) {
  main().then((code) => {
    process.exitCode = code;
  });
}
