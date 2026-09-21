import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeMissRecords } from "../../../src/cli/summarize-review-comparisons.js";
import { buildResolvabilityChecker } from "../../../src/quality/miss-github-evidence.js";
import type { CapturedMissRecord } from "../../../src/quality/review-quality-report.js";
import { summarizeComparisonRecords } from "../../../src/quality/review-quality-report.js";
import type { ReviewComparisonRecord } from "../../../src/cli/recall-benchmark.js";

const HEAD_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function miss(
  overrides: Partial<CapturedMissRecord> & Pick<CapturedMissRecord, "id" | "verdict">,
): CapturedMissRecord {
  return {
    repository: "lhpaul/ronda",
    pullNumber: 53,
    reviewedHeadSha: HEAD_A,
    rondaResultHeadSha: HEAD_A,
    staleEvidence: false,
    externalReviewer: "codex",
    affectedCategory: "correctness",
    intendedFollowUp: "undecided",
    ...overrides,
  };
}

test("miss rollup maps verdicts and preserves independent stale/unresolvable counts (AC6–AC8, AC48)", () => {
  const records: CapturedMissRecord[] = [
    miss({ id: "tp", verdict: "true_positive", affectedCategory: "timeouts" }),
    miss({ id: "fp", verdict: "false_positive", affectedCategory: "security" }),
    miss({ id: "oos", verdict: "out_of_scope", affectedCategory: "other" }),
    miss({ id: "dup", verdict: "already_found", affectedCategory: "other" }),
    miss({ id: "ua", verdict: "unadjudicated", affectedCategory: "other" }),
    miss({
      id: "stale",
      verdict: "true_positive",
      reviewedHeadSha: HEAD_B,
      rondaResultHeadSha: HEAD_A,
      staleEvidence: true,
      affectedCategory: "retries",
    }),
    miss({
      id: "unresolvable",
      verdict: "true_positive",
      affectedCategory: "retries",
    }),
    miss({
      id: "both",
      verdict: "true_positive",
      reviewedHeadSha: HEAD_B,
      rondaResultHeadSha: HEAD_A,
      staleEvidence: true,
      affectedCategory: "retries",
    }),
  ];

  const rollup = summarizeMissRecords(records, {
    isResolvable: (record) =>
      record.id !== "unresolvable" && record.id !== "both",
  });

  assert.equal(rollup.confirmedMisses, 1);
  assert.equal(rollup.reviewerNoise, 1);
  assert.equal(rollup.outOfScope, 1);
  assert.equal(rollup.duplicates, 1);
  assert.equal(rollup.unadjudicated, 1);
  assert.equal(rollup.staleEvidence, 2); // stale + both
  assert.equal(rollup.unresolvableEvidence, 2); // unresolvable + both
  assert.equal(rollup.verdictOutcomeCounts.ronda_miss, 1);
  assert.equal(rollup.categoryBreakdown.timeouts, 1);
});

test("abbreviated vs full SHA same-head miss is not counted stale", () => {
  const rollup = summarizeMissRecords([
    miss({
      id: "abbrev",
      verdict: "true_positive",
      reviewedHeadSha: HEAD_A.slice(0, 12),
      rondaResultHeadSha: HEAD_A,
      staleEvidence: false,
    }),
  ]);
  assert.equal(rollup.staleEvidence, 0);
  assert.equal(rollup.confirmedMisses, 1);
});

test("clean agreement comparison counts are unchanged by miss records (AC7)", () => {
  const comparisons: ReviewComparisonRecord[] = [
    {
      id: "clean",
      repository: "lhpaul/ronda",
      pullNumber: 30,
      headSha: HEAD_A,
      ronda: { result: "clean", reviewedHeadSha: HEAD_A, findings: [] },
      otherReviewer: {
        name: "Bugbot",
        result: "clean",
        reviewedHeadSha: HEAD_A,
        findings: [],
      },
      adjudications: [{ outcome: "clean_agreement" }],
    },
  ];
  const before = summarizeComparisonRecords(comparisons);
  assert.equal(before.adjudicationCounts.clean_agreement, 1);

  // Miss rollup is a separate addition; comparison rollup is untouched.
  const missRollup = summarizeMissRecords([
    miss({ id: "tp", verdict: "true_positive" }),
  ]);
  const after = summarizeComparisonRecords(comparisons);
  assert.deepEqual(after.adjudicationCounts, before.adjudicationCounts);
  assert.equal(missRollup.confirmedMisses, 1);
  assert.equal(after.adjudicationCounts.clean_agreement, 1);
});

test("AC48 summary-time fresh resolvability excludes unresolvable from verdicts", () => {
  const evidenceByPull = new Map([
    ["lhpaul/ronda#53", { rondaResultHeadShas: [HEAD_A] }],
  ]);
  const rollup = summarizeMissRecords(
    [
      miss({ id: "ok", verdict: "true_positive", rondaResultHeadSha: HEAD_A }),
      miss({
        id: "gone",
        verdict: "true_positive",
        rondaResultHeadSha: HEAD_B,
      }),
    ],
    { isResolvable: buildResolvabilityChecker(evidenceByPull) },
  );
  assert.equal(rollup.confirmedMisses, 1);
  assert.equal(rollup.unresolvableEvidence, 1);
  assert.equal(rollup.verdictOutcomeCounts.ronda_miss, 1);
});
