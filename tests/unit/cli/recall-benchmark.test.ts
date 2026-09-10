import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  classifyFindings,
  runRecallBenchmark,
  type RecallBenchmarkManifest,
} from "../../../src/cli/recall-benchmark.js";
import type { ChangedFile } from "../../../src/domain/review-pass.types.js";
import type { ModelClient } from "../../../src/inference/model-client.js";

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

  assert.equal(summary.totalSeededDefects, 8);
  assert.deepEqual(summary.foundSeededDefects, [
    "expired-session-inversion",
    "sensitive-value-exposure",
    "cache-capacity-off-by-one",
    "sql-interpolation",
    "lexicographic-numeric-sort",
    "lower-element-median",
    "empty-word-title-casing",
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
