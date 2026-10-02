import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The two operator-maintained evidence documents are read by no product code,
 * so nothing but a test can hold them to the content their acceptance criteria
 * require. Each assertion below fails on the omission its AC names — a missing
 * tier label, a count that is not zero, a dropped caveat, an unstated
 * adjudication record, a missing code value, a truncated transition table, an
 * absent or duplicated AC17 statement, an invented recall target — rather than
 * passing on a file that merely exists.
 */

const EVIDENCE_ROOT = fileURLToPath(
  new URL("../../../docs/testing/ronda/", import.meta.url),
);

function readEvidence(name: string): string {
  return readFileSync(new URL(name, `file://${EVIDENCE_ROOT}`), "utf8");
}

/** The `## <heading>` section's text, header line included. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`## ${heading}`);
  assert.ok(start >= 0, `document is missing the \`## ${heading}\` section`);
  const next = doc.indexOf("\n## ", start + 1);
  return next === -1 ? doc.slice(start) : doc.slice(start, next);
}

/** The `### <heading>` subsection's text within an already-selected section. */
function subsection(doc: string, heading: string): string {
  const start = doc.indexOf(`### ${heading}`);
  assert.ok(start >= 0, `document is missing the \`### ${heading}\` subsection`);
  const next = doc.indexOf("\n### ", start + 1);
  return next === -1 ? doc.slice(start) : doc.slice(start, next);
}

/** The value cell of the table row whose first cell is exactly `field`. */
function field(doc: string, field: string, where: string): string {
  const row = doc
    .split("\n")
    .find((line) => line.startsWith(`| ${field} |`));
  assert.ok(row !== undefined, `${where} must carry a row for "${field}"`);
  const value = row.split("|")[2];
  assert.ok(value !== undefined && value.trim() !== "", `${where}: "${field}" must carry a value`);
  return value.trim();
}

