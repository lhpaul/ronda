# Miss verdict provenance — Spec

## Overview

Miss evidence must distinguish an individual human judgment from an assistant's
draft accepted by the owner in batch. Today both can appear as confirmed evidence
despite the human-adjudication rule established by #53. This feature makes that
distinction explicit in records and their consumers, preserving useful draft
evidence without presenting it as human-confirmed.

This is the accepted scope of [#139](https://github.com/lhpaul/ronda/issues/139),
following #136 and #138 under epic #52. LH confirmed the brief without additional
constraints and confirmed that accepted drafts stay outside confirmed counts.
There is no new blocking dependency; the existing miss-evidence capability is
the surface being extended. Field names, stored values, and flag spelling belong
to the implementation plan.

## Use Cases

### Use Case 1: Record how a verdict was reached

**Actor**: Operator recording an adjudication, including an authorized assistant
acting on an owner's batch acceptance.

**Preconditions**: A finding is being recorded or an existing miss record is
being adjudicated; its verdict and rationale are available.

**Steps**:

1. Choose the verdict and explicitly select its provenance through an operator
   option: individual human review or assistant draft accepted by the owner.
2. Save the adjudication.
3. Inspect the saved record or its evidence summary to verify the provenance.

**Postconditions**: Every newly adjudicated record has explicit machine-readable
provenance, including records first captured with a terminal verdict.

**Information shown**: The verdict and its provenance remain distinguishable.

**Actions available**: Inspect evidence, report outcomes, or later record an
individual human confirmation.

**Considerations**: Missing or unrecognized provenance on a new adjudication is
an actionable validation error; it must not silently claim human judgment.
Rationale prose, the invoking actor, and the verdict alone cannot supply it.

### Use Case 2: Read trustworthy quality evidence

**Actor**: Operator consuming the quality report or maintaining evidence tiers.

**Preconditions**: The evidence set may contain individually reviewed records,
accepted drafts, legacy records, or unadjudicated findings.

**Steps**:

1. Generate the quality report or inspect evidence summaries.
2. Read human-confirmed figures alongside separately identified accepted-draft
   figures and their recommendations.
3. Apply the existing sweep and repository-context evidence-tier rules using
   only evidence eligible for those rules.

**Postconditions**: Accepted drafts remain visible but do not enter confirmed
miss counts or satisfy a human-adjudication requirement for tier promotion.

**Information shown**: Separate provenance groups and clear attribution of
recommendations derived from accepted drafts, including mixed-source evidence.

**Actions available**: Use draft recommendations as draft evidence, seek an
individual human review, or retain the current evidence tier.

**Considerations**: Existing stale/unresolvable exclusions and verdict meanings
continue to apply independently of provenance. An empty provenance group shows
zero rather than borrowing figures from the other group.

### Use Case 3: Confirm an accepted draft individually

**Actor**: Human adjudicator.

**Preconditions**: A record carries an assistant draft accepted by the owner.

**Steps**:

1. Review that finding individually and confirm its verdict.
2. Explicitly record individual human review as the current provenance.
3. Inspect the record history and regenerate the evidence report.

**Postconditions**: The record is eligible as human-adjudicated evidence under
the existing eligibility rules; the prior verdict and draft provenance remain
auditable without rewriting verdict history.

**Information shown**: The current provenance and the retained earlier evidence.

**Actions available**: Reassess report counts and human-required evidence tiers.

## Business Rules

- BR1: Provenance has exactly two supported meanings: **Human reviewed** (a
  human judged this record individually) and **Accepted assistant draft** (an
  assistant drafted the verdict and the owner accepted it in batch without
  individual review). These are display labels, not prescribed stored values.
- BR2: Newly recorded adjudications require an explicit provenance selection.
  Unadjudicated findings remain unconfirmed regardless of provenance; this
  feature does not introduce a new verdict or turn capture into adjudication.
- BR3: Legacy records lacking provenance are read as Human reviewed because
  pre-#136 verdicts were entered by people. This compatibility rule applies to
  stored legacy evidence, never to omission on a new adjudication. Explicitly
  invalid provenance is an error, not legacy human evidence.
- BR4: The original 172-record #136/#138 cohort must be accounted for: backfill
  all 170 surviving records identified by their existing delegation statement;
  retain the prior exclusion of the two head-unresolvable records from commit
  `e1cfac7` without recreating them. The surviving records must be marked
  Accepted assistant draft. This one-time
  correction preserves their verdicts, rationale, identities, and history and
  does not classify unrelated records by prose.
- BR5: Accepted assistant drafts are excluded from confirmed miss counts.
  Their figures appear separately next to human-confirmed figures; any
  recommendation using them identifies that contribution as accepted-draft
  evidence. Provenance does not override existing eligibility exclusions.
- BR6: Accepted assistant drafts cannot satisfy human-adjudication requirements
  in either the sweep evidence ledger or the repository-context ledger. This
  does not change independent tier rules that do not require adjudication.
- BR7: An individual human confirmation may change an accepted draft's current
  provenance to Human reviewed without deleting or rewriting verdict history.
  Subsequent consumers use the current recorded adjudication while retaining
  the earlier draft evidence for audit. No automatic promotion occurs from
  owner batch acceptance or from report generation.

## Operational Visibility

- Committed miss records expose current provenance and preserve verdict history.
- The quality report separates human-confirmed evidence from accepted drafts,
  including their recommendation attribution. Evidence summaries must not
  present accepted drafts as human-confirmed.
- The backfill is reviewable as a bounded correction of the 172 known records.
  It creates no GitHub review, comment, check run, model call, or approval flow.

## Acceptance Criteria

- [ ] AC1: For each supported provenance, an operator can explicitly select it
  when adjudicating an existing record or first capturing an adjudicated
  record, and the saved record contains the selected machine-readable value.
- [ ] AC2: Omitted or unrecognized provenance on a new adjudication fails with
  an actionable error and leaves evidence unchanged. Rationale text or the
  verdict cannot silently select a provenance.
- [ ] AC3: A legacy stored record without provenance is interpreted as Human
  reviewed. A stored record with an invalid explicit value is rejected rather
  than counted as human-confirmed; unadjudicated records never count as misses.
- [ ] AC4: The 170 surviving delegation-marked #136/#138 records all carry Accepted
  assistant draft after backfill; the two previously excluded identities remain
  excluded and are accounted for in git history. Their existing verdicts, rationale, identities,
  and history remain unchanged, and unrelated records are not backfilled.
- [ ] AC5: A report over otherwise eligible human-reviewed and accepted-draft
  true-positive records counts only the human-reviewed records as confirmed
  misses and displays the accepted-draft figures separately alongside them.
  An empty group reports zero; stale/unresolvable exclusions still apply to both.
- [ ] AC6: Recommendations based on accepted drafts, alone or mixed with human
  evidence, explicitly identify the accepted-draft contribution. Evidence
  summaries do not describe accepted drafts as human-confirmed.
- [ ] AC7: Accepted drafts alone cannot satisfy any human-adjudication condition
  for promotion in the sweep or repository-context ledger. Other existing
  tier criteria remain necessary and unchanged after a human confirmation.
- [ ] AC8: A human can individually confirm an accepted draft, changing its
  current provenance to Human reviewed while retaining the prior verdict and
  draft provenance in auditable history. A regenerated report moves an otherwise
  eligible record between groups without double counting.
- [ ] AC9: Adjudication, backfill, and report verification require no model call
  or GitHub publication and introduce no approval workflow.

## Brief Objective List and Coverage Matrix

| Objective from #139 | Coverage |
| --- | --- |
| O1: Closed provenance choice, explicitly selected during adjudication | BR1–BR3; AC1–AC3 |
| O2: Backfill the 172 delegated #136/#138 records | BR4; AC4 |
| O3: Split reports and label draft-derived recommendations | BR5; AC5–AC6 |
| O4: Prevent drafts satisfying human-required evidence tiers | BR6; AC7 |
| O5: Permit later human confirmation without rewriting verdict history | BR7; AC8 |
| O6: Treat missing legacy provenance as human | BR3; AC3 |
| O7: Keep scope small without an approval workflow | AC9; Out of Scope |

## Out of Scope (MVP)

- New approval workflows, permissions systems, user interfaces, notifications,
  analytics collection, or automated adjudication.
- Changes to verdict meanings, review prompts, default models, or live reviews.
- Rebuilding the evidence-tier measurement system or relaxing its other rules.
- Stored field/value names, option spelling, and persistence design; the plan
  settles these implementation choices. All brief objectives remain in scope;
  there are no deferred product requirements.
