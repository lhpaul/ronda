import { readFileSync } from "node:fs";
import { createOpenAiCompatibleClient } from "../inference/openai-compatible-client.js";
import { parseModelResponse } from "../inference/parse-model-response.js";
import { buildReviewPrompt } from "../inference/review-prompt.js";
import { loadConfig } from "../config/load-config.js";
import type { ChangedFile, Finding } from "../domain/review-pass.types.js";
import type { Severity } from "../domain/severity.js";
import type { ModelClient } from "../inference/model-client.js";

export interface RecallBenchmarkDefect {
  id: string;
  category: string;
  expectedSeverity: Severity;
  path: string;
  description: string;
  matchTerms: string[];
  matchTermGroups?: string[][];
  forbiddenValue?: string;
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
}

export interface RunPrecisionFixtureInput {
  fixture: PrecisionFixture;
  model: ModelClient;
  maxPatchChars: number;
  signal?: AbortSignal;
}

interface CliOptions {
  manifestPath: string;
  patchesPath: string;
  responsePath?: string;
  maxPatchChars?: number;
  reviewedTarget?: string;
  quality?: boolean;
  precisionResponsePath?: string;
  comparisonPath?: string;
  previousSummaryPath?: string;
}

const DEFAULT_MANIFEST_PATH = "tests/fixtures/recall-benchmark/manifest.json";
const DEFAULT_PATCHES_PATH = "tests/fixtures/recall-benchmark/patches.json";

export async function runRecallBenchmark(
  input: RunRecallBenchmarkInput,
): Promise<RecallBenchmarkSummary> {
  const prompt = buildReviewPrompt({
    title: `Recall benchmark: ${input.manifest.benchmarkId}`,
    body: "Seeded benchmark fixture for measuring review recall.",
    changedFiles: input.changedFiles,
    maxPatchChars: input.maxPatchChars,
  });
  const raw = await input.model.complete(prompt, input.signal ?? new AbortController().signal);
  const parsed = parseModelResponse(raw, input.changedFiles);
  return classifyFindings({
    manifest: input.manifest,
    findings: parsed.findings,
    model: input.model.modelName,
    reviewedTarget: input.reviewedTarget,
    timestamp: input.timestamp,
  });
}

export async function runPrecisionFixture(
  input: RunPrecisionFixtureInput,
): Promise<PrecisionFixtureSummary> {
  const prompt = buildReviewPrompt({
    title: `Precision benchmark: ${input.fixture.id}`,
    body: input.fixture.description,
    changedFiles: input.fixture.changedFiles,
    maxPatchChars: input.maxPatchChars,
  });
  const raw = await input.model.complete(prompt, input.signal ?? new AbortController().signal);
  const parsed = parseModelResponse(raw, input.fixture.changedFiles);
  return classifyPrecisionFixture({
    fixture: input.fixture,
    findings: parsed.findings,
  });
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
      record.otherReviewer.findings.length > 0 &&
      (adjudicationCounts.ronda_miss > 0 ||
        adjudicationCounts.unclear > 0),
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
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function createFixtureModel(responsePath: string): ModelClient {
  return {
    modelName: `fixture:${responsePath}`,
    async complete() {
      return readFileSync(responsePath, "utf8");
    },
  };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  const manifest = readJsonFile<RecallBenchmarkManifest>(options.manifestPath);
  const changedFiles = readJsonFile<ChangedFile[]>(options.patchesPath);
  const config = loadConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.passTimeoutMs);
  timeout.unref?.();

  try {
    const model = options.responsePath
      ? createFixtureModel(options.responsePath)
      : createOpenAiCompatibleClient({
          apiKey: config.model.apiKey,
          baseUrl: config.model.baseUrl,
          modelName: config.model.modelName,
        });

    if (!options.responsePath && config.model.apiKey.trim() === "") {
      throw new Error("RONDA_MODEL_API_KEY or local operator config modelApiKey is required");
    }

    const summary = await runRecallBenchmark({
      manifest,
      changedFiles,
      model,
      maxPatchChars: options.maxPatchChars ?? config.maxPatchChars,
      reviewedTarget: options.reviewedTarget ?? manifest.benchmarkId,
      timestamp: new Date().toISOString(),
      signal: controller.signal,
    });
    const precisionFixtures =
      options.quality && manifest.precisionFixtures
        ? await Promise.all(
            manifest.precisionFixtures.map((fixture) =>
              options.precisionResponsePath
                ? classifyPrecisionFixture({
                    fixture,
                    findings: parsedResponseFindings(
                      options.precisionResponsePath as string,
                      fixture.changedFiles,
                    ),
                  })
                : runPrecisionFixture({
                    fixture,
                    model,
                    maxPatchChars: options.maxPatchChars ?? config.maxPatchChars,
                    signal: controller.signal,
                  }),
            ),
          )
        : [];

    const output = options.quality
      ? buildQualityBenchmarkSummary({
          recall: summary,
          manifest,
          precisionFixtures,
          comparisons: options.comparisonPath
            ? readJsonFile<ReviewComparisonRecord[]>(options.comparisonPath).map(
                summarizeReviewComparison,
              )
            : [],
          previousSummary: options.previousSummaryPath
            ? readJsonFile<RecallBenchmarkSummary>(options.previousSummaryPath)
            : undefined,
        })
      : summary;
    console.log(JSON.stringify(output, null, 2));
    return summary.foundSeededDefects.length >= 6 &&
      summary.missedSeededDefects.includes("sensitive-value-exposure") === false &&
      summary.falsePositives.length === 0
      ? 0
      : 1;
  } finally {
    clearTimeout(timeout);
  }
}

function parsedResponseFindings(responsePath: string, changedFiles: ChangedFile[]): Finding[] {
  return parseModelResponse(readFileSync(responsePath, "utf8"), changedFiles).findings;
}

if (process.argv[1] && process.argv[1].endsWith("recall-benchmark.ts")) {
  main().then((code) => {
    process.exitCode = code;
  });
}
