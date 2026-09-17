# Safely Auto-Recover In-Progress Webhook Jobs — Spec

---

## Overview

When the local webhook service restarts, persisted review jobs that were still
in flight must not be left stranded, and the service must never publish a second
GitHub review for the same pull-request head commit because recovery guessed
wrong after a crash. This feature defines safe automatic recovery for those
ambiguous windows while preserving Ronda's locked one-review-per-head contract
and comment-only behavior. Operators should be able to trust that a restart
either finishes the work, reconciles with GitHub truth, or surfaces a clear
non-silent outcome instead of requiring manual redelivery by default.

## Brief Objective List

- **BO-1**: Preserve the one GitHub review per head SHA contract during and
  after webhook process recovery.
- **BO-2**: Automatically recover in-flight webhook review jobs after restart
  when recovery can be done safely.
- **BO-3**: Reconcile with GitHub before replaying ambiguous jobs so duplicate
  publication is prevented when a review may already exist.
- **BO-4**: Document the recovery model and operator expectations for
  ambiguous or partially completed jobs.

## Use Cases

### Use Case 1: Process Restart After Work Started, Before Any Review Is Public

**Actor**: Ronda webhook service (system-initiated recovery on startup)
**Preconditions**: A pull-request webhook delivery was accepted, the review
job was marked as actively in progress in durable local state, no GitHub review
from Ronda exists yet for that head commit, and the process crashes or restarts
before the job reaches a terminal outcome.

**Steps**:

1. The operator or host restarts the webhook service.
2. On startup, the service inspects durable local state for non-terminal jobs.
3. The service determines that no Ronda review is already public for the
   affected head commit.
4. The service safely resumes or replays the job so review work can complete
   without requiring the operator to manually redeliver the webhook.

**Postconditions**: The stranded job is not silently abandoned; the pull request
eventually receives the expected single Ronda review for that head commit, or
the operator sees an explicit failure outcome rather than silence.

**Information shown**:

- Operator logs or status signals that recovery ran for a previously in-flight
  job, including enough context to identify repository, pull request, and
  delivery identity without reading raw persistence formats.

**Actions available**:

- None required from the operator when automatic recovery succeeds.
- Operator may still manually redeliver or reconcile if recovery reports a
  blocking ambiguity.

**Considerations**:

- Recovery must not create a second review if GitHub already shows a Ronda
  review for the same head commit.
- A restart must not leave the delivery permanently stuck merely because the
  job had entered the in-flight state before the crash.

### Use Case 2: Process Restart After GitHub Accepted the Review, Before Local State Caught Up

**Actor**: Ronda webhook service (system-initiated recovery on startup)
**Preconditions**: Ronda successfully published a GitHub review for the head
commit, but the process crashed or restarted before durable local state
recorded the post-publication checkpoint needed to treat the job as safely
complete or check-pending.

**Steps**:

1. The operator or host restarts the webhook service.
2. On startup, the service inspects durable local state and finds an ambiguous
   in-flight or not-yet-terminal record for that delivery.
3. Before replaying review publication, the service reconciles against GitHub
   to detect that a Ronda review for that head commit already exists.
4. The service advances local state to a safe terminal or check-completion path
   without calling review publication again.

**Postconditions**: Exactly one Ronda GitHub review remains associated with the
head commit; check-run completion or check-pending recovery can proceed from
reconciled truth rather than from a blind replay.

**Information shown**:

- Operator-visible evidence that reconciliation prevented duplicate
  publication, including identification of the delivery and head commit
  involved.

**Actions available**:

- Operator continues normal ADF reviewer-loop consumption of the existing
  review and check run when recovery succeeds.

**Considerations**:

- This window is the primary duplicate-review risk called out by follow-up work
  from PR #51; recovery logic must treat it as first-class, not as an edge case.
- Reconciliation must be durable enough that repeated restarts remain idempotent.

### Use Case 3: Operator Diagnoses Ambiguous Recovery

**Actor**: Operator
**Preconditions**: A webhook job survived a crash in an ambiguous window, or
automatic recovery chose reconciliation instead of replay.

**Steps**:

1. The operator reviews service logs or documented recovery behavior for the
   affected delivery.
2. The operator confirms whether the pull request already has the expected
   single Ronda review and check outcome.
3. If recovery failed loudly, the operator follows documented guidance rather
   than guessing whether a replay is safe.

**Postconditions**: The operator can distinguish safe automatic recovery,
successful reconciliation, and cases that still need manual intervention.

**Information shown**:

- Documented recovery states, triggers, and expected outcomes for ambiguous
  crashes.
- Clear distinction between "job resumed", "job reconciled to existing GitHub
  review", and "job blocked pending human action".

**Actions available**:

- Rely on automatic recovery when documentation says it applies.
- Manually redeliver or reconcile only when documentation or failure signals
  require it.

