# Ronda v0 — GitHub Review Bot — Spec

---

## Overview

Ronda v0 gives a pull request one automated, comment-only code review that a
human or the ADF reviewer-loop can act on. When a pull request becomes ready for
review, or when a new commit lands on a ready pull request, Ronda reads the
changes, produces every finding it has, and publishes them as a single GitHub
pull-request review plus a check run that reports whether the pass succeeded.

Ronda never changes the branch under review. It only reports. Fixing is the job
of the human author or the ADF fixer, and keeping those roles apart is what
prevents the day-long stalls seen with review bots that also try to push.

In v0 the review runs as a reusable GitHub Actions workflow that any repository
can call. The hosted webhook application, its single public URL, and the tunnel
to a MacBook, Mac Mini, or MiniPC are deferred; the review contract defined here
does not change when that ingress arrives.

---

## Use Cases

### Use Case 1: A pull request becomes ready for review

**Actor**: Pull request author (indirectly — the review is triggered by the pull
request's own lifecycle, not by a person pressing a button)

**Preconditions**:

- The repository has adopted Ronda's reusable review workflow.
- The repository operator has supplied a model credential and a GitHub token
  with permission to write pull-request reviews and check runs.
- The pull request is not a draft.

**Steps**:

1. The author marks the pull request ready for review (or opens it as a
   non-draft pull request).
2. Ronda starts a review pass for the pull request's current head commit.
3. Ronda reads the pull request's changed files, its title, and its description.
4. Ronda asks the configured model for findings on those changes.
5. Ronda publishes one pull-request review containing every finding it produced,
   and reports the outcome of the pass on a check run.

**Postconditions**:

- Exactly one Ronda review exists for that head commit.
- A check run for that head commit reports whether the pass succeeded, failed,
  or was skipped.
- The pull request branch is unchanged.

**Information shown**:

- A review summary: what Ronda looked at, how many findings there are by
  severity, which model produced them, and how long the pass took.
- One inline comment per finding that lands on a changed line, showing the
  severity label and the explanation.
- A findings list in the summary for anything Ronda could not attach to a
  changed line.
- A check run whose title states the outcome and whose detail text repeats the
  finding counts.

**Actions available**:

- Read and reply to individual findings as ordinary review comments.
- Resolve or dismiss findings using GitHub's normal review affordances.
- Push a new commit, which starts a fresh pass.
- Ask for another pass on the same commit with the review command comment.

**Considerations**:

- If Ronda produces no findings, it still publishes a review saying so and a
  passing check run, so a waiting reviewer-loop always has a definite answer.
- If the head commit changes while a pass is running, the in-flight pass is
  abandoned without publishing and a new pass starts for the new commit.
- Draft pull requests are ignored entirely — no review, no check run.

---

### Use Case 2: A new commit lands on a ready pull request

**Actor**: Pull request author

**Preconditions**: The pull request is ready for review and has been reviewed by
Ronda at least once, or became ready while commits were already being pushed.

**Steps**:

1. The author pushes one or more commits to the pull request branch.
2. Ronda starts a review pass for the new head commit.
3. Ronda publishes a new review and a new check run for that head commit.

**Postconditions**:

- The new head commit has its own review and its own check run.
- Reviews from earlier head commits stay on the pull request as history; Ronda
  does not delete or edit them.

**Information shown**:

- The same review summary, inline findings, and check run as Use Case 1, scoped
  to the new head commit.

**Actions available**:

- The same actions as Use Case 1.

**Considerations**:

- Rapid consecutive pushes must not produce overlapping reviews for the same
  commit; only the newest head commit gets a pass.
- Findings that were already reported on an earlier commit and are still present
  are reported again — Ronda does not carry state between passes.

---

### Use Case 3: An operator asks for another pass on the same commit

**Actor**: Repository operator or pull request reviewer

**Preconditions**: The pull request is ready for review and has a head commit
that Ronda has already attempted.

**Steps**:

1. The person posts the review command comment on the pull request.
2. Ronda starts a review pass for the current head commit, even though that
   commit already had one.
3. Ronda publishes a new review and updates the check run for that head commit.

**Postconditions**:

- A newer Ronda review exists for the head commit; it is the authoritative one.
- The check run for that head commit reflects the newest pass.

**Information shown**:

- The same review summary and findings as Use Case 1, plus a note in the summary
  that this pass was requested manually.

**Actions available**:

- The same actions as Use Case 1.

**Considerations**:

- This is the recovery path when a pass fails for a transient reason such as a
  model timeout, and the only way to get a second pass on an unchanged commit.
- The command is ignored on draft pull requests and on pull requests in
  repositories that have not adopted the workflow.

---

### Use Case 4: A review pass cannot complete

**Actor**: Ronda (system-initiated)

**Preconditions**: A review pass has started for a ready pull request.

**Steps**:

1. The model call fails, returns unusable output, or the pass exceeds its time
   budget.
2. Ronda stops the pass.
3. Ronda publishes a failing check run naming the reason, and posts a short
   summary comment explaining that no findings were produced.

**Postconditions**:

- The check run for that head commit reports failure with a human-readable
  reason.
- No inline findings are published for that pass.
- The pull request branch is unchanged.

**Information shown**:

- The failure reason in plain language: timed out, model unavailable, credential
  missing or invalid, changes too large, or unexpected error.
- Guidance to re-run with the review command comment.

**Actions available**:

- Ask for another pass with the review command comment.

**Considerations**:

- A failure is always visible. Ronda never leaves a pull request with a pending
  check run and no explanation — a silent hang is treated as a failure.
- A missing or invalid credential fails the pass with that specific reason
  rather than a generic error, so the operator can fix the configuration.

---

### Use Case 5: An ADF or Helm project consumes Ronda's review

**Actor**: ADF reviewer-loop or Helm workflow

**Preconditions**: The consuming project has named Ronda as an external review
provider in its own workflow configuration, and the repository has adopted
Ronda's reusable review workflow.

**Steps**:

1. The consuming workflow reaches the point where it waits for external review
   on a ready pull request.
2. It waits for Ronda's check run on the current head commit.
3. It reads Ronda's review and findings and drives its own fix cycle.

**Postconditions**:

- The consuming project has a definite per-head-commit signal: the pass
  succeeded, failed, or was skipped.

**Information shown**:

- The check run outcome and the review contents, through GitHub's normal
  interfaces.

**Actions available**:

- The consuming project decides what to do with the findings. Ronda takes no
  further action.

**Considerations**:

- Ronda is a review provider only. It does not implement, copy, or replace the
  ADF reviewer-loop, and it does not replace `local-ai-reviewer`, which remains
  an in-loop check.
- Attaching Ronda to a consuming project is a configuration change in that
  project — naming the provider — not a change to Ronda.

---

## Business Rules

- Ronda never pushes commits, never edits the pull request branch, never merges,
  and never changes pull request state. It comments and reports only.
- Ronda publishes at most one review per head commit automatically. Additional
  passes on the same head commit happen only when a person asks for one with the
  review command comment.
- The review command comment is one specific, documented phrase. Ronda ignores
  ordinary pull-request conversation and reacts only to that exact phrase; the
  literal wording is fixed and published alongside the reusable review workflow,
  not invented ad hoc by whoever is asking for a re-run.
- When multiple reviews exist for one head commit, the newest is authoritative.
- Every finding a pass produces goes into that pass's single review. Ronda does
  not stop at the first finding and does not split findings across reviews.
- Findings that map to a line changed in the pull request are published as
  inline comments on that line. Findings that do not map to a changed line are
  published in the review summary instead. No finding is dropped for lack of a
  line to attach to.
- Every pass ends in a definite outcome on the check run: succeeded, failed, or
  skipped. A pass that produces no findings succeeds.
- A pass must finish within ten minutes. Exceeding that budget fails the pass
  with the timeout reason. Silence is a failure, not a hang.
- Draft pull requests are never reviewed and never get a check run.
- A pass whose head commit is superseded before publication is abandoned without
  publishing anything.
- Ronda keeps no record of a pass between passes. Each pass reads the pull
  request fresh.
- The model vendor is configuration. Changing vendors does not change what
  reviews look like, what the check run reports, or how consuming projects
  attach.
- Secrets are supplied by whatever environment runs the pass — repository or
  organization secrets when the reusable workflow runs it, a local operator
  configuration directory when a person runs it from their own machine. No
  credential, credential name, account identifier, hostname, or personal path is
  stored in this repository.
- Ronda does not require its own database. Nothing about a pass is persisted
  outside GitHub.

---

## Statuses / Enum Values

### Review pass outcome

| Code value  | Display label | Description                                                                                |
| ----------- | ------------- | ------------------------------------------------------------------------------------------ |
| `queued`    | Queued        | The pass has been accepted for a head commit but has not started reading changes yet.      |
| `running`   | In progress   | Ronda is reading the changes or waiting on the model.                                      |
| `succeeded` | Review posted | The pass completed and its review was published, with or without findings.                 |
| `failed`    | Review failed | The pass stopped without publishing findings; the reason is named on the check run.        |
| `skipped`   | Skipped       | Ronda deliberately did not review — draft pull request, or the head commit was superseded. |

**Valid transitions**:

- `queued` → `running` when the pass starts reading the pull request
- `queued` → `skipped` when the pull request is a draft or the head commit is superseded before the pass starts
- `running` → `succeeded` when the review is published
- `running` → `failed` when the model call fails, output is unusable, or the ten-minute budget is exceeded
- `running` → `skipped` when the head commit is superseded before publication

### Finding severity

| Code value  | Display label | Description                                                                                         |
| ----------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `blocking`  | Blocking      | A correctness, security, or data-loss problem the author should fix before merging.                 |
| `important` | Important     | A real problem worth fixing that does not by itself block the merge.                                |
| `nit`       | Nit           | Style, naming, or clarity. Informational; the author is free to ignore it.                          |

Severity affects only how a finding is labelled and counted. It never changes
the check run outcome: a pass that publishes blocking findings still reports
`succeeded`, because the pass itself worked. Deciding what to do about a
blocking finding belongs to the human or the consuming workflow.

---

## Operational Visibility

- **Check run**: every attempted pass on a non-draft pull request produces a
  check run on the head commit. Its title states the outcome, and its detail
  text gives the finding counts by severity, the model that was used, and the
  pass duration. On failure it names the reason.
- **Review summary**: the published review opens with what was reviewed (file
  and change counts), the finding counts by severity, the model used, the pass
  duration, and whether the pass was automatic or manually requested.
- **Logs**: the environment that runs the pass keeps its own run log — the
  Actions run log for the reusable workflow. The log records the pull request,
  the head commit, the outcome, the model, and the duration. It must not record
  credentials.
- **Notifications**: none beyond GitHub's own review and check notifications.
  Ronda does not send mail, chat, or Telegram messages.
- **Audit trail**: GitHub is the record. The reviews and check runs on the pull
  request are the history of what Ronda said and when.

---

## Acceptance Criteria

- [ ] Marking a non-draft pull request ready for review in a repository that has
      adopted Ronda's reusable workflow produces a single Ronda review plus a
      single check run on that head commit, and pushes no commit to the branch.
- [ ] Pushing a new commit to that ready pull request produces a new review and
      a new check run for the new head commit, and leaves the earlier review in
      place.
- [ ] Opening or updating a draft pull request produces no Ronda review and no
      Ronda check run.
- [ ] A pass that produces several findings publishes all of them in one review
      — none are withheld for a later review.
- [ ] A finding on a line changed by the pull request appears as an inline
      comment on that line; a finding that does not map to a changed line
      appears in the review summary; the total count in the summary matches the
      number of findings published.
- [ ] Each published finding shows one of the severity display labels Blocking,
      Important, or Nit, and the summary reports counts per label.
- [ ] A pass that finds nothing publishes a review saying so and a check run
      reporting Review posted.
- [ ] Removing or invalidating the model credential makes the next pass produce
      a check run reporting Review failed, naming the missing-credential reason,
      with no inline findings published.
- [ ] A pass that exceeds ten minutes ends with a check run reporting Review
      failed and naming the timeout reason; the check run is never left pending
      with no explanation.
- [ ] Posting the review command comment on a ready pull request whose head
      commit already has a review produces a newer review for that same head
      commit, and its summary states that the pass was manually requested.
- [ ] Posting the review command comment on a draft pull request produces no
      review and no check run.
- [ ] Pointing Ronda at a second model vendor and re-running a pass on the same
      pull request produces a review in the same shape — same summary structure,
      same severity labels, same check run outcomes — with the summary naming
      the different model.
- [ ] A pull request opened on `lhpaul/ai-dev-framework-template` receives a
      complete Ronda review: a summary, at least one inline finding on a changed
      line, and a check run reporting Review posted — with no commit pushed to
      the pull request branch by Ronda.
- [ ] A consuming project that names Ronda as its external review provider can
      wait on Ronda's check run for the current head commit and reach a definite
      outcome without changes to that project's review loop beyond naming the
      provider.
- [ ] Searching this repository finds no credential value, credential name,
      account identifier, hostname, or personal filesystem path belonging to a
      specific operator.
- [ ] If the head commit changes again while a pass for the previous head
      commit is still running, the abandoned pass publishes no review and no
      check run for the superseded commit; only the new head commit ends up
      with a review and a check run.

---

## Out of Scope (MVP)

- **The hosted webhook application, its single public URL, and the tunnel** to a
  MacBook, Mac Mini, or MiniPC. The constitution allows the reusable Action as
  the v0 stand-in, and v0 takes it. Deferring this also defers registering the
  GitHub App and the bot identity that goes with it. The review and check-run
  contract in this spec is what the later webhook must produce, unchanged.
- **Installing Ronda across many repositories.** v0 adopts one dogfood
  repository, `lhpaul/ai-dev-framework-template`.
- **Serving a local model.** v0 uses an API vendor. The vendor sits behind an
  interface so a local backend can replace it later without changing the review.
- **Replacing the ADF reviewer-loop or `local-ai-reviewer`.** Ronda is one more
  external review provider those systems can consume. `local-ai-reviewer` stays
  an in-loop check.
- **Pushing fixes, suggested changes that can be committed from the review UI,
  merging, or any other write to the pull request branch or its state.**
- **Carrying findings between passes** — no deduplication against earlier
  reviews, no "still unresolved" tracking, no resolving of stale comments.
- **Storing review history** — cost, latency, or per-commit records in a
  database.
- **Fleet leases, Telegram control, and any Fleet-hosted runtime.**
- **A marketplace listing or any multi-tenant or paid offering.**

---

## Coverage Matrix

Objectives are the numbered requirements in the tracker brief for issue #2 as
updated during alignment.

| # | Brief objective | Covered by |
| - | --------------- | ---------- |
| 1 | Ingress: reusable GitHub Action only; ready PRs (`ready_for_review` + new head SHA on a ready PR) plus manual re-trigger; drafts not reviewed | Use Cases 1, 2, 3; business rules on draft pull requests and on one automatic pass per head commit; ACs 1, 2, 3, 10, 11 |
| 2 | Comment-only GitHub review + check run, one pass per head SHA, all findings in that review | Use Case 1; business rules on one review per head commit, on all findings in one review, and on abandoning a superseded pass; Operational Visibility; ACs 1, 4, 5, 6, 7, 16 |
| 3 | No pushes or fixes from this bot | Business rule "never pushes commits"; ACs 1, 13; Out of Scope entry on pushing fixes |
| 4 | Inference via an API model, vendor behind an interface | Business rule "the model vendor is configuration"; AC 12; Out of Scope entry on local model serving |
| 5 | How ADF and Helm attach — adapter only, no loop copy | Use Case 5; AC 14; Out of Scope entry on replacing the ADF loop |
| 6 | Local config for secrets; nothing LH-specific in git | Business rule on secrets supplied by the running environment; ACs 8, 15 |
| 7 | Dogfood repo and success criteria | AC 13 (`lhpaul/ai-dev-framework-template`); Out of Scope entry on many-repository installation |

### Deferral notes

- **Webhook ingress, single public URL, and tunnel.** The brief's original
  Outcome named these as the v0 goal. LH narrowed v0 to the Action stand-in
  during alignment on 2026-09-05, and issue #2 was updated to match. Rationale:
  the review poster is the stable core either way, and proving it against a real
  pull request does not require App registration or a live tunnel. The
  constitution explicitly permits the Action as the v0 stand-in. Human
  confirmation was given; no further confirmation is requested.
- **Objective 6, local configuration directory.** With the Action-only v0, a
  pass normally runs on a GitHub Actions runner, where secrets come from
  repository or organization secrets rather than from an operator's own
  configuration directory. The underlying requirement — credentials come from
  the environment and nothing operator-specific is committed — is kept as a
  business rule covering both surfaces. The operator configuration directory
  itself becomes load-bearing when the webhook process arrives.

---

## Assumptions

- **Ten-minute pass budget.** The constitution requires a timeout "in minutes,
  not hours" without naming a number. Ten minutes is used throughout this spec
  so the criteria are testable. Changing it changes one business rule and one
  acceptance criterion.
- **Three severity levels.** Blocking, Important, and Nit were not specified in
  the brief. They exist so the summary counts and the inline labels are
  verifiable, and so a consuming workflow can triage without parsing prose.
