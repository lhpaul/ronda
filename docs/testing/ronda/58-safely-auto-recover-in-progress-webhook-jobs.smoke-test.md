# Smoke Test Runbook: Safely Auto-Recover In-Progress Webhook Jobs

**Feature**: Startup recovery for persisted webhook queue jobs
**Spec**:
[`../../specs/developments/20260917112201_58-safely-auto-recover-in-progress-webhook-jobs/1_58-safely-auto-recover-in-progress-webhook-jobs_specs.md`](../../specs/developments/20260917112201_58-safely-auto-recover-in-progress-webhook-jobs/1_58-safely-auto-recover-in-progress-webhook-jobs_specs.md)
**Implementation plan**:
[`../../specs/developments/20260917112201_58-safely-auto-recover-in-progress-webhook-jobs/2_58-safely-auto-recover-in-progress-webhook-jobs_implementation-plan.md`](../../specs/developments/20260917112201_58-safely-auto-recover-in-progress-webhook-jobs/2_58-safely-auto-recover-in-progress-webhook-jobs_implementation-plan.md)
**Created in**: Plan Ready stage

> **No design assets.** Webhook/backend feature only.

---

## Prerequisites

- [ ] Implementation branch checked out; `npm ci` at repository root.
- [ ] `npm test` passes, including webhook server recovery tests.
- [ ] For optional live verification: GitHub App credentials and
      `RONDA_WEBHOOK_QUEUE_PATH` configured per
      [`docs/adoption/ronda-local-webhook.md`](../../adoption/ronda-local-webhook.md).

---

## Scenario A — Resume after crash before public review (AC-1, Use Case 1)

**Goal**: A persisted `in_progress` job with no Ronda GitHub review is picked up
automatically on process start.

1. Run the focused unit test(s) named in the implementation PR (startup recovery
   for `in_progress` without GitHub review):

   ```bash
   npm test -- tests/unit/webhook/webhook-server.test.ts
   ```

2. Confirm the test suite includes a case where:
   - Queue file contains `status: "in_progress"`.
   - Server start triggers exactly one job run **without** manual webhook
     redelivery.
   - Queue ends in `completed` (or documented explicit failure), not stranded
     `in_progress`.

**Pass**: Tests green; behavior matches spec Use Case 1 postconditions.

---

## Scenario B — Reconcile when GitHub already has the review (AC-2, Use Case 2)

**Goal**: Startup detects an existing Ronda review on the head SHA and suppresses
duplicate publication.

1. Run unit tests covering reconciliation (mocked GitHub review list).

2. Confirm tests assert:
   - No second review publication call for the same head SHA.
   - Local queue transitions to `published`, `check_pending`, or `completed` as
     appropriate.
   - Structured logs mention reconciliation / duplicate prevention when
     implemented.

**Pass**: Tests green; duplicate `publishReview` not invoked on reconciliation path.

---

## Scenario C — Repeated restart idempotency (AC-3)

1. Run the idempotency test(s) from the implementation PR (second server start
   after reconciliation).

2. Confirm no additional review publication or duplicate job execution occurs.

**Pass**: Second startup leaves GitHub and queue state unchanged relative to the
first reconciled outcome.

---

## Scenario D — Planted fail-then-pass guard evidence (AC-4)

**Goal**: Reviewers can trust duplicate-review guards are real.

1. Follow the implementation PR's planted-violation section: apply the cited
   temporary guard disablement, run the cited test command, confirm failure.

2. Revert the plant, rerun the same command, confirm pass.

**Pass**: Isolating fail-then-pass recorded in the PR for each new guard assertion.

---

## Scenario E — Operator documentation (AC-5)

1. Open `docs/adoption/ronda-local-webhook.md` and confirm it describes:
   - Crash window 1: in flight before any public review.
   - Crash window 2: review public before local checkpoint caught up.
   - Expected automatic behavior vs when manual redelivery is still appropriate.

2. Skim `docs/project/3-software-architecture.md` webhook ingress section for a
   consistent recovery summary.

**Pass**: Both docs align with spec statuses and operational visibility bullets.

---

## Scenario F — Comment-only contract (AC-6)

1. Confirm recovery unit tests mock GitHub operations and do not invoke branch
   mutation APIs.

2. Optional live check: run one webhook review on a test PR and verify no new
   commits appear on the PR branch.

**Pass**: Recovery paths remain comment-only and check-run scoped.

---

## Optional live operator check

When App credentials and a tunnel are available:

1. Start `npm run webhook` with `RONDA_WEBHOOK_QUEUE_PATH` set.
2. Accept one review job, kill the process mid-job (after queue shows
   `in_progress`).
3. Restart the service and confirm logs show recovery and the PR receives at most
   one Ronda review for that head SHA.

Record delivery id, head SHA, and log excerpts in the implementation PR if executed.
