# Miss verdict provenance — Implementation Plan

**Spec**: [Approved spec](1_miss-verdict-provenance_specs.md)
**Smoke test runbook**: [Offline verification](../../../testing/ronda/miss-verdict-provenance.smoke-test.md)

## Summary

**Approach**: Add a closed provenance field and explicit operator option, thread
it through capture and adjudication, and partition miss evidence at report and
summary consumption. Backfill the surviving delegated cohort and document
human-only eligibility in the existing evidence ledgers.

**Estimated complexity**: M — the schema change is small, but capture has both
new/existing and manual/automatic paths, and both report consumers need coverage.
**Dependencies**: Spec PR #164 is merged. No new service or library dependency.
Protocol 02 Step 2 applies: the approved scope has no unresolved architectural
choice; continue with the authorized delegated policy.

## Verification Log

All repository evidence below was inspected at
`4c27346acdb140981ef6a292cadedb93ccf29130` on 2026-10-21 UTC.
Commands run from the repository root; use that revision to reproduce them.

| Check | Command / query | Result |
| --- | --- | --- |
| Template fit / ownership | `rg -n 'is_template:|^mode:|type_field:' .ai-dev-workflow.yaml` | Template false; omitted mode means single repo, current repository owns artifacts; tracker field Work type. |
| Data and audit seam | `rg -n 'interface ExternalReviewMissRecord|durable audit|readMissRecordFile|loadAllMissRecords|writeMissRecord' src/quality/miss-record.ts` | JSON schema, readers/writer, and declared git-history audit exist here. |
| Consumer discovery | `rg -n 'mergeJudgementFields|readMissRecordFile|loadAllMissRecords|readMissRecords|missRows\(|buildReviewQualityReport|summarizeMissRecords|adjudicateMissRecord' src tests` | Production consumers enumerated in the Composed consumer outcomes table below; tests under unit/cli and unit/quality exercise these seams. |
| Capture propagation | `rg -n 'automaticDefaults|automaticPerFinding|resolveAutomaticFindingJudgements|mergeJudgementFields|verdict:' src/quality/miss-capture-gate.ts src/cli/capture-external-review-misses.ts` | Both initial capture branches, both existing-record merge branches, and per-finding automatic judgment propagation require the field. |
| Report / recommendations | `rg -n 'missRows|primaryOutcomes|confirmedMiss|followUpCounts|suggestedActions|breakdowns' src/quality/review-quality-report.ts src/cli/summarize-review-comparisons.ts` | Report classification, breakdowns and recommendations, plus summary verdict counters consume miss judgments. |
| Human-tier surfaces | `rg -n 'human|adjudicat|tier|counted' docs/testing/ronda/sweep-real-pr-evidence.md docs/testing/ronda/repository-context-effect-evidence-106.md tests/unit/testing/evidence-records.test.ts` | Existing manually maintained ledger rules and their committed assertion tests; extend these surfaces, rather than building a tier engine. |
| Documentation discovery | `rg -n 'quality:misses|adjudicat|miss records|External-review miss' README.md docs/project/*.md docs/testing/ronda/*.md` | Documentation update list below follows the active commands, report and ledger surfaces; dated report retains historical context. |
| Original cohort | `git ls-tree -r --name-only 17fdc97 -- docs/testing/ronda/misses` | 172 JSON records plus .gitkeep at original adjudication commit. |
| Prior removals | `git show --name-status e1cfac7 -- docs/testing/ronda/misses` | Deleted #118 identities `lhpaul-ronda-pr-118-auto-2cbd9dba3787` and `lhpaul-ronda-pr-118-auto-ef4f04586a01`; reviewed heads could not be resolved. |
| Removal explanation | `sed -n '40,63p' docs/testing/ronda/quality-report-2026-09-30.md` | Method records the prior removal, manual recapture and head-unresolvable exclusions. |
| Current backfill enumeration | Python query below | 170 JSON records, every one matching the exact marker; PR 107: 9, 115: 84, 117: 41, 118: 23, 119: 13. Query outputs the actual path/id membership, which governs edits. |
| Design discovery | `gh issue view 139 --json body` and `rg --files docs/specs/developments/20261021214305_miss-verdict-provenance` | Item has no design-asset section, attachment/link pointers or assets directory; CLI/data work has no visual baseline. |
| Test seams | `rg --files tests` and `rg -n 'createGhFixture|runGh|mkdtempSync' tests/unit/cli/capture-external-review-misses.test.ts` | Existing deterministic test files named in Testing Strategy and injectable GitHub fixtures permit offline command coverage. |

