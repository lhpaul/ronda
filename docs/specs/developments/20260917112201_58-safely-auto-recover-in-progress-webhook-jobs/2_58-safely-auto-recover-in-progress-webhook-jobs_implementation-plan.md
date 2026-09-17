# Safely Auto-Recover In-Progress Webhook Jobs — Implementation Plan

**Spec**: [`./1_58-safely-auto-recover-in-progress-webhook-jobs_specs.md`](./1_58-safely-auto-recover-in-progress-webhook-jobs_specs.md)
**Smoke test runbook**: [`../../../testing/ronda/58-safely-auto-recover-in-progress-webhook-jobs.smoke-test.md`](../../../testing/ronda/58-safely-auto-recover-in-progress-webhook-jobs.smoke-test.md)

---

## Summary

**Approach**: Extend the persisted webhook queue startup path so `in_progress`
entries are not stranded after a fail-stop restart. Before replaying any
ambiguous job, reconcile against GitHub for an existing Ronda pull-request
review on the head SHA; resume the normal job runner when no public review
exists, or advance local state through the existing `published` /
`check_pending` / completion paths when GitHub already satisfies the
one-review-per-head contract. Add structured recovery logging and operator
documentation for both crash windows.

**Estimated complexity**: M

**Rationale**: The change is localized to webhook ingress, queue persistence,
and one new GitHub read helper, but it touches concurrency at startup, idempotent
reconciliation, several queue statuses, and high-value regression tests including
planted fail-then-pass evidence for duplicate-review prevention.

**Dependencies**: None. Spec PR #78 is merged on `develop`; peer batch webhook
items share vocabulary only (spec BR-7).

---

## Verification Log

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `6d16cc5` |
| Full revision | `git rev-parse HEAD` | `6d16cc548bce1e894c0e36740b6f74bd11b7ec4f` |
| Queue replay filter | `rg -n "entry.status === \"pending\"" -A6 src/webhook/webhook-server.ts` | `load()` replays only `pending`, undefined, and `check_pending`; `in_progress` is excluded. |
| Stranded in-progress behavior | `rg -n "in-progress webhook queue entries" tests/unit/webhook/webhook-server.test.ts` | Existing test expects **no** startup replay; manual redelivery completes the job. |
| Review reconciliation surface | `rg -n "listReviews|findExisting" src/github src/webhook` | Check-run lookup exists; no PR review listing helper yet. |
| Operator doc baseline | `sed -n '77,112p' docs/adoption/ronda-local-webhook.md` | Documents queue persistence and supervisor restart but not the two ambiguous crash windows. |
| Architecture ingress note | `rg -n "FIFO queue" docs/project/3-software-architecture.md` | Webhook FIFO and fail-stop behavior documented; recovery model not yet described. |

---

## Cross-Cutting Operational Assumption Check

