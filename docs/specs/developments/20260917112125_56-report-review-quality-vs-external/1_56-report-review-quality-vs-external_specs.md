# Report Ronda Review Quality Against External Reviewers — Spec

**Depends on**: 24-review-quality-benchmark-suite, 53-capture-external-review-misses

---

## Overview

Running Ronda alongside a stronger external reviewer on real pull requests produces
useful comparison evidence, but the learning stays hard to see without a structured
rollup. Operators need a lightweight quality report that turns committed comparison
and miss records into precision, recall, and improvement signals they can trust over
time.

This feature adds an operator-facing quality report generated only from structured
review-quality evidence already stored with the repository. The report separates
outcome classes, supports filtering and grouping, and highlights the categories and
follow-ups that deserve the next prompt, eval, or backlog investment. It does not
change Ronda's review behavior, merge authority, or pull request state.

---

## Use Cases

### Use Case 1: Operator Generates A Quality Report For Recent Evidence

**Actor**: Ronda operator

**Preconditions**:

- At least one structured same-repository comparison or captured miss record
  exists in the committed quality evidence store.
- The operator can run the repository's documented quality commands from a checkout.

**Steps**:

1. The operator requests a quality report for a chosen evidence scope (default: all
   committed comparison files in the standard comparisons directory).
2. The report reads only structured records; it does not scrape pull request
   threads or compose narrative summaries by hand.
3. The report aggregates every in-scope record into outcome counts and supporting
   drill-down lists.
4. The operator reads the report output (human-readable summary plus structured
   detail suitable for diffing over time).

**Postconditions**:

- Outcome totals reflect the in-scope evidence set.
- Stale-head and unadjudicated items remain visible rather than being folded into
  confirmed precision or recall counts.
- The operator can save or commit the report artifact as a snapshot for later
  comparison.

**Information shown**:

- Report generation timestamp and evidence scope (which repositories, reviewers,
  and time window were included).
- Global outcome totals (see Business Rules).
- Per-repository, per-reviewer, and per-category breakdowns when the underlying
  records carry those dimensions.
- Ranked improvement candidates (see Use Case 3).

**Actions available**:

- Narrow scope with repository, reviewer, category, or time-window filters.
- Export the structured report body for inclusion in retrospectives or release notes.

**Considerations**:

- An empty evidence scope produces an explicit empty report, not an error.
- Records outside the selected time window are omitted entirely from that run's
  totals.

---

### Use Case 2: Operator Interprets Outcome Classes

**Actor**: Ronda operator or retrospective analyst

**Preconditions**:

- A quality report has been generated for an evidence scope that includes both
  same-head comparisons and captured miss records where available.

**Steps**:

1. The analyst reads the report's outcome section.
2. Each finding or comparison line contributes to exactly one primary outcome
   bucket for reporting purposes, using the precedence rules in Business Rules.
3. The analyst uses stale-head and unadjudicated buckets to decide what needs
   re-run, re-capture, or human adjudication before it affects trend lines.

**Postconditions**:

- Confirmed Ronda misses (true positives for external signal / recall gaps) are
  not mixed with noise the operator already judged as Ronda-better signal.
- False-clean candidates remain visible even while adjudication is still unclear.
- Stale-head evidence never inflates miss or agreement rates.

**Information shown**:

- **True positive (confirmed Ronda miss)**: Human adjudication confirms the
  external finding was real and Ronda should have caught it.
- **False positive (confirmed Ronda noise)**: Human adjudication confirms Ronda
  reported a finding that was not actionable compared with the external reviewer
  or human judgment.
- **False-clean miss (candidate or confirmed)**: Same-head evidence where Ronda
  reported clean while the external reviewer reported findings; candidates remain
  listed when adjudication is still unclear.
- **Stale-head evidence**: Comparison or miss records whose reviewed heads do not
  match the pull request head being compared, or whose Ronda result head differs
  from the reviewed head in ways that invalidate same-head recall math.
