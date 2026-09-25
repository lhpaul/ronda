# Category-Forced Review Sweep, Scoped On Real-PR Evidence - Spec

**Depends on**: 24-review-quality-benchmark-suite, 53-capture-external-review-misses

---

## Overview

Ronda reviews a pull request with a single open-ended pass: nothing obliges the
reviewer to consider a fixed set of defect kinds, so what it looks for changes
between runs. On the seeded benchmark of 2026-09-10 the same fixture produced
between 6 and 8 of 13 seeded defects across five identical runs, and four seeded
kinds were missed in every run.

This feature makes Ronda sweep each review across an explicit, recorded list of
defect categories instead of leaving coverage to chance, with the expectation
that recall rises and run-to-run variance falls. The category list is a product
artifact in its own right: it must be justified by what real pull requests
actually contain, recorded where an operator can read it, and revisable when
better evidence arrives.

The feature also covers the evidence that makes the change judgeable — recall,
run-to-run variance, precision, and cost — and the benchmark fixture work needed
before the seeded benchmark can be trusted as a regression gate again. Ronda's
review contract is unchanged: comment-only, one review per head SHA, all
findings in that one review.

---

## Use Cases

### Use Case 1: Ronda Sweeps A Pull Request Across The Recorded Category List

**Actor**: Ronda (acting for the operator who enabled the sweep)

**Preconditions**:

- A recorded sweep category list exists and is marked current.
- The sweep is enabled for the repository being reviewed.
- Ronda has been asked to review a pull request head, through any of its normal
  review triggers.

**Steps**:

1. Ronda starts a review pass for the pull request head.
2. Ronda considers the changed content against every category on the current
   sweep category list, in addition to anything else it would otherwise report.
3. Ronda records, for each category, whether it produced findings or explicitly
   produced none, on the operator-facing evidence surface rather than in the
   published review body.
4. Ronda publishes one review for that head SHA containing every finding from
   the pass.

**Postconditions**:

- Every category on the current list was considered for that head.
- All findings, whatever category prompted them, appear in one review for that
  head SHA.
- The pass records that the sweep ran and which version of the category list it
  used.

**Information shown**:

- The published review: findings with their locations and severities, as in a non-sweep review.
- The review summary: that the category-forced sweep was active and which
  category list version was used.
- The operator-facing evidence surface: which categories produced findings for
  that pass and which produced none.

**Actions available**:

- Read the review on GitHub, as for a non-sweep review.
- Disable the sweep for the repository; passes for later heads then run
  without it. A head that already has its one review is not reviewed a second
  time because the sweep was toggled.

**Considerations**:

- "No finding for this category" is a normal, expected result for most
  categories on most pull requests. The sweep must never push Ronda toward
  producing one finding per category.
- A category that does not apply to the changed content at all (for example, a
  documentation-only change) is simply reported as producing no findings; it is
  not an error.
- Existing review behavior is unchanged in every other respect: comment-only, no
  branch or pull request mutation, one review per head SHA, draft-skip and
  supersede behavior as in a non-sweep review.
- Findings stay on the ordinary severity channel; the sweep does not create a
  separate class of finding.
- A finding that fits none of the swept categories is still published, and is
  recorded in the per-category pass record as uncategorized. A finding that fits
  more than one category is recorded against each category it fits.
- When another review mode is already active for the same pass, the sweep adds
  its categories to that pass; it never turns one pass into two published
  reviews.
- Whether the sweep is enabled is read from the effective operator
  configuration value for the run (AC18). An absent value means off. An empty
  or unrecognized value also means off: the pass runs as an ordinary non-sweep
  review, records that the enablement value was unrecognized, and never treats
  an unparseable value as a request to enable. "Non-sweep review" throughout
  this spec means the review Ronda publishes for the same head with the sweep
  off, under the existing review contract.
- If the current category list cannot be read when a pass starts, or is empty or
  malformed, the pass continues as an ordinary non-sweep review and records that
  the sweep did not run. A missing list degrades coverage; it never fails the pass and never
  leaves the head without a result.

---

### Use Case 2: Operator Reads And Revises The Sweep Category List

**Actor**: Ronda operator

**Preconditions**:

- The recorded sweep category list is committed with the rest of Ronda's quality
  evidence.

**Steps**:

1. The operator opens the recorded category list.
2. The operator reads, for each category, its display label, its description,
   the evidence behind it, and the finding count that justified it.
3. The operator reads which candidate categories were considered and excluded,
   and why.
4. When new evidence arrives, the operator proposes a revision: adding,
   removing, or reordering categories.