The following is a **read-only enumeration**, not the backfill implementation:

```python
import json
from collections import Counter
from pathlib import Path

marker = "Verdict drafted by the assistant and accepted by LH without per-record review (delegated 2026-09-30)."
rows = [(p, json.loads(p.read_text())) for p in sorted(Path("docs/testing/ronda/misses").glob("*.json"))]
selected = [(p, r) for p, r in rows if marker in r.get("rationale", "")]
for path, record in selected:
    print(path, record["id"])
print("all JSON records", len(rows), "selected", len(selected))
print(sorted(Counter(r["pullNumber"] for _, r in selected).items()))
```

Run it using Python with the displayed body on standard input. This is the
one-time cohort selector; runtime provenance resolution never scans rationale.
Re-run the query before implementation and compare membership with this revision;
unexpected additions/removals require parent reconciliation before backfill.

## Cross-Cutting Operational Assumption Check

| Surface | Recorded value / source | Verified at | Bounded scope | Result |
| --- | --- | --- | --- | --- |
| Artifact owner and approved base | single_repo, lhpaul/ronda, develop; repository architecture, manifest and parent invocation | 2026-10-21T21:52:51Z, evidence revision above | Invocation [139]; same-surface spec PR #164 merged into develop; parent reports no other open PR affecting this surface | Verified |
| Delegated cohort inventory | Historical cohort 172; current survivors identified by query; original adjudication, prior deletion commit and dated report cited in Verification Log | Same verification time/revision | Item #139 and spec #164 only | Resolved |

The inventory discrepancy affects spec BR4, AC4 and other numeric references.
The parent orchestrator resolved it as a factual repair: preserve the original
cohort objective, backfill every surviving marked record, account for the prior
excluded identities in git history, and never recreate them. Correct the spec's
numeric wording first in the feature implementation PR; this plan PR changes
only planning artifacts. Decision owner: parent orchestrator acting within LH's
confirmed brief. No product requirement is dropped.

At implementation start, verify manifest ownership/base and the bounded cohort
sources before edits; a changed/unverifiable source returns to the parent before
implementation proceeds. No environment, host or deployment assumption is used.

## Layer-by-Layer Changes

### Data contract and shared provenance policy (AC1–AC3, AC8)

Add `src/quality/miss-verdict-provenance.ts` as a small dependency-free home for
`MISS_VERDICT_PROVENANCES`, `MissVerdictProvenance`, validation and read-time
resolution. The sole persisted property is optional `verdictProvenance`, whose
stored values are `human` and `assistant_drafted_owner_accepted`. Display labels
are Human reviewed and Accepted assistant draft. Add the property to both
`ExternalReviewMissRecord` and the report's compatible `CapturedMissRecord`.
This module avoids introducing a runtime cycle through miss-record's existing
import of the report's default directory constant.

The read resolver accepts genuinely absent legacy properties as human. Explicit
empty, null, unknown and wrong-type values are errors, including values on
unadjudicated or stale rows; validate before eligibility exclusions. Do not
persist a synthetic human value merely by loading a legacy record. Use it in
both JSON reader families and direct report/summary processing so typed callers
cannot bypass validation. Report loading may use its existing skipped-file
mechanism, but must identify invalid provenance and exclude that evidence;
summary/read command paths must fail clearly rather than count invalid input.

### Capture and adjudication commands (AC1–AC3, AC8–AC9)

Extend `src/cli/capture-external-review-misses.ts` with one option,
`--verdict-provenance <value>`, available to capture, capture-manual and
adjudicate. Thread it through `src/quality/miss-capture-gate.ts` input types,
automatic defaults/per-finding judgments, initial records and
`mergeJudgementFields`. For multi-finding capture the option selects provenance
for each supplied terminal judgment; no second per-finding flag is introduced.

The following table is canonical for write semantics. Validate provenance enum
inputs before writing the affected record; existing sensitive-content, identity,
reviewed-head and capture-stage gates retain their order and authority. A refused
finding must leave its existing file unchanged; automatic siblings retain the
existing per-finding outcome behavior.

