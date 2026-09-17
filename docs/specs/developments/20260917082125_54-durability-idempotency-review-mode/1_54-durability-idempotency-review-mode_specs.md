# Durability and Idempotency Review Mode — Spec

**Depends on**: 53-capture-external-review-misses, 1653-split-reviewer-prompts-by-stage

---

## Overview

Ronda's ordinary review pass optimizes for correctness and security defects visible in a diff. That pass repeatedly misses a different class of defect: what happens when a process stops mid-work, when the same delivery arrives twice, when a retry runs after partial success, or when durable state and in-memory state disagree. External reviewers found real examples of that gap on pull request #51 — queue draining after a fatal error, duplicate ingress without arbitration, replayed webhook deliveries publishing twice, and reviews published while terminal check-run writes still fail.

This feature adds a **durability and idempotency review mode** for implementation changes. When the mode applies, the reviewer is explicitly instructed to reason about restart, retry, timeout, duplicate delivery, partial-success, and persistence-failure scenarios on the changed surfaces — especially webhook workers, job queues, retry policies, check-run publication, and other external side effects. The mode can turn on automatically from the shape of the change or manually through operator configuration. Its findings use the same severity model as today's reviews, but the questions it asks are targeted rather than generic.

The mode does not change Ronda's GitHub contract: comment-only, one review per head, and no automatic fixes.

---

## Issue-Objective Traceability

Every objective stated in issue #54 maps to acceptance criteria and use cases here, or to an explicit entry under **Out of Scope (MVP)** with a deferral note. No objective is dropped.

| # | Objective (from #54) | Where it is satisfied |
| --- | --- | --- |
| 1 | *Problem* — the general pass misses state-machine failures (retries, restarts, partial success, duplicate deliveries, durable queue corruption); Codex found these on PR #51 | Overview; Use Cases 1 and 2; AC-1, AC-2, AC-15 |
| 2 | *Outcome* — a targeted review mode or prompt section for durability/idempotency-sensitive paths (webhook workers, queues, retries, check-run publishing, external side effects) | Use Case 1; Business Rules; AC-3 through AC-8 |
| 3 | *Scope* — explicitly ask the model to reason about restart, retry, timeout, duplicate delivery, partial-success, and persistence-failure scenarios | Statuses / Enum Values (scenario families); AC-4, AC-5 |
| 4 | *Scope* — activate automatically for relevant changed files or manually via configuration | Use Cases 1 and 3; Decision Matrix; AC-6, AC-7, AC-8 |
| 5 | *Scope* — represent at least the PR #51 missed findings as fixtures or prompt regression examples | Use Case 6; AC-14, AC-15 |
| 6 | *Scope* — keep review output concise and actionable, not a generic checklist dump | Business Rules; AC-12, AC-13 |

---

## Relationship to the review-quality category family

Issue #53 defines a closed set of **affected categories** for captured external misses, including durability, idempotency, retries, timeouts, partial success, and concurrency. This feature targets the **implementation-review** slice of that family: defects where code looks locally correct but fails under restart, replay, or incomplete work.