5. The operator records the revision with its date, the evidence that motivated
   it, and a new list version.

**Postconditions**:

- Any reader can tell why each category is on the list and what evidence would
  justify changing it.
- Every revision is traceable to the evidence that motivated it.

**Information shown**:

- The current list version and the date it became current.
- Each category: display label, description, the failure shape it targets, the
  supporting evidence source, and the finding count.
- Excluded candidates with their exclusion rationale.
- Revision history.

**Actions available**:

- Propose a revision with supporting evidence.
- Keep the list unchanged and record that the new evidence did not move it.

**Considerations**:

- The list is scoped on real-pull-request evidence. The seeded benchmark's four
  never-found kinds (authorization bypass, data-loss overwrite, configuration
  debug default, invalid range parsing) are not confirmed by any real-pull-request
  evidence in the 2026-09-23 corpus, so they must not be the basis for the list.
- A list revision is a human decision. Evidence can recommend a change; it
  cannot apply one on its own.
- Counts in the list are finding **instances**, not distinct defects — the same
  defect re-raised at a new location after a failed fix counts again. The list
  must say so, so nobody reads 14 instances as 14 defects.

---

### Use Case 3: Operator Measures Recall And Run-To-Run Variance

**Actor**: Ronda operator

**Preconditions**:

- The seeded benchmark and a configured model credential are available.
- Both a sweep-off and a sweep-on configuration can be run against the same
  benchmark target.

**Steps**:

1. The operator runs the benchmark repeatedly against the same target with the
   sweep off, keeping model and configuration fixed.
2. The operator runs the benchmark the same number of times with the sweep on,
   keeping model and configuration fixed.
3. The operator reads recall for every run and the spread across runs in each
   configuration.
4. The operator records both sets of results as committed quality evidence.

**Postconditions**:

- Recall is reported per run, not only as an average.
- The spread across identical runs (lowest, highest, and number of runs) is
  reported for both configurations.
- A reader can tell whether the sweep changed recall, changed variance, changed
  both, or changed neither.

**Information shown**:

- Sample count, model identity, reviewed target, and run timestamps.
- Per-run found and missed seeded defects for each configuration.
- Lowest and highest recall per configuration.
- Per-defect found/missed counts across runs.

**Actions available**:

- Run additional samples.
- Record the comparison as evidence for or against the sweep.

**Considerations**:

- A single sweep-on run that beats a single sweep-off run proves nothing: the
  2026-09-10 baseline varied by two defects across identical runs on its own.
- The sample count must be at least as large as the 2026-09-10 baseline's, so
  the two are comparable.
- Model and configuration must be identical across the compared runs; otherwise
  the comparison measures something else.
- Use Case 5 adds seeds and so changes the fixture's denominator. Sweep-off and
  sweep-on runs must use the same fixture version, and the fixture version is
  recorded with the results. The sweep is aimed at themes the 2026-09-10 fixture
  does not seed, so the comparison is reported on the extended fixture, with the
  original thirteen seeded defects also reported as their own subset so the
  2026-09-10 baseline remains comparable.

---

### Use Case 4: Operator Confirms Precision And Cost Did Not Regress

**Actor**: Ronda operator

**Preconditions**:

- The recall and variance runs from Use Case 3 have been performed.
- At least one precision fixture that expects a clean result is available.

**Steps**:

1. The operator runs the precision fixtures with the sweep off, keeping target,
   model, configuration, and fixture version fixed, for the same number of
   samples as the recall runs.
2. The operator runs the precision fixtures the same number of times with the
   sweep on, under the same fixed target, model, configuration, and fixture
   version.
3. The operator reads how many unexpected findings each configuration produced.
   For the sweep-on runs the operator also reads which categories they came
   from; for the sweep-off runs no category attribution exists (see
   Considerations).
4. The operator reads the cost figures for the sweep-on and sweep-off passes:
   model calls per pass, and elapsed time per pass.
5. The operator records the precision and cost results alongside the recall and
   variance evidence.

**Postconditions**:

- Any unexpected finding is visible and can be judged as noise or as a real
  finding. A sweep-on unexpected finding is also attributed to the category (or
  categories, or uncategorized) recorded for it in the per-category pass record.
  A sweep-off unexpected finding is reported as unattributed, because a
  sweep-off pass has no per-category pass record.
- Whether precision regressed is decided by a stated test (see Considerations),
  not by impression.
- The cost effect of the sweep per pass is recorded, including whether the sweep
  multiplies model calls, and is placed against the recorded per-pull-request
  convergence figures from the 2026-09-23 cost baseline.

