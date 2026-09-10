import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildQualityBenchmarkSummary,
  classifyPrecisionFixture,
  classifyFindings,
  runRecallBenchmark,
  runPrecisionFixture,
  summarizeReviewComparison,
  type RecallBenchmarkManifest,
  type ReviewComparisonRecord,
} from "../../../src/cli/recall-benchmark.js";
import type { ChangedFile } from "../../../src/domain/review-pass.types.js";
import type { ModelClient, ModelRequest } from "../../../src/inference/model-client.js";

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../fixtures/recall-benchmark/${name}`, import.meta.url));
}

function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(fixturePath(name), "utf8")) as T;
}

function createFixtureModel(name: string): ModelClient {
  return {
    modelName: `fixture:${name}`,
    async complete() {
      return readFileSync(fixturePath(`model-responses/${name}.json`), "utf8");
    },
  };
}

const manifest = readJson<RecallBenchmarkManifest>("manifest.json");
const changedFiles = readJson<ChangedFile[]>("patches.json");

test("recall benchmark classifies found, missed, and false-positive findings", async () => {
  const summary = await runRecallBenchmark({
    manifest,
    changedFiles,
    model: createFixtureModel("passing"),
    maxPatchChars: 400_000,
    reviewedTarget: "fixture-head",
    timestamp: "2026-09-10T00:00:00.000Z",
  });

  assert.equal(summary.totalSeededDefects, 13);
  assert.deepEqual(summary.foundSeededDefects, [
    "expired-session-inversion",
    "sensitive-value-exposure",
    "cache-capacity-off-by-one",
    "sql-interpolation",
    "lexicographic-numeric-sort",
    "lower-element-median",
    "empty-word-title-casing",
    "authorization-bypass",
    "data-loss-overwrite",
    "async-race-duplicate-processing",
    "configuration-debug-default",
    "stale-sha-review-publication",
  ]);
  assert.deepEqual(summary.missedSeededDefects, ["invalid-range-parsing"]);
  assert.deepEqual(summary.falsePositives, []);
  assert.equal(summary.model, "fixture:passing");
  assert.equal(summary.reviewedTarget, "fixture-head");
});

test("sensitive-value exposure is found after parser redacts a repeated value", async () => {
  const summary = await runRecallBenchmark({
    manifest,
    changedFiles,
    model: createFixtureModel("sensitive-leak"),
    maxPatchChars: 400_000,
    reviewedTarget: "fixture-head",
    timestamp: "2026-09-10T00:00:00.000Z",
  });

  assert.ok(summary.foundSeededDefects.includes("sensitive-value-exposure"));
  assert.equal(summary.falsePositives.length, 0);
});

test("sensitive-value exposure is not found when classified findings still repeat the value", () => {
  const summary = classifyFindings({
    manifest,
    findings: [
      {
        path: "src/benchmark/auth.ts",
        line: 3,
        severity: "blocking",
        title: "Stop logging sk_live_seeded_secret_value",
        body: "This logs the sensitive token.",
      },
    ],
    model: "fixture",
    reviewedTarget: "fixture-head",
    timestamp: "2026-09-10T00:00:00.000Z",
  });

  assert.ok(summary.missedSeededDefects.includes("sensitive-value-exposure"));
  assert.equal(summary.falsePositives.length, 1);
});

test("unmatched findings are counted as false positives", async () => {
  const summary = await runRecallBenchmark({
    manifest,
    changedFiles,
    model: createFixtureModel("false-positive"),
    maxPatchChars: 400_000,
    reviewedTarget: "fixture-head",
    timestamp: "2026-09-10T00:00:00.000Z",
  });

  assert.deepEqual(summary.foundSeededDefects, ["expired-session-inversion"]);
  assert.deepEqual(summary.falsePositives, [
    {
      path: "src/benchmark/range.ts",
      line: 1,
      severity: "nit",
      title: "Rename parseRange",
    },
  ]);
});

test("classification records non-sensitive findings even when severity is lower than expected", () => {
  const summary = classifyFindings({
    manifest,
    findings: [
      {
        path: "src/benchmark/cache.ts",
        line: 4,
        severity: "important",
        title: "Fix cache capacity off-by-one",
        body: "This cache capacity check has an off-by-one error.",
      },
    ],
    model: "fixture",
    reviewedTarget: "fixture-head",
    timestamp: "2026-09-10T00:00:00.000Z",
  });

  assert.ok(summary.foundSeededDefects.includes("cache-capacity-off-by-one"));
  assert.equal(summary.falsePositives.length, 0);
});

test("classification credits job deduplication wording as the async-race seed", () => {
  const summary = classifyFindings({
    manifest,
    findings: [
      {
        path: "src/benchmark/jobs.ts",
        line: 5,
        severity: "important",
        title: "Race condition in job deduplication",
        body: "Concurrent handlers can process the same job more than once.",
      },
    ],
    model: "fixture",
    reviewedTarget: "quality-same-head-smoke",
    timestamp: "2026-09-10T00:00:00.000Z",
  });

  assert.ok(summary.foundSeededDefects.includes("async-race-duplicate-processing"));
  assert.equal(summary.falsePositives.length, 0);
});

test("quality summary reports categories, missed categories, and same-head variance", async () => {
  const baseline = await runRecallBenchmark({
    manifest,
    changedFiles,
    model: createFixtureModel("passing"),
    maxPatchChars: 400_000,
    reviewedTarget: "same-head-run-1",
    timestamp: "2026-09-10T00:00:00.000Z",
  });
  const current = await runRecallBenchmark({
    manifest,
    changedFiles,
    model: createFixtureModel("failing"),
    maxPatchChars: 400_000,
    reviewedTarget: "same-head-run-2",
    timestamp: "2026-09-10T00:05:00.000Z",
  });

  const summary = buildQualityBenchmarkSummary({
    recall: { ...current, model: baseline.model },
    manifest,
    previousSummary: baseline,
  });

  assert.deepEqual(summary.qualityCategories, [
    "security",
    "authorization",
    "data-loss",
    "async/race",
    "configuration",
    "stale-SHA",
    "sorting",
    "text-normalization",
    "multi-finding",
  ]);
  assert.ok(summary.missedCategories.includes("sensitive-value exposure"));
  assert.equal(summary.sameHeadVariance?.sameModel, true);
  assert.equal(summary.sameHeadVariance?.foundChanged, true);
  assert.equal(summary.sameHeadVariance?.missedChanged, true);
});

test("precision fixture reports clean and noisy outcomes", () => {
  const fixture = manifest.precisionFixtures?.[0];
  assert.ok(fixture);

  const clean = classifyPrecisionFixture({ fixture, findings: [] });
  const noisy = classifyPrecisionFixture({
    fixture,
    findings: [
      {
        path: "src/benchmark/session.ts",
        line: 1,
        severity: "nit",
        title: "Rename harmless helper",
        body: "The helper name could be shorter.",
      },
    ],
  });

  assert.equal(clean.clean, true);
  assert.equal(clean.falsePositiveCount, 0);
  assert.equal(noisy.clean, false);
  assert.deepEqual(noisy.falsePositives, [
    {
      path: "src/benchmark/session.ts",
      line: 1,
      severity: "nit",
      title: "Rename harmless helper",
    },
  ]);
});

test("precision fixture runs clean patches through the model path", async () => {
  const fixture = manifest.precisionFixtures?.[0];
  assert.ok(fixture);
  const prompts: ModelRequest[] = [];
  const model: ModelClient = {
    modelName: "fixture:precision-clean",
    async complete(prompt) {
      prompts.push(prompt);
      return readFileSync(fixturePath("model-responses/precision-clean.json"), "utf8");
    },
  };

  const summary = await runPrecisionFixture({
    fixture,
    model,
    maxPatchChars: 400_000,
  });

  assert.equal(summary.clean, true);
  assert.equal(summary.falsePositiveCount, 0);
  assert.equal(prompts.length, 1);
  assert.match(prompts[0]?.userPrompt ?? "", /normalizeSessionName/);
  assert.doesNotMatch(prompts[0]?.userPrompt ?? "", /\(undefined\)/);
});

test("precision fixture summaries redact forbidden values from false positives", () => {
  const fixture = manifest.precisionFixtures?.[0];
  assert.ok(fixture);

  const summary = classifyPrecisionFixture({
    fixture,
    findings: [
      {
        path: "src/benchmark/auth.ts",
        line: 3,
        severity: "blocking",
        title: "Remove sk_live_seeded_secret_value from logs",
        body: "The body is not included in evidence.",
      },
    ],
  });

  assert.equal(summary.falsePositives[0]?.title, "Remove [redacted] from logs");
});

test("review comparison records clean agreement and false-clean candidates", () => {
  const cleanAgreement = readJson<ReviewComparisonRecord[]>(
    "comparisons/clean-agreement.json",
  )[0];
  const falseClean = readJson<ReviewComparisonRecord[]>("comparisons/false-clean.json")[0];

  const cleanSummary = summarizeReviewComparison(cleanAgreement);
  const falseCleanSummary = summarizeReviewComparison(falseClean);

  assert.equal(cleanSummary.sameHead, true);
  assert.equal(cleanSummary.falseCleanCandidate, false);
  assert.equal(cleanSummary.adjudicationCounts.clean_agreement, 1);
  assert.equal(falseCleanSummary.sameHead, true);
  assert.equal(falseCleanSummary.rondaFindingCount, 0);
  assert.equal(falseCleanSummary.otherReviewerFindingCount, 1);
  assert.equal(falseCleanSummary.adjudicationCounts.ronda_miss, 1);
  assert.equal(falseCleanSummary.falseCleanCandidate, true);
});

test("review comparison counts every adjudication outcome", () => {
  const record = readJson<ReviewComparisonRecord[]>("comparisons/all-outcomes.json")[0];
  const summary = summarizeReviewComparison(record);

  assert.equal(summary.sameHead, true);
  assert.deepEqual(summary.adjudicationCounts, {
    ronda_miss: 1,
    ronda_better: 1,
    duplicate: 1,
    clean_agreement: 1,
    unclear: 1,
  });
});

test("review comparison refuses false-clean classification when heads differ", () => {
  const record = readJson<ReviewComparisonRecord[]>("comparisons/false-clean.json")[0];
  const summary = summarizeReviewComparison({
    ...record,
    otherReviewer: {
      ...record.otherReviewer,
      reviewedHeadSha: "cccccccccccccccccccccccccccccccccccccccc",
    },
  });

  assert.equal(summary.sameHead, false);
  assert.equal(summary.falseCleanCandidate, false);
});
