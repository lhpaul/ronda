#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewPrompt } from "../inference/review-prompt.js";
import { parseModelResponse } from "../inference/parse-model-response.js";
import { createOpenAiCompatibleClient } from "../inference/openai-compatible-client.js";
import { loadConfig } from "../config/load-config.js";
import type { ChangedFile, Finding } from "../domain/review-pass.types.js";
import type { ModelClient } from "../inference/model-client.js";
import {
  resolveDurabilityMode,
  type DurabilityModeResolution,
} from "../review/durability-mode.js";

export interface DurabilityShapeFixture {
  shape: string;
  expectedKeywords: string[];
  severity: string;
  changedFiles: ChangedFile[];
}

export interface DurabilityManifest {
  benchmarkId: string;
  shapes: Array<{
    id: string;
    expectedKeywords: string[];
    severity: string;
    fixture: string;
  }>;
}

export interface DurabilityShapeResult {
  id: string;
  found: number;
  missed: number;
  noise: number;
  matchedKeywords: string[];
}

export interface DurabilityRegressionSummary {
  benchmarkId: string;
  shapes: DurabilityShapeResult[];
  allFound: boolean;
}

const MODE_PATH =
  "docs/workflow/development-workflow/durability-idempotency-review-mode.md";

function fixtureRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../../tests/fixtures/durability-regression");
}

export function loadDurabilityManifest(root = fixtureRoot()): DurabilityManifest {
  return JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as DurabilityManifest;
}

export function loadDurabilityFixture(
  fixtureName: string,
  root = fixtureRoot(),
): DurabilityShapeFixture {
  return JSON.parse(
    readFileSync(join(root, fixtureName), "utf8"),
  ) as DurabilityShapeFixture;
}

export function forcedActiveDurabilityMode(
  modeText: string,
  changedPaths: string[],
): DurabilityModeResolution {
  return resolveDurabilityMode({
    headBranch: "feature/durability-regression",
    changedPaths,
    durabilityMode: "on",
    modeDocumentText: modeText,
  });
}

export function classifyDurabilityFindings(input: {
  shapeId: string;
  expectedKeywords: string[];
  expectedSeverity?: string;
  targetPaths?: string[];
  findings: Finding[];
}): DurabilityShapeResult {
  const expected = input.expectedKeywords.map((keyword) => keyword.toLowerCase());
  const expectedSeverity = input.expectedSeverity?.toLowerCase();
  const targetPaths = new Set(input.targetPaths ?? []);
  let matchedKeywords: string[] = [];
  let found = 0;

  for (const finding of input.findings) {
    if (targetPaths.size > 0 && !targetPaths.has(finding.path)) {
      continue;
    }
    const text = `${finding.title} ${finding.body}`.toLowerCase();
    const matched = expected.filter((keyword) => text.includes(keyword));
    const severityMatches =
      !expectedSeverity || finding.severity.toLowerCase() === expectedSeverity;
    if (
      expected.length > 0 &&
      matched.length === expected.length &&
      severityMatches
    ) {
      found = 1;
      matchedKeywords = input.expectedKeywords.slice();
      break;
    }
    if (matched.length > matchedKeywords.length) {
      matchedKeywords = input.expectedKeywords.filter((keyword) =>
        text.includes(keyword.toLowerCase()),
      );
    }
  }

  return {
    id: input.shapeId,
    found,
    missed: found === 1 ? 0 : 1,
    noise: Math.max(0, input.findings.length - found),
    matchedKeywords,
  };
}

export async function runDurabilityRegression(options: {
  model?: ModelClient;
  modeText?: string;
  fakeResponses?: Record<string, string>;
  root?: string;
  passTimeoutMs?: number;
  signal?: AbortSignal;
}): Promise<DurabilityRegressionSummary> {
  const root = options.root ?? fixtureRoot();
  const manifest = loadDurabilityManifest(root);
  const modeText =
    options.modeText ?? readFileSync(join(process.cwd(), MODE_PATH), "utf8");

  const shapes: DurabilityShapeResult[] = [];
  for (const entry of manifest.shapes) {
    const fixture = loadDurabilityFixture(entry.fixture, root);
    const changedPaths = fixture.changedFiles.map((file) => file.path);
    const durabilityMode = forcedActiveDurabilityMode(modeText, changedPaths);
    const prompt = buildReviewPrompt({
      title: `Durability regression: ${entry.id}`,
      body: "Forced-active durability mode regression fixture.",
      changedFiles: fixture.changedFiles,
      maxPatchChars: 400_000,
      durabilityMode,
    });

    let raw: string;
    if (options.fakeResponses?.[entry.id]) {
      raw = options.fakeResponses[entry.id];
    } else if (options.model) {
      let signal = options.signal;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let ownedController: AbortController | undefined;
      if (!signal) {
        ownedController = new AbortController();
        signal = ownedController.signal;
        const timeoutMs = options.passTimeoutMs;
        if (timeoutMs !== undefined && timeoutMs > 0) {
          timeout = setTimeout(() => ownedController!.abort(), timeoutMs);
          timeout.unref?.();
        }
      }
      try {
        raw = await options.model.complete(prompt, signal);
      } finally {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
      }
    } else {
      throw new Error("runDurabilityRegression requires model or fakeResponses");
    }

    const parsed = parseModelResponse(raw, fixture.changedFiles);
    shapes.push(
      classifyDurabilityFindings({
        shapeId: entry.id,
        expectedKeywords: entry.expectedKeywords,
        expectedSeverity: entry.severity,
        targetPaths: changedPaths,
        findings: parsed.findings,
      }),
    );
  }

  return {
    benchmarkId: manifest.benchmarkId,
    shapes,
    allFound: shapes.every((shape) => shape.found >= 1),
  };
}

async function main(): Promise<void> {
  const config = loadConfig();
  const model = createOpenAiCompatibleClient({
    apiKey: config.model.apiKey,
    baseUrl: config.model.baseUrl,
    modelName: config.model.modelName,
  });
  const summary = await runDurabilityRegression({
    model,
    passTimeoutMs: config.passTimeoutMs,
  });
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.allFound) {
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
