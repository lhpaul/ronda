# Surface Local Reviewer Findings on the Pull Request — Spec

---

## Overview

When the default draft-phase local reviewer reports blocking findings on a pull
request, operators and reviewers currently see only a count in the automated
reviewer-loop summary on GitHub. The finding location and explanation remain
visible only in the operator's local run output. This feature makes each local
reviewer's blocking finding readable on the pull request through the same
durable review summary and history record that already carry loop outcomes,
using the same privacy and redaction rules applied to other workflow audit
comments. Non-blocking suggestion output from the local reviewer is out of
scope for this change unless explicitly deferred below.

## Brief Objective List

1. Expose each local reviewer blocking finding's location and message on the
   pull request where humans read reviewer-loop outcomes.
2. Preserve enough detail in the durable reviewer-loop history so a later reader
   can understand what was flagged without the original local log file.
3. Apply the same redaction and safety treatment used for other workflow audit
   comments so secrets and sensitive values are not published.
4. Keep existing reviewer gates, readiness labels, merge authority, and
   hosted-reviewer behavior unchanged.

## Use Cases

### Use Case 1: Reviewer reads why a pull request failed draft-phase review

**Actor**: Human reviewer or workflow operator reading the pull request on
GitHub.
**Preconditions**: A reviewer loop has run with the local reviewer configured,
the local reviewer reported at least one blocking finding, and the loop posted
or updated its automated summary comment on the pull request.

**Steps**:

1. The actor opens the pull request and locates the automated reviewer-loop
   summary.
2. The summary shows how many blocking findings the local reviewer reported
   and lists each blocking finding with enough context to locate it in the
   change (file or area reference and line when available) plus the finding
   message text.
3. The actor uses that information to judge whether a fix addresses the
   flagged issue or to ask for clarification without requesting local logs.

**Postconditions**: The actor can explain what the local reviewer flagged using
only GitHub-visible evidence from the current loop pass.

**Information shown**:

- Blocking finding count for the local reviewer (unchanged expectation).
- For each blocking finding: location reference, line when applicable, and
  human-readable finding message.
- Clear labeling that these entries came from the local reviewer so they are
  not confused with hosted review comments.

**Actions available**:

- Read and reference findings in review discussion.
- Compare later commits against the listed findings.

**Considerations**:

- When the local reviewer reports zero blocking findings, the summary must not
  invent placeholder finding rows.
- When finding text is long, the summary may collapse detail for readability
  as long as the full message remains recoverable from the durable history
  record for that loop pass.

### Use Case 2: Operator audits a past reviewer loop from history

**Actor**: Workflow operator or maintainer auditing review automation.
**Preconditions**: The pull request has at least one reviewer-loop history
entry that recorded a local reviewer outcome with blocking findings.

**Steps**:

1. The actor opens the automated reviewer-loop summary or its embedded history
   on the pull request.
2. The history entry for that pass includes the blocking finding details
   alongside the existing counts and disposition fields.
3. The actor correlates the recorded findings with later fixes or merge
   decisions.

**Postconditions**: The audit trail on GitHub is sufficient to reconstruct
what the local reviewer blocked on without local-only artifacts.

**Information shown**:

- Per-pass local reviewer blocking finding details in the durable history
  structure already used for loop telemetry.
- Redacted values where sensitive content would otherwise appear.

**Actions available**:

- Trace reviewer-loop progression across pushes using history entries alone.

**Considerations**:

- History must remain append-only per existing reviewer-loop conventions; this
  feature adds fields or content, it does not remove existing telemetry.

### Use Case 3: Local reviewer reports no blocking findings

**Actor**: Human reviewer.
**Preconditions**: The local reviewer ran and reported a clean blocking count
for the reviewed head.

**Steps**:

1. The actor reads the automated reviewer-loop summary.
2. The summary shows zero local reviewer blocking findings and does not show
   an empty findings list section that implies missing data.

**Postconditions**: Behavior matches today's count-only clean outcome, with no
regression in readability.

## Business Rules

