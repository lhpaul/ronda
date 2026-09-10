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

export interface RunRecallBenchmarkInput {
  manifest: RecallBenchmarkManifest;
  changedFiles: ChangedFile[];
  model: ModelClient;
  maxPatchChars: number;
  reviewedTarget: string;
  timestamp: string;
  signal?: AbortSignal;
}

interface CliOptions {
  manifestPath: string;
  patchesPath: string;
  responsePath?: string;
  maxPatchChars?: number;
  reviewedTarget?: string;
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
    .map((finding) => ({
      path: finding.path,
      line: finding.line,
      severity: finding.severity,
      title: finding.title,
    }));

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
    console.log(JSON.stringify(summary, null, 2));
    return summary.foundSeededDefects.length >= 6 &&
      summary.missedSeededDefects.includes("sensitive-value-exposure") === false &&
      summary.falsePositives.length === 0
      ? 0
      : 1;
  } finally {
    clearTimeout(timeout);
  }
}

if (process.argv[1] && process.argv[1].endsWith("recall-benchmark.ts")) {
  main().then((code) => {
    process.exitCode = code;
  });
}
