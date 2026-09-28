import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Finding, SweepCategoryList } from "../../../src/domain/review-pass.types.js";
import {
  SWEEP_CATEGORY_LIST_PATH,
  classifyFindings,
  loadSweepList,
} from "../../../src/review/sweep-categories.js";

/** Writes a list value to a temp file and loads it through the `{ path }` seam. */
function loadInjected(value: unknown): ReturnType<typeof loadSweepList> {
  const dir = mkdtempSync(join(tmpdir(), "sweep-list-"));
  const path = join(dir, "sweep-categories.json");
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value), "utf8");
  return loadSweepList({ path });
}

const CATEGORY = {
  identifier: "guard-fails-open",
  displayLabel: "Guard fails open",
  description: "A security check is skipped rather than refused.",
  failureShape: "A check that continues when its input cannot be loaded.",
  evidenceSource: "The 2026-09-23 real-PR corpus.",
  findingInstanceCount: 5,
  matchTerms: ["fails open", "cannot be loaded"],
};

function validList(): SweepCategoryList {
  return {
    version: "sweep-categories-v1",
    categories: [
      {
        identifier: "guard-fails-open",
        displayLabel: "Guard fails open",
        description: "A security check is skipped rather than refused.",
        failureShape: "A check that continues when its input cannot be loaded.",
        evidenceSource: "The 2026-09-23 real-PR corpus.",
        findingInstanceCount: 5,
        matchTerms: ["fails open", "cannot be loaded"],
      },
    ],
  };
}

function finding(title: string, body: string): Finding {
  return { path: "src/a.ts", line: 1, severity: "important", title, body };
}

// ---------------------------------------------------------------------------
// Scenario 2 — the loader's AC19 malformed domain
// ---------------------------------------------------------------------------

test("loadSweepList accepts a well-formed list", () => {
  const result = loadInjected({ version: "sweep-categories-v1", categories: [CATEGORY] });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.list.version, "sweep-categories-v1");
    assert.equal(result.list.categories.length, 1);
  }
});

test("loadSweepList reports an unreadable file", () => {
  const result = loadSweepList({ path: join(tmpdir(), "definitely-absent-sweep-list.json") });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "unreadable");
  }
});

test("loadSweepList reports unparseable JSON", () => {
  const result = loadInjected("{ not json");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("loadSweepList reports a missing, blank, or non-scalar version", () => {
  for (const version of [undefined, "", "   ", null, 7, { v: 1 }, ["v1"]]) {
    const result = loadInjected({ version, categories: [CATEGORY] });
    assert.equal(result.ok, false, `version ${JSON.stringify(version)} should be malformed`);
    if (!result.ok) {
      assert.equal(result.reason, "malformed");
    }
  }
});

test("loadSweepList reports zero categories as empty", () => {
  const result = loadInjected({ version: "sweep-categories-v1", categories: [] });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "empty");
  }
});

test("loadSweepList reports a missing categories array as malformed", () => {
  const result = loadInjected({ version: "sweep-categories-v1" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
  }
});

test("loadSweepList reports every required category field as malformed when absent or blank", () => {
  const fields = [
    "identifier",
    "displayLabel",
    "description",
    "failureShape",
    "evidenceSource",
  ] as const;

  for (const field of fields) {
    for (const value of [undefined, "", "   ", 3, null]) {
      const category = { ...CATEGORY, [field]: value };
      const result = loadInjected({ version: "sweep-categories-v1", categories: [category] });
      assert.equal(
        result.ok,
        false,
        `${field}=${JSON.stringify(value)} should be malformed`,
      );
    }
  }
});

test("loadSweepList rejects a non-positive or non-integer finding instance count", () => {
  for (const value of [0, -1, 1.5, "5", null, undefined, Number.NaN]) {
    const category = { ...CATEGORY, findingInstanceCount: value };
    const result = loadInjected({ version: "sweep-categories-v1", categories: [category] });
    assert.equal(result.ok, false, `count ${JSON.stringify(value)} should be malformed`);
  }
});

test("loadSweepList rejects missing, empty, or non-string match terms", () => {
  for (const value of [undefined, [], "", [""], ["   "], "fails open", [7], ["ok", null]]) {
    const category = { ...CATEGORY, matchTerms: value };
    const result = loadInjected({ version: "sweep-categories-v1", categories: [category] });
    assert.equal(result.ok, false, `matchTerms ${JSON.stringify(value)} should be malformed`);
  }
});

test("loadSweepList rejects duplicate category identifiers", () => {
  const result = loadInjected({
    version: "sweep-categories-v1",
    categories: [CATEGORY, { ...CATEGORY, displayLabel: "Duplicate" }],
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.reason, "malformed");
    assert.match(result.detail, /duplicate/);
  }
});

test("loadSweepList resolves the committed artifact from a non-root working directory", () => {
  // A cwd-relative implementation fails here: the default path is derived from
  // the module's own URL, not `process.cwd()`.
  const previous = process.cwd();
  process.chdir(tmpdir());
  try {
    const result = loadSweepList();
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.list.version, "sweep-categories-v1");
    }
    assert.equal(SWEEP_CATEGORY_LIST_PATH.startsWith(tmpdir()), false);
  } finally {
    process.chdir(previous);
  }
});