**Considerations**:

- Documentation should not assume operators inspect raw queue files unless no
  higher-level signal exists yet; product-facing operator guidance is required
  by the brief.

## Business Rules

- **BR-1**: Ronda must never publish more than one GitHub pull-request review
  per head SHA for a given recovery path, including across process restarts.
- **BR-2**: A restart after a job entered the in-flight state must not silently
  abandon the delivery when no Ronda review has been published yet for that
  head commit.
- **BR-3**: When GitHub already shows a Ronda review for the head commit,
  recovery must reconcile local state and must not publish another review.
- **BR-4**: Recovery behavior must be idempotent across repeated restarts for
  the same delivery and head commit.
- **BR-5**: Automatic recovery remains comment-only; recovery must not push
  fixes or mutate the pull-request branch.
- **BR-6**: Failures during recovery must be observable; silent loss of webhook
  work is not acceptable.
- **BR-7**: Peer webhook and workflow items in the same portfolio batch are
  orthogonal to this feature; shared terminology alone does not create a
  product dependency between them.

## Statuses / Enum Values

| Concept | Operator-facing label | Description |
| --- | --- | --- |
| Accepted, not yet running | Queued | Delivery recorded; work has not started. |
| Running | In progress | Review work has started locally; outcome not yet durable. |
| Review public, check incomplete | Awaiting check completion | GitHub review exists; terminal check signaling may still be pending. |
| Finished successfully | Completed | Job reached a safe terminal outcome locally. |

**Valid transitions** (product-level):

- Queued → In progress when review work starts.
- In progress → Completed when the full pass finishes cleanly.
- In progress → Awaiting check completion when the review is public but check
  completion still needs follow-through.
- Awaiting check completion → Completed when check signaling finishes or is
  reconciled safely.
- In progress or Awaiting check completion → Completed via reconciliation when
  startup recovery detects GitHub truth already satisfies the contract.

## Operational Visibility

- **Startup recovery summary**: When restart recovery runs, logs name the
  affected repository, pull request, delivery identity, and whether the outcome
  was resume, reconciliation, or explicit failure.
- **Duplicate-prevention signal**: When reconciliation suppresses replay because
  a review already exists, logs make that decision explicit for operators and
  reviewers.
- **Failure reporting**: Recovery failures include enough context for an
  operator to decide whether to redeliver, wait, or inspect GitHub directly.
- **Documentation**: Operator-facing documentation explains both crash windows,
  expected automatic behavior, and when manual intervention remains appropriate.

## Acceptance Criteria

- [ ] **AC-1**: Given a process crash or restart after review work started and
  durable local state shows the job as in progress, and no Ronda GitHub review
  exists yet for that head commit, the webhook service does not silently strand
  the delivery; the job is automatically recovered to completion or reports an
  explicit failure.
- [ ] **AC-2**: Given a process crash or restart after GitHub accepted Ronda's
  review publication but before durable local state recorded the post-publication
  checkpoint, startup recovery does not publish a second GitHub review for the
  same head SHA.
- [ ] **AC-3**: Automated recovery tests cover both crash windows described in
  AC-1 and AC-2, including repeated-restart idempotency for the reconciliation
  path.
- [ ] **AC-4**: The implementation PR includes planted fail-then-pass evidence
  for the idempotency or reconciliation guard so reviewers can see the guard
  block unsafe replay before the fix and allow safe recovery afterward.
- [ ] **AC-5**: Operator documentation describes the recovery model, both
  ambiguous windows, and expected behavior when reconciliation chooses resume
  versus suppress replay.
- [ ] **AC-6**: Recovery preserves the comment-only contract and does not push
  changes to the pull-request branch.

## Coverage Matrix

| Brief objective | Covered by | Notes |
| --- | --- | --- |
| BO-1 | AC-2, AC-3, AC-4, BR-1, BR-4 | Duplicate-review prevention and idempotency evidence. |
| BO-2 | AC-1, AC-3, BR-2, Use Case 1 | Automatic recovery when no public review exists yet. |
| BO-3 | AC-2, AC-3, AC-4, BR-3, BR-4, Use Case 2 | Reconciliation before unsafe replay. |
| BO-4 | AC-5, Operational Visibility, Use Case 3 | Operator-facing recovery documentation. |

## Out of Scope (MVP)

- Changing the GitHub App registration, tunnel architecture, or public webhook
  URL model.
- Replacing the ADF reviewer-loop or Helm orchestration semantics.
- Building unrelated portfolio batch items; issue #58 is orthogonal to peer
  webhook and workflow items except where they share generic Ronda vocabulary.
- Defining exact persistence filenames, schema fields, or reconciliation
  algorithms; those belong in the implementation plan.
- Manual operator tooling beyond documentation and existing log surfaces unless
  a later item expands observability.

## Deferral Notes

No brief objectives are deferred to out of scope.
