import { mock, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildQualityBenchmarkSummary,
  classifyPrecisionFixture,
  classifyFindings,
  main,
  runBenchmarkCampaign,
  runRecallBenchmark,
  runPrecisionFixture,
  summarizeReviewComparison,
  type BenchmarkCampaignDeps,
  type BenchmarkRunFailure,
  type CliOptions,
  type HarderCredentialWay,
  type RecallBenchmarkManifest,
  type RecallBenchmarkSummary,
  type ReviewComparisonRecord,
} from "../../../src/cli/recall-benchmark.js";
import { loadSweepList } from "../../../src/review/sweep-categories.js";
import type { RondaConfig } from "../../../src/config/config.types.js";
import type { ChangedFile } from "../../../src/domain/review-pass.types.js";
import { ModelClientError, type ModelClient, type ModelRequest } from "../../../src/inference/model-client.js";

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
      return { content: readFileSync(fixturePath(`model-responses/${name}.json`), "utf8") };
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

  assert.equal(summary.totalSeededDefects, 18);
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
    "api-evidence-state-reconstruction",
    "external-output-parsing-lossy",
    "guard-fails-open",
    "record-identity-drift",
    "credential-pattern-gap-camel",
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
        body: "The deduplication guard is not atomic.",
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
      return {
        content: readFileSync(fixturePath("model-responses/precision-clean.json"), "utf8"),
      };
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

test("review comparison treats unclear same-head external findings as false-clean candidates", () => {
  const cleanAgreement = readJson<ReviewComparisonRecord[]>(
    "comparisons/clean-agreement.json",
  )[0];
  const unclearExternalFinding: ReviewComparisonRecord = {
    ...cleanAgreement,
    id: "unclear-external-finding",
    pullNumber: 41,
    otherReviewer: {
      ...cleanAgreement.otherReviewer,
      result: "findings",
      findings: [
        {
          path: "src/example.ts",
          line: 14,
          severity: "important",
          title: "External reviewer found a possible defect",
          body: "The sample still needs human adjudication.",
        },
      ],
    },
    adjudications: [{ outcome: "unclear" }],
  };

  const summary = summarizeReviewComparison(unclearExternalFinding);

  assert.equal(summary.sameHead, true);
  assert.equal(summary.rondaFindingCount, 0);
  assert.equal(summary.otherReviewerFindingCount, 1);
  assert.equal(summary.adjudicationCounts.unclear, 1);
  assert.equal(summary.falseCleanCandidate, true);
});

test("review comparison preserves confirmed false-clean candidates without finding payloads", () => {
  const falseClean = readJson<ReviewComparisonRecord[]>("comparisons/false-clean.json")[0];
  const confirmedMissWithoutPayload: ReviewComparisonRecord = {
    ...falseClean,
    otherReviewer: {
      ...falseClean.otherReviewer,
      findings: [],
    },
  };

  const summary = summarizeReviewComparison(confirmedMissWithoutPayload);

  assert.equal(summary.sameHead, true);
  assert.equal(summary.otherReviewerFindingCount, 0);
  assert.equal(summary.adjudicationCounts.ronda_miss, 1);
  assert.equal(summary.falseCleanCandidate, true);
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

// ---------------------------------------------------------------------------
// Scenario 6c — the campaign driver: per-run records, identity blocks, and the
// recorded-not-thrown failure path
// ---------------------------------------------------------------------------

function testConfig(overrides: Partial<RondaConfig> = {}): RondaConfig {
  return {
    model: {
      apiKey: "campaign-fixture-key",
      baseUrl: "http://localhost:0",
      // Deliberately equal to the fixture double's `modelName` so a success
      // record and the failure record of the same run agree on every
      // configuration field but `requests`.
      modelName: "fixture:passing",
    },
    passTimeoutMs: 5_000,
    maxPatchChars: 400_000,
    maxAuthoritativeDocCount: 3,
    maxAuthoritativeDocChars: 12_000,
    durabilityMode: "default",
    durabilityModeDefault: false,
    sweepMode: "off",
    sweepModeRaw: undefined,
    ...overrides,
  };
}

function campaignDeps(overrides: Partial<BenchmarkCampaignDeps> = {}): BenchmarkCampaignDeps {
  return {
    loadConfig: () => testConfig(),
    createModel: () => createFixtureModel("passing"),
    loadSweepList: (options) => loadSweepList(options),
    ...overrides,
  };
}

/**
 * A double that answers the request it was actually sent: the recall prompt with
 * `passing`, every precision prompt with `precision-noisy`. The default
 * `createFixtureModel("passing")` answers both with the same body, which is fine
 * for a run's own record but hides whether a per-request record was built from
 * that request's own response.
 */
function createPerRequestModel(): ModelClient {
  return {
    modelName: "fixture:per-request",
    async complete(prompt) {
      const name = prompt.userPrompt.includes("Recall benchmark")
        ? "passing"
        : "precision-noisy";
      return { content: readFileSync(fixturePath(`model-responses/${name}.json`), "utf8") };
    },
  };
}

function outputPath(label: string): string {
  return join(mkdtempSync(join(tmpdir(), `ronda-bench-${label}-`)), "summary.json");
}

function withoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([entry]) => entry !== key));
}

function isFailure(record: Record<string, unknown>): boolean {
  return "failure" in record;
}

async function runCampaign(
  label: string,
  options: Partial<CliOptions>,
  deps: BenchmarkCampaignDeps,
): Promise<{ exitCode: number; records: Array<Record<string, unknown>> }> {
  const path = outputPath(label);
  const exitCode = await runBenchmarkCampaign(
    {
      manifestPath: fixturePath("manifest.json"),
      patchesPath: fixturePath("patches.json"),
      outputFilePath: path,
      ...options,
    },
    deps,
  );
  const parsed = JSON.parse(readFileSync(path, "utf8")) as
    | Record<string, unknown>
    | Array<Record<string, unknown>>;
  return { exitCode, records: Array.isArray(parsed) ? parsed : [parsed] };
}