**Information shown**:

- Unexpected finding count per configuration. Sweep-on findings are listed with
  the category each one came from; sweep-off findings are listed as unattributed
  (sweep off).
- Whether each precision fixture stayed clean, per configuration.
- The precision regression result: regressed or not regressed, with the counts
  that decided it.
- Model calls per pass and elapsed time per pass, sweep-off and sweep-on.
- The comparison against the recorded per-pull-request cost figures.

**Actions available**:

- Accept the precision result.
- Record a precision regression and revise or narrow the category list.

**Considerations**:

- Category attribution exists only for sweep-on runs, because the
  per-category pass record is produced only by a sweep pass. Sweep-off findings
  are counted and located but never attributed to a category, and the operator
  is not required to derive a category for them. Cross-configuration
  comparison is therefore made on unexpected-finding counts and on per-fixture
  clean/not-clean status, not on categories.
- Precision regression test: precision has regressed if the sweep-on runs
  produced more unexpected findings in total than the sweep-off runs across the
  same precision fixtures and sample count, or if any precision fixture that
  stayed clean in every sweep-off run was not clean in at least one sweep-on run.
  The test has no tolerance. Accepting any tolerance is a human decision that
  is recorded with the evidence, not an automatic outcome.
- Losing precision is the obvious failure mode of this change: a list of
  categories invites the model to produce a finding for each one. Precision
  evidence is therefore mandatory, not optional.
- The 2026-09-23 cost baseline contains no Ronda pass cost at all — Ronda
  accounted for none of the Actions time in that window — so the sweep-off
  control run is the only same-shape cost comparison available, and the
  per-pull-request figures give it context.

---

### Use Case 5: Operator Extends The Benchmark Fixture Before Restoring The Regression Gate

**Actor**: Ronda operator

**Preconditions**:

- The seeded benchmark fixture exists in its 2026-09-10 shape.
- The real-pull-request themes with no fixture representation are known from the
  recorded evidence.

**Steps**:

1. The operator adds a seeded case for each real theme that has no fixture
   representation.
2. The operator adds harder credential-pattern variants alongside the existing,
   always-found sensitive-value case.
3. The operator re-runs the benchmark and records the result for the extended
   fixture.
4. The operator declares the extended fixture usable as a regression gate.

**Postconditions**:

- The fixture contains a case for each of the four unseeded real themes.
- The fixture contains credential-pattern cases that are harder than the
  existing sensitive-value case.
- Until those cases exist, the seeded benchmark is explicitly not treated as a
  regression gate.

**Information shown**:

- Which real themes have fixture representation and which do not.
- Benchmark results for the extended fixture.

**Actions available**:

- Add further seeds as new real themes appear.
- Record that the fixture is, or is not, usable as a regression gate.

**Considerations**:

- The existing fixture over-weights single-line algorithmic defects that are
  always found and that nothing in the real corpus resembles. Rebalancing or
  removing those seeds would break comparability with the 2026-09-10 baseline
  and is deliberately left out of this feature.
- Seeded cases must not contain real credential values; the existing rule that
  quality evidence stores no secrets applies to every new seed.

---

### Use Case 6: Operator Decides Whether Real-Pull-Request Measurement Is Admissible Yet

**Actor**: Ronda operator

**Preconditions**:

- Ronda already reviews this repository's own pull requests, so
  real-pull-request reviews can accumulate.

**Steps**:

1. The operator counts the pull requests that carried a Ronda review under the
   current category list version.
2. The operator compares that count against the minimum required before
   real-pull-request effect may be claimed.
3. The operator labels the current evidence with the tier it qualifies for.
4. When the minimum is reached, the operator adjudicates the accumulated miss
   evidence and reports the sweep-enabled real-pull-request miss record.

**Postconditions**:

- Evidence carries a tier label that says how far it can be read.
- No real-pull-request effect claim is published below the minimum count.
- Real-pull-request evidence is read only as a descriptive record of what
  sweep-enabled reviews caught and missed. It is not read as a comparative
  effect (that the sweep improved or worsened anything) unless a matched
  sweep-off control exists for the same pull request heads (see Considerations).

**Information shown**:

- The number of reviewed pull requests accumulated so far.
- The current evidence tier and what it permits.
- The independence caveat attached to evidence drawn from Ronda's own
  repository.

**Actions available**:

- Keep accumulating reviewed pull requests.
- Promote the evidence tier once the minimum is met and the records are
  adjudicated.

**Considerations**:

