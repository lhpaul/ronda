# Read-Only Repository Context With Symbol-Level Resolution - Spec

**Depends on**: 105-category-forced-review-sweep, 53-capture-external-review-misses, 55-feed-architecture-docs-into-reviews

---

## Overview

Ronda reviews a pull request from its diff plus a bounded set of authoritative
documents. It never reads the surrounding source, so it cannot see what a called
value is actually established by, where else a changed function is called, or
whether a guard it is judging is reachable. The largest recorded cluster of real
review findings is exactly that shape: in
[`pr-98-external-finding-corpus-2026-09-23.md`](../../../testing/ronda/pr-98-external-finding-corpus-2026-09-23.md)
the `pr-head-push-order` sub-theme is 14 of 79 finding instances and is one
defect — code treating a GitHub API response as evidence of something it does not
establish — raised across iterations 1 to 22, escalated three times, and closed
only under an explicit human waiver. Two further clusters have the same shape:
`external-output-parsing`, 8 finding instances, and `guard-fails-open`, 4 from
the local reviewer plus 1 from the second reviewer.

This feature gives a review pass **read-only repository context**: for the head
being reviewed, Ronda may read source beyond the diff — the definitions the
changed lines depend on, and the call sites of what the change defines — so the
question "what does this value actually prove?" becomes answerable inside a
single pass. Feeding more context is not automatically better, so the context is
selected by recorded rules, bounded by operator budgets, and reported per pass.

This feature **requires amending a locked architecture decision**, and this spec
does not amend it. It states the amendment as a **proposal** for the repository
owner's decision; the owner's merge of this spec is the agreement, and no
implementation may begin before that. Ronda's published contract is otherwise
unchanged: comment-only, one review per head SHA, never pushing a fix.

---

## Proposed Amendment To The Locked Architecture Decision (proposal, not yet agreed)

The current locked decision is **"Diffs are read over the REST API; the reviewed
repository is never checked out"** in
[`3-software-architecture.md`](../../../project/3-software-architecture.md). It
bundles two separate commitments:

1. a **safety property** — Ronda never runs the reviewed repository's code, so
   there is no "pwn request" surface even on a fork pull request's comment
   thread; and
2. a **mechanism** — Ronda reads only the diff endpoint and performs no
   checkout of the reviewed repository.

The proposal keeps (1) locked, exactly as written, and relaxes (2). Proposed
replacement text for the decision, for the owner to accept, amend, or reject:

> ### Repository content is read at the reviewed head; the reviewed repository's code is never executed
>
> - **Context**: A diff cannot show what a value is established by, where else a
>   changed function is called, or whether a guard is reachable. The recorded
>   real-pull-request finding corpus of 2026-09-23 shows that defect shape is the
>   largest single cluster, and the most expensive one to converge.
> - **Decision**: A review pass may read repository content at the reviewed head,
>   beyond the pull request's own changed lines, for the purpose of resolving
>   symbols named in those changed lines. Ronda **never executes** any content of
>   the reviewed repository — no build, no dependency install, no test, no script,
>   no hook, no generated tooling — and **never writes** to the reviewed
>   repository or its pull request beyond the one review and check run it already
>   publishes. Whether the read is served by repository content reads or by a
>   locally materialised, never-executed copy is an implementation choice, bounded
>   by the read-only and never-executed guarantees and by the operator budgets.
> - **Consequences**: The comment-trigger and fork paths stay low-risk for the
>   same reason as before — nothing untrusted is executed — while the reviewer can
>   reason about definitions and call sites. Repository content becomes untrusted
>   model input that must be budgeted and reported, and every pass must be able to
>   show that it read and never wrote.

If the owner rejects the amendment, this item's outcome is the recorded decision
not to proceed (AC2), and nothing else in this spec is built.

---

## Use Cases

### Use Case 1: Ronda Reviews A Pull Request With Repository Context

**Actor**: Ronda, acting for the operator who enabled repository context

**Preconditions**:

- The amendment above is recorded as accepted.
- Repository context is enabled for the pass through operator configuration; it
  is off by default.
- Ronda has been asked to review a pull request head through any of its normal
  triggers, and the pass reaches review execution (it reads the changed files and
  runs the review).

**Steps**:

1. Ronda reads the pull request's changed lines as it does today.
2. Ronda identifies the symbols the changed lines depend on and the symbols the
   change itself defines or modifies.
3. Ronda reads, at the reviewed head, the definitions of the depended-on symbols
   and the call sites of the defined or modified symbols, in the recorded
   selection order defined in **Context Selection Order**, until the symbol count
   budget or the character budget is reached.
4. Ronda runs its single model review for the head with the diff, the selected
   authoritative documents, and the selected repository context, each labelled
   so the model can tell changed lines from unchanged context.
5. Ronda publishes one review for the head and its check run, as it does today.
6. Ronda records the repository-context outcome for the pass, the number of
   symbols requested and resolved, the budget utilisation, and the reason any
   requested symbol was not resolved.

**Postconditions**:

- Exactly one review exists for that head, containing every finding from the
  pass.
- The pass wrote nothing to the reviewed repository other than that review and
  its check run.
- The repository-context outcome for the pass is Repository context used,
  partial, or unavailable, per **Statuses / Enum Values**.

**Information shown**:

- The review summary states that repository context was used for the pass, how
  many symbols were resolved, and the budget utilisation.
- The check-run output and the logs carry the per-pass repository-context record.

**Actions available**:

- Turn repository context off for the next pass.
- Tighten or loosen the symbol count and character budgets.

**Considerations**:

- A changed line whose symbols cannot be resolved is still reviewed; the pass
  degrades to the context it has rather than failing.
- A pass that ends before review execution — a draft pull request, or an
  automatic run that finds the head's existing check run — reads no repository
  context and records none.

---

### Use Case 2: Operator Bounds The Repository Context Budget

**Actor**: Ronda operator

**Preconditions**: Repository context is available in the running version.

**Steps**:

1. The operator sets the maximum number of symbols a pass may resolve and the
   maximum combined character budget for repository-context excerpts.
2. The operator triggers a review on a pull request whose changed lines name more
   symbols than the budget allows.
3. The operator reads the pass record to confirm the budgets were respected and
   to see which requested symbols were dropped and why.

**Postconditions**:

- The selected repository context is within both budgets.
- Over-budget context is dropped by the recorded selection order, with the drops
  recorded, rather than truncated silently.