test("campaign records the per-category pass on a sweep-on run and neither field on a sweep-off run", async () => {
  const on = await runCampaign("sweep-on", { sweepMode: "on" }, campaignDeps());
  const off = await runCampaign("sweep-off", { sweepMode: "off" }, campaignDeps());

  const onRecord = on.records[0];
  const offRecord = off.records[0];

  const loaded = loadSweepList();
  assert.ok(loaded.ok);
  assert.equal(onRecord.sweepListVersion, loaded.list.version);

  const pass = onRecord.sweepPassRecord as {
    listVersion: string;
    categories: Array<{ identifier: string; outcome: string }>;
    findings: Array<{ publicationIndex: number; categories: string[] }>;
    uncategorizedFindingCount: number;
  };
  assert.equal(pass.listVersion, loaded.list.version);
  assert.equal(pass.categories.length, loaded.list.categories.length);
  assert.deepEqual(
    pass.categories.map((entry) => entry.identifier),
    loaded.list.categories.map((entry) => entry.identifier),
  );
  assert.equal(
    pass.categories.find((entry) => entry.identifier === "external-output-parsing")?.outcome,
    "produced_none",
  );
  assert.equal(
    pass.categories.filter((entry) => entry.outcome === "produced_findings").length,
    4,
  );
  assert.equal(pass.uncategorizedFindingCount, 13);

  // The attribution mapping, asserted against the fixture findings themselves:
  // three of the five AC13 seeds are among the extended fixture's findings.
  const attributed = new Map(pass.findings.map((entry) => [entry.publicationIndex, entry.categories]));
  assert.deepEqual(attributed.get(12), ["pr-head-push-order"]);
  assert.deepEqual(attributed.get(14), ["guard-fails-open"]);
  assert.deepEqual(attributed.get(15), ["record-identity"]);
  assert.deepEqual(attributed.get(16), ["credential-pattern-gap"]);
  assert.equal(pass.findings.length, 17);

  // Absence is asserted, not merely unset: AC1 assigns the record to an
  // enabled sweep and AC18 requires a disabled run to have none.
  assert.equal("sweepPassRecord" in offRecord, false);
  assert.equal("sweepListVersion" in offRecord, false);

  // AC11 compares the two arms, so both carry the cost fields.
  for (const record of [onRecord, offRecord]) {
    assert.equal(record.modelCallCount, 1);
    assert.equal(typeof record.elapsedMs, "number");
  }
});

test("campaign arms record equal fixture blocks and configuration blocks differing only in sweepMode", async () => {
  const on = await runCampaign("identity-on", { sweepMode: "on" }, campaignDeps());
  const off = await runCampaign("identity-off", { sweepMode: "off" }, campaignDeps());

  const onRecord = on.records[0];
  const offRecord = off.records[0];

  assert.deepEqual(onRecord.fixture, offRecord.fixture);

  const onConfiguration = onRecord.configuration as Record<string, unknown>;
  const offConfiguration = offRecord.configuration as Record<string, unknown>;
  assert.equal(onConfiguration.sweepMode, "on");
  assert.equal(offConfiguration.sweepMode, "off");

  assert.deepEqual(withoutKey(onConfiguration, "sweepMode"), withoutKey(offConfiguration, "sweepMode"));
});

test("campaign records each request's reported identity, never the configured alias in its place", async () => {
  const reporting = campaignDeps({
    loadConfig: () => testConfig({ model: { ...testConfig().model, modelName: "configured-alias" } }),
    createModel: () => ({
      modelName: "provider-echo-v9",
      async complete() {
        return {
          content: readFileSync(fixturePath("model-responses/passing.json"), "utf8"),
          reportedModel: "provider-echo-v9",
        };
      },
    }),
  });

  const reported = await runCampaign("reported", { sweepMode: "on" }, reporting);
  const reportedConfiguration = reported.records[0].configuration as {
    modelName: string;
    requests: Array<{ kind: string; reportedModel?: string }>;
  };
  assert.equal(reportedConfiguration.requests.length, 1);
  assert.equal(reportedConfiguration.requests[0].kind, "recall");
  assert.equal(reportedConfiguration.requests[0].reportedModel, "provider-echo-v9");
  assert.equal(reportedConfiguration.modelName, "provider-echo-v9");

  // The fixture double reports nothing, so the request is recorded unattested
  // rather than having the configured alias written in the reported slot.
  const silent = await runCampaign("silent", { sweepMode: "on" }, campaignDeps({
    loadConfig: () => testConfig({ model: { ...testConfig().model, modelName: "configured-alias" } }),
  }));
  const silentConfiguration = silent.records[0].configuration as {
    modelName: string;
    requests: Array<Record<string, unknown>>;
  };
  assert.equal("reportedModel" in silentConfiguration.requests[0], false);
  assert.equal(silentConfiguration.modelName, "fixture:passing");
  assert.notEqual(silentConfiguration.modelName, "configured-alias");
});

test("campaign original-thirteen snapshot differs by path and hash while sharing the benchmark id, and is absent when a seed is missing", async () => {
  const extended = await runCampaign("extended", { sweepMode: "on" }, campaignDeps());
  const snapshot = await runCampaign(
    "snapshot",
    {
      sweepMode: "on",
      manifestPath: fixturePath("original-thirteen/manifest.json"),
      patchesPath: fixturePath("original-thirteen/patches.json"),
    },
    campaignDeps(),
  );

  const extendedSubset = extended.records[0].originalThirteenSubset as {
    ids: string[];
    foundSeededDefects: string[];
    missedSeededDefects: string[];
  };
  assert.equal(extendedSubset.ids.length, 13);
  assert.deepEqual(
    [...extendedSubset.foundSeededDefects, ...extendedSubset.missedSeededDefects].sort(),
    [...extendedSubset.ids].sort(),
  );

  const extendedFixture = extended.records[0].fixture as Record<string, unknown>;
  const snapshotFixture = snapshot.records[0].fixture as Record<string, unknown>;
  assert.equal(snapshotFixture.benchmarkId, extendedFixture.benchmarkId);
  assert.notEqual(snapshotFixture.manifestPath, extendedFixture.manifestPath);
  assert.notEqual(snapshotFixture.manifestSha256, extendedFixture.manifestSha256);
  assert.equal(snapshotFixture.seedCount, 13);

  // A manifest that does not hold every one of the thirteen reports no subset
  // rather than a mislabeled one.
  const directory = mkdtempSync(join(tmpdir(), "ronda-bench-partial-"));
  const partialPath = join(directory, "manifest.json");
  writeFileSync(
    partialPath,
    JSON.stringify({
      ...manifest,
      seededDefects: manifest.seededDefects.filter((defect) => defect.id !== "stale-sha-review-publication"),
    }),
  );
  const partial = await runCampaign(
    "partial",
    { sweepMode: "on", manifestPath: partialPath },
    campaignDeps(),
  );
  assert.equal("originalThirteenSubset" in partial.records[0], false);
});

