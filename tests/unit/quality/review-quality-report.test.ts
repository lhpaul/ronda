import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { ReviewComparisonRecord } from "../../../src/cli/recall-benchmark.js";
import {
  buildReviewQualityReport,
  classifyEvidenceRow,
  formatMarkdownSummary,
  loadEvidenceFiles,
  type CapturedMissRecord,
} from "../../../src/quality/review-quality-report.js";

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
  adjudications: [{ outcome: "clean_agreement" }],
};

test("classifyEvidenceRow applies stale and unadjudicated precedence", () => {
  assert.equal(
    classifyEvidenceRow({ sameHead: false, adjudicationOutcome: "ronda_miss" }),
    "stale_head",
  );
  assert.equal(
    classifyEvidenceRow({
      sameHead: true,
      adjudicationOutcome: "unclear",
      falseCleanCandidate: true,
    }),
    "unadjudicated",
  );
  assert.equal(
    classifyEvidenceRow({
      sameHead: true,
      adjudicationOutcome: "ronda_miss",
      falseCleanCandidate: true,
    }),
    "true_positive",
  );
});

test("buildReviewQualityReport separates primary outcome buckets", () => {
  const confirmedMiss: ReviewComparisonRecord = {
    ...baseRecord,
    id: "miss",
    pullNumber: 31,
    headSha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
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
    adjudications: [{ outcome: "ronda_miss" }],
  };
  const stale: ReviewComparisonRecord = {
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

  const report = buildReviewQualityReport({
    comparisonRecords: [baseRecord, confirmedMiss, stale, unclearCandidate],
    missRecords: [],
    comparisonFiles: ["fixture.json"],
    missFiles: [],
    comparisonDirectory: "docs/testing/ronda/comparisons",
    missDirectory: "docs/testing/ronda/misses",
    skippedFiles: [],
    filters: {},
  });

  assert.equal(report.primaryOutcomes.true_positive.count, 1);
  assert.equal(report.primaryOutcomes.stale_head.count, 1);
  assert.equal(report.primaryOutcomes.unadjudicated.count, 1);
  assert.equal(report.cleanAgreement.count, 1);
  assert.equal(report.primaryOutcomes.false_positive.count, 0);
  assert.deepEqual(
    report.primaryOutcomes.true_positive.drillDown.map((row) => row.id),
    ["miss"],
  );
  assert.equal(report.falseCleanCandidates.length, 2);
});

test("filters repository and time window narrow totals", () => {
  const otherRepo: ReviewComparisonRecord = {
    ...baseRecord,
    id: "other-repo",
    repository: "other/repo",
    capturedAt: "2026-01-01T00:00:00.000Z",
  } as ReviewComparisonRecord & { capturedAt: string };
  const inScope: ReviewComparisonRecord = {
    ...baseRecord,
    id: "in-scope",
    capturedAt: "2026-02-01T00:00:00.000Z",
  } as ReviewComparisonRecord & { capturedAt: string };

  const report = buildReviewQualityReport({
    comparisonRecords: [otherRepo, inScope],
    missRecords: [],
    comparisonFiles: [],
    missFiles: [],
    comparisonDirectory: "docs/testing/ronda/comparisons",
    missDirectory: "docs/testing/ronda/misses",
    skippedFiles: [],
    filters: {
      repository: "lhpaul/ronda",
      since: "2026-01-15T00:00:00.000Z",
      until: "2026-03-01T00:00:00.000Z",
    },
  });

  assert.equal(report.cleanAgreement.count, 1);
  assert.deepEqual(
    report.cleanAgreement.drillDown.map((row) => row.id),
    ["in-scope"],
  );
});

test("miss records merge with comparison evidence and improvement section", () => {
  const miss: CapturedMissRecord = {
    id: "miss-1",
    repository: "lhpaul/ronda",
    pullNumber: 40,
    reviewedHeadSha: "ffffffffffffffffffffffffffffffffffffffff",
    rondaResultHeadSha: "ffffffffffffffffffffffffffffffffffffffff",
    externalReviewer: "Cursor Bugbot",
    affectedCategory: "security",
    verdict: "true_positive",
    intendedFollowUp: "eval_record",
    capturedAt: "2026-02-02T00:00:00.000Z",
  };

  const report = buildReviewQualityReport({
    comparisonRecords: [],
    missRecords: [miss],
    comparisonFiles: [],
    missFiles: ["misses.json"],
    comparisonDirectory: "docs/testing/ronda/comparisons",
    missDirectory: "docs/testing/ronda/misses",
    skippedFiles: [],
    filters: {},
  });

  assert.equal(report.primaryOutcomes.true_positive.count, 1);
  assert.equal(report.improvement.followUpCounts.eval_record, 1);
  assert.equal(report.improvement.topMissedCategories[0]?.category, "security");
  assert.match(
    report.improvement.suggestedActions[0]?.action ?? "",
    /category security/i,
  );
});

test("loadEvidenceFiles skips invalid json while keeping valid records", () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-quality-report-"));
  const valid = join(dir, "valid.json");
  const invalid = join(dir, "invalid.json");
  writeFileSync(valid, `${JSON.stringify([baseRecord])}\n`);
  writeFileSync(invalid, "{ not json\n");

  const loaded = loadEvidenceFiles({
    comparisonFiles: [valid, invalid],
    missFiles: [],
    comparisonDirectory: dir,
    missDirectory: dir,
  });

  assert.equal(loaded.comparisonRecords.length, 1);
  assert.equal(loaded.skippedFiles.length, 1);
});

