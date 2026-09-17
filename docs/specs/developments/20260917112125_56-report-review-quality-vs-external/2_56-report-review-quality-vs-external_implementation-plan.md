# Report Ronda Review Quality Against External Reviewers — Implementation Plan

**Spec**:
[`1_56-report-review-quality-vs-external_specs.md`](./1_56-report-review-quality-vs-external_specs.md)
**Smoke test runbook**:
[`56-report-review-quality-vs-external.smoke-test.md`](../../../testing/ronda/56-report-review-quality-vs-external.smoke-test.md)

---

## Summary

**Approach**: Add one operator-facing quality report CLI that reads committed
structured evidence only — same-repository comparison JSON under
`docs/testing/ronda/comparisons/` today, and captured miss JSON under a
parallel misses directory once **#53** lands — then classifies every in-scope
finding or comparison line into the spec's primary outcome buckets using fixed
precedence, applies filters and grouping, and prints both a machine-readable
report body and a short operator-readable summary suitable for committing as a
snapshot. Extend the existing comparison rollup in
`summarize-review-comparisons.ts` rather than forking a second classifier.

Three decisions carry the plan:

1. **One report module owns outcome precedence.** Stale-head overrides
   adjudication buckets; unadjudicated overrides confirmed true/false positive;
   confirmed adjudication overrides false-clean candidacy alone. Comparison rows
   and miss-record rows share one classifier interface so trend runs stay
   comparable (AC1, AC5, Business Rules).
2. **`quality:summary` stays a thin alias.** The current
   `summarize-review-comparisons.ts` rollup remains for backward compatibility
   and scripts; `quality:report` is the spec-complete surface. The summary
   command may delegate to the report builder with a legacy JSON shape or emit a
   deprecation notice in `--help` — not both silently diverging.
3. **Miss records integrate through a reader contract, not ad hoc JSON.** Until
   **#53** merges, the report runs comparisons-only, lists zero miss-derived
   rows explicitly, and unit tests use fixtures shaped to the **#53** spec so
   integration does not wait on production capture tooling. The default misses
   directory path is `docs/testing/ronda/misses/` (mirror comparisons layout);
   if **#53**'s merged plan names a different path, update defaults and docs in
   the implementation PR only — do not hard-code two paths.

**Estimated complexity**: M

**Rationale**: Most building blocks exist (`ReviewComparisonRecord`,
`summarizeReviewComparison`, comparison discovery, package scripts). The work is
classification precedence, multi-dimensional rollups, filter semantics, partial
parse handling, improvement ranking, dual output formats, and tests/fixtures for
every outcome bucket — not model or GitHub integration.

**Dependencies**: **#24** (merged — comparison evidence and rollup primitives).
**#53** (spec approved; plan PR #68 open — miss-record schema and storage path).
Implementation may start on comparisons-only evidence; miss-record ingestion
must land before the item closes AC4's "compatible captured miss records"
wording. If **#53** merges first, wire the shared reader in the same
implementation PR; if **#56** merges first, keep miss-directory ingestion behind
the reader interface with fixture coverage.

---