**Information shown**:

- The configured budgets, the symbols requested, the symbols resolved, the
  symbols dropped, and the budget utilisation for the pass.

**Actions available**:

- Lower the budgets to protect pass duration and model cost.
- Raise them for a high-risk change, within the operator's own cost policy.

**Considerations**:

- These budgets apply **in addition to** the existing diff budget and the
  authoritative-document count and character budgets; every budget must hold.
- More context is not automatically better. The recorded 2026-09-23 audit shows a
  second reviewer on pull request #98 reaching
  `total tokens over limit: 32000, pruning diff` and publishing nothing. A budget
  that lets repository context crowd out the diff is a regression, not an
  improvement, which is why AC7 requires the diff to survive every budget
  decision.

---

### Use Case 3: Operator Confirms The Read-Only Property By Demonstration

**Actor**: Ronda operator

**Preconditions**: Repository context is available and enabled.

**Steps**:

1. The operator runs a pass over a pull request head that is deliberately hostile
   in the ways a reviewed repository can be: it carries content that would run
   something if any build, install, test, hook, or generated tooling were
   invoked, and content designed to be read as instructions rather than as code.
2. The operator reads the recorded demonstration evidence for that pass.

**Postconditions**:

- The evidence shows that nothing from the reviewed repository was executed, and
  that the pass wrote nothing to the reviewed repository other than its one
  review and check run.
- The evidence shows that content read from the reviewed repository did not change
  what Ronda did — the pass still published one review for the head, and the
  instruction-shaped content produced no action outside that review.

**Information shown**:

- The recorded demonstration in `docs/testing/ronda/`, naming the hostile cases
  attempted, what was observed, and the date and version it was observed on.

**Actions available**:

- Re-run the demonstration against a later version.

**Considerations**:

- The guarantee is **demonstrated, not asserted**: a statement in a document that
  nothing is executed does not satisfy AC4. What satisfies it is a recorded,
  repeatable observation of an attempt that would have executed or written
  something and did not.
- Absence of an observed write is weaker evidence than a structural property. The
  demonstration therefore records both what was attempted and why the property
  holds by construction, and labels which parts of the evidence are of which
  kind.

---

### Use Case 4: A Fork-Originated Pull Request Is Reviewed

**Actor**: Ronda, acting for the operator, on a pull request whose head is a fork

**Preconditions**: A fork-originated head is under review.

**Steps**:

1. Ronda determines that the reviewed head belongs to a fork of the base
   repository.
2. On the reusable-workflow ingress, the pass is skipped before any repository
   content is read, exactly as it is skipped today.
3. On the webhook ingress — the fork-friendly ingress recorded in
   [`ronda-review-adoption.md`](../../../adoption/ronda-review-adoption.md) —
   Ronda applies the fork switch. With it off, the pass reviews the head with no
   repository context. With it on, Ronda reads repository context for that head
   only from the reviewed head's own repository, treats every byte of it as
   untrusted data rather than instructions, and never executes any of it.
4. On the webhook ingress, Ronda publishes one review for the head, and — where it
   emitted a repository-context record — that record states that the head was
   fork-originated. On the reusable-workflow ingress no review is published,
   because step 2 already ended the pass; that is today's behaviour and this
   feature does not change it.

**Postconditions**:

- No fork content is executed on either ingress.
- Where repository context is read for a fork head at all, it is read from that
  head's own repository and from no other repository. Where the fork switch
  withholds it, no repository content is read for that head.
- Where a repository-context record exists for the pass, it states that the head
  was fork-originated, so an operator reading the evidence can tell fork passes
  from same-repository passes.

**Information shown**:

- The pass record's fork marker and repository-context outcome.

**Actions available**:

- Disable repository context for fork-originated heads while leaving it enabled
  elsewhere.

**Considerations**:

- Fork behaviour is the sharpest question the amendment raises, and one part of it
  is the repository owner's to decide, not this spec's: whether reading fork-head
  content is acceptable at all in this iteration, or whether repository context
  must be off for fork heads until a later item. See **Open Questions**. The
  requirements above hold under either answer; the switch in AC10 is what makes
  both answers implementable without re-speccing.
- The residual risk after "never executed" is not code execution but the model
  being steered by content it read. AC9 requires that risk to be bounded by
  treating repository content as data and by the pass's own output contract, not
  by trusting the content.

---

### Use Case 5: Operator Measures Recall Against The Three Target Sub-Themes

**Actor**: Ronda operator

**Preconditions**:

- The fixture seeds added by
  [105-category-forced-review-sweep](../20260925143028_105-category-forced-review-sweep/1_105-category-forced-review-sweep_specs.md)
  exist for state reconstruction from API evidence, lossy external-output
  parsing, and a guard that fails open.
- A model credential is configured.

**Steps**:

1. The operator runs the seeded benchmark with repository context off and with it
   on, interleaved, under one immutable model version and a configuration
   identical apart from the context switch, the same number of runs per arm.
2. The operator reads per-run recall for both arms, overall and for each of the
   three target seeds.
3. The operator runs the paired precision fixtures under the same two arms and
   records the regression result.
4. The operator records the evidence, its arms, its model version, its run count,
   and what it does and does not support.

**Postconditions**:

- Recorded evidence states per-run recall for both arms and for each target seed,
  and states explicitly whether the fixture could test this feature at all.

**Information shown**:

- Per-run recall per arm, the mean of per-run recalls, the population standard
  deviation of per-run recall, the per-seed found counts, the precision result,
  and the recorded admissibility of the comparison.

**Actions available**:

- Declare the fixture comparison inadmissible and rely on the real-pull-request
  cohort instead.

**Considerations**:

- **The fixture may be unable to test this feature, and the evidence must say so
  rather than report a number that means nothing.** Repository context can only
  help where the reviewed target actually has surrounding source for the symbols
  the changed lines name. AC13 makes that a precondition of admissibility.
- The recorded 2026-09-28 sweep evidence is the cautionary precedent: its two arms
  were found **not admissible** as a paired comparison because model drift between
  the arms could explain any difference. Interleaving the arms under one immutable
  model version, required by AC15, exists to avoid repeating that.
- That same evidence is also why this lever is worth measuring at all, and the
  spec reports it honestly in both directions: the state-reconstruction seed was
  found in none of the ten recorded sweep-off runs and 3 of 10 sweep-on runs, and
  the lossy-parsing seed likewise none of 10 and 3 of 10 — the sweep did not solve
  them — while the guard-fails-open seed went from none of 10 to 10 of 10, so that
  third sub-theme may already be addressed by the sweep and its share of any
  improvement here must not be claimed twice.

