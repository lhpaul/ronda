import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCheckRunOutput, buildReviewSummary, countBySeverity } from "../../../src/core/summary.js";
import type {
  Finding,
  SweepPassRecord,
} from "../../../src/domain/review-pass.types.js";

const findings: Finding[] = [
  { path: "src/a.ts", line: 1, severity: "blocking", title: "Bug", body: "Fix it" },
  { path: "src/b.ts", line: null, severity: "important", title: "Cleanup", body: "Please clean" },
  { path: "src/b.ts", line: null, severity: "nit", title: "Style", body: "Nit pick" },
];

test("countBySeverity tallies each severity independently", () => {
  assert.deepEqual(countBySeverity(findings), { blocking: 1, important: 1, nit: 1 });
});

test("buildReviewSummary renders severity counts and the unmapped findings list", () => {
  const unmapped = findings.filter((finding) => finding.line === null);
  const summary = buildReviewSummary({
    changedFileCount: 2,
    additions: 10,
    deletions: 3,
    findings,
    unmappedFindings: unmapped,
    modelName: "qwen-plus",
    durationMs: 4200,
    trigger: "automatic",
    malformedCount: 0,
    coercedSeverityCount: 0,
    duplicateCount: 0,
  });
  assert.match(summary, /Reviewed 2 changed file\(s\) \(\+10\/-3\)/);
  assert.match(summary, /Blocking \| 1/);
  assert.match(summary, /Important \| 1/);
  assert.match(summary, /Nit \| 1/);
  assert.match(summary, /Findings not attached to a changed line/);
  assert.match(summary, /Cleanup/);
  assert.match(summary, /Trigger: Automatic/);
});

test("buildReviewSummary states a manual trigger with the review command", () => {
  const summary = buildReviewSummary({
    changedFileCount: 1,
    additions: 1,
    deletions: 0,
    findings: [],
    unmappedFindings: [],
    modelName: "qwen-plus",
    durationMs: 1000,
    trigger: "manual",
    malformedCount: 0,
    coercedSeverityCount: 0,
    duplicateCount: 0,
  });
  assert.match(summary, /Manually requested with `\/ronda review`/);
});

test("buildReviewSummary shows an explicit 'no findings' line when the count is zero", () => {
  const summary = buildReviewSummary({
    changedFileCount: 1,
    additions: 1,
    deletions: 0,
    findings: [],
    unmappedFindings: [],
    modelName: "qwen-plus",
    durationMs: 1000,
    trigger: "automatic",
    malformedCount: 0,
    coercedSeverityCount: 0,
    duplicateCount: 0,
  });
  assert.match(summary, /No findings\./);
});

test("buildReviewSummary reports parsing notes when present", () => {
  const summary = buildReviewSummary({
    changedFileCount: 1,
    additions: 1,
    deletions: 0,
    findings: [],
    unmappedFindings: [],
    modelName: "qwen-plus",
    durationMs: 1000,
    trigger: "automatic",
    malformedCount: 2,
    coercedSeverityCount: 1,
    duplicateCount: 3,
  });
  assert.match(summary, /2 finding\(s\) from the model were malformed/);
  assert.match(summary, /1 finding\(s\) had an unrecognised severity/);
  assert.match(summary, /3 duplicate finding\(s\)/);
});

test("buildCheckRunOutput renders a succeeded outcome with the finding total", () => {
  const output = buildCheckRunOutput({
    outcome: "succeeded",
    findingCounts: { blocking: 1, important: 0, nit: 2 },
    modelName: "qwen-plus",
    durationMs: 5000,
  });
  assert.equal(output.title, "Review posted — 3 finding(s)");
  assert.match(output.summary, /Blocking: 1, Important: 0, Nit: 2/);
});

test("buildCheckRunOutput renders a succeeded outcome with zero findings", () => {
  const output = buildCheckRunOutput({
    outcome: "succeeded",
    findingCounts: { blocking: 0, important: 0, nit: 0 },
    modelName: "qwen-plus",
    durationMs: 1000,
  });
  assert.equal(output.title, "Review posted — no findings");
});

test("buildCheckRunOutput names the failure reason and the re-run hint", () => {
  const output = buildCheckRunOutput({
    outcome: "failed",
    findingCounts: { blocking: 0, important: 0, nit: 0 },
    modelName: "qwen-plus",
    durationMs: 1000,
    failureReason: "credential_missing",
  });
  assert.equal(output.title, "Review failed — model credential missing");
  assert.match(output.summary, /Ask for another pass with `\/ronda review`/);
});

