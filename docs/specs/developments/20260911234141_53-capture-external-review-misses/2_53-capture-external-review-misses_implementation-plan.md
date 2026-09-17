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
| Default miss directory constant | `sed -n '1,120p' src/quality/review-quality-report.ts` | `export const DEFAULT_MISS_DIRECTORY = "docs/testing/ronda/misses";` (line 11). Confirms the plan's store path matches the existing named default. Verified `2026-09-17T16:14:52Z` at `53bd76b06480b4e0497808db28cd92b699ae1997`. |

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
      format under the literal directory `docs/testing/ronda/misses/` (the same
      default already named by `DEFAULT_MISS_DIRECTORY` in
      `src/quality/review-quality-report.ts`) and stable read/write helpers in
      the CLI layer. Do not introduce a second miss-record directory.
- [ ] Define one record with the spec-required evidence fields: PR repository
      and number, reviewed head, Ronda result head, reviewer, location, title,
      text, verdict, category, intended follow-up, capture source, source ID,
      stale marker, truncation marker, and optional rationale. **Plan
      addition (not a spec-required field):** optional `capturedAt` /
      update timestamps for local forensics before commit; the durable
      audit trail remains git history per the spec.
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
      exists because no database or remote schema is introduced. If
      `summarize-review-comparisons.ts` / `recall-benchmark.ts` contracts are
      extended for miss classifications, a reversal must revert those type and
      summary-output changes in the same follow-up while leaving already
      committed miss JSON under `docs/testing/ronda/misses/` untouched (older
      summary code may ignore unrecognized files or fields).

### GitHub Evidence Reader and Capture CLI

- [ ] Add `src/cli/capture-external-review-misses.ts`, wired as
      `quality:misses` in `package.json` (`tsx src/cli/capture-external-review-misses.ts`),
      as a sibling of `src/cli/record-review-comparison.ts`. The command covers
      automatic `codex-github` capture and a manual-entry path, plus read,
      adjudicate, and guarded-delete subcommands or flags documented in help
      text. Reuse the scoped `gh pr view` metadata pattern from
      `record-review-comparison.ts`; no command may post comments, reviews,
      labels, state changes, or mutations to a PR.
- [ ] Read only the selected PR's current head, its historical heads/Ronda
      review result evidence, and the Codex GitHub review/comment evidence
      needed for automatic capture. Resolve the Ronda result head as same-head
      first, otherwise the most recent PR head with a result where "most
      recent" means **push-order only** on that pull request (the head pushed
      last wins; AC37) — never commit timestamp and never Ronda publish time;
      record stale evidence rather than rejecting that fallback.
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
      Codex GitHub reviewer. Publish the closed reviewer-alias list (AC39) as
      versioned source constants in `src/quality/miss-reviewer-aliases.ts`
      (imported by identity matching and automatic-support checks; committed
      and reviewed with the workflow). The complete list, compared case- and
      leading/trailing-whitespace-insensitively, is exactly:
      `chatgpt-codex-connector[bot]`, `chatgpt-codex-connector`,
      `codex-github`, and `codex`. Expanding the list is a deliberate source
      change in that file (and a matching spec change), not a runtime config
      edit. Distinguish reviewer absent/unsupported/unparseable from a
      reviewer that is present but silent on the current head.
- [ ] Derive a missing title from the first nonblank finding-text line, truncate
      it to 120 characters, scan before truncating, and store location-unresolved
      as evidence rather than refusing a present but unmappable location.

### Sensitive-Content Guard

- [ ] Add a narrow, testable validation module and publish the two lists it
      consumes as versioned source constants in
      `src/quality/miss-sensitive-content-lists.ts` (imported by the CLI
      validator; committed and reviewed with the workflow — no separate secret
      store). The credential refusal list must recognise at least these six
      forms (AC9): (1) code-hosting access token, (2) API key, (3) private key
      block, (4) cloud access-key identifier, (5) authorization header bearer
      value, and (6) an assignment whose name reads as a password, secret,
      token, or API key and whose value is a literal. The placeholder list is
      whole literal values only (AC18), compared case- and
      surrounding-whitespace-insensitively, and must include at least
      `REDACTED`, `example`, and `changeme`. Expanding either list is a
      deliberate source change in that file, not a runtime config edit.
