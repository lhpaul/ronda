import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import {
  CHAT_COMPLETION_TEMPERATURE,
  createOpenAiCompatibleClient,
} from "../inference/openai-compatible-client.js";
import { parseModelResponse } from "../inference/parse-model-response.js";
import { buildReviewPrompt } from "../inference/review-prompt.js";
import { ModelClientError, type ModelClient } from "../inference/model-client.js";
import { GithubClientError } from "../github/github-client.js";
import {
  classifyFindings as classifySweepFindings,
  loadSweepList,
  type SweepClassification,
  type SweepListResult,
} from "../review/sweep-categories.js";
import { loadConfig } from "../config/load-config.js";
import type {
  ChangedFile,
  Finding,
  SweepCategory,
  SweepCategoryList,
  SweepPassRecord,
} from "../domain/review-pass.types.js";
import type { Severity } from "../domain/severity.js";
import type {
  DurabilityModeSetting,
  RondaConfig,
  SweepModeSetting,
} from "../config/config.types.js";

/** Which of AC13's four exhaustive ways a harder credential case differs by. */
export type HarderCredentialWay =
  | "qualifier-or-prefix-added-to-name"
  | "different-letter-case-convention"
  | "different-word-separator"
  | "name-or-value-wrapped-in-another-construct";

/**
 * AC13's comparability metadata: which of the four ways a harder credential
 * seed differs by, and the canonical baseline form it is compared against, so
 * "harder" is checkable without judgment.
 */
export interface HarderCredentialMetadata {
  /** The seeded case this one is compared against. */
  baselineId: string;
  /** The baseline case's canonical name form. */
  canonicalName: string;
  /** The baseline case's canonical value form. */
  canonicalValue: string;
  /** At least one way; AC13's four are exhaustive. */
  differsBy: HarderCredentialWay[];
}

export interface RecallBenchmarkDefect {
  id: string;
  category: string;
  expectedSeverity: Severity;
  path: string;
  description: string;
  matchTerms: string[];
  matchTermGroups?: string[][];
  forbiddenValue?: string;
  harderThan?: HarderCredentialMetadata;
}

export interface RecallBenchmarkManifest {
  benchmarkId: string;
  seededDefects: RecallBenchmarkDefect[];
  qualityCategories?: string[];
  precisionFixtures?: PrecisionFixture[];
}

export interface RecallBenchmarkSummary {
  benchmarkId: string;
  totalSeededDefects: number;
  foundSeededDefects: string[];
  missedSeededDefects: string[];
  falsePositives: Array<{
    path: string;
    line: number | null;
    severity: Severity;
    title: string;
  }>;
  model: string;
  reviewedTarget: string;
  timestamp: string;
  /**
   * Content identity of the inputs this run read. Unconditional on every run
   * record of both arms (AC8, AC9) — it is what distinguishes the extended
   * fixture from the byte-identical `original-thirteen` snapshot when both
   * declare the same `benchmarkId`.
   */
  fixture?: BenchmarkFixtureIdentity;
  /** The effective review configuration this run used. Present on both arms. */
  configuration?: BenchmarkConfigurationIdentity;
  /** AC9's category-list version; carried only by a sweep-on run, which alone ran a list. */
  sweepListVersion?: string;
  /** AC1's per-category record; carried only by a sweep-on run. */
  sweepPassRecord?: SweepPassRecord;
  /** The same run's recall over just the thirteen original seeds, when its manifest holds all thirteen. */
  originalThirteenSubset?: OriginalThirteenSubset;
  /** Inference requests this pass issued — present on both arms (AC11 compares them). */
  modelCallCount?: number;
  /** Wall-clock milliseconds this pass spent, both arms. */
  elapsedMs?: number;
}

/** The stage a failed campaign run stopped at. */
export type BenchmarkFailureReason = "model" | "github" | "timeout" | "unknown";

/**
 * One campaign run that threw. Recorded rather than discarded so a
 * partially-failed campaign still reports every attempted run (AC11's cost
 * comparison needs the survivors). Carries the identity blocks resolved
 * *before* the run's inference — they are available even when it fails — and
 * none of the recall, per-category, subset, or cost fields, which only a run
 * that completed can honestly report.
 */
export interface BenchmarkRunFailure {
  runIndex: number;
  fixture: BenchmarkFixtureIdentity;
  configuration: BenchmarkConfigurationBase;
  failure: {
    reason: BenchmarkFailureReason;
    /** The thrown message, already passed through the runner's redaction. */
    message: string;
    /** True when the pass timeout aborted the run, rather than an ordinary error. */
    aborted: boolean;
  };
}

/** One entry of a campaign: a successful run, or a recorded failure. */
export type BenchmarkRunRecord = RecallBenchmarkSummary | BenchmarkRunFailure;

/** The resolved input files a benchmark run read, by content rather than by name. */
export interface BenchmarkFixtureIdentity {
  /** The resolved `--manifest` path this run read. */
  manifestPath: string;
  /** The manifest's own `benchmarkId`; two distinct fixtures may share one. */
  benchmarkId: string;
  seedCount: number;
  /** SHA-256 of the manifest file as read. */
  manifestSha256: string;
  /** SHA-256 of the patch file as read. */
  patchesSha256: string;
}

/**
 * One inference request's identity, captured from the response it came from.
 * A per-request entry rather than a client-level most-recent value, which the
 * parallel precision `Promise.all` would race.
 */