**Result**: Not applicable — this plan does not encode a mutable environment
target, linked cloud project, artifact owner, or canonical configuration value
that another same-window PR can invalidate. Webhook queue path
(`RONDA_WEBHOOK_QUEUE_PATH`) is operator-local runtime configuration verified
during smoke testing, not a shared repo assumption. Peer batch items (#54–#57,
#63–#66) are orthogonal per spec BR-7.

---

## Layer-by-Layer Changes

### Database / Data Layer

Not applicable. Recovery uses the existing JSON webhook queue file and in-memory
delivery/review suppression sets.

### Backend / Webhook Core

- [ ] **Startup recovery entrypoint** — In `src/webhook/webhook-server.ts`, add a
      dedicated startup recovery step that runs after the queue store is
      constructed and before the first persisted job is shifted onto the worker.
      It must inspect persisted entries with status `in_progress` (and any other
      non-terminal statuses the implementation discovers are ambiguous on restart)
      and classify each as **resume**, **reconcile**, or **explicit failure**
      per spec operational visibility.
- [ ] **Extend `load()` or companion loader** — Include safe-to-replay
      `in_progress` jobs in the startup pending list **only after** reconciliation
      decides replay is allowed. Do not blindly treat every `in_progress` row as
      runnable; entries that reconcile to an existing GitHub review must transition
      local state instead of calling `runWebhookReviewJob` for a full pass.
- [ ] **GitHub review reconciliation helper** — Add
      `findExistingRondaReview` (name may vary) under `src/github/`, using the
      installation token path already used by `runWebhookReviewJob`. It should list
      pull-request reviews for the job's PR, match `commit_id` to the effective
      head SHA, and recognize Ronda's published review via the existing summary
      marker (`## Ronda review` in `src/core/summary.ts`) and/or the configured
      GitHub App identity when available. Map to AC-2 and BR-3.
- [ ] **Reconciliation transitions** — When GitHub shows a Ronda review for the
      head SHA but local state is still `in_progress`:
      - Persist `published` or `check_pending` using existing queue-store methods
        (`markPublished`, `markCheckPending`) without calling `publishReview`.
      - Enqueue check-only recovery when `checkRunInput` is already durable, reusing
        the existing check-pending replay path in `runWebhookReviewJob`.
      - Complete the delivery when GitHub truth plus local tombstones already satisfy
        terminal semantics.
- [ ] **Resume path (AC-1)** — When reconciliation finds **no** Ronda review for
      the head SHA, transition `in_progress` → runnable job (same as pending
      replay) and let the existing single-worker FIFO execute it.
- [ ] **Recovery logging** — Emit structured log events (via existing `log.log` /
      `logger.event` patterns) naming repository, pull number, delivery id, head
      SHA, and outcome (`resumed`, `reconciled_existing_review`,
      `reconciliation_failed`). Map to spec Operational Visibility.
- [ ] **Idempotency** — Repeated restarts on reconciled entries must not publish
      another review or enqueue duplicate work. Reuse `suppressedReviewKeys` and
      existing `published` / `completed` tombstone behavior; add tests for a second
      restart after reconciliation (AC-3).

### Shared Packages / Libraries

Not applicable.

### Frontend / UI

Not applicable.

### Infrastructure / Configuration

- [ ] No new environment variables required. Recovery honors existing
      `RONDA_WEBHOOK_QUEUE_PATH`, timeout, and GitHub App settings.
- [ ] Optional: document that disabling the queue path (`RONDA_WEBHOOK_QUEUE_PATH`
      unset) keeps in-memory-only behavior with no cross-restart recovery (already
      implied; call out in operator docs if helpful).

---

## Testing Strategy

**Test types**: Unit (primary), integration-style webhook server tests, smoke
runbook for operator verification.

**Key scenarios to test**:

1. **AC-1 / Use Case 1** — Persisted `in_progress` job, no GitHub review: server
   startup automatically runs the job to completion without manual redelivery.
2. **AC-2 / Use Case 2** — Persisted `in_progress` job, mocked GitHub lists an
   existing Ronda review for the head SHA: startup reconciles local state and does
   **not** invoke review publication; check-only follow-through runs when needed.
3. **AC-3** — Repeated server restart after reconciliation remains idempotent (no
   second `runJob` review publication).
4. **AC-4** — For each **new** assertion guarding duplicate replay, include an
   **isolating** planted fail-then-pass proof in the implementation PR per
   `docs/best-practices/3-testing.md` (temporarily disable or invert the
   reconciliation guard, show the test fails, restore, show pass). Record file,
   line, and command output in the PR body.
5. **AC-5** — Smoke runbook scenarios validate operator-facing documentation.
6. **AC-6** — Recovery tests assert `publishReview` / branch-mutation APIs are not
   called on reconciliation paths (mock-level).

**Primary test files**:

- `tests/unit/webhook/webhook-server.test.ts` — startup recovery, logging
  expectations, idempotency, update/remove the current
  `in-progress webhook queue entries can be recovered by redelivery after startup`
  expectation to reflect automatic recovery.
- New focused tests for `findExistingRondaReview` (e.g.
  `tests/unit/github/pull-request-reader.test.ts` or adjacent file).

**Smoke test runbook**:
`docs/testing/ronda/58-safely-auto-recover-in-progress-webhook-jobs.smoke-test.md`

**Regression suite**: Not applicable (no product E2E suite). Extend unit webhook
tests only.

### Concurrent-Event-Source Addendum

This plan **is** concurrent-event-source scoped: HTTP webhook acceptance, startup
recovery, and the single active worker share the queue file and in-memory
`busy` / `pendingJobs` state.

| Topic | Decision |
| --- | --- |
| Shared mutable state guards | Startup recovery completes classification and queue-file updates **before** `server.listen` schedules `runNextJob`; the worker remains single-threaded JavaScript — no parallel job execution. |
| Re-entrancy / in-flight tracking | `in_progress` in the file represents pre-crash in-flight work; startup recovery serializes reconciliation/resume before accepting new HTTP deliveries on the listening socket. |
| Event deduplication | Existing delivery-id and review-key suppression remain authoritative; reconciliation must register suppression keys when GitHub already has the review. |
| Listener and resource cleanup | No new long-lived listeners; recovery uses awaited GitHub reads with existing abort/timeout signals. |
| Race at initialization | Recovery finishes before the listen callback drains `pendingJobs`; document that HTTP 202 during recovery should remain impossible because listen happens after recovery. |
| Race at teardown | Unchanged fail-stop semantics; recovery does not bypass worker stop on failure. |
| Error propagation | Reconciliation GitHub failures surface as logged explicit failures, not silent drop (BR-6). |

### Parser-Risk Addendum

Not applicable.

---

## Seed Data

| Entity | Values / Scenario | File |
| --- | --- | --- |
| In-progress queue row | `status: "in_progress"`, delivery id, PR metadata, optional `headSha` | Inline in `webhook-server.test.ts` helpers |
| Reconciliation window row | Same as above plus mocked `listReviews` response with `commit_id` matching head and body containing `## Ronda review` | Test mocks |
| Check-pending recovery row | `status: "check_pending"` with valid `checkRunInput` (existing fixtures) | Reuse patterns from current check-pending tests |

---

## Documentation Updates

- [ ] `docs/adoption/ronda-local-webhook.md` — Document both crash windows, automatic
      resume vs reconciliation vs manual intervention, and startup log signals
      (AC-5).
- [ ] `docs/project/3-software-architecture.md` — Extend the webhook ingress section
      with a short recovery model paragraph aligned with the spec statuses table.
- [ ] `AGENTS.md` — No change expected unless new npm scripts are added (unlikely).

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Mis-identifying a non-Ronda review as Ronda | Low | High | Match both head SHA and Ronda summary marker; prefer App-owned review when login metadata is available. |
| Reconciliation GitHub API failure blocks startup | Medium | Medium | Fail loudly with actionable logs; do not silently drop jobs (BR-6). |
| Resuming a job that partially published before crash | Medium | High | Always reconcile before replay when status is `in_progress`; unit-test the published-on-GitHub / local-not-updated window (AC-2). |
| Race between recovery and new webhook delivery | Low | Medium | Complete recovery before listening; keep single worker FIFO. |
| Over-broad replay includes unsafe rows | Low | High | Keep `published` / `completed` tombstones; add idempotency tests. |

---

## Implementation Order

1. Add `findExistingRondaReview` (or equivalent) with unit tests covering match,
   no-match, and wrong-`commit_id` cases.
2. Implement startup recovery classification (`resume` / `reconcile` / `fail`) and
   wire it into `startWebhookServer` before the listen callback runs jobs.
3. Update queue loading / state transitions so reconciled jobs persist
   `published` or `check_pending` without review republication.
4. Replace or extend webhook-server tests for AC-1, AC-2, AC-3, and AC-6; add
   planted fail-then-pass evidence for the duplicate-review guard (AC-4) in the
   implementation PR description.
5. Add recovery structured logging and verify log-focused assertions in tests.
6. Update `docs/adoption/ronda-local-webhook.md` and
   `docs/project/3-software-architecture.md` per **Documentation Updates**.
7. Run local verification:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
8. Execute the smoke runbook scenarios that do not require live tunnel hardware
   (unit-backed scenarios); note any live-operator steps as optional in the PR.
9. Add a changelog fragment under `changelog.d/` using this literal format:

   `- **Safely recover in-progress webhook jobs** (#58): Automatically resume or reconcile stranded webhook queue work after restart without publishing duplicate GitHub reviews.`