test("empty evidence scope yields explicit zero counts", () => {
  const report = buildReviewQualityReport({
    comparisonRecords: [],
    missRecords: [],
    comparisonFiles: [],
    missFiles: [],
    comparisonDirectory: "docs/testing/ronda/comparisons",
    missDirectory: "docs/testing/ronda/misses",
    skippedFiles: [],
    filters: {},
  });

  assert.equal(report.primaryOutcomes.true_positive.count, 0);
  assert.equal(report.scope.comparisonRecordCount, 0);
  assert.equal(report.scope.missRecordCount, 0);
});

test("markdown summary omits forbidden finding body substrings", () => {
  const report = buildReviewQualityReport({
    comparisonRecords: [
      {
        ...baseRecord,
        id: "secret",
        adjudications: [{ outcome: "ronda_miss" }],
        otherReviewer: {
          ...baseRecord.otherReviewer,
          result: "findings",
          findings: [
            {
              path: "src/example.ts",
              line: 1,
              severity: "blocking",
              title: "Secret leak",
              body: "SUPER_SECRET_TOKEN_VALUE",
            },
          ],
        },
      },
    ],
    missRecords: [],
    comparisonFiles: [],
    missFiles: [],
    comparisonDirectory: "docs/testing/ronda/comparisons",
    missDirectory: "docs/testing/ronda/misses",
    skippedFiles: [],
    filters: {},
  });

  const markdown = formatMarkdownSummary(report);
  assert.doesNotMatch(markdown, /SUPER_SECRET_TOKEN_VALUE/);
});

test("AC48 report excludes unresolvable miss records from verdict outcomes", () => {
  const head = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const other = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const missRecords: CapturedMissRecord[] = [
    {
      id: "resolvable-tp",
      repository: "lhpaul/ronda",
      pullNumber: 53,
      reviewedHeadSha: head,
      rondaResultHeadSha: head,
      staleEvidence: false,
      externalReviewer: "codex",
      affectedCategory: "correctness",
      verdict: "true_positive",
    },
    {
      id: "unresolvable-tp",
      repository: "lhpaul/ronda",
      pullNumber: 53,
      reviewedHeadSha: head,
      rondaResultHeadSha: head,
      staleEvidence: false,
      externalReviewer: "codex",
      affectedCategory: "correctness",
      verdict: "true_positive",
    },
    {
      id: "stale-and-unresolvable",
      repository: "lhpaul/ronda",
      pullNumber: 53,
      reviewedHeadSha: other,
      rondaResultHeadSha: head,
      staleEvidence: true,
      externalReviewer: "codex",
      affectedCategory: "correctness",
      verdict: "true_positive",
    },
  ];

  const report = buildReviewQualityReport({
    comparisonRecords: [],
    missRecords,
    comparisonFiles: [],
    missFiles: ["m.json"],
    comparisonDirectory: "docs/testing/ronda/comparisons",
    missDirectory: "docs/testing/ronda/misses",
    skippedFiles: [],
    filters: {},
    isResolvable: (record) => record.id === "resolvable-tp",
  });

  assert.equal(report.primaryOutcomes.true_positive.count, 1);
  assert.equal(report.supplementary.unresolvableEvidence, 2);
  assert.equal(report.primaryOutcomes.stale_head.count, 1);
  assert.match(formatMarkdownSummary(report), /unresolvable_evidence: 2/);

  const action = report.improvement.suggestedActions.find((entry) =>
    /category correctness/i.test(entry.action),
  );
  assert.equal(action?.recordIds.length, 1);
  assert.deepEqual(action?.recordIds, ["resolvable-tp"]);
});