// ---------------------------------------------------------------------------
// Scenario 2 — classifyFindings
// ---------------------------------------------------------------------------

test("classifyFindings records a finding against the single category it matches", () => {
  const result = classifyFindings([finding("Guard fails open", "The check continues.")], validList());
  assert.deepEqual(result.categories, [
    { identifier: "guard-fails-open", outcome: "produced_findings" },
  ]);
  assert.deepEqual(result.findings, [{ publicationIndex: 0, categories: ["guard-fails-open"] }]);
  assert.equal(result.uncategorizedFindingCount, 0);
});

test("classifyFindings records a two-category match on the finding's own attribution entry", () => {
  // The per-category outcomes alone cannot distinguish one finding from two,
  // so the assertion reads the per-finding mapping AC9/AC20 require.
  const list: SweepCategoryList = {
    version: "sweep-categories-v1",
    categories: [
      {
        identifier: "guard-fails-open",
        displayLabel: "Guard fails open",
        description: "d",
        failureShape: "f",
        evidenceSource: "e",
        findingInstanceCount: 5,
        matchTerms: ["cannot be loaded"],
      },
      {
        identifier: "external-output-parsing",
        displayLabel: "External output parsing",
        description: "d",
        failureShape: "f",
        evidenceSource: "e",
        findingInstanceCount: 8,
        matchTerms: ["misclassified"],
      },
    ],
  };

  const result = classifyFindings(
    [finding("Cannot be loaded", "so it is misclassified downstream")],
    list,
  );

  assert.deepEqual(result.findings, [
    { publicationIndex: 0, categories: ["guard-fails-open", "external-output-parsing"] },
  ]);
  assert.deepEqual(result.categories, [
    { identifier: "guard-fails-open", outcome: "produced_findings" },
    { identifier: "external-output-parsing", outcome: "produced_findings" },
  ]);
});

test("classifyFindings records an unmatched finding as an empty attribution entry, not an absent one", () => {
  const result = classifyFindings([finding("Something else", "unrelated body")], validList());
  assert.equal(result.uncategorizedFindingCount, 1);
  assert.deepEqual(result.findings, [{ publicationIndex: 0, categories: [] }]);
  assert.deepEqual(result.categories, [
    { identifier: "guard-fails-open", outcome: "produced_none" },
  ]);
});

test("classifyFindings matches case-insensitively", () => {
  const result = classifyFindings([finding("FAILS OPEN", "Cannot Be Loaded here")], validList());
  assert.deepEqual(result.findings, [{ publicationIndex: 0, categories: ["guard-fails-open"] }]);
});

test("classifyFindings emits one attribution entry per finding in publication order", () => {
  const result = classifyFindings(
    [
      finding("Fails open", "body"),
      finding("Unrelated", "body"),
      finding("Cannot be loaded", "body"),
    ],
    validList(),
  );

  assert.deepEqual(
    result.findings.map((entry) => entry.publicationIndex),
    [0, 1, 2],
  );
  assert.equal(result.findings.length, 3);
  assert.equal(result.uncategorizedFindingCount, 1);
  // The outcomes and the attribution entries agree: categories reported as
  // producing findings are exactly those some entry names.
  const named = new Set(result.findings.flatMap((entry) => entry.categories));
  for (const category of result.categories) {
    assert.equal(category.outcome === "produced_findings", named.has(category.identifier));
  }
});