export interface BenchmarkRequestIdentity {
  /** What the request was for: the recall pass, or one named precision fixture. */
  kind: "recall" | "precision";
  /** The precision fixture id when `kind` is `"precision"`. */
  fixtureId?: string;
  /** That response's provider-reported identity, absent when the endpoint reported none. */
  reportedModel?: string;
  /**
   * SHA-256 over *this request's* own composed prompt with the sweep section
   * excluded. Each request composes separately — the recall prompt and every
   * precision prompt carry their own title and patch set — so a change to one
   * only must still move the record. The run-level `promptFingerprint` above
   * cannot see that: it hashes the recall template alone.
   */
  promptFingerprint?: string;
}

/** The configuration facts a run records before its inference — everything but the per-request identities. */
export interface BenchmarkConfigurationBase {
  sweepMode: SweepModeSetting;
  /** The configured model name. An alias; never substituted for a request's reported identity. */
  modelName: string;
  /** The operator attestation recorded verbatim, or null when unattested (the fail-closed case). */
  versionAttestation: string | null;
  maxPatchChars: number;
  durabilityMode: DurabilityModeSetting;
  durabilityModeDefault: boolean;
  /** The effective non-prompt request parameters the client sends. */
  requestParameters: { temperature: number };
  /** SHA-256 over the composed prompt template with the sweep section excluded. */
  promptFingerprint: string;
}

export interface BenchmarkConfigurationIdentity extends BenchmarkConfigurationBase {
  /** One entry per inference request, each carrying its own response's reported identity. */
  requests: BenchmarkRequestIdentity[];
}

/**
 * The same run's recall restricted to the thirteen seeds the pre-extension
 * fixture declared, read off *that run* rather than off the standalone control.
 * Self-checking: the two id lists are the run's own lists filtered to those
 * thirteen, so their union is exactly the thirteen.
 */
export interface OriginalThirteenSubset {
  ids: string[];
  foundSeededDefects: string[];
  missedSeededDefects: string[];
}

export interface PrecisionFixture {
  id: string;
  description: string;
  expected: "clean";
  changedFiles: ChangedFile[];
  forbiddenValues?: string[];
}

export interface PrecisionFixtureSummary {
  id: string;
  expected: "clean";
  clean: boolean;
  falsePositiveCount: number;
  falsePositives: FindingSummary[];
  /**
   * AC9's per-category record for *this* fixture's own findings — the precision
   * request's sweep outcome, recorded independently of the recall pass's, so a
   * sweep-on precision finding is attributed to the category (or categories, or
   * uncategorized) recorded for it. Present only on a sweep-on run, which alone
   * ran a list; a sweep-off run's findings are reported as unattributed by its
   * absence.
   */
  sweepPassRecord?: SweepPassRecord;
}

export type ComparisonAdjudicationOutcome =
  | "ronda_miss"
  | "ronda_better"
  | "duplicate"
  | "clean_agreement"
  | "unclear";

export interface ReviewComparisonRecord {
  id: string;
  repository: string;
  pullNumber: number;
  headSha: string;
  ronda: ReviewComparisonSide;
  otherReviewer: ReviewComparisonSide & { name: string };
  adjudications: Array<{
    outcome: ComparisonAdjudicationOutcome;
    findingTitle?: string;
    notes?: string;
  }>;
}

export interface ReviewComparisonSide {
  result: "clean" | "findings" | "failed" | "timeout";
  reviewedHeadSha: string;
  findings: Finding[];
}

export interface ReviewComparisonSummary {
  id: string;
  repository: string;
  pullNumber: number;
  headSha: string;
  reviewer: string;
  sameHead: boolean;
  rondaFindingCount: number;
  otherReviewerFindingCount: number;
  adjudicationCounts: Record<ComparisonAdjudicationOutcome, number>;
  falseCleanCandidate: boolean;
}

export interface QualityBenchmarkSummary extends RecallBenchmarkSummary {
  qualityCategories: string[];
  missedCategories: string[];
  precisionFixtures: PrecisionFixtureSummary[];
  comparisons: ReviewComparisonSummary[];
  sameHeadVariance?: {
    baselineTarget: string;
    comparisonTarget: string;
    sameModel: boolean;
    foundChanged: boolean;
    missedChanged: boolean;
    falsePositiveCountChanged: boolean;
  };
}

interface FindingSummary {
  path: string;
  line: number | null;
  severity: Severity;
  title: string;
}

export interface RunRecallBenchmarkInput {
  manifest: RecallBenchmarkManifest;
  changedFiles: ChangedFile[];
  model: ModelClient;
  maxPatchChars: number;
  reviewedTarget: string;
  timestamp: string;
  signal?: AbortSignal;
  /** The swept categories, when the run has a list; omitted leaves the prompt unchanged. */
  sweepCategories?: SweepCategory[];
}

export interface RunPrecisionFixtureInput {
  fixture: PrecisionFixture;
  model: ModelClient;
  maxPatchChars: number;
  signal?: AbortSignal;
  sweepCategories?: SweepCategory[];
}

/** The recall pass's result plus the identity only the response can report. */
export interface RecallBenchmarkRun {
  summary: RecallBenchmarkSummary;
  /** The parsed findings, carried out for the campaign's sweep classification. */
  findings: Finding[];
  /** That response's provider-reported identity; absent when the endpoint reported none. */
  reportedModel?: string;
  /** SHA-256 over this request's own composed prompt, sweep section excluded. */
  promptFingerprint?: string;
}