---

### Use Case 6: Operator Measures Cost And Pass Duration Against The Committed Baseline

**Actor**: Ronda operator

**Preconditions**: Repository context has run on real pull requests of this
repository.

**Steps**:

1. The operator records, per pass, the pass's elapsed time, the billed minutes of
   its jobs, the model calls it made, the symbols resolved, and the budget
   utilisation.
2. The operator compares those figures against
   [`cost-convergence-baseline-2026-09-23.md`](../../../testing/ronda/cost-convergence-baseline-2026-09-23.md)
   and against the measured dogfood pass recorded in
   [`dogfood-evidence-103.md`](../../../testing/ronda/dogfood-evidence-103.md).
3. The operator states whether the pass budget in effect was sufficient and
   whether any pass hit its budget or the job backstop.

**Postconditions**:

- Recorded cost evidence names its two paired arms, names the committed baseline
  and the dogfood pass as descriptive references rather than arms, and states
  whether the budget held.

**Information shown**:

- Per-pass elapsed time and billed minutes for both arms, model calls per pass,
  the count of passes that exhausted the context time budget, and the count that
  hit the pass budget or the job backstop.

**Actions available**:

- Lower the context budgets.
- Ask the repository owner to decide on a higher pass budget (see **Open
  Questions**).

**Considerations**:

- The committed baseline is the comparison point and it is specific: 888.1
  minutes of Actions wall time and an estimated 4,508 runner minutes across
  1,020 workflow-run attempts in the six-day window of 2026-09-17 to
  2026-09-23, during which `Ronda review` ran zero times.
- The recorded dogfood measurement is one pass of 23 seconds of job time on an
  82-line diff, billed as 2 minutes because a pass is two jobs and GitHub rounds
  each job up. The recorded projection for the same window is about 136 billed
  minutes, roughly 15% of that baseline. **One sample supports no per-line
  estimate**, and AC14 therefore requires the comparison to be made on measured
  passes rather than on a re-projection.
- The pass budget in effect on the reusable-workflow ingress is
  `pass_timeout_minutes`, default 10 minutes, with the job's own backstop set to
  that value plus two. Whether that default should rise is the owner's cost
  decision, not this spec's; what this spec fixes is that repository context must
  **fit inside whatever budget is in effect** (AC8) rather than require a larger
  one.

---

### Use Case 7: Operator Decides Whether The Real-Pull-Request Claim Is Admissible Yet

**Actor**: Ronda operator (repository owner for the decision)

**Preconditions**: Repository context has run on real pull requests of this
repository.

**Steps**:

1. The operator reads the evidence-tier ledger recorded for this feature.
2. The operator reads the count of terminally adjudicated pull requests carrying
   a paired context-off and context-on comparison under the current
   configuration.
3. The operator decides which claims the evidence admits, and publishes only
   those.

**Postconditions**:

- Every published claim about the effect on real pull requests is labelled with
  its evidence tier, and no claim exceeds what its tier admits.

**Information shown**:

- The tier, the counted pull requests, the date the state was recorded, and the
  caveats each claim carries.

**Actions available**:

- Hold a claim back until the cohort closes.

**Considerations**:

- **There is no historical "before" and there never will be.** Dogfooding was
  wired by #103, which is closed, so passes accumulate from now; but no merged
  pull request carries a Ronda review from before that, and the recorded
  evidence-tier ledger for the sweep still stands at `fixture_only` with zero
  counted pull requests. A time-ordered before-and-after would also confound
  model drift with the change. The comparison this feature makes is therefore a
  **paired context-off and context-on comparison on the same heads**, not a
  before-and-after in time (AC15).
- Ronda's evidence is drawn from Ronda's own repository, by the same project that
  wrote the review configuration and the seeds. Every claim carries the
  independence caveat and the own-repository label already recorded for the
  sweep.

---

## Business Rules

- Ronda stays comment-only: it never pushes to, merges, or otherwise mutates the
  pull request under review or its repository, beyond the one review and check
  run it already publishes.
- One review per head SHA, containing every finding from the pass, holds
  unchanged with repository context active. Repository context never splits a
  pass into multiple published reviews and never adds a model pass.
- Ronda never executes any content of the reviewed repository: no build, no
  dependency install, no test, no script, no hook, no generated tooling, on any
  ingress, for any head, fork or not.
- Content read from the reviewed repository is untrusted data. It never becomes
  an instruction to Ronda, never changes Ronda's output contract, and never
  causes Ronda to read anything outside the reviewed head's own repository.
- Repository context is off by default and is enabled by operator configuration,
  resolved where Ronda's other operator switches are resolved: the workflow input
  on the reusable-workflow ingress, and the one deployment-scoped operator
  configuration value on the webhook ingress, which serves every repository that
  process handles.
- The fork switch is a second operator-configuration value resolved from that
  same source and applying only on the webhook ingress. It can only withhold
  repository context from fork-originated heads; it can never grant context that
  the global switch has not already enabled, and it never affects non-fork heads.
  Which of its two forms ships is Open Question 3 (AC10).
- Both switches resolve fail-closed, and the rule is the same for each. An absent,
  empty, or whitespace-only value is not a value: it defers to the next
  lower-precedence source, and where no source supplies one, the switch is off and
  nothing is recorded — an absent switch must be indistinguishable from a version
  without the feature (AC19). A non-empty value that is not a recognised on or off
  value is the effective value and resolves to **off**; it is not replaced by a
  recognised value at a lower-precedence source, and that a value was unrecognised
  is recorded on the surfaces the pass record uses, without the raw value. A
  recognised off value resolves to off and records nothing, exactly as an absent
  value does.
- Repository context is read at the reviewed head, and only at the reviewed head,
  so the context and the diff describe the same state of the code.
- A pass never exceeds its configured symbol count budget or character budget,
  and those budgets hold in addition to the existing diff budget and the
  authoritative-document budgets.
- The diff is never dropped, truncated, or displaced to make room for repository
  context. When budgets conflict, repository context is what gives way.
- Repository-context selection for the same head and the same configuration is
  reproducible, so an operator can answer "why did Ronda not see that?".
- A repository-context read that fails, is unavailable, or is refused never fails
  the pass and never suppresses the review the pass would otherwise publish. The
  pass degrades to the context it has and records the outcome.
