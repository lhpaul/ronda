# Planted-violation proofs (guard tests) — #105

Recorded for PR #118 per REVIEW.md Workflow Policy checklist item 4 and
`docs/best-practices/3-testing.md` ("Planted-Violation Proofs" and "Isolating
plants per new assertion"). It complements
[`105-planted-violation-proofs.md`](105-planted-violation-proofs.md), which
covers `tests/unit/cli/recall-benchmark.test.ts`. This file covers the guard
tests that hold committed artifacts to their acceptance-criteria content.

## Scope

In scope: every assertion in these two test files that is itself a guard over
a committed artifact.

- `tests/unit/testing/evidence-records.test.ts` holds
  `docs/testing/ronda/sweep-real-pr-evidence.md` and
  `docs/testing/ronda/sweep-effect-evidence.md` to their AC15, AC16, and AC17
  content. All sixteen tests are in scope: every `states(...)` call, the
  table and count assertions, the two "must not contain" loops, and the
  `section()`, `subsection()`, and `field()` lookup assertions those tests
  rely on.
- `tests/unit/review/sweep-categories.test.ts`, the "Scenario 8" tests that
  hold `docs/testing/ronda/sweep-categories.json` to AC6 and AC7, plus the one
  loader test that reads the committed file (`loadSweepList resolves the
  committed artifact from a non-root working directory`, lines 164 and 166).

Deliberately out of scope, and why:

- The in-memory tests in `sweep-categories.test.ts` (the `loadSweepList`
  malformed-domain tests, which write a temporary file, and every
  `classifyFindings` test) are ordinary unit tests of product behavior over
  data the test builds itself. They are not a check over a committed artifact,
  so a plant in a committed file cannot exercise them.
- `assert.equal(SWEEP_CATEGORY_LIST_PATH.startsWith(tmpdir()), false)` (line
  168) asserts a property of a product constant, not of the committed file.
  Its plant would live in `src/review/sweep-categories.ts`, not in an
  artifact.
- The `recall-benchmark.test.ts` assertions: covered by the sibling proof
  document above.
- The `states()` helper's own `includes` check and the `flat()` helper are
  exercised by every `states` row rather than proved separately.

## Method

The proofs are mechanical so they can be reproduced. A throwaway harness kept
outside the repository (it is not committed) walked every in-scope assertion
and, for each one:

1. Determined the artifact text the assertion needs. For each `states(...)`
   call it took the needle literal from the test source, decoded its escapes,
   and matched it whitespace-tolerantly, limited to the same section or
   subsection the test selects. For the count, row, order, table, and value
   assertions it chose the specific row, cell, or value.
2. Planted a violation in the committed artifact (the needle replaced by the
   marker `PLANTEDMARKER`, a row deleted or reordered, a value changed, a
   forbidden phrase appended), recording the artifact line of the plant.
3. Ran the whole test file and required that the target test failed with this
   assertion's own message and that the failure's stack frame named this
   assertion's own line in the test file. A failure in a sibling assertion or
   in a different test does not count. (For the shared lookup helpers the
   assertion line is inside the helper, so those rows are identified by the
   message naming the specific heading or field instead.)
4. Restored the artifact with `git checkout -- <artifact>` and required its
   SHA-256 to equal the pre-plant value.
5. Re-ran the whole test file and required every test to pass.

To reproduce any single row by hand, from the repository root:

```bash
# baseline: all tests in both files pass
./node_modules/.bin/tsx --test \
  tests/unit/testing/evidence-records.test.ts \
  tests/unit/review/sweep-categories.test.ts

# plant (row A4: the counted total becomes 1)
python3 - <<'PY'
p = "docs/testing/ronda/sweep-real-pr-evidence.md"
t = open(p).read()
old = "| Counted pull requests under the current list version | `0` |"
open(p, "w").write(t.replace(old, old.replace("`0`", "`1`")))
PY

# fail: the counted-total assertion fails with its own message
./node_modules/.bin/tsx --test tests/unit/testing/evidence-records.test.ts

# restore and pass
git checkout -- docs/testing/ronda/sweep-real-pr-evidence.md
./node_modules/.bin/tsx --test tests/unit/testing/evidence-records.test.ts
```

In the tables below every row records: the test (ids in the legends), the
assertion with its line in the test file, the plant (`real-pr` is
`sweep-real-pr-evidence.md`, `effect` is `sweep-effect-evidence.md`,
`categories.json` is `sweep-categories.json`, each under
`docs/testing/ronda/`; the line is in the artifact before the plant), the
assertion's own failure message (abbreviated), any other test that the same
plant also fails, and whether the file passed again after restore. For the
`states` rows the plant is always "needle to marker" over the whole needle
inside the scope the test reads. Every row was observed: nothing here is
inferred.

## Part A — `evidence-records.test.ts`

Test legend (`H` marks the shared lookup helpers):

| Id | Test line | Test |
| --- | --- | --- |
| E1 | 68 | the real-PR record states the current evidence tier and it is fixture_only |
| E2 | 80 | the real-PR record states a counted-pull-request total and it is zero |
| E3 | 93 | the real-PR record names the category list version the count accrues under |
| E4 | 105 | the real-PR record states both the independence caveat and the own-repository label |
| E5 | 128 | the real-PR record states the claim-independence limit (no other-repository corroboration) |
| E6 | 141 | the real-PR record names both adjudication-outcome code values and states they are applied by hand |
| E7 | 166 | the real-PR record carries an application record for each adjudication code value |
| E8 | 187 | the real-PR record names all three terminal-miss code values and the recorded-together rule |
| E9 | 216 | the real-PR record lists all three evidence tier code values |
| E10 | 223 | the real-PR record's transition table carries every reachable tier move |
| E11 | 252 | the real-PR record states the list-revision restart rule in full |
| E12 | 292 | the real-PR record states the ten-count rule with the non-terminal unclear outcome |
| E13 | 339 | the real-PR record makes no real-pull-request effect claim at this tier |
| E14 | 361 | the effect record carries the AC17 regression-gate statement in full |
| E15 | 390 | the AC17 statement lives in the effect record only and is not duplicated |
| E16 | 403 | the effect record states no recall target and no variance ceiling |

Every row failed with its own message at its own assertion line, and every
row passed again after restore.

| Row | Test | Assertion (test line) | Plant (artifact:line) — change | Fail outcome (own message) | Also fails | Pass after restore |
| --- | --- | --- | --- | --- | --- | --- |
| A1 | E1 | tier value includes 'fixture_only' (L70) | real-pr:22 — value cell loses the code value | the tier must be fixture_only at ship time; found: Fixture evidence o… | - | yes |
| A2 | E1 | tier value does not claim 'real_pr_provisional' (L74) | real-pr:22 — value also names 'real_pr_provisional' | the tier must not claim a real-PR tier at ship time; found: fixture_o… | - | yes |
| A3 | E1 | tier value does not claim 'real_pr_measured' (L74) | real-pr:22 — value also names 'real_pr_measured' | the tier must not claim a real-PR tier at ship time; found: fixture_o… | - | yes |
| A4 | E2 | counted-pull-request total equals '0' (L86) | real-pr:23 — '0' changed to '1' | the counted-pull-request total must be exactly 0 at ship time '1' !==… | - | yes |
| A5 | E3 | list-version cell includes 'sweep-categories-v1' (L99) | real-pr:24 — 'v1' changed to 'v2' | the count must accrue under a named list version; found: sweep-catego… | - | yes |
| A6 | E4 | states(doc, "Independence caveat") (L106) | real-pr:52 — needle to marker | "AC16 requires the independence caveat" | - | yes |
| A7 | E4 | states(doc, "Own-repository label") (L111) | real-pr:60 — needle to marker | "AC16 requires the own-repository label" | - | yes |
| A8 | E4 | states(subsection(doc, "Independence caveat"), "Ronda's own repository") (L116) | real-pr:54 — needle to marker | "the independence caveat must name the population the evidence…" | - | yes |
| A9 | E4 | states(subsection(doc, "Own-repository label"), "own-repository") (L121) | real-pr:63 — needle to marker | "the own-repository label must be applied to effect claims" | - | yes |
| A10 | E5 | states(doc, "No claim anywhere in this record or in") (L129) | real-pr:63 — needle to marker | "AC16 requires the statement that no claim asserts corroborati…" | - | yes |
| A11 | E5 | states(doc, "none is required") (L134) | real-pr:65 — needle to marker | "AC16 requires the statement that no other-repository corrobor…" | - | yes |
| A12 | E6 | states(adjudication, "'ronda_only'") (L143) | real-pr:82 — needle to marker | "AC15 requires the Ronda-only code value" | - | yes |
| A13 | E6 | states(adjudication, "'ronda_rejected'") (L144) | real-pr:83 — needle to marker | "AC15 requires the Ronda finding rejected code value" | - | yes |
| A14 | E6 | states(adjudication, "recorded by hand") (L149) | real-pr:71 — needle to marker | "the adjudication record must state the outcome is applied by…" | - | yes |
| A15 | E6 | states(adjudication, "not a count the product derives") (L154) | real-pr:71 — needle to marker | "the adjudication record must state the outcome is not derived…" | - | yes |
| A16 | E6 | states(adjudication, "not terminal") (L159) | real-pr:98 — needle to marker | "the adjudication section must state that 'unclear' is not ter…" | - | yes |
| A17 | E7 | states(outcomes, "\| Pull request head \| Finding \| Code value \| Decided by \|…") (L171) | real-pr:110 — needle to marker | "the adjudication application record must carry its column hea…" | - | yes |
| A18 | E7 | states(misses, "\| Pull request head \| Recorded defect \| Code values \| Dec…") (L180) | real-pr:144 — needle to marker | "the terminal-miss application record must carry its column he…" | - | yes |
| A19 | E8 | terminal-miss table rows are exactly three, in order (row dropped) (L194) | real-pr:128 — 'external_review_miss' row deleted | the terminal-miss table must carry exactly these three code-value row… | - | yes |
| A20 | E8 | terminal-miss table rows are exactly three, in order (reordered) (L194) | real-pr:127 — first two rows swapped | the terminal-miss table must carry exactly these three code-value row… | - | yes |
| A21 | E8 | terminal-miss table rows are exactly three, in order (extra row) (L194) | real-pr:129 — fourth row inserted after 'sweep_off_miss' | the terminal-miss table must carry exactly these three code-value row… | - | yes |
| A22 | E8 | states(misses, "recorded \*\*together\*\*") (L199) | real-pr:131 — needle to marker | "the sweep-enabled and external-review miss records must be st…" | - | yes |
| A23 | E8 | states(misses, "only when both are present") (L204) | real-pr:133 — needle to marker | "the terminal-miss pairing rule must state that both records a…" | - | yes |
| A24 | E8 | states(misses, "recorded in addition whenever a recorded sweep-off contro…") (L209) | real-pr:134 — needle to marker | "the terminal-miss section must state when the sweep-off contr…" | - | yes |
| A25 | E9 | states(tiers, "'fixture_only'") (L218) | real-pr:152 — needle to marker | "the fixture-only tier is required" | - | yes |
| A26 | E9 | states(tiers, "'real_pr_provisional'") (L219) | real-pr:153 — needle to marker | "the provisional tier is required" | - | yes |
| A27 | E9 | states(tiers, "'real_pr_measured'") (L220) | real-pr:154 — needle to marker | "the measured tier is required" | - | yes |
| A28 | E10 | states(transitions, "First sweep-enabled real pull request review recorded") (L225) | real-pr:163 — needle to marker | "the fixture_only → real_pr_provisional row is required" | - | yes |
| A29 | E10 | states(transitions, "Tenth counted pull request accumulated") (L230) | real-pr:165 — needle to marker | "the real_pr_provisional → real_pr_measured row is required" | - | yes |
| A30 | E10 | states(transitions, "Counted pull requests fall below ten") (L235) | real-pr:167 — needle to marker | "the real_pr_measured → real_pr_provisional row is required" | - | yes |
| A31 | E10 | states(transitions, "Every other reachable combination") (L240) | real-pr:168 — needle to marker | "the unchanged row is required" | - | yes |
| A32 | E10 | states(transitions, "No combination promotes a tier except") (L245) | real-pr:170 — needle to marker | "the promotion rule must be stated" | - | yes |
| A33 | E11 | states(restart, "restarts the counted pull-request total at zero") (L257) | real-pr:175 — needle to marker | "a revision must restart the counted total at zero" | - | yes |
| A34 | E11 | states(restart, "counted total is written against the new list version") (L262) | real-pr:184 — needle to marker | "the restart must write the count against the new list version" | - | yes |
| A35 | E11 | states(restart, "prior version's evidence rather than carried forward") (L267) | real-pr:186 — needle to marker | "the restart must keep the prior version's count rather than c…" | - | yes |
| A36 | E11 | states(restart, "- \*\*'fixture_only'\*\* — tier unchanged, count unchanged at…") (L275) | real-pr:178 — needle to marker | "the fixture_only case must state both the unchanged tier and…" | - | yes |
| A37 | E11 | states(restart, "- \*\*'real_pr_provisional'\*\* — tier unchanged, count resta…") (L280) | real-pr:180 — needle to marker | "the provisional case must state both the unchanged tier and t…" | - | yes |
| A38 | E11 | states(restart, "- \*\*'real_pr_measured'\*\* — tier demoted to 'real_pr_provi…") (L285) | real-pr:181 — needle to marker | "the measured case must state the demotion, the restarted coun…" | - | yes |
| A39 | E12 | states(tenCount, "closed before adjudication") (L297) | real-pr:208 — needle to marker | "AC15(b) requires the cohort to be closed before adjudication" | - | yes |
| A40 | E12 | states(tenCount, "terminal adjudication before the label is assigned") (L302) | real-pr:210 — needle to marker | "AC15(b) requires every pull request in the cohort to reach te…" | - | yes |
| A41 | E12 | states(tenCount, "'ronda_miss', 'ronda_better', 'duplicate', or a Ronda-onl…") (L307) | real-pr:211 — needle to marker | "AC15(b) requires the terminal outcomes to be enumerated" | - | yes |
| A42 | E12 | states(tenCount, "'unclear' outcome is not terminal") (L312) | real-pr:222 — needle to marker | "AC15(b) requires 'unclear' to be stated as not terminal" | - | yes |
| A43 | E12 | states(tenCount, "recorded cutoff fixed in advance, before any eligible pas…") (L317) | real-pr:206 — needle to marker | "AC15(b) requires the cohort cutoff to be fixed before any eli…" | - | yes |
| A44 | E12 | states(tenCount, "confirmed by the recorded same-head external review") (L322) | real-pr:214 — needle to marker | "AC15(b) requires a clean result to be confirmed by the record…" | - | yes |
| A45 | E12 | states(tenCount, "with no external review recorded on that head is not adju…") (L327) | real-pr:218 — needle to marker | "AC15(b) requires a pull request with no external review recor…" | - | yes |
| A46 | E12 | states(tenCount, "&#91;terminal miss record&#93;(#terminal-miss-record) is complete") (L332) | real-pr:215 — needle to marker | "the terminal-condition list must include a complete terminal…" | - | yes |
| A47 | E13 | states(claim, "makes no real-pull-request effect claim") (L341) | real-pr:42 — needle to marker | "the record must state that it makes no real-PR effect claim" | - | yes |
| A48 | E13 | states(admissibility, "No — the tier admits no real-PR claim of any kind") (L347) | real-pr:232 — needle to marker | "the admissibility table must refuse a real-PR descriptive cla…" | - | yes |
| A49 | E13 | states(admissibility, "requires 'real_pr_measured'") (L352) | real-pr:233 — needle to marker | "the admissibility table must state the comparative claim's ti…" | - | yes |
| A50 | E14 | states(gate, "is not a regression gate until") (L363) | effect:705 — needle to marker | "AC17 requires the not-yet-a-gate statement" | - | yes |
| A51 | E14 | states(gate, "The operator may declare the extended fixture ready to se…") (L368) | effect:708 — needle to marker | "AC17 requires the operator-declaration clause" | - | yes |
| A52 | E14 | states(gate, "recorded per Use Case 5") (L373) | effect:712 — needle to marker | "AC17 requires the declaration to be recorded" | - | yes |
| A53 | E14 | states(gate, "is a deferred decision") (L378) | effect:715 — needle to marker | "AC17 requires the pass/fail contract to be stated as a deferr…" | - | yes |
| A54 | E14 | states(gate, "makes no benchmark result pass or fail") (L383) | effect:716 — needle to marker | "AC17 requires the statement that the declaration alone makes…" | - | yes |
| A55 | E15 | real-PR record lacks the clause "not a regression gate" (L396) | real-pr:254 — clause appended to sweep-real-pr-evidence.md | the AC17 statement must live in sweep-effect-evidence.md only; sweep-… | - | yes |
| A56 | E15 | real-PR record lacks the clause "deferred decision" (L396) | real-pr:254 — clause appended to sweep-real-pr-evidence.md | the AC17 statement must live in sweep-effect-evidence.md only; sweep-… | - | yes |
| A57 | E15 | real-PR record lacks the clause "pass/fail contract" (L396) | real-pr:254 — clause appended to sweep-real-pr-evidence.md | the AC17 statement must live in sweep-effect-evidence.md only; sweep-… | - | yes |
| A58 | E16 | states(EFFECT, "No recall target and no variance ceiling are defined for…") (L404) | effect:228 — needle to marker | "AC17's sibling requirement is that no recall target and no va…" | - | yes |
| A59 | E16 | effect record lacks the invented threshold "recall target of" (L415) | effect:742 — phrase appended to sweep-effect-evidence.md | the effect record must not invent a threshold: recall target of | - | yes |
| A60 | E16 | effect record lacks the invented threshold "target recall" (L415) | effect:742 — phrase appended to sweep-effect-evidence.md | the effect record must not invent a threshold: target recall | - | yes |
| A61 | E16 | effect record lacks the invented threshold "variance ceiling of" (L415) | effect:742 — phrase appended to sweep-effect-evidence.md | the effect record must not invent a threshold: variance ceiling of | - | yes |
| A62 | E16 | effect record lacks the invented threshold "must reach a recall" (L415) | effect:742 — phrase appended to sweep-effect-evidence.md | the effect record must not invent a threshold: must reach a recall | - | yes |
| A63 | H | section(): heading '## Adjudication outcomes' present (L27) | real-pr:69 — heading renamed so '## &lt;heading&gt;' no longer matches | document is missing the '## Adjudication outcomes' section | E7 | yes |
| A64 | H | section(): heading '## Terminal miss record' present (L27) | real-pr:114 — heading renamed so '## &lt;heading&gt;' no longer matches | document is missing the '## Terminal miss record' section | E8 | yes |
| A65 | H | section(): heading '## Evidence tiers' present (L27) | real-pr:148 — heading renamed so '## &lt;heading&gt;' no longer matches | document is missing the '## Evidence tiers' section | - | yes |
| A66 | H | section(): heading '## Transition rules' present (L27) | real-pr:159 — heading renamed so '## &lt;heading&gt;' no longer matches | document is missing the '## Transition rules' section | E11, E12 | yes |
| A67 | H | section(): heading '## No real-pull-request effect claim is made' present (L27) | real-pr:40 — heading renamed so '## &lt;heading&gt;' no longer matches | document is missing the '## No real-pull-request effect claim is made' section | - | yes |
| A68 | H | section(): heading '## Claim admissibility at the current tier' present (L27) | real-pr:227 — heading renamed so '## &lt;heading&gt;' no longer matches | document is missing the '## Claim admissibility at the current tier' section | - | yes |
| A69 | H | section(): heading '## Regression-gate status (AC17)' present (L27) | effect:703 — heading renamed so '## &lt;heading&gt;' no longer matches | document is missing the '## Regression-gate status (AC17)' section | - | yes |
| A70 | H | subsection(): heading '### Independence caveat' present (L35) | real-pr:52 — heading renamed so '### &lt;heading&gt;' no longer matches | document is missing the '### Independence caveat' subsection | - | yes |
| A71 | H | subsection(): heading '### Own-repository label' present (L35) | real-pr:60 — heading renamed so '### &lt;heading&gt;' no longer matches | document is missing the '### Own-repository label' subsection | - | yes |
| A72 | H | subsection(): heading '### Application record (in Adjudication outcomes)' present (L35) | real-pr:102 — heading renamed so '### &lt;heading&gt;' no longer matches | document is missing the '### Application record' subsection | - | yes |
| A73 | H | subsection(): heading '### Application record (in Terminal miss record)' present (L35) | real-pr:139 — heading renamed so '### &lt;heading&gt;' no longer matches | document is missing the '### Application record' subsection | - | yes |
| A74 | H | subsection(): heading '### The list-revision restart rule' present (L35) | real-pr:173 — heading renamed so '### &lt;heading&gt;' no longer matches | document is missing the '### The list-revision restart rule' subsection | - | yes |
| A75 | H | subsection(): heading '### The ten-count rule' present (L35) | real-pr:201 — heading renamed so '### &lt;heading&gt;' no longer matches | document is missing the '### The ten-count rule' subsection | - | yes |
| A76 | H | field(): row "Evidence tier" present (L45) | real-pr:22 — row's first cell renamed | the current-state table must carry a row for "Evidence tier" | - | yes |
| A77 | H | field(): "Evidence tier" value non-blank (L47) | real-pr:22 — value cell blanked | the current-state table: "Evidence tier" must carry a value | - | yes |
| A78 | H | field(): row "Counted pull requests under the current list version" present (L45) | real-pr:23 — row's first cell renamed | the current-state table must carry a row for "Counted pull requests under the c… | - | yes |
| A79 | H | field(): "Counted pull requests under the current list version" value non-blank (L47) | real-pr:23 — value cell blanked | the current-state table: "Counted pull requests under the current list version"… | - | yes |
| A80 | H | field(): row "Current category list version the count accrues under" present (L45) | real-pr:24 — row's first cell renamed | the current-state table must carry a row for "Current category list version the… | - | yes |
| A81 | H | field(): "Current category list version the count accrues under" value non-blank (L47) | real-pr:24 — value cell blanked | the current-state table: "Current category list version the count accrues under… | - | yes |

### Notes on Part A

- Rows A6 and A7 (the whole-document `states` for "Independence caveat" and
  "Own-repository label") cannot be isolated from the assertions that follow
  them in the same test: the needle is also the subsection heading, so
  removing it everywhere also removes the heading the next `subsection()`
  lookups need (A8, A9, A70, A71). The first assertion still fails with its
  own message before those are reached, so it is proved, but it is subsumed by
  the heading requirement rather than independent of it. Every other
  `states` plant is scoped to the section or subsection the assertion reads
  and trips nothing else in the file (checked by re-evaluating every other
  `states` call against the planted text).
- The `section()` and `subsection()` rows (A63 to A75) prove the shared
  helper's missing-heading assertion once per distinct heading. The "Also
  fails" column lists the other tests that call the same helper on the same
  heading: a heading rename cannot fail only one call site.
- A76 to A81 prove the `field()` lookups (row present, value non-blank) for
  each of the three current-state fields the tests read. A1 to A3 prove both
  halves of the tier check separately (the value must name `fixture_only`; it
  must not also name a real-PR tier) with different plants.
- A19 to A21 (a dropped row, a reordered pair, an extra row) prove the
  exact-rows-in-order assertion on the terminal-miss table from each
  direction.
- A55 to A57 and A59 to A62 prove the two "must not contain" loops one
  forbidden phrase at a time: the phrase is appended to the artifact and the
  assertion's own message names that phrase.

## Part B — `sweep-categories.test.ts` (committed list)

Test legend:

| Id | Test line | Test |
| --- | --- | --- |
| S1 | 157 | loadSweepList resolves the committed artifact from a non-root working directory |
| S2 | 334 | the recorded list holds exactly the five required categories |
| S3 | 341 | every required category carries its own count and classification vocabulary |
| S4 | 349 | the excluded set is exactly the bounded candidates, each with a non-empty rationale |
| S5 | 359 | the sub-themes below the candidate boundary are named with their counts |
| S6 | 366 | the list states its version, activation date, and counting unit |
| S7 | 372 | the list has exactly one current revision, which names its evidence and date |
| S8 | 381 | the current version is not reused across the revision history |

| Row | Test | Assertion (test line) | Plant (artifact:line) — change | Fail outcome (own message) | Also fails | Pass after restore |
| --- | --- | --- | --- | --- | --- | --- |
| B1 | S1 | committed list loads (ok === true) from a non-root cwd (L164) | categories.json:69 — guard-fails-open displayLabel blanked (loader rejects) | Expected values to be strictly equal: false !== true | - | yes |
| B2 | S1 | loaded list version is 'sweep-categories-v1' (L166) | categories.json:2 — top-level and revision versions both set to 'v2' | strictly-equal failed: + 'sweep-categories-v2' - 'sweep-categories-v1' | S6 | yes |
| B3 | S2 | category identifier set is exactly the five required (one renamed) (L335) | categories.json:68 — guard-fails-open identifier renamed | deep-equal failed: sorted identifier lists differ | - | yes |
| B4 | S2 | category identifier set is exactly the five required (sixth added) (L335) | categories.json:81 — sixth category object appended | deep-equal failed: sorted identifier lists differ | - | yes |
| B5 | S3 | findingInstanceCount is a positive integer (zero) (L343) | categories.json:73 — last category count set to 0 | falsy: assert.ok(Number.isInteger(category.findingInstanceCount) && c… | S1 | yes |
| B6 | S3 | findingInstanceCount is a positive integer (fractional) (L343) | categories.json:73 — last category count set to 5.5 | falsy: assert.ok(Number.isInteger(category.findingInstanceCount) && c… | S1 | yes |
| B7 | S3 | matchTerms is a non-empty array (empty array) (L344) | categories.json:74 — last category matchTerms set to &#91;&#93; | falsy: assert.ok(Array.isArray(category.matchTerms) && category.match… | S1 | yes |
| B8 | S3 | matchTerms is a non-empty array (a string) (L344) | categories.json:74 — last category matchTerms set to a string | falsy: assert.ok(Array.isArray(category.matchTerms) && category.match… | S1 | yes |
| B9 | S3 | every match term is lowercase (uppercase term) (L345) | categories.json:78 — term 'fails open' capitalised | falsy: assert.ok(category.matchTerms.every((term) =&gt; term === term.to… | - | yes |
| B10 | S3 | every match term is non-blank (blank term) (L345) | categories.json:78 — term 'fails open' replaced by whitespace | falsy: assert.ok(category.matchTerms.every((term) =&gt; term === term.to… | S1 | yes |
| B11 | S4 | excluded identifier set is exactly the seven required (one renamed) (L350) | categories.json:114 — per-finding-resolution identifier renamed | deep-equal failed: sorted identifier lists differ | - | yes |
| B12 | S4 | every excluded candidate has a non-empty rationale (L355) | categories.json:116 — rationale set to whitespace | per-finding-resolution has no rationale | - | yes |
| B13 | S5 | belowBoundarySubThemes is non-empty (L360) | categories.json:119 — array emptied | falsy: assert.ok(RECORDED.belowBoundarySubThemes.length &gt; 0) | - | yes |
| B14 | S5 | each sub-theme count is a positive integer (zero) (L362) | categories.json:122 — excerpt-sequence-boundaries count set to 0 | falsy: assert.ok(Number.isInteger(theme.findingInstanceCount) && them… | - | yes |
| B15 | S5 | each sub-theme count is a positive integer (fractional) (L362) | categories.json:122 — excerpt-sequence-boundaries count set to 4.5 | falsy: assert.ok(Number.isInteger(theme.findingInstanceCount) && them… | - | yes |
| B16 | S6 | version is 'sweep-categories-v1' (L367) | categories.json:2 — top-level and revision versions both set to 'v2' | strictly-equal failed: + 'sweep-categories-v2' - 'sweep-categories-v1' | S1 | yes |
| B17 | S6 | activatedOn is '2026-09-27' (L368) | categories.json:3 — activatedOn and revision date both set to 2026-09-28 | strictly-equal failed: + '2026-09-28' - '2026-09-27' | - | yes |
| B18 | S6 | countingUnit is 'finding instances, not distinct defects' (L369) | categories.json:4 — countingUnit reworded | strictly-equal failed: + 'distinct defects' - 'finding instances, not… | - | yes |
| B19 | S7 | revisionHistory has exactly one entry (L373) | categories.json:165 — second revision entry (distinct version) appended | Expected values to be strictly equal: 2 !== 1 | - | yes |
| B20 | S7 | revision version equals the list version (L375) | categories.json:159 — revision entry's version set to 'v0' | strictly-equal failed: + 'sweep-categories-v0' - 'sweep-categories-v1' | - | yes |
| B21 | S7 | revision date equals activatedOn (L376) | categories.json:160 — revision entry's date set to 2026-09-26 | strictly-equal failed: + '2026-09-26' - '2026-09-27' | - | yes |
| B22 | S7 | revision motivatingEvidence is non-blank (L377) | categories.json:161 — motivatingEvidence set to whitespace | notEqual failed: '' | - | yes |
| B23 | S7 | revision priorVersion is null (L378) | categories.json:162 — priorVersion set to a string | strictly-equal failed: + 'sweep-categories-v0' - null | - | yes |
| B24 | S8 | revision versions are unique (L383) | categories.json:165 — second revision entry reusing 'sweep-categories-v1' appended | Expected values to be strictly equal: 1 !== 2 | S7 | yes |

### Notes on Part B

- The loader test S1 and the recorded-list tests S2 to S8 read the same file,
  and the product loader also validates most of what S3 checks. Plants that
  break the file for the loader too (B5 to B8, B10, and the version plant in
  B16) therefore also fail S1's `ok === true` assertion. That is the loader
  test doing its job on the same artifact, not a masked plant: each row's own
  assertion still fails with its own message at its own line. Rows with
  no "Also fails" entry (B9, for example, an uppercase term the loader
  tolerates) are plants only the assertion under test rejects; B1 targets the
  loader test S1 itself.
- B2 and B16 assert the same literal (`sweep-categories-v1`) through two
  different paths (the loader result, and the parsed file), so they cannot be
  told apart by any plant: each fails together with the other (B2 lists S6,
  B16 lists S1). The version plant edits the top-level version and the
  revision entry's version together, so S7's `revision.version ===
  RECORDED.version` check stays green and does not confound the row. B17 does
  the same with `activatedOn` and the revision date.
- B24 (versions are not reused) cannot be isolated from B19 (exactly one
  revision entry): any duplicate version needs a second entry, which also
  makes the length two. B24's own assertion fails with its own message, so it
  is proved, but it is redundant while the length rule holds; B19 uses a
  second entry with a different version so it fails alone.
- The per-item loops (S3 over categories, S4 over exclusions, S5 over
  sub-themes) are proved by planting in one item: the last category for S3,
  `per-finding-resolution` for the S4 rationale, and
  `excerpt-sequence-boundaries` for S5. Any item fails the same assertion, so
  the same plant on another item would give the same row.
- The two set assertions (B3, B4, B11) are exact-set checks. The category
  set is proved from both directions (one identifier renamed; a sixth
  category added); the excluded set is proved by one rename.

## Totals

- `evidence-records.test.ts`: 81 rows (47 `states` calls, 19 lookup-helper rows,
  15 table, value, count, and "must not contain" rows).
- `sweep-categories.test.ts` (committed list): 24 rows.
- Every row: own message at own assertion line, restored byte for byte
  (SHA-256 equal), whole file passing again. No in-scope assertion is
  unproved. Two are subsumed rather than independent (A6 and A7 by their
  heading lookups; B24 by B19), and the note under each says so.