- [ ] Scan every stored free-text input and an adjudication rationale before
      deriving/truncating/persisting any value.
- [ ] Before the diff-marker and five-consecutive-line checks (AC38, AC49,
      AC50), normalize each scanned field by (1) stripping a leading Markdown
      block-quote marker (`>` plus an optional following space) from every
      line, and (2) when every nonblank line of the field shares a common
      leading indent of one tab or four spaces (indented code block), stripping
      exactly that one shared indent level. Apply the marker and consecutive-
      line checks only to the normalized text. Do not add further Markdown
      transforms (nested quotes, HTML, or fence-fence stripping beyond the
      shared indent rule above).
- [ ] Refuse diff headers/hunks and more than five consecutive nonblank lines
      that match changed-file or diff content for the reviewed head. Permit only
      the spec's bounded short excerpts; never silently trim a refused payload.
- [ ] For every capture (including a manual capture on an older reviewed head),
      resolve the source/diff comparison baseline as a **fresh** merge-base of
      that reviewed head and the PR base branch's tip **at that capture**
      (AC54). Do **not** reuse a prior capture's merge-base for a later
      capture's scan — two captures of the same finding may legitimately differ
      after the base moves. **Plan addition (not a spec-required field):** when
      a record is successfully written, optionally store the merge-base SHA
      used for that capture as audit metadata only; that stored SHA must never
      become the scan baseline for a subsequent capture.
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
      quality-summary commands (`npm run quality:misses` and related flags),
      explicitly stating that capture is read-only toward GitHub and that
      records are committed evidence under `docs/testing/ronda/misses/`.
- [ ] Update `docs/project/3-software-architecture.md` Testing Strategy to
      describe external-review miss records and fresh resolvability checks.
- [ ] Update `docs/testing/ronda/review-quality-comparison-collection.md` in
      place (do not replace the file): keep its comparison-collection intent
      and first-batch workflow, and add a short section that points operators
      to `npm run quality:misses` and
      `docs/testing/ronda/capture-external-review-misses.smoke-test.md` for
      durable miss capture and adjudication.
- [ ] Add `docs/testing/ronda/capture-external-review-misses.smoke-test.md` from
      this plan. Update adoption documentation only if the final operator
      command requires setup beyond existing GitHub/model credentials.

### Infrastructure / Configuration

- [ ] Add `quality:misses` package-script wiring to
      `src/cli/capture-external-review-misses.ts` only; do not add secrets,
      tokens, reviewer account identifiers, hostnames, or a mutable service
      configuration.

---

## Testing Strategy

**Test types**: Unit, fixture-backed CLI integration, and manual GitHub smoke.

**Key scenarios to test**:

1. Automatic Codex GitHub capture writes all required fields with same-head
   evidence and does not mutate the PR (AC1–AC2).
2. Manual capture, defaults, title derivation, unresolved location, and valid
   reviewed-head selection behave as specified (AC3–AC4, AC19–AC21, AC25).
3. Adjudication, rationale precedence, capture-time merge semantics, and guarded
   deletion preserve durable audit evidence (AC5, AC26, AC28–AC29, AC43–AC45,
   AC51). Explicitly cover AC44 (delete unadjudicated/undecided removes the
   record; later same-identity capture creates a new record) and AC45 (delete
   of adjudicated or decided records is refused with a pointer to adjudication).
4. Quality summary preserves existing outcome meanings while adding categories,
   stale, and unresolvable evidence (AC6–AC8 and AC48).
5. Source/content identity, automatic silence, unsupported reviewers, missing
   inputs, enum/head rejection, and refusal precedence are deterministic
   (AC12–AC17, AC22–AC24, AC27, AC30–AC31).
