import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCheckRunOutput, buildReviewSummary, countBySeverity } from "../../../src/core/summary.js";
import type { Finding } from "../../../src/domain/review-pass.types.js";

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
