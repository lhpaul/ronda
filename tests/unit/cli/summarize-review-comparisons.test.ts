import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  readComparisonRecords,
  resolveComparisonFiles,
  summarizeComparisonRecords,
} from "../../../src/cli/summarize-review-comparisons.js";
import type { ReviewComparisonRecord } from "../../../src/cli/recall-benchmark.js";

const baseRecord: ReviewComparisonRecord = {
  id: "clean",
  repository: "lhpaul/ronda",
  pullNumber: 30,
  headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ronda: {
    result: "clean",
    reviewedHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    findings: [],
  },
  otherReviewer: {
    name: "Cursor Bugbot",
    result: "clean",
    reviewedHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    findings: [],
  },
  adjudications: [
    {
      outcome: "clean_agreement",
      notes: "Both reviewers reported clean on the same head.",
    },
  ],
};

test("summarizes comparison records across quality outcomes", () => {
  const falseCleanCandidate: ReviewComparisonRecord = {
    ...baseRecord,
    id: "miss",
    pullNumber: 31,
    ronda: {
      result: "clean",
      reviewedHeadSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      findings: [],
    },
    otherReviewer: {
      name: "Cursor Bugbot",
      result: "findings",
      reviewedHeadSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      findings: [
        {
          path: "src/example.ts",
          line: 12,
          severity: "important",
          title: "Check missed issue",
          body: "Human accepted this external-only finding.",
        },
      ],
    },
    headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    adjudications: [{ outcome: "ronda_miss" }],
  };
  const staleUnclear: ReviewComparisonRecord = {
    ...baseRecord,
    id: "stale",
    pullNumber: 32,
    headSha: "cccccccccccccccccccccccccccccccccccccccc",
    otherReviewer: {
      ...baseRecord.otherReviewer,
      reviewedHeadSha: "dddddddddddddddddddddddddddddddddddddddd",
    },
    adjudications: [{ outcome: "unclear" }],
  };
  const unclearCandidate: ReviewComparisonRecord = {
    ...baseRecord,
    id: "unclear-candidate",
    pullNumber: 33,
    headSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
    ronda: {
      result: "clean",
      reviewedHeadSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      findings: [],
    },
    otherReviewer: {
      name: "PR-Agent",
      result: "findings",
      reviewedHeadSha: "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      findings: [
        {
          path: "src/summary.ts",
          line: 8,
          severity: "important",
          title: "Investigate external-only finding",
          body: "This has not been adjudicated yet.",
        },
      ],
    },
    adjudications: [{ outcome: "unclear" }],
  };

  const rollup = summarizeComparisonRecords([
    baseRecord,
    falseCleanCandidate,
    staleUnclear,
    unclearCandidate,
  ]);

  assert.equal(rollup.totalComparisons, 4);
  assert.equal(rollup.sameHeadComparisons, 3);
  assert.equal(rollup.staleHeadComparisons, 1);
  assert.equal(rollup.totalRondaFindings, 0);
  assert.equal(rollup.totalOtherReviewerFindings, 2);
  assert.equal(rollup.falseCleanCandidateCount, 2);
  assert.equal(rollup.adjudicationCounts.clean_agreement, 1);
  assert.equal(rollup.adjudicationCounts.ronda_miss, 1);
  assert.equal(rollup.adjudicationCounts.unclear, 2);
  assert.deepEqual(rollup.reviewers, { "Cursor Bugbot": 3, "PR-Agent": 1 });
  assert.deepEqual(rollup.unclearComparisons, [
    {
      id: "stale",
      repository: "lhpaul/ronda",
      pullNumber: 32,
      reviewer: "Cursor Bugbot",
    },
    {
      id: "unclear-candidate",
      repository: "lhpaul/ronda",
      pullNumber: 33,
      reviewer: "PR-Agent",
    },
  ]);
  assert.deepEqual(rollup.falseCleanCandidates, [
    {
      id: "miss",
      repository: "lhpaul/ronda",
      pullNumber: 31,
      reviewer: "Cursor Bugbot",
    },
    {
      id: "unclear-candidate",
      repository: "lhpaul/ronda",
      pullNumber: 33,
      reviewer: "PR-Agent",
    },
  ]);
});

test("resolves comparison files from a directory in stable order", () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-summary-"));
  mkdirSync(join(dir, "nested"));
  writeFileSync(join(dir, "b.json"), "[]\n");
  writeFileSync(join(dir, "a.json"), "[]\n");
  writeFileSync(join(dir, "notes.md"), "ignored\n");

  assert.deepEqual(resolveComparisonFiles({ files: [], directory: dir }), [
    join(dir, "a.json"),
    join(dir, "b.json"),
  ]);
});

test("explicit comparison files bypass directory discovery", () => {
  assert.deepEqual(
    resolveComparisonFiles({
      files: ["one.json", "two.json"],
      directory: "missing",
    }),
    ["one.json", "two.json"],
  );
});

test("reads and flattens comparison record arrays", () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-summary-read-"));
  const one = join(dir, "one.json");
  const two = join(dir, "two.json");
  writeFileSync(one, `${JSON.stringify([baseRecord])}\n`);
  writeFileSync(two, `${JSON.stringify([{ ...baseRecord, id: "second" }])}\n`);

  assert.deepEqual(
    readComparisonRecords([one, two]).map((record) => record.id),
    ["clean", "second"],
  );
});
