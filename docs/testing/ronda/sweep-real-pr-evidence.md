# Real-PR evidence record — category-forced review sweep

Issue: [#105](https://github.com/lhpaul/ronda/issues/105) (epic #52).
Companion documents: `sweep-categories.json` under this directory (the
category list this record's counts accrue under),
[`sweep-effect-evidence.md`](sweep-effect-evidence.md) (the seeded-fixture
evidence), [`105-category-forced-review-sweep.smoke-test.md`](105-category-forced-review-sweep.smoke-test.md)
(the runbook).

This is the **evidence-tier record**: the operator-maintained ledger that says
how far the sweep's real-pull-request evidence has accumulated and which claims
that evidence admits. Nothing in the product counts it, promotes it, or reads
it — the tier and the counted total are entered by hand, on the rule this
document states, and a `docs/testing/ronda/` evidence document is the only
place they can be recorded. There is no automation that could drift from this
record, and no automation that would catch the record drifting from the spec.

## Current state

| Field | Value |
| --- | --- |
| Evidence tier | `fixture_only` — Fixture evidence only |
| Counted pull requests under the current list version | `0` |
| Current category list version the count accrues under | `sweep-categories-v1` |
| Date this state was recorded | 2026-09-28 |
| Counted-pull-request total at the prior list version | none — `sweep-categories-v1` is the initial version, so no count preceded it |

The tier is `fixture_only` because **no sweep-enabled real pull request review
has been recorded**. That is the only thing that promotes the tier out of
`fixture_only`, and it has not happened: this repository's own pull requests
were reviewed with the sweep available, but none of those reviews is recorded
here as a counted sweep-enabled real-PR review, so the count is zero and the
tier stands at the bottom.

At this tier the only admissible evidence is fixture evidence — the seeded
benchmark and the precision fixtures. It may support claims about seeded recall,
variance, precision, and cost. **It may not support any claim about effect on
real pull requests.**

### No real-pull-request effect claim is made

**This record makes no real-pull-request effect claim, and none may be read out
of it.** The counted total is zero, so no real-PR observation of any kind has
been recorded — not a descriptive one, not a comparative one. The figures in
[`sweep-effect-evidence.md`](sweep-effect-evidence.md) are fixture figures and
are labeled as fixture figures there; they are not evidence about real pull
requests, and citing them as such here would state an effect the evidence has
not earned.

## The two caveats every claim here carries

### Independence caveat

Ronda's evidence is drawn from **Ronda's own repository**. Ronda reviewed its
own pull requests; the same project wrote the review configuration, the
benchmark seeds, and the reviews being compared. That is not an independent
sample of how the sweep behaves on someone else's code, and it cannot be
presented as one.

### Own-repository label

Every effect claim built on this repository's evidence is labeled
**"own-repository"**. No claim anywhere in this record or in
[`sweep-effect-evidence.md`](sweep-effect-evidence.md) asserts corroboration in
another repository, and none is required (AC16). The label is not a hedge on a
weak result — it names the population the result came from, which is the only
population from which it was measured.

## Adjudication outcomes

Adjudication is a **human act recorded by hand**, not a count the product
derives. An operator reads a compared finding, decides what it is, and enters
the outcome. No process infers an outcome, promotes a tier, or counts a pull
request on its own.

This feature's own two code values cover the cases the dependency contract's
five-value vocabulary (`ronda_miss`, `ronda_better`, `duplicate`,
`clean_agreement`, `unclear`) leaves open.

| Code value | Display label | Applied when |
| --- | --- | --- |
| `ronda_only` | Ronda-only finding | A valid defect the sweep-enabled review or a recorded sweep-off control reported and the external reviewer did not. It represents a valid defect and is terminal, so a finding carrying it counts toward the confirmed-defect denominator. |
| `ronda_rejected` | Ronda finding rejected | A finding the sweep-enabled review or a recorded sweep-off control reported that human adjudication rejects as a false positive **or** records as out of scope of the sweep's claim. Both states lie outside the sweep's claim universe the denominator is drawn from, so neither is a confirmed defect for the measurement. It is terminal, so a finding carrying it leaves both the denominator and that configuration's numerator. |

`ronda_rejected` covers two distinct human decisions under one code because
both land in the same place for the count: a rejected false positive is not a
defect at all, and an out-of-scope finding is a real defect outside the claim
the sweep made — counting it as a miss would state a miss for a defect the
sweep never claimed to cover.

The external-reviewer-origin equivalent is the dependency contract's
`ronda_better`, which applies only when the external reviewer alone raised the
finding. An adjudication that rejects a finding **Ronda's own review raised**
records `ronda_rejected`, not `ronda_better` — including when both reviewers
raised it, since `ronda_better` describes an external-only finding Ronda was
right to omit and so cannot describe a finding Ronda also raised.

The dependency contract's `unclear` is **not terminal**. A pull request whose
compared findings carry an `unclear` outcome is not adjudicated, does not count
toward the total, and does not promote the tier.

### Application record

No adjudications have been applied. The counted total is zero, so there is no
compared finding in this record to carry either code value. Both values above
are recorded here as the vocabulary the operator applies when adjudication
begins; an entry appears under this heading only when a human has entered one,
with the finding it adjudicates and the reason for the decision.

| Pull request head | Finding | Code value | Decided by | Date |
| --- | --- | --- | --- | --- |
| _(none recorded)_ | | | | |

## Terminal miss record

A head whose compared reviewers all reported no findings, but whose human
adjudication records a defect within the sweep's claim that none of them
reported, is not a clean result — and no compared finding exists for that
defect to carry an outcome. That head takes a **terminal miss record**: a
head-level adjudication record, not a compared finding's outcome. These code
values are not values of the adjudication-outcome enum above; that enum
adjudicates a compared finding, while this record adjudicates a head that
carries none.

| Code value | Display label | Meaning |
| --- | --- | --- |
| `sweep_enabled_miss` | Sweep-enabled review miss | The sweep-enabled review's miss of that recorded defect. It represents a confirmed defect the sweep-enabled review did not report and is terminal, so the head is terminally adjudicated for it and the defect enters the confirmed-defect denominator. |
| `external_review_miss` | External review miss | The external reviewer's miss of that recorded defect. It represents a confirmed defect the external review did not report and is terminal, so the head is terminally adjudicated for it. |
| `sweep_off_miss` | Sweep-off control miss | The recorded sweep-off control's miss of that recorded defect, recorded whenever a sweep-off control is among that head's compared reviewers. It represents a confirmed defect the control did not report and is terminal, so the head is terminally adjudicated for it and the defect enters the denominator, which reads the sweep-off arm's recall over it. |

`sweep_enabled_miss` and `external_review_miss` are recorded **together** — the
defect was missed by the sweep-enabled review and by the external reviewer
alike — so a head is terminally adjudicated on this record only when both are
present. `sweep_off_miss` is recorded in addition whenever a recorded sweep-off
control is among that head's compared reviewers, so the control's own miss is
adjudicated rather than left for an implementation to invent a code for or
skip.

### Application record

No terminal miss records have been recorded. The counted total is zero, so no
compared head exists in this record.

| Pull request head | Recorded defect | Code values | Decided by | Date |
| --- | --- | --- | --- | --- |
| _(none recorded)_ | | | | |

## Evidence tiers

| Code value | Display label | What it means |
| --- | --- | --- |
| `fixture_only` | Fixture evidence only | Evidence comes from the seeded benchmark and precision fixtures. It may support claims about seeded recall, variance, precision, and cost; it may not support claims about real-pull-request effect. |
| `real_pr_provisional` | Real-PR evidence (provisional) | At least one sweep-enabled real pull request review has been recorded, but fewer than ten counted pull requests have accumulated under the current category list version. Findings are indicative only, support no effect claim, and are labeled as such. |
| `real_pr_measured` | Real-PR evidence (measured) | At least ten counted pull requests have accumulated. Descriptive real-pull-request claims are permitted, with the independence caveat and the own-repository label. Comparative effect claims additionally require a matched sweep-off control on the same pull request heads. |

**Current tier: `fixture_only`.** The row above is the tier this record stands
at; the other two are the tiers it can reach, on the rules below.

## Transition rules

| From | Event | To |
| --- | --- | --- |
| `fixture_only` | First sweep-enabled real pull request review recorded (one whose pass actually ran the sweep) | `real_pr_provisional` |
| `fixture_only` | Category list revised | unchanged — a revision cannot leave `fixture_only`, since the tier is driven by whether any sweep-enabled real-PR review is recorded, which a revision does not undo |
| `real_pr_provisional` | Tenth counted pull request accumulated under the current list version | `real_pr_measured` |
| `real_pr_provisional` | Category list revised | unchanged — the tier stays `real_pr_provisional` and the counted pull requests restart at zero |
| `real_pr_measured` | Counted pull requests fall below ten, whether by a list revision or by a sweep-off control recorded on a head whose adjudication it reopens | `real_pr_provisional`, until the count is restored |
| any | Every other reachable combination | unchanged |

No combination promotes a tier except the first recorded sweep-enabled real
pull request review and the tenth counted pull request.

### The list-revision restart rule

**A category list revision restarts the counted pull-request total at zero
while the tier follows its own rule above:**

- **`fixture_only`** — tier unchanged, count unchanged at zero (it was already
  zero).
- **`real_pr_provisional`** — tier unchanged, count restart at zero.
- **`real_pr_measured`** — tier demoted to `real_pr_provisional`, count restart
  at zero, until ten pull requests have accumulated under the revised list.

The **counted total is written against the new list version**, and the revised
list's version is recorded as the current one the count now accrues under. The
**prior version's count is kept as the prior version's evidence rather than
carried forward.** A count accrued under `sweep-categories-v1` is not evidence
about `sweep-categories-v2` — the two lists sweep different categories, so a
finding counted under one is not a finding under the other, and carrying the
number forward would back a claim the new list has not earned.

**This record carries no prior-version count**, because `sweep-categories-v1`
is the initial version and no count preceded it. The first revision will be the
first test of this rule, and the prior version's total will be recorded in the
row below when it happens.

| List version | Counted pull requests | Tier while current | Notes |
| --- | --- | --- | --- |
| `sweep-categories-v1` | `0` | `fixture_only` | current version; recorded 2026-09-28 |

### The ten-count rule

`real_pr_measured` is assigned only when at least ten counted pull requests
exist under the current recorded category list version. The eligible cohort is
the pull requests that carried a sweep-enabled review under that version up to a
**recorded cutoff fixed in advance, before any eligible pass's findings are
visible**. The cutoff and the eligible heads are recorded before those passes'
review results are observed, and the cohort is closed before adjudication, so it
cannot be chosen after seeing outcomes. Every pull request in it must reach a
terminal adjudication before the label is assigned. An adjudication is terminal
only when every compared finding carries `ronda_miss`, `ronda_better`,
`duplicate`, or a Ronda-only outcome (`ronda_only`) or a Ronda finding rejected
outcome (`ronda_rejected`), or when the clean result `clean_agreement` is
confirmed, or when the head's [terminal miss record](#terminal-miss-record) is
complete: `sweep_enabled_miss` and `external_review_miss` recorded together,
plus `sweep_off_miss` where a recorded sweep-off control is among the head's
compared reviewers. An `unclear` outcome is not terminal, because the dependency
contract defines it as needing more human review before it can be used as
quality evidence — so a pull request whose compared findings carry an `unclear`
outcome is not adjudicated, and ten such pull requests do not reach the label.

## Claim admissibility at the current tier

| Claim | Admissible at `fixture_only`? |
| --- | --- |
| Seeded recall, variance, precision, cost (fixture evidence) | Yes — recorded in [`sweep-effect-evidence.md`](sweep-effect-evidence.md) |
| Real-pull-request descriptive claim | No — the tier admits no real-PR claim of any kind |
| Real-pull-request comparative effect claim | No — requires `real_pr_measured`, a matched sweep-off control on the same pull request heads, a closed terminally adjudicated cohort, equal run counts, named metrics, and a non-zero confirmed-defect denominator |

A claim that lacks anything it requires is **omitted**, not recorded as
not-applicable. A zero confirmed-defect denominator leaves recall and variance
figures **reported as not applicable** rather than reported as zero.

## What this record does not resolve

- **The tier is an operator read, not a count.** Nothing here is verified
  against a system of record, because no system of record exists. The honesty
  of this document is the operator's, and the pull-request list behind any
  future non-zero count is the operator's to keep.
- **The independence caveat is not resolvable from inside this repository.**
  Ronda reviewing Ronda's own pull requests cannot become independent evidence
  by being counted more carefully — only by being counted somewhere else, which
  this record cannot do.
- **A list revision's effect on accumulated evidence is arithmetic, not
  judgment.** The rule zeroes the count. Whether the prior list's evidence was
  any good is a separate question this record does not answer and does not
  need to — the count accrues under one version at a time.