export interface CliOptions {
  manifestPath: string;
  patchesPath: string;
  responsePath?: string;
  maxPatchChars?: number;
  reviewedTarget?: string;
  quality?: boolean;
  precisionResponsePath?: string;
  comparisonPath?: string;
  previousSummaryPath?: string;
  /** The configuration under test; absent means `off`. The benchmark's only sweep switch. */
  sweepMode?: SweepModeSetting;
  /** Repeat the run this many times, emitting one record per run. Default 1. */
  runs?: number;
  /** Write the JSON summary here instead of stdout. */
  outputFilePath?: string;
  /** Recorded verbatim; absent leaves the version unattested (the fail-closed case). */
  versionAttestation?: string;
}

const DEFAULT_MANIFEST_PATH = "tests/fixtures/recall-benchmark/manifest.json";
const DEFAULT_PATCHES_PATH = "tests/fixtures/recall-benchmark/patches.json";

/**
 * The recall fixture's composed prompt. One builder so the prompt fingerprint,
 * which hashes this template *without* the sweep section, and the prompt
 * actually sent can never drift apart.
 */
function buildRecallPrompt(
  manifest: RecallBenchmarkManifest,
  changedFiles: ChangedFile[],
  maxPatchChars: number,
  sweepCategories?: SweepCategory[],
): ReturnType<typeof buildReviewPrompt> {
  return buildReviewPrompt({
    title: `Recall benchmark: ${manifest.benchmarkId}`,
    body: "Seeded benchmark fixture for measuring review recall.",
    changedFiles,
    maxPatchChars,
    ...(sweepCategories ? { sweepCategories } : {}),
  });
}

/**
 * One recall pass, returning the parsed findings alongside the summary because
 * the campaign's sweep classification reads the findings' own text, and the
 * per-response `reportedModel` because only this response can report it.
 */
async function runRecallPass(input: RunRecallBenchmarkInput): Promise<RecallBenchmarkRun> {
  const prompt = buildRecallPrompt(
    input.manifest,
    input.changedFiles,
    input.maxPatchChars,
    input.sweepCategories,
  );
  const completion = await input.model.complete(prompt, input.signal ?? new AbortController().signal);
  const parsed = parseModelResponse(completion.content, input.changedFiles);
  const summary = classifyFindings({
    manifest: input.manifest,
    findings: parsed.findings,
    model: input.model.modelName,
    reviewedTarget: input.reviewedTarget,
    timestamp: input.timestamp,
  });
  return {
    summary,
    findings: parsed.findings,
    promptFingerprint: fingerprintPrompt(prompt),
    ...(completion.reportedModel !== undefined ? { reportedModel: completion.reportedModel } : {}),
  };
}

export async function runRecallBenchmark(
  input: RunRecallBenchmarkInput,
): Promise<RecallBenchmarkSummary> {
  return (await runRecallPass(input)).summary;
}

/**
 * A precision pass's summary plus the identity only its own response can report:
 * its findings, because AC9's per-fixture sweep classification reads the
 * findings' own wording, and `promptFingerprint`, because only this pass
 * composed this prompt.
 */
interface PrecisionFixtureRun {
  summary: PrecisionFixtureSummary;
  findings: Finding[];
  reportedModel?: string;
  promptFingerprint?: string;
}

async function runPrecisionPass(input: RunPrecisionFixtureInput): Promise<PrecisionFixtureRun> {
  const prompt = buildReviewPrompt({
    title: `Precision benchmark: ${input.fixture.id}`,
    body: input.fixture.description,
    changedFiles: input.fixture.changedFiles,
    maxPatchChars: input.maxPatchChars,
    ...(input.sweepCategories ? { sweepCategories: input.sweepCategories } : {}),
  });
  const completion = await input.model.complete(prompt, input.signal ?? new AbortController().signal);
  const parsed = parseModelResponse(completion.content, input.fixture.changedFiles);
  const summary = classifyPrecisionFixture({
    fixture: input.fixture,
    findings: parsed.findings,
  });
  return {
    summary,
    findings: parsed.findings,
    promptFingerprint: fingerprintPrompt(prompt),
    ...(completion.reportedModel !== undefined ? { reportedModel: completion.reportedModel } : {}),
  };
}

export async function runPrecisionFixture(
  input: RunPrecisionFixtureInput,
): Promise<PrecisionFixtureSummary> {
  return (await runPrecisionPass(input)).summary;
}

export function classifyFindings(input: {
  manifest: RecallBenchmarkManifest;
  findings: Finding[];
  model: string;
  reviewedTarget: string;
  timestamp: string;
}): RecallBenchmarkSummary {
  const matchedFindingIndexes = new Set<number>();
  const foundSeededDefects: string[] = [];
  const missedSeededDefects: string[] = [];

  for (const defect of input.manifest.seededDefects) {
    const matchIndex = input.findings.findIndex((finding, index) => {
      if (matchedFindingIndexes.has(index)) {
        return false;
      }
      return findingMatchesDefect(finding, defect);
    });

    if (matchIndex === -1) {
      missedSeededDefects.push(defect.id);
    } else {
      matchedFindingIndexes.add(matchIndex);
      foundSeededDefects.push(defect.id);
    }
  }

  const falsePositives = input.findings
    .filter((_finding, index) => !matchedFindingIndexes.has(index))
    .map((finding) => summarizeFinding(finding, forbiddenValues(input.manifest)));

  return {
    benchmarkId: input.manifest.benchmarkId,
    totalSeededDefects: input.manifest.seededDefects.length,
    foundSeededDefects,
    missedSeededDefects,
    falsePositives,
    model: input.model,
    reviewedTarget: input.reviewedTarget,
    timestamp: input.timestamp,
  };
}