- Repository context is bounded by its own time budget inside the pass budget in
  effect. When that time budget is exhausted the pass proceeds with the context it
  already has; it never extends the pass deadline and never raises the job
  backstop.
- A pass that ends before review execution reads no repository context and records
  no repository-context outcome, so such a pass is indistinguishable from the same
  outcome with the feature off.
- Any working area a pass creates to read repository content is removed when that
  pass settles — on success, on failure, on supersede, on watchdog abort, and on
  the local server's startup reconciliation — and is never shared with or reused
  by another pass.
- The webhook ingress keeps its existing one-active-review-job rule and its
  bounded queue. Repository context adds no concurrency to it.
- A cleanup failure is recorded and never publishes a second review for the head.
- No repository content, credential value, credential name, or operator-specific
  path is written to the logs, the pass record, or any committed evidence
  document. Quoting the reviewed code inside a published finding, as reviews
  already do, is not affected by this rule.
- Every recorded effect claim states its evidence tier, carries the independence
  caveat and the own-repository label, and is drawn from a paired comparison under
  one immutable model version with equal run counts per arm.
- The read-only property is established by demonstration on a hostile case, not
  by assertion in a document.
- No implementation work on this feature begins before the amendment above is
  recorded as accepted or rejected.

---

## Context Selection Order

The recorded selection order is a product contract, not an implementation
choice: AC6 drops context by it and AC20 makes selection reproducible, so
leaving it unstated would force implementers to invent the contract and would
make "why did Ronda not see that?" unanswerable.

**Candidates.** Exactly two kinds of repository content are ever candidates, and
neither reaches further than a single step from the changed lines:

1. **Depended-on definitions** — the definition of each symbol a changed line
   calls, reads, or otherwise depends on directly.
2. **Call sites** — the places that call or read each symbol the change itself
   defines or modifies.

Nothing transitive is a candidate. The definition of a symbol that only a
*candidate* names, and the callers of a caller, are out of scope for this
iteration (see **Out of Scope (MVP)**), so the candidate set is bounded by the
changed lines alone.

**Priority.** Candidates are ordered by these keys, each applied only to break a
tie in the one before it, so the order is total and the same every time:

1. **Kind**: depended-on definitions before call sites. The recorded finding
   corpus is why: the dominant cluster is code treating a value as evidence of
   something it does not establish, and that is answered by the definition of
   what produced the value, not by its callers.
2. **Changed-line position**: for a depended-on definition, the position of the
   earliest changed line that depends on it; for a call site, the position of the
   earliest changed line whose defined symbol it calls. Earlier first, where
   position is ordered by changed file path ascending, then by line number
   ascending.
3. **Candidate location**: the candidate's own file path ascending, then its line
   number ascending.
4. **Symbol name** ascending, as the final tie-break, so two candidates that are
   identical under every key above still have one defined order.

**Dropping.** Candidates are taken in that order until the symbol count budget or
the character budget would be exceeded. Everything not taken is dropped whole —
never truncated mid-excerpt — and each drop is recorded with its reason: symbol
count budget, character budget, time budget, or read did not succeed. A single
candidate that alone exceeds the character budget is dropped and recorded, not
truncated.

**Reproducibility.** The order depends only on the reviewed head, the changed
lines, and the configuration. It never depends on read latency, the order in which
reads complete, or anything else that can vary between passes (AC20).

---

## Statuses / Enum Values

### Repository-context pass outcome

Three outcomes are recorded on a pass's surfaces, and two name the cases where
**no record is emitted at all**. The distinction matters because AC19 requires a
pass with the feature disabled to be indistinguishable from the same pass in a
version without the feature, which a recorded "off" value would defeat.

| Code value | Display label | Recorded? | Description |
| --- | --- | --- | --- |
| `used` | Repository context used | Yes | Every symbol the selection rules requested was resolved within budget. |
| `partial` | Repository context partial | Yes | Some requested symbols were resolved and others were dropped, because a budget was reached, the time budget was exhausted, or an individual read did not succeed. |
| `unavailable` | Repository context unavailable | Yes | Repository context was enabled but no symbol could be resolved for the pass. |
| `off` | Repository context off | No | Repository context was not enabled for the pass. No symbols were requested, and no repository-context record, activation statement, or budget figure appears on any surface (AC19). |
| `not_applicable` | Repository context not applicable | No | The pass ended before review execution — a draft pull request, or an automatic run that found the head's existing check run — so no context was requested and no outcome is owed. No record appears on any surface. |

**Valid transitions**: the outcome is decided once per pass and never changes
afterwards. A pass that does not reach review execution is `not_applicable`. A
pass that reaches review execution with the feature disabled is `off`. A pass
that reaches review execution with it enabled is `used`, `partial`, or
`unavailable` according to how many requested symbols were resolved: all of them,
some of them, none of them.

### Evidence tier

This feature reuses the evidence-tier vocabulary recorded for
105-category-forced-review-sweep rather than defining a second one, so one
ledger convention covers both levers.

| Code value | Display label | Description |
| --- | --- | --- |
| `fixture_only` | Fixture evidence only | No real-pull-request review with repository context enabled is recorded. Fixture claims only. |
| `real_pr_provisional` | Real-PR evidence (provisional) | At least one such review is recorded, but the cohort is not closed and terminally adjudicated. Descriptive, indicative claims only. |
| `real_pr_measured` | Real-PR evidence (measured) | A closed, terminally adjudicated cohort of the agreed minimum size exists under the current configuration. Comparative claims permitted, subject to each claim's own required evidence. |

**Valid transitions**:

- `fixture_only` → `real_pr_provisional` when the first real-pull-request review
  with repository context enabled is recorded, even before its findings are
  adjudicated.
- `real_pr_provisional` → `real_pr_measured` when the cohort reaches the agreed
  minimum of terminally adjudicated pull requests under the current configuration.
- `real_pr_measured` → `real_pr_provisional` whenever the counted total falls
  below that minimum, including after a configuration change, until it is
  restored.
- Every other combination leaves the tier unchanged.

The minimum cohort size is an open question for the repository owner; until it is
answered the ledger records the count and the tier stays `real_pr_provisional`.

### Decision-gate consistency matrix

This feature adds seven decisions whose outcome depends on more than one input.
Each row below is the normative summary for its gate; the prose sites named under
**Mirror surfaces** state the same rule and must not contradict this table.

