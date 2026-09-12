# Capture External-Review Misses As Ronda Eval Records - Spec

---

## Overview

When a stronger external reviewer finds a real defect that Ronda stayed quiet
about, that learning currently lives in a pull request thread or a chat session
and is lost before anyone acts on it. This feature gives the Ronda operator a
repeatable way to turn one external-review finding into a durable, structured
miss record that names the pull request, the reviewed head, the reviewer, the
finding itself, the human verdict, the affected review category, and what the
record should become next.

The records are review-quality evidence, not a new reviewer behavior. Ronda
stays a comment-only GitHub reviewer, capture never writes to a pull request,
and a captured record never decides whether a pull request merges. The records
are stored with Ronda's other committed quality evidence so they can be read
alongside existing review comparisons and quality summaries.

---

## Use Cases

### Use Case 1: Operator Captures An External Finding Ronda Missed

**Actor**: Ronda operator

**Preconditions**:

- A pull request exists and Ronda has produced a review result for its current
  head.
- An external reviewer has published at least one finding on that same head.
- The operator can read the pull request.

**Steps**:

1. The operator starts a capture for that pull request, naming the external
   reviewer.
2. The workflow resolves the pull request's current head and reads the external
   reviewer's findings published against that head.
3. The workflow presents each external finding it found and asks the operator to
   confirm the affected category and, when already known, the verdict and the
   intended follow-up.
4. The workflow writes one miss record per confirmed external finding.

**Postconditions**:

- A stored miss record exists for each captured finding.
- Each record names the pull request, the reviewed head, the external reviewer,
  the finding location, the finding text, the verdict, the affected category,
  and the intended follow-up.
- Nothing on the pull request changed.

**Information shown**:

- Pull request identity and the head the evidence belongs to.
- External reviewer name.
- Each captured finding's location, title, and summary.
- Ronda's own result for that head.
- Verdict and intended follow-up recorded for each finding.
- Where each record was written.

**Actions available**:

- Capture every reported finding, or only selected findings.
- Supply the verdict, category, and intended follow-up at capture time.
- Leave the verdict unadjudicated for a later human pass.
- Re-run capture on the same head to correct a record.

**Considerations**:

- An external reviewer may report several findings on one head. Each one is its
  own record so each can be adjudicated and dispositioned independently.
- The operator may want to capture a finding the external reviewer raised in a
  place the workflow cannot read automatically. Use Case 2 covers that.
- The pull request may not be resolvable, or the operator may name no reviewer
  or a reviewer with no presence on the pull request. The capture is refused and
  nothing is written; see the Missing And Unreadable Input rules.
- The external reviewer may have published nothing on the current head. That is
  a normal, successful outcome with no records written — not an error and not an
  empty record.
- The external reviewer's published output may be present but impossible to
  interpret as findings. The capture is refused, nothing is written, and the
  operator is directed to Use Case 2.

---

### Use Case 2: Operator Records A Finding The Workflow Cannot Read Automatically

**Actor**: Ronda operator

**Preconditions**:

- A pull request exists with a resolvable current head.
- The operator has the text of an external-review finding that automatic reading
  did not return — for example a finding raised by a reviewer the workflow does
  not read, or one raised outside the pull request.

**Steps**:

1. The operator starts a capture for the pull request and supplies the finding
   details directly: reviewer name, finding location, finding title, finding
   text, affected category, and, when known, verdict and intended follow-up. When
   the operator supplies no title, the workflow derives one from the finding text
   under the finding-title rule.
2. The workflow resolves the pull request's current head.
3. The workflow writes the miss record from the supplied details.

**Postconditions**:

- A stored miss record exists that is indistinguishable in structure from an
  automatically captured one, except that it is marked as manually supplied.
- Nothing on the pull request changed.

**Information shown**:

- The record as stored, including the reviewed head and the manual-entry marker.
- Where the record was written.

**Actions available**:

- Supply the reviewed head explicitly when the record belongs to an older head
  rather than the current one.
- Correct a previously supplied record by capturing it again for the same head.