/** Collapses runs of whitespace so a statement split across source lines matches. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ");
}

function states(haystack: string, needle: string, why: string): void {
  assert.ok(
    flat(haystack).includes(flat(needle)),
    `${why} — the document must state: ${flat(needle)}`,
  );
}

const REAL_PR = readEvidence("sweep-real-pr-evidence.md");
const EFFECT = readEvidence("sweep-effect-evidence.md");

// --- AC15: the tier, the count, and the adjudication vocabulary ------------

test("the real-PR record states the current evidence tier: fixture_only, or real_pr_provisional with a zero count after the first sweep-enabled review", () => {
  const tier = field(REAL_PR, "Evidence tier", "the current-state table");
  assert.ok(
    !tier.includes("`real_pr_measured`"),
    `the tier must not claim the measured tier without ten counted pull requests; found: ${tier}`,
  );
  assert.ok(
    tier.includes("`fixture_only`") || tier.includes("`real_pr_provisional`"),
    `the tier must be \`fixture_only\` or \`real_pr_provisional\`; found: ${tier}`,
  );
  if (tier.includes("`real_pr_provisional`")) {
    const marker = "**Tier promotion.**";
    states(REAL_PR, marker, "a provisional tier must carry its recorded promotion-trigger paragraph");
    const at = REAL_PR.indexOf(marker);
    const paragraph = REAL_PR.slice(at, REAL_PR.indexOf("\n\n", at));
    for (const needle of [
      "real-PR review whose pass actually ran the sweep",
      "is **not a counted pull request**",
    ]) {
      states(paragraph, needle, "the promotion paragraph must state the spec's condition and that the trigger is not counted");
    }
  }
});

test("the real-PR record declares one consistent current tier in every current-state spot", () => {
  const tierField = field(REAL_PR, "Evidence tier", "the current-state table");
  const tier = /`(fixture_only|real_pr_provisional|real_pr_measured)`/.exec(tierField)?.[1];
  assert.ok(tier, `the current-state tier must be one of the three codes; found: ${tierField}`);
  states(REAL_PR, `**Current tier: \`${tier}\`**`, "the tier-vocabulary section's current-tier line must match the current-state table");
  const listRow = REAL_PR.split("\n").find((l) => l.startsWith("| `sweep-categories-v1` | `0` |"));
  assert.ok(listRow, "the list-version row must exist");
  assert.ok(
    listRow.split("|")[3]?.includes(`\`${tier}\``),
    `the list-version row's tier must match the current-state table (${tier}); found: ${listRow}`,
  );
  states(
    REAL_PR,
    `| Claim | Admissible at \`${tier}\``,
    "the claim-admissibility table must be headed with the current tier",
  );
});

test("the real-PR record states a counted-pull-request total and it is zero", () => {
  const count = field(
    REAL_PR,
    "Counted pull requests under the current list version",
    "the current-state table",
  );
  assert.equal(
    count,
    "`0`",
    "the counted-pull-request total must be exactly `0` at ship time",
  );
});

test("the real-PR record names the category list version the count accrues under", () => {
  const version = field(
    REAL_PR,
    "Current category list version the count accrues under",
    "the current-state table",
  );
  assert.ok(
    version.includes("`sweep-categories-v1`"),
    `the count must accrue under a named list version; found: ${version}`,
  );
});

test("the real-PR record states both the independence caveat and the own-repository label", () => {
  states(
    REAL_PR,
    "Independence caveat",
    "AC16 requires the independence caveat",
  );
  states(
    REAL_PR,
    "Own-repository label",
    "AC16 requires the own-repository label",
  );
  states(
    subsection(REAL_PR, "Independence caveat"),
    "Ronda's own repository",
    "the independence caveat must name the population the evidence came from",
  );
  states(
    subsection(REAL_PR, "Own-repository label"),
    "own-repository",
    "the own-repository label must be applied to effect claims",
  );
});

test("the real-PR record states the claim-independence limit (no other-repository corroboration)", () => {
  states(
    REAL_PR,
    "No claim anywhere in this record or in",
    "AC16 requires the statement that no claim asserts corroboration in another repository",
  );
  states(
    REAL_PR,
    "none is required",
    "AC16 requires the statement that no other-repository corroboration is required",
  );
});

test("the real-PR record names both adjudication-outcome code values and states they are applied by hand", () => {
  const adjudication = section(REAL_PR, "Adjudication outcomes");
  states(adjudication, "`ronda_only`", "AC15 requires the Ronda-only code value");
  states(
    adjudication,
    "`ronda_rejected`",
    "AC15 requires the Ronda finding rejected code value",
  );
  states(
    adjudication,
    "recorded by hand",
    "the adjudication record must state the outcome is applied by hand",
  );
  states(
    adjudication,
    "not a count the product derives",
    "the adjudication record must state the outcome is not derived or counted by the product",
  );
  states(
    adjudication,
    "not terminal",
    "the adjudication section must state that `unclear` is not terminal",
  );
});

test("the real-PR record carries an application record for each adjudication code value", () => {
  const outcomes = subsection(
    section(REAL_PR, "Adjudication outcomes"),
    "Application record",
  );
  states(
    outcomes,
    "| Pull request head | Finding | Code value | Decided by | Date |",
    "the adjudication application record must carry its column header",
  );
  const misses = subsection(
    section(REAL_PR, "Terminal miss record"),
    "Application record",
  );
  states(
    misses,
    "| Pull request head | Recorded defect | Code values | Decided by | Date |",
    "the terminal-miss application record must carry its column header",
  );
});

test("the real-PR record names all three terminal-miss code values and the recorded-together rule", () => {
  const misses = section(REAL_PR, "Terminal miss record");
  // Asserted as whole table rows, not as bare identifiers: each code value also
  // appears in the pairing-rule prose, so a bare-identifier assertion would stay
  // green if its row were dropped and the prose kept the name.
  const rows = misses.split("\n").filter((line) => line.startsWith("| `"));
  const codeValues = rows.map((row) => row.split("|")[1].trim());
  assert.deepEqual(
    codeValues,
    ["`sweep_enabled_miss`", "`external_review_miss`", "`sweep_off_miss`"],
    "the terminal-miss table must carry exactly these three code-value rows, in order",
  );
  states(
    misses,
    "recorded **together**",
    "the sweep-enabled and external-review miss records must be stated as recorded together",
  );
  states(
    misses,
    "only when both are present",
    "the terminal-miss pairing rule must state that both records are required",
  );
  states(
    misses,
    "recorded in addition whenever a recorded sweep-off\ncontrol is among that head's compared reviewers",
    "the terminal-miss section must state when the sweep-off control miss is recorded",
  );
});

test("the real-PR record lists all three evidence tier code values", () => {
  const tiers = section(REAL_PR, "Evidence tiers");
  states(tiers, "`fixture_only`", "the fixture-only tier is required");
  states(tiers, "`real_pr_provisional`", "the provisional tier is required");
  states(tiers, "`real_pr_measured`", "the measured tier is required");
});

test("the real-PR record's transition table carries every reachable tier move", () => {
  const transitions = section(REAL_PR, "Transition rules");
  states(
    transitions,
    "First sweep-enabled real pull request review recorded",
    "the fixture_only → real_pr_provisional row is required",
  );
  states(
    transitions,
    "Tenth counted pull request accumulated",
    "the real_pr_provisional → real_pr_measured row is required",
  );
  states(
    transitions,
    "Counted pull requests fall below ten",
    "the real_pr_measured → real_pr_provisional row is required",
  );
  states(
    transitions,
    "Every other reachable combination",
    "the unchanged row is required",
  );
  states(
    transitions,
    "No combination promotes a tier except",
    "the promotion rule must be stated",
  );
});

test("the real-PR record states the list-revision restart rule in full", () => {
  const restart = subsection(
    section(REAL_PR, "Transition rules"),
    "The list-revision restart rule",
  );
  states(
    restart,
    "restarts the counted pull-request total at zero",
    "a revision must restart the counted total at zero",
  );
  states(
    restart,
    "counted total is written against the new list version",
    "the restart must write the count against the new list version",
  );
  states(
    restart,
    "prior version's evidence rather than carried forward",
    "the restart must keep the prior version's count rather than carry it forward",
  );
  // Each per-tier case is asserted in full, not as a prefix: every bullet
// carries the count behavior as well as the tier behavior, so a prefix match
// would stay green if the count half of the bullet were dropped.
  states(
    restart,
    "- **`fixture_only`** — tier unchanged, count unchanged at zero (it was already zero).",
    "the fixture_only case must state both the unchanged tier and the unchanged count",
  );
  states(
    restart,
    "- **`real_pr_provisional`** — tier unchanged, count restart at zero.",
    "the provisional case must state both the unchanged tier and the restarted count",
  );
  states(
    restart,
    "- **`real_pr_measured`** — tier demoted to `real_pr_provisional`, count restart at zero, until ten pull requests have accumulated under the revised list.",
    "the measured case must state the demotion, the restarted count, and the ten-pull-request condition",
  );
});

test("the real-PR record states the ten-count rule with the non-terminal unclear outcome", () => {
  const tenCount = subsection(
    section(REAL_PR, "Transition rules"),
    "The ten-count rule",
  );
  states(
    tenCount,
    "closed before adjudication",
    "AC15(b) requires the cohort to be closed before adjudication",
  );
  states(
    tenCount,
    "terminal adjudication before the label is assigned",
    "AC15(b) requires every pull request in the cohort to reach terminal adjudication",
  );
  states(
    tenCount,
    "`ronda_miss`, `ronda_better`,\n`duplicate`, or a Ronda-only outcome (`ronda_only`) or a Ronda finding rejected\noutcome (`ronda_rejected`)",
    "AC15(b) requires the terminal outcomes to be enumerated",
  );
  states(
    tenCount,
    "`unclear` outcome is not terminal",
    "AC15(b) requires `unclear` to be stated as not terminal",
  );
  states(
    tenCount,
    "recorded cutoff fixed in advance, before any eligible pass's findings are\nvisible",
    "AC15(b) requires the cohort cutoff to be fixed before any eligible pass's findings are visible",
  );
  states(
    tenCount,
    "confirmed by the recorded same-head external review",
    "AC15(b) requires a clean result to be confirmed by the recorded same-head external review",
  );
  states(
    tenCount,
    "with no external review recorded on that\nhead is not adjudicated",
    "AC15(b) requires a pull request with no external review recorded to be not adjudicated",
  );
  states(
    tenCount,
    "[terminal miss record](#terminal-miss-record) is complete",
    "the terminal-condition list must include a complete terminal miss record as a terminal branch",
  );
});

test("the real-PR record makes no real-pull-request effect claim at this tier", () => {
  const claim = section(REAL_PR, "No real-pull-request effect claim is made");
  states(
    claim,
    "makes no real-pull-request effect claim",
    "the record must state that it makes no real-PR effect claim",
  );
  const admissibility = section(REAL_PR, "Claim admissibility at the current tier");
  states(
    admissibility,
    "No — the tier admits no real-PR claim of any kind",
    "the admissibility table must refuse a real-PR descriptive claim at this tier",
  );
  states(
    admissibility,
    "requires `real_pr_measured`",
    "the admissibility table must state the comparative claim's tier requirement",
  );
});

// --- AC17: the regression-gate statement, in this document only -----------

test("the effect record carries the AC17 regression-gate statement in full", () => {
  const gate = section(EFFECT, "Regression-gate status (AC17)");
  states(
    gate,
    "is not a regression gate until",
    "AC17 requires the not-yet-a-gate statement",
  );
  states(
    gate,
    "The operator may declare the extended fixture ready to serve as the basis of a\nregression gate",
    "AC17 requires the operator-declaration clause",
  );
  states(
    gate,
    "recorded per Use Case 5",
    "AC17 requires the declaration to be recorded",
  );
  states(
    gate,
    "is a deferred\n  decision",
    "AC17 requires the pass/fail contract to be stated as a deferred decision",
  );
  states(
    gate,
    "makes no benchmark result pass or fail",
    "AC17 requires the statement that the declaration alone makes no result pass or fail",
  );
});

test("the AC17 statement lives in the effect record only and is not duplicated", () => {
  for (const clause of [
    "not a regression gate",
    "deferred decision",
    "pass/fail contract",
  ]) {
    assert.ok(
      !REAL_PR.includes(clause),
      `the AC17 statement must live in sweep-effect-evidence.md only; sweep-real-pr-evidence.md must not also carry: ${clause}`,
    );
  }
});

test("the effect record states no recall target and no variance ceiling", () => {
  states(
    EFFECT,
    "No recall target and no variance ceiling are defined for this feature",
    "AC17's sibling requirement is that no recall target and no variance ceiling are invented",
  );
  for (const invented of [
    "recall target of",
    "target recall",
    "variance ceiling of",
    "must reach a recall",
  ]) {
    assert.ok(
      !EFFECT.includes(invented),
      `the effect record must not invent a threshold: ${invented}`,
    );
  }
});