| Gate | Inputs | Allowed outcomes | Required next action | Mirror surfaces | Example |
| --- | --- | --- | --- | --- | --- |
| Amendment decision (AC1, AC2) | The repository owner's recorded decision on the proposed amendment | Accepted; accepted with changes; rejected; not yet recorded | Accepted or accepted with changes: implementation may start, against the recorded text. Rejected: terminate the item with that record as its only outcome (AC2). Not yet recorded: no implementation work starts | Proposed Amendment section; AC1; AC2; the closing business rule; Open Question 1 | A partial acceptance that keeps the no-checkout mechanism but permits content reads is an "accepted with changes" outcome, and the recorded text is what implementation follows — not this spec's proposed wording. |
| Switch resolution (AC19, AC21) | The global repository-context switch value and, on the webhook ingress, the fork switch value, each read from the highest-precedence source that supplies a non-empty value | Off — absent, empty, or whitespace-only at every source (nothing recorded); Off — a recognised off value (nothing recorded); Off — a non-empty unrecognised value (record that a value was unrecognised, without the raw value); On — a recognised on value | Every off outcome runs the ordinary review with no repository context and no record, except that the unrecognised case additionally records that a value was unrecognised; on: proceed to candidate selection. The fork switch can only move the result from on to off, never the reverse | Business rules on switch resolution and on the fork switch; AC19; AC21; AC10 | An empty value at a higher-precedence source defers to the next source rather than forcing off. A non-empty unrecognised value at a higher-precedence source is the effective value and is not replaced by a recognised value below it. A fork switch set on while the global switch is off leaves the pass with no repository context. |
| Repository-context outcome resolution (AC3, AC11, AC19) | Whether the pass reached review execution; whether the feature was enabled; how many requested symbols were resolved | Not applicable — did not reach review execution (no record); Off — reached review execution, not enabled (no record); Used — all requested symbols resolved; Partial — some resolved; Unavailable — none resolved | The three recorded outcomes are written to the check-run output where the pass's own check-run write produced a check run whose outcome is a review, and to the logs otherwise; never to the review body. The two unrecorded outcomes write nothing anywhere | Statuses / Enum Values → Repository-context pass outcome; AC3; AC11; AC19; Use Case 1 steps 1 and 6 | A draft pull request is Not applicable and writes nothing, so it is indistinguishable from the same skip with the feature absent. A pass whose every read is denied is Unavailable and still publishes its review. |
| Budget conflict resolution (AC6, AC7) | The symbol count budget; the character budget; the existing diff budget; the authoritative-document budgets; how much context the selection rules requested | Within every budget — all requested context retained; over a context budget — lower-priority repository context dropped by the recorded selection order, with the drops recorded; the diff would have to give way — not permitted | Retain the diff in full, drop repository context, record every drop and its reason, and record the outcome as Partial | Business rules on budgets and on the diff never giving way; AC6; AC7; Use Case 2 | A change naming more symbols than the count budget allows drops the lowest-priority symbols and records Partial. A budget setting large enough that repository context would displace the diff is resolved by dropping context, never by truncating the diff — the recorded reviewer that reached a token limit and pruned the diff published nothing, which is the failure this row forbids. |
| Context time budget exhaustion (AC8) | The context time budget; the pass budget in effect; whether the time budget was exhausted before selection finished | Not exhausted — proceed with the full selection; exhausted — proceed with the context already gathered | Proceed to review execution, publish the review, record Partial or Unavailable, and never extend the pass deadline or the job backstop | Business rule on the context time budget; AC8; Use Case 6 | A time budget forced low enough to be exhausted before any symbol resolves records Unavailable and still publishes one review for the head. |
| Fork-head behaviour per ingress (AC10) | The ingress; whether the reviewed head belongs to a fork; which form of the fork switch shipped (operator-settable, or fixed off per Open Question 3) and its value | Reusable-workflow ingress with a fork head — the pass is skipped before any repository content is read, unchanged from today; webhook ingress with a fork head and the fork switch on — repository context is read from that head's own repository only, as untrusted data, never executed; webhook ingress with a fork head and the fork switch off, whether by its value or because it shipped fixed off — the pass reviews the head with no repository context; non-fork head — the global switch alone decides | Publish a review exactly as today in every case where a review is published, and record the fork marker wherever a repository-context record is emitted | AC9; AC10; Use Case 4; the untrusted-data and never-executed business rules | With the fork switch off, a fork head on the webhook ingress still receives its ordinary review; only the repository context is withheld, the outcome is Off, and no repository-context record and therefore no fork marker is written. |
| Evidence-tier transition and claim admissibility (AC13, AC15, AC16, AC17, AC18) | Whether any real-pull-request review with repository context enabled is recorded; the count of terminally adjudicated pull requests under the current configuration against the agreed minimum; whether the configuration changed; for a claim, whether it is paired, interleaved, under one immutable model version, with equal run counts, and — for a recall claim — whether paired precision evidence with its regression result exists | `fixture_only`, `real_pr_provisional`, or `real_pr_measured` per the transitions above. For a claim: fixture claim permitted at any tier only where AC13's fixture-capability statement admits it; descriptive real-PR claim permitted at `real_pr_provisional` and above; comparative claim permitted at `real_pr_measured` and only with AC15's pairing and, for recall, AC16's precision evidence | Label every published claim with its tier, the independence caveat, and the own-repository label; omit a claim the tier or its own evidence does not admit rather than publishing it hedged; never attribute the guard-fails-open movement already observed under the sweep to repository context (AC18) | Statuses / Enum Values → Evidence tier; AC13; AC15; AC16; AC17; AC18; Use Case 5; Use Case 7 | A comparative recall claim on ten adjudicated pull requests but with the two arms run weeks apart under different model versions is not admissible: the tier permits comparative claims, AC15's interleaving under one immutable model version does not — the recorded sweep comparison failed on exactly this. A fixture whose target has no resolvable surrounding source yields no claim at all, not a zero effect. |

---

## Operational Visibility

- **Review summary**: states that repository context was active for the pass, how
  many symbols were resolved, and the budget utilisation, in the same way existing
  review-mode activation is recorded. No list of resolved symbols is published in
  the review body.