test("a count argument must be a whole positive integer, not a parsed prefix", async () => {
  for (const flag of ["--runs", "--max-patch-chars"]) {
    for (const bad of ["5x", "5.9", "0", "-1", " 5", "1e3"]) {
      await assert.rejects(
        () => main([flag, bad]),
        new RegExp(`${flag} must be a positive integer`),
        `${flag} ${JSON.stringify(bad)} must be rejected`,
      );
    }
  }
});

test("campaign --runs 2 writes two per-run records, each carrying both identity blocks", async () => {
  const { exitCode, records } = await runCampaign(
    "runs-two",
    { sweepMode: "on", runs: 2 },
    campaignDeps(),
  );

  assert.equal(exitCode, 0);
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.equal("fixture" in record, true);
    assert.equal("configuration" in record, true);
    assert.equal("failure" in record, false);
  }
});

test("the recall gate judges a single run but not the runs of a campaign", async () => {
  const lowRecall = campaignDeps({
    createModel: () => ({
      modelName: "fixture:empty",
      async complete() {
        return { content: JSON.stringify({ findings: [] }) };
      },
    }),
  });

  const single = await runCampaign("gate-single", { sweepMode: "off", runs: 1 }, lowRecall);
  const campaign = await runCampaign("gate-campaign", { sweepMode: "off", runs: 2 }, lowRecall);

  // One run keeps the existing gate: nothing found is a failing result.
  assert.equal(single.exitCode, 1);
  // In a campaign per-run recall is the measurement, so a run that fails the
  // gate is recorded, not turned into a non-zero exit that would abort the
  // runbook's chain of campaign legs; only a failure record exits non-zero.
  assert.equal(campaign.exitCode, 0);
  assert.equal(campaign.records.length, 2);
  assert.deepEqual(campaign.records.map(isFailure), [false, false]);
});

test("a rejected precision request cancels its siblings and the run waits for them", async () => {
  const manifest = JSON.parse(readFileSync(fixturePath("manifest.json"), "utf8")) as {
    precisionFixtures: Array<Record<string, unknown>>;
  };
  manifest.precisionFixtures = [
    manifest.precisionFixtures[0],
    { ...manifest.precisionFixtures[0], id: "second-precision-fixture" },
  ];
  const manifestPath = outputPath("two-precision-manifest");
  writeFileSync(manifestPath, JSON.stringify(manifest));

  let siblingSawAbort = false;
  let siblingSettled = false;
  let precisionCalls = 0;
  const deps = campaignDeps({
    createModel: () => ({
      modelName: "fixture:sibling-cancel",
      async complete(request, signal) {
        if (request.userPrompt.includes("Recall benchmark")) {
          return { content: readFileSync(fixturePath("model-responses/passing.json"), "utf8") };
        }
        precisionCalls += 1;
        if (precisionCalls === 1) {
          throw new Error("first precision request rejected");
        }
        // The sibling stays in flight until the run cancels it, then takes a
        // moment to wind down, so a run that does not wait for it is visible.
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              siblingSawAbort = true;
              resolve();
            },
            { once: true },
          );
        });
        await new Promise((resolve) => setTimeout(resolve, 30));
        siblingSettled = true;
        return { content: JSON.stringify({ findings: [] }) };
      },
    }),
  });

  const { exitCode, records } = await runCampaign(
    "sibling-cancel",
    { sweepMode: "off", quality: true, manifestPath },
    deps,
  );

  assert.equal(exitCode, 1);
  assert.equal(records.length, 1);
  assert.equal(isFailure(records[0]), true);
  // The sibling was cancelled and had settled before the run returned, so it
  // cannot outlive the run's deadline or overlap the next run.
  assert.equal(siblingSawAbort, true);
  assert.equal(siblingSettled, true);
  // The run cancelled its own sibling; that is not a `passTimeoutMs` timeout.
  assert.equal((records[0].failure as { aborted: boolean }).aborted, false);
});

test("campaign gives each run its own pass deadline", async () => {
  const signals: AbortSignal[] = [];
  const abortedAtEntry: boolean[] = [];

  const { exitCode, records } = await runCampaign(
    "deadlines",
    { sweepMode: "off", runs: 2 },
    campaignDeps({
      loadConfig: () => testConfig({ passTimeoutMs: 50 }),
      createModel: ({ runIndex }) => ({
        modelName: "fixture:passing",
        async complete(_request, signal) {
          signals[runIndex] = signal;
          abortedAtEntry[runIndex] = signal.aborted;
          // The first run outlives its deadline and ignores the abort; a
          // shared timer would leave the second run already aborted here.
          if (runIndex === 0) {
            await new Promise((resolve) => setTimeout(resolve, 120));
          }
          return { content: readFileSync(fixturePath("model-responses/passing.json"), "utf8") };
        },
      }),
    }),
  );

  // The first run outlived its deadline while ignoring the abort, so it is a
  // timeout failure record; the second run, with its own deadline, is unaffected.
  assert.equal(exitCode, 1);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map(isFailure), [true, false]);
  assert.equal((records[0].failure as { reason: string }).reason, "timeout");
  assert.notEqual(signals[0], signals[1]);
  assert.deepEqual(abortedAtEntry, [false, false]);
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
});

for (const stage of ["model-creation", "recall", "precision"] as const) {
  test(`a run that resumes from ${stage} after its deadline starts nothing further and logs nothing`, async () => {
    let recallRequests = 0;
    let precisionRequests = 0;
    const lines: string[] = [];
    const spy = mock.method(console, "error", (...args: unknown[]) => {
      lines.push(args.map((value) => String(value)).join(" "));
    });
    const late = () => new Promise((resolve) => setTimeout(resolve, 150));
    let records: Array<Record<string, unknown>>;
    try {
      ({ records } = await runCampaign(
        `resumes-late-${stage}`,
        { sweepMode: "on", quality: true },
        campaignDeps({
          loadConfig: () => testConfig({ passTimeoutMs: 50 }),
          createModel: async () => {
            if (stage === "model-creation") {
              await late();
            }
            return {
              modelName: "fixture:resumes-late",
              async complete(request) {
                if (request.userPrompt.includes("Recall benchmark")) {
                  recallRequests += 1;
                  if (stage === "recall") {
                    await late();
                  }
                  return {
                    content: readFileSync(fixturePath("model-responses/passing.json"), "utf8"),
                  };
                }
                precisionRequests += 1;
                if (stage === "precision") {
                  await late();
                }
                return { content: JSON.stringify({ findings: [] }) };
              },
            };
          },
        }),
      ));
      // Give the orphaned run time to resume and, if unguarded, carry on.
      await new Promise((resolve) => setTimeout(resolve, 250));
    } finally {
      spy.mock.restore();
    }

    assert.equal(isFailure(records[0]), true);
    // A stage that resumes after the deadline goes no further: the request the
    // late stage was about to make is never issued, and no record is logged.
    const expectedRequests = {
      "model-creation": [0, 0],
      recall: [1, 0],
      precision: [1, 1],
    }[stage];
    assert.deepEqual(
      [recallRequests, precisionRequests],
      expectedRequests,
      "the timed-out run must not issue requests after its failure record",
    );
    assert.equal(lines.length, 0, "the timed-out run must not log after its failure record");
  });
}