- When the local reviewer contributes one or more blocking findings to a loop
  pass, those findings must appear in the GitHub-visible reviewer-loop summary
  for that pass with location, optional line, and message text for each
  blocking item.
- The durable reviewer-loop history entry for that pass must record the same
  blocking finding details so the summary and history stay consistent for
  auditors.
- Finding text and location references must pass through the same redaction
  rules applied to other workflow audit comments on pull requests; tokens,
  credentials, and similarly sensitive substrings must not be posted verbatim.
- Hosted reviewers (for example codex-github and CodeRabbit) already surface
  findings as review comments; this feature must not duplicate or replace
  those surfaces—it only closes the gap for the local reviewer path.
- Suggestion-only or non-blocking local reviewer output must not be required in
  the summary or history for this feature's minimum viable scope.
- Existing blocking-review semantics, readiness labels, tracker transitions, CI
  gates, and merge authority remain unchanged.
- If the local reviewer is not configured for a repository or pass, no new
  local-finding section is added.

## Operational Visibility

- **Pull request summary comment**: Operators and reviewers see local reviewer
  blocking findings in the established automated reviewer-loop summary location.
- **Durable history**: Each loop pass that recorded local reviewer blocking
  findings retains those details for later inspection on the pull request.
- **Privacy**: Redaction failures must prefer omitting or masking sensitive
  substrings over posting them; the workflow must not widen exposure beyond
  current audit-comment policy.

## Workflow Decision-Gate Matrix

| Local reviewer configured | Blocking findings reported | Required summary behavior | Required history behavior | Visibility |
| --- | --- | --- | --- | --- |
| Yes | One or more | List each blocking finding with location, line when available, and message | Record matching finding details for the pass | GitHub PR comment and embedded history |
| Yes | Zero | Show zero blocking count only; no fabricated finding list | No new finding-detail payload for that pass | Unchanged clean outcome |
| No | Any | No local-finding section | No local-finding fields beyond today's behavior | Unchanged |

## Acceptance Criteria

- [ ] AC1: Given a reviewer loop pass where the local reviewer reports at
      least one blocking finding, the automated reviewer-loop summary on the
      pull request lists each blocking finding with location reference, line
      when the reviewer supplied one, and message text sufficient to understand
      the flag without local logs.
- [ ] AC2: Given the same pass, the reviewer-loop history entry for that pass
      includes the same blocking finding details so summary and history agree.
- [ ] AC3: Given finding text that contains values subject to workflow audit
      redaction, the published summary and history show redacted or masked
      content and never post raw secrets.
- [ ] AC4: Given zero local reviewer blocking findings, the summary does not
      show a misleading empty findings section and existing clean-path behavior
      remains intact.
- [ ] AC5: Given a pass where only hosted reviewers ran (local reviewer not
      configured), no local-finding section appears and hosted reviewer
      behavior is unchanged.
- [ ] AC6: Given an operator auditing an older loop pass on the pull request,
      they can read what the local reviewer blocked from GitHub-visible history
      without retrieving `/tmp` or other local-only logs.
- [ ] AC7: Existing readiness-label, CI, tracker-status, and merge-authority
      behavior is unchanged when this feature is enabled.

## Coverage Matrix

| Brief objective | Covered by | Acceptance criteria |
| --- | --- | --- |
| Expose finding location and message on the PR | Use Case 1, Business Rules | AC1 |
| Preserve details in durable history | Use Case 2, Business Rules | AC2, AC6 |
| Apply audit redaction | Business Rules, Operational Visibility | AC3 |
| Leave gates and hosted reviewers unchanged | Business Rules, Use Case 3 | AC4, AC5, AC7 |

## Out of Scope (MVP)

- Publishing local reviewer suggestion or non-blocking findings in the summary
  or history (Deferral Note: issue mentioned counts only for blocking; extending
  to suggestions can follow once blocking visibility is proven—human
  confirmation not required for MVP cut).
- Changing which reviewer platforms run in draft or ready phases.
- Replacing or duplicating hosted review comments with local reviewer output.
- Altering local reviewer scoring, models, or invocation mechanics.
- New tracker fields or operator dashboards outside existing PR comments and
  history.