The mode is complementary to strict spec and plan checklists (#1650, #1655) and to maintained review doctrine (#1654). Those features ask document-shape questions or recurring prose patterns. This feature asks **operational lifecycle** questions of running code paths. A single pull request may therefore receive ordinary findings, doctrine-informed findings, and durability-mode findings; none replaces another.

---

## Use Cases

### Use Case 1: An implementation change is reviewed with durability mode active

**Actor**: The reviewer loop, running on behalf of the agent or maintainer advancing a pull request.

**Preconditions**:

- The change is at the implementation stage, as stage resolution determines.
- Automatic activation matched at least one changed surface in the pull request, **or** the operator enabled the mode for this repository or run.

**Steps**:

1. The loop starts a local Ronda review of the pull request head.
2. The reviewer receives the ordinary review contract **and** the durability and idempotency mode instructions, including the scenario families that apply to this activation.
3. The reviewer examines the changed implementation surfaces — not only the diff hunks in isolation — for lifecycle failures: what happens on crash, replay, timeout, retry, and after partial external effects.
4. The reviewer reports findings with the usual severities, each tied to a concrete defect and remediation, not a generic checklist answer.
5. The review's overall verdict follows today's rules using blocking and important findings; durability-mode findings are not a separate verdict channel.

**Postconditions**:

- The pull request carries any durability-mode findings alongside ordinary ones.
- The review record states that durability mode was **active**, **why** it activated, and **which scenario families** were in scope for that activation.

**Information shown**:

- Whether durability mode was active.
- Activation reason: automatic match, operator default, or operator override for this run.
- The scenario families supplied to the reviewer for that activation.
- Findings, each with severity, location, and actionable body text.

**Considerations**:

- Automatic activation must err toward **missing sensitive paths** rather than firing on unrelated edits. A false negative (mode off when it should be on) loses the feature's value; a false positive (mode on everywhere) produces noise and teaches operators to ignore the label.
- The mode adds review context. It never removes the ordinary contract, stage checklist, or doctrine catalogue when those already apply.

---

### Use Case 2: An implementation change is reviewed without durability mode

**Actor**: The reviewer loop.

**Preconditions**:

- The change is at the implementation stage.
- No automatic activation rule matched, and the operator has not forced the mode on for this repository or run.

**Steps**:

1. The loop starts a local Ronda review.
2. The reviewer runs with the ordinary contract only.
3. The review completes with today's behavior.

**Postconditions**:

- The review record states durability mode was **inactive** and that automatic rules did not match.

**Information shown**:

- Durability mode state: inactive.
- When inactive because automatic rules did not match, a reader can tell that fact without inferring from absence of findings.

**Considerations**:

- **Inactive is not the same as "ran and found nothing."** A review that silently omits mode activation when rules matched is a defect; a review that correctly skips unrelated changes is ordinary.

---

### Use Case 3: An operator forces durability mode

**Actor**: Ronda operator.

**Preconditions**:

- The operator can configure Ronda for the repository or pass a per-run override documented in the adoption guide.

**Steps**:

1. The operator enables durability mode for all reviews, or for one run, even when automatic rules would not match.
2. The next review on an implementation pull request runs with the mode active and records the override as the activation reason.

**Postconditions**:

- Sensitive-path coverage can be validated on a change that would not auto-trigger, without editing automatic rules.

**Considerations**:

- Forced activation is for validation and exceptional cases, not the default steady state. Automatic rules remain the primary path called out in issue #54.

---

### Use Case 4: Durability mode cannot be supplied

**Actor**: The reviewer loop.

**Preconditions**:

- Activation rules say the mode should run, but the mode instructions cannot be read, are incomplete, or exceed their documented size bound.

**Steps**:

1. The loop starts a review that would have activated durability mode.
2. The reviewer records the specific reason the mode was not supplied.
3. The review proceeds with the ordinary contract only.

**Postconditions**:

- The review completes and its verdict follows today's rules.
- The record states plainly that durability mode was **unavailable** and why.

**Considerations**:

- The review is not failed for this. Durability mode is an improvement to a review, not a precondition. What must never happen is the silent case: activation matched, mode missing, and the record claims full ordinary review with no mention of the gap.

---

### Use Case 5: A maintainer reads durability-mode findings

**Actor**: Maintainer or agent advancing the item.

**Steps**:

1. They open the pull request review and read findings grouped with the rest of Ronda's output.
2. Each finding names the lifecycle failure (for example duplicate delivery publishing twice, or queue continuing after fatal error) in plain language and states what to change.
3. They fix blocking and important items; they may defer nits.

**Postconditions**:

- Findings remain on the pull request history for later readers.

**Considerations**:

- Output must stay **concise**: one finding per independently actionable defect, not a pasted questionnaire. If the model would enumerate every scenario family with "no issue found," that output belongs in the internal record as coverage metadata, not as six comment threads.

---

### Use Case 6: Regression evidence covers PR #51 misses

**Actor**: Ronda operator or maintainer running quality evidence.

**Preconditions**:

- Documented regression examples exist for representative external misses from pull request #51 that Ronda's general pass did not surface at the time.

**Steps**:

1. The operator runs the documented regression against a pinned or reconstructed review target that still exhibits each seeded miss shape.
2. With durability mode active, Ronda reports findings that correspond to those seeded shapes.
3. The operator compares results across prompt or model changes.

**Postconditions**:

- A later change that removes or weakens durability reasoning shows up as missed seeded shapes in the regression evidence, before the miss reappears in production review.

**Information shown**:

- Which seeded shapes were exercised.
- Which shapes were found, missed, or produced extra noise.

**Considerations**:

- Seeds are **generalized shapes** inspired by PR #51 — duplicate ingress, fatal queue drain, delivery replay, partial publish — not a retelling of that pull request's thread text. That matches how #53 stores categories and how #1654 generalizes doctrine entries.

---

## Business Rules

- Durability mode applies only to **implementation-stage** reviews. Spec, plan, and documentation-only changes use other stage tooling; running lifecycle questions against prose produces noise.
- When active, the reviewer must consider **every scenario family listed in Statuses / Enum Values** that the activation record marks in scope for that run, unless a family is explicitly documented as not applicable to the changed surfaces (for example no retry logic present). Families marked inapplicable must say so in the activation record; silent omission is not allowed.
- Findings use Ronda's existing **blocking**, **important**, and **nit** severities. Durability mode does not introduce a parallel severity scale or a separate merge gate.
- Durability mode **never changes** the one-review-per-head contract, comment-only behavior, or timeout budget semantics defined in the constitution and architecture docs. It consumes time from the same review pass budget rather than adding a second unbounded pass.
- Automatic activation considers **changed implementation surfaces** and their roles (ingress, queue, worker, retry wrapper, external publisher, durable store). Matching is deterministic from inspective inputs available to the reviewer loop at run time; it does not require network calls to the issue tracker.
- Manual operator override **wins** over automatic non-match and **loses** to unavailability: if instructions cannot be loaded, the review proceeds without the mode even when override was requested, and the record says so.
- Each reported finding must be **actionable**: it states the failure mode, why it matters under restart or replay, and what change would fix it — without dumping the full scenario checklist into the comment body.
- Durability mode findings may coexist with ordinary findings on the same line or region. Duplicating the same underlying defect twice is discouraged; reporting the lifecycle angle once and the local correctness angle once is permitted when both require separate fixes.
- Regression examples must remain **generalized** and bounded in count. They exist to guard prompt drift, not to memorize one historical pull request verbatim.

---

## Operational Visibility

- **Review record**: every implementation review reports durability mode state — `active`, `inactive`, or `unavailable` — with reason when not inactive.
- **Activation detail**: when `active`, the record includes activation reason (automatic match, operator default, operator override) and the scenario families marked in scope.
- **Unavailable detail**: when `unavailable`, the record distinguishes missing instructions, unreadable instructions, and over-bound content.
- **Reviewer-loop summary**: the pull request's reviewer-loop history carries the same state and activation detail per round so a reader can tell whether mode ran without opening model logs.
- **Regression suite**: operators can run documented PR #51–seeded shapes and read found / missed / extra-noise outcomes separately from live pull request reviews.

---

## Statuses / Enum Values

### Durability mode states

| Code value | Display label | Description |
| --- | --- | --- |
| `active` | Active | Durability and idempotency instructions were supplied and scenario families were in scope. |
| `inactive` | Inactive | The mode did not apply; automatic rules did not match and no operator override applied. |
| `unavailable` | Unavailable | Activation matched or override requested, but instructions could not be supplied. |

### Activation reasons (when state is `active`)

| Code value | Display label | Description |
| --- | --- | --- |
| `automatic_match` | Automatic match | Changed surfaces matched documented automatic activation rules. |
| `operator_default` | Operator default | Repository configuration enables the mode for every implementation review. |
| `operator_override` | Operator override | A per-run or per-repository override enabled the mode despite no automatic match. |

### Scenario families (questions the mode must enable)

Each family maps to the review-quality **affected category** vocabulary in #53 where one exists. The reviewer is asked to reason about concrete code paths, not to recite definitions.

| Code value | Display label | What the reviewer asks |
| --- | --- | --- |
| `restart_recovery` | Restart and recovery | If the process crashes or is restarted mid-work, is durable state consistent and is in-flight work resumed or safely abandoned? |
| `retry_semantics` | Retry semantics | Are retries bounded, idempotent, and safe after partial external effects? Are transient failures distinguished from fatal ones? |
| `timeout_watchdog` | Timeout and watchdog | Can work exceed its budget without leaving queues stuck, listeners closed incorrectly, or supervisors unable to restart? |
| `duplicate_delivery` | Duplicate delivery | If the same external event arrives twice (replay, redelivery, dual ingress), can side effects happen twice when they must not? |
| `partial_success` | Partial success | If an external effect succeeded once (review published, check run created, queue entry written) and a later step fails, can recovery duplicate or lose work? |
| `persistence_integrity` | Persistence integrity | Can on-disk or durable queue state become corrupt, silently dropped, or inconsistent with memory after crash or failed cleanup? |

**Default in-scope set**: when state is `active`, all six families are in scope unless the activation record lists specific families as **not applicable** with a one-line justification tied to the changed surfaces.

### PR #51 seed shapes (regression catalogue)

The regression catalogue must include at least these **generalized shapes** derived from external misses on pull request #51. Wording in live reviews must remain generalized; the catalogue names shapes, not comment quotes.

| Shape identifier | Display label | Generalized defect shape |
| --- | --- | --- |
| `dual_ingress_arbitration` | Dual ingress without arbitration | Two live entrypoints can both act on the same manual trigger, producing duplicate reviews or racing check runs. |
| `fatal_queue_drain` | Fatal error still drains queue | After a fatal failure, later queued work still runs instead of being discarded or latched. |
| `delivery_replay_manual` | Delivery replay on manual path | Replayed webhook delivery identifiers enqueue duplicate work on paths that bypass existing deduplication. |
| `outer_job_timeout` | Outer job timeout missing | A long-running pass can stall the worker without an outer bound, blocking subsequent deliveries while health checks still pass. |
| `partial_publish_recovery` | Partial publish on recovery | Review or check-run publication succeeds partially; recovery replays model work and publishes again for the same intent. |
| `transient_token_retry` | Transient auth not retried | Transient upstream auth or rate-limit failures tear down the whole service instead of bounded retry. |

The implementation plan may add shapes if evidence shows another PR #51 miss fits one family above; it may not drop any row from this table for MVP.

---

## Decision Matrix

Rows are evaluated in order for implementation-stage reviews. The first match decides activation unless operator override applies (override is evaluated before row 2 when configured).

| # | Stage | Operator override | Automatic match | Instructions available | Mode state | Activation reason | Scenario families |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | not implementation | — | — | — | `inactive` | — | none |
| 2 | implementation | force on | — | **No** | `unavailable` | — | none |
| 3 | implementation | force on | — | Yes | `active` | `operator_override` | all six unless documented N/A |
| 4 | implementation | force off | — | — | `inactive` | — | none |
| 5 | implementation | none | **Yes** | **No** | `unavailable` | — | none |
| 6 | implementation | none | **Yes** | Yes | `active` | `automatic_match` | all six unless documented N/A |
| 7 | implementation | none | No | — | `inactive` | — | none |
| 8 | implementation | default on | No | Yes | `active` | `operator_default` | all six unless documented N/A |

**Operator default** is row 8: repository configuration enables the mode even without automatic match. **Operator override** in rows 2–3 is an explicit per-run or per-repository force-on that bypasses row 4's force-off and row 7's non-match.

---

## Acceptance Criteria

- [ ] **AC-1.** On an implementation-stage pull request whose changed surfaces match documented automatic activation rules, durability mode state is `active` with activation reason `automatic_match`.
- [ ] **AC-2.** On an implementation-stage pull request whose changed surfaces do not match automatic rules and no operator default or override applies, durability mode state is `inactive`, and the record states that automatic rules did not match.
- [ ] **AC-3.** When durability mode is `active`, the reviewer receives instructions that explicitly require reasoning about restart/recovery, retry semantics, timeout/watchdog behavior, duplicate delivery, partial success, and persistence integrity — the six scenario families in Statuses / Enum Values.
- [ ] **AC-4.** For each scenario family marked in scope, the reviewer considers failures that appear only after crash, replay, redelivery, or partial external success, not only defects visible in a single happy-path read of the diff.
- [ ] **AC-5.** When a scenario family is marked **not applicable** for an activation, the activation record names that family and gives a one-line justification tied to the changed surfaces; no other family is silently skipped.
- [ ] **AC-6.** An operator can enable durability mode for all implementation reviews in a repository without automatic matches (`operator_default`), and the activation record reflects that reason.
- [ ] **AC-7.** An operator can force durability mode on for a single run or repository even when automatic rules do not match (`operator_override`), and the activation record reflects that reason.
- [ ] **AC-8.** An operator can force durability mode off for a run or repository even when automatic rules match, and the resulting state is `inactive` with a record that override disabled the mode.
- [ ] **AC-9.** When activation matches or override requests the mode but instructions are missing, unreadable, or over the documented size bound, state is `unavailable`, the specific reason is recorded, and the review completes under the ordinary contract only.
- [ ] **AC-10.** Durability mode never runs on spec-stage or plan-stage pull requests; state is `inactive` with automatic match suppressed for non-implementation stages.
- [ ] **AC-11.** Durability-mode findings use the existing blocking / important / nit severities and appear in the same GitHub review as ordinary findings; no separate verdict or check run is introduced for the mode alone.
- [ ] **AC-12.** When durability mode is `active`, review comment bodies do not consist solely of a scenario-family checklist with no identified defect; findings that report problems remain concrete and remediation-oriented.
- [ ] **AC-13.** When durability mode is `active` and no lifecycle defect is found, the review may report zero findings; coverage metadata (state, activation reason, in-scope families) still appears in the review record without spamming inline comments for every family.
- [ ] **AC-14.** Documented regression examples exist for every shape listed under **PR #51 seed shapes**, generalized rather than copied from historical review thread text.
- [ ] **AC-15.** Running the regression examples with durability mode `active` detects each seeded shape on its target fixture (found count ≥ 1 per shape) under the documented operator run procedure.
- [ ] **AC-16.** Durability mode state, activation reason when active, unavailable reason when unavailable, and in-scope scenario families appear in reviewer-loop history for every implementation review round.
- [ ] **AC-17.** Durability mode shares the existing review pass time budget; it does not start a second unbounded model call chain for the same head.
- [ ] **AC-18.** Enabling durability mode does not weaken or bypass Ronda's one-review-per-head duplicate protections documented in the constitution.

---

## Out of Scope (MVP)

1. **Capturing and adjudicating external misses.** Issue #53 owns structured capture; this item consumes category vocabulary only.
2. **Recall/precision trend reporting.** Issue #56 owns measurement over time.
3. **Feeding repository product documentation into prompts.** Issue #55 owns authoritative doc context.
4. **Reducing reviewer-loop timeout friction.** Issue #57 owns loop ergonomics; this item must not silently shrink timeouts to compensate for added prompt size.
5. **Durable automatic recovery design for webhook crashes after publish.** Pull request #51 follow-up issue #58 owns recovery that preserves one-review-per-head; this mode may flag gaps but does not implement recovery mechanics.
6. **Changing GitHub ingress topology or adding new entrypoints.** Operators may still run Action and App paths; the mode reviews code that handles them but does not decide deployment architecture.
7. **Making durability findings a separate merge gate or workflow label.** Findings remain ordinary review comments with severities; gating stays with existing ADF reviewer-loop rules.
8. **Strict spec or plan checklists.** #1650 and #1655 remain the home for document-stage strict passes.

---

## Deferred To The Implementation Plan

| Deferred decision | Guarantee the spec requires |
| --- | --- |
| Exact automatic activation rules (path patterns, module boundaries, configuration keys) | Deterministic activation from inputs available at review time; false negatives on listed sensitive surfaces (webhook worker, queue, retry wrapper, check-run publisher, durable store) are defects (AC-1, AC-2). |
| How scenario-family coverage is stored when zero findings are published | Activation record lists in-scope families; no checklist spam in comments (AC-13). |
| Maximum instruction size bound and unavailable behavior | Unavailability is visible and specific (AC-9). |
| How regression fixtures reconstruct PR #51 shapes | All six seed shapes covered with generalized targets (AC-14, AC-15). |
| Prompt composition order relative to doctrine and stage checklists | Mode adds context; never removes ordinary contract (Business Rules). |

---

## Brief Coverage Matrix

| Brief objective | Covered by |
| --- | --- |
| Targeted mode for durability/idempotency-sensitive paths | Use Case 1; Business Rules; AC-3, AC-4 |
| Explicit reasoning about restart, retry, timeout, duplicate delivery, partial success, persistence failure | Scenario families; AC-3, AC-4 |
| Automatic activation for relevant changes | Decision Matrix rows 5–6; AC-1, AC-2 |
| Manual activation via configuration | Use Case 3; Decision Matrix rows 2–4, 8; AC-6, AC-7, AC-8 |
| PR #51 misses as fixtures or regression examples | Use Case 6; PR #51 seed shapes; AC-14, AC-15 |
| Concise, actionable output | Use Case 5; AC-12, AC-13 |

No brief objective is deferred without a row under Out of Scope; items #53, #55, #56, #57, and #58 are separate tracker work named there.