export function classifyPrecisionFixture(input: {
  fixture: PrecisionFixture;
  findings: Finding[];
}): PrecisionFixtureSummary {
  const falsePositives = input.findings.map((finding) =>
    summarizeFinding(finding, input.fixture.forbiddenValues ?? []),
  );

  return {
    id: input.fixture.id,
    expected: input.fixture.expected,
    clean: falsePositives.length === 0,
    falsePositiveCount: falsePositives.length,
    falsePositives,
  };
}

export function summarizeReviewComparison(
  record: ReviewComparisonRecord,
): ReviewComparisonSummary {
  const sameHead =
    record.headSha === record.ronda.reviewedHeadSha &&
    record.headSha === record.otherReviewer.reviewedHeadSha;
  const adjudicationCounts = emptyAdjudicationCounts();

  for (const adjudication of record.adjudications) {
    adjudicationCounts[adjudication.outcome] += 1;
  }

  return {
    id: record.id,
    repository: record.repository,
    pullNumber: record.pullNumber,
    headSha: record.headSha,
    reviewer: record.otherReviewer.name,
    sameHead,
    rondaFindingCount: record.ronda.findings.length,
    otherReviewerFindingCount: record.otherReviewer.findings.length,
    adjudicationCounts,
    falseCleanCandidate:
      sameHead &&
      record.ronda.result === "clean" &&
      (adjudicationCounts.ronda_miss > 0 ||
        (record.otherReviewer.findings.length > 0 &&
          adjudicationCounts.unclear > 0)),
  };
}

export function buildQualityBenchmarkSummary(input: {
  recall: RecallBenchmarkSummary;
  manifest: RecallBenchmarkManifest;
  precisionFixtures?: PrecisionFixtureSummary[];
  comparisons?: ReviewComparisonSummary[];
  previousSummary?: RecallBenchmarkSummary;
}): QualityBenchmarkSummary {
  const missed = new Set(input.recall.missedSeededDefects);
  const missedCategories = input.manifest.seededDefects
    .filter((defect) => missed.has(defect.id))
    .map((defect) => defect.category);

  return {
    ...input.recall,
    qualityCategories:
      input.manifest.qualityCategories ??
      Array.from(new Set(input.manifest.seededDefects.map((defect) => defect.category))),
    missedCategories,
    precisionFixtures: input.precisionFixtures ?? [],
    comparisons: input.comparisons ?? [],
    sameHeadVariance: input.previousSummary
      ? summarizeVariance(input.previousSummary, input.recall)
      : undefined,
  };
}

function findingMatchesDefect(finding: Finding, defect: RecallBenchmarkDefect): boolean {
  if (finding.path !== defect.path) {
    return false;
  }
  if (defect.id === "sensitive-value-exposure" && finding.severity !== "blocking") {
    return false;
  }
  if (
    defect.forbiddenValue &&
    `${finding.title} ${finding.body}`.includes(defect.forbiddenValue)
  ) {
    return false;
  }

  const text = `${finding.title} ${finding.body}`.toLowerCase();
  const groups = defect.matchTermGroups ?? [defect.matchTerms];
  return groups.some((group) => group.every((term) => text.includes(term.toLowerCase())));
}

function forbiddenValues(manifest: RecallBenchmarkManifest): string[] {
  return manifest.seededDefects
    .map((defect) => defect.forbiddenValue)
    .filter((value): value is string => typeof value === "string" && value.length > 0);
}

function summarizeFinding(finding: Finding, forbidden: string[]): FindingSummary {
  return {
    path: finding.path,
    line: finding.line,
    severity: finding.severity,
    title: redactForbiddenValues(finding.title, forbidden),
  };
}

function redactForbiddenValues(value: string, forbidden: string[]): string {
  return forbidden.reduce((current, secret) => current.split(secret).join("[redacted]"), value);
}

function emptyAdjudicationCounts(): Record<ComparisonAdjudicationOutcome, number> {
  return {
    ronda_miss: 0,
    ronda_better: 0,
    duplicate: 0,
    clean_agreement: 0,
    unclear: 0,
  };
}

function summarizeVariance(
  baseline: RecallBenchmarkSummary,
  current: RecallBenchmarkSummary,
): QualityBenchmarkSummary["sameHeadVariance"] {
  return {
    baselineTarget: baseline.reviewedTarget,
    comparisonTarget: current.reviewedTarget,
    sameModel: baseline.model === current.model,
    foundChanged: stringSetsDiffer(baseline.foundSeededDefects, current.foundSeededDefects),
    missedChanged: stringSetsDiffer(baseline.missedSeededDefects, current.missedSeededDefects),
    falsePositiveCountChanged: baseline.falsePositives.length !== current.falsePositives.length,
  };
}