function provenanceMiss(overrides: Partial<CapturedMissRecord> = {}): CapturedMissRecord {
  return { id: "legacy", repository: "example/repo", pullNumber: 1,
    reviewedHeadSha: "a".repeat(40), rondaResultHeadSha: "a".repeat(40),
    externalReviewer: "reviewer", verdict: "true_positive", affectedCategory: "retries",
    intendedFollowUp: "eval_record", ...overrides };
}
function provenanceReport(records: CapturedMissRecord[], filters = {}) {
  return buildReviewQualityReport({ comparisonRecords: [baseRecord], missRecords: records,
    comparisonFiles: [], missFiles: [], comparisonDirectory: "comparisons", missDirectory: "misses",
    skippedFiles: [], filters, isResolvable: (row) => row.id !== "gone" });
}

test("#139 report partitions legacy, human and draft evidence with source-attributed recommendations", () => {
  const records = [provenanceMiss(), provenanceMiss({ id: "human", verdictProvenance: "human" }),
    provenanceMiss({ id: "draft", verdictProvenance: "assistant_drafted_owner_accepted" }),
    provenanceMiss({ id: "gone", verdictProvenance: "assistant_drafted_owner_accepted" }),
    provenanceMiss({ id: "stale", reviewedHeadSha: "b".repeat(40), verdictProvenance: "assistant_drafted_owner_accepted" }),
    provenanceMiss({ id: "filtered", repository: "other/repo", verdictProvenance: "assistant_drafted_owner_accepted" })];
  const report = provenanceReport(records, { repository: "example/repo" });
  assert.equal(report.primaryOutcomes.true_positive.count, 2);
  assert.equal(report.acceptedAssistantDrafts.primaryOutcomes.true_positive.count, 1);
  assert.equal(report.primaryOutcomes.stale_head.count, 1);
  assert.equal(report.supplementary.unresolvableEvidence, 1);
  assert.equal(report.improvement.topMissedCategories[0]!.confirmedMissCount, 2);
  assert.equal(report.improvement.followUpCounts.eval_record, 2);
  assert.equal(report.acceptedAssistantDrafts.followUpCounts.eval_record, 1);
  assert.deepEqual(report.acceptedAssistantDrafts.breakdowns.byCategory.retries, { true_positive: 1, false_positive: 0, false_clean: 0, stale_head: 0, unadjudicated: 0 });
  const actions = report.improvement.suggestedActions;
  assert.deepEqual(actions.find((a) => a.provenance === "assistant_drafted_owner_accepted")!.recordIds, ["draft"]);
  assert.match(actions.find((a) => a.provenance === "assistant_drafted_owner_accepted")!.action, /Accepted assistant draft evidence/);
  assert.ok(actions.every((a) => !a.recordIds.some((id) => ["filtered", "gone", "stale"].includes(id))));
  assert.match(formatMarkdownSummary(report), /Human reviewed/);
  assert.match(formatMarkdownSummary(report), /Accepted assistant drafts/);
  assert.equal(JSON.parse(JSON.stringify(report)).acceptedAssistantDrafts.primaryOutcomes.true_positive.count, 1);
  assert.equal(provenanceReport([]).acceptedAssistantDrafts.primaryOutcomes.true_positive.count, 0);
  assert.equal(provenanceReport([records[2]!]).primaryOutcomes.true_positive.count, 0);
  assert.equal(provenanceReport([records[0]!]).acceptedAssistantDrafts.primaryOutcomes.true_positive.count, 0);
  assert.ok(!Object.hasOwn(records[0]!, "verdictProvenance"));
});

for (const invalid of ["", null, 7, "robot"]) {
  test(`#139 malformed provenance ${JSON.stringify(invalid)} rejected before exclusions and file reads`, () => {
    const record = { ...provenanceMiss({ verdict: "unadjudicated", staleEvidence: true }), verdictProvenance: invalid } as unknown as CapturedMissRecord;
    assert.throws(() => provenanceReport([record]), /Invalid verdictProvenance/);
    assert.doesNotThrow(() => provenanceReport([{ ...record, verdictProvenance: "human" }]));
    const dir = mkdtempSync(join(tmpdir(), "ronda-139-invalid-"));
    const path = join(dir, "record.json");
    writeFileSync(path, JSON.stringify(record));
    const loaded = loadEvidenceFiles({ comparisonFiles: [], missFiles: [path], comparisonDirectory: dir, missDirectory: dir });
    assert.equal(loaded.missRecords.length, 0);
    assert.match(loaded.skippedFiles[0]!.reason, /Invalid verdictProvenance/);
    writeFileSync(path, JSON.stringify({ ...record, verdictProvenance: "human" }));
    assert.equal(loadEvidenceFiles({ comparisonFiles: [], missFiles: [path], comparisonDirectory: dir, missDirectory: dir }).missRecords.length, 1);
    rmSync(dir, { recursive: true, force: true });
  });
}