- Fixture evidence and real-pull-request evidence answer different questions.
  The fixture says what Ronda misses on seeded defects; real pull requests say
  what defects exist and whether Ronda found them.
- Evidence drawn from Ronda's own repository is not independent of Ronda's
  tuning, and every claim built on it must carry that caveat.
- This gate delays measurement claims only. Building and shipping the sweep,
  its recorded list, and its fixture-level evidence is not blocked by it.
- The count in this gate counts sweep-enabled reviews only. It defines no
  sweep-off baseline, and pull requests reviewed before the sweep existed are
  not a matched control: different pull requests, different content, and
  different model runs. A comparative real-pull-request claim (the sweep raised
  or lowered real-pull-request recall, variance, or cost) is therefore not
  permitted by this feature's evidence alone. It requires a matched control:
  a sweep-off review of the same pull request heads, with the same model and
  configuration, recorded but not published. Whether that control is required
  is a human decision (Open Question 9); until it is made and the control
  exists, the strongest permitted real-pull-request claim is the descriptive
  one above.

---

## Business Rules

- Ronda stays comment-only: it never pushes to, merges, or otherwise mutates the
  pull request under review.
- One review per head SHA, containing every finding from the pass, still holds
  with the sweep active. The sweep never splits a pass into multiple published
  reviews.
- Exactly one sweep category list is current at any time, and it is recorded
  where operators read Ronda's other quality evidence. A list with no categories
  is not a valid current list.
- When the current category list cannot be read, or is empty or malformed, at the
  start of a pass, the pass proceeds as an ordinary non-sweep review and records
  that the sweep did not run. A missing, unreadable, empty, or malformed list
  never fails the pass and never suppresses the review for that head.
- Every category on the current list cites its supporting real-pull-request
  evidence and the finding-instance count behind it.
- The seeded benchmark's four never-found kinds are not, on their own, a valid
  basis for the list, because no real-pull-request evidence confirms them.
- Category counts recorded in the list are finding instances, not distinct
  defects, and the list states this.
- Producing no findings for a category is a valid and expected outcome. Ronda
  must never be required, encouraged, or rewarded for producing at least one
  finding per category.
- Recall evidence for the sweep is invalid unless it reports every individual
  run and the spread across identical runs, with a sample count at least as
  large as the 2026-09-10 baseline's.
- Sweep-on and sweep-off comparison runs must use the same target, model,
  configuration, and fixture version; otherwise the comparison is not
  admissible evidence. Results are reported for the extended fixture and, as a
  separate subset, for the original thirteen seeded defects.
- Precision evidence is mandatory for every recall claim: the same comparison
  must report unexpected findings for both configurations. Category attribution
  is reported for sweep-on findings only; sweep-off findings are reported as
  unattributed. Precision regression is decided by the strict test in Use
  Case 4, with no tolerance unless a human records one.
- Cost evidence is mandatory and must state model calls per pass and elapsed
  time per pass for both configurations, and place them against the recorded
  per-pull-request convergence figures.
- The seeded benchmark is not treated as a regression gate until it seeds the
  four real themes that currently have no representation and harder
  credential-pattern variants.
- Real-pull-request effect of the sweep may not be claimed until at least ten
  pull requests have carried a Ronda review under the current category list
  version and their external-finding evidence has been adjudicated. Revising the
  list restarts that count. Even at that minimum, only a descriptive
  sweep-enabled miss record may be claimed; a comparative claim additionally
  requires a matched sweep-off control on the same pull request heads (Open
  Question 9).
- Evidence drawn from Ronda's own repository carries the independence caveat and
  is read as regression evidence for this repository, not as generalization to
  others.
- Changing the sweep category list is a human decision; no automated process may
  add or remove a category on its own.
- This feature ships the sweep off unless a repository enables it (AC18).
  Making it the default for adopting repositories is a separate human decision.
  Of the evidence this feature produces, only two tests are gating for that
  decision: recall, variance, precision, and cost evidence must all have been
  recorded, and precision must not have regressed under the strict test in Use
  Case 4. No recall-improvement target, variance ceiling, or cost ceiling is
  defined (Open Questions 2 and 3), so recall, variance, and cost results are
  reported evidence that the human decision reads; they do not pass or fail a
  default-enablement gate. If the human decision sets thresholds for them, those
  thresholds are recorded here before the default is changed.
- Quality evidence produced by this feature stores no credential values, tokens,
  or authorization values, as with existing quality evidence.

---

## Statuses / Enum Values

### Sweep categories (initial list)

Display labels are what operators read in the recorded list and in review
summaries. The evidence identifier is the name used in the 2026-09-23 real-PR
corpus, kept so every category is traceable to its source rows.

