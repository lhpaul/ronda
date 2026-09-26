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
   produced none, on the check-run output and in the logs for that pass —
   never in the published review body.
4. When that pass reaches publication, Ronda publishes one review for that head
   SHA containing every finding from the pass; a pass the existing flow does not
   publish publishes no review.

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
- The check-run output and the logs: which categories produced findings for
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
  configuration value for the run (AC18): the value from the
  highest-precedence source that supplies a non-empty value. An absent, empty,
  or whitespace-only value means off, with no record, and counts as not
  supplied (an omitted setting and an empty one cannot be told apart on every
  configuration surface, so they are one case). A non-empty value that is
  not recognized also means off: a pass that reaches review execution runs as an
  ordinary non-sweep review,
  records that the enablement value was unrecognized, and never treats an
  unparseable value as a request to enable. A pass the existing flow ends before
  review execution (a draft pull request, or an existing-check automatic skip)
  emits no such record. "Non-sweep review" throughout
  this spec means the review Ronda publishes for the same head with the sweep
  off, under the existing review contract.
- If the current category list cannot be read when an enabled pass that reaches
  review execution starts, or is
  empty or
  malformed (as AC19 defines), the pass continues as an ordinary non-sweep review,
  records that the sweep did not run, and reports no list version as used. A
  missing list degrades coverage; it never fails the pass and never
  leaves the head without a result. A pass the existing flow ends before review
  execution (a draft pull request, or an existing-check automatic skip, AC1)
  never reads the list and emits no such record. A disabled sweep never reaches
  this path.

---

### Use Case 2: Operator Reads And Revises The Sweep Category List

**Actor**: Ronda operator

**Preconditions**:

- The recorded sweep category list is committed with the rest of Ronda's quality
  evidence.

**Steps**:

1. The operator opens the recorded category list.
2. The operator reads, for each category, its identifier, display label,
   description (including the failure shape it targets), the evidence behind
   it, and the finding count that justified it.
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
- Each category: identifier, display label, description (including the failure
  shape it targets), the supporting evidence source, and the finding count.
- Excluded candidates with their exclusion rationale, and the sub-themes named as
  below the candidate boundary.
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
   sweep off, keeping model and configuration fixed apart from the sweep
   setting.
2. The operator runs the benchmark the same number of times with the sweep on,
   keeping model and configuration fixed apart from the sweep setting.
3. The operator reads recall for every run and the spread across runs in each
   configuration.
4. The operator records both sets of results as committed quality evidence.

**Postconditions**:

- Recall is reported per run, not only as an average.
- The spread across identical runs (lowest, highest, number of runs) and the
  standard deviation of per-run recall are reported for both configurations.
  One observation is one run, and a run's recall is its defect-weighted recall
  across its whole head set (AC15(d)), not an average of per-head recalls.
  Where the head set carries no confirmed external defect, both the recall and
  the variance result are reported as not applicable and neither supports a
  claim.
- A reader can tell whether the sweep changed recall, changed variance, changed
  both, or changed neither; the variance claim is read off the standard
  deviation, not the range width.

**Information shown**:

- Sample count, model identity, reviewed target, fixture version, and run
  timestamps.
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
- No recall target and no variance ceiling exist yet, so a run neither passes
  nor fails: recall and variance results are reported evidence that a human
  reads. The human sets a threshold after the first sweep-on and sweep-off runs
  have been recorded (see Deferred Decisions).
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
   model, configuration, and fixture version fixed apart from the sweep setting,
   for the same number of samples as the recall runs.
2. The operator runs the precision fixtures the same number of times with the
   sweep on, under the same fixed target, model, configuration, and fixture
   version, again apart from the sweep setting.
3. The operator reads how many unexpected findings each configuration produced.
   For the sweep-on runs the operator also reads which categories they came
   from, from the per-category record in the benchmark output; for the sweep-off
   runs no category attribution exists (see Considerations).
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
  convergence figures from the 2026-09-23 cost baseline. Any comparative cost
  claim is stated over the paired per-head differences AC15(d) names, not over
  the standalone figures.

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
  Unexpected findings are counted as findings, not as category attributions: a
  finding attributed to more than one category counts once toward the total.
  The test has no tolerance. Accepting any tolerance is a human decision that
  is recorded with the evidence, not an automatic outcome.
- Losing precision is the obvious failure mode of this change: a list of
  categories invites the model to produce a finding for each one. Precision
  evidence is therefore mandatory, not optional.
- No cost ceiling applies to this feature: cost is reported, not capped. A
  ceiling becomes necessary only if the sweep is later proposed as the default
  for adopting repositories (see Deferred Decisions), so no sweep-on cost figure
  can fail this feature.
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
4. The operator declares the extended fixture ready to serve as the basis of a
   regression gate. What that gate rejects is a deferred decision; the
   declaration alone makes no benchmark result pass or fail.

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
- Record that the fixture is, or is not, ready to serve as the basis of a
  regression gate. Ready means the seeds required by AC12 and AC13 exist; it
  does not define what the gate rejects (see Deferred Decisions).

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

1. The operator counts the pull requests that carried a sweep-enabled Ronda
   review under the current category list version and whose external-finding
   evidence has been adjudicated. A pull request that Ronda merely reviewed,
   with its evidence not yet adjudicated, does not count and does not block the
   tier. A pull request whose external review reported no findings is
   adjudicated, and counts, once that clean result is confirmed by the recorded
   same-head external review; a pull request with no external review recorded
   is not adjudicated, whether or not it carried findings.
