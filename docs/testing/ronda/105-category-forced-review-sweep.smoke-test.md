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
category on the list with `produced_findings` or `produced_none`, plus the
uncategorized finding count. No per-category section appears in the review
body. One review published, one check run, no push/merge.

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
   nor skips publication.

**Expected result**: Both suites pass. Every malformed variant is rejected
without throwing, and the pass-level test shows the sweep degrading to a
complete, publishable non-sweep review with `sweep-did-not-run` logged **and
carried on the successful check-run output** (reason shown, no list version).

### Step 5: Pre-review skips emit no sweep metadata

**Maps to**: Acceptance Criterion 1

1. Trigger an automatic pass on a draft pull request.
2. Trigger an automatic pass on a head whose check run already exists.

**Expected result**: Both skips are indistinguishable from the same skip in a
non-sweep run — no per-category record, no activation statement, no
sweep metadata of any kind.

### Step 6: Terminal failure after review execution records not-determined

**Maps to**: Acceptance Criterion 1

1. Run a sweep-enabled pass against a fixture whose model call fails after the
   changed files are read (an invalid credential rejected by the model API is
   the natural fixture).
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
   npx tsx src/cli/recall-benchmark.ts --sweep-mode off --runs 5 \
     --output-file docs/testing/ronda/sweep-off-extended.json
   npx tsx src/cli/recall-benchmark.ts --sweep-mode on --runs 5 \
     --output-file docs/testing/ronda/sweep-on-extended.json
   ```

2. Repeat the same paired runs against the committed pre-extension snapshot
   (original-thirteen subset control) — `--manifest` and `--patches` point at
   `tests/fixtures/recall-benchmark/original-thirteen/`, created in
   implementation step 9 by copying `manifest.json` and `patches.json` before
   the five new seeds were added — each configuration writing its own file:

   ```bash
   npx tsx src/cli/recall-benchmark.ts --sweep-mode off --runs 5 \
     --manifest tests/fixtures/recall-benchmark/original-thirteen/manifest.json \
     --patches tests/fixtures/recall-benchmark/original-thirteen/patches.json \
     --output-file docs/testing/ronda/sweep-off-original-thirteen.json
   npx tsx src/cli/recall-benchmark.ts --sweep-mode on --runs 5 \
     --manifest tests/fixtures/recall-benchmark/original-thirteen/manifest.json \
     --patches tests/fixtures/recall-benchmark/original-thirteen/patches.json \
     --output-file docs/testing/ronda/sweep-on-original-thirteen.json
   ```
3. Record everything in `docs/testing/ronda/sweep-effect-evidence.md`, assembled
   from those output files — no run is hand-transcribed.

Each run record carries `fixture` (resolved manifest path, `benchmarkId`, seed
count, manifest and patch content hashes) and `configuration` (effective
`sweepMode`, the provider-reported immutable model version alongside the
configured model name, config values, prompt fingerprint) blocks.
Confirm before writing the evidence doc: the sweep-off and sweep-on files for a
given leg have **equal** `fixture` blocks and `configuration` blocks differing
only in `sweepMode` — that is what proves the arms differ only by the sweep
setting. The original-thirteen files share the extended fixture's `benchmarkId`
(the snapshot is a byte-identical copy) but must differ by path and content
hash; if they do not, the control ran against the wrong inputs. Read the model
version from the block's provider-reported field, never from the configured
alias: the alias is mutable, and a block whose version field restates it — or
that silently omits the field — is the case this check exists to catch. If the
endpoint reports no version, the block says so explicitly; record that in the
evidence rather than substituting the alias, since an unverifiable model
version does not support the AC8/AC9 same-configuration requirement.

**Expected result**: The evidence records per-run recall, lowest and highest
recall, the population-standard-deviation of per-run recall, per-defect
found/missed counts, sample count, immutable model version, reviewed target,
run timestamps, and fixture version **and effective review configuration read
from the runs' own identity blocks** for both configurations; the paired arms
are shown to differ only by `sweepMode`; the model version read from the blocks
is the provider-reported one, with the unavailable case recorded as unavailable
rather than backfilled from the configured alias; the
original-thirteen subset is reported alongside the extended fixture and is
shown to have run against its own inputs; the
historical 2026-09-10 baseline is labeled non-comparable with no figure read
against it; the record states no recall target and no variance ceiling are
defined.

### Step 9: Precision campaign

**Maps to**: Acceptance Criteria 9, 10

1. Run the precision fixtures the same number of times as the recall runs,
   sweep off and sweep on, under the same effective review configuration and
   the same real model — the same commands as Step 8 plus `--quality`, each
   writing its own file:

   ```bash
   npx tsx src/cli/recall-benchmark.ts --sweep-mode off --runs 5 --quality \
     --output-file docs/testing/ronda/sweep-off-precision.json
   npx tsx src/cli/recall-benchmark.ts --sweep-mode on --runs 5 --quality \
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
category-list version and effective review configuration used.

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