| Evidence identifier | Display label | Description |
| --- | --- | --- |
| `pr-head-push-order` | State reconstruction from API evidence | Code infers a history or state (for example, which commits were ever branch heads) from an API response that does not establish it. 14 finding instances, the most expensive theme in the corpus. |
| `credential-pattern-gap` | Credential pattern gap | A credential or secret guard matches the canonical form and misses qualified, camelCase, hyphenated, prefixed, or wrapped variants. 9 finding instances, and the theme both independent reviewers hit. |
| `external-output-parsing` | External output parsing | Output from another system (a reviewer body, a comment, a command result) is split, matched, or classified in a way that loses, merges, or misclassifies items. 8 finding instances. |
| `record-identity` | Record identity and deduplication | Identity or deduplication keys collide, drift, or split: position-derived identifiers, truncated text, alias spellings, or shared namespaces. 7 finding instances. |
| `guard-fails-open` | Guard fails open | A security or safety check is skipped, rather than refused, when its input cannot be loaded or is incomplete. 5 finding instances. |

**Excluded candidates** (recorded with the list, not swept):

- Planted-proof evidence (10 instances) — a workflow-gate artifact of this
  repository's review process, not a product defect class.
- The seeded benchmark's four never-found kinds — unconfirmed by real-PR
  evidence.

**Candidates awaiting a human decision** (neither swept nor excluded yet):

- Spec-AC-compliance (7 instances, tied fifth in the sub-theme ranking) — to be
  swept, or excluded as a workflow-gate artifact (Open Question 1).
- Per-finding resolution (4 instances: 3 from the local reviewer and 1 from
  Codex, the theme behind the `partial_success` category that both reviewers
  hit) — to be swept, or excluded with a rationale (Open Question 8).

Until both decisions are made, the recorded list is not a complete AC6 record
and may not be marked current. This spec deliberately does not pick either
outcome; when decided, each candidate moves into the swept table or the
excluded list above with its rationale.

### Evidence tier

| Code value | Display label | Description |
| --- | --- | --- |
| `fixture_only` | Fixture evidence only | Evidence comes from the seeded benchmark and precision fixtures. It may support claims about seeded recall, variance, precision, and cost; it may not support claims about real-pull-request effect. |
| `real_pr_provisional` | Real-PR evidence (provisional) | Fewer than ten pull requests reviewed under the current category list version have accumulated, or their evidence is not yet adjudicated. Findings are indicative only and are labeled as such. |
| `real_pr_measured` | Real-PR evidence (measured) | At least ten pull requests reviewed under the current category list version have accumulated and their external-finding evidence is adjudicated. Descriptive real-pull-request claims are permitted, with the independence caveat. Comparative effect claims additionally require a matched sweep-off control (Open Question 9). |

**Valid transitions**:

- Fixture evidence only → Real-PR evidence (provisional) when the first pull
  request carrying a Ronda review with the sweep enabled is recorded.
- Real-PR evidence (provisional) → Real-PR evidence (measured) when at least ten
  pull requests reviewed under the current category list version have
  accumulated and their external-finding evidence has been adjudicated.
- Real-PR evidence (measured) → Real-PR evidence (provisional) when the category
  list is revised, until ten pull requests have accumulated under the revised
  list.
- A revision made while the tier is Real-PR evidence (provisional) leaves the
  tier at Real-PR evidence (provisional) and restarts the pull-request count.

---

## Operational Visibility

- **Review summary**: states that the category-forced sweep was active for the
  pass and which category list version was used, in the same way existing
  review-mode activation is recorded. Findings themselves are published exactly
  as in a non-sweep review.
- **Per-category pass record**: for each sweep pass, which categories produced
  findings and which produced none, on the operator-facing evidence surface. It
  is not published in the review body, so reviewers of the pull request do not
  read a list of empty categories. Which operator-facing surface carries it is
  an open question (see Open Questions); until settled, it must be readable by
  an operator without being part of the published review body.
- **Recorded category list**: the operator-readable artifact holding the current
  categories, their evidence, the excluded candidates, and the revision history.
- **Quality evidence**: recall per run, spread across runs, precision results,
  cost per pass, sample count, model identity, reviewed target, timestamps, and
  the evidence tier label.
- **Logs**: may record that the sweep ran, the list version, and non-sensitive
  counts. Logs never record credential values.
- **Notifications**: none beyond the existing GitHub review and check-run
  surfaces.

---

## Acceptance Criteria