- **Per-pass repository-context record**: the outcome, the symbols requested, the
  symbols resolved, the symbols dropped with the reason for each drop, the budget
  utilisation, and whether the head was fork-originated. It is carried on the
  pass's check-run output where the pass's own check-run write produced a check
  run whose outcome is a review, and on the logs otherwise — the same surface rule
  the existing per-pass records follow. It never appears in the review body.
- **Read-only demonstration record**: the committed evidence document under
  `docs/testing/ronda/` naming the hostile cases attempted, what was observed, the
  version and date, and which parts of the evidence are structural and which are
  observational.
- **Recall and cost evidence**: per-run recall per arm, per-seed found counts,
  precision result, per-pass elapsed time and billed minutes per arm, model calls
  per pass, run counts, immutable model version, reviewed target, fixture version,
  timestamps, and the evidence-tier label.
- **Evidence-tier ledger**: the tier, the counted pull requests, the configuration
  the count accrues under, and the date the state was recorded.
- **Logs**: the outcome, the counts, the budget utilisation, and cleanup
  completion. Logs never record repository content, credential values, or
  operator-specific paths.
- **Notifications**: none beyond the existing GitHub review and check-run
  surfaces.

---

## Acceptance Criteria

- [ ] AC1: The proposed amendment above is recorded as a decision by the
      repository owner — accepted, accepted with changes, or rejected — with the
      date, before any implementation work on this feature starts. The recorded
      decision names which of the two commitments in the current locked decision
      it changes and which it keeps.
- [ ] AC2: If the amendment is rejected, this item terminates with that recorded
      decision as its only outcome, and **none of AC3 to AC21 is built** — no
      repository-context capability, no switch, no budget, no record, and no
      evidence artifact of any kind, including the off-by-default and
      reproducibility criteria, which exist only as properties of a capability
      that is not built. The rejection is verifiable by the absence of any
      repository-context capability, configuration surface, or evidence document
      in the shipped version.
- [ ] AC3: With the amendment accepted and repository context enabled, a review
      pass that reaches review execution requests the candidates the selection
      rules produce for the changed lines and resolves them at the reviewed head
      as far as the budgets allow and the reads succeed — a pass that resolves
      some is `partial` and a pass that resolves none is `unavailable`, both
      governed by AC6, AC8, and AC11 — and its check-run output — where that pass's own
      check-run write produced a check run whose outcome is a review — and its logs
      each state the pass's repository-context outcome, the symbols requested, the
      symbols resolved, and the budget utilisation. Where no such check run exists,
      the record is on the logs alone. No such record appears in the published
      review body.
- [ ] AC4: A recorded demonstration exists in `docs/testing/ronda/` in which a
      pass reviews a head whose content would execute something if any build,
      install, test, hook, or generated tooling were invoked, and the evidence
      shows nothing of the reviewed repository was executed and nothing was written
      to it beyond the one review and its check run. The evidence names the version
      and date it was observed on and labels which parts are structural and which
      observational. An assertion without such an observation does not satisfy this
      criterion.
- [ ] AC5: A recorded demonstration exists in which a pass reviews a head carrying
      content designed to be read as instructions to the reviewer, and the evidence
      shows the pass still published exactly one review for that head and took no
      action outside it.
- [ ] AC6: A pass never exceeds its configured maximum symbol count or maximum
      combined character budget for repository context. With more symbols requested
      than the budgets allow, the pass records which symbols were dropped and why,
      and the retained context follows the recorded selection order.
- [ ] AC7: With repository context enabled at any budget setting, the pull
      request's own changed lines are present in the review input in full, to the
      same extent as with the feature off. A budget decision never drops or
      truncates the diff to make room for repository context.
- [ ] AC8: Repository context is bounded by its own time budget inside the pass
      budget in effect. A pass whose context time budget is exhausted proceeds to
      review execution with the context it already has, records `partial` or
      `unavailable`, publishes its review, and does not extend the pass deadline or
      the job backstop. This is verifiable by forcing the time budget low enough to
      be exhausted.
- [ ] AC9: Repository content read by a pass never changes Ronda's output
      contract: the pass publishes one review for the head, writes nothing else to
      the reviewed repository, and reads content from no repository other than the
      reviewed head's own.
- [ ] AC10: Fork-originated heads behave as follows and are verifiable per
      ingress: on the reusable-workflow ingress the pass is skipped before any
      repository content is read, unchanged from today; on the webhook ingress
      repository context for a fork-originated head is governed by the fork switch,
      which can only **withhold** context and can never grant context the global
      switch has not enabled. The switch has two recorded forms, and Open Question 3
      decides which ships: **fork reads permitted** — the switch is
      operator-settable, with its default recorded; or **fork reads not permitted in
      this iteration** — the switch is fixed off, no configuration value of any kind
      can enable fork-head reads, and that is verifiable by attempting to enable it
      and observing that no repository content is read. Under either form a fork head
      still receives the review it receives today. Every pass that emits a
      repository-context record states
      whether the head was fork-originated; a pass that emits no such record —
      because the feature or the fork switch was off, or because the pass did not
      reach review execution — states nothing, preserving AC19.
- [ ] AC11: A repository-context read that fails, is refused, or returns nothing
      never fails the pass and never suppresses the review the pass would otherwise
      publish. The pass records `partial` or `unavailable` and publishes its
      review. This is verifiable by denying the reads for a pass.
- [ ] AC12: The webhook ingress runs no more concurrent review jobs with
      repository context than without it, and any working area a pass created is
      gone once that pass settles — on success, failure, supersede, watchdog abort,
      and startup reconciliation. Verifiable by running repeated passes and
      confirming nothing accumulates, and by aborting a pass mid-read and
      confirming its working area is gone and no second review was published for
      the head.
- [ ] AC13: Recall evidence exists for the three target sub-themes —
      state reconstruction from API evidence, lossy external-output parsing, and a
      guard that fails open — reporting per-run recall for both arms overall and per
      seed. The evidence states, before reporting any figure, whether the fixture
      target actually provides resolvable surrounding source for the symbols in its
      changed lines; where it does not, the fixture comparison is recorded as unable
      to test this feature and supports no claim about it.
- [ ] AC14: Cost evidence exists reporting per-pass elapsed time, billed minutes,
      model calls per pass, and symbols resolved, for both arms, on measured passes
      rather than a projection. It reports two distinct things and labels which is
      which: the **comparative** figures, which are the context-off against
      context-on difference and are subject to AC15; and the **descriptive
      reference** figures, which are the committed 2026-09-23 cost and convergence
      baseline and the measured dogfood pass, cited to size the absolute cost
      against what this repository already spends. A descriptive reference is not
      an arm and is never paired — it was recorded before this feature existed, so
      pairing it is impossible — and no effect on recall, variance, or cost is read
      from a difference against it. AC14 also states how many passes exhausted the
      context time budget and how many hit the pass budget or the job backstop, and
      whether the pass budget in effect was sufficient.