- **Unadjudicated findings**: Records still marked unclear or carrying default
  verdict or follow-up values that require human judgment.

**Actions available**:

- Open the underlying comparison or miss record identifiers cited in drill-down
  lists.
- Queue re-adjudication or re-capture work for stale or unclear rows.

**Considerations**:

- Clean agreement between reviewers is reported separately and is not counted as
  any of the five classes above.
- Duplicate findings and out-of-scope external findings follow the same mapping
  rules already defined for captured miss records when those records are in scope.

---

### Use Case 3: Operator Identifies Highest-Value Improvements

**Actor**: Ronda operator or retrospective analyst

**Preconditions**:

- A quality report includes at least one confirmed Ronda miss or false-clean
  candidate with a known affected category.
- Captured miss records may include intended follow-up values (eval record, prompt
  change, backlog item, or undecided).

**Steps**:

1. The analyst reads the report's improvement section.
2. The report ranks categories by confirmed miss volume and by count of open
   false-clean candidates with unclear adjudication.
3. The report lists recommended next actions derived from structured follow-up
   fields and from categories with repeated misses and no recorded follow-up yet.
4. The analyst chooses prompt, eval, or backlog work based on the ranked list.

**Postconditions**:

- The operator has an ordered backlog of quality investments grounded in evidence,
  not ad hoc memory of past pull requests.
- Categories with zero confirmed misses but high external noise (Ronda-better signal)
  are visible so prompt tightening can be prioritized separately from recall gaps.

**Information shown**:

- Top missed categories by confirmed Ronda miss count within the scope.
- Categories with the most unclear false-clean candidates.
- Aggregated intended follow-up counts (eval, prompt change, backlog, undecided).
- Suggested next actions phrased as operator tasks (for example, "seed eval for
  category X", "review unclear false-clean on PR Y") with stable record references.

**Actions available**:

- Accept a suggested action by creating or updating the corresponding backlog or
  eval work outside this report.
- Re-run the report after adjudication to verify a category's miss rate improved.

**Considerations**:

- Recommendations are advisory; the report never opens issues or modifies prompts
  automatically.
- When follow-up fields are undecided, the report still surfaces the category but
  marks the action as needing human choice.

---

### Use Case 4: Operator Compares Trends Across Time Windows

**Actor**: Ronda operator

**Preconditions**:

- Multiple comparison or miss records exist with recorded capture or comparison
  timestamps spread across more than one calendar period.

**Steps**:

1. The operator runs the report twice with different time-window filters (for
   example, last 30 days versus previous 30 days).
2. The operator compares outcome totals and top missed categories between runs.
3. The operator judges whether precision, recall, or false-clean rate is moving in
  the intended direction after prompt or model changes.

**Postconditions**:

- Trend judgments use consistent outcome definitions between runs.
- Stale and unadjudicated buckets are comparable period-over-period because they
  are never silently merged into confirmed counts.

**Information shown**:

- Filter boundaries applied to each run.
- Same outcome and category breakdown fields as Use Case 1.

**Actions available**:

- Store two report snapshots under version control for audit history.
- Escalate a regression when confirmed misses rise in a category that recently
  shipped prompt changes.

**Considerations**:

- Time filtering uses each record's documented event timestamp (comparison capture
  time or miss-record write time), not the pull request merge date.

---

## Business Rules

- The report is generated only from structured comparison and captured miss records;
  free-text pull request comments are not inputs.
- Ronda remains comment-only; generating or publishing the report never changes
  pull request state, labels, or merge eligibility.
- Every in-scope finding or comparison line maps to exactly one primary outcome
  bucket for rollup purposes, using this precedence when multiple conditions could
  apply: stale-head evidence overrides adjudication-based buckets; unadjudicated
  overrides confirmed true or false positive; confirmed adjudication overrides
  false-clean candidacy alone.
- False-clean candidacy is defined as same-head evidence where Ronda reported clean
  and the external reviewer reported findings or a confirmed miss adjudication
  exists; unclear adjudication keeps the row in unadjudicated and false-clean
  drill-downs without counting it as a confirmed miss.