6. Credential placeholder handling, pre-truncation scanning, diff/source
   rejection, Markdown quote/indent normalization, and bounded stored content
   satisfy data minimization (AC9–AC11, AC18, AC32–AC36, AC38, AC49–AC50).
   Explicitly cover AC49 (quoted/indented hunk markers refuse like plain
   markers) and AC50 (quoted/indented six-line source excerpts refuse like
   plain excerpts). Name separate per-criterion tests (not only this bundled
   scenario) for:
   - AC37: push-order-only Ronda-result-head fallback (never commit timestamp /
     publish time)
   - AC39: closed case/whitespace-insensitive reviewer alias list
   - AC40: same commit on two PRs yields two records
   - AC41: distinct automatic source IDs / distinct manual finding text yield
     separate records; case/whitespace-only text is an update
   - AC42: re-capture replaces affected category without rationale
7. A stale capture displays the review result for its stored Ronda-result head,
   and an older-head manual capture scans against a fresh capture-time
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
      quoting/indentation after the normalization rules above; lookalike prose
      that lacks markers; multiple markers on one input; six consecutive
      matching nonblank lines versus five; blank lines breaking a sequence;
      changed-file versus diff matches; CRLF and whitespace variants; title
      derivation after scanning; credentials in every scanned field and beyond
      truncation boundaries.
- **Unit-test mapping**: add tests in
      `tests/unit/cli/capture-external-review-misses.test.ts` (and a focused
      validation sibling if needed) with one named assertion per listed
      boundary case — including AC49/AC50 quote/indent variants, AC37
      push-order fallback, AC39 alias matching, AC40–AC42 identity/category
      cases, and AC44/AC45 deletion paths — plus CLI fixtures for interpreted
      Codex review structures.
- **Additional historical-evidence cases**: include fixture tests that prove a
      stale display reads the stored Ronda-result head, not the reviewed head,
      and that each older-head manual capture resolves a **fresh** capture-time
      base-tip merge-base for its own scan (AC54) — a later capture after the
      PR base advances must not reuse the earlier capture's merge-base.
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

- [ ] `README.md` — document `npm run quality:misses`
      (`src/cli/capture-external-review-misses.ts`), the operator command
      surface, GitHub read-only guarantee, and store path
      `docs/testing/ronda/misses/`.
- [ ] `docs/project/3-software-architecture.md` — document miss-record quality
      evidence and its test boundary.
- [ ] `docs/testing/ronda/review-quality-comparison-collection.md` — update in
      place to connect comparison collection to durable capture/adjudication
      evidence (do not replace the file).
- [ ] `docs/testing/ronda/capture-external-review-misses.smoke-test.md` — add
      the manual operating and validation runbook; state that adjudication and
      deletion rules are enforced by the workflow tooling only (committed JSON
      under `docs/testing/ronda/misses/` can be edited outside the CLI).
- [ ] `docs/adoption/ronda-review-adoption.md` — update only if implementation
      adds an operator prerequisite beyond current documented access.
- [ ] `src/quality/miss-sensitive-content-lists.ts` — publish the credential
      refusal forms and placeholder literals (versioned with the workflow).
- [ ] `src/quality/miss-reviewer-aliases.ts` — publish the closed Codex GitHub
      reviewer alias list used by identity matching and automatic support
      (versioned with the workflow).

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| External review format drifts | Medium | Medium | Limit automatic support to Codex GitHub and retain complete manual entry. |
| Sensitive text reaches committed evidence | Low | High | Scan before derivation/truncation/write; fixture proof exercises refusal. |
| Stale evidence is counted as a miss | Medium | High | Store both heads, resolve Ronda evidence fresh, and exclude stale/unresolvable records. |
| Existing quality counts drift | Medium | High | Extend rather than reinterpret comparison summary and regression-test clean agreement. |
| Live GitHub smoke is unavailable | Medium | Medium | Keep deterministic fixture tests; record live limitation without fabricating evidence. |

## Delivery Phasing Answers

This plan delivers **Phase 1 and Phase 2 in a single implementation pass** (one
feature PR). Spec Delivery Phasing remains the product ordering of capability;
Implementation Order below tags each step `P1` / `P2` so Phase 1 surfaces are
landed and testable before Phase 2 surfaces in the same branch, without a
separate Phase 2 PR.

Open questions from the spec:

1. **Confirmed-miss counting**: Count **per-head occurrences** (each durable
   miss record), not distinct cross-head defects. A defect re-flagged on several
   heads becomes several records and contributes multiple confirmed-miss counts
   once adjudicated as true positives.
2. **Source/diff threat model**: The full consecutive-line source/diff scan
   protects against committed miss JSON that reprints reviewed repository
   source or PR patches — including evidence captured from other repositories
   the operator can read. Diff-marker refusal plus the 2,000-character cap is
   an incomplete interim control; because this plan ships Phase 2 in the same
   pass, implementers must not ship capture-to-`docs/testing/ronda/misses/`
   without the full scan. If a temporary branch checkpoint exposes Phase 1
   only, that checkpoint must refuse source/diff content at least via markers
   and the size cap and must not be treated as release-complete.
3. **Tooling-only enforcement**: Adjudication and deletion rules are enforced
   only by `npm run quality:misses` and related readers. Records are ordinary
   committed files under `docs/testing/ronda/misses/`; anyone can edit them
   outside the workflow. The smoke runbook must state this explicitly.

## Implementation Order

1. **P1** — Define the record schema, closed enums, canonical identity helpers
   (including the AC39 reviewer-alias constants in
   `src/quality/miss-reviewer-aliases.ts`), JSON storage under
   `docs/testing/ronda/misses/`, fixture format, and the safety-validation
   module (credential lists in `src/quality/miss-sensitive-content-lists.ts`,
   quote/indent normalization, and Phase 1 diff-marker refusal) before any
   capture gate consumes input.
2. **P1** — Implement GitHub evidence readers and the Capture Decision Gate with
   path-specific precedence and no GitHub write operation, using the validator
   created in step 1. Ronda-result-head fallback uses push-order only (AC37).
3. **P1** — Add automatic/manual capture, read, adjudicate, and guarded-delete
   operations in `src/cli/capture-external-review-misses.ts` /
   `quality:misses`; make help text mirror the four-stage Capture Decision Gate
   described in this plan (the smoke runbook in step 7 must use the same
   wording — do not invent a second gate narrative). Wire every
   capture/adjudicate write path through the step-1 validator **before** any
   derivation, truncation, or persistence (Phase 1 marker refusal is live in
   this step; do not land an unvalidated write path). Guarded-delete is part of
   this step's command surface (AC44–AC45 behavior is unit-tested in step 6).
4. **P1/P2** — Complete the **P2** consecutive-line source/diff scan and AC54
   fresh merge-base resolution on top of the step-3 validated write paths;
   execute the planted-violation fail/pass proof.
5. **P1/P2** — Extend comparison/quality types and the summary output with the
   new miss classifications (including **P2** unresolvable-evidence reporting)
   while preserving legacy counts.
6. **P1/P2** — Add fixtures and unit tests for every gate stage, parser-risk
   boundary (including AC49–AC50), source/content identity, stale/unresolvable
   summary behavior, audit transitions, **P2** guarded deletion (AC44–AC45),
   AC37 push-order Ronda-result-head fallback, AC39 reviewer aliases,
   AC40–AC42 identity/category cases, AC53 stored-result-head display, AC54
   fresh capture-time merge-base scanning for manual older-head input, AC46
   missing-category automatic refusal, AC47 default preservation, AC52
   case-sensitive location identity, AC55 refreshed automatic evidence, and
   AC56 automatic/manual record separation. Do not re-implement the
   guarded-delete command surface here — it lands in step 3.
7. **P1/P2** — Update the README, software architecture testing section,
   comparison collection guide (in place), and smoke runbook; sync help text
   and runbook to the same four-stage wording; document tooling-only
   enforcement of adjudication/deletion.
8. Run `npm run typecheck`, `npm run lint`, `npm test`, the targeted capture
   test file, and the sensitive planted-violation proof. Run the smoke runbook
   on a real PR only with safe, authorized GitHub access.
9. Add `changelog.d/53.added.external-review-misses.md` in the implementation
   PR with: `- **Capture external-review misses** (#53): Add durable,
   privacy-bounded eval records for adjudicated external reviewer findings.`
   This is a repository release-note obligation for a feature PR, not a
   separately traced product acceptance criterion.