test("a client that never settles cannot hold a run past its deadline", async () => {
  // The campaign's bounds are timers, so they must keep the process alive: an
  // unref'd deadline or grace timer lets a hung client exit the CLI mid-campaign.
  const timers: Array<{ delay: number; timer: NodeJS.Timeout }> = [];
  const realSetTimeout = globalThis.setTimeout;
  const spy = mock.method(globalThis, "setTimeout", ((
    handler: () => void,
    delay?: number,
  ): NodeJS.Timeout => {
    const timer = realSetTimeout(handler, delay);
    timers.push({ delay: delay ?? 0, timer });
    return timer;
  }) as unknown as typeof setTimeout);
  let exitCode: number;
  let records: Array<Record<string, unknown>>;
  try {
    ({ exitCode, records } = await runCampaign(
      "never-settles",
      { sweepMode: "off", runs: 2 },
      campaignDeps({
        deadlineDrainMs: 100,
        loadConfig: () => testConfig({ passTimeoutMs: 50 }),
        createModel: ({ runIndex }) => ({
          modelName: "fixture:never-settles",
          async complete() {
            if (runIndex === 0) {
              // Ignores the abort and never answers.
              return new Promise<never>(() => undefined);
            }
            return { content: readFileSync(fixturePath("model-responses/passing.json"), "utf8") };
          },
        }),
      }),
    ));
  } finally {
    spy.mock.restore();
  }

  // The hung run becomes a timeout record at its deadline and the campaign
  // moves on, instead of waiting on the client forever.
  assert.equal(exitCode, 1);
  assert.deepEqual(records.map(isFailure), [true, false]);
  assert.equal((records[0].failure as { reason: string; aborted: boolean }).reason, "timeout");
  assert.equal((records[0].failure as { aborted: boolean }).aborted, true);
  // It was still in flight after the grace period, and the record says so.
  assert.equal(
    (records[0].failure as { unsettledAfterDeadline?: boolean }).unsettledAfterDeadline,
    true,
  );
  // The run deadline (50 ms) and the grace period (100 ms) are the campaign's own
  // clock; neither may be unref'd.
  const bounds = timers.filter(({ delay }) => delay === 50 || delay === 100);
  assert.ok(bounds.length >= 3, "the deadline and grace timers must have been created");
  for (const { delay, timer } of bounds) {
    assert.equal(timer.hasRef(), true, `the ${delay} ms timer must keep the process alive`);
  }
});

test("the next run waits for a timed-out request that settles within the grace period", async () => {
  let firstSettledAt = 0;
  let secondStartedAt = 0;
  const { records } = await runCampaign(
    "drains-then-advances",
    { sweepMode: "off", runs: 2 },
    campaignDeps({
      loadConfig: () => testConfig({ passTimeoutMs: 50 }),
      createModel: ({ runIndex }) => ({
        modelName: "fixture:drains",
        async complete() {
          if (runIndex === 0) {
            // Ignores the abort but does answer, 80 ms after the deadline.
            await new Promise((resolve) => setTimeout(resolve, 130));
            firstSettledAt = Date.now();
            return { content: readFileSync(fixturePath("model-responses/passing.json"), "utf8") };
          }
          secondStartedAt = Date.now();
          return { content: readFileSync(fixturePath("model-responses/passing.json"), "utf8") };
        },
      }),
    }),
  );

  assert.deepEqual(records.map(isFailure), [true, false]);
  // The second run began only after the first run's request had settled.
  assert.ok(firstSettledAt > 0 && secondStartedAt >= firstSettledAt);
  // It settled within the grace period, so the record carries no unsettled flag.
  assert.equal("unsettledAfterDeadline" in (records[0].failure as object), false);
});

test("campaign records a mid-campaign failure instead of throwing and leaves the other runs undisturbed", async () => {
  const throwing = campaignDeps({
    createModel: ({ runIndex }) => ({
      modelName: "fixture:passing",
      async complete() {
        if (runIndex === 1) {
          throw new Error(`model exploded on sk_live_seeded_secret_value`);
        }
        return { content: readFileSync(fixturePath("model-responses/passing.json"), "utf8") };
      },
    }),
  });

  const failing = await runCampaign("mid-failure", { sweepMode: "on", runs: 3 }, throwing);
  const allGood = await runCampaign("all-good", { sweepMode: "on", runs: 3 }, campaignDeps());

  assert.equal(failing.exitCode, 1);
  assert.equal(failing.records.length, 3);
  assert.deepEqual(failing.records.map(isFailure), [false, true, false]);

  const failure = failing.records[1] as unknown as BenchmarkRunFailure;
  assert.equal(failure.runIndex, 1);
  assert.deepEqual(failure.fixture, failing.records[0].fixture);
  assert.equal(failure.failure.reason, "unknown");
  // The thrown message passes through the runner's existing redaction, so the
  // fixture's forbidden value never reaches the written record.
  assert.equal(failure.failure.message, "model exploded on [redacted]");
  assert.equal(failure.failure.aborted, false);

  for (const absent of [
    "foundSeededDefects",
    "missedSeededDefects",
    "falsePositives",
    "totalSeededDefects",
    "sweepListVersion",
    "sweepPassRecord",
    "originalThirteenSubset",
    "modelCallCount",
    "elapsedMs",
  ]) {
    assert.equal(absent in failing.records[1], false, `${absent} must be absent from a failure record`);
  }

  // The failure record carries the identity base, not the per-request layer.
  assert.deepEqual(
    failure.configuration,
    withoutKey(failing.records[0].configuration as Record<string, unknown>, "requests"),
  );

  // Wall-clock fields are the only difference between the survivors and the
  // same runs of an uninterrupted campaign.
  const normalize = (record: RecallBenchmarkSummary): Record<string, unknown> => ({
    ...record,
    timestamp: "",
    elapsedMs: 0,
  });
  for (const index of [0, 2]) {
    assert.deepEqual(
      normalize(failing.records[index] as unknown as RecallBenchmarkSummary),
      normalize(allGood.records[index] as unknown as RecallBenchmarkSummary),
    );
  }
});

