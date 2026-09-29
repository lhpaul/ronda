# Smoke Test Runbook: Category-Forced Review Sweep

**Feature**: Category-forced review sweep, scoped on real-PR evidence
**Spec**: [`../../specs/developments/20260925143028_105-category-forced-review-sweep/1_105-category-forced-review-sweep_specs.md`](../../specs/developments/20260925143028_105-category-forced-review-sweep/1_105-category-forced-review-sweep_specs.md)
**Implementation plan**: [`../../specs/developments/20260925143028_105-category-forced-review-sweep/2_105-category-forced-review-sweep_implementation-plan.md`](../../specs/developments/20260925143028_105-category-forced-review-sweep/2_105-category-forced-review-sweep_implementation-plan.md)
**Created in**: Plan Ready stage

> No design assets. Ronda has no user interface, issue #105 has no design asset
> section, and the development folder has no `assets/` directory.

---

## Prerequisites

Before running this smoke test:

- [ ] The implementation branch for issue #105 is checked out.
- [ ] `npm ci` has been run at the repository root.
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` pass locally.
- [ ] For the real-model campaign (Steps 8–10): a model credential is available
      through `RONDA_MODEL_API_KEY` or the local operator config file, and the
      model version is recorded immutably with the results.
- [ ] No model credential or raw sensitive value is committed; new fixture
      seeds use non-functional credential-shaped data only.

---

## Test Data

| Item | Value |
| --- | --- |
| Recorded sweep category list | `docs/testing/ronda/sweep-categories.json` (`sweep-categories-v1`) |
| Seeded benchmark fixture | `tests/fixtures/recall-benchmark/` (13 original + 5 new seeds) |
| Original-fixture control | `tests/fixtures/recall-benchmark/original-thirteen/` (the pre-extension `manifest.json` + `patches.json`, 13 seeds) |
| Precision fixture | `harmless-session-refactor` (expected clean) |
| Cost baseline for comparison | `docs/testing/ronda/cost-convergence-baseline-2026-09-23.md` |
| Enablement knob | `RONDA_SWEEP_MODE` env var / `sweep_mode` workflow input / `sweepMode` config key |

---

## Smoke Test Steps

### Step 1: Sweep off reproduces non-sweep behavior

**Maps to**: Acceptance Criterion 18

1. Run a review pass (fixture-response mode or a real smoke PR) with
   `RONDA_SWEEP_MODE` unset.
2. Inspect the review body, check-run output, and logs.

**Expected result**: No sweep statement in the summary, no per-category record,
no list read, indistinguishable from the same pass before this feature.

### Step 2: Sweep enabled — record on both surfaces

**Maps to**: Acceptance Criteria 1, 3, 20

1. Run a review pass with `RONDA_SWEEP_MODE=on` against a fixture that produces
   findings.
2. Inspect the review summary, the check-run output, and the logs.

**Expected result**: The review summary states the sweep was active and the
list version `sweep-categories-v1` — and nothing else about categories. The
check-run output and the logs each carry the per-category record: every
category on the list with `produced_findings` or `produced_none`, every
published finding with the categories it was recorded against (or
`uncategorized`), plus the uncategorized finding count. No per-category section
appears in the review body. One review published, one check run, no push/merge.

**Also verify the degraded records reach the same surfaces** (Steps 3 and 4
below): a completing pass whose enablement value was unrecognized, or whose
list failed validation, publishes its ordinary non-sweep review and carries its
degraded record — the unrecognized-enablement statement, or
`sweep-did-not-run` with the reason and no list version — in the **successful
review check run** as well as the logs. Neither appears in the review body.

### Step 3: Enablement vocabulary and precedence

**Maps to**: Acceptance Criterion 18

1. Run passes with `RONDA_SWEEP_MODE` set to `on`, `1`, `TRUE`, `off`, `0`,
   `default`, `  ` (whitespace), and `banana` (unrecognized).
2. For the unrecognized case, inspect the logs and check-run output.

**Expected result**: `on`/`1`/`TRUE` run the sweep; `off`/`0`/`default`,
absent, and whitespace-only run the ordinary review with no record; `banana`
runs the ordinary review and records that the enablement value was
unrecognized — without the raw value appearing anywhere, on the logs **and the
successful review check run**. An unrecognized non-empty value at a
higher-precedence source is not replaced by a recognized lower-precedence
value (spot-check env over config file).

### Step 4: Malformed category list degrades

**Maps to**: Acceptance Criteria 2, 19

There is no operator-facing list path to repoint — production loading is fixed
to the repository artifact, and the plan adds no config key for it. The seam is
the loader's test-only `path` option, so this step is a targeted automated
test rather than a manual repoint:

1. Run the loader/validator suite, which injects each malformed shape through
   `loadSweepList({ path })` against a temporary copy written outside the repo
   (never committed):

   ```bash
   npx tsx --test tests/unit/review/sweep-categories.test.ts
   ```

   Every variant AC19 names must return `{ ok: false, reason }` — unreadable
   file, non-JSON, missing/blank version, no categories, a blank field, a zero
   or non-integer count, missing/empty/non-string `matchTerms`, duplicate
   identifiers.

2. Run the pass-orchestration suite, which drives the AC19 branch end to end
   through the same seam:

   ```bash
   npx tsx --test tests/unit/core/run-review-pass.test.ts
   ```

   Assert on the degrade path: with a malformed list and `sweepMode: "on"`, the
   pass produces the ordinary non-sweep review and check run, emits
   `sweep-did-not-run` with the reason and no list version, and neither throws
   nor skips publication. Also assert the boundary: the same malformed list
   with a failure raised **after** the failed load but **before** the review
   request (drive the authoritative-document fetch to throw) emits no
   `sweep-did-not-run` and no sweep metadata on any surface — the invalid-list
   record is held pending exactly as the unrecognized-enablement record is, and
   released only once the request is issued.

**Expected result**: Both suites pass. Every malformed variant is rejected
without throwing, and the pass-level test shows the sweep degrading to a
complete, publishable non-sweep review with `sweep-did-not-run` logged **and
carried on the successful check-run output** (reason shown, no list version),
while the pre-request failure of the same malformed list carries none of it.

### Step 5: Passes that end before the review request emit no sweep metadata

**Maps to**: Acceptance Criterion 1

1. Trigger an automatic pass on a draft pull request.
2. Trigger an automatic pass on a head whose check run already exists.
3. Run a sweep-enabled pass that fails **after the changed files are read but
   before the review request is issued** — an authoritative-document fetch that
   raises a GitHub error is the natural fixture, since that fetch sits between
   `readChangedFiles` and `deps.model.complete`. A missing model credential or a
   config load error exercises the same rule one stage earlier.

**Expected result**: All three are indistinguishable from the same outcome in a
non-sweep run — no per-category record, no activation statement, no
sweep metadata of any kind, and for case 3 no `sweep-did-not-run` record either.
AC1 draws the boundary at the review request the pass issued, not at the
changed-files read: a pass that dies between the two reached no category, so a
degraded record there would report a sweep consideration the spec says does not
exist. The existing skip and failure paths govern these passes unchanged.

### Step 6: Terminal failure after the review request records not-determined

**Maps to**: Acceptance Criterion 1

1. Run a sweep-enabled pass against a fixture whose model call fails after the
   review request is issued — an invalid credential rejected by the model API is
   the natural fixture, since the request reaches the model before the rejection.
   The boundary is the issued request, not the changed-files read: a failure
   between the two belongs to Step 5 and owes no record at all.
2. Inspect the logs and the check run.

**Expected result**: The failure check run's outcome is a failure (not a
review), so the per-category record is on the logs only, with every category
the pass's request carried recorded as `not_determined`. No category the pass
did not reach appears, and no second review is published.

This step covers the failure that precedes the review becoming public. Where a
failure lands **after** publication (`reviewPublished` guard, or the
post-publication check-run write), the record instead carries the ordinary
`produced_findings`/`produced_none` outcomes — the pass did classify — on the
logs plus whatever per-category surface that write produced. The unit suite
asserts both cases; this step exercises the pre-publication one directly.

### Step 7: New fixture seeds present and matched

**Maps to**: Acceptance Criteria 12, 13, 14

1. Inspect `tests/fixtures/recall-benchmark/manifest.json`.
2. Confirm seeds exist for state reconstruction from API evidence, external
   output parsing, guard fails open, record identity, and at least one harder
   credential-pattern case whose `harderThan` metadata names which of AC13's
   four ways it differs by and the canonical baseline form.
3. Run the benchmark in fixture-response mode with a response covering the new
   seeds.

**Expected result**: Every new seed is classified (found or missed, never
invisible), the clean precision fixture stays clean, and no real credential
value appears in any fixture or output.

### Step 8: Recall and variance campaign

**Maps to**: Acceptance Criterion 8

1. Run the benchmark at least 5 times with the sweep off and at least 5 times
   with the sweep on, against the same target, immutable model version, and
   configuration apart from the sweep setting, on the extended fixture. Each
   configuration is one command, writing its own file:

   ```bash
   set -euo pipefail
   npx tsx src/cli/recall-benchmark.ts --sweep-mode off --runs 5 \
     --version-attestation "<the recorded basis>" \
     --output-file docs/testing/ronda/sweep-off-extended.json
   npx tsx src/cli/recall-benchmark.ts --sweep-mode on --runs 5 \
     --version-attestation "<the recorded basis>" \
     --output-file docs/testing/ronda/sweep-on-extended.json
   ```

   Pass the **same** `--version-attestation` value on both arms, and on every
   later leg: the attestation is part of the `configuration` block, so an
   attestation present on one arm and absent on the other makes the pair differ
   in a second field and its comparison inadmissible. Omitting it leaves the
   version unattested at write time, which is the inconclusive case — it cannot
   be repaired afterwards by editing the file.

   The `set -euo pipefail` line is required, not decorative: each block writes
   committed evidence files, so without it a failing arm would be masked by the
   second arm succeeding, and the campaign would be recorded as complete while
   one configuration's evidence is absent or truncated. `-e` is the part that
   carries the guard for these literal command lines: the runner already exits
   non-zero when any run of a campaign is recorded as a failure (its
   record-and-continue policy writes the array, failure records included, before
   exiting), so `-e` is what makes that non-zero exit **halt the block** — the
   second arm does not run, the operator sees the stop, and the partial file that
   is already on disk is read as partial rather than passed over by a succeeding
   command. `-u` is the operator's safeguard when they substitute a shell
   variable for the attestation basis — the quoted placeholder above is literal
   text and is passed through as written, so `-u` bites only on a block the
   operator has parameterized, where it stops an unset basis rather than writing
   an unattested file.

2. Repeat the same paired runs against the committed pre-extension snapshot
   (original-thirteen subset control) — `--manifest` and `--patches` point at
   `tests/fixtures/recall-benchmark/original-thirteen/`, created in
   implementation step 10 by copying `manifest.json` and `patches.json` before
   the five new seeds were added — each configuration writing its own file:

   ```bash
   set -euo pipefail
   npx tsx src/cli/recall-benchmark.ts --sweep-mode off --runs 5 \
     --version-attestation "<the recorded basis>" \
     --manifest tests/fixtures/recall-benchmark/original-thirteen/manifest.json \
     --patches tests/fixtures/recall-benchmark/original-thirteen/patches.json \
     --output-file docs/testing/ronda/sweep-off-original-thirteen.json
   npx tsx src/cli/recall-benchmark.ts --sweep-mode on --runs 5 \
     --version-attestation "<the recorded basis>" \
     --manifest tests/fixtures/recall-benchmark/original-thirteen/manifest.json \
     --patches tests/fixtures/recall-benchmark/original-thirteen/patches.json \
     --output-file docs/testing/ronda/sweep-on-original-thirteen.json
   ```
3. Record everything in `docs/testing/ronda/sweep-effect-evidence.md`, assembled
   from those output files — no run is hand-transcribed.

Each run record carries `fixture` (resolved manifest path, `benchmarkId`, seed
count, manifest and patch content hashes) and `configuration` (effective
`sweepMode`, each inference request's own provider-reported model identity
alongside the configured model name, the version-attestation basis, config
values, prompt fingerprint) blocks. A `--runs 5` file holds an **array** of five
such records, one per run; a single-run invocation holds one summary object
instead, so an existing consumer of the single-run summary still reads it
unchanged.
If a run fails mid-campaign, its array position holds a **failure record**
instead of a run record: it carries the same `runIndex` and `fixture` /
`configuration` blocks but a `failure` block (`reason`, redacted message,
whether it was the pass deadline that aborted it) in place of every recall,
per-category, and cost field, and the campaign keeps running so the array still
holds one entry per attempted run. The command exits non-zero when any run
failed, so check the exit code before reading a file as a clean campaign — a
file whose entries all carry recall fields is a complete campaign; a file with
any `failure` entry is partial evidence and is recorded as such, never dropped.
Confirm before writing the evidence doc: the sweep-off and sweep-on files for a
given leg have **equal** `fixture` blocks and `configuration` blocks differing
only in `sweepMode` — that is what proves the arms differ only by the sweep
setting. The original-thirteen files share the extended fixture's `benchmarkId`
(the snapshot is a byte-identical copy) but must differ by path and content
hash; if they do not, the control ran against the wrong inputs. On the model
identity: read each request's own reported value from the record, never the
configured alias and never a single value carried over from another request —
the alias is mutable, and the precision fixtures run concurrently, so a
shared-client "last response" value can belong to a different fixture. A block
that restates the alias, omits the field, or shows differing reported values
across the run set is the case this check exists to catch: record it as
**unattested**, and report the comparison as inconclusive — the run set then
supports no same-configuration claim, so do not write one. Verify the
version-attestation basis is recorded alongside it: the reported identity is
evidence of what the endpoint returned, not proof it is immutable, so the
comparison is admissible only when the operator has recorded that the endpoint
pins a frozen model artifact and every request's reported value matches it.

**Expected result**: The evidence records per-run recall, lowest and highest
recall, the population-standard-deviation of per-run recall, per-defect
found/missed counts, sample count, immutable model version, reviewed target,
run timestamps, and fixture version **and effective review configuration read
from the runs' own identity blocks** for both configurations; the paired arms
are shown to differ only by `sweepMode`; the model version read from the blocks
is each request's own provider-reported one — never the configured alias and
never a single value carried across requests — with the unavailable,
alias-restating, or run-set-inconsistent case recorded as unattested rather
than backfilled, and the version-attestation basis recorded next to it, so a
run set without one is reported as an inconclusive comparison carrying no
same-configuration claim; the
original-thirteen subset is read from each extended run record's
`originalThirteenSubset` block — the subset inside every extended-fixture run,
reported per run and separately from the standalone original-thirteen control —
and is
shown to have run against its own inputs; the
historical 2026-09-10 baseline is labeled non-comparable with no figure read
against it; the record states no recall target and no variance ceiling are
defined; and the record carries **AC17's regression-gate statement** — that the
seeded benchmark is not a regression gate until the AC12/AC13 seeds exist, that
the operator may declare the extended fixture ready to serve as a gate basis
once they do with the declaration recorded (Use Case 5), and that what a
restored gate rejects is a deferred decision, so the declaration makes no
benchmark result pass or fail. `sweep-effect-evidence.md` is this statement's
single authoritative home; `sweep-real-pr-evidence.md` (Step 12) does not also
carry it.

### Step 9: Precision campaign

**Maps to**: Acceptance Criteria 9, 10

1. Run the precision fixtures the same number of times as the recall runs,
   sweep off and sweep on, under the same effective review configuration and
   the same real model — the same commands as Step 8 plus `--quality`, each
   writing its own file:

   ```bash
   set -euo pipefail
   npx tsx src/cli/recall-benchmark.ts --sweep-mode off --runs 5 --quality \
     --version-attestation "<the recorded basis>" \
     --output-file docs/testing/ronda/sweep-off-precision.json
   npx tsx src/cli/recall-benchmark.ts --sweep-mode on --runs 5 --quality \
     --version-attestation "<the recorded basis>" \
     --output-file docs/testing/ronda/sweep-on-precision.json
   ```

   Do **not** pass `--precision-response-file`: that option is a fixture-only
   shortcut that feeds a canned response straight to the classifier and never
   calls the model, so a run using it measures nothing about precision under
   the recorded model and configuration. The precision campaign must run
   inference, which is what `--quality` alone does with the model credential
   already required by the Prerequisites.

2. Read the unexpected-finding counts and per-fixture clean status.

**Expected result**: Sweep-on unexpected findings are attributed to their
category (or categories, or uncategorized) from the per-category record;
sweep-off findings are unattributed; the strict no-tolerance regression test
result is stated with the counts that decided it; the evidence records the
category-list version — read from `sweepListVersion` on each sweep-on run
record, the same version the pass recorded for AC3 — and the effective review
configuration used.

### Step 10: Cost campaign

**Maps to**: Acceptance Criterion 11

1. Read the model-calls-per-pass and elapsed-time-per-pass figures the
   benchmark output recorded for both configurations in Steps 8–9.
2. Place them against the per-PR convergence figures in
   `docs/testing/ronda/cost-convergence-baseline-2026-09-23.md`.

**Expected result**: Both configurations' figures are recorded, the
comparative claim (if made) uses the paired-by-run-position averaged
differences, and the record states no cost ceiling applies.

### Step 11: Recorded category list is operator-readable

**Maps to**: Acceptance Criteria 4, 5, 6, 7

1. Open `docs/testing/ronda/sweep-categories.json`.
2. Read, for each category, its identifier, display label, description,
   failure shape, evidence source, finding-instance count, and the
   `matchTerms` array the deterministic classifier matches against.
3. Read the excluded candidates, the sub-themes below the candidate boundary,
   the version, activation date, and revision history.

**Expected result**: Every field is stated (none inferred from another's
text); the counting-unit statement (finding instances, not distinct defects)
is present; every candidate is either swept or excluded with a rationale;
exactly one current version `sweep-categories-v1` activated 2026-09-27 with
one initial revision-history entry.

### Step 12: Real-PR evidence record is at the honest tier

**Maps to**: Acceptance Criteria 15, 16

1. Open `docs/testing/ronda/sweep-real-pr-evidence.md`.
2. Read the tier label, counted-pull-request total, and the caveats.

**Expected result**: The tier is `fixture_only` with zero counted pull
requests at ship time; the own-repository label and independence caveat are
present; no real-PR effect claim appears. The record's transition rules also
state the **list-revision restart**: a revision restarts the counted
pull-request total at zero while the tier follows its own rule — unchanged at
`fixture_only` and `real_pr_provisional`, demoted to `real_pr_provisional`
from `real_pr_measured` — with the count written against the new list version
and the prior version's count kept as the prior version's evidence rather than
carried forward.

### Last Step: Validate & Shut Down

- Verify every assertion in the checklist below is met.
- Record the campaign results (Steps 8–10) in the committed evidence doc.

---

## Assertions Checklist

Each checkbox maps to an acceptance criterion from the spec.

- [x] AC1: every sweep pass reaching review execution records per-category
      outcomes on the AC1-assigned surfaces; a degraded pass records
      `sweep-did-not-run` or the unrecognized-enablement record on the same
      surfaces (the successful review check run and the logs); skips and
      failures before the review request is issued emit nothing; terminal
      failures after the request record `not_determined` on the logs only; no
      record in the review body.
- [x] AC2: one review per head SHA, no PR mutation, unchanged draft-skip and
      supersede behavior with the sweep enabled.
- [x] AC3: review summary states sweep activation and list version; non-sweep
      passes say neither.
- [x] AC4/AC5/AC6/AC7: recorded list fields, counting unit, complete candidate
      accounting, single current version, revision history.
- [ ] AC8: committed recall/variance evidence with per-run figures, spread,
      standard deviation, non-comparable baseline label, sample count ≥ 5.
      **Not met.** The figures are committed on the dated provider snapshot
      `qwen-plus-2025-12-01`, but AC8 requires both arms to share an immutable
      model version, and the operator's recorded basis says the snapshot's
      frozen status rests on the provider's naming and is not independently
      verified. Open until the endpoint's pin is attested.
- [ ] AC9: paired precision evidence with category attribution for sweep-on
      and the strict regression result. **Not met**, for the same reason as
      AC8. The strict result is computed as NOT REGRESSED and reported as inconclusive (0 unexpected findings
      on both arms, `harmless-session-refactor` clean in 5 of 5 runs each), but
      it is not a same-configuration comparison.
- [x] AC10: no manufactured finding per category; clean pass stays clean.
- [x] AC11: model calls and elapsed time per pass for both configurations,
      compared against the recorded per-PR figures.
- [x] AC12/AC13: fixture seeds for the four real themes and the harder
      credential-pattern case with `harderThan` metadata.
- [x] AC14: no real or usable credential value in any evidence or fixture.
- [x] AC15/AC16: evidence tier labeled honestly at `fixture_only`; no real-PR
      effect claim; own-repository caveat present.
- [x] AC17: documentation states the regression-gate status and the deferred
      gate contract.
- [x] AC18: enablement matrix behaves exactly as the spec's gate table states,
      including the unrecognized-value record without the raw value.
- [x] AC19: malformed or missing list degrades to a non-sweep review without
      failing the pass or suppressing publication.
- [x] AC20: every published finding appears in the per-category record against
      one or more categories or as uncategorized.

---

## Seed Data Reference

The following seed data must be present:

| Entity | Scenario | How to load |
| --- | --- | --- |
| Sweep category list | `sweep-categories-v1`, five categories | Committed at `docs/testing/ronda/sweep-categories.json` |
| Extended benchmark fixture | 13 original + 5 new seeded defects | Committed at `tests/fixtures/recall-benchmark/manifest.json` and `patches.json` |
| Precision fixture | `harmless-session-refactor`, expected clean | Same manifest |
| Malformed list variant | One malformed copy for Step 4 | Injected by the unit suites through the `loadSweepList({ path })` test seam, from a temporary copy outside the repo; never committed |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Sweep never runs with `RONDA_SWEEP_MODE` set | The effective value resolved to a recognized off value, or the value was unrecognized (recorded in the logs) | Check the logs' unrecognized-enablement record; use a recognized on/off value. Note an empty or whitespace-only value at a higher-precedence source is **not** a cause: AC18 defers it to the next non-empty source, so the sweep still runs when that source resolves to `on` |
| `sweep-did-not-run` in logs with a valid-looking list | The list fails AC19 validation (duplicate identifier, blank field, zero count) | Read the logged reason and fix the list file |
| Per-category record on logs but not the check run | The pass's check-run write produced no review-outcome check run (failure or superseded path) | Expected AC1 behavior — not a bug |
| Campaign runs fail mid-way | Model outage or rate limiting | Keep the emitted file: the failed run left a **failure record** at its array position (with its `failure.reason` and redacted message) and the other runs are intact, so the campaign is partial, not lost. Record the partial results with timestamps and the failure reason in the evidence doc; never silently drop attempted runs from the evidence. If the comparison needs a complete set, **re-run the whole campaign leg** with the same command — the driver exposes `--runs` and `--output-file` only, with no run-index, resume, append, or merge operation, so there is no supported way to re-run individual positions and hand-combining outputs would break run-position pairing. Write the new file to a distinct path and keep the partial one alongside it |

---

## Known Limitations

- Steps 8–10 need a real model credential and are operator-run; their results
  are committed evidence, not CI.
- The model identity is a provider-published dated snapshot
  (`qwen-plus-2025-12-01`), reported identically on every request. Its frozen
  status is not independently verified: the recorded attestation says it rests
  on the provider's dated-snapshot naming, and no provider-signed attestation
  or artifact hash exists. No same-configuration claim is made, and AC8 and AC9
  stay open on that point.
- The campaign is 5 runs per arm. It observed seed-level movements (notably
  `guard-fails-open`, 0 of 10 sweep-off runs against 9 of 10 sweep-on), not attributed
  effects, and no consistent overall recall, variance, or elapsed-time
  difference; it cannot rule small effects in or out, and recall figures count
  only findings the lexical matcher credits (the `sensitive-value-exposure`
  sweep-on misses and most `credential-pattern-gap-camel` misses coincide with same-file
  unmatched findings).
- The six campaign legs appear to have run concurrently (first records within
  4 ms), so the elapsed-time figures were likely taken under shared load.
- This campaign replaces an earlier set that pinned the fixture before the
  `credential-pattern-gap-camel` patch was rewritten; in that set the seed's defect was not in
  its patch and the seed was found in 0 of the 20 runs that contain it. The
  earlier set is superseded and none of its figures is used.
- The real-PR tier (Step 12) cannot complete at implementation time by
  design — the ten-PR count accumulates over time; the record exists to keep
  the tier honest, not to promote it.

---

## Sign-off

Executed 2026-09-29 against the feature, not against the evidence pull request
that carries this runbook. Tested commit: `0542d9e474b74b58dc865ef3902ac9a408196498`
on `feature/105-category-forced-review-sweep` (#118). Steps 1-7 and 11-12 are
deterministic and were re-run at that commit; the suite counts and the
fixture-response figures below are that commit's. Steps 8-10 need a real model
credential and were recorded as committed evidence: the six `sweep-*.json`
campaign files beside this runbook, 30 runs (5 per file) on the pinned provider
snapshot `qwen-plus-2025-12-01`, run on 2026-09-29 between 2026-09-29T08:39:24.382Z and
2026-09-29T08:40:32.497Z. Their driver was `0542d9e`, the tested commit itself, so the
executable source, fixtures, and category list the campaign ran are the tested
commit's, and the `fixture` blocks in the records carry the manifest and patch
hashes of that commit's fixtures. These records replace an earlier set recorded
against the fixture before the `credential-pattern-gap-camel` patch was rewritten; that set is
superseded.

The evidence pull request (the follow-up to the earlier evidence pull request that re-records the campaign)
ships documents and data only, so its own head has nothing for these steps to
execute. This sign-off attests the tested commit above; it is not current-head
evidence for the evidence pull request, and a change to the feature after that
commit needs the deterministic steps re-run and this line updated.

| Step | Result (Pass/Fail/Skip) | Notes |
| --- | --- | --- |
| 1 | Pass | Sweep off reproduces non-sweep behavior; `tests/unit/core/run-review-pass.test.ts` 42 pass / 0 fail. |
| 2 | Pass | Sweep enabled records per-category outcomes on both AC1 surfaces; same suite, 42 / 0. |
| 3 | Pass | Enablement vocabulary and precedence, including the unrecognized value recorded without the raw value; same suite, 42 / 0. |
| 4 | Pass | Malformed list degrades to a non-sweep review without failing the pass; `tests/unit/review/sweep-categories.test.ts` 25 pass / 0 fail, plus the degradation arms of `run-review-pass`. |
| 5 | Pass | Passes ending before the review request emit no sweep metadata; `run-review-pass` 42 / 0. |
| 6 | Pass | Terminal failure after the review request records `not_determined` on the logs only; `run-review-pass` 42 / 0. |
| 7 | Pass | Extended fixture is 18 seeds; the fixture-response run (`--response-file tests/fixtures/recall-benchmark/model-responses/passing.json --quality --precision-response-file tests/fixtures/recall-benchmark/model-responses/precision-clean.json`) at `0542d9e` reports `totalSeededDefects: 18`, found 17, missed 1 (`invalid-range-parsing`), false positives 0 - every seed found or missed, none invisible, and the five new seeds are all classified (the rewritten `credential-pattern-gap-camel` patch leaves the fixture-response figures unchanged). Clean precision fixture `harmless-session-refactor` stays clean (`clean: true`, 0 false positives). Credential scan: the repository's executable scan (`scanForCredentials`, run by the recall-benchmark tests `committed benchmark fixtures carry no real credential values` and `committed sweep evidence artifacts carry no real credential values`) passes at `0542d9e` over the fixture tree and the nine committed sweep evidence artifacts, which include the six campaign records and both evidence documents: no hit outside the non-functional canary allowlist. |
| 8 | Incomplete | Both arms 5 / 5 runs on every leg, zero failure records. Recall off-extended 0.444-0.556 / pop-SD 0.0416, on-extended 0.389-0.611 / pop-SD 0.0903; original-thirteen control off 0.615-0.846 / pop-SD 0.0923, on 0.538-0.692 / pop-SD 0.0688. Paired arms differ only by `sweepMode`; `fixture` blocks equal across arms. All 40 requests report `qwen-plus-2025-12-01`, one identical attestation on all 30 records ("frozen-artifact status rests on the provider's dated-snapshot naming and is not independently verified"). The pairing is not admissible as a same-configuration comparison: frozen status is not independently verified, so AC8 is not met. Result: inconclusive, with no consistent recall or variance difference observed (mean recall difference sweep on minus sweep off −0.011111 extended and −0.046154 control, per-run ranges overlapping; 5 runs cannot resolve small effects); the largest seed-level movement observed is `guard-fails-open` 0 of 10 sweep-off against 9 of 10 sweep-on, and the harder credential seed `credential-pattern-gap-camel` 2 of 10 against 6 of 10, both of which model drift between the arms could explain. |
| 9 | Incomplete | Both precision arms 5 / 5 runs, zero failure records. Every run: `harmless-session-refactor` clean, `falsePositiveCount` 0; sweep-on runs record `sweepListVersion: sweep-categories-v1`. Strict no-tolerance test: clause 1 (total unexpected findings) sweep-on 0 against sweep-off 0, not `>`, does not fire; clause 2 (fixture clean in every sweep-off run but not in every sweep-on run) 5 of 5 against 5 of 5, does not fire. Result computed as NOT REGRESSED and reported as inconclusive: the arms carry no same-configuration claim (same basis as Step 8), so AC9 is not met. The recall pass's own false positives (sweep-off 9, sweep-on 4 on the precision legs) are a different field and do not enter the test. |
| 10 | Pass | Model calls per pass 1 (recall legs) and 2 (precision legs), identical on both configurations (paired difference 0). Elapsed mean per pass, sweep off / sweep on: extended 16.9 s / 16.0 s, original-thirteen 14.6 s / 13.4 s, precision 16.1 s / 15.9 s (paired means −948.6, −1177.2, −221.6 ms, each smaller than the spread of its own paired differences: no consistent elapsed difference, inconclusive; the six legs appear to have run concurrently, first records within 4 ms, so figures are likely under shared load). The recorded cost baseline holds no Ronda pass cost, so there is no baseline figure to compare against. No cost ceiling stated. |
| 11 | Pass | `sweep-categories.json` carries all seven fields per category, the counting-unit statement (finding instances, not distinct defects), 7 excluded candidates with rationale, 7 below-boundary sub-themes, one current version `sweep-categories-v1` activated 2026-09-27 with one initial revision-history entry. |
| 12 | Pass | Tier `fixture_only`, counted pull requests `0`, list version `sweep-categories-v1`; independence caveat, own-repository label, adjudication and terminal-miss code values, and all transition rules present. `tests/unit/testing/evidence-records.test.ts` 16 pass / 0 fail. AC15's real-PR tier is deferred by construction. |

**Result: NOT SIGNED OFF.** Steps 1-7 and 10-12 pass; none failed or was
skipped. Steps 8 and 9 ran to completion and their records are committed, but
they are recorded as incomplete: AC8 and AC9 require the two arms to share an
immutable model version. Every request in the campaign reports the same dated
provider snapshot `qwen-plus-2025-12-01` and the arms differ only in
`sweepMode`, but the operator's recorded basis says the snapshot's frozen status
rests on the provider's naming and is not independently verified, and the
runbook admits the comparison only when the operator has recorded that the
endpoint pins a frozen artifact. AC8 and AC9 stay open until an operator or
provider attestation of that pin is recorded. Until then every between-arm
comparison is inconclusive: the campaign observed no consistent difference in
overall recall, spread, or elapsed time, seed-level movements (notably
`guard-fails-open`) that model drift between the arms could explain, and a
strict precision test that computes as NOT REGRESSED (0 against 0 unexpected
findings). None of it is a claimed effect or benefit.