// ---------------------------------------------------------------------------
// Scenario 4 — the sweep renderers (#105)
// ---------------------------------------------------------------------------

/**
 * Two published findings: index 0 matched to two categories, index 1 matched to
 * none. The per-category outcomes alone cannot distinguish them, so a renderer
 * that dropped the attribution lines would still pass an outcomes-only test.
 */
const sweepRecord: SweepPassRecord = {
  listVersion: "sweep-categories-v1",
  categories: [
    { identifier: "guard-fails-open", outcome: "produced_findings" },
    { identifier: "external-output-parsing", outcome: "produced_findings" },
    { identifier: "record-identity", outcome: "produced_none" },
    { identifier: "pr-head-push-order", outcome: "not_determined" },
  ],
  findings: [
    { publicationIndex: 0, categories: ["guard-fails-open", "external-output-parsing"] },
    { publicationIndex: 1, categories: [] },
  ],
  uncategorizedFindingCount: 1,
};

test("buildReviewSummary states the sweep and its list version, and nothing else", () => {
  const summary = buildReviewSummary({
    changedFileCount: 1,
    additions: 1,
    deletions: 0,
    findings,
    unmappedFindings: [],
    modelName: "qwen-plus",
    durationMs: 1000,
    trigger: "automatic",
    malformedCount: 0,
    coercedSeverityCount: 0,
    duplicateCount: 0,
    // Deliberately carries the whole record: structural typing lets a caller
    // hand over more than `{ listVersion }`, and the renderer must read only
    // the version. A renderer that spread the record fails here.
    sweep: {
      ...sweepRecord,
      listVersion: "sweep-categories-v1",
    } as { listVersion: string },
  });

  assert.match(summary, /### Category-forced sweep/);
  assert.match(summary, /sweep-categories-v1/);
  // The published review body carries no sweep vocabulary beyond the version.
  assert.doesNotMatch(summary, /guard-fails-open/);
  assert.doesNotMatch(summary, /produced_findings/);
  assert.doesNotMatch(summary, /publicationIndex|finding 0/);
});

test("buildReviewSummary renders identically when the sweep is absent", () => {
  const base = {
    changedFileCount: 1,
    additions: 1,
    deletions: 0,
    findings,
    unmappedFindings: [],
    modelName: "qwen-plus",
    durationMs: 1000,
    trigger: "automatic" as const,
    malformedCount: 0,
    coercedSeverityCount: 0,
    duplicateCount: 0,
  };
  assert.equal(buildReviewSummary(base), buildReviewSummary(base));
  assert.doesNotMatch(buildReviewSummary(base), /Category-forced sweep/);
});

test("buildCheckRunOutput renders the per-category record with its attribution lines", () => {
  const output = buildCheckRunOutput({
    outcome: "succeeded",
    findingCounts: { blocking: 1, important: 1, nit: 0 },
    modelName: "qwen-plus",
    durationMs: 5000,
    sweep: sweepRecord,
  });

  for (const category of sweepRecord.categories) {
    assert.match(output.summary, new RegExp(`- ${category.identifier}: ${category.outcome}`));
  }
  // The attribution lines: index 0 names both categories, index 1 is
  // uncategorized. An outcomes-only renderer fails here.
  assert.match(output.summary, /- finding 0: guard-fails-open, external-output-parsing/);
  assert.match(output.summary, /- finding 1: uncategorized/);
  assert.match(output.summary, /Uncategorized findings: 1/);
  // No finding text: the record deliberately carries none.
  assert.doesNotMatch(output.summary, /Fix it|Please clean|Bug/);
});

test("buildCheckRunOutput renders the invalid-list degraded record without a list version", () => {
  const output = buildCheckRunOutput({
    outcome: "succeeded",
    findingCounts: { blocking: 0, important: 0, nit: 0 },
    modelName: "qwen-plus",
    durationMs: 1000,
    sweepDegraded: { kind: "sweep-did-not-run", reason: "malformed", detail: "no categories" },
  });

  assert.match(output.summary, /sweep-did-not-run/);
  assert.match(output.summary, /Reason: malformed/);
  // It used no list, so it may not name one — and the free-text detail stays
  // off the surface.
  assert.doesNotMatch(output.summary, /sweep-categories-v1/);
  assert.doesNotMatch(output.summary, /no categories/);
});

test("buildCheckRunOutput renders the unrecognized-enablement record without the raw value", () => {
  const output = buildCheckRunOutput({
    outcome: "succeeded",
    findingCounts: { blocking: 0, important: 0, nit: 0 },
    modelName: "qwen-plus",
    durationMs: 1000,
    sweepDegraded: { kind: "sweep_enablement_unrecognized" },
  });

  assert.match(output.summary, /unrecognized enablement value/);
  assert.doesNotMatch(output.summary, /sweep-categories-v1/);
});

test("buildCheckRunOutput on the failure path carries no sweep fields", () => {
  const output = buildCheckRunOutput({
    outcome: "failed",
    findingCounts: { blocking: 0, important: 0, nit: 0 },
    modelName: "qwen-plus",
    durationMs: 1000,
    failureReason: "model_unavailable",
  });
  assert.doesNotMatch(output.summary, /Category-forced sweep/);
  assert.doesNotMatch(output.summary, /sweep-did-not-run|unrecognized enablement/);
});

// #134: review path-exclusion is named in the summary, never silent.

test("buildReviewSummary names excluded files with a count and a bounded list", () => {
  const summary = buildReviewSummary({
    changedFileCount: 1,
    additions: 1,
    deletions: 0,
    findings,
    unmappedFindings: [],
    modelName: "qwen-plus",
    durationMs: 1000,
    trigger: "automatic",
    malformedCount: 0,
    coercedSeverityCount: 0,
    duplicateCount: 0,
    excludedFiles: [
      { path: "package-lock.json", reason: "default_glob" },
      { path: "docs/testing/ronda/sweep-on-precision.json", reason: "configured_glob" },
    ],
  });
  assert.match(summary, /### Excluded from review/);
  assert.match(summary, /2 file\(s\) excluded before review/);
  assert.match(summary, /`package-lock\.json`/);
  assert.match(summary, /`docs\/testing\/ronda\/sweep-on-precision\.json`/);
});

test("buildReviewSummary bounds the excluded-file list and states the remainder", () => {
  const excludedFiles = Array.from({ length: 25 }, (_, i) => ({
    path: `docs/testing/ronda/case-${i}.json`,
    reason: "configured_glob" as const,
  }));
  const summary = buildReviewSummary({
    changedFileCount: 1,
    additions: 1,
    deletions: 0,
    findings: [],
    unmappedFindings: [],
    modelName: "qwen-plus",
    durationMs: 1000,
    trigger: "automatic",
    malformedCount: 0,
    coercedSeverityCount: 0,
    duplicateCount: 0,
    excludedFiles,
  });
  assert.match(summary, /25 file\(s\) excluded before review/);
  assert.match(summary, /\(\+5 more\)/);
  assert.match(summary, /docs\/testing\/ronda\/case-19\.json/);
  assert.doesNotMatch(summary, /docs\/testing\/ronda\/case-20\.json/);
});

test("buildReviewSummary states explicitly when every changed file was excluded — not a clean-looking review", () => {
  const summary = buildReviewSummary({
    changedFileCount: 0,
    additions: 0,
    deletions: 0,
    findings: [],
    unmappedFindings: [],
    modelName: "qwen-plus",
    durationMs: 1000,
    trigger: "automatic",
    malformedCount: 0,
    coercedSeverityCount: 0,
    duplicateCount: 0,
    excludedFiles: [
      { path: "docs/testing/ronda/sweep-on-precision.json", reason: "configured_glob" },
      { path: "tests/fixtures/recall-benchmark/case-1.json", reason: "configured_glob" },
    ],
  });
  assert.match(summary, /Every changed file was excluded from review/);
  assert.doesNotMatch(summary, /^No findings\.$/m);
});

test("buildReviewSummary omits the excluded-files section entirely when nothing was excluded", () => {
  const summary = buildReviewSummary({
    changedFileCount: 1,
    additions: 1,
    deletions: 0,
    findings: [],
    unmappedFindings: [],
    modelName: "qwen-plus",
    durationMs: 1000,
    trigger: "automatic",
    malformedCount: 0,
    coercedSeverityCount: 0,
    duplicateCount: 0,
    excludedFiles: [],
  });
  assert.doesNotMatch(summary, /Excluded from review/);
  assert.match(summary, /No findings\./);
});