| Operation / input class | Provenance requirement and result |
| --- | --- |
| Initial manual/automatic capture with terminal verdict | Explicit valid option required; store it with the supplied verdict. Missing/invalid input refuses the affected write. |
| Initial capture unadjudicated | No option required; omitted property remains absent. Valid supplied property may be retained, but cannot establish adjudication. |
| Existing capture with explicitly supplied terminal verdict, even unchanged | Explicit valid option required; update judgment and property together. |
| Existing capture omitting terminal judgment / supplying default unadjudicated | Preserve retained verdict and property; never promote an accepted draft from recapture defaults. |
| Adjudicate supplying terminal verdict | Explicit valid option required, plus existing rationale/scanning requirements. |
| Adjudicate provenance-only on existing terminal verdict | Valid option plus rationale permitted; preserve verdict, identity and follow-up. This is the individual confirmation path. |
| Adjudicate follow-up-only | Preserve current property without requiring or inventing provenance; existing rationale requirement remains. |
| Adjudicate provenance on unadjudicated record without terminal verdict | Refuse as no terminal judgment to confirm; no implied verdict. |
| Any explicit invalid provenance | Refuse without mutation, regardless of other defaults. |

The general any-invalid row has precedence over the successful rows, after any
earlier existing refusal. Missing provenance is required only in the rows naming
terminal judgment submission. Existing prohibition on reverting a verdict to
unadjudicated remains. Provenance-only plus follow-up on a terminal record uses
the same explicit selection semantics. Preserve the human/accepted choice
explicitly even when a verdict is unchanged.

Durable audit uses the existing committed JSON history, without a new history
array: promotion changes the current property and ordinary adjudication metadata
through the existing writer. Commit the backfill before later promotions; a
later human-confirmation commit retains the prior draft property/verdict in its
parent revision. Documentation must make this commit boundary explicit so an
uncommitted sequence cannot be presented as durable history. Do not rewrite
prior commits, rationale history or previously stored verdicts during backfill.

### Report, summary and recommendation consumers (AC3, AC5–AC6, AC8)

In `src/quality/review-quality-report.ts`, resolve each miss row's provenance
before classification and retain it on classified miss evidence. Existing
`primaryOutcomes`, breakdowns and `improvement.topMissedCategories` represent
human evidence for miss-derived judgments; comparison records retain their
existing semantics and are not assigned miss provenance.

Add an `acceptedAssistantDrafts` report section with outcome counts, category /
repository / reviewer breakdowns and drill-down references. Give both provenance
groups explicit headings and zero-initialized verdict buckets in Markdown and
JSON, adjacent to each other. Accepted drafts are neither human confirmed nor
unclear merely because of provenance. Keep global input counts and stale /
unresolvable diagnostics independent, while excluding those rows from eligible
outcome/recommendation statistics in either group.

Recommendations in `improvement.suggestedActions` must carry explicit source
attribution in text and structured output, including contributing record IDs.
Partition miss-category recommendations by human and accepted-draft contribution;
any combined action must name both contributions, never call its combined total
confirmed. Keep follow-up totals clearly descriptive of requested actions and
split/label their provenance rather than imply confirmation. Preserve existing
report filters for both groups and recommendation evidence; no recommendation
may import an out-of-scope row into a filtered group.

In `src/cli/summarize-review-comparisons.ts`, keep existing `confirmedMisses`,
verdictOutcomeCounts and categoryBreakdown human-only for miss records and add a
separately labelled acceptedAssistantDrafts rollup with analogous counters.
Keep its overall stale/unresolvable/input diagnostics independent. CLI `read`
and emitted capture/adjudication JSON expose the current property; legacy human
interpretation is labelled in read/help documentation without altering files.

### Composed consumer outcomes

This table discharges Rule 5 for the shared validation and merge changes. Its
membership comes from Consumer discovery / Capture propagation in Verification
Log; test imports exercise these same public paths.