2. The operator compares that count against the minimum of ten required before
   real-pull-request effect may be claimed.
3. The operator labels the current evidence with the tier it qualifies for.
4. When ten counted pull requests have accumulated, the operator promotes the
   tier and reports the sweep-enabled real-pull-request miss record.

**Postconditions**:

- Evidence carries a tier label that says how far it can be read.
- No real-pull-request effect claim is published below the minimum count.
- Real-pull-request evidence is read only as a descriptive record of what
  sweep-enabled reviews caught and missed. It is not read as a comparative
  effect (that the sweep improved or worsened anything) unless a matched
  sweep-off control exists for the same pull request heads, and, for a variance
  claim specifically, unless each configuration was also run repeatedly on those
  heads (see Considerations).
- Every real-pull-request effect claim is labeled "own-repository".

**Information shown**:

- The number of counted pull requests accumulated so far (sweep-enabled,
  under the current list version, with adjudicated external-finding evidence).
- The current evidence tier and what it permits.
- The own-repository label and the independence caveat attached to evidence
  drawn from Ronda's own repository.

**Actions available**:

- Keep accumulating reviewed pull requests.
- Promote the evidence tier once the minimum is met and the records are
  adjudicated.

**Considerations**:

- Fixture evidence and real-pull-request evidence answer different questions.
  The fixture says what Ronda misses on seeded defects; real pull requests say
  what defects exist and whether Ronda found them.
- Evidence drawn from Ronda's own repository is not independent of Ronda's
  tuning, and every claim built on it must carry that caveat and the
  "own-repository" label. Corroborating the effect in another repository is not
  required for this feature; the label is what keeps the claim honest.
- This gate delays measurement claims only. Building and shipping the sweep,
  its recorded list, and its fixture-level evidence is not blocked by it.
- The count in this gate counts sweep-enabled, adjudicated reviews only. It
  defines no sweep-off baseline, and pull requests reviewed before the sweep
  existed are not a matched control: different pull requests, different content,
  and different model runs. A comparative real-pull-request claim (the sweep
  raised or lowered real-pull-request recall, variance, or cost) therefore
  always requires a matched control: a sweep-off review of the same pull request
  heads, with the same model and configuration apart from the sweep setting,
  recorded but not published. A variance claim is stricter still: it requires
  repeated identical runs of each configuration on those same heads, the same
  number per configuration, because one run per head measures nothing about
  run-to-run variance, and that claim is stated over one named metric: the
  standard deviation of per-run recall across the repeated runs, compared
  between the two configurations as a direction with both figures recorded, so
  a range-width comparison alone does not support it, and one observation is
  one run (that run's defect-weighted recall across its whole head set, not a
  set of per-head recalls or their average). A recall claim is stated
  over a recorded metric: the denominator is the confirmed external defects on
  those heads — an adjudicated external finding counts only when the
  adjudication's recorded outcome represents a valid defect, so outcomes such
  as `false_positive`, `out_of_scope`, `ronda_better`, and `duplicate` are
  excluded and duplicate adjudications of one defect collapse to one — the
  numerator is those the configuration's review reported (a finding matches
  when it is on the same head and one is the same defect as the other, as the
  adjudication records it), a defect reported by either configuration is
  matched to the same confirmed defect rather than counted twice, and confirmed
  defects with no counterpart in either configuration are reported as missed by
  both. A zero denominator — ten counted pull requests whose external reviews
  were all confirmed clean — makes recall not applicable: that measurement
  supports no recall claim, and it makes the variance result not applicable
  too, since the standard deviation of per-run recall is undefined without a
  confirmed external defect, so no variance direction is claimed either. A cost claim is stated over one named metric: the
  paired per-head difference in model calls per pass (sweep-on minus sweep-off
  on the same head) averaged across those heads, and the paired per-head
  difference in elapsed time per pass averaged across those heads, each with
  both configurations' figures recorded, so an unpaired comparison, a median,
  or a subset of heads does not support it.
  Without that control, the strongest permitted real-pull-request claim is the
  descriptive sweep-enabled miss record above.

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
- When the sweep is enabled and the current category list cannot be read, or is
  empty or malformed, at the
  start of a pass, the pass proceeds as an ordinary non-sweep review and records
  that the sweep did not run. A missing, unreadable, empty, or malformed list
  never fails the pass and never suppresses the review for that head. This rule
  applies only to an enabled sweep: a disabled sweep inspects no list and
  records no list outcome (AC18).
- Every category on the current list cites its supporting real-pull-request
  evidence and the finding-instance count behind it.
- The seeded benchmark's four never-found kinds are not, on their own, a valid
  basis for the list, because no real-pull-request evidence confirms them.
- Category counts recorded in the list are finding instances, not distinct
  defects, and the list states this.
- The per-category pass record is carried on the check-run output (wherever the
  pass publishes a check run) and in the logs for every sweep pass, and
  additionally in the benchmark output for benchmark runs, so per-category
  recall can be attributed. A benchmark run publishes nothing to GitHub, so for
  it the benchmark output and the logs are the record surfaces. The record never
  appears in the published review body.