function stringSetsDiffer(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return true;
  }
  const rightSet = new Set(right);
  return left.some((value) => !rightSet.has(value));
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    manifestPath: DEFAULT_MANIFEST_PATH,
    patchesPath: DEFAULT_PATCHES_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--manifest" && next) {
      options.manifestPath = next;
      index += 1;
    } else if (arg === "--patches" && next) {
      options.patchesPath = next;
      index += 1;
    } else if (arg === "--response-file" && next) {
      options.responsePath = next;
      index += 1;
    } else if (arg === "--max-patch-chars" && next) {
      options.maxPatchChars = parsePositiveInt(next, "--max-patch-chars");
      index += 1;
    } else if (arg === "--reviewed-target" && next) {
      options.reviewedTarget = next;
      index += 1;
    } else if (arg === "--quality") {
      options.quality = true;
    } else if (arg === "--precision-response-file" && next) {
      options.precisionResponsePath = next;
      index += 1;
    } else if (arg === "--comparison-file" && next) {
      options.comparisonPath = next;
      index += 1;
    } else if (arg === "--previous-summary-file" && next) {
      options.previousSummaryPath = next;
      index += 1;
    } else if (arg === "--sweep-mode" && next) {
      options.sweepMode = parseSweepModeArg(next);
      index += 1;
    } else if (arg === "--runs" && next) {
      options.runs = parsePositiveInt(next, "--runs");
      index += 1;
    } else if (arg === "--output-file" && next) {
      options.outputFilePath = next;
      index += 1;
    } else if (arg === "--version-attestation" && next) {
      options.versionAttestation = next;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

function parsePositiveInt(value: string, name: string): number {
  // The whole argument must be digits: `Number.parseInt` alone would read the
  // prefix of `5x` or `5.9` and run a different count than the operator gave,
  // and the sample count is part of a campaign's evidence contract.
  const parsed = /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

/**
 * The benchmark's own two-value sweep switch. Written here rather than reusing
 * the config parser because `--sweep-mode` is a benchmark input, and an
 * unrecognized value is a typo in a command line, not an operator setting to
 * carry forward.
 */
function parseSweepModeArg(value: string): SweepModeSetting {
  if (value === "on" || value === "off") {
    return value;
  }
  throw new Error(`--sweep-mode must be "on" or "off", received: ${value}`);
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function createFixtureModel(responsePath: string): ModelClient {
  return {
    modelName: `fixture:${responsePath}`,
    async complete() {
      return { content: readFileSync(responsePath, "utf8") };
    },
  };
}

/**
 * The input identity of one run: what was read, not what was configured. The
 * hashes cover the bytes as read, so a snapshot fixture that reindents or
 * reorders its manifest hashes differently even when the seeds match.
 */
function buildFixtureIdentity(
  options: CliOptions,
  manifest: RecallBenchmarkManifest,
): BenchmarkFixtureIdentity {
  return {
    manifestPath: options.manifestPath,
    benchmarkId: manifest.benchmarkId,
    seedCount: manifest.seededDefects.length,
    manifestSha256: sha256Hex(readFileSync(options.manifestPath, "utf8")),
    patchesSha256: sha256Hex(readFileSync(options.patchesPath, "utf8")),
  };
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * The prompt fingerprint: SHA-256 over the composed prompt template with the
 * sweep section excluded, so the two arms' fingerprints are equal by
 * construction. Built through the same `buildRecallPrompt` the pass uses, so a
 * template change moves the fingerprint and the prompt together.
 */
function buildPromptFingerprint(
  manifest: RecallBenchmarkManifest,
  changedFiles: ChangedFile[],
  maxPatchChars: number,
): string {
  const prompt = buildRecallPrompt(manifest, changedFiles, maxPatchChars);
  return sha256Hex(`${prompt.systemPrompt}\n${prompt.userPrompt}`);
}

/** Where `appendSweepCategoryInstructions` appends its block — the section's own heading. */
const SWEEP_SECTION_MARKER = "\n\n## Category-forced sweep";

/**
 * One request's own fingerprint, over the prompt that request actually composed
 * (`buildReviewPrompt`'s return shape) with the sweep section stripped, so the
 * two arms of the same request agree by construction. Per request rather than
 * per run: the recall prompt and each precision prompt carry their own title and
 * patch set, so a change to one only must still move its own entry, which the
 * run-level `configuration.promptFingerprint` — recall template alone — cannot
 * see.
 *
 * The sweep block is a pure suffix of `systemPrompt`, so truncating at the
 * marker yields exactly the un-swept prompt without re-composing it.
 */
function fingerprintPrompt(prompt: ReturnType<typeof buildReviewPrompt>): string {
  const markerIndex = prompt.systemPrompt.indexOf(SWEEP_SECTION_MARKER);
  const systemPrompt =
    markerIndex === -1 ? prompt.systemPrompt : prompt.systemPrompt.slice(0, markerIndex);
  return sha256Hex(`${systemPrompt}\n${prompt.userPrompt}`);
}

/**
 * Everything about a run that does not depend on a response. The per-request
 * identities are layered on top, so the success record and the failure record
 * of the same configuration agree on every other field.
 */
function buildConfigurationBase(input: {
  config: RondaConfig;
  sweepMode: SweepModeSetting;
  modelName: string;
  versionAttestation: string | undefined;
  maxPatchChars: number;
  promptFingerprint: string;
}): BenchmarkConfigurationBase {
  return {
    sweepMode: input.sweepMode,
    modelName: input.modelName,
    versionAttestation: input.versionAttestation ?? null,
    maxPatchChars: input.maxPatchChars,
    durabilityMode: input.config.durabilityMode,
    durabilityModeDefault: input.config.durabilityModeDefault,
    requestParameters: { temperature: CHAT_COMPLETION_TEMPERATURE },
    promptFingerprint: input.promptFingerprint,
  };
}

/** The thirteen ids the pre-extension snapshot declares — the control fixture's scope. */
const ORIGINAL_THIRTEEN_IDS = [
  "expired-session-inversion",
  "sensitive-value-exposure",
  "cache-capacity-off-by-one",
  "sql-interpolation",
  "invalid-range-parsing",
  "lexicographic-numeric-sort",
  "lower-element-median",
  "empty-word-title-casing",
  "authorization-bypass",
  "data-loss-overwrite",
  "async-race-duplicate-processing",
  "configuration-debug-default",
  "stale-sha-review-publication",
] as const;

/**
 * The run's own found/missed lists, filtered to the thirteen ids the snapshot
 * declares. Present only where the run's manifest holds every one of them, so
 * the extended fixture — which adds five more — reports no subset rather than a
 * mislabeled one.
 */
function buildOriginalThirteenSubset(
  summary: RecallBenchmarkSummary,
  manifest: RecallBenchmarkManifest,
): OriginalThirteenSubset | undefined {
  const declared = new Set<string>(ORIGINAL_THIRTEEN_IDS);
  const held = manifest.seededDefects.filter((defect) => declared.has(defect.id));
  if (held.length !== ORIGINAL_THIRTEEN_IDS.length) {
    return undefined;
  }
  return {
    ids: [...ORIGINAL_THIRTEEN_IDS],
    foundSeededDefects: summary.foundSeededDefects.filter((id) => declared.has(id)),
    missedSeededDefects: summary.missedSeededDefects.filter((id) => declared.has(id)),
  };
}

/**
 * The stage a thrown error stopped at, derived from the error's own type: each
 * client's failure vocabulary is private to it, so the campaign's reason names
 * the stage rather than restating either client's reasons.
 */
function classifyFailure(error: unknown, aborted: boolean): BenchmarkFailureReason {
  if (error instanceof ModelClientError) {
    return error.reason === "timed_out" ? "timeout" : "model";
  }
  if (error instanceof GithubClientError) {
    return "github";
  }
  if (aborted) {
    return "timeout";
  }
  return "unknown";
}

/** The redacted failure detail every failure record carries. */
function buildFailureDetail(
  error: unknown,
  manifest: RecallBenchmarkManifest,
  aborted: boolean,
): BenchmarkRunFailure["failure"] {
  const message = error instanceof Error ? error.message : String(error);
  return {
    reason: classifyFailure(error, aborted),
    message: redactForbiddenValues(message, forbiddenValues(manifest)),
    aborted,
  };
}

/** One run's resolved inputs, shared by that run's success and failure records. */
interface CampaignRunContext {
  options: CliOptions;
  manifest: RecallBenchmarkManifest;
  changedFiles: ChangedFile[];
  config: RondaConfig;
  sweepMode: SweepModeSetting;
  maxPatchChars: number;
  promptFingerprint: string;
}

/** Counts model calls, so a run's cost is this run's, not the campaign's. */
interface ModelCallCounter {
  wrap(model: ModelClient): ModelClient;
  value(): number;
}

function createModelCallCounter(): ModelCallCounter {
  let count = 0;
  return {
    wrap(model) {
      return {
        modelName: model.modelName,
        async complete(request, signal) {
          count += 1;
          return model.complete(request, signal);
        },
      };
    },
    value: () => count,
  };
}

/**
 * The campaign's `runIndex`, `fixture`, and `configuration`, layered over one
 * pass's own recorded identity.
 */
function composeRunRecord(input: {
  context: CampaignRunContext;
  pass: RecallBenchmarkRun;
  configuration: BenchmarkConfigurationIdentity;
  sweep: (SweepClassification & { listVersion: string }) | undefined;
  modelCallCount: number;
  elapsedMs: number;
}): RecallBenchmarkSummary {
  const subset = buildOriginalThirteenSubset(input.pass.summary, input.context.manifest);
  return {
    ...input.pass.summary,
    fixture: buildFixtureIdentity(input.context.options, input.context.manifest),
    configuration: input.configuration,
    modelCallCount: input.modelCallCount,
    elapsedMs: input.elapsedMs,
    ...(input.sweep !== undefined
      ? {
          sweepListVersion: input.sweep.listVersion,
          sweepPassRecord: { ...input.sweep },
        }
      : {}),
    ...(subset !== undefined ? { originalThirteenSubset: subset } : {}),
  };
}

/**
 * Await every request of one run, cancelling the siblings when one rejects and
 * waiting for them to settle before the run completes. `Promise.all` alone would
 * reject at once, and the run's `finally` would then clear its deadline while a
 * sibling request was still in flight, letting it outlive `passTimeoutMs` and
 * overlap the next run of the campaign. The first rejection is rethrown once
 * every request has settled.
 */
async function settleOrAbort<T>(
  controller: AbortController,
  requests: Array<Promise<T>>,
): Promise<T[]> {
  const settled = await Promise.allSettled(
    requests.map((request) =>
      request.catch((error: unknown) => {
        controller.abort();
        throw error;
      }),
    ),
  );
  const rejected = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected !== undefined) {
    throw rejected.reason;
  }
  return settled.map((result) => (result as PromiseFulfilledResult<T>).value);
}

/**
 * One campaign run. Its `AbortController` and `passTimeoutMs` timer are
 * constructed here and disposed in `finally`, so each run's timeout is its own
 * and a recorded failure cannot leave a pending timer behind. A throw becomes a
 * failure record rather than escaping, so the campaign continues and the
 * completed runs are not discarded.
 */
async function runOneCampaignRun(
  context: CampaignRunContext,
  deps: BenchmarkCampaignDeps,
  list: SweepCategoryList | undefined,
  runIndex: number,
): Promise<BenchmarkRunRecord> {
  const startedAt = Date.now();
  const controller = new AbortController();
  // Whether the deadline fired is tracked apart from the signal: the run also
  // aborts its own controller to cancel sibling requests after an ordinary
  // error, and that must not read as a `passTimeoutMs` timeout.
  let deadlineFired = false;
  let expireDeadline: (error: Error) => void = () => undefined;
  // Rejects when the deadline fires, so a client or provider that ignores the
  // abort cannot hold the run, its failure record, or the runs after it hostage.
  const deadline = new Promise<never>((_resolve, reject) => {
    expireDeadline = reject;
  });
  deadline.catch(() => undefined);
  const timeout = setTimeout(() => {
    deadlineFired = true;
    controller.abort();
    expireDeadline(new Error(`the pass exceeded its ${context.config.passTimeoutMs} ms deadline`));
  }, context.config.passTimeoutMs);
  timeout.unref?.();
  const counter = createModelCallCounter();
  const sweepCategories = list !== undefined ? list.categories : undefined;

  const runBody = async (): Promise<BenchmarkRunRecord> => {
    const model = counter.wrap(
      await deps.createModel({ options: context.options, config: context.config, runIndex }),
    );

    // A run whose deadline already fired has had its failure record returned. A
    // client that ignored the abort can still resume here, so each stage checks
    // the signal before it issues more requests or logs, rather than starting
    // stale model calls that overlap the next run.
    controller.signal.throwIfAborted();

    const pass = await runRecallPass({
      manifest: context.manifest,
      changedFiles: context.changedFiles,
      model,
      maxPatchChars: context.maxPatchChars,
      reviewedTarget: context.options.reviewedTarget ?? context.manifest.benchmarkId,
      timestamp: new Date().toISOString(),
      signal: controller.signal,
      ...(sweepCategories !== undefined ? { sweepCategories } : {}),
    });
    controller.signal.throwIfAborted();

    const precisionResults: PrecisionFixtureRun[] =
      context.options.quality && context.manifest.precisionFixtures
        ? await settleOrAbort(
            controller,
            context.manifest.precisionFixtures.map((fixture): Promise<PrecisionFixtureRun> =>
              context.options.precisionResponsePath
                ? Promise.resolve(
                    ((): PrecisionFixtureRun => {
                      // The offline seam issues no request, so it records no
                      // prompt identity — but it does carry the findings it parsed,
                      // which AC9's per-fixture attribution still needs.
                      const findings = parsedResponseFindings(
                        context.options.precisionResponsePath as string,
                        fixture.changedFiles,
                      );
                      return {
                        summary: classifyPrecisionFixture({ fixture, findings }),
                        findings,
                      };
                    })(),
                  )
                : runPrecisionPass({
                    fixture,
                    model,
                    maxPatchChars: context.maxPatchChars,
                    signal: controller.signal,
                    ...(sweepCategories !== undefined ? { sweepCategories } : {}),
                  }),
            ),
          )
        : [];
    controller.signal.throwIfAborted();

    // AC9: each precision request's own findings are classified against the same
    // list, independently of the recall pass's, so a sweep-on precision finding is
    // attributed to the category (or categories, or uncategorized) recorded for it
    // — and a sweep-off run's is reported unattributed by this record's absence.
    // Logged like the recall pass's (AC20's benchmark-output surface), identifiers
    // and indices only: the same key set as the recall line, so the two surfaces
    // stay one schema. The fixture's identity is not a field of the record — it is
    // carried by the JSON, where the record sits under its `precisionFixtures` entry.
    if (list !== undefined) {
      precisionResults.forEach((result) => {
        result.summary.sweepPassRecord = {
          listVersion: list.version,
          ...classifySweepFindings(result.findings, list),
        };
        console.error(
          JSON.stringify({
            event: "sweep_pass_record",
            runIndex,
            ...result.summary.sweepPassRecord,
          }),
        );
      });
    }

    const configuration: BenchmarkConfigurationIdentity = {
      ...buildConfigurationBase({
        config: context.config,
        sweepMode: context.sweepMode,
        modelName: pass.summary.model,
        versionAttestation: context.options.versionAttestation,
        maxPatchChars: context.maxPatchChars,
        promptFingerprint: context.promptFingerprint,
      }),
      requests: [
        {
          kind: "recall",
          ...(pass.promptFingerprint !== undefined
            ? { promptFingerprint: pass.promptFingerprint }
            : {}),
          ...(pass.reportedModel !== undefined ? { reportedModel: pass.reportedModel } : {}),
        },
        ...precisionResults.map((result, index) => ({
          kind: "precision" as const,
          fixtureId: context.manifest.precisionFixtures?.[index]?.id ?? "",
          ...(result.promptFingerprint !== undefined
            ? { promptFingerprint: result.promptFingerprint }
            : {}),
          ...(result.reportedModel !== undefined ? { reportedModel: result.reportedModel } : {}),
        })),
      ],
    };

    const sweep =
      list === undefined
        ? undefined
        : {
            listVersion: list.version,
            ...classifySweepFindings(pass.findings, list),
          };
    const sweepRecord =
      sweep === undefined
        ? undefined
        : {
            listVersion: sweep.listVersion,
            categories: sweep.categories,
            findings: sweep.findings,
            uncategorizedFindingCount: sweep.uncategorizedFindingCount,
          };
    if (sweepRecord !== undefined) {
      // AC1: a benchmark pass publishes no check run, so the per-category record
      // is the only place this pass's sweep outcome reaches an operator's logs.
      // Category identifiers and counts only — never a finding's own text.
      console.error(
        JSON.stringify({ event: "sweep_pass_record", runIndex, ...sweepRecord }),
      );
    }

    const record = composeRunRecord({
      context,
      pass,
      configuration,
      sweep: sweepRecord,
      modelCallCount: counter.value(),
      elapsedMs: Date.now() - startedAt,
    });

    if (!context.options.quality) {
      return record;
    }
    return buildQualityBenchmarkSummary({
      recall: record,
      manifest: context.manifest,
      precisionFixtures: precisionResults.map((result) => result.summary),
      comparisons: context.options.comparisonPath
        ? readJsonFile<ReviewComparisonRecord[]>(context.options.comparisonPath).map(
            summarizeReviewComparison,
          )
        : [],
      previousSummary: context.options.previousSummaryPath
        ? readJsonFile<RecallBenchmarkSummary>(context.options.previousSummaryPath)
        : undefined,
    });
  };

  try {
    return await Promise.race([runBody(), deadline]);
  } catch (error) {
    return {
      runIndex,
      fixture: buildFixtureIdentity(context.options, context.manifest),
      configuration: buildConfigurationBase({
        config: context.config,
        sweepMode: context.sweepMode,
        modelName: context.config.model.modelName,
        versionAttestation: context.options.versionAttestation,
        maxPatchChars: context.maxPatchChars,
        promptFingerprint: context.promptFingerprint,
      }),
      failure: buildFailureDetail(error, context.manifest, deadlineFired),
    };
  } finally {
    clearTimeout(timeout);
  }
}

/** Injected run seams, mirroring `ReviewPassDeps`' optional-seam precedent. */
export interface BenchmarkCampaignDeps {
  loadConfig: () => RondaConfig;
  createModel: (input: {
    options: CliOptions;
    config: RondaConfig;
    runIndex: number;
  }) => ModelClient | Promise<ModelClient>;
  loadSweepList: (options?: { path?: string }) => SweepListResult;
}

/** The production seams; tests replace the model and the config reader. */
export const DEFAULT_BENCHMARK_DEPS: BenchmarkCampaignDeps = {
  loadConfig,
  createModel: ({ options, config }) =>
    options.responsePath
      ? createFixtureModel(options.responsePath)
      : createOpenAiCompatibleClient({
          apiKey: config.model.apiKey,
          baseUrl: config.model.baseUrl,
          modelName: config.model.modelName,
        }),
  loadSweepList,
};

/**
 * Runs one benchmark campaign. `--runs n > 1` emits the n records as a JSON
 * array; a run that fails is recorded, not discarded, and the campaign
 * continues to the next run, so a partial campaign still reports every
 * attempted run and still exits non-zero.
 */
export async function runBenchmarkCampaign(
  options: CliOptions,
  deps: BenchmarkCampaignDeps = DEFAULT_BENCHMARK_DEPS,
): Promise<number> {
  const manifest = readJsonFile<RecallBenchmarkManifest>(options.manifestPath);
  const changedFiles = readJsonFile<ChangedFile[]>(options.patchesPath);
  const config = deps.loadConfig();
  const sweepMode = options.sweepMode ?? "off";
  const maxPatchChars = options.maxPatchChars ?? config.maxPatchChars;
  const context: CampaignRunContext = {
    options,
    manifest,
    changedFiles,
    config,
    sweepMode,
    maxPatchChars,
    promptFingerprint: buildPromptFingerprint(manifest, changedFiles, maxPatchChars),
  };

  let list: SweepCategoryList | undefined;
  if (sweepMode === "on") {
    const loaded = deps.loadSweepList();
    if (!loaded.ok) {
      throw new Error(`Sweep list could not be loaded (${loaded.reason}): ${loaded.detail}`);
    }
    list = loaded.list;
  }

  if (options.responsePath === undefined && config.model.apiKey.trim() === "") {
    throw new Error("RONDA_MODEL_API_KEY or local operator config modelApiKey is required");
  }

  const runs = options.runs ?? 1;
  const records: BenchmarkRunRecord[] = [];
  for (let runIndex = 0; runIndex < runs; runIndex += 1) {
    records.push(await runOneCampaignRun(context, deps, list, runIndex));
  }

  // The array is written even when a run failed, so a partial campaign still
  // reports every attempted run; the failure is reported by exit code alone.
  const serialized = JSON.stringify(runs > 1 ? records : records[0], null, 2);
  if (options.outputFilePath !== undefined) {
    writeFileSync(options.outputFilePath, `${serialized}\n`);
  } else {
    console.log(serialized);
  }

  // A single run keeps the recall gate. In a campaign the per-run recall and
  // false-positive counts are the measurement, so only a failure record (a run
  // that could not complete) makes the campaign exit non-zero.
  const only = records[0];
  if (only !== undefined && isFailureRecord(only) === false && runs === 1) {
    return recallGate(only);
  }
  return records.some(isFailureRecord) ? 1 : 0;
}

function isFailureRecord(record: BenchmarkRunRecord): record is BenchmarkRunFailure {
  return "failure" in record;
}

function recallGate(summary: RecallBenchmarkSummary): number {
  return summary.foundSeededDefects.length >= 6 &&
    summary.missedSeededDefects.includes("sensitive-value-exposure") === false &&
    summary.falsePositives.length === 0
    ? 0
    : 1;
}

/**
 * Thin entrypoint: parse the flags and hand the whole campaign to the runner.
 * The runner owns per-run timeouts and failure records, so nothing here needs
 * to build an `AbortController`.
 */
export async function main(argv = process.argv.slice(2)): Promise<number> {
  return runBenchmarkCampaign(parseArgs(argv));
}

function parsedResponseFindings(responsePath: string, changedFiles: ChangedFile[]): Finding[] {
  return parseModelResponse(readFileSync(responsePath, "utf8"), changedFiles).findings;
}

if (process.argv[1] && process.argv[1].endsWith("recall-benchmark.ts")) {
  main().then((code) => {
    process.exitCode = code;
  });
}
