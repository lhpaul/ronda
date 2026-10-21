# Smoke Test Runbook: Miss verdict provenance

**Spec**: [Approved scope](../../specs/developments/20261021214305_miss-verdict-provenance/1_miss-verdict-provenance_specs.md)
**Plan**: [Implementation contract](../../specs/developments/20261021214305_miss-verdict-provenance/2_miss-verdict-provenance_implementation-plan.md)
**Created in**: Writing Plan
**Updated in**: Implementation execution pending

## Prerequisites

- Install locked dependencies with `npm ci` if needed.
- Use existing fake `runGh` seams and temporary test directories. No credentials,
  real GitHub evidence refresh, model execution or GitHub publication is needed.
- Execute the committed tests after implementation; this runbook records intended
  outcomes, not a claim that the unimplemented feature already passes.
- Use the plan's Verification Log revision and exact-marker query as the
  pre-backfill evidence baseline. Do not edit the real corpus for negative tests.

## Test Data

Use test-local builders and the existing external-review fixtures. Cover Human
reviewed, Accepted assistant draft, absent legacy provenance, invalid explicit
provenance, and unadjudicated records. Same-head/resolvable and stale/unresolvable
variants exercise independent exclusions. Add a comparison record to verify that
miss provenance does not reclassify comparison adjudication.

The plan's design discovery found no item design references or assets; no visual
fidelity step applies to this CLI/data feature.

## Smoke Test Steps

### Step 1: Capture and validate explicit selections

**Maps to**: AC1–AC2, AC9.

Run the focused command and gate tests:

```bash
npx tsx --test tests/unit/cli/capture-external-review-misses.test.ts tests/unit/quality/miss-capture-gate.test.ts
```

Exercise manual and automatic initial terminal capture for each supported
`--verdict-provenance` value, plus automatic multi-finding propagation, through
fake GitHub evidence. Inspect the saved JSON for the exact selected property.
Attempt each terminal path with the option omitted or invalid; compare the
before/after temporary evidence files. Re-capture a draft without submitting a
terminal verdict and confirm retained judgment/provenance. An unadjudicated
capture remains unconfirmed.

**Expected**: Explicit valid terminal selections persist; invalid/missing required
selections refuse without changing that finding's evidence. Sibling automatic
findings follow their existing per-finding outcome policy. No real GitHub or
model calls occur.

### Step 2: Legacy and malformed input

**Maps to**: AC3.

Use report/summary test inputs with absent provenance, then explicit empty,
null, wrong-type and unknown values. Include invalid explicit values on stale
and unadjudicated rows. Exercise both file readers and direct in-memory report /
summary functions.

**Expected**: Absent legacy provenance reads as human without rewriting input;
invalid explicit provenance is rejected or reported in existing skipped-file
diagnostics and never counted as human. Unadjudicated rows never enter confirmed
counts. A clear diagnostic identifies the malformed field.

### Step 3: Compare groups and recommendations

**Maps to**: AC5–AC6.

```bash
npx tsx --test tests/unit/quality/review-quality-report.test.ts tests/unit/cli/summarize-miss-records.test.ts
```

Inspect the tested JSON and Markdown report outputs with mixed human/draft
misses and comparison evidence. Repeat with each group empty. Include stale and
unresolvable inputs and filtered-out evidence. Read category recommendations,
record IDs and follow-up statistics for human-only, draft-only and mixed-source
contributions. Inspect the summary rollup as well as the full report.

**Expected**: Only eligible human miss judgments enter existing confirmed
figures; accepted drafts appear separately alongside them with zero empty
buckets. Recommendations identify draft contributions explicitly, filtered-out
rows do not supply recommendations, and comparison semantics stay unchanged.
Both provenance groups retain stale/unresolvable exclusions.

### Step 4: Verify bounded backfill and durable audit

**Maps to**: AC4, AC8–AC9.

Run the plan's exact-marker enumeration against the recorded baseline and the
implemented corpus. Inspect the field-only residual evidence produced by the
implementation: selected identity/path membership, parsed before/after equality
after removing the new field, provenance value on every survivor, and unchanged
unselected files. Inspect the backfill commit separately from code changes.

