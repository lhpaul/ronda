# Smoke Test Runbook: Report Review Quality vs External Reviewers

**Feature**: Report Ronda review quality against external reviewers
**Spec**:
[`../../specs/developments/20260917112125_56-report-review-quality-vs-external/1_56-report-review-quality-vs-external_specs.md`](../../specs/developments/20260917112125_56-report-review-quality-vs-external/1_56-report-review-quality-vs-external_specs.md)
**Implementation plan**:
[`../../specs/developments/20260917112125_56-report-review-quality-vs-external/2_56-report-review-quality-vs-external_implementation-plan.md`](../../specs/developments/20260917112125_56-report-review-quality-vs-external/2_56-report-review-quality-vs-external_implementation-plan.md)
**Created in**: Plan Ready stage

> No design assets. CLI-only reporting over committed JSON evidence.

---

## Prerequisites

Before running this smoke test:

- [ ] The implementation branch for issue **#56** is checked out.
- [ ] `npm ci` has been run at the repository root.
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` pass locally.
- [ ] At least one comparison JSON exists under `docs/testing/ronda/comparisons/`
      (committed samples are sufficient).
- [ ] When **#53** miss capture is available, at least one miss JSON exists under
      the configured misses directory; otherwise comparisons-only mode is acceptable
      for smoke until miss ingestion merges.

---

## Test Data

| Item | Value |
| --- | --- |
| Comparison evidence | `docs/testing/ronda/comparisons/*.json` |
| Miss evidence (when present) | `docs/testing/ronda/misses/*.json` |
| Unit fixtures | `tests/fixtures/review-quality-report/` |

---

## Smoke Test Steps

### Step 1: Default scope report

**Maps to**: AC1, AC6, AC7

1. Run `npm run quality:report`.
2. Inspect stderr for scope logging (directories, record counts).
3. Inspect stdout for JSON and markdown sections.

**Expected result**: Valid report with outcome buckets, even if some buckets are
zero. Empty comparison directory (if tested in a temp checkout) yields explicit
zeros, not an error.

### Step 2: Outcome separation

**Maps to**: AC1, AC5

1. Run the report against fixtures or committed comparisons that include clean
   agreement, adjudicated miss, unclear, and stale-head cases.
2. Confirm stale-head and unadjudicated drill-downs exist.
3. Confirm confirmed true-positive and false-positive totals do not include stale
   or unadjudicated rows.

**Expected result**: Buckets match spec precedence; drill-down lists cite stable
record ids.

### Step 3: Filters and grouping

**Maps to**: AC2

1. Re-run with `--repository`, `--reviewer`, and `--category` filters matching a
   subset of evidence.
2. Re-run with `--since` and `--until` bounding one record's timestamp.

**Expected result**: Totals change only for in-scope records; header states filter
boundaries.

### Step 4: Improvement section

**Maps to**: AC3

1. Include miss-record fixtures or captured misses with categories and intended
   follow-up values.
2. Read the improvement section of the report.

**Expected result**: Ranked categories, follow-up counts, and advisory actions
with record references. No automatic issue or prompt changes.

### Step 5: Snapshot suitability

**Maps to**: AC7

1. Run `npm run quality:report -- --format both --out /tmp/ronda-quality-report.json`.
2. Open the output file and confirm structured JSON is stable (key ordering not
   required; field presence is).

**Expected result**: Output suitable for committing as a trend snapshot; no
GitHub scrape occurred (offline/airplane mode re-run succeeds).

### Step 6: Partial parse resilience

**Maps to**: Operational Visibility

1. Point `--file` at one valid and one intentionally invalid JSON path.
2. Re-run the report.

**Expected result**: Valid records summarized; invalid file listed in skipped
section; non-zero exit only if every file failed.

---

## Pass/Fail

**Pass**: All steps match expected results; unit tests and CI green on the PR.

**Fail**: Any confirmed TP/FP count includes stale or unadjudicated rows; report
calls GitHub; sensitive fixture values appear in output; or filters silently
no-op.
