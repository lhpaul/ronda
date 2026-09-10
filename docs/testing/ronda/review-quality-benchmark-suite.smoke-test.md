# Smoke Test Runbook: Review Quality Benchmark Suite

**Feature**: Review quality benchmark suite
**Spec**: [`../../specs/developments/20260910143722_24-review-quality-benchmark-suite/1_24-review-quality-benchmark-suite_specs.md`](../../specs/developments/20260910143722_24-review-quality-benchmark-suite/1_24-review-quality-benchmark-suite_specs.md)
**Implementation plan**: [`../../specs/developments/20260910143722_24-review-quality-benchmark-suite/2_24-review-quality-benchmark-suite_implementation-plan.md`](../../specs/developments/20260910143722_24-review-quality-benchmark-suite/2_24-review-quality-benchmark-suite_implementation-plan.md)
**Created in**: Plan Ready stage

> No design assets. Ronda has no user interface, issue #24 has no design asset
> section, and the development folder has no `assets/` directory.

---

## Prerequisites

Before running this smoke test:

- [ ] The implementation branch for issue #24 is checked out.
- [ ] `npm ci` has been run at the repository root.
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` pass locally.
- [ ] A real model credential is available through `RONDA_MODEL_API_KEY` or the
      local operator config file.
- [ ] A consumer repository with another reviewer platform is available for
      second-opinion comparison.
- [ ] No model credential, reviewer account identifier, tunnel URL, hostname, or
      raw sensitive value will be committed to the repository.

---

## Test Data

| Item | Value |
| --- | --- |
| Seeded quality fixtures | `tests/fixtures/recall-benchmark/` |
| Precision fixture | A documented fixture expected to produce a clean Ronda result |
| Comparison fixture or smoke PR | Same repository, pull request, and head reviewed by Ronda and another reviewer |
| Required mismatch statuses | Ronda miss, Ronda better signal, duplicate finding, clean agreement, unclear |
| Expected false positives | 0 for the clean precision fixture unless explicitly adjudicated as acceptable |

---

## Smoke Test Steps

### Step 1: Seeded Quality Coverage

**Maps to**: Acceptance criteria 1 and 2

1. Open the committed quality benchmark fixture metadata.
2. Confirm it covers security, authorization, data-loss, async or race,
   configuration, stale-SHA, sorting, text-normalization, and multi-finding
   review scenarios.
3. Run the deterministic benchmark mode with a fixture response.
4. Read the printed summary.

**Expected result**: The summary includes total seeded defects, found seeded
defects, missed seeded defects, false positives, model identity, reviewed
target, and timestamp.

### Step 2: Precision Fixture

**Maps to**: Acceptance criterion 3

1. Run the benchmark or quality command against the precision fixture that
   should remain clean.
2. Inspect the result.
3. Run the noisy precision fixture, if provided, and inspect the result.

**Expected result**: The clean precision fixture reports no Ronda findings. The
noisy precision fixture reports an unexpected finding as a false-positive
candidate.

### Step 3: Sensitive Evidence Redaction

**Maps to**: Acceptance criterion 4

1. Run the deterministic fixture that includes synthetic sensitive material.
2. Inspect the benchmark or comparison evidence output.
3. Search the output for the fixture's forbidden value.

**Expected result**: Sensitive seeded values are absent from all evidence
output. A finding that repeats the forbidden value does not satisfy the
sensitive category.

### Step 4: Same-Head Variance

**Maps to**: Acceptance criterion 5

1. Run the real-model benchmark against the same reviewed target twice without
   changing the target, model, or configuration.
2. Record the model identity, reviewed target, timestamp, found categories,
   missed categories, and false positives for both runs.
3. Compare the merge-relevant categories between the two runs.

**Expected result**: Same-head evidence records both runs and makes any
merge-relevant variance visible. Finding prose may differ, but category and
severity changes are not hidden.

### Step 5: Second-Reviewer Comparison

**Maps to**: Acceptance criteria 6 and 7

1. Pick a real pull request head that Ronda reviewed.
2. Trigger or observe the other reviewer platform for the same repository,
   pull request, and head.
3. Record Ronda-only findings, second-reviewer-only findings, duplicate
   findings, and the human adjudication outcome.
4. Exercise each supported mismatch status using deterministic fixtures or real
   adjudicated examples.

**Expected result**: The comparison evidence proves the reviewed repository,
pull request, and head match for both reviewers and supports Ronda miss, Ronda
better signal, duplicate finding, clean agreement, and unclear outcomes.

### Step 6: False-Clean Candidate

**Maps to**: Acceptance criteria 8 and 9

1. Use a Ronda-clean result for a specific pull request head.
2. Trigger or record a second-opinion reviewer run for the same head.
3. If the second reviewer finds an external-only actionable issue, adjudicate it
   as a Ronda miss.
4. Inspect the resulting quality evidence.

**Expected result**: A Ronda-clean result followed by an adjudicated
external-only actionable issue is recorded as a false-clean candidate, and the
source comparison remains traceable for a future seeded benchmark case.

### Step 7: Existing Review Contract

**Maps to**: Acceptance criterion 10

1. Run or cite the existing Ronda v0 smoke path that proves ready PR review,
   manual review trigger, draft skip, one review, one check run, and no branch
   mutation.
2. Inspect the GitHub review and check-run surfaces.

**Expected result**: The quality benchmark changes do not alter Ronda's GitHub
review output, check-run behavior, draft skip behavior, manual review trigger
behavior, or no-branch-mutation contract.

---

## Acceptance Checklist

- [ ] Seeded fixtures cover the required quality categories.
- [ ] Benchmark output reports seeded recall, missed defects, false positives,
      model identity, reviewed target, and timestamp.
- [ ] A precision fixture reports clean.
- [ ] A noisy precision case is visible as a false-positive candidate.
- [ ] Evidence output does not include forbidden sensitive values.
- [ ] Same-head variance evidence is recorded for repeated real-model runs.
- [ ] A same-head second-reviewer comparison can be recorded.
- [ ] Mismatches support all required adjudication statuses.
- [ ] A Ronda-clean result plus an adjudicated external-only issue produces a
      false-clean candidate.
- [ ] Confirmed Ronda misses remain traceable for future benchmark seeds.
- [ ] Existing Ronda GitHub review and check-run contracts remain unchanged.

---

## Troubleshooting

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Real-model benchmark cannot authenticate | Model credential missing from environment or local config | Set `RONDA_MODEL_API_KEY` or local operator config outside the repository. |
| Precision fixture produces a finding | Prompt/model is noisy or fixture is not actually clean | Adjudicate the finding; fix the fixture or prompt before readiness. |
| Comparison evidence has different head SHAs | The reviewers did not inspect the same pull request version | Re-run the second reviewer on the current head before counting the comparison. |
| Second reviewer does not finish | External reviewer availability or spending/rate limit issue | Record the timeout separately; do not count it as clean agreement or Ronda miss. |
| Evidence contains a forbidden sensitive value | Redaction or matching safety regressed | Treat as blocking; fix before human-ready status. |
| Existing review output changes shape | Quality tooling leaked into the GitHub review contract | Revert the contract drift and rerun the existing v0 smoke path. |