test("classifyFindings records a category finding written without its match terms as uncategorized", () => {
  // The classifier's honest lexical limit: a finding that belongs to a category
  // but carries none of its vocabulary is uncategorized, and the category is
  // produced_none. No fourth outcome is invented for it.
  const result = classifyFindings(
    [finding("Authorization bypass", "privilege escalation on the admin route")],
    validList(),
  );

  assert.equal(result.uncategorizedFindingCount, 1);
  assert.deepEqual(result.findings, [{ publicationIndex: 0, categories: [] }]);
  assert.deepEqual(result.categories, [
    { identifier: "guard-fails-open", outcome: "produced_none" },
  ]);
  assert.deepEqual(
    new Set(result.categories.map((category) => category.outcome)),
    new Set(["produced_none"]),
  );
});

test("classifyFindings is deterministic for the same findings and list", () => {
  const findings = [finding("Fails open", "b"), finding("Unrelated", "b")];
  const first = classifyFindings(findings, validList());
  const second = classifyFindings(findings, validList());
  assert.deepEqual(first, second);
});

// ---------------------------------------------------------------------------
// Scenario 8 — the committed artifact against AC6 and AC7
// ---------------------------------------------------------------------------

interface RecordedArtifact {
  version: string;
  activatedOn: string;
  countingUnit: string;
  categories: Array<{ identifier: string; findingInstanceCount: number; matchTerms: string[] }>;
  excludedCandidates: Array<{ identifier: string; rationale: string }>;
  belowBoundarySubThemes: Array<{ identifier: string; findingInstanceCount: number }>;
  revisionHistory: Array<{
    version: string;
    date: string;
    motivatingEvidence: string;
    priorVersion: string | null;
  }>;
}

const RECORDED = JSON.parse(
  readFileSync(SWEEP_CATEGORY_LIST_PATH, "utf8"),
) as RecordedArtifact;

const REQUIRED_CATEGORIES = [
  "pr-head-push-order",
  "credential-pattern-gap",
  "external-output-parsing",
  "record-identity",
  "guard-fails-open",
];

const REQUIRED_EXCLUSIONS = [
  "authorization-bypass-seed",
  "data-loss-overwrite-seed",
  "configuration-debug-default-seed",
  "invalid-range-parsing-seed",
  "planted-proof-evidence",
  "spec-ac-compliance",
  "per-finding-resolution",
];

test("the recorded list holds exactly the five required categories", () => {
  assert.deepEqual(
    RECORDED.categories.map((category) => category.identifier).sort(),
    [...REQUIRED_CATEGORIES].sort(),
  );
});

test("every required category carries its own count and classification vocabulary", () => {
  for (const category of RECORDED.categories) {
    assert.ok(Number.isInteger(category.findingInstanceCount) && category.findingInstanceCount > 0);
    assert.ok(Array.isArray(category.matchTerms) && category.matchTerms.length > 0);
    assert.ok(category.matchTerms.every((term) => term === term.toLowerCase() && term.trim() !== ""));
  }
});

test("the excluded set is exactly the bounded candidates, each with a non-empty rationale", () => {
  assert.deepEqual(
    RECORDED.excludedCandidates.map((candidate) => candidate.identifier).sort(),
    [...REQUIRED_EXCLUSIONS].sort(),
  );
  for (const candidate of RECORDED.excludedCandidates) {
    assert.notEqual(candidate.rationale.trim(), "", `${candidate.identifier} has no rationale`);
  }
});

test("the sub-themes below the candidate boundary are named with their counts", () => {
  assert.ok(RECORDED.belowBoundarySubThemes.length > 0);
  for (const theme of RECORDED.belowBoundarySubThemes) {
    assert.ok(Number.isInteger(theme.findingInstanceCount) && theme.findingInstanceCount > 0);
  }
});

test("the list states its version, activation date, and counting unit", () => {
  assert.equal(RECORDED.version, "sweep-categories-v1");
  assert.equal(RECORDED.activatedOn, "2026-09-27");
  assert.equal(RECORDED.countingUnit, "finding instances, not distinct defects");
});

test("the list has exactly one current revision, which names its evidence and date", () => {
  assert.equal(RECORDED.revisionHistory.length, 1);
  const revision = RECORDED.revisionHistory[0]!;
  assert.equal(revision.version, RECORDED.version);
  assert.equal(revision.date, RECORDED.activatedOn);
  assert.notEqual(revision.motivatingEvidence.trim(), "");
  assert.equal(revision.priorVersion, null);
});

test("the current version is not reused across the revision history", () => {
  const versions = RECORDED.revisionHistory.map((revision) => revision.version);
  assert.equal(new Set(versions).size, versions.length);
});