| Consumer site and producing path | Observable result |
| --- | --- |
| Capture CLI automatic defaults and buildAutomaticPerFinding → runCaptureDecisionGate → automatic new/merge branch → writer | Canonical write table applies to each candidate, including multi-finding terminal judgments; refusal cannot silently write human provenance. |
| Capture CLI manualFinding → runCaptureDecisionGate → manual new/merge branch → writer | Same write table; omitted recapture judgment preserves draft state and identity. |
| Capture CLI adjudicate → adjudicateMissRecord → writer | Explicit terminal/promotion selection changes the current property; follow-up-only preserves it; rationale/content gate can still refuse before any write. |
| loadAllMissRecords → capture identity matching / CLI read / findRecordById | readMissRecordFile validates explicit values; absent legacy value stays unpersisted; invalid record cannot be reclassified human. |
| readMissRecordFile direct path fallback in findRecordById | Same reader policy before an adjudication can act on that record. |
| readMissRecords → loadQualityRecords → report CLI → buildReviewQualityReport → formatter | Invalid files appear in skipped diagnostics; valid records partition into the report groups; filters and exclusions apply before eligible counts/recommendations. |
| readMissRecords → summary CLI → summarizeMissRecords | Invalid input fails clearly; valid evidence uses the summary partition. |
| Direct buildReviewQualityReport / summarizeMissRecords callers | Resolve/validate in processing, not just file loading, so in-memory draft and invalid rows receive the same classification. |
| Existing comparison row / comparison summary consumers | Continue their current adjudication semantics; miss provenance does not reclassify comparison records. |

No stale or unresolvable branch is removed; provenance partition adds no route
around either exclusion. No inference, review publication, workflow, model,
configuration or credential handling code changes are needed.

### Bounded backfill and evidence ledgers (AC4, AC7–AC9)

Use the exact-marker membership enumeration and inventory resolution above.
Apply only the new property to each selected existing JSON record; preserve all
other parsed fields and filenames, including timestamps. Do not introduce a
runtime prose heuristic or a reusable migration framework.

Before readiness produce a residual verification record against the pre-backfill
revision: enumerate selected paths, compare selected ID/path sets, remove only
verdictProvenance from each before/after parsed object and assert equality, then
assert the property has the selected draft value on every survivor. Confirm no
unselected file changed and account for both prior deletions via their cited
history. This field-only comparison, not merely a successful count, is the
backfill acceptance evidence. Keep the backfill as its own coherent commit.

Update the existing sweep and repository-context ledgers' human-required
adjudication eligibility and their maintained assertion coverage. A terminal
accepted draft cannot fulfill a counted head's human-adjudication requirement;
individual confirmation only makes evidence eligible for the other unchanged
head/cohort/tier rules. Preserve independent provisional promotion triggers that
do not require adjudication. Dated report prose needs a dated provenance
correction/reference without pretending a new live resolvability check occurred.

## Testing Strategy

**Types**: deterministic unit and command integration through existing seams,
plus the linked offline smoke runbook. No model or live GitHub pass is needed.

| Existing test file / new seam | Coverage intent | AC |
| --- | --- | --- |
| tests/unit/quality/miss-capture-gate.test.ts | Both closed values; omitted/invalid new adjudication; initial manual/automatic; retained recapture judgment; provenance-only and follow-up-only; no mutation on refusal | AC1–AC3, AC8–AC9 |
| tests/unit/cli/capture-external-review-misses.test.ts | Option parsing/help, propagation through automatic default/per-finding and manual/adjudicate entrypoints, persisted property and refusal file equality using fake runGh | AC1–AC2, AC8–AC9 |
| tests/unit/quality/review-quality-report.test.ts | Mixed/empty/legacy/invalid groups, explicit invalid before exclusions, filtered recommendations, mixed-source attribution, stale/unresolvable rows, comparison stability, JSON and Markdown output | AC3, AC5–AC6, AC8 |
| tests/unit/cli/summarize-miss-records.test.ts | Human-only existing totals and adjacent draft rollup; legacy/invalid; exclusions; promotion moves one row without double counting | AC3, AC5–AC6, AC8 |
| tests/unit/testing/evidence-records.test.ts | Existing ledger assertions include human-only provenance eligibility and preserve independent tier triggers/current counts | AC7 |
| Backfill residual record and git diff | Field-only membership proof described above; preserved history and excluded identities | AC4, AC8 |

Test sets are indicative; coverage-equivalent cases may be combined. Use small
in-memory records and existing fake GitHub seams, not a parallel fixture matrix
or parser. A pure resolver test may be added beside the quality tests if that
improves clarity. For each materially added validation assertion, record an
isolating invalid input that fails and its valid counterpart that succeeds;
existing gate tests are the proof harness, not new workflow tooling.

