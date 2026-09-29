import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyRepositoryContextBudgets,
  buildRepositoryContextCandidates,
  compareRepositoryContextCandidates,
  resolveRepositoryContextOutcome,
  type OrderedRepositoryContextCandidate,
  type RepositoryContextRequestedReference,
  type RepositoryContextResolution,
} from "../../../src/review/repository-context.js";

function candidate(
  overrides: Partial<OrderedRepositoryContextCandidate> = {},
): OrderedRepositoryContextCandidate {
  return {
    kind: "definition",
    symbolName: "example",
    path: "src/example.ts",
    line: 1,
    endLine: 3,
    text: "function example() {}",
    changedPath: "src/caller.ts",
    changedLine: 1,
    ...overrides,
  };
}

// --- buildRepositoryContextCandidates -------------------------------------

test("buildRepositoryContextCandidates pairs a resolved reference with its declaration", () => {
  const requested: RepositoryContextRequestedReference[] = [
    { id: 1, kind: "definition", symbolName: "read", changedPath: "src/a.ts", changedLine: 5 },
  ];
  const resolved: RepositoryContextResolution[] = [
    { id: 1, path: "src/b.ts", line: 10, endLine: 12, text: "function read() {}" },
  ];
  const { candidates, drops } = buildRepositoryContextCandidates(requested, resolved);
  assert.equal(candidates.length, 1);
  assert.equal(drops.length, 0);
  assert.deepEqual(candidates[0], {
    kind: "definition",
    symbolName: "read",
    path: "src/b.ts",
    line: 10,
    endLine: 12,
    text: "function read() {}",
    changedPath: "src/a.ts",
    changedLine: 5,
  });
});

test("buildRepositoryContextCandidates drops an unresolved reference with the reference's own identity", () => {
  const requested: RepositoryContextRequestedReference[] = [
    { id: 1, kind: "definition", symbolName: "read", changedPath: "src/a.ts", changedLine: 5 },
  ];
  const resolved: RepositoryContextResolution[] = [{ id: 1, reason: "ambiguous_resolution" }];
  const { candidates, drops } = buildRepositoryContextCandidates(requested, resolved);
  assert.equal(candidates.length, 0);
  assert.deepEqual(drops, [
    { kind: "definition", symbolName: "read", path: "src/a.ts", line: 5, reason: "ambiguous_resolution" },
  ]);
});

test("buildRepositoryContextCandidates defensively drops a reference with no matching resolution", () => {
  const requested: RepositoryContextRequestedReference[] = [
    { id: 1, kind: "definition", symbolName: "read", changedPath: "src/a.ts", changedLine: 5 },
  ];
  const { candidates, drops } = buildRepositoryContextCandidates(requested, []);
  assert.equal(candidates.length, 0);
  assert.equal(drops[0].reason, "ambiguous_resolution");
});

// --- compareRepositoryContextCandidates (scenario 1: total, stable order) -

test("ordering: changed-line position wins first", () => {
  const a = candidate({ changedPath: "src/a.ts", changedLine: 1, symbolName: "z" });
  const b = candidate({ changedPath: "src/a.ts", changedLine: 2, symbolName: "a" });
  assert.ok(compareRepositoryContextCandidates(a, b) < 0);
  assert.ok(compareRepositoryContextCandidates(b, a) > 0);
});

test("ordering: candidate location breaks a changed-line-position tie", () => {
  const a = candidate({ path: "src/x.ts", line: 1, symbolName: "z" });
  const b = candidate({ path: "src/y.ts", line: 1, symbolName: "a" });
  assert.ok(compareRepositoryContextCandidates(a, b) < 0);
});

test("ordering: symbol name is the final tie-break", () => {
  const a = candidate({ symbolName: "aaa" });
  const b = candidate({ symbolName: "bbb" });
  assert.ok(compareRepositoryContextCandidates(a, b) < 0);
  assert.equal(compareRepositoryContextCandidates(a, a), 0);
});