**Considerations**:

- Manual entry is the escape hatch that keeps the workflow usable when an
  external reviewer's output format changes or a new reviewer is introduced.
- Manual entry must not become a way to bypass the redaction and same-head rules
  in Business Rules; the same rules apply to both use cases.

---

### Use Case 3: Operator Adjudicates And Dispositions A Captured Miss

**Actor**: Ronda operator

**Preconditions**:

- At least one stored miss record exists with an unadjudicated verdict or an
  undecided follow-up.

**Steps**:

1. The operator reads the stored miss records.
2. For each record, the operator decides whether the external finding was a real
   defect Ronda should have caught, was not a real defect, was a real concern
   outside what Ronda reviews, or was something Ronda already reported.
3. The operator records that verdict and the intended follow-up on the record.

**Postconditions**:

- Every reviewed record carries a human verdict and an intended follow-up.
- Records left undecided are still visibly undecided rather than silently
  treated as confirmed misses.

**Information shown**:

- Each record's finding text, reviewed head, verdict, and affected category.
- Which records are still unadjudicated or undecided.

**Actions available**:

- Set or change a record's verdict.
- Set or change a record's intended follow-up.
- Add the rationale behind the verdict.

**Considerations**:

- A finding is never assumed to be a confirmed Ronda miss just because the
  external reviewer reported it. Only a human verdict makes it one.
- Changing a verdict later is expected as understanding improves; the record
  keeps the rationale so the change is explainable.

---

### Use Case 4: Operator Reads Captured Misses Alongside Existing Quality Evidence

**Actor**: Ronda operator

**Preconditions**:

- At least one stored miss record exists.
- Ronda's existing review comparison and quality summary evidence is available.

**Steps**:

1. The operator asks for captured misses to be read as review-quality evidence.
2. The evidence is presented in the same shape the existing review comparison
   and quality summary evidence already uses.

**Postconditions**:

- Confirmed misses appear as Ronda misses in the existing quality evidence.
- Findings judged not to be real defects appear as external-reviewer noise
  rather than Ronda misses.
- Findings judged outside Ronda's review scope, already reported by Ronda, or
  still unadjudicated are not counted as confirmed misses.

**Information shown**:

- Counts of confirmed misses, external-reviewer noise, out-of-scope findings,
  duplicates, and unadjudicated records.
- The affected categories that confirmed misses fall into.

**Actions available**:

- Read captured misses together with existing comparison evidence.
- Identify which affected categories most often produce confirmed misses.

**Considerations**:

- This use case is about reading existing evidence in the existing shape. New
  recall and precision trend reporting over time is separate work and is listed
  under Out of Scope (MVP).

---

## Business Rules

- A miss record always names the pull request, the reviewed head, the external
  reviewer, the finding location, the finding title, the finding text, the
  verdict, the affected category, and the intended follow-up. A record missing
  any of these is not written.
- The finding title is the external reviewer's own short name for the finding —
  the heading or first-line summary it published, not a description the workflow
  invents. When the reviewer published no distinct title, the title is the first
  line of the finding text, truncated to 120 characters. Manual entry follows the
  same rule: the operator supplies the reviewer's title, or the workflow derives
  one from the supplied finding text the same way.
- Evidence is head-scoped. A record states the exact head the external finding
  and Ronda's result belong to. When the external finding and Ronda's result do
  not belong to the same head, the record is marked as stale evidence and is
  never counted as a confirmed miss until it is re-captured on a shared head.
- A finding is only a confirmed Ronda miss after a human verdict says so. Every
  newly captured record starts unadjudicated unless the operator supplies a
  verdict at capture time.
- Capture is read-only toward GitHub. The workflow never posts, edits, labels,
  merges, closes, or reopens anything on a pull request, and a captured record
  never decides a pull request's outcome.
- A record stores the external reviewer's own finding text and the location it
  points at. It never stores the reviewed source file's contents or the pull
  request's diff.
