# Terminable Repository-Context Compiler Work - Spec

**Depends on**: 106-read-only-symbol-context

---

## Overview

Read-only repository context (#106) finds and resolves the definitions a pull
request's changed lines depend on by running the TypeScript compiler over the
changed files and the files they import. That compiler work runs inside the same
process as the rest of the review pass, and once it starts nothing can stop it:
the context time budget and the pass deadline can only judge its result after it
finishes. Size caps keep the usual case under a second, but they limit how much
text is compiled, not how long compiling takes.

On the GitHub Actions job runner a slow compile delays one job. On the webhook
ingress — the long-lived server process — the same compile freezes the whole
process: no other delivery is acknowledged, and the server's own watchdog and
recovery cannot run until it finishes. This feature moves that compiler work out
of the process's main line of execution, into an isolated execution context the
pass can stop the moment a budget runs out, so a pathological compile costs at
most its budget and never stalls the server. What a review says and publishes
does not change.

---

## Use Cases

### Use Case 1: A Pass Stops A Compile That Outruns Its Budget

**Actor**: Ronda, running a review pass with repository context on, on any
ingress (webhook server, GitHub Actions job, or a local run).
**Preconditions**: Repository context is enabled for a same-repository head, the
changed lines produced at least one candidate, and the compiler work for finding
or resolving candidates takes longer than the budget that bounds it.

**Steps**:

1. The pass starts the compiler work in its isolated execution context.
2. The bounding budget runs out while that work is still in flight.
3. The pass stops the compiler work at that moment instead of waiting for it.
4. The pass continues without the unfinished context, exactly as it does today
   once that budget has run out.

**Postconditions**: What follows the stop is the existing behaviour for the
budget that ran out — this feature only makes it happen at the budget instead
of after the compile finishes:

- **Context time budget ran out while resolving candidates** (the pass deadline
  still has time): the pass record shows every requested candidate dropped for
  the time budget, the outcome is Repository context unavailable, and the
  review for the head is published exactly as for any other pass whose context
  time budget ran out.
- **Pass deadline ran out** (while finding candidates, or while resolving them
  when what remained of the pass deadline was the lesser bound): the pass ends
  the way a pass whose deadline runs out ends today — as a timed-out pass
  failure — not with a published review. The only change is that it ends at
  the deadline rather than when the compile finishes.

**Information shown**:

- The review body's existing activation statement naming the outcome — nothing
  new.
- The existing per-pass repository-context record in the logs and check-run
  output, with the time-budget drops and the time used.

**Actions available**:

- The operator can read the log event saying the compile was stopped and which
  budget stopped it.

**Considerations**:

- The time recorded as used never exceeds the budget by more than the small
  delay needed to stop the work (see Business Rules).
- Which budget applies is unchanged from #106: finding candidates is bounded by
  the pass deadline alone; resolving them is bounded by the lesser of the context
  time budget and what remains of the pass deadline.

---

### Use Case 2: The Webhook Server Stays Responsive During A Compile

**Actor**: The webhook server (long-lived process) and GitHub, delivering events.
**Preconditions**: A review pass with repository context is compiling
candidates.

**Steps**:

1. GitHub delivers another event to the server while the compile runs.
2. The server acknowledges the delivery and queues or rejects it under its
   existing one-active-review-job rule and bounded queue.
3. The server's watchdog and timers keep running on schedule.

**Postconditions**: Event acknowledgement, the queue, the watchdog, and recovery
behave exactly as they do when no compile is running.

**Information shown**:

- Nothing new; existing webhook logs only.

**Actions available**:

- None new.

**Considerations**:

- This feature adds no concurrency: the server still runs one review job at a
  time. It only stops a compile from monopolising the process.

---

### Use Case 3: The Isolated Execution Context Fails

**Actor**: Ronda, running a review pass with repository context on.
**Preconditions**: The isolated execution context cannot be started, or it stops
unexpectedly (crashes or exits) before returning a result.

**Steps**:

1. The pass detects the failure.
2. The pass treats it exactly like any other failure of the repository-context
   phase today: it continues without repository context.
3. The pass publishes its review.

**Postconditions**: The review is published. The record shows Repository context
unavailable with every requested candidate dropped as a read that did not
succeed, the same record a failed repository-context phase already produces. The
process itself does not crash and no error escapes the pass.

**Information shown**:

- A log event naming which failure happened: could not start, or stopped
  unexpectedly.

**Actions available**:

- The operator can use the log event to tell an isolation failure apart from a
  GitHub read failure, which leaves the same record.

**Considerations**:

- The pass never falls back to running the compiler work in the main line of
  execution, because that would bring back the stall this feature removes (see
  Recorded Decisions).

---

### Use Case 4: Ordinary Passes Are Unchanged

**Actor**: Ronda and the pull request author.
**Preconditions**: Repository context is enabled and the compile finishes well
within its budget — the everyday case.

**Steps**:

1. The pass finds and resolves candidates in the isolated execution context.
2. The pass builds its review from them.

**Postconditions**: For the same head, changed lines, and configuration, the
candidates found, the candidates resolved, the drops and their reasons, and the
excerpts given to the reviewer are the same as before this feature.

**Information shown**:

- The same review and the same record as before this feature, apart from time
  figures.

**Actions available**:

- None new.

**Considerations**:

- A pass with repository context off, a fork-originated head, or a pass that
  ends before review execution starts no isolated execution context at all and
  pays nothing for this feature.

---

## Business Rules

- **Stoppable at the budget.** All repository-context compiler work — finding
  candidates and resolving them — runs where the pass can stop it while it is in
  flight. When the budget that bounds a phase runs out, that phase's compiler
  work is stopped within a short, fixed grace (the plan names the value; it must
  be well under one second), not when it finishes.
- **Same budgets, same outcomes.** This feature changes no budget, no budget
  default, no configuration value, and no pass outcome. A compile stopped by a
  budget is recorded exactly as a context time budget that ran out is recorded
  today: every requested candidate is dropped for the time budget, because a
  stopped compile returns no partial result. A compile stopped because the pass
  deadline ran out leaves the pass to end as a timed-out pass failure, exactly
  as a pass whose deadline runs out does today.
- **Failure is a degraded pass, never a failed one.** If the isolated execution
  context cannot start or stops unexpectedly, the pass proceeds without
  repository context, records it as a failed repository-context phase, and still
  publishes its one review. No error from the isolated execution context crashes
  the process or fails the pass.
- **No in-line fallback.** Compiler work for repository context never runs in
  the process's main line of execution, including when isolation fails.
- **Nothing left behind.** Every isolated execution context a pass starts is
  ended when that pass settles — on success, on failure, on a stopped compile, on
  supersede, and on watchdog abort — and is never shared with or reused by
  another pass. A long-lived server running many passes holds none of them
  afterwards.
- **No new concurrency.** At most one repository-context compile runs per pass at
  a time, and the webhook ingress keeps its one-active-review-job rule and its
  bounded queue.
- **Read-only property unchanged.** The isolated execution context receives only
  the file text the pass has already read through its existing read path. It
  makes no network request, reads no local file of the reviewed repository, and
  executes nothing from the reviewed repository — the #106 invariant that the
  reviewed repository is read, never installed, built, or executed, holds as
  before.
- **Size caps stay.** The existing input-size caps remain as a first line of
  defence; this feature adds a time bound on top of them, it does not replace
  them.
- **Honest time accounting.** Time spent starting and stopping the isolated
  execution context counts against the budget of the phase that started it, and
  the time recorded as used reflects real elapsed time.
- **Same runtimes, no new setup.** Isolation works with no new required
  configuration, secret, or dependency on every ingress the pass already runs on:
  the webhook server, the GitHub Actions job (including the reusable Action), and
  a local run. It requires no change to the Action definition or to any workflow
  file.

---

## Operational Visibility

- **Logs**: one structured event when compiler work is stopped by a budget,
  naming the phase (finding or resolving candidates) and the budget that ran out
  (pass deadline or context time budget); one structured event when the isolated
  execution context could not start; one when it stopped unexpectedly. None of
  these events contains file text, repository content, credentials, or local
  paths.
- **Per-pass record**: unchanged in shape. Stopped compiles appear as time-budget
  drops; isolation failures appear as a failed repository-context phase.
- **Notifications**: none.
- **Audit trail**: none beyond the existing per-pass record.

---

## Acceptance Criteria

- [ ] AC1: With repository context on, a resolution compile forced to run longer
      than the context time budget (for example, by a deliberately slow compile
      in a test environment) is stopped within the grace the plan names after the
      budget runs out — measured from budget expiry, not from compile completion
      — and the pass records the requested candidates as time-budget drops,
      records Repository context unavailable, and publishes its review.
- [ ] AC2: The same holds for the candidate-finding compile under the pass
      deadline: a finding compile forced to outlast the pass deadline is stopped
      within the grace — measured from deadline expiry — and the pass ends as
      the existing timed-out pass failure, exactly as a pass whose deadline ran
      out during repository context ends today, raising no unhandled error.
- [ ] AC3: While a deliberately slow compile is in flight, the process's own
      event loop keeps serving work: a timer scheduled during the compile fires
      within a small bound of its due time (the plan names the bound), and on the
      webhook server a new delivery received during the compile is acknowledged
      and queued or rejected under the existing queue rules without waiting for
      the compile.
- [ ] AC4: If the isolated execution context cannot be started, the pass records
      Repository context unavailable with every requested candidate dropped as a
      read that did not succeed (no drops when the failure happens while
      finding candidates, since none has been requested yet), emits the "could not start" log event, publishes
      its review, and raises no unhandled error.
- [ ] AC5: If the isolated execution context stops unexpectedly mid-compile, the
      pass records Repository context unavailable as in AC4, emits the "stopped
      unexpectedly" log event, publishes its review, and raises no unhandled
      error.
- [ ] AC6: For the same head, changed lines, and configuration, the candidates
      found, candidates resolved, drops and reasons, and excerpts are identical
      with and without this feature on the existing repository-context test
      fixtures.
- [ ] AC7: After a pass settles in each of these ways — success, a compile
      stopped by a budget, an isolation failure, supersede, and watchdog abort —
      no isolated execution context started by that pass is still running.
- [ ] AC8: A pass with repository context off, a fork-originated head, or a pass
      ending before review execution starts no isolated execution context.
- [ ] AC9: The isolation works under the same runtime CI uses, proven by an
      automated test in the existing test suite that starts a real isolated
      execution context (not a stub) and resolves a candidate through it; the
      change adds no new required configuration, secret, or dependency, and
      changes no Action definition or workflow file.
- [ ] AC10: No log event added by this feature contains file text, repository
      content, credentials, or local paths.
- [ ] AC11: The architecture documentation's repository-context entry records
      that the compiler work runs in an isolated execution context the pass can
      stop at its budget; the resolver's recorded-limitation notes no longer
      describe the compile as uninterruptible; and the repository-context
      evidence document's disclosed residual risk records that it is closed by
      this item.

---

## Brief Objective List

1. Run the candidate-finding compiler work in a terminable execution context.
2. Run the resolution compiler work in a terminable execution context.
3. Let the context/pass deadline terminate an in-flight compile rather than only
   classify its result afterwards.
4. Keep the webhook ingress's event loop, watchdog, and recovery responsive while
   a compile runs.
5. Work under the production runtime (no build step) locally and on GitHub
   Actions, verified before being relied on.
6. Keep resolver logic unchanged — only the call site is wrapped.
7. Handle worker startup failure without an unhandled error.
8. Handle worker crash without an unhandled error.
9. Degrade termination-on-timeout the same way an exhausted time budget does
   (time budget for every requested reference).
10. Get its own design/plan review rather than landing as a review-fix patch.
11. Land before repository context is switched on for the webhook ingress.

## Coverage Matrix

| Objective | Covered by |
| --- | --- |
| 1 | AC2, Business Rules → Stoppable at the budget |
| 2 | AC1, Business Rules → Stoppable at the budget |
| 3 | AC1, AC2 |
| 4 | AC3, Use Case 2 |
| 5 | AC9, Business Rules → Same runtimes, no new setup |
| 6 | AC6 (behavioural parity); the code-level approach is a plan decision |
| 7 | AC4 |
| 8 | AC5 |
| 9 | AC1, Business Rules → Same budgets, same outcomes |
| 10 | Satisfied by this spec and its plan going through the full pipeline |
| 11 | Out of Scope → switching repository context on (sequencing only) |

### Deferral Notes

- **Objective 11 (sequencing)**: this item does not switch repository context on
  anywhere; that switch stays reserved for the repository owner. This item only
  removes the stated blocker. Human confirmation is not requested — the brief
  itself reserves the switch.

---

## Out of Scope (MVP)

- Switching repository context on for this repository, the webhook ingress, or
  any other deployment.
- Changing any repository-context budget, default, configuration value, drop
  reason, or pass outcome.
- Running more than one review job at a time on the webhook ingress, or
  compiling candidates for several passes in parallel.
- Reusing a warm isolated execution context across passes to save startup time.
- Making the offline measurement tooling (the recall and quality benchmarks) use
  isolation; they may keep compiling in-line, since they run one pass at a time
  with no server to stall.
- Bounding memory use of the compile beyond what stopping it at the budget
  already gives.
- Any change to the review prompt, the default model, the GitHub Action
  definition, or workflow files.

---

## Recorded Decisions

| # | Decision | Rationale |
| --- | --- | --- |
| 1 | An isolation failure (could not start, stopped unexpectedly) is recorded as a failed repository-context phase — Repository context unavailable, every requested candidate dropped as a read that did not succeed — not as a new outcome or a new drop reason. | Keeps the #106 record shape and its five drop reasons unchanged, as #106 did for its own size caps. The new log events tell the two causes apart for the operator. Taken from the brief's direction that failures must degrade, not surface as errors. |
| 2 | No in-line fallback when isolation fails. | Falling back would reintroduce the event-loop stall on exactly the inputs most likely to trigger it, defeating the item's purpose. A pass without repository context is the existing, accepted degraded mode. |
| 3 | A resolution compile stopped by the context time budget drops every requested candidate for the time budget; a compile stopped by the pass deadline leaves the pass to end as today's timed-out failure. | The brief's stated degradation ("time budget for every requested reference"); identical to how an exhausted context time budget and an expired pass deadline are already handled. |
| 4 | The input-size caps stay. | Defence in depth: they keep the everyday compile cheap and bound memory, which a time bound alone does not. |