Verify the historical cohort reconciliation: the existing deletion commit
`e1cfac7acce30939f93e42df3ad7d5366d5ddade` accounts for the two previously
head-unresolvable #118 automatic records named in the plan. They are not recreated.
Confirm the implementation's factual spec correction and dated report note agree
with the inventory evidence.

**Expected**: Every surviving delegation-marked record has the draft value; all
prior verdicts, rationale, identity, timestamps and other fields are unchanged.
Prior excluded evidence remains excluded and prior versions are reachable in git.
No runtime prose-based classification is added.

### Step 5: Confirm a draft individually

**Maps to**: AC1, AC7–AC8.

Through the fake command seam, adjudicate an existing terminal draft using
provenance-only selection `human` and a valid rationale; retain its verdict,
identity and follow-up. Regenerate the local report with the in-memory resolver.
Then perform a follow-up-only adjudication on a separate accepted draft.

For durable audit, inspect a disposable local repository containing a committed
draft version and a later individual-confirmation version, or record equivalent
offline git-history evidence from implementation. Inspect the parent version's
verdict and draft provenance. No rewrite of shared history is involved.

**Expected**: Individual confirmation moves an otherwise eligible record from
draft to human without double counting; the prior committed draft is auditable.
Follow-up-only leaves draft provenance unchanged. Provenance-only confirmation
of an unadjudicated record is refused rather than supplying an implied verdict.

### Step 6: Check evidence-tier limits

**Maps to**: AC7.

```bash
npx tsx --test tests/unit/testing/evidence-records.test.ts
```

Read both ledger eligibility statements and their maintained assertions. Verify
that accepted drafts alone cannot meet a human-adjudication condition and that
individual confirmation does not waive other head/cohort/count requirements.
Check that independent provisional promotion triggers retain their prior meaning.

**Expected**: Neither ledger treats owner batch acceptance as individual human
adjudication; this feature introduces no tier engine or approval workflow.

### Step 7: Validate the complete change

**Maps to**: AC9 and regression coverage for AC1–AC8.

```bash
npm run typecheck
npm run lint
npm test
```

Run Markdown lint for changed docs. Record command outcomes, the implementation
head SHA, test case references and the residual proof below. Ensure the exercised
commands used fixture seams only; do not invoke review, control-pass or model
experiments. Leave committed production evidence untouched by smoke negative
cases and retain useful test output as PR evidence.

## Assertions Checklist

- [ ] AC1: Explicit selections persist through initial capture and adjudication.
- [ ] AC2: Missing/invalid required selection refuses without evidence mutation.
- [ ] AC3: Legacy absence resolves human; explicit invalid never does; unadjudicated stays unconfirmed.
- [ ] AC4: Surviving cohort field-only backfill is proven with prior exclusions accounted for.
- [ ] AC5: Human confirmed and accepted draft figures are separate, including empty groups and exclusions.
- [ ] AC6: Recommendations/summaries identify accepted-draft contribution.
- [ ] AC7: Human-required ledger rules reject drafts and preserve independent criteria.
- [ ] AC8: Individual confirmation changes the current group and retains committed prior evidence.
- [ ] AC9: No model call, GitHub publication or approval workflow is introduced.

## Execution Record

Pending implementation. Record implementation SHA, command PASS/FAIL outcomes,
AC mapping, backfill residual proof and audit commit references here.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Test attempts live GitHub access | Supply the existing fake runGh/evidence seam; do not add credentials. |
| Cohort membership differs from plan | Return the exact diff to the parent before backfill; do not force the expected total. |
| A draft appears confirmed | Inspect the composed report/summary path and provenance resolver before changing evidence. |
| Prior draft cannot be found | Check the committed-before-promotion boundary; uncommitted edits do not prove durable history. |

## Known Limitations

The report normally refreshes resolvability through read-only GitHub calls; this
runbook validates its provenance behavior using injected resolvability evidence,
so it makes no new claim about the present resolvability of historical heads.