- A benchmark run publishes nothing to GitHub. Wherever this spec requires a
  pass to publish a review or a check-run record, a benchmark run satisfies the
  requirement through its benchmark output and its logs instead, and the
  one-review-per-head-SHA rule applies only to passes that publish to GitHub.
- Producing no findings for a category is a valid and expected outcome. Ronda
  must never be required, encouraged, or rewarded for producing at least one
  finding per category.
- Recall evidence for the sweep is invalid unless it reports every individual
  run and the spread across identical runs, with a sample count at least as
  large as the 2026-09-10 baseline's.
- Sweep-on and sweep-off comparison runs must use the same target, model,
  fixture version, and configuration apart from the sweep setting itself;
  otherwise the comparison is not admissible evidence. Results are reported for
  the extended fixture and, as a
  separate subset, for the original thirteen seeded defects.
- Precision evidence is mandatory for every recall claim: the same comparison
  must report unexpected findings for both configurations. Category attribution
  is reported for sweep-on findings only; sweep-off findings are reported as
  unattributed. Precision regression is decided by the strict test in Use
  Case 4, with no tolerance unless a human records one.
- Cost evidence is mandatory and must state model calls per pass and elapsed
  time per pass for both configurations, and place them against the recorded
  per-pull-request convergence figures. No cost ceiling applies: cost is
  reported, and no cost figure fails this feature.
- Recall and variance results are reported evidence, not a pass/fail gate: this
  feature defines no recall target and no variance ceiling.
- The seeded benchmark is not treated as a regression gate until it seeds the
  four real themes that currently have no representation and harder
  credential-pattern variants. Even then, this feature defines no pass/fail
  contract for the restored gate (see Deferred Decisions).
- Real-pull-request effect of the sweep may not be claimed until at least ten
  pull requests have carried a sweep-enabled Ronda review under the current
  category list version and their external-finding evidence has been
  adjudicated. A pull request that Ronda reviewed but whose evidence is not
  adjudicated does not count and does not block the tier; a pull request whose
  external review reported no findings is adjudicated, and counts, once that
  clean result is confirmed by the recorded same-head external review, while a
  pull request with no external review recorded is not adjudicated whether or
  not it carried findings. Revising the list restarts that count. Even at
  that minimum, only a descriptive sweep-enabled miss record may be claimed; a
  comparative claim (the sweep changed real-pull-request recall, variance, or
  cost) additionally requires a matched sweep-off control on the same pull
  request heads; a variance comparative claim additionally requires repeated
  identical runs of each configuration on those same heads, the same number per
  configuration, and is stated over the standard deviation of per-run recall
  across those runs — one observation per run, the run's defect-weighted recall
  over its whole head set as AC15(d) defines — compared as a direction with
  both figures recorded; a
  recall comparative claim is stated over a recorded denominator, numerator,
  and matching rule (the denominator is the confirmed external defects on those
  heads — an adjudicated finding counts only when its recorded outcome
  represents a valid defect, so outcomes such as `false_positive`,
  `out_of_scope`, `ronda_better`, and `duplicate` are excluded and duplicate
  adjudications of one defect collapse to one — the numerator those of them the
  configuration's review reported, matched on the same head and the same defect
  as the adjudication records it, with a defect reported by either
  configuration matched to the same confirmed defect rather than counted twice,
  with a zero denominator reported as recall not applicable and the variance
  result not applicable, both supporting no claim, since ten counted pull
  requests may all carry confirmed-clean
  external reviews); a cost comparative claim is stated over the paired
  per-head differences in model calls per pass and in elapsed time per pass,
  each averaged across those heads, with both configurations' figures
  recorded.)
- A "sweep-enabled review", wherever this spec counts or labels one, is a review
  whose pass actually ran the sweep and reported a category list version as used.
  A pass that had the sweep enabled but degraded to a non-sweep review (AC19)
  is not a sweep-enabled review and does not count toward any tier or count.
- Evidence drawn from Ronda's own repository carries the independence caveat,
  is labeled "own-repository", and is read as regression evidence for this
  repository, not as generalization to others. Corroboration in another
  repository is not required by this feature.
- Changing the sweep category list is a human decision; no automated process may
  add or remove a category on its own.
- This feature ships the sweep off unless a repository enables it (AC18).
  Making it the default for adopting repositories is a separate, later human
  decision that requires a release note for existing adopters; it is not part of
  this feature. Of the evidence this feature produces, only two tests are gating
  for that later decision: recall, variance, precision, and cost evidence must
  all have been recorded, and precision must not have regressed under the strict
  test in Use Case 4. No recall-improvement target, variance ceiling, or cost
  ceiling is defined, so recall, variance, and cost results are reported
  evidence that the later human decision reads; they do not pass or fail a
  default-enablement gate. Any thresholds that decision sets are recorded before
  the default is changed (see Deferred Decisions).
- Quality evidence produced by this feature stores no real or usable credential
  values, tokens, or authorization values, as with existing quality evidence;
  non-functional credential-shaped fixture data is not a stored credential.

---

## Statuses / Enum Values

### Sweep categories (initial list)

Display labels are what operators read in the recorded list and on the operator
surfaces that report it. They do not appear in the review body: the review
summary states only the sweep activation and the list version (AC3), and the
per-category pass record never appears in the review body (AC1). The evidence
identifier is the name used in the 2026-09-23 real-PR corpus, kept so every
category is traceable to its source rows.