test("ordering: total and stable — a full sort matches the recorded expectation every run", () => {
  const items = [
    candidate({ changedPath: "src/b.ts", changedLine: 1, path: "src/z.ts", line: 1, symbolName: "m" }),
    candidate({ changedPath: "src/a.ts", changedLine: 2, path: "src/z.ts", line: 1, symbolName: "m" }),
    candidate({ changedPath: "src/a.ts", changedLine: 1, path: "src/y.ts", line: 5, symbolName: "m" }),
    candidate({ changedPath: "src/a.ts", changedLine: 1, path: "src/y.ts", line: 1, symbolName: "z" }),
    candidate({ changedPath: "src/a.ts", changedLine: 1, path: "src/y.ts", line: 1, symbolName: "a" }),
  ];
  const sortedOnce = [...items].sort(compareRepositoryContextCandidates);
  const sortedTwice = [...items].sort(compareRepositoryContextCandidates);
  assert.deepEqual(sortedOnce, sortedTwice);
  assert.deepEqual(
    sortedOnce.map((c) => `${c.changedPath}:${c.changedLine}|${c.path}:${c.line}|${c.symbolName}`),
    [
      "src/a.ts:1|src/y.ts:1|a",
      "src/a.ts:1|src/y.ts:1|z",
      "src/a.ts:1|src/y.ts:5|m",
      "src/a.ts:2|src/z.ts:1|m",
      "src/b.ts:1|src/z.ts:1|m",
    ],
  );
});

// --- applyRepositoryContextBudgets (scenario 2, E9) -----------------------

test("budgets: within both budgets, every candidate is retained", () => {
  const ordered = [candidate({ symbolName: "a" }), candidate({ symbolName: "b" })];
  const { selected, drops } = applyRepositoryContextBudgets(ordered, { maxCandidates: 5, maxChars: 1000 });
  assert.equal(selected.length, 2);
  assert.equal(drops.length, 0);
});

test("budgets: E9 — a count budget of 3 over 7 candidates drops the remaining 4 as candidate_count_budget", () => {
  const ordered = Array.from({ length: 7 }, (_, i) => candidate({ symbolName: `s${i}`, text: "x" }));
  const { selected, drops } = applyRepositoryContextBudgets(ordered, { maxCandidates: 3, maxChars: 1000 });
  assert.equal(selected.length, 3);
  assert.equal(drops.length, 4);
  assert.ok(drops.every((drop) => drop.reason === "candidate_count_budget"));
});

test("budgets: a single candidate that alone exceeds the character budget is dropped whole, not truncated", () => {
  const ordered = [candidate({ text: "x".repeat(300) })];
  const { selected, drops } = applyRepositoryContextBudgets(ordered, { maxCandidates: 10, maxChars: 200 });
  assert.equal(selected.length, 0);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].reason, "character_budget");
});

test("budgets: once the character budget stops the take, every remaining candidate is dropped character_budget too", () => {
  const ordered = [
    candidate({ symbolName: "big", text: "x".repeat(195) }),
    candidate({ symbolName: "small", text: "y".repeat(10) }),
  ];
  const { selected, drops } = applyRepositoryContextBudgets(ordered, { maxCandidates: 10, maxChars: 200 });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].symbolName, "big");
  assert.equal(drops.length, 1);
  assert.equal(drops[0].symbolName, "small");
  assert.equal(drops[0].reason, "character_budget");
});

test("budgets: zero candidates in produces zero candidates and zero drops out", () => {
  const { selected, drops } = applyRepositoryContextBudgets([], { maxCandidates: 3, maxChars: 200 });
  assert.deepEqual(selected, []);
  assert.deepEqual(drops, []);
});

// --- resolveRepositoryContextOutcome (scenario 3's outcome-resolution) ----

test("outcome: zero requested is nothing_to_resolve", () => {
  assert.equal(resolveRepositoryContextOutcome({ candidatesRequested: 0, candidatesResolved: 0 }), "nothing_to_resolve");
});

test("outcome: all requested resolved is used", () => {
  assert.equal(resolveRepositoryContextOutcome({ candidatesRequested: 3, candidatesResolved: 3 }), "used");
});

test("outcome: some but not all resolved is partial", () => {
  assert.equal(resolveRepositoryContextOutcome({ candidatesRequested: 3, candidatesResolved: 1 }), "partial");
});

test("outcome: at least one requested and none resolved is unavailable", () => {
  assert.equal(resolveRepositoryContextOutcome({ candidatesRequested: 3, candidatesResolved: 0 }), "unavailable");
});