- [ ] AC1: With the sweep enabled, a review pass considers every category on the
      current recorded list for the reviewed head, and the operator-facing
      evidence surface shows, per category, whether that category produced
      findings or none.
- [ ] AC2: With the sweep enabled, Ronda still publishes exactly one review per
      head SHA containing all findings from the pass, and still makes no push,
      merge, or other change to the pull request.
- [ ] AC3: The review summary for a sweep pass states that the sweep was active
      and which category list version was used; a non-sweep pass says neither.
- [ ] AC4: A recorded sweep category list exists and, for each category, states
      its display label, description, supporting real-pull-request evidence
      source, and finding-instance count.
- [ ] AC5: The recorded list states that its counts are finding instances rather
      than distinct defects.
- [ ] AC6: The recorded list accounts for every candidate category considered:
      each is either on the swept list or named as excluded with its exclusion
      rationale. This includes the seeded benchmark's four never-found kinds,
      the planted-proof evidence theme, spec-AC-compliance, and per-finding
      resolution. No candidate may be left undecided in a list marked current;
      the spec-AC-compliance and per-finding-resolution outcomes are human
      decisions (Open Questions 1 and 8).
- [ ] AC7: The recorded list carries a version and a revision history entry for
      each change, naming the evidence that motivated it.
- [ ] AC8: Committed benchmark evidence reports, for sweep-off and sweep-on
      configurations against the same target, model, and configuration: per-run
      recall, the lowest and highest recall, the sample count, and the fixture
      version — with a sample count at least as large as the 2026-09-10
      baseline's, and with the original thirteen seeded defects reported as a
      separate subset alongside the extended fixture.
- [ ] AC9: The same committed evidence covers both sweep-off and sweep-on
      precision runs on the same target, model, configuration, fixture version,
      and sample count. It reports unexpected findings per configuration,
      attributes each sweep-on unexpected finding to the category (or
      categories, or uncategorized) recorded for it, reports each sweep-off
      unexpected finding as unattributed, reports whether each precision fixture
      stayed clean in each configuration, and states the precision regression
      result under the strict test in Use Case 4.
- [ ] AC10: A review pass that finds nothing for every swept category publishes
      a clean result, and produces no manufactured finding for any category.
- [ ] AC11: The same committed evidence reports model calls per pass and elapsed
      time per pass for both configurations and compares them against the
      recorded per-pull-request convergence figures.
- [ ] AC12: The seeded benchmark fixture contains a case for state
      reconstruction from API evidence, external output parsing, guard fails
      open, and record identity.
- [ ] AC13: The seeded benchmark fixture contains at least one credential-pattern
      case that is harder than the existing always-found sensitive-value case
      (for example, a qualified, camelCase, hyphenated, or prefixed variant).
- [ ] AC14: Quality evidence produced by this feature contains no credential
      values, tokens, or authorization values.
- [ ] AC15: Recorded evidence carries exactly one of the three evidence tier
      labels, and:
      (a) no real-pull-request effect claim appears under a tier below Real-PR
      evidence (measured);
      (b) the label Real-PR evidence (measured) is assigned only when at least
      ten pull requests reviewed with the sweep enabled under the current
      category list version are counted and their external-finding evidence has
      been adjudicated; a record with nine or fewer counted pull requests, or
      with any counted pull request's evidence not yet adjudicated, is labeled
      Real-PR evidence (provisional), and one with no sweep-enabled real pull
      request review recorded is labeled Fixture evidence only (Open Question 4
      may change only the adjudication condition in this clause);
      (c) when the recorded category list version changes, evidence previously
      labeled Real-PR evidence (measured) is relabeled Real-PR evidence
      (provisional), and the counted pull requests restart at zero, so pull
      requests reviewed under an earlier list version do not count toward the
      revised version's ten.
- [ ] AC16: Evidence drawn from Ronda's own repository states the independence
      caveat.
- [ ] AC17: Documentation states that the seeded benchmark is not a regression
      gate until the fixture cases required by AC12 and AC13 exist, and that the
      gate is restored once they do.
- [ ] AC18: An operator can enable and disable the sweep for a repository. The
      authoritative source for that choice is the effective operator
      configuration value for the run, resolved through Ronda's existing
      operator-configuration precedence (environment or workflow input over the
      operator config file over the built-in default, the same surface that
      already carries the durability-mode switch); the concrete key name is a
      planning decision. The sweep is off when the value is absent. It is also
      off, and never on, when the value is empty or is not a recognized on or
      off value; in that case the pass still publishes its normal review and
      records, without exposing the raw value, that the enablement value was
      unrecognized. A disabled sweep reproduces the non-sweep review behavior
      (Ronda's review behavior for the same head with no sweep feature present:
      same findings channel, same single review per head SHA, no sweep
      statement in the summary, no per-category pass record).
