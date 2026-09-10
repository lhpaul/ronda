import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPullRequestViewArgs,
  buildReviewComparisonRecord,
  defaultAdjudicationOutcome,
  defaultComparisonId,
  writeComparisonRecord,
} from "../../../src/cli/record-review-comparison.js";
import { summarizeReviewComparison } from "../../../src/cli/recall-benchmark.js";
import type { ReviewComparisonRecord } from "../../../src/cli/recall-benchmark.js";

test("comparison records default clean same-head reviews to clean agreement", () => {
  const record = buildReviewComparisonRecord({
    id: "ronda-pr-30-bugbot-20260910",
    repository: "lhpaul/ronda",
    pullNumber: 30,
    headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    rondaResult: "clean",
    otherReviewer: "Cursor Bugbot",
    otherResult: "clean",
  });

  assert.equal(record.ronda.reviewedHeadSha, record.headSha);
  assert.equal(record.otherReviewer.reviewedHeadSha, record.headSha);
  assert.deepEqual(record.adjudications, [
    {
      outcome: "clean_agreement",
      notes: "Both reviewers reported clean on the same head.",
    },
  ]);
  assert.equal(summarizeReviewComparison(record).falseCleanCandidate, false);
});

test("comparison records leave non-clean outcomes for human adjudication", () => {
  const record = buildReviewComparisonRecord({
    id: "ronda-pr-31-bugbot-20260910",
    repository: "lhpaul/ronda",
    pullNumber: 31,
    headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    rondaResult: "clean",
    otherReviewer: "Cursor Bugbot",
    otherResult: "findings",
    otherFindings: [
      {
        path: "src/cli/example.ts",
        line: 12,
        severity: "important",
        title: "Check the external finding",
        body: "Human adjudication decides whether this is actionable.",
      },
    ],
  });

  assert.equal(record.adjudications[0]?.outcome, "unclear");
  assert.equal(summarizeReviewComparison(record).falseCleanCandidate, false);
});

test("same-head default adjudication rejects stale reviewer evidence", () => {
  assert.equal(
    defaultAdjudicationOutcome({
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      rondaReviewedHeadSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      rondaResult: "clean",
      otherReviewedHeadSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      otherResult: "clean",
    }),
    "unclear",
  );
});

test("default comparison id is stable and filesystem-friendly", () => {
  assert.equal(
    defaultComparisonId({
      repository: "lhpaul/ronda",
      pullNumber: 30,
      reviewer: "Cursor Bugbot",
      timestamp: new Date("2026-09-10T20:00:00.000Z"),
    }),
    "lhpaul-ronda-pr-30-cursor-bugbot-20260910",
  );
});

test("PR metadata lookup is scoped to the selected repository", () => {
  assert.deepEqual(
    buildPullRequestViewArgs({
      pullNumber: 30,
      repository: "other-owner/other-repo",
    }),
    [
      "pr",
      "view",
      "30",
      "--repo",
      "other-owner/other-repo",
      "--json",
      "headRefOid",
      "--jq",
      ".headRefOid",
    ],
  );
});

test("writing a comparison appends to an existing array file", () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-comparison-"));
  const path = join(dir, "comparisons.json");
  try {
    const first = buildReviewComparisonRecord({
      id: "first",
      repository: "lhpaul/ronda",
      pullNumber: 30,
      headSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      rondaResult: "clean",
      otherReviewer: "Cursor Bugbot",
      otherResult: "clean",
    });
    const second = { ...first, id: "second", pullNumber: 31 };

    writeComparisonRecord(path, first);
    writeComparisonRecord(path, second);

    const records = JSON.parse(
      readFileSync(path, "utf8"),
    ) as ReviewComparisonRecord[];
    assert.equal(records.length, 2);
    assert.deepEqual(
      records.map((record) => record.id),
      ["first", "second"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