test("campaign maps a timed-out model error to the timeout stage and exposes the deadline abort", async () => {
  const timedOut = await runCampaign(
    "timed-out",
    { sweepMode: "off" },
    campaignDeps({
      createModel: () => ({
        modelName: "fixture:passing",
        async complete() {
          throw new ModelClientError("timed_out", "the endpoint did not answer in time");
        },
      }),
    }),
  );

  const timedOutFailure = timedOut.records[0] as unknown as BenchmarkRunFailure;
  assert.equal(timedOut.exitCode, 1);
  assert.equal(timedOutFailure.failure.reason, "timeout");
  assert.equal(timedOutFailure.failure.aborted, false);

  // The pass deadline itself aborts, and the record says so.
  const aborted = await runCampaign(
    "aborted",
    { sweepMode: "off" },
    campaignDeps({
      loadConfig: () => testConfig({ passTimeoutMs: 50 }),
      createModel: () => ({
        modelName: "fixture:passing",
        async complete() {
          await new Promise((resolve) => setTimeout(resolve, 120));
          throw new Error("late failure");
        },
      }),
    }),
  );

  const abortedFailure = aborted.records[0] as unknown as BenchmarkRunFailure;
  assert.equal(aborted.exitCode, 1);
  assert.equal(abortedFailure.failure.aborted, true);
  assert.equal(abortedFailure.failure.reason, "timeout");
});

test("campaign publishes the per-category record on stderr as well as in the JSON", async () => {
  const lines: string[] = [];
  const spy = mock.method(console, "error", (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  });

  let onRecord: Record<string, unknown>;
  let offRecord: Record<string, unknown>;
  try {
    onRecord = (await runCampaign("stderr-on", { sweepMode: "on" }, campaignDeps())).records[0];
    offRecord = (await runCampaign("stderr-off", { sweepMode: "off" }, campaignDeps())).records[0];
  } finally {
    spy.mock.restore();
  }

  const published = lines.filter((line) => line.includes('"event":"sweep_pass_record"'));
  assert.equal(published.length, 1);

  const emitted = JSON.parse(published[0]) as {
    event: string;
    runIndex: number;
    listVersion: string;
    categories: Array<{ identifier: string; outcome: string }>;
    findings: Array<{ publicationIndex: number; categories: string[] }>;
    uncategorizedFindingCount: number;
  };
  const summaryRecord = onRecord.sweepPassRecord as typeof emitted;

  assert.equal(emitted.event, "sweep_pass_record");
  assert.equal(emitted.runIndex, 0);
  assert.deepEqual(emitted.categories, summaryRecord.categories);
  assert.deepEqual(emitted.findings, summaryRecord.findings);
  assert.equal(emitted.uncategorizedFindingCount, summaryRecord.uncategorizedFindingCount);

  // The line stays free of review content: identifiers and indices only.
  assert.deepEqual(Object.keys(emitted).sort(), [
    "categories",
    "event",
    "findings",
    "listVersion",
    "runIndex",
    "uncategorizedFindingCount",
  ]);

  // A sweep-off run publishes nothing, so the assertion above is the sweep-on
  // arm's alone.
  assert.equal("sweepPassRecord" in offRecord, false);
});

test("campaign attributes each precision finding under AC9 independently of the recall pass", async () => {
  const lines: string[] = [];
  const spy = mock.method(console, "error", (...args: unknown[]) => {
    lines.push(args.map((value) => String(value)).join(" "));
  });

  // One endpoint, two requests, two different responses. `campaignDeps`'s default
  // double answers every request with `passing`, which would hand the precision
  // request the recall pass's own seventeen findings; the campaign's per-request
  // records only mean something once the double answers the request it was sent.
  const perRequestDeps = campaignDeps({ createModel: () => createPerRequestModel() });

  let onRecord: Record<string, unknown>;
  let offRecord: Record<string, unknown>;
  try {
    onRecord = (await runCampaign("quality-on", { sweepMode: "on", quality: true }, perRequestDeps))
      .records[0];
    offRecord = (await runCampaign("quality-off", { sweepMode: "off", quality: true }, perRequestDeps))
      .records[0];
  } finally {
    spy.mock.restore();
  }

  const fixtures = onRecord.precisionFixtures as Array<Record<string, unknown>>;
  assert.equal(fixtures.length, 1);

  const precisionRecord = fixtures[0].sweepPassRecord as {
    listVersion: string;
    categories: Array<{ identifier: string; outcome: string }>;
    findings: Array<{ publicationIndex: number; categories: string[] }>;
    uncategorizedFindingCount: number;
  };
  const recalled = onRecord.sweepPassRecord as typeof precisionRecord;

  assert.ok(precisionRecord);
  assert.equal(precisionRecord.listVersion, recalled.listVersion);

  // The fixture double's sole finding on the precision fixture's own path carries
  // none of the list's terms, so the precision request records it uncategorized
  // and every category produced none — the recall pass's own outcomes are
  // different, which is what makes this record the precision request's alone.
  assert.equal(precisionRecord.uncategorizedFindingCount, 1);
  assert.deepEqual(
    precisionRecord.findings,
    [{ publicationIndex: 0, categories: [] }],
  );
  assert.deepEqual(
    precisionRecord.categories.map((category) => category.outcome),
    recalled.categories.map(() => "produced_none"),
  );
  assert.notDeepEqual(precisionRecord.categories, recalled.categories);

  // A sweep-off run ran no list, so it publishes no per-fixture record at all —
  // its precision findings are reported as unattributed by that absence.
  const offFixtures = offRecord.precisionFixtures as Array<Record<string, unknown>>;
  assert.equal("sweepPassRecord" in offFixtures[0], false);
  assert.equal("sweepPassRecord" in offRecord, false);

  // Both the recall and the precision request carry their own prompt identity, and
  // the two differ: each composed its own prompt, so one changing alone still moves
  // the record it belongs to.
  const onRequests = (onRecord.configuration as {
    requests: Array<{ kind: string; promptFingerprint?: string }>;
  }).requests;
  assert.equal(onRequests.length, 2);
  assert.ok(onRequests[0].promptFingerprint);
  assert.ok(onRequests[1].promptFingerprint);
  assert.notEqual(onRequests[0].promptFingerprint, onRequests[1].promptFingerprint);

  // Per request and arm-independent: the sweep section is stripped from the
  // fingerprint, so the two arms record the same value for the same request.
  const offRequests = (offRecord.configuration as {
    requests: Array<{ kind: string; promptFingerprint?: string }>;
  }).requests;
  assert.deepEqual(
    onRequests.map((request) => request.promptFingerprint),
    offRequests.map((request) => request.promptFingerprint),
  );

  // The precision request logs its own record on the same surface as the recall
  // pass's, under exactly the same key set — one schema, not two.
  const published = lines.filter((line) => line.includes('"event":"sweep_pass_record"'));
  assert.equal(published.length, 2);
  const keySets = published.map((line) => Object.keys(JSON.parse(line) as object).sort());
  assert.deepEqual(keySets[0], [
    "categories",
    "event",
    "findings",
    "listVersion",
    "runIndex",
    "uncategorizedFindingCount",
  ]);
  assert.deepEqual(keySets[1], keySets[0]);
});

