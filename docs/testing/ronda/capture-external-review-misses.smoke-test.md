# Smoke Test Runbook: Capture External-Review Misses

**Feature**: Capture external-review misses as Ronda eval records (#53)
**Spec**: [1_53-capture-external-review-misses_specs.md](../../specs/developments/20260911234141_53-capture-external-review-misses/1_53-capture-external-review-misses_specs.md)
**Implementation plan**: [2_53-capture-external-review-misses_implementation-plan.md](../../specs/developments/20260911234141_53-capture-external-review-misses/2_53-capture-external-review-misses_implementation-plan.md)
**Created in**: Plan Ready stage
**Updated in**: In Development stage

---

## Prerequisites

- [ ] A test pull request is available and its current head SHA is known.
- [ ] Ronda has published a review result on the current head or another PR head.
- [ ] A Codex GitHub finding is available on the current head, or safe manual
      finding details are available.
- [ ] The operator has `gh` read access and a clean working tree.
- [ ] Test text contains no real credentials, private source excerpts, or diff hunks.

## Test Data

| Item | Value |
| --- | --- |
| Repository | A repository the operator is authorized to inspect |
| Pull request | A non-production test PR number |
| External reviewer | Codex GitHub for automatic capture; any readable name for manual capture |
| Category | One documented affected-category value |
| Record location | `docs/testing/ronda/misses/` |
| Capture command | `npm run quality:misses` (`src/cli/capture-external-review-misses.ts`) |

## Smoke Test Steps

### Step 1: Capture a same-head automatic finding

**Maps to**: AC1, AC2, AC14, AC16, AC17, AC22

1. Run `npm run quality:misses` for automatic capture with the selected PR and
   Codex GitHub reviewer.
2. Confirm its output names the checked PR, reviewed head, Ronda result head,
   and one of the documented four outcomes.
3. If a current-head finding exists, confirm a record under
   `docs/testing/ronda/misses/` names every required field and `capture source`
   is automatic.
4. Re-read the PR's comments, reviews, labels, and state.

**Expected result**: A valid finding writes/updates a record without any GitHub
mutation. A reviewer that is present but silent on the head reports successful
`nothing to capture`; unsupported/unreadable evidence is refused with a reason.

### Step 2: Capture a manual finding and verify identity behavior

**Maps to**: AC3, AC12, AC15, AC19–AC21, AC25, AC30–AC31

1. Submit a manual finding via `npm run quality:misses` with reviewer, location,
   text, category, and an omitted title/verdict/follow-up.
2. Confirm title derivation, default `Unadjudicated` and `Undecided`, and the
   manual capture marker.
3. Submit the same canonical manual identity again with harmless case and
   whitespace differences; confirm it updates in place.
4. Submit one with a materially changed location, title, or text; confirm it is
   a second record.
5. Submit a malformed/non-PR reviewed head and confirm refusal/no write.

**Expected result**: Manual identity is canonical only in the documented
fields; required input and head failures are explicit and leave records intact.

### Step 3: Verify safety refusals and bounds

**Maps to**: AC9–AC11, AC13, AC18, AC23–AC24, AC28, AC32–AC36, AC38, AC49–AC50

1. Use deterministic safe fixtures to submit a placeholder credential literal,
   then a non-placeholder credential-shaped value in each supported field.
2. Submit a plain diff marker and a six-consecutive-line source excerpt; confirm
   both refuse before any record is written. Repeat with the same marker and
   six-line excerpt presented as Markdown block quotes and as an indented code
   block (AC49–AC50); confirm the same refusals.
3. Submit a credential-free finding text longer than 2,000 characters; confirm
   a record is truncated and marked as such.
4. Attempt direct adjudication without a rationale and with a credential-shaped
   rationale; confirm both refuse and retain the prior record values.

**Expected result**: The command names the earliest applicable refusal without
printing rejected sensitive content. Published placeholder literals remain
acceptable, and valid long text is bounded after scanning.

### Step 4: Adjudicate, summarize, and delete

**Maps to**: AC4–AC8, AC26, AC29, AC43–AC45, AC48, AC51

1. Adjudicate one non-stale record with a valid rationale and a true-positive
   verdict plus intended follow-up.
2. Run the quality summary and confirm it adds the confirmed miss/category
   evidence without changing clean-agreement counts.
3. Capture or fixture a stale record and a record whose referenced Ronda result
   cannot be resolved; confirm neither is counted under a verdict outcome and
   their counts remain independent.
4. Delete an unadjudicated/undecided test record (AC44), then try deleting the
   adjudicated record (AC45).

**Expected result**: Adjudication is auditable, fresh Ronda resolvability is
used at read time, stale/unresolvable evidence is visible but excluded, and
deletion is allowed only for untouched records.

### Step 5: Validate and clean up

1. Run the documented targeted tests, `npm run typecheck`, `npm run lint`, and
   `npm test`.
2. Remove only temporary test records created outside committed fixture paths
   under `docs/testing/ronda/misses/`.
3. Record PR number, heads, command results, and any external-review timing
   limitation in the implementation PR.

## Assertions Checklist

- [ ] Capture is read-only toward GitHub and stores complete structured evidence
      under `docs/testing/ronda/misses/`.
- [ ] Manual and automatic records use distinct, deterministic identities.
- [ ] Refusals protect credentials and source/diff content before persistence.
- [ ] Summary classifications preserve existing quality counts and expose stale/
      unresolvable evidence separately.
- [ ] Adjudication and deletion respect rationale and lifecycle restrictions.
- [ ] Adjudication and deletion rules are enforced by `npm run quality:misses`
      only; committed JSON under `docs/testing/ronda/misses/` can still be
      edited outside the tooling.

## Known Limitations

- Automatic capture supports Codex GitHub reviewer evidence only in this
  iteration. Manual entry is the supported route for other reviewers.
- A real GitHub smoke run depends on authorized PR access and external reviewer
  timing; fixture tests provide deterministic coverage when it is unavailable.
- Workflow tooling enforces adjudication and deletion gates; bypassing the CLI
  by editing committed miss files directly is possible and out of band.