- [ ] AC19: When the sweep is enabled but the current category list cannot be
      read, or is empty or malformed, the pass still publishes its normal review
      for that head and records that the sweep did not run.
- [ ] AC20: Every finding published by a sweep pass appears in the per-category
      pass record, either against one or more swept categories or as
      uncategorized.

---

## Brief Objective List

- O1: Provide a category-forced review pass.
- O2: Justify the category list by real-pull-request evidence and record the
  list itself.
- O3: Scope the list on the real-PR sub-theme ranking, not on the seeded
  fixture's four never-found kinds.
- O4: Produce benchmark evidence of the effect on recall.
- O5: Produce benchmark evidence of the effect on run-to-run variance, so a
  single-run improvement cannot stand as proof.
- O6: Produce precision evidence, guarding against a manufactured finding per
  category.
- O7: Produce cost evidence against the recorded per-pull-request cost figures,
  including whether the sweep multiplies model calls per pass.
- O8: Add fixture seeds for state reconstruction from API evidence, external
  output parsing, guard fails open, and record identity.
- O9: Add harder credential-pattern-gap fixture variants.
- O10: Do not treat the seeded benchmark as a regression gate again until those
  seeds exist.
- O11: Do not measure real-pull-request effect until roughly ten dogfooded pull
  requests have accumulated.
- O12: Account for the fixture over-weighting single-line algorithmic defects
  that nothing in the real corpus resembles.

---

## Coverage Matrix

| Brief objective | Acceptance criteria / disposition | Notes |
| --- | --- | --- |
| O1: Category-forced review pass | AC1, AC2, AC3, AC18, AC19, AC20 | The sweep runs inside the existing one-review-per-head contract, is operator-controllable, and degrades to the non-sweep review behavior when its list is unreadable or its enablement value is unrecognized. |
| O2: Evidence-justified, recorded list | AC4, AC5, AC7 | The list records evidence source, counts, counting unit, version, and revisions. |
| O3: Scope on the real-PR sub-theme ranking | AC4, AC6, plus the initial list in Statuses / Enum Values | The five initial categories come from the 2026-09-23 sub-theme ranking; the seeded fixture's four never-found kinds are recorded as excluded. |
| O4: Recall evidence | AC8 | Per-run recall for both configurations against the same target. |
| O5: Variance evidence | AC8 | Lowest, highest, and sample count reported; sample count at least the 2026-09-10 baseline's. |
| O6: Precision evidence | AC9, AC10 | Sweep-off and sweep-on unexpected findings are counted; sweep-on findings are attributed per category and sweep-off findings are reported as unattributed; a strict no-tolerance test decides regression; a clean pass stays clean. |
| O7: Cost evidence | AC11 | Model calls and elapsed time per pass, compared against the recorded per-pull-request figures. |
| O8: Seeds for the four unseeded themes | AC12 | One seeded case per theme. |
| O9: Harder credential-pattern variants | AC13 | At least one variant harder than the existing sensitive-value case. |
| O10: No regression gate until seeds exist | AC17 | Stated in documentation and tied to AC12 and AC13. |
| O11: No real-PR measurement before ~10 dogfooded PRs | AC15, AC16, plus the evidence tier enum | The tier labels enforce what each evidence set may claim. |
| O12: Fixture over-weights single-line algorithmic defects | Out of Scope (MVP) — see Deferral Note D1 | Recorded as a known fixture bias; rebalancing is deferred. |

### Deferral Notes

- **D1 — "The fixture over-weights single-line algorithmic defects
  (lexicographic numeric sort, lower-element median, cache capacity off-by-one,
  all found 5/5). Nothing in the 79 real findings looks like them."**
  Rationale: removing or re-weighting existing seeds would change the
  denominator of the 2026-09-10 baseline and destroy the comparability this
  feature depends on for its recall and variance claims. The issue raises it as
  a note rather than an outcome. This spec records the bias and adds new seeds
  alongside the existing ones instead of rebalancing them. Human confirmation
  requested: yes — confirm that rebalancing stays out of scope for this item.

---

## Out of Scope (MVP)

- Rebalancing, re-weighting, or removing the existing single-line algorithmic
  seeds in the benchmark fixture (see Deferral Note D1).
- Removing the seeded benchmark's four never-found kinds from the fixture; they
  stay seeded, they are simply not a basis for the sweep list.