**Maps to**: Acceptance Criteria 15, 16, 17

1. Open `docs/testing/ronda/sweep-real-pr-evidence.md`.
2. Read the tier label, counted-pull-request total, and the caveats.

**Expected result**: The tier is `fixture_only` with zero counted pull
requests at ship time; the own-repository label and independence caveat are
present; no real-PR effect claim appears; the doc states the seeded benchmark
is not a regression gate until the AC12/AC13 seeds exist, and that what a
restored gate rejects is a deferred decision.

### Last Step: Validate & Shut Down

- Verify every assertion in the checklist below is met.
- Record the campaign results (Steps 8–10) in the committed evidence doc.

---

## Assertions Checklist

Each checkbox maps to an acceptance criterion from the spec.

- [ ] AC1: every sweep pass reaching review execution records per-category
      outcomes on the AC1-assigned surfaces; a degraded pass records
      `sweep-did-not-run` or the unrecognized-enablement record on the same
      surfaces (the successful review check run and the logs); skips and
      pre-execution failures emit nothing; terminal failures after execution
      record `not_determined` on the logs only; no record in the review body.
- [ ] AC2: one review per head SHA, no PR mutation, unchanged draft-skip and
      supersede behavior with the sweep enabled.
- [ ] AC3: review summary states sweep activation and list version; non-sweep
      passes say neither.
- [ ] AC4/AC5/AC6/AC7: recorded list fields, counting unit, complete candidate
      accounting, single current version, revision history.
- [ ] AC8: committed recall/variance evidence with per-run figures, spread,
      standard deviation, non-comparable baseline label, sample count ≥ 5.
- [ ] AC9: paired precision evidence with category attribution for sweep-on
      and the strict regression result.
- [ ] AC10: no manufactured finding per category; clean pass stays clean.
- [ ] AC11: model calls and elapsed time per pass for both configurations,
      compared against the recorded per-PR figures.
- [ ] AC12/AC13: fixture seeds for the four real themes and the harder
      credential-pattern case with `harderThan` metadata.
- [ ] AC14: no real or usable credential value in any evidence or fixture.
- [ ] AC15/AC16: evidence tier labeled honestly at `fixture_only`; no real-PR
      effect claim; own-repository caveat present.
- [ ] AC17: documentation states the regression-gate status and the deferred
      gate contract.
- [ ] AC18: enablement matrix behaves exactly as the spec's gate table states,
      including the unrecognized-value record without the raw value.
- [ ] AC19: malformed or missing list degrades to a non-sweep review without
      failing the pass or suppressing publication.
- [ ] AC20: every published finding appears in the per-category record against
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
| Campaign runs fail mid-way | Model outage or rate limiting | Record the partial results with timestamps and the failure reason; never silently drop attempted runs from the evidence |

---

## Known Limitations

- Steps 8–10 need a real model credential and are operator-run; their results
  are committed evidence, not CI.
- The real-PR tier (Step 12) cannot complete at implementation time by
  design — the ten-PR count accumulates over time; the record exists to keep
  the tier honest, not to promote it.