- Finding text is stored up to a limit of 2,000 characters. Text beyond that
  limit is truncated and the record shows that truncation happened, so a long
  reviewer comment can never silently pull a large body of source into the
  record.
- A record is never written when the finding text, the finding location, or any
  note the operator supplied matches the workflow's published credential refusal
  list. That list is documented and versioned alongside the workflow, and must
  recognise at least these six forms: a code-hosting access token, an API key, a
  private key block, a cloud access-key identifier, an authorization header
  bearer value, and an assignment whose name reads as a password, secret, token,
  or API key and whose value is a literal. A value that is plainly a placeholder
  — for example `REDACTED`, `example`, `changeme`, or a run of one repeated
  character — does not trigger refusal. The capture is refused, the refusal names
  the matched form, and the operator can re-capture with the offending text
  removed.
- Two captured findings are the **same finding** when all four of these match:
  the external reviewer, the reviewed head, the finding location, and the finding
  title. A difference in any of the four makes them separate findings. The rule
  is identical for automatically read and manually supplied findings, so manually
  re-entering an automatically captured finding updates that record instead of
  creating a second one.
- A finding whose location cannot be resolved to a file and a line is identified
  by external reviewer, reviewed head, and finding title alone, and its record
  states that the location is unresolved.
- Each external finding has at most one record per reviewed head. Capturing the
  same finding on the same head again updates the existing record instead of
  creating a second one.
- The affected category comes from a closed set. An unrecognised category is
  refused rather than stored, so category evidence stays aggregatable.
- Records are stored in the repository alongside Ronda's other committed
  review-quality evidence, so the same redaction rules that make a record safe to
  commit apply to every record.

---

## Missing And Unreadable Input

These rules govern what automatic capture does when its inputs are absent,
empty, or unusable. Nothing is written unless the row says a record is written.

| Input condition                                                                                | Outcome                                 | What the operator is told                                                        |
| ---------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------- |
| The pull request cannot be resolved, or its current head cannot be determined                  | Capture refused                         | That the pull request or its head could not be resolved                          |
| No external reviewer was named                                                                 | Capture refused                         | That a reviewer name is required, and that manual entry is available             |
| The named reviewer has published nothing at all on the pull request                            | Capture refused                         | That the named reviewer has no presence on this pull request                     |
| The named reviewer published output on an earlier head but nothing on the current head         | No records written, reported as success | That there is nothing to capture on the current head, and which head was checked |
| The named reviewer published output on the current head that cannot be interpreted as findings | Capture refused                         | That the output could not be interpreted, and to use manual entry instead        |
| A required record field is absent from a manually supplied finding                             | Capture refused                         | Which required field is missing                                                  |

A refusal never leaves a partially written record behind. Reporting nothing to
capture is a successful outcome and is reported differently from a refusal, so an
operator can tell "the reviewer found nothing" from "the workflow could not
look".

---

## Reported Evidence Mapping

Captured misses are read alongside Ronda's existing review comparison evidence.
Each verdict is reported under exactly one outcome:

| Verdict        | Reported as                                                              |
| -------------- | ------------------------------------------------------------------------ |
| True positive  | Ronda miss                                                               |
| False positive | Ronda better                                                             |
| Already found  | Duplicate                                                                |
| Unadjudicated  | Unclear                                                                  |
| Out of scope   | Out of scope, reported distinctly and never folded into an outcome above |

Two product requirements govern this mapping:

- The five outcomes the existing quality summary already reports keep their
  current meaning. Reading them does not change.
- The out-of-scope count and the affected-category breakdown are **additions**
  alongside those outcomes. Neither may be expressed by redefining an existing
  outcome, and the affected category is never itself an outcome.

Whether these additions are carried by extending the shared evidence contract or
by projecting miss records into it is an implementation-plan decision, not a
product decision.

---

## Capture Decision Gate

The capture workflow decides one of four outcomes per finding. The gate inputs,
outcomes, and required next actions are:

| Head evidence                                             | Credential-shaped content | Existing record for this finding and head | Outcome                                  | Required next action                                     |
| --------------------------------------------------------- | ------------------------- | ----------------------------------------- | ---------------------------------------- | -------------------------------------------------------- |
| Ronda result and external finding share the reviewed head | Not present               | None                                      | Record written                           | Adjudicate the verdict and choose the follow-up          |
| Ronda result and external finding share the reviewed head | Not present               | Present                                   | Record updated in place                  | Confirm the corrected verdict and follow-up              |
| Ronda result and external finding name different heads    | Not present               | Any                                       | Record written and marked stale evidence | Re-capture on a shared head before treating it as a miss |
| Any                                                       | Present                   | Any                                       | Capture refused, nothing written         | Remove the credential-shaped text and capture again      |

Mirror surfaces that must state the same outcomes: the capture command's own
help output and the committed review-quality runbook the operator follows.

---

## Statuses / Enum Values

### Verdict

| Code value       | Display label  | Description                                                                               |
| ---------------- | -------------- | ----------------------------------------------------------------------------------------- |
| `unadjudicated`  | Unadjudicated  | No human has judged this finding yet. Never counted as a confirmed Ronda miss.            |
| `true_positive`  | True positive  | A real defect Ronda should have reported on this head. Counted as a confirmed Ronda miss. |
| `false_positive` | False positive | Not a real defect. Counted as external-reviewer noise Ronda correctly avoided.            |
| `out_of_scope`   | Out of scope   | A real concern, but outside what Ronda is meant to review on this head.                   |
| `already_found`  | Already found  | Ronda already reported the same defect on this head, so it is not a miss.                 |

**Valid transitions**:

- `unadjudicated` → `true_positive`, `false_positive`, `out_of_scope`, or
  `already_found` when the operator records a verdict.
- Any verdict → any other verdict when the operator revises the verdict and
  records the rationale.

### Intended follow-up

| Code value      | Display label | Description                                                                                 |
| --------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `undecided`     | Undecided     | The follow-up has not been chosen yet.                                                      |
| `eval_record`   | Eval record   | Becomes a seeded quality fixture so future Ronda versions are measured against this defect. |
| `prompt_change` | Prompt change | Becomes a change to Ronda's reviewer prompts or review modes.                               |
| `backlog_item`  | Backlog item  | Becomes tracked work larger than a prompt change.                                           |
| `no_action`     | No action     | Deliberately not acted on, with the reason recorded.                                        |

**Valid transitions**:

- `undecided` → `eval_record`, `prompt_change`, `backlog_item`, or `no_action`
  when the operator chooses the follow-up.
- Any follow-up → any other follow-up when the operator revises the decision.

### Affected category

| Code value        | Display label   | Description                                                                     |
| ----------------- | --------------- | ------------------------------------------------------------------------------- |
| `durability`      | Durability      | State or work is lost when a process stops, restarts, or crashes.               |
| `idempotency`     | Idempotency     | Repeating the same operation produces duplicate or conflicting effects.         |
| `retries`         | Retries         | Retry behavior is missing, unbounded, or retries something unsafe to repeat.    |
| `timeouts`        | Timeouts        | A deadline is missing, unenforced, or leaves work running past its budget.      |
| `partial_success` | Partial success | A partly completed operation leaves inconsistent or unreported state.           |
| `concurrency`     | Concurrency     | Concurrent or out-of-order execution produces a wrong result.                   |
| `security`        | Security        | Secret handling, authentication, authorization, or input trust is wrong.        |
| `correctness`     | Correctness     | Ordinary logic produces a wrong result outside the categories above.            |
| `configuration`   | Configuration   | Configuration, defaults, or environment handling is wrong or unsafe.            |
| `observability`   | Observability   | An operator cannot tell what happened from logs, status, or published evidence. |
| `other`           | Other           | A real category not covered above. The record carries the rationale.            |

### Capture source

| Code value  | Display label | Description                                                         |
| ----------- | ------------- | ------------------------------------------------------------------- |
| `automatic` | Automatic     | The finding was read from the pull request by the capture workflow. |
| `manual`    | Manual        | The operator supplied the finding details directly.                 |

