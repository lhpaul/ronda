# Refutation-marker dedupe — Spec

## Overview

#158 removed Ronda's resolved-thread dedupe because a resolved thread cannot
tell a refuted claim from a fixed one: after a fix or a nearby change, a
legitimate renewed finding on the same path and claim could be silently
suppressed (for example, a removed authorization guard that leaves the
protected write line unchanged).

This feature restores dedupe only behind an explicit, maintainer-set
refutation marker. Ronda does not re-post a claim that a maintainer explicitly
refuted on the same code, and it never suppresses a claim whose thread was
merely resolved, or whose cited code changed since the refutation.

This is the accepted scope of [#174](https://github.com/lhpaul/ronda/issues/174),
following #158 / PR #173. LH chose the answers to the issue's open questions
on 2026-11-16 (option B). The security checkpoint is kept: the PR stops at
`ready-for-human-review` and LH reviews and merges it.

| Open question in #174 | Decision |
| --- | --- |
| Shape of the refutation marker | A reply in the Ronda thread whose first line is exactly `/ronda refuted`, by an `OWNER`, `MEMBER`, or `COLLABORATOR`, on a thread that is resolved. |
| How to recognise the publisher | No new config key. Ronda's inline comments carry a hidden HTML marker; a thread is a Ronda thread only when its first comment carries a valid marker and was written by a bot account. |
| What the marker binds to | Path + normalized claim + a hash of the cited code. The refutation expires as soon as the cited code changes. Any doubt keeps the finding (fail open). |
| Measurement | Offline, on committed fixtures. No model pass. |

## Use Cases

### Use Case 1: A maintainer refutes a finding

**Actor**: Maintainer of the reviewed repository (owner, member, or collaborator).

**Preconditions**: Ronda published an inline finding the maintainer judges wrong.

**Steps**:

1. Reply in the finding's thread with `/ronda refuted` as the first line,
   optionally followed by the reason on later lines.
2. Resolve the thread.

**Postconditions**: Later passes on the same pull request do not re-post the
same claim on the same path while the cited code is unchanged.

**Information shown**: The next review's summary states how many findings were
not re-posted because a maintainer refuted them.

**Considerations**: Resolving without the marker, or the marker without
resolving, suppresses nothing. A marker from a contributor without one of the
three associations suppresses nothing.

### Use Case 2: The code under a refuted finding changes

**Actor**: Pull request author pushing a new commit.

**Preconditions**: A finding was refuted on an earlier head.

**Steps**:

1. Change code inside the cited code window (for example, remove a guard a few
   lines above the cited line).
2. Ronda reviews the new head and reports the same claim.

**Postconditions**: The finding is published again; the refutation no longer
applies because the cited code changed.

### Use Case 3: A finding is fixed, then regresses

**Actor**: Pull request author.

**Steps**:

1. Fix a finding and resolve its thread without the marker.
2. A later commit reintroduces the problem.

**Postconditions**: Ronda publishes the renewed finding. Fixed-and-resolved
threads never suppress anything.

## Business Rules

- BR1: Suppression requires all of: a resolved review thread on the same pull
  request; a first comment that carries a valid Ronda finding marker and was
  written by a bot account; a later reply in that thread whose first line,
  trimmed, is exactly `/ronda refuted` (case-sensitive) and whose author
  association is `OWNER`, `MEMBER`, or `COLLABORATOR`.
- BR2: A new finding matches a refutation only when its path equals the
  thread's path, its normalized claim equals the marker's claim, and the hash
  of its cited code at the reviewed head equals the marker's code hash. The
  normalized claim is the finding title, lowercased, with every run of
  non-alphanumeric characters collapsed to one space and trimmed.
- BR3: The cited code is a fixed window of lines around the cited line in the
  file at the reviewed head, not only the cited line, so a change near the
  cited line (such as a removed guard) expires the refutation. The window size
  is a constant set in the plan.
- BR4: Fail open everywhere. A finding is kept when: it has no line; the
  thread read fails or is unavailable; the file at head cannot be read; the
  marker is missing, malformed, or of an unknown version; or any comparison is
  not an exact match.
- BR5: Ronda adds the hidden marker to every inline comment whose cited code it
  could hash. A comment without a marker can never be the basis of a
  suppression. Summary-only findings carry no marker.
- BR6: Suppressions are visible. The review summary states the count, and the
  pass logs a suppression event with counts by reason only, never finding text.
- BR7: Nothing else changes: no prompt change, no default-model change, no new
  configuration key, no new GitHub permission, no new GitHub write.

## Operational Visibility

- The review summary's parsing notes gain one line when at least one finding
  was suppressed as refuted.
- `findings_suppressed` gains the `refuted_by_maintainer` reason; a failed
  thread read logs `refutation_threads_unavailable` with no thread content.
- The hidden marker is an HTML comment, so it does not render in the
  conversation view.

## Acceptance Criteria

- [ ] AC1: A finding whose path, normalized claim, and cited-code hash match a
  resolved Ronda thread with a valid `/ronda refuted` reply from an `OWNER`,
  `MEMBER`, or `COLLABORATOR` is not published, and the summary states one
  refuted finding was not re-posted.
- [ ] AC2: The same finding is published when the thread is unresolved, when the
  reply lacks the exact first line, when the reply author's association is any
  other value, or when the thread's first comment has no valid marker or was
  not written by a bot account.
- [ ] AC3: The same finding is published when a line inside the cited code window
  changed since the refutation, including a removed line above the cited line
  with the cited line itself unchanged.
- [ ] AC4: The same finding is published when the claim or the path differs.
- [ ] AC5: A thread read failure, an unreadable file at head, or a finding without
  a line keeps every finding, and the pass still succeeds.
- [ ] AC6: Every published inline comment whose cited code could be read carries a
  marker that round-trips through the parser; summary-only findings carry none.
- [ ] AC7: An offline measurement over a committed fixture reports before/after
  counts: refuted-on-unchanged-code findings drop, while fixed-then-regressed,
  changed-window, and non-maintainer cases are still published.
- [ ] AC8: No prompt, default model, configuration key, workflow, Action, or GitHub
  permission changes; all verification is offline.

## Brief Objective List and Coverage Matrix

| Objective from #174 | Coverage |
| --- | --- |
| O1: Do not re-post a claim a maintainer explicitly refuted on the same code | BR1–BR2; AC1 |
| O2: Never suppress a claim that was merely resolved because it was fixed | BR1, BR3; AC2–AC3; Use Case 3 |
| O3: Explicit marker shape | BR1; AC2 |
| O4: Publisher identity without a config key | BR1, BR5; AC2, AC6 |
| O5: Binding and expiry on code change | BR2–BR3; AC3–AC4 |
| O6: Offline before/after measurement | AC7 |
| O7: No prompt or default-model change | BR7; AC8 |

## Out of Scope (MVP)

- Matching reworded claims (semantic similarity). Only exact normalized-title
  matches are suppressed; rewordings are published.
- Refutations across pull requests or repositories.
- Any live model pass or live GitHub publication to measure the change.
- The control-pass CLI (`npm run quality:control-pass`): it keeps reviewing
  without thread reads so its recorded arms stay comparable.