**Seed data**: extend test-local miss builders in the named files with human,
accepted-draft, legacy-absent, explicit-invalid and unadjudicated variants;
paired same-head/stale/unresolvable inputs use existing fake evidence. Temporary
capture records live under test-owned directories, never the committed corpus.
The promotion scenario begins from a draft record committed before promotion
and checks its earlier git version in a disposable test repository or manual
offline smoke evidence, without rewriting repository history.

**Classifications**: parser-risk not applicable (closed enum/property addition,
no regex scanner or parser module); concurrent-event-source not applicable (no
new event listener, queue or cross-context mutable state); cross-cutting
checklist and complex workflow decision gate not applicable (product evidence
policy, no changes to development workflow gates). No public HTTP API changes.
The plan has a stateful write contract, so matrix coherence preflight applies.

**Gate B self-check**: focused extensions to current business-rule tests and one
field-only residual comparison are proportionate; no custom documentation
parser, exhaustive Cartesian fixture table or new E2E scaffolding is proposed.
Ronda has no browser surface; its Playwright placeholder is not extended.

## Documentation Updates

Implementation updates these files; this plan stage only identifies them:

- The linked spec — factual cohort repair described in the inventory resolution.
- README.md — operator flag, provenance semantics and individual confirmation.
- docs/project/3-software-architecture.md — miss-evidence consumption policy.
- docs/testing/ronda/capture-external-review-misses.smoke-test.md.
- docs/testing/ronda/56-report-review-quality-vs-external.smoke-test.md.
- docs/testing/ronda/quality-report-2026-09-30.md — historical correction noted above.
- docs/testing/ronda/sweep-real-pr-evidence.md.
- docs/testing/ronda/repository-context-effect-evidence-106.md.
- The linked smoke runbook — execution results and backfill residual evidence.
- changelog.d/139.added.miss-verdict-provenance.md — feature release note.

AGENTS.md, constitution, other project/best-practice documents and adoption
instructions need no changes: product review/publication and credential contracts
are unaffected; this contract belongs beside the quality commands and ledgers.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| Missing property confuses new input with legacy evidence | Separate read resolution from explicit write validation; test both through command paths. |
| A retained draft is promoted by a default capture/follow-up | Canonical write table and composed tests cover merge retention and provenance-only promotion. |
| A summary or recommendation still counts drafts as human | Shared policy plus full consumer enumeration and filtered/mixed-source assertions. |
| Backfill changes judgment evidence or revives exclusions | Field-only residual proof and inventory resolution; separate audit commit. |
| History is lost before a human promotion is committed | Document and verify the committed-before-promotion boundary under the existing git audit contract. |

## Implementation Order

1. Verify the recorded operational facts and cohort membership; apply the
   feature-stage spec factual correction from the parent resolution.
2. Implement Data contract and shared provenance policy, then Capture and
   adjudication commands with their focused tests. Validate meaningful behavior
   through the composed command seams; commit this coherent sub-part.
3. Implement Report, summary and recommendation consumers and its tests. Check
   rendered and structured groups, exclusions and source attribution; commit.
4. Perform Bounded backfill and evidence ledgers: backfill first as a standalone
   field-only commit with the residual evidence, then document ledger eligibility
   and other Documentation Updates with maintained tests and release fragment.
5. Run `npm run typecheck`, `npm run lint`, `npm test`, Markdown lint for changed
   docs, and the linked offline smoke. Record AC coverage and residual audit
   before requesting readiness. Do not run review, control-pass or experiments.

## Authoring evidence

Rule 1 is not applicable: no design is derived from an open external free-text
output distribution. The backfill exact-marker selector is a bounded committed
correction authorized by the spec, never a general runtime classifier.
Rule 2 cross-read found one canonical write table and no contradictory values;
other sections reference their named contract rather than redefine transitions.
Rules 3 and 4 use the revision-scoped live queries and cohort enumeration above.
Rule 5 is discharged in Composed consumer outcomes, including unchanged branches.
Rule 6's conditional obligations name their operation/input class and discharge
site in the write table, readers, implementation-start check and residual audit.

Matrix coherence preflight: overlapping operation rows have explicit invalid
precedence; missing states include legacy/unadjudicated/follow-up/promotion;
existing refusals retain authority; malformed values are errors; current stored
provenance controls counting and committed history controls audit; each write
ends in a saved result or actionable refusal without a waiting approval state.