---

## Operational Visibility

- **Capture output**: Every capture states the pull request, the reviewed head,
  the external reviewer, how many findings were captured, and where each record
  was written.
- **Refusals and skips**: A refused capture states which rule refused it —
  credential-shaped content, an unrecognised affected category, or missing
  required record fields — so the operator can correct and retry.
- **Stale evidence**: A record written from heads that do not match states that
  it is stale evidence, and names both heads.
- **Truncation**: A record whose finding text was truncated says so on the
  record, so nobody reads a truncated finding as the reviewer's full comment.
- **Audit trail**: Records are committed review-quality evidence, so the
  repository history shows when each record was captured and when a verdict or
  follow-up changed.

---

## Acceptance Criteria

- [ ] AC1: Given a pull request whose current head has both a Ronda result and an
      external reviewer finding, when the operator runs a capture for that pull
      request and reviewer, then a miss record is written that names the pull
      request, the reviewed head, the external reviewer, the finding location, the
      finding title, the finding text, the verdict, the affected category, and the
      intended follow-up.
- [ ] AC2: Given the same pull request, when the capture completes, then nothing
      on the pull request has changed: no comment, review, label, or state change
      was produced by the capture.
- [ ] AC3: Given an external finding the capture workflow cannot read
      automatically, when the operator supplies the reviewer name, finding
      location, finding title, finding text, and affected category directly, then
      a miss record is written with the same structure as an automatically
      captured record and is marked as manually supplied.
- [ ] AC4: Given a newly captured record for which the operator supplied no
      verdict, when the record is read, then its verdict is Unadjudicated and it
      is not counted as a confirmed Ronda miss.
- [ ] AC5: Given a captured record, when the operator sets its verdict to True
      positive, False positive, Out of scope, or Already found and sets its
      intended follow-up to Eval record, Prompt change, Backlog item, or No
      action, then both values are stored on the record together with the
      operator's rationale.
- [ ] AC6: Given records with each verdict, when captured misses are read as
      review-quality evidence, then True positive records are reported as a
      Ronda miss, False positive records are reported as Ronda better, and Out
      of scope, Already found, and Unadjudicated records are not reported as
      confirmed misses.
- [ ] AC7: Given captured miss records with each verdict, when they are read
      together with Ronda's existing review comparison evidence, then each
      verdict is reported under the mapping in Reported Evidence Mapping, the
      five outcome counts the existing quality summary already reports keep their
      current meaning, and the out-of-scope count and the affected-category
      breakdown are reported as additions rather than by redefining any of those
      five outcomes.
- [ ] AC8: Given an external finding whose evidence head differs from the head
      Ronda reviewed, when the operator captures it, then the record names both
      heads, is marked as stale evidence, and is not counted as a confirmed miss.
- [ ] AC9: Given finding text or supplied notes containing credential-shaped
      content such as an access token, private key, or password assignment, when
      the operator captures it, then the capture is refused, no record is written,
      and the refusal names the rule that refused it.
- [ ] AC10: Given a captured record, when the record is inspected, then it
      contains the external reviewer's finding text and the location it points at,
      and contains neither the reviewed file's source contents nor the pull
      request's diff.
- [ ] AC11: Given an external finding whose text exceeds 2,000 characters, when
      the operator captures it, then the stored finding text is truncated to
      2,000 characters and the record states that truncation happened.
- [ ] AC12: Given a record that already exists for a finding on a reviewed head,
      when the operator captures a finding matching all four identity values —
      same external reviewer, reviewed head, finding location, and finding title —
      then the existing record is updated in place and no second record for that
      finding and head exists. This holds when the second capture is manual and
      the first was automatic.
- [ ] AC13: Given an affected category outside the documented closed set, when
      the operator captures a finding with it, then the capture is refused and the
      refusal names the accepted categories.
- [ ] AC14: Given the capture workflow, when an operator follows the committed
      review-quality runbook, then the runbook states the four capture decision
      gate outcomes — record written, record updated, stale evidence recorded, and
      capture refused — and matches the capture command's own help output.
