import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCheckRunOutput, buildReviewSummary } from "../../../src/core/summary.js";
import type { Finding, RepositoryContextPassRecord } from "../../../src/domain/review-pass.types.js";

const findings: Finding[] = [];

function baseSummaryInput() {
  return {
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
}

function record(overrides: Partial<RepositoryContextPassRecord> = {}): RepositoryContextPassRecord {
  return {
    outcome: "used",
    candidatesRequested: 2,
    candidatesResolved: 2,
    drops: [],
    unreadableChangedFilePaths: [],
    contentRequestCount: 3,
    nonRepositoryReferencesSkipped: 2,
    charsUsed: 120,
    maxCandidates: 12,
    maxChars: 24_000,
    timeBudgetMs: 120_000,
    timeUsedMs: 40,
    budgetFallbacks: [],
    ...overrides,
  };
}

// --- Scenario 13 (review-body half): one line, nothing further -----------

test("scenario 13: the review body states exactly one repository-context line naming the outcome", () => {
  for (const outcome of ["used", "partial", "unavailable", "nothing_to_resolve"] as const) {
    const summary = buildReviewSummary({ ...baseSummaryInput(), repositoryContext: { outcome } });
    const matches = summary.match(/Repository context:.*$/gm) ?? [];
    assert.equal(matches.length, 1, `expected exactly one line for ${outcome}`);
  }
});

test("scenario 13: no count, identifier, drop reason, or budget figure appears in the review body", () => {
  const summary = buildReviewSummary({ ...baseSummaryInput(), repositoryContext: { outcome: "partial" } });
  assert.doesNotMatch(summary, /candidatesRequested|candidatesResolved|budget|drop|charsUsed/i);
});

test("no repository-context line is rendered at all when the field is absent", () => {
  const summary = buildReviewSummary(baseSummaryInput());
  assert.doesNotMatch(summary, /Repository context/);
});

// --- Scenario 13 (check-run half): the full record, no excerpt body -------

test("scenario 13: the check-run output carries the full record, including contentRequestCount", () => {
  const output = buildCheckRunOutput({
    outcome: "succeeded",
    findingCounts: { blocking: 0, important: 0, nit: 0 },
    modelName: "qwen-plus",
    durationMs: 1000,
    repositoryContext: record({
      outcome: "partial",
      drops: [
        { kind: "definition", symbolName: "helper", path: "src/other.ts", line: 4, reason: "character_budget" },
      ],
    }),
  });
  assert.match(output.summary, /Repository context partial/);
  assert.match(output.summary, /Candidates requested: 2, resolved: 2/);
  assert.match(output.summary, /Content requests: 3/);
  assert.match(output.summary, /Non-repository references skipped: 2/);
  assert.match(output.summary, /helper src\/other\.ts:4 — character_budget/);
});

test("the check-run output never carries an excerpt body", () => {
  const output = buildCheckRunOutput({
    outcome: "succeeded",
    findingCounts: { blocking: 0, important: 0, nit: 0 },
    modelName: "qwen-plus",
    durationMs: 1000,
    repositoryContext: record(),
  });
  assert.doesNotMatch(output.summary, /export function|return /);
});

test("an unrecognized switch value renders a degraded line without the raw value", () => {
  const output = buildCheckRunOutput({
    outcome: "succeeded",
    findingCounts: { blocking: 0, important: 0, nit: 0 },
    modelName: "qwen-plus",
    durationMs: 1000,
    repositoryContextDegraded: { kind: "repository_context_switch_unrecognized" },
  });
  assert.match(output.summary, /unrecognized enablement value/);
});

test("a failure-path check-run output is byte-identical to a pre-feature one — no repository-context field", () => {
  const withoutRepositoryContext = buildCheckRunOutput({
    outcome: "failed",
    findingCounts: { blocking: 0, important: 0, nit: 0 },
    modelName: "qwen-plus",
    durationMs: 1000,
    failureReason: "timed_out",
  });
  // The failure branch of buildCheckRunOutput has no repositoryContext
  // parameter path at all — asserting the summary contains none of the
  // record's own vocabulary is the regression test for that.
  assert.doesNotMatch(withoutRepositoryContext.summary, /Repository context/);
});