// ---------------------------------------------------------------------------
// Scenario 7 — AC12/AC13 seeds and AC14's real-credential scan
// ---------------------------------------------------------------------------

const AC12_SEED_IDS = [
  "api-evidence-state-reconstruction",
  "external-output-parsing-lossy",
  "guard-fails-open",
  "record-identity-drift",
] as const;

const FOUR_HARDER_WAYS: readonly HarderCredentialWay[] = [
  "qualifier-or-prefix-added-to-name",
  "different-letter-case-convention",
  "different-word-separator",
  "name-or-value-wrapped-in-another-construct",
];

/** The canary's body, assembled at runtime so the test source commits no credential-shaped literal. */
const CANARY_BODY = "canary000000000000000000000000000000";

/**
 * AC14's non-authenticating allowlist: exact placeholder strings, literal and
 * source-controlled in this test. Exemption is never read from the scanned file,
 * so a seed cannot exempt itself by declaring its value inert.
 */
const NON_AUTHENTICATING_PLACEHOLDERS: readonly string[] = [
  `sk-${CANARY_BODY}`,
  "<the recorded basis>",
  "<token>",
  "sk_live_seeded_secret_value",
];

/**
 * The credential-shaped fixtures the P-series assertions scan are assembled
 * from these fragments at runtime, so no committed line carries a value any
 * credential shape matches. Each fragment is inert alone: every shape needs
 * its prefix and its body adjacent inside one token.
 */
const SK_PREFIX = "sk" + "-";
const SK_PREFIX_UPPER = "SK" + "-";
const GHP_PREFIX = "ghp" + "_";
const BEARER = "Bear" + "er";
const BEARER_LOWER = "bear" + "er";
const BEARER_UPPER = "BEAR" + "ER";
const TOKEN_BODY = "abcdefghijkl";
const OTHER_TOKEN_BODY = "mnopqrstuvwx";
const LOWER_TOKEN_BODY = "abcdefghijklmn";
const UPPER_TOKEN_BODY = "ABCDEFGHIJKLMN";

interface CredentialFinding {
  file: string;
  line: number;
  column: number;
  shape: string;
  text: string;
}

interface CredentialShape {
  shape: string;
  source: string;
  flags: string;
  valueOf: (match: RegExpExecArray) => string;
}

/** Every credential shape AC14 names, each with its own extracted value. */
const CREDENTIAL_SHAPES: readonly CredentialShape[] = [
  { shape: "sk-token", source: "(?<![A-Za-z0-9])sk-[A-Za-z0-9_-]{8,}", flags: "i", valueOf: (m) => m[0] },
  { shape: "ghp-token", source: "(?<![A-Za-z0-9])ghp_[A-Za-z0-9]{8,}", flags: "", valueOf: (m) => m[0] },
  { shape: "ghs-token", source: "(?<![A-Za-z0-9])ghs_[A-Za-z0-9]{8,}", flags: "", valueOf: (m) => m[0] },
  {
    shape: "jwt",
    source: "(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]*\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+",
    flags: "",
    valueOf: (m) => m[0],
  },
  {
    shape: "bearer-authorization",
    source: "(?<![A-Za-z0-9])Bearer\\s+[A-Za-z0-9._~+/=-]{8,}",
    flags: "i",
    valueOf: (m) => m[0].replace(/^Bearer\s+/i, ""),
  },
  {
    shape: "key-named-field",
    // The bare (unquoted) branch demands a credential-shaped value so a type
    // annotation such as `token: string` is not mistaken for a key-named field.
    source:
      "(?<![A-Za-z0-9_-])(?:authorization|token|password|secret|api[_-]?key)\\s*[:=]\\s*(\"[^\"]*\"|'[^']*'|[A-Za-z0-9._\\-/+]{8,})",
    flags: "i",
    valueOf: (m) => (m[1] ?? "").replace(/^["']|["']$/g, ""),
  },
];

/**
 * The scan: classify each line of each file against every credential shape and
 * report file, line, and column for each match the allowlist does not exempt.
 */
function scanForCredentials(
  files: readonly { path: string; text: string }[],
  allowlist: readonly string[],
): CredentialFinding[] {
  const findings: CredentialFinding[] = [];
  for (const file of files) {
    const lines = file.text.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const line = (lines[index] ?? "").replace(/\r$/, "");
      for (const shape of CREDENTIAL_SHAPES) {
        const pattern = new RegExp(shape.source, `${shape.flags}g`);
        let match: RegExpExecArray | null = pattern.exec(line);
        while (match !== null) {
          const value = shape.valueOf(match);
          if (!isExemptValue(value, allowlist)) {
            findings.push({
              file: file.path,
              line: index + 1,
              column: match.index + 1,
              shape: shape.shape,
              text: value,
            });
          }
          if (pattern.lastIndex === match.index) {
            pattern.lastIndex += 1;
          }
          match = pattern.exec(line);
        }
      }
    }
  }
  return findings;
}

function isExemptValue(value: string, allowlist: readonly string[]): boolean {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "null" || trimmed === "undefined") {
    return true;
  }
  if (/^<.*>$/.test(trimmed)) {
    return true;
  }
  return allowlist.includes(trimmed);
}

function scanText(
  text: string,
  allowlist: readonly string[] = NON_AUTHENTICATING_PLACEHOLDERS,
): CredentialFinding[] {
  return scanForCredentials([{ path: "synthetic.txt", text }], allowlist);
}

function fixtureRoot(): string {
  return fileURLToPath(new URL("../../fixtures/recall-benchmark/", import.meta.url));
}