- [ ] AC15: Given a record that already exists for a finding on a reviewed head,
      when the operator captures a finding that differs from it in the finding
      location or the finding title, then a second, separate record is written
      rather than the first being overwritten.
- [ ] AC16: Given a pull request on whose current head the named external
      reviewer has published nothing, when the operator runs a capture, then no
      record is written, the result is reported as success with nothing to
      capture, and the head that was checked is named.
- [ ] AC17: Given a pull request that cannot be resolved, a capture with no
      reviewer named, a named reviewer with no presence on the pull request, or
      reviewer output on the current head that cannot be interpreted as findings,
      when the operator runs a capture, then the capture is refused, no record and
      no partial record is written, and the refusal names which of those
      conditions applied.
- [ ] AC18: Given finding text containing a plain placeholder such as
      `REDACTED`, `example`, `changeme`, or a run of one repeated character in a
      position where a credential would otherwise be recognised, when the operator
      captures it, then the capture is **not** refused and the record is written.
- [ ] AC19: Given a manually supplied finding that omits any one of the required
      record fields, when the operator captures it, then the capture is refused,
      no record is written, and the refusal names the missing field.
- [ ] AC20: Given an external finding for which the reviewer published no distinct
      title, when the operator captures it, then the record's finding title is the
      first line of the finding text truncated to 120 characters, and the same
      derivation applies when the operator supplies no title in manual entry.

---

## Out of Scope (MVP)

- Automatically creating eval fixtures, editing reviewer prompts, or opening
  backlog issues from a captured record. A record states the intended follow-up;
  a human still performs it.
- Recall and precision trend reporting over time against external reviewer
  evidence. That is tracked separately as issue #56.
- New Ronda reviewer modes or prompts for the durability and idempotency
  category family. That is tracked separately as issue #54.
- Feeding repository or product documentation into Ronda's review prompts. That
  is tracked separately as issue #55.
- Reducing local reviewer timeouts in expensive-review gates. That is tracked
  separately as issue #57.
- Automatically reading findings from external reviewers other than the one this
  workflow supports. Other reviewers are recorded through manual entry.
- Capturing findings from repositories the operator cannot read with their
  existing GitHub access. No new credential or permission is introduced.
- Any change to Ronda's own review behavior, its one-review-per-head contract,
  or its published check run.

---

## Brief Coverage Matrix

| Brief objective                                                                                     | Covered by                                          |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Repeatable workflow for recording external-review findings Ronda missed                             | Use Cases 1-3, AC1, AC3, AC14                       |
| Record includes the pull request                                                                    | AC1                                                 |
| Record includes the head SHA                                                                        | AC1, AC8                                            |
| Record includes the reviewer                                                                        | AC1, AC3                                            |
| Record includes the finding text                                                                    | AC1, AC10, AC11                                     |
| Record includes the finding title used for finding identity                                         | AC1, AC3, AC12, AC15, AC20                          |
| A repeatable workflow handles missing, empty, and unreadable input                                  | AC16, AC17, AC19, and Missing And Unreadable Input  |
| Record includes the adjudication                                                                    | AC1, AC4, AC5, AC6                                  |
| Record includes the affected category                                                               | AC1, AC13                                           |
| Record states whether it becomes an eval, prompt change, or backlog item                            | AC5, and the Intended follow-up enum                |
| A command or documented workflow captures a Codex GitHub finding from a PR into a structured record | Use Case 1, AC1, AC14                               |
| Records preserve current-head evidence                                                              | AC1, AC8                                            |
| Records distinguish true positives, false positives, and out-of-scope findings                      | AC5, AC6, AC7, and the Verdict enum                 |
| Captured misses can feed the existing review comparison / quality summary tooling                   | Use Case 4, AC6, AC7, and Reported Evidence Mapping |
| The workflow avoids storing secrets or full sensitive patches unnecessarily                         | AC9, AC10, AC11, AC18                               |

No brief objective is deferred to Out of Scope, so there are no deferral notes.