- [ ] AC15: Every **comparative** claim drawn from AC13 or AC14 — that is, every
      claim of an effect attributed to repository context — rests on a paired
      context-off and context-on comparison on the same targets or heads,
      interleaved, under one immutable model version, with a configuration
      identical apart from the context switch and the same number of runs per arm.
      A time-ordered before-and-after comparison, and a comparison against a
      descriptive reference figure recorded before this feature existed, neither
      satisfies this criterion, and the evidence says so. This criterion does not
      apply to the descriptive reference figures themselves, which AC14 requires
      and which carry no effect claim.
- [ ] AC16: Paired precision evidence on the same configuration, with its
      recorded regression result, accompanies every recall claim. A recall claim
      without it is not published.
- [ ] AC17: The evidence-tier ledger for this feature records the tier, the
      counted pull requests, the configuration the count accrues under, and the
      date. Every published claim about real pull requests carries its tier label,
      the independence caveat, and the own-repository label, and no claim exceeds
      what its tier admits.
- [ ] AC18: The evidence records that the guard-fails-open sub-theme already moved
      under the recorded category-forced sweep, and does not attribute that
      movement to repository context. Any improvement claimed for that sub-theme is
      stated as additional to the sweep or not claimed.
- [ ] AC19: Repository context is off by default. A version with the feature
      present but not enabled produces reviews, check runs, skips, supersedes, and
      failure paths indistinguishable from the same version with the feature absent,
      and records no repository-context outcome.
- [ ] AC20: Repository-context selection is reproducible: the same head with the
      same configuration selects the same symbols, and the pass record is sufficient
      to explain why a given symbol was or was not included.
- [ ] AC21: Each switch resolves fail-closed and is verifiable by setting it to
      each case: absent, empty, and whitespace-only values leave the switch off and
      record nothing; a recognised off value leaves it off and records nothing; a
      non-empty unrecognised value leaves it off, is not overridden by a recognised
      value at a lower-precedence source, and records that a value was unrecognised
      without recording the raw value; only a recognised on value turns the switch
      on.

---

## Brief Objective List

- O1: Answer how the read-only property is proven, and what happens on a fork
  pull request.
- O2: Answer the cost of a checkout plus symbol resolution per pass against the
  recorded per-pull-request Actions figures, with the pass budget knob named.
- O3: Answer which symbols get resolved and what the context budget is, given
  that more context is not automatically better.
- O4: Answer how the webhook path gains the same capability, with the concurrency
  and cleanup that implies.
- O5: Produce a recorded amendment to the locked architecture decision, or an
  explicit decision not to proceed.
- O6: Make read-only repository context available to a review pass, with the
  read-only property demonstrated rather than asserted.
- O7: Produce recall evidence against the `pr-head-push-order`,
  `external-output-parsing`, and `guard-fails-open` sub-themes, which need fixture
  seeds first.
- O8: Produce cost and pass-duration evidence against the committed baseline.
- O9: Do not start implementation until the amendment is agreed and recorded.
- O10: Recognise that measurement requires dogfooded reviews to accumulate and
  that there is no historical "before".
- O11: Sequence after the category-forced sweep, and let its results inform
  whether symbol context is the right next lever.

---

## Coverage Matrix

| Brief objective | Acceptance criteria / disposition | Notes |
| --- | --- | --- |
| O1: Read-only proof and fork behaviour | AC4, AC5, AC9, AC10, plus the proposed amendment | The amendment keeps "never executes the reviewed repository's code" locked and relaxes only the no-checkout mechanism; AC4 and AC5 require demonstration on a hostile head rather than assertion; AC10 fixes per-ingress fork behaviour and an independent fork switch, so either answer to the open fork question is implementable without re-speccing. |
| O2: Cost against the recorded figures, and the pass budget | AC8, AC14 | AC8 makes repository context fit inside the pass budget in effect (`pass_timeout_minutes`, default 10, job backstop that plus two) rather than require a larger one; AC14 compares measured passes against the committed 2026-09-23 baseline and the measured dogfood pass, and reports budget exhaustion. Whether the default budget should rise is an open question for the owner. |
| O3: Symbol selection and context budget | AC3, AC6, AC7, AC20 | Selection resolves the definitions the changed lines depend on and the call sites of what the change defines, in the recorded order defined in **Context Selection Order** — candidates one step from the changed lines only, ordered by kind, then changed-line position, then candidate location, then symbol name, with whole-candidate drops and no mid-excerpt truncation; two budgets bound it, in addition to the existing diff and authoritative-document budgets; the diff is never displaced (AC7), which is the direct answer to the recorded 32,000-token pruning observation; selection is reproducible (AC20). |
| O4: Webhook path, concurrency and cleanup | AC12, plus the working-area and one-active-job business rules | No added concurrency, cleanup on every settlement path including watchdog abort and startup reconciliation, no working area shared between passes, and a cleanup failure never publishes a second review. |
| O5: Recorded amendment or decision not to proceed | AC1, AC2 | The amendment text is proposed here and decided by the owner; rejection terminates the item with that record as its outcome. |
| O6: Context available, read-only demonstrated | AC3, AC4, AC5, AC11, AC19, AC21 | The capability ships off by default, resolves its switches fail-closed so an absent or unrecognised value never enables it (AC21), degrades rather than failing, and has its read-only property demonstrated. |
| O7: Recall evidence on the three sub-themes | AC13, AC15, AC16, AC18 | Per-seed recall for both arms on the seeds added by the sweep item; the fixture's ability to test this feature at all is stated before any figure; precision evidence is mandatory for a recall claim; the guard-fails-open movement already observed under the sweep is not re-attributed here. |
| O8: Cost and pass-duration evidence | AC14, AC15 | Measured rather than projected. Two kinds of figure, labelled apart: the comparative context-off against context-on arms, which AC15 requires to be paired, interleaved, under one immutable model version with equal run counts; and the committed 2026-09-23 baseline and the measured dogfood pass as descriptive references, which are not arms, cannot be paired because they predate the feature, and carry no effect claim. |
| O9: No implementation before the amendment | AC1, AC2, plus the closing business rule | Stated as a gate on starting work, verifiable from the recorded decision's date. |
| O10: Measurement needs accumulated reviews; no "before" exists | AC15, AC17, plus Use Case 7 | The comparison is paired context-off against context-on on the same heads, never a before-and-after in time; the tier ledger governs what may be claimed while the cohort accumulates. #103 is closed, so passes accrue from now, but no pre-dogfood Ronda review exists to compare against and the recorded sweep ledger still stands at fixture-only with zero counted pull requests. |
| O11: Sequence after the sweep; let its results inform the lever | AC18, plus Use Case 5 | The recorded sweep evidence is cited in both directions: the state-reconstruction and lossy-parsing seeds were not solved by the sweep, which is the case for this lever; the guard-fails-open seed moved under the sweep, so AC18 forbids claiming that movement here. The sweep's own paired comparison was recorded as inadmissible for model drift, which is why AC15 requires interleaved arms under one immutable model version. |