## Verification Log

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `941a2de` |
| Next workflow action | `workflow-next-action.sh --development docs/specs/developments/20260917112125_56-report-review-quality-vs-external` | `STATUS=Spec Ready`, `NEXT_ACTION=write-plan` |
| Existing comparison rollup | `wc -l src/cli/summarize-review-comparisons.ts tests/unit/cli/summarize-review-comparisons.test.ts` | 192 / 183 lines |
| Package scripts | `rg 'quality:' package.json` | `quality:comparison`, `quality:summary` present; no `quality:report` yet |
| Committed comparison samples | `ls docs/testing/ronda/comparisons \| wc -l` | 6 JSON files |
| Comparison default directory | `rg DEFAULT_COMPARISON_DIRECTORY src/cli/summarize-review-comparisons.ts` | `docs/testing/ronda/comparisons` |
| Classifier primitive | `rg 'export function summarizeReviewComparison' src/cli/recall-benchmark.ts` | Same-head, adjudication counts, false-clean candidate |
| Miss capture plan in flight | `gh api '/repos/lhpaul/ronda/pulls/68' --jq '.title'` | `docs(plan): capture external-review misses` (#53) |
| Architecture | `docs/project/4-database-model.md` | No product DB; evidence stays in committed JSON + CLI output |

---

## Cross-Cutting Operational Assumption Check

### Applicable

| Assumption surface | Recorded value | Authoritative source | Verified at | Bounded cross-check scope | Result |
| --- | --- | --- | --- | --- | --- |
| Approved base branch | `develop` | Handoff + `validate-branch-reuse.sh` (`BASE_TIP=941a2de`) | 2026-09-17, SHA `941a2de` | Batch items 54–58, 63–66 | `Verified` |
| Comparison evidence layout | JSON arrays under `docs/testing/ronda/comparisons/` | `summarize-review-comparisons.ts`, **#24** plan | 2026-09-17, SHA `941a2de` | **#56** only | `Verified` |
| Miss-record storage path | Default `docs/testing/ronda/misses/` until **#53** plan merges | **#53** spec + open plan PR #68 | 2026-09-17, REST PR scan | **#53**, **#56** | `Verified` — path is provisional; reconcile with merged **#53** plan before closing AC4 |
| Existing five comparison outcome counts | `ronda_miss`, `ronda_better`, `duplicate`, `clean_agreement`, `unclear` | `recall-benchmark.ts` / **#53** AC7 | 2026-09-17, SHA `941a2de` | **#53** spec AC7 | `Verified` — report adds spec rollup buckets without redefining these adjudication enums |

**No `Conflict` row** in the bounded batch scope. **#53** and **#56** touch the
same evidence family but **#56** consumes a reader contract **#53** publishes;
parallel plan work does not change comparison file layout on `develop`.

### Not applicable

No linked cloud project, deployment target, or selected product repository.

**Overall result**: `Applicable`.

---

## Layer-by-Layer Changes

### Database / Data Layer

Not applicable.

### Backend / API

Not applicable — CLI-only feature; no webhook or review-pass changes.

### Shared Packages / Libraries

- [ ] Add `src/quality/review-quality-report.ts` (name illustrative — adapt if
      repo conventions prefer `src/cli/` only) exporting:
      - Evidence load: comparison files (reuse `resolveComparisonFiles` /
        `readComparisonRecords`) and miss files (new `resolveMissFiles` /
        `readMissRecords` once **#53** types exist; until then, parse fixtures
        matching **#53** spec fields).
      - `classifyEvidenceRow(row): PrimaryOutcome` implementing spec precedence:
        `stale_head` → `unadjudicated` → confirmed `true_positive` /
        `false_positive` → `false_clean_candidate` (and `clean_agreement` as
        separate non-primary bucket for comparisons).
      - Rollups: global counts, drill-down lists (stable id, repository,
        pullNumber, reviewer, category), breakdowns by category / repository /
        reviewer, time-window filtering on documented event timestamps
        (`capturedAt` or comparison record write time — pick one inclusive/exclusive
        rule and use it for all filters; document in `--help`).
      - Improvement section: top categories by confirmed miss count, top categories
        by unclear false-clean candidates, aggregated intended follow-up counts
        from miss records, advisory next-action strings with record ids (AC3).
      - Skipped-file accounting for JSON parse failures (partial success per
        Operational Visibility).
- [ ] Map comparison adjudications to spec display buckets without breaking
      **#53** AC7: keep raw adjudication counts in structured output; spec
      primary buckets are a derived view.
- [ ] Redaction: never emit finding bodies or titles from raw comparison
      payloads in markdown summary; drill-down uses ids, PR numbers, categories,
      and adjudication labels only unless the stored evidence already uses
      redacted summaries (AC4, sensitive-value rule).

### CLI

- [ ] Add `src/cli/report-review-quality.ts` with:
      ```text
      npm run quality:report -- [--dir comparisons] [--miss-dir misses]
        [--file <path> ...] [--miss-file <path> ...]
        [--repository <name>] [--reviewer <name>] [--category <name>]
        [--since <iso>] [--until <iso>]
        [--format json|markdown|both] [--out <path>]
      ```
      Defaults: comparison dir `docs/testing/ronda/comparisons`, miss dir
      `docs/testing/ronda/misses`, format `both`, stdout when `--out` omitted.
- [ ] Log scope and counts to stderr (record counts processed, skipped files,
      empty scope) — Operational Visibility.
- [ ] Add `"quality:report": "tsx src/cli/report-review-quality.ts"` to
      `package.json`.
- [ ] Refactor `summarize-review-comparisons.ts` to call shared rollup helpers
      from `review-quality-report.ts` (or import and wrap) so adjudication totals
      do not drift.

### Tests

- [ ] Add `tests/unit/quality/review-quality-report.test.ts` (or under
      `tests/unit/cli/`) covering:
      - Each primary outcome bucket with drill-down ids (AC1).
      - Stale-head and unadjudicated excluded from confirmed TP/FP totals (AC5).
      - Filters: repository, reviewer, category, time window (AC2).
      - Empty scope → valid zero report (AC6).
      - Improvement ranking and follow-up aggregation (AC3).
      - Parse failure on one file still summarizes others; all-fail exits non-zero.
      - Miss-record fixtures (from **#53** spec shape) merged with comparison
        fixtures (AC4).
- [ ] Extend or relocate tests from `summarize-review-comparisons.test.ts` only
      when shared helpers move; keep existing tests green.

### Documentation

Listed for post-implementation (Plan Ready does not edit these):

- [ ] `README.md` — document `quality:report` and snapshot workflow.
- [ ] `docs/adoption/ronda-review-adoption.md` — operator steps to generate and
      commit report snapshots.
- [ ] `AGENTS.md` — add `quality:report` under Common Commands if README points
      there today for quality scripts.

### Infrastructure / Configuration

- [ ] No secrets, no GitHub calls at report time (AC4).

---

## Testing Strategy

**Test types**: Unit (primary), smoke/manual for committed snapshot workflow.

**Key scenarios to test**:

1. Mixed comparison fixtures produce separated outcome counts and drill-downs —
   AC1.
2. Repository, reviewer, category, and time filters narrow totals — AC2.
3. Improvement section ranks categories and lists follow-ups with stable refs —
   AC3.
4. Report reads JSON evidence only (no gh calls in unit tests) — AC4.
5. Stale and unadjudicated rows excluded from confirmed TP/FP — AC5.
6. Empty directories → explicit zero report — AC6.
7. Structured JSON body plus markdown header suitable for commit — AC7.

**Smoke test runbook**:
`docs/testing/ronda/56-report-review-quality-vs-external.smoke-test.md`

**Regression suite**: Not applicable — no browser/product E2E suite.

---

## Seed Data

| Entity | Values / Scenario | File |
| --- | --- | --- |
| Comparison rollup | Existing unit fixtures + `tests/fixtures/recall-benchmark/comparisons/*.json` | Reuse where possible |
| Full outcome mix | One file per adjudication outcome + stale head + false-clean | New under `tests/fixtures/review-quality-report/` |
| Miss records | Minimal **#53**-shaped records (true positive, false positive, unadjudicated, stale, follow-ups) | Same directory |
| Empty scope | Empty temp dir | Created in tests |

---

## Documentation Updates

- [ ] `README.md` — quality report command and snapshot guidance.
- [ ] `docs/adoption/ronda-review-adoption.md` — operator workflow.
- [ ] `AGENTS.md` — common command entry if quality scripts are listed there.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| **#53** storage/schema differs from assumed misses directory | Med | Med | Reader interface + fixture tests; reconcile in impl PR when **#53** merges |
| Drift between `quality:summary` and `quality:report` | Med | Med | Shared rollup module; summary delegates or documents legacy shape |
| Time-window boundary inconsistency between trend runs | Low | Med | Single documented rule; unit tests for boundary rows |
| Accidental leakage of finding text in markdown output | Low | High | Summary uses ids/metadata only; test forbids forbidden fixture substrings |

---

## Implementation Order

1. Introduce `review-quality-report` module with outcome precedence and types;
   port comparison-only path using existing records (AC1, AC5, AC6).
2. Wire `report-review-quality.ts` CLI, package script, stderr scope logging
   (Operational Visibility, AC7).
3. Add filters, breakdowns, and improvement section (AC2, AC3).
4. Add miss-record reader + fixtures aligned to **#53** spec; merge rollups
   (AC4) — may follow **#53** merge if schema still moving on PR #68.
5. Refactor `summarize-review-comparisons.ts` to shared helpers; keep tests green.
6. Add unit tests for every AC; run `npm run typecheck`, `npm run lint`, `npm test`.
7. Execute smoke runbook; optionally commit a sample snapshot under
   `docs/testing/ronda/reports/` only if operators want a golden file (optional,
   not required for MVP).
8. Update documentation listed above.
9. Add changelog fragment:

   ```markdown
   - **Report review quality vs external reviewers** (#56): Operator CLI report that rolls up structured comparison and miss evidence into outcome buckets, filters, and improvement candidates without scraping GitHub.
   ```

   File: `changelog.d/56.feature.report-review-quality-vs-external.md`

---

## Files to Modify (implementation PR)

| File | Change |
| --- | --- |
| `src/quality/review-quality-report.ts` | New — classification, rollups, filters, improvement |
| `src/cli/report-review-quality.ts` | New — CLI entry |
| `src/cli/summarize-review-comparisons.ts` | Refactor to shared helpers |
| `package.json` | Add `quality:report` script |
| `tests/unit/quality/review-quality-report.test.ts` | New |
| `tests/fixtures/review-quality-report/*` | New fixtures |
| `docs/testing/ronda/56-report-review-quality-vs-external.smoke-test.md` | Already created in plan PR |
| `README.md`, `docs/adoption/ronda-review-adoption.md`, `AGENTS.md` | Post-impl docs |