| Evidence identifier | Display label | Description |
| --- | --- | --- |
| `pr-head-push-order` | State reconstruction from API evidence | Code infers a history or state (for example, which commits were ever branch heads) from an API response that does not establish it. 14 finding instances, the most expensive theme in the corpus. |
| `credential-pattern-gap` | Credential pattern gap | A credential or secret guard matches the canonical form and misses qualified, camelCase, hyphenated, prefixed, or wrapped variants. 9 finding instances (6 from the local reviewer, 3 from Codex), a theme both independent reviewers hit. |
| `external-output-parsing` | External output parsing | Output from another system (a reviewer body, a comment, a command result) is split, matched, or classified in a way that loses, merges, or misclassifies items. 8 finding instances. |
| `record-identity` | Record identity and deduplication | Identity or deduplication keys collide, drift, or split: position-derived identifiers, truncated text, alias spellings, or shared namespaces. 7 finding instances. |
| `guard-fails-open` | Guard fails open | A security or safety check is skipped, rather than refused, when its input cannot be loaded or is incomplete. 5 finding instances. |

**Excluded candidates** (recorded with the list, not swept):

- Planted-proof evidence (10 instances) — a workflow-gate artifact of this
  repository's review process, not a product defect class.
- The seeded benchmark's four never-found kinds — unconfirmed by real-PR
  evidence.