- Stale-head evidence is excluded from confirmed recall and precision rates but
  included in its own count and list.
- Category breakdowns use the affected category stored on each record; records
  without a category appear under an explicit "uncategorized" row rather than
  being dropped.
- Repository and reviewer breakdowns use the repository and reviewer names stored
  on each record.
- Time-window filters include a record when its documented timestamp falls within
  the inclusive start and exclusive or inclusive end boundaries defined by the
  operator's filter (exact boundary semantics are an implementation-plan decision,
  but both runs in a trend comparison must use the same rule).
- Ranked improvement suggestions must cite stable record identifiers and categories
  so operators can trace each suggestion back to evidence.
- Sensitive values from pull request diffs must not appear in report output; only
  redacted or summary fields already allowed in quality evidence may be shown.

---

## Operational Visibility

- Report generation should log the evidence scope and record counts processed.
- When some files fail to parse, the report lists them as skipped with a reason
  while still summarizing valid records (partial success), unless every file failed.
- Empty scopes and all-skipped scopes are distinct outcomes in logs and in the
  report header.

---

## Acceptance Criteria

- [ ] AC1: The report output separates true positives (confirmed Ronda misses),
  false positives (confirmed Ronda-better / noise signal), false-clean misses
  (candidates and confirmed), stale-head evidence, and unadjudicated findings,
  each with its own count and drill-down list.
- [ ] AC2: The operator can filter or group summaries by affected category,
  repository, external reviewer, and time window without editing source JSON by
  hand.
- [ ] AC3: The report includes a ranked improvement section that highlights top
  missed categories, open false-clean candidates, and structured follow-up counts,
  with stable references back to source records.
- [ ] AC4: Report generation reads structured comparison and compatible captured
  miss records only; it does not require manual prose and does not scrape GitHub
  threads at report time.
- [ ] AC5: Stale-head and unadjudicated rows never increment confirmed true
  positive or false positive totals.
- [ ] AC6: An empty evidence scope yields a valid empty report with explicit zero
  counts.
- [ ] AC7: Report output is suitable for committing as a snapshot artifact for
  trend comparison (structured machine-readable body plus operator-readable
  summary).

---

## Brief Coverage Matrix

| Brief objective | Spec coverage |
| --- | --- |
| Separate true positives, false positives, false-clean misses, stale-head evidence, and unadjudicated findings | Use Case 2, Business Rules, AC1, AC5 |
| Summarize by category, repo, reviewer, and time window | Use Case 1, Use Case 4, AC2 |
| Identify highest-value next prompt/eval improvements | Use Case 3, AC3 |
| Generated from structured comparison records, not manual prose | Overview, Use Case 1, Business Rules, AC4 |

---

## Out of Scope (MVP)

| Item | Deferral note |
| --- | --- |
| Automatic creation of eval fixtures or backlog issues from the report | Recommendations only; capture and backlog workflows stay in their own features. Human confirmation not required for deferral. |
| Web dashboard or GitHub App UI for the report | CLI or committed artifact output is sufficient for MVP; UI may follow if operators outgrow JSON/markdown snapshots. |
| Statistical significance or confidence intervals on trend lines | Ranked lists and raw counts satisfy the epic's first measurement pass. |
| Cross-repository aggregation beyond filtering multiple repos in one run | Single-repo evidence store remains primary; monorepo operators can combine outputs manually until a later aggregation spec exists. |

---

## Open Questions

- None blocking MVP: adjudication vocabulary and miss-record mapping align with
  **53-capture-external-review-misses** and **24-review-quality-benchmark-suite**.

---

## Traceability

| Issue acceptance theme | Spec anchors |
| --- | --- |
| Outcome separation | AC1, AC5, Use Case 2 |
| Multi-dimensional summary | AC2, Use Case 1, Use Case 4 |
| Improvement prioritization | AC3, Use Case 3 |
| Structured evidence only | AC4, Overview |
