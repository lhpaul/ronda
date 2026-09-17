import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyAuthoritativeDocBudgets,
  selectAuthoritativeDocCandidates,
} from "../../../src/core/select-authoritative-docs.js";
import { DEFAULT_AUTHORITATIVE_DOC_CATALOG } from "../../../src/domain/authoritative-doc-catalog.js";

test("webhook path change selects all catalog candidates in priority order", () => {
  const result = selectAuthoritativeDocCandidates(["src/webhook/webhook-server.ts"]);
  assert.equal(result.candidates.length, 4);
  assert.deepEqual(
    result.candidates.map((entry) => entry.id),
    ["constitution", "review-contract", "software-architecture", "review-adoption"],
  );
  assert.equal(result.skipped.length, 0);
});

test("utility-only change yields no candidates and not_relevant skips", () => {
  const result = selectAuthoritativeDocCandidates(["src/domain/severity.ts"]);
  assert.equal(result.candidates.length, 0);
  assert.equal(result.skipped.length, DEFAULT_AUTHORITATIVE_DOC_CATALOG.length);
  assert.ok(result.skipped.every((skip) => skip.reason === "not_relevant"));
});

test("phase-2 drops docs over count and char budgets with stable reasons", () => {
  const candidates = DEFAULT_AUTHORITATIVE_DOC_CATALOG.map((entry) => ({
    id: entry.id,
    path: entry.path,
    role: entry.role,
    priority: entry.priority,
    text: "x".repeat(100),
  }));

  const overCount = applyAuthoritativeDocBudgets(candidates, {
    maxAuthoritativeDocCount: 2,
    maxAuthoritativeDocChars: 10_000,
  });
  assert.equal(overCount.selected.length, 2);
  assert.equal(overCount.skipped.length, 2);
  assert.ok(overCount.skipped.every((skip) => skip.reason === "over_doc_count"));

  const overChars = applyAuthoritativeDocBudgets(candidates, {
    maxAuthoritativeDocCount: 4,
    maxAuthoritativeDocChars: 150,
  });
  assert.equal(overChars.selected.length, 1);
  assert.ok(overChars.skipped.some((skip) => skip.reason === "over_doc_chars"));
});

test("phase-2 maps undefined text to unreadable and empty text to empty", () => {
  const selection = applyAuthoritativeDocBudgets(
    [
      {
        id: "a",
        path: "docs/a.md",
        role: "binding",
        priority: 1,
        text: undefined,
      },
      {
        id: "b",
        path: "docs/b.md",
        role: "advisory",
        priority: 2,
        text: "",
      },
    ],
    { maxAuthoritativeDocCount: 4, maxAuthoritativeDocChars: 10_000 },
  );
  assert.equal(selection.selected.length, 0);
  assert.deepEqual(
    selection.skipped.map((skip) => skip.reason),
    ["unreadable", "empty"],
  );
});

test("phase-1 selection is repeatable for the same paths", () => {
  const paths = ["src/inference/review-prompt.ts"];
  const first = selectAuthoritativeDocCandidates(paths);
  const second = selectAuthoritativeDocCandidates(paths);
  assert.deepEqual(
    first.candidates.map((entry) => entry.id),
    second.candidates.map((entry) => entry.id),
  );
});