### Deferral Notes

- **D1 — "Strategy context: `~/Git/Cerebro/LH/docs/agents/ronda-estrategia-revision.md`
  §2.4 and §5."** Rationale: that document is outside this repository and is not
  readable from it, so no requirement in this spec may depend on it. Everything
  this spec relies on is drawn from committed evidence in this repository. Human
  confirmation requested: confirm that no objective in that strategy document is
  missing from the Brief Objective List above.
- **D2 — "A checkout plus symbol resolution per pass" as literally a checkout.**
  Rationale: the issue names a read-only checkout, and the spec's guarantees are
  stated over the *reads* rather than over the mechanism, so that a locally
  materialised copy and repository content reads are both permitted and both
  bounded by the same guarantees and budgets. Choosing between them is an
  implementation decision for the plan. Human confirmation requested: confirm that
  the amendment may be written over reads rather than mandating a checkout, since
  the narrower wording is what keeps the "never executed" property intact.

---

## Out of Scope (MVP)

- Executing anything from the reviewed repository — building it, installing its
  dependencies, running its tests, its hooks, or its generated tooling. This is
  not a deferral; it stays prohibited.
- Any write to the reviewed repository beyond the one review and check run Ronda
  already publishes. Ronda still never pushes a fix.
- Reading any repository other than the reviewed head's own.
- Transitive context: the definition of a symbol that only a candidate names, and
  the callers of a caller. Candidates stay one step from the changed lines (see
  **Context Selection Order**).
- Whole-repository or whole-package context, repository-wide indexing, and
  cross-pull-request or cross-pass carried context. Each pass reads afresh, within
  budget.
- A second model pass, a multi-turn exchange, or any change to the
  one-review-per-head-SHA contract.
- Language coverage beyond what the reviewed repository's own primary language
  needs for the three target sub-themes.
- Per-adopter or per-repository custom selection rules; this iteration ships one
  recorded selection order and operator budgets.
- Changing the reusable-workflow fork behaviour. Fork heads stay unreviewed on
  that ingress; the webhook ingress remains the fork-friendly one.
- Raising the default pass budget or the job backstop (see **Open Questions**).
- Setting a recall target, a variance ceiling, or a cost ceiling for repository
  context (see **Deferred Decisions**).
- Making repository context the default for adopting repositories (see **Deferred
  Decisions**).
- Claiming that any measured effect generalises to repositories other than the
  one that produced the evidence, or corroborating it in another repository.
- Model tiering and the remaining epic #52 items that are not this one.
- Rebalancing the benchmark fixture's existing seeds, which the sweep item
  already recorded as deferred.

---

## Deferred Decisions

These product decisions are deliberately not made here. None blocks building or
measuring the feature, because it ships off by default and its recall and cost
figures are reported evidence rather than pass/fail gates.

| Decision | Owner | Trigger | Until then |
| --- | --- | --- | --- |
| A recall target and a variance ceiling for repository context | Human (issue owner) | The first paired context-off and context-on runs are recorded | Recall and variance are reported evidence; no run passes or fails on them. |
| A cost ceiling per pass with repository context | Human (issue owner) | Only if repository context is proposed as a default for adopting repositories | Cost per pass is reported and compared against the committed baseline; no cost figure fails this feature. |
| Whether repository context becomes the default for adopting repositories | Human (issue owner) | A `real_pr_measured` tier with an admissible comparative claim exists | It stays off by default. |
| The default values of the symbol count and character budgets | Human (issue owner), informed by the first measured passes | The first passes report budget utilisation | The implementation plan proposes starting values; they are operator-configurable from the first version. |

---

## Open Questions

These are decisions that belong to the repository owner. The first is blocking
for implementation; the rest are blocking only for the parts of the feature they
name, and each is stated rather than guessed.

1. **Is the amendment accepted?** Does the owner accept replacing the locked
   decision with the proposed text above — keeping "the reviewed repository's code
   is never executed" locked and relaxing only the no-checkout mechanism — or
   accept it with changes, or reject it and record the decision not to proceed
   (AC1, AC2)? No implementation may start before this is recorded.
2. **May the amendment be written over reads rather than mandating a checkout?**
   The issue names a read-only checkout; this spec states the guarantees over the
   reads so that repository content reads and a locally materialised,
   never-executed copy are both permitted and identically bounded (Deferral Note
   D2).
3. **Fork heads on the webhook ingress**: may a pass read fork-head content at
   all in this iteration, or must repository context be off for fork-originated
   heads until a later item? AC10 requires the switch either way; this question
   decides its default.
4. **Should the default pass budget rise from 10 minutes**, with the job backstop
   rising with it, and is any increase in billed minutes per pass acceptable — up
   to what figure against the recorded baseline of 888.1 minutes of Actions wall
   time and an estimated 4,508 runner minutes for that six-day window? AC8 makes
   the feature fit the budget in effect, so a "no" is implementable.
5. **What is the minimum cohort size for a `real_pr_measured` claim?** The sweep
   item settled on ten terminally adjudicated pull requests; reusing ten is the
   obvious candidate but is the owner's call, and the tier stays provisional until
   it is answered.
6. **Is off-by-default confirmed** for this repository's own dogfooding, or should
   repository context be enabled here from the first version so the cohort starts
   accumulating immediately?
7. **Does the strategy document named in the issue contain any objective missing
   from the Brief Objective List?** That document is outside this repository and
   could not be read (Deferral Note D1).