function collectTreeFiles(root: string, relative = ""): Array<{ path: string; text: string }> {
  const files: Array<{ path: string; text: string }> = [];
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...collectTreeFiles(root, next));
    } else {
      files.push({ path: next, text: readFileSync(join(root, next), "utf8") });
    }
  }
  return files;
}

test("the seeded benchmark carries a case for every AC12 kind, backed by a changed file", () => {
  const paths = new Set(changedFiles.map((file) => file.path));
  for (const id of AC12_SEED_IDS) {
    const defect = manifest.seededDefects.find((candidate) => candidate.id === id);
    assert.ok(defect, `missing AC12 seed ${id}`);
    assert.ok(paths.has(defect.path), `${id} path ${defect.path} must exist in patches.json`);
  }
});

test("the harder credential seed records its AC13 ways and canonical baseline", () => {
  const harder = manifest.seededDefects.filter((defect) => defect.harderThan);
  assert.ok(harder.length >= 1, "AC13 requires at least one harder credential case");

  for (const defect of harder) {
    const metadata = defect.harderThan;
    assert.ok(metadata);
    assert.ok(metadata.differsBy.length >= 1, `${defect.id} must differ from the baseline somehow`);
    for (const way of metadata.differsBy) {
      assert.ok(FOUR_HARDER_WAYS.includes(way), `${way} is not one of AC13's four ways`);
    }

    const baseline = manifest.seededDefects.find(
      (candidate) => candidate.id === metadata.baselineId,
    );
    assert.ok(baseline, `baseline ${metadata.baselineId} must be a seed in the manifest`);
    assert.equal(baseline.forbiddenValue, metadata.canonicalValue);
    assert.equal(typeof metadata.canonicalName, "string");
    assert.ok(metadata.canonicalName.length > 0);
  }
});

test("the harder credential seed's patch holds a guard that knows the canonical name and misses the variant", () => {
  for (const defect of manifest.seededDefects.filter((candidate) => candidate.harderThan)) {
    const metadata = defect.harderThan;
    assert.ok(metadata);
    const file = changedFiles.find((candidate) => candidate.path === defect.path);
    assert.ok(file, `${defect.id} needs a changed file at ${defect.path}`);
    const added = (file.patch ?? "")
      .split("\n")
      .filter((line) => line.startsWith("+"))
      .map((line) => line.slice(1))
      .join("\n");

    const guard = /const CANONICAL_CREDENTIAL_NAME = \/(.+)\/;/.exec(added);
    assert.ok(guard, `${defect.id}'s patch must define the canonical-name guard the defect is about`);
    const pattern = new RegExp(guard[1]);
    assert.equal(
      pattern.test(metadata.canonicalName),
      true,
      `the guard must recognize the canonical name ${metadata.canonicalName}`,
    );

    const passed = /redactCredentials\(\{ (\w+) \}\)/.exec(added);
    assert.ok(passed, `${defect.id}'s patch must pass a credential-named value to the guard`);
    assert.notEqual(passed[1], metadata.canonicalName);
    assert.equal(
      pattern.test(passed[1]),
      false,
      `the guard must miss the variant ${passed[1]}, or the seeded defect is not in the patch`,
    );
  }
});

function evidenceRoot(): string {
  return fileURLToPath(new URL("../../../docs/testing/ronda/", import.meta.url));
}

test("committed benchmark fixtures carry no real credential values", () => {
  const findings = scanForCredentials(
    collectTreeFiles(fixtureRoot()),
    NON_AUTHENTICATING_PLACEHOLDERS,
  );

  assert.deepEqual(
    findings,
    [],
    "real-credential-shaped values must not appear in the committed benchmark tree",
  );
});

/** The artifacts the category-forced sweep committed for AC14's evidence scan. */
const SWEEP_EVIDENCE_ARTIFACTS: readonly string[] = [
  "sweep-categories.json",
  "sweep-effect-evidence.md",
  "sweep-real-pr-evidence.md",
  "sweep-off-extended.json",
  "sweep-off-original-thirteen.json",
  "sweep-off-precision.json",
  "sweep-on-extended.json",
  "sweep-on-original-thirteen.json",
  "sweep-on-precision.json",
];

test("committed sweep evidence artifacts carry no real credential values", () => {
  // The artifacts did not exist when the fixture-tree scan above was written, so
  // AC14's coverage of the evidence tree is verified here, at the same standard:
  // the scan's own shapes and allowlist, unreduced. A campaign recorded with a
  // live model credential would land here if that value were ever pasted into an
  // evidence document or a campaign record.
  //
  // Named one by one rather than by walking `docs/testing/ronda/`: that directory
  // also holds older operator prose corpora (for example the PR-98 external
  // finding corpus) whose English happens to trip the key-named-field and
  // bearer-authorization heuristics. Those files predate this feature and are not
  // what AC14 covers; widening the scan to them would either fail on prose or
  // force an exemption that weakens the scan for the artifacts that matter.
  const files = SWEEP_EVIDENCE_ARTIFACTS.map((name) => ({
    path: name,
    text: readFileSync(new URL(name, `file://${evidenceRoot()}`), "utf8"),
  }));
  const findings = scanForCredentials(files, NON_AUTHENTICATING_PLACEHOLDERS);

  assert.deepEqual(
    findings,
    [],
    "real-credential-shaped values must not appear in the committed sweep evidence artifacts",
  );
  assert.equal(
    files.length,
    SWEEP_EVIDENCE_ARTIFACTS.length,
    "every named evidence artifact must be read and scanned",
  );
});

test("the credential scan fails on a planted canary and passes once it is removed, per shape", () => {
  // The canary is exempt in production scans (P7), so the planted-violation
  // proof runs with the canary off the allowlist — it proves the shapes are
  // recognised, and P7 proves the allowlist is what spares the placeholders.
  const proofAllowlist = NON_AUTHENTICATING_PLACEHOLDERS.filter(
    (value) => value !== `sk-${CANARY_BODY}`,
  );
  const plantedLines: ReadonlyArray<{ shape: string; line: string }> = [
    { shape: "sk-token", line: `value = "sk-${CANARY_BODY}"` },
    { shape: "ghp-token", line: `value = "ghp_${CANARY_BODY}"` },
    { shape: "ghs-token", line: `value = "ghs_${CANARY_BODY}"` },
    {
      shape: "jwt",
      line: `value = "${["eyJ", CANARY_BODY, CANARY_BODY].join(".")}"`,
    },
    { shape: "bearer-authorization", line: `value = "Bearer ${CANARY_BODY}"` },
    { shape: "key-named-field", line: `secret: "${CANARY_BODY}"` },
  ];
  const header = "// planted violation proof\n";

  for (const { shape, line } of plantedLines) {
    const failing = scanForCredentials(
      [{ path: "planted.txt", text: `${header}${line}\n` }],
      proofAllowlist,
    );
    assert.ok(
      failing.some((finding) => finding.shape === shape),
      `the scan must report the ${shape} canary`,
    );
    assert.deepEqual(failing.map((finding) => [finding.file, finding.line]), [
      ["planted.txt", 2],
    ]);

    const passing = scanForCredentials(
      [{ path: "planted.txt", text: header }],
      proofAllowlist,
    );
    assert.deepEqual(passing, [], `the ${shape} canary removal must make the scan pass`);
  }
});

