# Capture External-Review Misses as Ronda Eval Records — Implementation Plan

**Spec**: [1_53-capture-external-review-misses_specs.md](./1_53-capture-external-review-misses_specs.md)
**Smoke test runbook**: [capture-external-review-misses.smoke-test.md](../../../testing/ronda/capture-external-review-misses.smoke-test.md)

---

## Summary

**Approach**: Evolve the existing committed review-comparison evidence surface
into an explicit miss-record store and CLI. The implementation will read GitHub
evidence only, validate and redact candidate content before it reaches JSON,
preserve source- and content-based identities, and roll the records into the
existing quality summary without changing Ronda's review/check-run contract.

**Estimated complexity**: L

**Rationale**: The feature has a deliberately strict, observable decision gate:
two head identities, source-specific upsert behavior, sensitive-content refusal,
and summary rules all need deterministic unit coverage. Automatic Codex GitHub
review parsing and live smoke evidence add external variability.

**Dependencies**: The merged spec PR #59 is the required completed
specification stage. Before implementation starts, verify #59 remains merged
to `develop`; if it is not merged or its specification is superseded, stop and
return to plan/spec review rather than implementing this plan.

---

## Verification Log

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse HEAD` | `4a545bbd85c8037b73408f336555926ef76c7299` |
| Verification time | `date -u +%Y-%m-%dT%H:%M:%SZ` | `2026-09-15T09:27:07Z` |
| Existing record command | `sed -n '1,320p' src/cli/record-review-comparison.ts` | Existing CLI resolves PR metadata with `gh` and appends JSON comparison records. |
| Existing quality summary | `sed -n '1,280p' src/cli/summarize-review-comparisons.ts` | Summary aggregates committed comparison JSON in stable file order. |
| Existing types and classifications | `sed -n '1,380p' src/cli/recall-benchmark.ts` | `ReviewComparisonRecord` and the five current adjudication outcomes already provide the quality-evidence seam. |
| Existing tests | `sed -n '1,260p' tests/unit/cli/record-review-comparison.test.ts` and `sed -n '1,240p' tests/unit/cli/summarize-review-comparisons.test.ts` | CLI record construction, append behavior, same-head status, and summary rollup have focused unit coverage. |
| Existing operator runbook | `sed -n '1,220p' docs/testing/ronda/review-quality-comparison-collection.md` | Current workflow records same-head comparisons only and never mutates PR state. |
| Architecture and persistence | `sed -n '1,240p' docs/project/2-repo-architecture.md` and `sed -n '1,200p' docs/project/4-database-model.md` | Ronda is a single TypeScript repository with no product database; committed quality evidence is the appropriate store. |
| Same-surface open PR check | `gh pr list --state open --json number,title,headRefName,baseRefName` filtered for quality/comparison/external-review surfaces | No matching open PR was returned. |
| Design assets | Issue #53 body, comments, linked files, and `docs/specs/developments/20260911234141_53-capture-external-review-misses/assets/` | No design assets; this is CLI/evidence work, so no fidelity step applies. |

## Cross-Cutting Operational Assumption Check

**Result**: `Not applicable` — the feature does not rely on a mutable
environment target, cloud project, external base branch, or selected product
repository. GitHub PR data is evidence read at command execution time, not a
plan-time operational configuration; the bounded same-surface PR check found
no competing change.

---

## Layer-by-Layer Changes

### Database / Data Layer

- [ ] Do not add a database or remote storage. Add a versioned JSON miss-record
      format under `docs/testing/ronda/misses/` (or a single explicitly selected
      equivalent directory) and stable read/write helpers in the CLI layer.
- [ ] Define one record with the spec-required evidence fields: PR repository
      and number, reviewed head, Ronda result head, reviewer, location, title,
      text, verdict, category, intended follow-up, capture source, source ID,
      stale marker, truncation marker, optional rationale, and audit timestamps.
- [ ] Implement automatic identity as PR + immutable source ID and manual
      identity as canonicalized PR/reviewer/reviewed-head/location/title/text.
      Preserve the source kind and source ID on updates; never merge identities
      across capture sources.
- [ ] Canonicalize manual comparisons exactly as the spec requires: reviewer,
      abbreviated head, title, and text case/whitespace-insensitive; location
      whitespace-insensitive but case-sensitive. Treat a changed manual
      location/title/text as a distinct record.
- [ ] Treat the JSON format as additive committed evidence. A rollback removes
      the feature command and readers in a follow-up revert while preserving
      already committed records for auditability; a record captured in error is
      removed only through the guarded delete operation. No migration rollback
      exists because no database or remote schema is introduced.

### GitHub Evidence Reader and Capture CLI

- [ ] Add a dedicated CLI command, wired in `package.json`, for automatic
      `codex-github` capture and a manual-entry path. Reuse the scoped `gh pr
      view` metadata pattern from `record-review-comparison.ts`; no command may
      post comments, reviews, labels, state changes, or mutations to a PR.
- [ ] Read only the selected PR's current head, its historical heads/Ronda
      review result evidence, and the Codex GitHub review/comment evidence
      needed for automatic capture. Resolve the Ronda result head as same-head
      first, otherwise the latest PR head with a result; record stale evidence
      rather than rejecting that fallback.
- [ ] When reporting a stale capture, present the Ronda result for the stored
      Ronda-result head alongside the reviewed head and its stale marker; do
      not present a result from the reviewed head as though it were the stored
      comparison result.
- [ ] Implement the four-stage Capture Decision Gate with deterministic
      precedence: whole-capture resolution/reviewer/Ronda-result checks;
      per-finding required fields and closed enum validation; supplied-head,
      credential, and source/diff-content validation; then identity upsert.
      Make its observable outcomes `capture_refused`, `nothing_to_capture`,
      `record_written`, and `record_updated`.
- [ ] Support manual reviewed-head defaulting to the current PR head and refuse
      malformed or non-PR-head values. Support automatic capture only for the
      Codex GitHub reviewer; distinguish reviewer absent/unsupported/unparseable
      from a reviewer that is present but silent on the current head.
- [ ] Derive a missing title from the first nonblank finding-text line, truncate
      it to 120 characters, scan before truncating, and store location-unresolved
      as evidence rather than refusing a present but unmappable location.

### Sensitive-Content Guard

- [ ] Add a narrow, testable validation module for credential-shaped content,
      the literal placeholder allow-list, and source/diff-content rejection.
      Scan every stored free-text input and an adjudication rationale before
      deriving/truncating/persisting any value.
- [ ] Refuse diff headers/hunks and more than five consecutive nonblank lines
      that match changed-file or diff content for the reviewed head. Permit only
      the spec's bounded short excerpts; never silently trim a refused payload.
- [ ] For a manual capture on an older reviewed head, obtain the reviewed
      source/diff comparison baseline from that head's capture-time PR base-tip
      merge base. Persist the evidence needed to reproduce that check so later
      base-branch movement cannot change the scan's result.
- [ ] Bound stored finding text and rationale to 2,000 characters after scans;
      mark truncation. Keep refusal reports field-specific and never echo a
      rejected secret, patch, or full source content.

### Adjudication, Deletion, and Quality Summary

- [ ] Add explicit read, adjudicate, and delete operations. Direct adjudication
      requires a rationale when it changes one or both fields; capture-time
      values do not. Preserve a rationale for no-op/default capture values and
      clear it when a capture changes a non-default judgement.
- [ ] Permit deletion only while verdict is `Unadjudicated` and follow-up is
      `Undecided`; report a refusal otherwise without touching GitHub.
- [ ] Extend `recall-benchmark.ts` types and `summarize-review-comparisons.ts`
      so quality output adds confirmed misses, reviewer noise, out-of-scope,
      duplicates, unadjudicated, category breakdown, stale evidence, and
      unresolvable evidence. Keep existing five comparison outcome counts and
      clean agreement unchanged.
- [ ] Resolve Ronda evidence afresh at summary time. Exclude stale or
      unresolvable records from verdict outcomes; allow both independent status
      counts when both conditions apply.

### Tests and Fixtures

- [ ] Add focused unit tests for the decision-gate precedence and all four
      outcomes, automatic Codex evidence extraction, manual defaults, two head
      resolution, source/content identity updates, enum rejection, and no-PR-
      mutation command behavior.
- [ ] Add deterministic fixtures for GitHub review/comment evidence, PR head
      histories, same-head/stale evidence, every verdict/follow-up/category,
      update/deletion paths, placeholder values, credentials, diff markers,
      six-line source excerpts, location handling, and rationale behavior.
- [ ] Add summary tests proving stale/unresolvable exclusion, independent counts,
      unchanged clean-agreement behavior, category aggregation, and durable
      audit records. Keep external GitHub calls out of `npm test` with injected
      command/process seams or fixture readers.
- [ ] Run a planted-violation proof for the sensitive-content guard: use a
      fixture containing a disallowed credential/diff form and show capture
      refuses it; remove the form and show the same path writes/updates the
      expected fixture record.

### Documentation

- [ ] Update `README.md` with the capture, read, adjudicate, delete, and
      quality-summary commands, explicitly stating that capture is read-only
      toward GitHub and that records are committed evidence.
- [ ] Update `docs/project/3-software-architecture.md` Testing Strategy to
      describe external-review miss records and fresh resolvability checks.
- [ ] Update `docs/testing/ronda/review-quality-comparison-collection.md` or
      replace its narrow command guidance with the documented four-stage miss
      capture workflow while retaining its comparison-collection intent.
- [ ] Add `docs/testing/ronda/capture-external-review-misses.smoke-test.md` from
      this plan. Update adoption documentation only if the final operator
      command requires setup beyond existing GitHub/model credentials.

### Infrastructure / Configuration

- [ ] Add package-script wiring only; do not add secrets, tokens, reviewer
      account identifiers, hostnames, or a mutable service configuration.

---

## Testing Strategy

**Test types**: Unit, fixture-backed CLI integration, and manual GitHub smoke.

**Key scenarios to test**:

1. Automatic Codex GitHub capture writes all required fields with same-head
   evidence and does not mutate the PR (AC1–AC2).
2. Manual capture, defaults, title derivation, unresolved location, and valid
   reviewed-head selection behave as specified (AC3–AC4, AC19–AC21, AC25).
3. Adjudication, rationale precedence, capture-time merge semantics, and guarded
   deletion preserve durable audit evidence (AC5, AC26, AC28–AC29, AC43, AC51).
4. Quality summary preserves existing outcome meanings while adding categories,
   stale, and unresolvable evidence (AC6–AC8 and AC48).
5. Source/content identity, automatic silence, unsupported reviewers, missing
   inputs, enum/head rejection, and refusal precedence are deterministic
   (AC12–AC17, AC22–AC24, AC27, AC30–AC31).
6. Credential placeholder handling, pre-truncation scanning, diff/source
   rejection, and bounded stored content satisfy data minimization (AC9–AC11,
   AC18, AC32–AC42).
7. A stale capture displays the review result for its stored Ronda-result head,
   and an older-head manual capture scans against its preserved capture-time
   base-tip merge base despite later base movement (AC53–AC54).
8. Automatic capture refuses a missing operator-supplied category; a re-capture
   does not reset adjudicated fields to their defaults; manual location remains
   case-sensitive; automatic re-capture refreshes edited reviewer wording; and
   a manual capture remains a separate record from an automatic record even
   when the human-visible finding is the same (AC46–AC47, AC52, AC55–AC56).

**Smoke test runbook**:
`docs/testing/ronda/capture-external-review-misses.smoke-test.md`

**Regression suite**: Not applicable. The repository has no committed
non-placeholder E2E suite; implementation must add deterministic unit/fixture
coverage and use the runbook for real GitHub evidence.

### Parser-Risk Addendum

This plan is parser-risk: it introduces structured parsing/scanning of GitHub
review prose and diff/source-content detection.

- **Edge cases**: `diff --git`, `@@`, paired `---`/`+++` markers under Markdown
      quoting/indentation; lookalike prose that lacks markers; multiple markers
      on one input; six consecutive matching nonblank lines versus five; blank
      lines breaking a sequence; changed-file versus diff matches; CRLF and
      whitespace variants; title derivation after scanning; credentials in
      every scanned field and beyond truncation boundaries.
- **Unit-test mapping**: add tests in
      `tests/unit/cli/capture-external-review-misses.test.ts` (or focused
      validation sibling) with one named assertion per listed boundary case,
      plus CLI fixtures for interpreted Codex review structures.
- **Additional historical-evidence cases**: include fixture tests that prove a
      stale display reads the stored Ronda-result head, not the reviewed head,
      and that older-head manual capture retains the capture-time base-tip
      merge-base scan after the PR base advances.
- **Suppression semantics**: Not applicable. The capture command accepts no
      inline suppression directives; it refuses unsafe content rather than
      skipping a validation rule.

### Concurrent-Event-Source Addendum

Not applicable. The CLI performs one bounded foreground capture/read/update at
a time and introduces no listeners, timers, socket callbacks, or shared
mutable state across execution contexts.

---

## Seed Data

| Entity | Values / scenario | File |
| --- | --- | --- |
| PR evidence | Current and historical heads; same-head, stale, and no-Ronda-result cases | `tests/fixtures/external-review-misses/` |
| External evidence | Parsed Codex GitHub review/comment findings, silent current-head reviewer, unsupported reviewer, malformed output | `tests/fixtures/external-review-misses/` |
| Miss records | Automatic/manual identities, all verdicts/follow-ups/categories, rationale/deletion states | `tests/fixtures/external-review-misses/` |
| Sensitive content | Published placeholders, credential forms, diff markers, five/six-line source matches | `tests/fixtures/external-review-misses/` |

## Documentation Updates

- [ ] `README.md` — document the operator command surface and GitHub read-only
      guarantee.
- [ ] `docs/project/3-software-architecture.md` — document miss-record quality
      evidence and its test boundary.
- [ ] `docs/testing/ronda/review-quality-comparison-collection.md` — connect
      comparison collection to durable capture/adjudication evidence.
- [ ] `docs/testing/ronda/capture-external-review-misses.smoke-test.md` — add
      the manual operating and validation runbook.
- [ ] `docs/adoption/ronda-review-adoption.md` — update only if implementation
      adds an operator prerequisite beyond current documented access.

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| External review format drifts | Medium | Medium | Limit automatic support to Codex GitHub and retain complete manual entry. |
| Sensitive text reaches committed evidence | Low | High | Scan before derivation/truncation/write; fixture proof exercises refusal. |
| Stale evidence is counted as a miss | Medium | High | Store both heads, resolve Ronda evidence fresh, and exclude stale/unresolvable records. |
| Existing quality counts drift | Medium | High | Extend rather than reinterpret comparison summary and regression-test clean agreement. |
| Live GitHub smoke is unavailable | Medium | Medium | Keep deterministic fixture tests; record live limitation without fabricating evidence. |

## Implementation Order

1. Define the record schema, closed enums, canonical identity helpers, JSON
   storage boundary, fixture format, and the safety-validation module that scans
   credentials and source/diff content before any capture gate consumes input.
2. Implement GitHub evidence readers and the Capture Decision Gate with
   path-specific precedence and no GitHub write operation, using the validator
   created in step 1.
3. Add automatic/manual capture, read, adjudicate, and guarded-delete command
   operations; make help text mirror the four-stage runbook.
4. Integrate the step-1 validator before all derivation, truncation,
   persistence, or adjudication writes; execute the planted-violation fail/pass
   proof.
5. Extend comparison/quality types and the summary output with the new miss
   classifications while preserving legacy counts.
6. Add fixtures and unit tests for every gate stage, parser-risk boundary,
   source/content identity, stale/unresolvable summary behavior, and audit
   transitions, including AC53 stored-result-head display and AC54 preserved
   capture-time merge-base scanning for manual older-head input, plus AC46
   missing-category automatic refusal, AC47 default preservation, AC52
   case-sensitive location identity, AC55 refreshed automatic evidence, and
   AC56 automatic/manual record separation.
7. Update the README, software architecture testing section, comparison
   collection guide, and smoke runbook.
8. Run `npm run typecheck`, `npm run lint`, `npm test`, the targeted capture
   test file, and the sensitive planted-violation proof. Run the smoke runbook
   on a real PR only with safe, authorized GitHub access.
9. Add `changelog.d/53.added.external-review-misses.md` in the implementation
   PR with: `- **Capture external-review misses** (#53): Add durable,
   privacy-bounded eval records for adjudicated external reviewer findings.`
   This is a repository release-note obligation for a feature PR, not a
   separately traced product acceptance criterion.