- Spec-AC-compliance (7 instances, tied with the record-identity theme and
  ahead of the guard-fails-open theme's 5 in the corpus sub-theme ranking) —
  excluded: checking it depends on a spec being present, which makes it a
  workflow-gate concern like planted-proof evidence rather than a defect class
  that any reviewed pull request can carry. It may be added at a later list
  revision if dogfooded misses point at it.
- Per-finding resolution (4 instances: 3 from the local reviewer and 1 from
  Codex, the theme behind the `partial_success` category that both reviewers
  hit) — excluded: four instances from a single pull request is too thin an
  evidence base, and a category on that basis invites manufactured findings.
  Recorded so it can be revisited when more evidence accumulates.

**Candidate-set boundary**: the candidates considered are the sub-themes in the
2026-09-23 real-PR corpus ranking that have at least five finding instances,
plus any sub-theme both independent reviewers hit (the issue's own selection
criteria, applied at sub-theme level; in the corpus these are
credential-pattern-gap, guard-fails-open, and per-finding-resolution), plus the
seeded benchmark's never-found kinds. Sub-themes ranked
below that boundary are outside the candidate set: excerpt-sequence-boundaries
(4 instances), placeholder-exemption (3), refusal-precedence (3),
input-validation (2), github-api-pagination (1), path-traversal (1), and
operator-usability (1). Each has too few instances to justify a category; they
are recorded here so a later list revision can reconsider them if dogfooded
misses point at them.

Exactly one recorded category list version is current. Every candidate is
either swept (currently in use) or explicitly excluded with a recorded
rationale; no candidate is left undecided, so the list above is a complete
record and can be marked current.

### Evidence tier

| Code value | Display label | Description |
| --- | --- | --- |
| `fixture_only` | Fixture evidence only | Evidence comes from the seeded benchmark and precision fixtures. It may support claims about seeded recall, variance, precision, and cost; it may not support claims about real-pull-request effect. |
| `real_pr_provisional` | Real-PR evidence (provisional) | At least one sweep-enabled real pull request review has been recorded, but fewer than ten counted pull requests have accumulated under the current category list version (a pull request counts only if it carried a sweep-enabled review under that version and its external-finding evidence has been adjudicated; a clean external review counts once confirmed by the recorded same-head external review, and one with no external review recorded is not adjudicated). Findings are indicative only, support no effect claim, and are labeled as such. |
| `real_pr_measured` | Real-PR evidence (measured) | At least ten counted pull requests (sweep-enabled under the current category list version, with adjudicated external-finding evidence) have accumulated. Descriptive real-pull-request claims are permitted, with the independence caveat and the "own-repository" label. Comparative effect claims additionally require a matched sweep-off control on the same pull request heads; a recall claim is stated over the recorded denominator, numerator, and matching rule AC15(d) defines; a cost claim over the paired per-head differences AC15(d) names. |

**Valid transitions**:

- Fixture evidence only → Real-PR evidence (provisional) when the first
  sweep-enabled real pull request review (one whose pass actually ran the
  sweep, as the business rules define) is recorded.
- Real-PR evidence (provisional) → Real-PR evidence (measured) when at least ten
  counted pull requests (sweep-enabled under the current category list version,
  with adjudicated external-finding evidence) have accumulated. A pull request
  whose external review reported no findings counts once its clean result is
  confirmed by the recorded same-head external review; one with no external
  review recorded is not adjudicated, whether or not it carried findings.
  Pull requests reviewed but not yet adjudicated do not count and do not block
  the transition.
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
  findings and which produced none. It is carried on the check-run output and in
  the logs, and for benchmark runs it also appears in the benchmark output so
  recall can be attributed per category. It is never published in the review
  body, so reviewers of the pull request do not read a list of empty categories.
  The same surfaces (check-run output where a check run is published, and the
  logs) carry the record that the sweep did not run because its category list
  was unreadable, empty, or malformed (AC19), or that a non-empty enablement
  value was unrecognized (AC18); neither record appears in the review body.
  Both records are emitted only by a pass that reaches review execution; a
  pre-review skip (AC1) emits neither.
- **Recorded category list**: the operator-readable artifact holding the current
  categories, their evidence, the excluded candidates, and the revision history.
- **Quality evidence**: recall per run, spread across runs (including the standard deviation of
  per-run recall), precision results,
  cost per pass, sample count, model identity, reviewed target, fixture
  version, timestamps, and the evidence tier label.
- **Logs**: record that the sweep ran, the list version, the per-category pass
  record (AC1), and non-sensitive counts. Logs never record credential values.
- **Notifications**: none beyond the existing GitHub review and check-run
  surfaces.

---

## Acceptance Criteria

- [ ] AC1: With the sweep enabled and its current list readable and well-formed
      (AC19), a review pass **that reaches review execution** considers every
      category on the
      current recorded list for the reviewed head, and the pass's check-run
      output (where the pass publishes a check run) and its logs each show, per
      category, whether that category produced findings or none. A benchmark
      run, which publishes no check run, shows the same per-category record in
      the benchmark output and its logs. No per-category record appears in the
      published review body. A pass the existing flow ends before review
      execution — the pre-review skips (a draft pull request, or an automatic
      run that finds the head's existing check run, AC2) — considers no
      categories and emits no per-category record, no sweep-activation
      statement, and no sweep metadata of any kind; it is not a sweep pass and
      is indistinguishable from the same skip in a non-sweep run.
- [ ] AC2: With the sweep enabled, whenever the existing review flow reaches
      publication for that head SHA, Ronda publishes exactly one review per
      head SHA containing all findings from the pass, and still makes no push,
      merge, or other change to the pull request. The sweep adds no second
      publication path: draft-skip and supersede behavior are unchanged, so a
      pass that the existing flow would not have published (a skipped draft
      pass, or a pass superseded before publication) publishes no review, in a
      sweep-enabled run as in a non-sweep one.
- [ ] AC3: The review summary for a sweep pass states that the sweep was active
      and which category list version was used; a non-sweep pass says neither.
- [ ] AC4: A recorded sweep category list exists and, for each category, states
      its identifier, display label, description, supporting real-pull-request
      evidence source, and finding-instance count.
- [ ] AC5: The recorded list states that its counts are finding instances rather
      than distinct defects.
- [ ] AC6: The recorded list accounts for every candidate category considered
      (the candidate set is bounded as stated in Statuses / Enum Values, and the
      sub-themes below that boundary are named in the record): each candidate is
      either on the swept list or named as excluded with its exclusion
      rationale. The swept list holds exactly the five categories in Statuses /
      Enum Values, and the excluded entries are the seeded benchmark's four
      never-found kinds, the planted-proof evidence theme, spec-AC-compliance,
      and per-finding resolution, each with its recorded rationale. Exactly one
      recorded list version is current, and no candidate is left undecided
      in it.
- [ ] AC7: The recorded list carries a version and a revision history entry for
      each change, naming the evidence that motivated it.
- [ ] AC8: Committed benchmark evidence reports, for sweep-off and sweep-on
      configurations against the same target, model, and configuration apart
      from the sweep setting itself (the sweep setting is the one value the two
      configurations are required to differ in): per-run
      recall, the lowest and highest recall, the standard deviation of per-run
      recall (computed with the population formula over the runs performed, the
      same formula AC15(d) requires), per-defect found and missed counts
      across runs, the sample count, the model identity, the reviewed target,
      the run timestamps, and the fixture version. The sweep-off and sweep-on
      configurations use the same recorded fixture version and the same sample
      count, and that sample count is at least as large as the 2026-09-10
      baseline's (five runs); evidence in which the two configurations differ in
      fixture version or sample count is not admissible. The original thirteen
      seeded defects are reported as a separate subset alongside the extended
      fixture. The record states that no recall target and no variance ceiling are defined for this feature, so the
      recall and variance figures are reported evidence rather than a pass or
      fail outcome.
- [ ] AC9: The same committed evidence covers both sweep-off and sweep-on
      precision runs on the same target, model, fixture version,
      and sample count (the sample count AC8 requires for the recall runs), with
      configuration identical apart from the sweep setting itself. It reports unexpected findings per configuration,
      attributes each sweep-on unexpected finding to the category (or
      categories, or uncategorized) recorded for it, reports each sweep-off
      unexpected finding as unattributed, reports whether each precision fixture
      stayed clean in each configuration, and states the precision regression
      result under the strict test in Use Case 4.
- [ ] AC10: A review pass that finds nothing for every swept category and has
      no uncategorized finding publishes a clean result, and produces no
      manufactured finding for any category. A pass whose only findings are
      uncategorized publishes those findings under AC20 and is not clean.
- [ ] AC11: The same committed evidence reports model calls per pass and elapsed
      time per pass for both configurations and compares them against the
      recorded per-pull-request convergence figures. The record states that no
      cost ceiling applies to this feature, so no cost figure fails it.
- [ ] AC12: The seeded benchmark fixture contains a case for state
      reconstruction from API evidence, external output parsing, guard fails
      open, and record identity.
- [ ] AC13: The seeded benchmark fixture contains at least one credential-pattern
      case that is harder than the existing always-found sensitive-value case.
      "Harder" is defined by a testable rule: a credential-pattern case is
      harder than baseline when the sensitive name or value it plants is not
      matched by the exact canonical form the existing case uses, so that a
      guard recognizing only that canonical form would miss it. A case is
      harder when it differs from the canonical form in at least one of these
      ways: a qualifier or prefix added to the name, a different letter-case
      convention (for example camelCase), a different word separator (for
      example hyphenated), or the name or value wrapped in another construct.
      These four ways are the exhaustive set that AC13 counts; a variant that
      differs in none of them is not harder for AC13 purposes, however
      unusual it looks. The fixture records, for each harder case, which of the
      four ways it differs by and the canonical baseline form it is compared
      against, so the rule can be checked without judgment.
- [ ] AC14: Quality evidence produced by this feature contains no real or
      usable credential values, tokens, or authorization values. Non-functional
      credential-shaped fixtures (names and values that authenticate nothing,
      per the seeded-fixture rule above) are not prohibited by this criterion and
      are what AC13 requires.
- [ ] AC15: Recorded evidence carries exactly one of the three evidence tier
      labels, and:
      (a) no real-pull-request effect claim appears under a tier below Real-PR
      evidence (measured);
      (b) the label Real-PR evidence (measured) is assigned only when at least
      ten counted pull requests exist under the current recorded category list
      version, where a pull request counts only if it carried a sweep-enabled
      review under that version and its external-finding evidence has been
      adjudicated (a pull request reviewed but not adjudicated does not count
      and does not block the label); a pull request whose external review
      reported no findings is adjudicated, and counts, once that clean result
      is confirmed by the recorded same-head external review — a pull request
      with no external review recorded is not adjudicated, whether or not it
      carried findings; a record with at least one sweep-enabled real
      pull request review recorded under any list version but nine or fewer
      counted pull requests is labeled Real-PR evidence (provisional), and one
      with no sweep-enabled real pull request review recorded under any list
      version is labeled Fixture evidence only (the two ranges do not overlap);
      (c) when the recorded category list version changes, evidence previously
      labeled Real-PR evidence (measured) is relabeled Real-PR evidence
      (provisional), and the counted pull requests restart at zero, so pull
      requests reviewed under an earlier list version do not count toward the
      revised version's ten;
      (d) a comparative real-pull-request claim (that the sweep changed
      real-pull-request recall, variance, or cost) appears only where a matched
      sweep-off control on the same pull request heads, with the same model and
      configuration apart from the sweep setting, is recorded with it; a claim
      that the sweep changed run-to-run variance additionally requires that each
      configuration be run repeatedly on those same heads — the same number of
      identical runs per configuration for both configurations, at least two —
      because a single run per head cannot establish run-to-run variance, and
      the claim is stated over one named metric: the standard deviation of
      per-run recall across those runs, computed with the population formula
      over the runs performed — those runs are the whole set reported, not a
      sample drawn from a larger one — compared between the two configurations
      as a direction (higher or lower) with both figures recorded, so that a
      width-of-range or spread comparison alone does not support the claim;
      one observation is one run, and a run repeats the same head set, so where
      a run covers more than one head its recall is that run's defect-weighted
      recall across its whole head set — the confirmed defects the run reported
      over the confirmed defects on those heads, using the denominator and
      matching rule below — and not a pooled set of per-head recalls, an average
      of per-head recalls, or one observation per head or per defect, because
      those aggregations yield different standard deviations and can reverse the
      claimed direction when heads carry different defect denominators;
      a comparative recall claim is stated over an explicitly recorded
      denominator, numerator, and matching rule: the denominator is the
      **confirmed external defects** recorded for those heads — an adjudicated
      external finding enters the denominator only when the adjudication's
      recorded outcome is one that represents a valid defect, and the outcomes
      that do not (`false_positive`, `out_of_scope`, `ronda_better`,
      `duplicate`; the plan maps the recorded outcome vocabulary to this rule)
      are excluded, because counting a rejected, out-of-scope, or
      already-found finding as a miss would depress recall for a finding Ronda
      was right to omit; duplicate adjudications of the same defect across
      reviews or reviewers collapse to one confirmed defect; the numerator is
      those of them the configuration's review reported (a finding matches when
      it is on the same head and one is the same defect as the other, as the
      adjudication records it); a defect reported by either configuration is
      matched to the same confirmed external defect rather than counted twice;
      and confirmed external defects with no counterpart in either
      configuration are reported as missed by both; a configuration whose
      denominator is zero (no confirmed external defect on those heads)
      reports its recall as not applicable and supports no recall claim for
      that measurement, because ten counted pull requests may all carry
      confirmed-clean external reviews; the same zero denominator makes the
      variance result not applicable as well and supports no comparative
      variance claim, since per-run recall — and therefore its standard
      deviation — is undefined when no confirmed external defect exists on
      those heads, so the not-applicable result is recorded for the variance
      figure and no variance direction is claimed; a comparative cost claim is
      likewise
      stated over one named metric: the paired per-head difference in model
      calls per pass (sweep-on minus sweep-off on the same head) and the paired
      per-head difference in elapsed time per pass, each reported as its mean
      across those heads with both configurations' figures recorded, so that an
      unpaired mean, a median, or a subset of heads does not support the claim;
      without that control the record
      carries only the descriptive sweep-enabled miss record.
- [ ] AC16: Evidence drawn from Ronda's own repository states the independence
      caveat, and every effect claim built on it is labeled "own-repository".
      No claim asserts corroboration in another repository, and none is
      required.
- [ ] AC17: Documentation states that the seeded benchmark is not a regression
      gate until the fixture cases required by AC12 and AC13 exist, and that the
      operator may declare the extended fixture ready to serve as the basis of a
      regression gate, with the declaration recorded (Use Case 5), once they do.
      The documentation also states that what a restored gate rejects (its
      pass/fail contract) is a deferred decision (see Deferred Decisions), so
      the declaration does not make any benchmark result pass or fail.
- [ ] AC18: An operator can enable and disable the sweep for a repository. The
      authoritative source for that choice is the effective operator
      configuration value for the run, resolved through Ronda's existing
      operator-configuration precedence (environment or workflow input over the
      operator config file over the built-in default, the same surface that
      already carries the durability-mode switch); the concrete key name is a
      planning decision. The recognized on and off values are the same,
      case-insensitive, on and off vocabulary that Ronda's existing on/off
      operator switches (the durability-mode switch) already accept, so
      operators learn one convention; the plan states the exact values, and an
      operator setting any of them gets the matching on or off result. The
      sweep is off when the value is absent or empty, which are one case with
      no record. It is also off, and never on, when the value is non-empty and
      is not a recognized on or off value; in that case a pass that reaches
      review execution preserves the
      ordinary publication eligibility (AC2) — it publishes its normal review
      only when the existing review flow reaches publication for that head SHA —
      and records, without exposing the raw value, that the enablement value was
      unrecognized (on the check-run output where
      the pass publishes a check run, and in the logs); a pass the existing flow
      ends before review execution (AC1) emits no such record. A value that is empty
      or contains only whitespace counts as absent. The effective value is the
      one from the highest-precedence source that supplies a non-empty value:
      an empty or absent value at a higher-precedence source defers to the
      next source, but an unrecognized non-empty value is the effective value
      and is not replaced by a recognized value at a lower-precedence source.
      A disabled sweep reproduces the non-sweep review behavior (Ronda's review
      behavior for the same head with no sweep feature present: same findings
      channel, same single review per head SHA, no sweep statement in the
      summary, no per-category pass record); the unrecognized-value record is
      the only addition, and it is made only in the unrecognized case. The built-in
      default is off for every adopting repository; changing that default is
      not part of this feature.
- [ ] AC19: When the sweep is enabled but the current category list cannot be
      read, or is empty or malformed, **a pass that reaches review execution**
      preserves the ordinary publication
      eligibility (AC2) — it publishes its normal review for that head only when
      the existing review flow reaches publication — and records that the sweep
      did not run. A pass the existing flow ends before review execution (a
      draft pull request, or an automatic run that finds the head's existing
      check run, AC2) reads no list, so it emits no sweep-did-not-run record and
      remains indistinguishable from the same skip in a non-sweep run (AC1);
      that skip governs, and this rule has no separate outcome for it. A category list is
      malformed when any of these holds: it cannot be read as a list of
      categories at all; any category lacks a display label, a description, an
      evidence source, an identifier, or a finding-instance count (AC4), or
      supplies any of those as a value outside its allowed domain — the
      allowed domain is: identifiers, display labels, descriptions, and
      evidence sources are each a non-empty string that is not blank
      (whitespace-only counts as blank), and a finding-instance count is a
      non-negative integer, so a blank string or a count that is not a
      non-negative integer is malformed rather than valid; two
      categories share an identifier; it contains no categories; or it carries
      no list version, or no single
      current list version can be identified. In each of these cases the pass
      reports no list version as used. How the list is stored and parsed is a
      planning decision.
- [ ] AC20: Every finding published by a sweep pass appears in the per-category
      pass record on the check-run output (where the pass publishes a check run)
      and in the logs (and in the benchmark output for a benchmark run), either
      against one or more swept categories
      or as uncategorized.

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
- O11: Do not measure real-pull-request effect until the minimum number of
  dogfooded pull requests fixed in AC15 (ten, with adjudicated evidence) have
  accumulated.
- O12: Account for the fixture over-weighting single-line algorithmic defects
  that nothing in the real corpus resembles.

---

## Coverage Matrix

| Brief objective | Acceptance criteria / disposition | Notes |
| --- | --- | --- |
| O1: Category-forced review pass | AC1, AC2, AC3, AC18, AC19, AC20 | The sweep runs inside the existing one-review-per-head contract for passes that reach review execution; a pre-review skip (draft, or an automatic run finding the head's check run) emits no sweep metadata and is indistinguishable from the same skip without the sweep. It is operator-controllable and off by default, records per-category results on the check-run output and the logs (and in the benchmark output for benchmark runs), and degrades to the non-sweep review behavior when its list is unreadable or its enablement value is unrecognized, preserving the ordinary publication eligibility (AC2) in every degraded case. |
| O2: Evidence-justified, recorded list | AC4, AC5, AC7 | The list records evidence source, counts, counting unit, version, and revisions. |
| O3: Scope on the real-PR sub-theme ranking | AC4, AC6, plus the initial list in Statuses / Enum Values | The five initial categories come from the 2026-09-23 sub-theme ranking; the seeded fixture's four never-found kinds, planted-proof evidence, spec-AC-compliance, and per-finding resolution are recorded as excluded with rationales, and the seven sub-themes below the candidate boundary are named. |
| O4: Recall evidence | AC8 | Per-run recall for both configurations against the same target, with configuration identical apart from the sweep setting; reported evidence, with no recall target defined. |
| O5: Variance evidence | AC8, AC15(d) | Lowest, highest, sample count, and the standard deviation of per-run recall reported; sample count at least the 2026-09-10 baseline's; one observation is one run, read as that run's defect-weighted recall over its whole head set; a head set with no confirmed external defect makes the variance result not applicable, supporting no claim; the variance claim is read off the standard deviation, not the range width; no variance ceiling defined. |
| O6: Precision evidence | AC9, AC10 | Sweep-off and sweep-on unexpected findings are counted; sweep-on findings are attributed per category and sweep-off findings are reported as unattributed; a strict no-tolerance test decides regression; a clean pass stays clean. |
| O7: Cost evidence | AC11, AC15(d) | Model calls and elapsed time per pass, compared against the recorded per-pull-request figures; reported, with no cost ceiling applied; a comparative cost claim is read off the paired per-head differences AC15(d) names, not the standalone figures. |
| O8: Seeds for the four unseeded themes | AC12 | One seeded case per theme. |
| O9: Harder credential-pattern variants | AC13 | At least one variant harder than the existing sensitive-value case. |
| O10: No regression gate until seeds exist | AC17 | Stated in documentation and tied to AC12 and AC13. Once they exist the extended fixture may be declared ready as a gate basis; the gate's pass/fail contract is a Deferred Decision, so the declaration makes no benchmark result pass or fail. |
| O11: No real-PR measurement before ten adjudicated dogfooded PRs | AC15, AC16, plus the evidence tier enum | Ten is the confirmed minimum and the count requires adjudicated external-finding evidence, counting a clean external review once its same-head confirmation is recorded; the tier labels enforce what each evidence set may claim, including that a comparative claim needs a matched sweep-off control, with repeated runs for variance (read off the standard deviation of per-run recall) and a recorded recall metric whose denominator is the confirmed external defects (rejected, out-of-scope, and duplicate adjudications excluded; duplicates collapsed). |
| O12: Fixture over-weights single-line algorithmic defects | Out of Scope (MVP) — see Deferral Note D1 | Recorded as a known fixture bias; rebalancing is deferred. |

### Deferral Notes

- **D1 — "The fixture over-weights single-line algorithmic defects
  (lexicographic numeric sort, lower-element median, cache capacity off-by-one,
  all found 5/5). Nothing in the 79 real findings looks like them."**
  Rationale: removing or re-weighting existing seeds would change the
  denominator of the 2026-09-10 baseline and destroy the comparability this
  feature depends on for its recall and variance claims. The issue raises it as
  a note rather than an outcome. This spec records the bias and adds new seeds
  alongside the existing ones instead of rebalancing them. Human confirmation:
  confirmed on 2026-09-26 — rebalancing the existing single-line algorithmic
  seeds stays out of scope for this item.

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
  behavior, supersede behavior, or trigger behavior, other than the additions
  this spec states: the sweep statement in the review summary (AC3), the
  per-category pass record on the check-run output (AC1), and the records that
  the sweep did not run (AC19) or that the enablement value was unrecognized
  (AC18) on the check-run output.
- Model tiering, read-only checkout with symbol context, and the other epic #52
  items that are not this sweep.
- Adjudicating the outstanding template pull request comparison record, the
  PR-Agent decision, and reviewer-loop history preservation — separate items
  from the same baseline's recommendations.
- Claiming that the sweep generalizes to repositories other than the one that
  produced the evidence.
- Corroborating the sweep's effect in another repository; own-repository
  evidence, carrying its label and caveat, is what this item claims.
- Setting a recall target or a variance ceiling for the sweep (see Deferred
  Decisions).
- Setting a cost ceiling for a sweep pass (see Deferred Decisions).
- Defining the pass/fail contract of a restored benchmark regression gate, that
  is, what result the gate rejects (see Deferred Decisions).
- Making the sweep the default for adopting repositories (see Deferred
  Decisions).

---

## Deferred Decisions

These product decisions are deliberately not made in this item. None of them
blocks building, shipping, or measuring the sweep, because the sweep ships off
by default and its recall, variance, and cost figures are reported evidence
rather than pass/fail gates.

| Decision | Owner | Trigger | Until then |
| --- | --- | --- | --- |
| A recall target and a variance ceiling for the sweep | Human (issue owner) | The first sweep-on and sweep-off runs are recorded | Recall and variance are reported evidence; no run passes or fails on them. |
| The pass/fail contract of a restored benchmark regression gate (what result the gate rejects) | Human (issue owner) | The recall-target and variance-ceiling decision above is made | The extended fixture may be declared ready as a gate basis (AC17), but benchmark results are reported evidence; no run passes or fails. |
| A cost ceiling per sweep pass | Human (issue owner) | Only if the sweep is proposed as the default for adopting repositories | Cost per pass is reported and compared against the per-pull-request convergence figures; no cost figure fails this feature. |
| Flipping the sweep's default from off to on | Human (issue owner) | Recall, variance, precision, and cost evidence recorded, with no precision regression | The sweep stays off unless a repository enables it. Flipping the default is a separate change and requires a release note for existing adopters. |
