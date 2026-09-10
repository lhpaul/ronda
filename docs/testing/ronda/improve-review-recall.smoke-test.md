# Smoke Test Runbook: Improve Review Recall

**Feature**: Improve review recall
**Spec**: [`../../specs/developments/20260910121757_15-improve-review-recall/1_15-improve-review-recall_specs.md`](../../specs/developments/20260910121757_15-improve-review-recall/1_15-improve-review-recall_specs.md)
**Implementation plan**: [`../../specs/developments/20260910121757_15-improve-review-recall/2_15-improve-review-recall_implementation-plan.md`](../../specs/developments/20260910121757_15-improve-review-recall/2_15-improve-review-recall_implementation-plan.md)
**Created in**: Plan Ready stage

> No design assets. Ronda has no user interface, issue #15 has no design asset
> section, and the development folder has no `assets/` directory.

---

## Prerequisites

Before running this smoke test:

- [ ] The implementation branch for issue #15 is checked out.
- [ ] `npm ci` has been run at the repository root.
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` pass locally.
- [ ] A real model credential is available through `RONDA_MODEL_API_KEY` or the
      local operator config file.
- [ ] The benchmark command added by the implementation is available from
      `package.json`.
- [ ] The benchmark fixture manifest contains exactly the eight seeded defects
      listed in issue #15.

Do not commit model credentials, local config files, raw benchmark output with
operator-specific account data, or any sensitive value copied from a fixture.

---

## Test Data

| Item | Value |
| --- | --- |
| Benchmark manifest | `tests/fixtures/recall-benchmark/manifest.json` |
| Benchmark patches | `tests/fixtures/recall-benchmark/patches.json` |
| Seeded-defect count | 8 |
| Minimum found seeded defects | 6 |
| Must-find category | Sensitive-value exposure |
| Expected false positives | 0, unless explicit human approval accepts the tradeoff |

---

## Smoke Test Steps

### Step 1: Benchmark manifest covers the seeded defects

**Maps to**: Acceptance criterion 2

1. Open `tests/fixtures/recall-benchmark/manifest.json`.
2. Confirm it lists these seeded-defect categories:
   - expired-session inversion
   - sensitive-value exposure
   - cache-capacity off-by-one
   - SQL interpolation
   - invalid range parsing
   - lexicographic numeric sort
   - lower-element median
   - empty-word title casing

**Expected result**: The manifest contains exactly the eight seeded defects from
issue #15, with an id, category, expected severity, file path, and description
for each one.

### Step 2: Deterministic benchmark output shape

**Maps to**: Acceptance criteria 1, 11, and 12

1. Run the benchmark in its deterministic fixture/fake-model mode, if the
   implementation provides one.
2. Read the JSON summary printed by the command.

**Expected result**: The summary includes total seeded defects, found seeded
defects, missed seeded defects, false positives, model identity, reviewed target
or fixture identity, and timestamp. This proves benchmark mechanics only; it
does not count as real recall evidence.

### Step 3: Real-model recall run

**Maps to**: Acceptance criteria 1, 3, 4, 5, 6, 7, 8, and 12

1. Export the real model credential in the shell used for the run.
2. Run the recall benchmark against the configured real model.
3. Save the command, model name, reviewed target, timestamp, found categories,
   missed categories, and false-positive count in the implementation PR body or
   a PR comment.

**Expected result**: Ronda finds at least six of eight seeded defects, includes
the sensitive-value exposure as a Blocking finding, does not repeat the
sensitive value in the finding body, reports the median file's sort and median
defects as separate actionable categories, and reports zero known false
positives unless a human explicitly accepts the precision tradeoff.

### Step 4: Same-head variance check

**Maps to**: Acceptance criterion 9

1. Without changing the benchmark target or model configuration, run the
   real-model benchmark a second time.
2. Compare the two result summaries.

**Expected result**: The two runs produce the same set of merge-relevant
seeded-defect categories. Finding prose may differ, but the found/missed
category set and Blocking status for sensitive-value exposure remain stable.

### Step 5: Existing GitHub review contract still holds

**Maps to**: Acceptance criterion 10

1. Run the existing Ronda v0 smoke test sections that prove one review plus one
   check run on a ready pull request, or cite a current implementation-PR review
   pass that exercises the same path.
2. Inspect the resulting GitHub review and check run.

**Expected result**: Ronda still publishes findings through one pull-request
review and the existing `Ronda review` check run, with no branch mutation.

---

## Acceptance Checklist

- [ ] Benchmark output reports total, found, missed, false positives, model,
      reviewed target, and timestamp.
- [ ] Benchmark manifest includes all eight seeded defects from issue #15.
- [ ] Real-model benchmark finds at least six of eight seeded defects.
- [ ] Sensitive-value exposure is found as Blocking and the sensitive value is
      not repeated in the finding body.
- [ ] Sort and median defects in the same file are separate actionable
      categories.
- [ ] Cache-capacity off-by-one is found.
- [ ] Empty-word title-casing defect is found.
- [ ] False-positive count is zero or explicitly accepted by a human.
- [ ] Two same-head real-model runs produce the same merge-relevant category
      set.
- [ ] Existing one-review plus check-run contract remains intact.
- [ ] Fixture/fake-model tests are not treated as the sole recall evidence.

---

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Benchmark command cannot authenticate | Model credential missing from environment or local config | Set `RONDA_MODEL_API_KEY` or the local operator config outside the repository. |
| Fake-model benchmark passes but real-model recall fails | The deterministic mode proves only benchmark mechanics | Treat the implementation as not ready; tune prompt/model behavior and rerun the real-model steps. |
| Sensitive-value finding repeats the sensitive value | Prompt or benchmark matching accepts unsafe prose | Fix the prompt or result validation before marking the feature ready. |
| Second real-model run finds a different category set | Model variance remains material | Record the mismatch and continue tuning before readiness. |
| A normal PR review changes shape or creates multiple reviews | Benchmark changes drifted into the GitHub output contract | Revert the output-contract drift and re-run existing v0 smoke coverage. |