- Automatically deriving or revising the category list from evidence without a
  human decision.
- Publishing a per-category section in the GitHub review body that lists every
  swept category, including the ones with no findings.
- Per-adopter or per-repository custom category lists; this iteration ships one
  recorded list.
- Changing Ronda's review output contract, check-run behavior, draft-skip
  behavior, supersede behavior, or trigger behavior.
- Model tiering, read-only checkout with symbol context, and the other epic #52
  items that are not this sweep.
- Adjudicating the outstanding template pull request comparison record, the
  PR-Agent decision, and reviewer-loop history preservation — separate items
  from the same baseline's recommendations.
- Claiming that the sweep generalizes to repositories other than the one that
  produced the evidence.

---

## Open Questions

These are product decisions awaiting human input. This spec does not resolve
them. Where a decision changes what a criterion can test, the criterion is
worded so it stays valid either way, and the affected decision is named:

| Question | What it blocks until decided |
| --- | --- |
| 1, 8 | Marking the recorded category list current (AC4, AC6). |
| 2, 3 | Nothing in this feature; they block only making the sweep the default. Until decided, recall, variance, and cost results are reported evidence, not pass/fail gates. |
| 4 | The measured evidence tier (AC15). |
| 5, 9 | Any generalized or comparative real-pull-request claim. |
| 6 | Changing the default for adopting repositories. |
| 7 | The concrete surface for the per-category pass record (AC1, AC20). |

1. Spec-AC-compliance findings (7 instances, tied fifth in the sub-theme
   ranking) are absent from the issue's five-category list, but unlike the
   planted-proof evidence theme no exclusion rationale is recorded for them.
   Should they be a sweep category, or recorded as an excluded workflow-gate
   artifact like planted-proof evidence?
2. What quantified result counts as success? The issue requires recall and
   variance evidence but names no target — for example, a minimum recall
   improvement over the 6–8/13 baseline, or a maximum acceptable spread across
   identical runs.
3. Is there a cost ceiling above which the sweep must not ship by default — for
   example, a maximum number of model calls per pass, or a maximum elapsed time
   per pass?
4. The issue says measurement should wait for "roughly 10" dogfooded pull
   requests. This spec adopts ten as a hard minimum. Confirm that ten is the
   gate, and confirm whether the count requires adjudicated external-finding
   evidence on those pull requests or only that Ronda reviewed them.
5. Evidence from Ronda's own repository is not independent of Ronda's tuning.
   Must real-pull-request effect be corroborated in at least one other
   repository before the sweep is declared effective, or is same-repository
   regression evidence enough for this item?
6. Should the sweep default to on or off for adopting repositories once the
   evidence is in, and does that decision need a release note for existing
   adopters?
7. Which operator-facing surface carries the per-category pass record (AC1,
   AC20): the check-run output, logs, the benchmark output, or more than one?
   The spec requires only that it be readable by an operator and absent from the
   published review body.
8. Per-finding resolution (4 instances: 3 from the local reviewer and 1 from
   Codex, the theme behind the `partial_success` category that both independent
   reviewers hit) is neither on the issue's five-category list nor recorded as
   an excluded candidate. Should it be a sweep category, or recorded as excluded
   with a rationale (small count, one PR)?
9. Should a comparative real-pull-request claim (the sweep changed real-PR
   recall, variance, or cost) require a matched sweep-off control on the same
   pull request heads, or is the descriptive sweep-enabled miss record the most
   this item claims?

---

## AWAITING HUMAN PRODUCT DECISIONS

The following review findings each point to an intentionally documented open
question above, not to a missing or defective spec section. Each requires a
human product decision before implementation can proceed.

| Finding | Open Question | Decision required |
| --- | --- | --- |
| Open Questions 1 and 8 unresolved (recorded category list currency, AC4, AC6) | 1, 8 | Are spec-AC-compliance findings (OQ 1) and per-finding-resolution findings (OQ 8) each swept as a category, or excluded with a recorded rationale like planted-proof evidence? |
| Open Question 4 unresolved (measured evidence tier, AC15) | 4 | Is ten dogfooded pull requests the measured-evidence gate, and does that count require adjudicated external-finding evidence on those pull requests or only that Ronda reviewed them? |
| Open Question 7 unresolved (per-category pass record, AC1, AC20) | 7 | Which operator-facing surface carries the per-category pass record: the check-run output, logs, the benchmark output, or more than one? |

This spec is complete and documented. All blocking findings identify known
product decisions awaiting human input. These decisions must be made before
implementation can proceed.