test("a seed cannot exempt a credential-shaped value by declaring it in the manifest", () => {
  // Not on the allowlist, so the only thing that could spare it is the
  // declaration embedded in the scanned text itself.
  const declared = `sk-${CANARY_BODY.slice(0, -1)}x`;
  const declaring = JSON.stringify({
    seededDefects: [{ id: "declared-inert", forbiddenValue: declared, note: `value ${declared} is inert` }],
  });

  const findings = scanForCredentials(
    [{ path: "manifest-like.json", text: declaring }],
    NON_AUTHENTICATING_PLACEHOLDERS,
  );

  assert.ok(findings.length >= 1, "a manifest declaration must not exempt a credential-shaped value");
  assert.ok(findings.every((finding) => finding.file === "manifest-like.json"));
  assert.ok(findings.every((finding) => finding.shape === "sk-token"));
});

test("P1: a bare sk- prefix with no token body is not a match", () => {
  assert.deepEqual(scanText(`value = ${SK_PREFIX}\n`), []);
});

test("P2: credential vocabulary is case-insensitive", () => {
  assert.equal(scanText(`value = "${SK_PREFIX_UPPER}${UPPER_TOKEN_BODY}"\n`).length, 1);
  assert.equal(scanText(`${BEARER} ${UPPER_TOKEN_BODY}\n`).length, 1);
  assert.equal(scanText(`${BEARER_LOWER} ${LOWER_TOKEN_BODY}\n`).length, 1);
  assert.equal(scanText(`${BEARER_UPPER} ${LOWER_TOKEN_BODY}\n`).length, 1);
});

test("P3: the prefix needs a left boundary; a trailing suffix stays in the match", () => {
  assert.deepEqual(scanText(`xx${SK_PREFIX}${TOKEN_BODY}\n`), []);
  const found = scanText(`value = ${SK_PREFIX}${TOKEN_BODY}suffix\n`);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.text, `${SK_PREFIX}${TOKEN_BODY}suffix`);
});

test("P4: padding and a trailing CR do not shift the reported line or column", () => {
  const found = scanText(`first\r\n\t  ${GHP_PREFIX}${TOKEN_BODY}  \r\nlast\n`);
  assert.equal(found.length, 1);
  assert.equal(found[0]?.line, 2);
  assert.equal(found[0]?.column, 4);
  assert.ok(!(found[0]?.text ?? "").includes("\r"));
});

test("P5: JSON, prose, and a code fence are read alike", () => {
  assert.equal(scanText(`{"key": "${GHP_PREFIX}${TOKEN_BODY}"}\n`).length, 1);
  assert.equal(scanText(`the credential ${GHP_PREFIX}${TOKEN_BODY} appeared here\n`).length, 1);
  assert.equal(scanText(`\`\`\`\n${GHP_PREFIX}${TOKEN_BODY}\n\`\`\`\n`).length, 1);
});

test("P6: common English substrings around sk- are not matches", () => {
  assert.deepEqual(scanText(`risk- and task- and ${SK_PREFIX} alone\n`), []);
});

test("P7: the fixed non-authenticating placeholders are not matches", () => {
  const text = `tokens: sk-${CANARY_BODY}, <the recorded basis>, <token>\n`;
  assert.deepEqual(scanText(text), []);
});

test("P8: key-named fields carrying placeholder or empty values are not matches", () => {
  assert.deepEqual(scanText('authorization: "<not set>"\ntoken: null\npassword: ""\n'), []);
});

test("P9: two credential values on one line are both reported", () => {
  const bearers = scanText(`${BEARER} ${TOKEN_BODY} and ${BEARER} ${OTHER_TOKEN_BODY}\n`);
  assert.equal(bearers.length, 2);
  assert.deepEqual(
    bearers.map((finding) => finding.line),
    [1, 1],
  );

  const mixed = scanText(`${GHP_PREFIX}${TOKEN_BODY} ${SK_PREFIX}${TOKEN_BODY}\n`);
  assert.equal(mixed.length, 2);
  assert.deepEqual(mixed.map((finding) => finding.shape).sort(), ["ghp-token", "sk-token"]);
});

test("P10: the same value on several lines is reported once per line", () => {
  const found = scanText(
    `${GHP_PREFIX}${TOKEN_BODY}\nplain\n${GHP_PREFIX}${TOKEN_BODY}\n`,
  );
  assert.equal(found.length, 2);
  assert.deepEqual(
    found.map((finding) => finding.line),
    [1, 3],
  );
});

test("P11: a Bearer-wrapped JWT reports both shapes", () => {
  const jwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiIxIn0", "signaturepart"].join(".");
  const found = scanText(`value = "Bearer ${jwt}"\n`);
  const shapes = found.map((finding) => finding.shape);

  assert.ok(shapes.includes("bearer-authorization"), "the Bearer wrapper is reported");
  assert.ok(shapes.includes("jwt"), "the inner JWT is not consumed by the outer pattern");
  assert.equal(found.length, 2);
});

test("P12: a broken token is not joined across lines or emphasis", () => {
  assert.deepEqual(scanText(`value = ${SK_PREFIX}\n${TOKEN_BODY}\n`), []);
  assert.deepEqual(scanText(`value = ${SK_PREFIX}**${TOKEN_BODY}**\n`), []);
});

test("P13: a key-named field with a long inert value still fails without an allowlisted value", () => {
  const found = scanText('secret: "placeholder-not-a-secret-value"\n');
  assert.equal(found.length, 1);
  assert.equal(found[0]?.shape, "key-named-field");
});

test("P14: the last line without a trailing newline reports the right line", () => {
  const found = scanText(
    `${GHP_PREFIX}${TOKEN_BODY}\nlast: value = "${SK_PREFIX}${TOKEN_BODY}"`,
  );
  assert.equal(found.length, 2);
  assert.deepEqual(
    found.map((finding) => finding.line),
    [1, 2],
  );
});
