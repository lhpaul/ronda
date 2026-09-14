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

- A pull request exists and Ronda has published a review result for at least one
  of its heads. A result for the head the finding was read from is the ordinary
  case; a result only on some other head is still enough to capture, and the
  record is marked stale evidence.
- An external reviewer has published at least one finding on the pull request.
- The operator can read the pull request.

**Steps**:

1. The operator starts a capture for that pull request, naming the external
   reviewer.
2. The workflow resolves the pull request's current head and reads the external
   reviewer's findings published against that head.
3. The workflow presents each external finding it found and asks the operator to
   supply the affected category — required on this path exactly as on manual
   entry, because no external reviewer publishes one — and, when the operator
   has already judged the finding, the verdict and the intended follow-up. Not
   having judged it yet is the ordinary case: both then take their defaults of
   Unadjudicated and Undecided. A capture whose operator supplies no category
   when asked is refused under condition 7, exactly as an omitted category
   refuses manual entry.
4. The workflow runs the Capture Decision Gate on every finding from step 3 and
   writes one miss record for each finding the gate does not refuse.

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

- Capture the reported findings. Automatic capture always takes every finding
  the reviewer reported on the head through the Capture Decision Gate; the
  operator cannot select a subset. A finding the operator does not consider a
  miss is captured and then adjudicated (for example as a false positive, out of
  scope, or no action) rather than left out, so no reported finding is silently
  dropped from the evidence.
- Supply the verdict, category, and intended follow-up at capture time.
- Leave the verdict unadjudicated for a later human pass.
- Re-run capture on the same head to correct the affected category, the
  verdict, or the intended follow-up on an existing record.
- Delete a record whose verdict is still Unadjudicated and whose intended
  follow-up is still Undecided, then capture it again to correct a mistake in
  the location, the finding title, the finding text, the reviewed head, or the
  external reviewer, because those fields participate in finding identity and
  an update in place cannot change them without creating a second record.

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

- A pull request exists with a resolvable current head, and Ronda has published a
  review result for at least one of its heads. As with automatic capture, a
  result only on some other head is enough, and the record is marked stale
  evidence.
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
- Correct the affected category, the verdict, or the intended follow-up on a
  previously supplied record by capturing it again for the same head.
- Delete a record whose verdict is still Unadjudicated and whose intended
  follow-up is still Undecided, then supply it again to correct a mistake in
  the location, the finding title, the finding text, the reviewed head, or the
  external reviewer.

**Considerations**:

- Manual entry is the escape hatch that keeps the workflow usable when an
  external reviewer's output format changes or a new reviewer is introduced.
- Manual entry must not become a way to bypass the redaction and same-head rules
  in Business Rules; the same rules apply to both use cases.

---

### Use Case 3: Operator Adjudicates And Dispositions A Captured Miss

**Actor**: Ronda operator

**Preconditions**:

- At least one stored miss record exists whose verdict or intended follow-up
  the operator wants to set for the first time (from Unadjudicated or
  Undecided) or revise (from one already-set value to another).

**Steps**:

1. The operator reads the stored miss records.
2. For each record, the operator decides whether the external finding was a real
   defect Ronda should have caught, was not a real defect, was a real concern
   outside what Ronda reviews, or was something Ronda already reported.
3. The operator records that verdict and the intended follow-up on the record.

**Postconditions**:

- Every record the operator adjudicated carries a human value for each field
  they set. Adjudicating one field alone is a normal outcome, so a record may
  carry a human verdict while its intended follow-up is still Undecided, or the
  reverse.
- Records left unadjudicated or undecided, in whole or in part, are still visibly
  so rather than silently treated as confirmed misses.

**Information shown**:

- Each record's finding text, reviewed head, verdict, and affected category.
- Which records are still unadjudicated or undecided.

**Actions available**:

- Set or change a record's verdict.
- Set or change a record's intended follow-up.
- Add the rationale behind the verdict or follow-up change.

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
2. Each miss record's Ronda result head is resolved against Ronda's own,
   separately durable review output for that head — the miss record supplies no
   copy of Ronda's result or findings of its own.
3. The evidence is presented in the same shape the existing review comparison
   and quality summary evidence already uses.

**Postconditions**:

- Confirmed misses appear as Ronda misses in the existing quality evidence.
- Findings judged not to be real defects appear as external-reviewer noise
  rather than Ronda misses.
- Findings judged outside Ronda's review scope, already reported by Ronda, or
  still unadjudicated are not counted as confirmed misses.
- Records carrying the stale-evidence marker are reported as stale evidence
  rather than counted under any outcome above, whatever their verdict.
- Records whose Ronda review is unresolvable at read time are reported as
  unresolvable evidence rather than counted under any outcome above, whatever
  their verdict.
- The existing clean-agreement count is shown unchanged: no captured miss
  record adds to or subtracts from it.

**Information shown**:

- Counts of confirmed misses, external-reviewer noise, out-of-scope findings,
  duplicates, unadjudicated records, the unchanged clean-agreement count, stale
  evidence, and unresolvable evidence.
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

- A record involves **two distinct heads**, and every rule below names which one
  it means:
  - The **reviewed head** is the head the external finding's evidence belongs to.
    It is the head the record is evidence _about_, the head that participates in
    finding identity and in "each distinct finding identity has at most one
    record".
    Automatic capture reads it from the reviewer's evidence; manual entry lets the
    operator supply it and otherwise defaults it to the pull request's current
    head.
  - The **Ronda result head** is the head of the Ronda review result the record is
    compared against. The workflow always resolves it and the operator never
    supplies it. It resolves to the record's **own reviewed head** when Ronda has
    published a result for that head, and only otherwise to the most recent head
    on the pull request for which Ronda has published a result. "Most recent" is
    decided by the order in which heads were pushed to the pull request — the head
    pushed last wins — never by commit timestamp and never by when Ronda
    published its result, so a result Ronda publishes late for an older head
    does not displace the result for a head pushed after it.
  - Resolving it against the record's own reviewed head first is what makes
    staleness meaningful and clearable. A record is stale exactly when Ronda has
    published no result for the head the finding was read from, so comparing the
    two would span two different states of the code. Re-capturing that same
    reviewed head after Ronda has published a result for it resolves the Ronda
    result head to that head and clears the marker. Were the Ronda result head
    always the newest reviewed head, a record on an older head could never stop
    being stale — re-capturing it would still compare against the newer result,
    and capturing the newer head would create a different record, because the
    reviewed head participates in identity.
  - The two are equal in the ordinary case. When they differ, the record carries
    the stale-evidence marker and names both. Neither the stale marker nor the
    Ronda result head ever participates in identity, so re-capturing a stale
    finding on the same reviewed head updates its existing record rather than
    creating a second one.
  - A reviewed head the operator supplies must be a commit identifier that is a
    head of the referenced pull request. One that is malformed, or that names a
    commit which was never a head of that pull request, refuses the capture
    rather than being accepted — the value participates in identity and stale
    classification, so accepting an unverifiable head would corrupt both. This
    check is Stage 3 of the Capture Decision Gate. When a supplied reviewed head
    is both credential-shaped and not a real head of the referenced pull
    request, the capture is refused either way; the reported reason is the
    first applicable entry in the refusal precedence list.
  - Stage 1 condition 3 is about the **Ronda result head**: it refuses when Ronda
    has published no result for any head on the pull request, because then there
    is nothing to compare against at all. A finding whose reviewed head differs
    from the Ronda result head — whether the reviewed head is older, as when the
    operator names an earlier head, or newer, as when Ronda has not yet
    published a result for the head the finding was read from — is the stale
    case, which is recorded rather than refused.
- A miss record always names the pull request, the reviewed head, the Ronda
  result head, the external reviewer, the finding location, the finding title,
  the finding text, the verdict, the affected category, the intended follow-up,
  and the capture source. A record missing any of these is not written.
- **The Ronda result head is a reference, not a copy.** A miss record names
  which Ronda review result it is evidence against; it never stores Ronda's own
  result or Ronda's own findings. Ronda's review results are already durable —
  Ronda posts one review per head SHA as a GitHub PR review, per the repository
  constitution — so nothing about this workflow needs to retain a second copy of
  them. Reading captured misses (Use Case 4) resolves the Ronda result head
  against that existing, independently durable review output at read time; if
  Ronda's review for that head is no longer resolvable, the captured miss record
  itself is unaffected and continues to name the head it was captured against.
  A record whose Ronda review is unresolvable at read time is reported as
  **unresolvable evidence**. Unlike the stale marker, this is never stored on
  the record — resolvability is a property of Ronda's own review, checked fresh
  on every read, not a fact the workflow can capture and hold. The two are
  independent, not mutually exclusive: the stale marker reflects the heads
  compared **at capture time**, while resolvability reflects whether Ronda's
  review still exists **at read time**, so a record already carrying the
  stale-evidence marker can also become unresolvable later, if Ronda's review
  for its stored Ronda result head stops resolving. When both apply, the record
  is reported under **both** the stale-evidence count and the
  unresolvable-evidence count for that read — the two counts are independent
  additions, not competing outcomes, so neither takes precedence over the
  other. Either way the record is counted under no verdict outcome. The two
  clear differently, and a later read never treats them alike: unresolvable
  evidence clears on its own — the very next read that finds Ronda's review
  resolvable again drops that count for the record, with no re-capture needed —
  while stale evidence clears only by re-capturing the finding on a shared
  head, per the Reported Evidence Mapping below. A record whose Ronda review
  resolves again while it still carries the stale-evidence marker is reported
  under stale evidence alone on that read, exactly as a stale-but-resolvable
  record already is, and stays out of the verdict mapping until it is
  re-captured.
- Automatic capture reads findings published by the **Codex GitHub reviewer**,
  the only reviewer automatic reading supports in this iteration. Naming a
  different reviewer on the automatic path is refused under Stage 1 condition 4 —
  as far as automatic reading is concerned that reviewer has no readable presence
  on the pull request — and the refusal directs the operator to manual entry,
  which accepts any reviewer name. This is an ordinary refusal, not a fifth gate
  outcome, so the four-outcome model still holds.
- The capture source records whether the finding was read from the pull request
  or supplied by the operator. When a re-capture updates a record in place from a
  different source than the one that created it, the capture source becomes the
  source of the most recent capture, because it describes how the record's
  current evidence got there.
- Those eleven record fields divide into two kinds, and the distinction decides
  whether an omission refuses the capture:
  - **Required inputs** — the external reviewer, the finding location, the
    finding text, and the affected category. Automatic capture reads the
    reviewer, location, and text from the reviewer's own output; manual entry
    supplies all four directly. The affected category is the one required input
    no external reviewer publishes, so on **either** path it is supplied by the
    operator — confirmed during automatic capture (Use Case 1 step 3) or entered
    directly during manual capture (Use Case 2). If any one of the four is
    absent, the capture is refused and no record is written.
    - The finding location is required as the **pointer the reviewer gave**, not
      as a pointer that resolves. A location that is present but cannot be
      resolved to a file and a line satisfies the required input; the record
      stores it as given and marks the location unresolved. Only an absent
      location refuses the capture. This mirrors Ronda's own findings, where a
      finding that cannot be mapped to a commentable diff line still carries its
      path.
  - **Derived or defaulted fields** — the capture source (set by the workflow
    from the path in use, never supplied by the operator), the pull request and
    the Ronda result head
    (both resolved by the workflow), the reviewed head (read from the reviewer's
    evidence, or supplied by the operator, defaulting to the pull request's
    current head), the finding title (derived from the finding text
    when the source supplies none), the verdict (defaults to Unadjudicated on a
    newly written record), and the intended follow-up (defaults to Undecided on
    a newly written record). Their absence from the input never refuses a
    capture, because the workflow always produces a value — either that default
    on a newly written record, or, on an update in place, the value the merge
    rule below preserves from the existing record.
- An adjudication may set the verdict, the intended follow-up, or both. Setting
  one leaves the other at its current value and is never refused for being
  partial; the rationale requirement applies to whichever fields the
  adjudication sets.
- A verdict or intended follow-up supplied through the adjudication action must
  be one of that field's documented values. An invalid value refuses the
  adjudication and leaves the record unchanged, exactly as it refuses a capture.
- The adjudication rationale is subject to the same data-minimisation limits as
  the finding text, and in the same order: it is scanned first — for
  credential-shaped content anywhere in the text, and for the reviewed source
  file's contents or the pull request's diff — and refused if either is found;
  only a rationale that matches neither is then stored, up to 2,000 characters,
  with text beyond that truncated and the truncation shown on the record. A
  rationale is a short human explanation, never a place to paste a patch.
- The adjudication rationale is scanned against the same credential refusal list
  at the moment it enters, which is the adjudication action rather than a capture.
  A rationale matching a refusal form without being a published placeholder is
  refused, the refusal names the matched form, the verdict or follow-up change
  does not take effect, and the record is left unchanged. This refusal is
  distinct from — and reported differently than — a revision refused for
  carrying no rationale at all: one names the credential form that was matched,
  the other states that a rationale is required. No text reaches a committed
  record without passing the refusal list.
- The adjudication rationale is required exactly through the **adjudication
  action in Use Case 3**: a human setting or revising a record's verdict or
  intended follow-up directly, outside of running a capture. Such a change
  without a rationale is refused, and the record is left unchanged.
- The rationale is **not** required anywhere else, and its absence never refuses a
  capture — including a capture that runs the Capture Decision Gate and reaches
  Stage 4's "Record updated in place" outcome for a finding identity that already
  has a record:
  - A verdict or follow-up supplied during capture itself needs no rationale,
    whether that capture writes a new record or updates an existing one in place.
    The record is written with the supplied values. Any rationale already on
    the record is preserved when the supplied values leave both the verdict and
    the intended follow-up unchanged from what the record already carried; when
    a supplied value **differs** from what an existing record already carries,
    that field is replaced and the existing rationale is **cleared**, per the
    merge rule and AC43 — not because a rationale was required at capture time,
    but because the rationale no longer explains the judgement the record now
    carries. A capture is
    never the adjudication action merely because the record it writes to already
    existed; it is a later, separate adjudication — setting or revising the
    verdict or follow-up directly on a stored record without re-running capture —
    that triggers the rationale requirement.
  - A value the workflow defaulted needs no rationale, so a capture leaving the
    verdict Unadjudicated and the follow-up Undecided needs none.

  The requirement therefore governs changes to recorded judgements made through
  the adjudication action, never the act of capturing evidence, whether that
  capture creates or updates a record. A capture is never lost because a
  rationale was missing.

- The finding title is the external reviewer's own short name for the finding —
  the heading or first-line summary it published, not a description the workflow
  invents. When the reviewer published no distinct title, the title is the first
  non-blank line of the finding text with leading and trailing whitespace
  removed, truncated to 120 characters. When the finding text contains no
  non-blank line, the capture is refused for a missing finding text rather than
  storing an empty title. Manual entry follows the same rule: the operator
  supplies the reviewer's title, or the workflow derives one from the supplied
  finding text the same way.
- Evidence is head-scoped. A record states the exact reviewed head and the exact
  Ronda result head it was captured against. When the two differ, the record is
  marked as stale evidence and is never counted as a confirmed miss until it is
  re-captured on a shared head.
- A finding is only a confirmed Ronda miss after a human verdict says so. Every
  newly captured record starts unadjudicated unless the operator supplies a
  verdict at capture time.
- Capture and deletion are read-only toward GitHub. The workflow never posts,
  edits, labels, merges, closes, or reopens anything on a pull request; a
  captured record never decides a pull request's outcome, and deleting a
  record touches only the committed evidence, never the pull request.
- A record stores the external reviewer's own finding text and the location it
  points at. It never stores more of the reviewed source file's contents or the
  pull request's diff than the short quoted excerpt the source-or-diff content
  rule below permits — never a diff hunk, and never more than five consecutive
  matching lines.
- When **any free-text field the record would store** carries the reviewed source
  file's contents or the pull request's diff, the capture is **refused** and
  nothing is stored, exactly as an adjudication rationale carrying such content is
  refused. The scanned fields are the same ones the credential rule scans — the
  reviewer name, the reviewed head as supplied, the finding location, the finding
  title, and the finding text — because manual entry can supply any of them and a
  title or location is as capable of carrying a pasted diff as the text is. The
  refusal names which field carried source or diff content. Refusing
  rather than silently trimming keeps the operator aware their evidence was
  rejected, and it is what makes the bounded-excerpt guarantee — never more than
  a short quoted excerpt, never a diff hunk — achievable rather than
  aspirational. This check is part of Stage 3 of the Capture
  Decision Gate, alongside the credential scan, and it runs against each scanned
  field in full before any truncation, so content beyond the finding text's
  2,000-character boundary or a derived title's 120-character boundary is scanned
  exactly like content before it. When a field matches both this rule and the
  credential refusal list, the capture is
  refused either way, and the reported reason is the first applicable entry in
  the refusal precedence list.
- **What counts as source or diff content.** Wherever this spec refuses text for
  carrying the reviewed source file's contents or the pull request's diff —
  every stored free-text field and the adjudication rationale alike — the test is
  exactly this, and nothing else:
  - The text contains a diff header or hunk marker: a line, once its leading
    Markdown block-quote markers (`>`) and leading whitespace are stripped,
    beginning `diff --git`, beginning `@@`, or beginning `--- ` immediately
    followed by a line stripped the same way and beginning `+++ `. Stripping
    quoting and indentation before this check is what keeps a diff hunk pasted
    into a block quote or an indented code block from evading it.
  - Or the text contains **more than five consecutive non-blank lines** that
    appear, in the same order and consecutively, in any file the pull request
    changes as that file stands at the reviewed head, or in the pull request's
    diff at the reviewed head. Lines are compared with leading Markdown
    block-quote markers (`>`) and leading and trailing whitespace ignored and,
    for diff lines, the leading `+`, `-`, or space marker ignored. Stripping
    quoting and indentation before this comparison is what keeps a quoted or
    indented excerpt from evading the five-consecutive-lines count the same
    way stripping keeps a hunk marker from evading the check above.

  A quoted excerpt of **five or fewer** consecutive such lines, a single line, an
  identifier, or a file path is allowed and is not refused, because external
  findings routinely quote the code they point at. "The reviewed source file" and
  "the pull request's diff" elsewhere in this spec mean exactly the files and
  diff named here.

- Finding text is stored up to a limit of 2,000 characters. Text beyond that
  limit is truncated and the record shows that truncation happened, so a long
  reviewer comment can never silently pull a large body of source into the
  record.
- A record is never written when **any free-text field the record would store**
  matches the workflow's published credential refusal list. Every such field is
  scanned on the same terms — the reviewer name, the reviewed head as supplied,
  the finding location, the finding title, and the finding text — including a
  reviewer name the operator typed and a title the workflow derived, so no field
  can carry a credential into a committed record.
- A refusal names one matched field and the form it matched, so the operator knows
  what to remove. When several fields match, the outcome is refusal either way;
  the reported reason is the first applicable entry in the refusal precedence
  list.
- No amount of text can hide a credential from the scan. A credential anywhere in
  a field refuses the capture even when that field would have been truncated
  before storage, so truncation can never launder a secret out of view. That list is documented and versioned alongside the workflow, and must
  recognise at least these six forms: a code-hosting access token, an API key, a
  private key block, a cloud access-key identifier, an authorization header
  bearer value, and an assignment whose name reads as a password, secret, token,
  or API key and whose value is a literal. A matched value is accepted rather
  than refused only when it equals, ignoring case and surrounding whitespace, one
  of the exact literal values on the workflow's published placeholder list. That
  list must include at least `REDACTED`, `example`, and `changeme`. It is a list
  of whole literal values only — never a pattern, a prefix, or a length rule — so
  no real secret can satisfy it by resembling a placeholder. The list is
  published and versioned with the refusal list, and the comparison is closed: a
  matched value that is not equal to a listed literal is refused. Ambiguity
  therefore fails closed toward refusing, never toward storing. The capture is
  refused, the refusal names the matched form, and the operator can re-capture
  with the offending text removed.
- Two captured findings are the **same finding** when all six of these match:
  the pull request, the external reviewer, the reviewed head, the finding
  location, the finding title, and the finding text. A difference in any of the
  six makes them separate findings — including the same commit reviewed as the
  head of two different pull requests, which is two separate findings even when
  the reviewer, location, and title are identical, and including two findings
  the same reviewer reports at the same location with the same title, which are
  two separate findings whenever their finding text differs, so neither is
  silently discarded. The rule is identical for automatically read and manually
  supplied findings, so manually re-entering an automatically captured finding
  updates that record instead of creating a second one. Identity compares
  finding text in full, before truncation, exactly as the other pre-truncation
  scans in this spec do, so two findings that would truncate to the same stored
  text are still told apart by what came after the 2,000-character boundary.
- **Incidental differences in how the same finding was entered never produce two
  records.** Comparing the six identity values ignores exactly these four kinds
  of difference and no others:
  - how a reviewer was named, as opposed to which reviewer it is, resolved only
    as the reviewer identity rule below states;
  - how a commit identifier was abbreviated;
  - letter case, in the finding location, finding title, and finding text;
  - leading, trailing, or repeated whitespace, in the finding location, finding
    title, and finding text.

  Any other difference in any of the six identity values makes two separate
  findings. The list is closed, so an implementer never has to judge whether some
  further difference is meaningful. Each record stores the
  external reviewer, location, title, and finding text exactly as its most
  recent source gave them: the comparison never normalises what is stored, and a
  matching re-capture replaces the stored spelling with its own as part of
  refreshing the record's evidence fields. The implementation plan specifies how
  the comparison achieves this.

- **Reviewer identity.** Automatic capture identifies the Codex GitHub reviewer
  by its GitHub login, `chatgpt-codex-connector[bot]`. The following names are
  the complete, closed list of aliases that identify that same reviewer, compared
  with letter case and leading and trailing whitespace ignored:
  `chatgpt-codex-connector[bot]`, `chatgpt-codex-connector`, `codex-github`, and
  `codex`. Any other reviewer name identifies a reviewer of its own and matches
  another name only when the two are identical with letter case and leading and
  trailing whitespace ignored. No other alias, display name, or similarity rule
  makes two reviewer names the same reviewer, and the alias list changes only by
  changing this spec. The same list decides support on the automatic path:
  naming any alias on it names the Codex GitHub reviewer automatic reading
  supports, and naming any other reviewer is the unsupported-reviewer case of
  Stage 1 condition 4.

- A finding whose location is present but cannot be resolved to a file and a
  line is identified by pull request, external reviewer, reviewed head, the
  location text as given, finding title, and finding text. Its record states
  that the location is unresolved. Identity still uses all six values, so an
  unresolved location never collapses two distinct findings into one record.
- **Each distinct finding identity has at most one record.** A pull request and
  reviewed head can hold several records at once — one per distinct finding
  identity reported against it — but capturing the same finding (all six
  identity values matching) on the same pull request and reviewed head again
  updates that one existing record instead of creating a second one.
- **Deleting an erroneous record.** An operator may delete a record whose
  verdict is still Unadjudicated and whose intended follow-up is still
  Undecided — a record no human has yet acted on. Deletion removes the record
  from the committed evidence entirely, freeing its finding identity to be
  captured again correctly; the deleted record's history remains visible in
  the repository's commit history, per the audit-trail guarantee below,
  exactly as any other change to committed evidence does. Deletion is refused,
  and the record is left unchanged, when its verdict or intended follow-up is
  not at its default — once a human judgement has been set, whether supplied
  at capture time or through the adjudication action, the record is corrected
  through the adjudication action, never erased. No adjudication or capture ever
  sets a verdict back to Unadjudicated or a follow-up back to Undecided (see the
  transition rules below), so a record a human has judged can never become
  deletion-eligible again. Delete-then-recapture is how the workflow
  corrects a mistake in an identity-bearing field — the location, the finding
  title, the finding text, the reviewed head, or the external reviewer — none
  of which an update in place can change without creating a second record.
  Correcting the affected category, the verdict, or the intended follow-up
  needs no deletion, because none of those three fields participates in
  finding identity and an update in place already replaces them.
- The affected category comes from a closed set. An unrecognised category is
  refused rather than stored, so category evidence stays aggregatable.
- Records are stored in the repository alongside Ronda's other committed
  review-quality evidence, so the same redaction rules that make a record safe to
  commit apply to every record.

---

## Missing And Unreadable Input

These rules are **Stage 1 and Stage 2** of the Capture Decision Gate below. They
govern what capture does when its inputs are absent, empty, or unusable, whether
the finding is read automatically or supplied manually.

Conditions are evaluated **in the order listed**, and the first one that matches
decides. That order is what makes simultaneous failures determinate: a capture
naming no reviewer against an unresolvable pull request reports condition 1, not
condition 2. Nothing is written by any condition below.

| Order | Stage | Applies to     | Input condition                                                                                                                                  | Outcome            | What the operator is told                                                                                                                                                                                                          |
| ----- | ----- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | 1     | Both paths     | The pull request cannot be resolved, or its current head cannot be determined                                                                    | Capture refused    | That the pull request or its head could not be resolved                                                                                                                                                                            |
| 2     | 1     | Both paths     | No external reviewer was named                                                                                                                   | Capture refused    | That a reviewer name is required, and that manual entry is available                                                                                                                                                               |
| 3     | 1     | Both paths     | Ronda has published no review result for any head on the pull request                                                                            | Capture refused    | That there is no Ronda result to compare against on this pull request                                                                                                                                                              |
| 4     | 1     | Automatic only | The named reviewer has published nothing automatic reading can find on the pull request, including a reviewer automatic reading does not support | Capture refused    | Whether the named reviewer is not the Codex GitHub reviewer automatic reading supports, or is the Codex GitHub reviewer with no readable presence on this pull request, and that manual entry accepts any reviewer name either way |
| 5     | 1     | Automatic only | The named reviewer has published on the pull request, but nothing on the current head                                                            | Nothing to capture | That there is nothing to capture on the current head, and which head was checked                                                                                                                                                   |
| 6     | 1     | Automatic only | The named reviewer published output on the current head that cannot be interpreted as findings                                                   | Capture refused    | That the output could not be interpreted, and to use manual entry instead                                                                                                                                                          |
| 7     | 2     | Both paths     | A required input is absent, whether read automatically or supplied manually                                                                      | Capture refused    | Which required input is missing                                                                                                                                                                                                    |
| 8     | 2     | Both paths     | The affected category is not in the documented closed set                                                                                        | Capture refused    | Which categories are accepted                                                                                                                                                                                                      |
| 9     | 2     | Both paths     | A supplied verdict or intended follow-up is not one of its documented values                                                                     | Capture refused    | Which values are accepted for that field                                                                                                                                                                                           |

**Conditions 4, 5, and 6 apply to automatic capture only.** They all ask what the
external reviewer published on the pull request, which is a question only
automatic reading needs to answer. Manual entry supplies the finding directly, so
those three conditions are not evaluated on that path at all.

That scoping is what keeps Use Case 2 reachable. Its two motivating cases — a
finding from a reviewer the workflow does not read, and a finding raised outside
the pull request — are precisely conditions 4 and 6. Were those conditions
applied to manual entry, the escape hatch could never write a record, and
capture would have no way to record a finding the workflow cannot read. Manual
entry still passes conditions 1, 2, 3, 7, 8, and 9: it needs a resolvable pull
request, a named reviewer, a Ronda result to compare against, every required
input, a category from the closed set, and a documented value for any verdict
or intended follow-up it supplies.

Within automatic capture, conditions 4 and 5 are mutually exclusive by
construction: condition 4 covers a reviewer automatic reading does not support,
or a reviewer it does support but with no presence anywhere on the pull
request; condition 5 covers a reviewer automatic reading does support that is
present on the pull request but silent on the current head. Only condition 5 is
a success.

A refusal never leaves a partially written record behind. Reporting nothing to
capture is a successful outcome and is reported differently from a refusal, so an
operator can tell "the reviewer found nothing" from "the workflow could not
look".

---

## Reported Evidence Mapping

Captured misses are read alongside Ronda's existing review comparison evidence.
Each verdict is reported under exactly one outcome.

**Only non-stale, resolvable records take part in this mapping.** A record
whose reviewed head differs from its Ronda result head is reported as stale
evidence and counted under no outcome below, whatever its verdict — the
comparison it would support is not valid across two different heads.
Re-capturing it on a shared head clears the marker and admits it to the
mapping. A record whose Ronda review cannot be resolved at read time is
reported as unresolvable evidence and likewise counted under no outcome below,
whatever its verdict — there is no Ronda result left to compare the finding
against. A **non-stale** such record returns to the mapping on a later read
once Ronda's review resolves again, with no re-capture required. These two
conditions are independent and can hold at once: a stale record whose Ronda
review later becomes unresolvable is reported under **both** the
stale-evidence and the unresolvable-evidence counts for that read, never
under just one at the other's expense, and stays out of the mapping either
way. When that same record's Ronda review later resolves again while the
stale marker is still set, the unresolvable-evidence count drops but the
record is reported under stale evidence alone and stays out of the mapping
until it is re-captured on a shared head — resolving the Ronda review never
substitutes for the re-capture the stale marker requires, per AC48.

| Verdict        | Reported as                                                              |
| -------------- | ------------------------------------------------------------------------ |
| True positive  | Ronda miss                                                               |
| False positive | Ronda better signal                                                      |
| Already found  | Duplicate finding                                                        |
| Unadjudicated  | Unclear                                                                  |
| Out of scope   | Out of scope, reported distinctly and never folded into an outcome above |

**Clean agreement is retained, not mapped.** The existing comparison evidence's
fifth outcome, clean agreement, records that Ronda and the external reviewer
agreed with no finding between them. A captured miss record always carries an
external finding, so no verdict maps to clean agreement: captured miss records
never add to, subtract from, or reclassify the clean-agreement count, which is
reported exactly as the existing comparison evidence reports it.

Four product requirements govern this mapping:

- The five outcomes the existing quality summary already reports keep their
  current meaning. Reading them does not change.
- The out-of-scope count and the affected-category breakdown are **additions**
  alongside those outcomes. Neither may be expressed by redefining an existing
  outcome, and the affected category is never itself an outcome.
- The stale-evidence count is likewise an **addition**: it is reported
  separately from the five outcomes and from the out-of-scope count, never
  folds into any of them, and shrinks only when a stale record is re-captured
  on a shared head.
- The unresolvable-evidence count is likewise an **addition**: it is reported
  separately from the five outcomes, the out-of-scope count, and the
  stale-evidence count, never folds into any of them, and rises and falls only
  with whether Ronda's review for a record's Ronda result head resolves on a
  given read, never with any change to the record itself.

Whether these additions are carried by extending the shared evidence contract or
by projecting miss records into it is an implementation-plan decision, not a
product decision.

---

## Capture Decision Gate

A single capture may carry several findings. **Stage 1 is evaluated once for the
capture; Stages 2, 3, and 4 are evaluated once per finding.** A finding refused
at Stage 2 or Stage 3 is refused on its own and does not abort the others, so one
credential-shaped or invalid finding never discards good evidence alongside it. A
Stage 1 refusal, by contrast, refuses the whole capture, because it means the
pull request, reviewer, or Ronda result could not be resolved at all. The capture
reports an outcome per finding, and the outcome tables below describe one
finding.

Capture evaluates four stages in order. The first stage that reaches an outcome
decides, and later stages run only when the earlier ones passed. That precedence
is what makes the gate complete: a same-head, credential-free finding still
refuses when Stage 1 or Stage 2 rejects it.

| Stage                                              | Inputs it examines                                                                                                                                                                                                                                                                                                                     | Outcomes it can reach                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 1. Input resolution                                | Whether the pull request and its current head resolve, a reviewer is named, and Ronda has a result for any head on the pull request — plus, for automatic capture only, whether the named reviewer is one automatic reading supports and is present on the pull request, and whether its output on the current head is interpretable   | Capture refused; Nothing to capture (automatic path only); otherwise continue |
| 2. Input validation                                | Whether every required input is present, the affected category is in the closed set, and a supplied verdict or intended follow-up is one of its documented values                                                                                                                                                                      | Capture refused; otherwise continue                                           |
| 3. Credential refusal and reviewed-head validation | Whether any text the record would store matches a published refusal form without being a published placeholder, whether any free-text field the record would store carries the reviewed source file's contents or the pull request's diff, and whether a manually supplied reviewed head is a real head of the referenced pull request | Capture refused; otherwise continue                                           |
| 4. Record decision                                 | Whether a record already exists for this finding identity and head                                                                                                                                                                                                                                                                     | Record written; Record updated in place                                       |

Stage 1 and Stage 2 per-condition detail, including their evaluation order, is
the Missing And Unreadable Input table above. Within Stage 1, "Nothing to
capture" is reached only through condition 5, which the Missing And Unreadable
Input table scopes to automatic capture; manual capture cannot reach it. Within
Stage 3, a manually supplied reviewed head that is both credential-shaped and not
a real head of the pull request is refused either way; the reported reason is the
first applicable entry in the refusal precedence list. Stage 4
resolves on one input only:

| Existing record for this finding identity and head | Outcome                 | Required next action                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| None                                               | Record written          | Adjudicate the verdict and choose the follow-up **when either is still at its default** of Unadjudicated or Undecided. None required when the capture supplied both, because the record already carries a judgement.                                                                                                                                                                                            |
| Present                                            | Record updated in place | Adjudicate whichever of the verdict and follow-up is **still at its default** of Unadjudicated or Undecided after the merge — an update preserves an existing judgement and may supply only one of the two, so one field can remain at its default. None required when both already carry a judgement. Either way, revise them through the adjudication action if the refreshed evidence changes the judgement. |

An update in place **merges rather than resets**, and the two kinds of field
behave differently.

The **evidence** fields are all replaced with what this capture read or was
given: the external reviewer, the finding location, title, and text, the
affected category, the capture source, the Ronda result head, and the stale
marker. Refreshing the Ronda result head matters — a record captured as stale,
then re-captured after Ronda has reviewed the record's
reviewed head, stores the new Ronda result head and has its stale marker
cleared. The stored heads therefore never contradict the marker. The affected
category is an evidence field, not a judgement, so a re-capture correcting a
mistaken category always replaces it, with no rationale needed — the same as
correcting the location or the finding text.

The **judgement** fields — verdict, intended follow-up, and rationale — are
preserved when this capture omits both verdict and follow-up, or supplies them
with the same values the record already carries. When this capture explicitly
supplies a verdict or intended follow-up that **differs** from what the record
currently carries, that field is replaced with the newly supplied value and the
existing rationale is **cleared** — it explained a judgement the record no
longer has, and keeping it would pair the new judgement with an explanation for
the old one. A re-capture that leaves both fields unchanged, whether by omitting
them or by supplying the same values, never discards a human adjudication or its
rationale, because re-reading evidence is not a judgement about it.

**Stale evidence is a record attribute, not a fifth outcome.** Whether Ronda's
result and the external finding share the reviewed head does not change which
Stage 4 outcome applies — it sets the stale-evidence marker on the record that
outcome produces. A stale finding captured twice on the same head therefore
updates its existing record in place exactly like a non-stale one, and never
creates a duplicate:

| Head evidence                                        | Stale marker on the resulting record | Counted as a confirmed miss                  |
| ---------------------------------------------------- | ------------------------------------ | -------------------------------------------- |
| The reviewed head equals the Ronda result head       | Not set                              | Yes, once a human verdict says so            |
| The reviewed head differs from the Ronda result head | Set, naming both heads               | No, until it is re-captured on a shared head |

Across all stages the gate has exactly four distinct outcomes. Every one has a
required next action; where none is needed, that is stated as a reasoned
no-action rather than left blank:

| Outcome                 | Reached at                   | A record is written                                                                                                                                                                                                                          | Required next action                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture refused         | Stage 1, 2, or 3             | No, and never partially                                                                                                                                                                                                                      | Correct the input the refusal named and capture again. No record exists to act on, and nothing is left behind to clean up.                                                                                                                                                                                                                                                                                      |
| Nothing to capture      | Stage 1, automatic path only | No, and this is reported as success rather than as a refusal                                                                                                                                                                                 | None required — the reviewer published nothing on the head that was checked. Capture again after the reviewer reviews a later head, or use manual entry if the finding was raised elsewhere.                                                                                                                                                                                                                    |
| Record written          | Stage 4                      | Yes, with the stale marker set or not per the table above                                                                                                                                                                                    | Adjudicate the verdict and choose the follow-up **when either is still at its default** of Unadjudicated or Undecided. None required when the capture supplied both, because the record already carries a judgement.                                                                                                                                                                                            |
| Record updated in place | Stage 4                      | Yes, replacing that record's evidence fields for that identity and head and re-evaluating the stale marker, while preserving any existing verdict, follow-up, and rationale per the merge rule above unless this capture supplies new values | Adjudicate whichever of the verdict and follow-up is **still at its default** of Unadjudicated or Undecided after the merge — an update preserves an existing judgement and may supply only one of the two, so one field can remain at its default. None required when both already carry a judgement. Either way, revise them through the adjudication action if the refreshed evidence changes the judgement. |

Mirror surfaces that must state the same four outcomes, the same stage order,
the stale marker's status as an attribute, and Stage 1's whole-capture scope
against Stages 2 through 4's per-finding scope: the capture command's own help
output and the committed review-quality runbook the operator follows.

---

## Statuses / Enum Values

### Verdict

| Code value       | Display label  | Description                                                                                       |
| ---------------- | -------------- | ------------------------------------------------------------------------------------------------- |
| `unadjudicated`  | Unadjudicated  | No human has judged this finding yet. Never counted as a confirmed Ronda miss.                    |
| `true_positive`  | True positive  | A real defect Ronda should have reported on the reviewed head. Counted as a confirmed Ronda miss. |
| `false_positive` | False positive | Not a real defect. Counted as external-reviewer noise Ronda correctly avoided.                    |
| `out_of_scope`   | Out of scope   | A real concern, but outside what Ronda is meant to review on the reviewed head.                   |
| `already_found`  | Already found  | Ronda already reported the same defect on the reviewed head, so it is not a miss.                 |

**Valid transitions** — these describe the **adjudication action** of Use Case 3,
not a capture. A capture that supplies a verdict sets or replaces it under the
capture rules, which never require a rationale:

- `unadjudicated` → `true_positive`, `false_positive`, `out_of_scope`, or
  `already_found` when the operator records a verdict through adjudication,
  supplying a rationale.
- Any verdict → any **other non-default** verdict when the operator revises it
  through adjudication, supplying a rationale. Adjudication never sets a verdict
  back to `unadjudicated`: once a human has judged a finding, that judgement is
  revised, never withdrawn back to no judgement, which is what keeps a record
  ineligible for deletion once a human has acted on it.
- Any verdict → any other verdict, with no rationale required, when a capture
  supplies a different verdict for that record. This too never sets a verdict to
  `unadjudicated` — a capture only ever supplies one of the four judged values.

### Intended follow-up

| Code value      | Display label | Description                                                                                 |
| --------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `undecided`     | Undecided     | The follow-up has not been chosen yet.                                                      |
| `eval_record`   | Eval record   | Becomes a seeded quality fixture so future Ronda versions are measured against this defect. |
| `prompt_change` | Prompt change | Becomes a change to Ronda's reviewer prompts or review modes.                               |
| `backlog_item`  | Backlog item  | Becomes tracked work larger than a prompt change.                                           |
| `no_action`     | No action     | Deliberately not acted on. When the operator records a rationale, it explains why.          |

**Valid transitions** — as with the verdict, these describe the **adjudication
action**, not a capture:

- `undecided` → `eval_record`, `prompt_change`, `backlog_item`, or `no_action`
  when the operator chooses the follow-up through adjudication, supplying a
  rationale.
- Any follow-up → any **other non-default** follow-up when the operator revises
  it through adjudication, supplying a rationale. Adjudication never sets a
  follow-up back to `undecided`, symmetrically with the verdict rule above.
- Any follow-up → any other follow-up, with no rationale required, when a
  capture supplies a different follow-up for that record. This too never sets a
  follow-up to `undecided` — a capture only ever supplies one of the four chosen
  values.

### Affected category

| Code value        | Display label   | Description                                                                                             |
| ----------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| `durability`      | Durability      | State or work is lost when a process stops, restarts, or crashes.                                       |
| `idempotency`     | Idempotency     | Repeating the same operation produces duplicate or conflicting effects.                                 |
| `retries`         | Retries         | Retry behavior is missing, unbounded, or retries something unsafe to repeat.                            |
| `timeouts`        | Timeouts        | A deadline is missing, unenforced, or leaves work running past its budget.                              |
| `partial_success` | Partial success | A partly completed operation leaves inconsistent or unreported state.                                   |
| `concurrency`     | Concurrency     | Concurrent or out-of-order execution produces a wrong result.                                           |
| `security`        | Security        | Secret handling, authentication, authorization, or input trust is wrong.                                |
| `correctness`     | Correctness     | Ordinary logic produces a wrong result outside the categories above.                                    |
| `configuration`   | Configuration   | Configuration, defaults, or environment handling is wrong or unsafe.                                    |
| `observability`   | Observability   | An operator cannot tell what happened from logs, status, or published evidence.                         |
| `other`           | Other           | A real category not covered above. When the operator records a rationale, it names the actual category. |

### Capture source

| Code value  | Display label | Description                                                         |
| ----------- | ------------- | ------------------------------------------------------------------- |
| `automatic` | Automatic     | The finding was read from the pull request by the capture workflow. |
| `manual`    | Manual        | The operator supplied the finding details directly.                 |

---

## Operational Visibility

- **Capture output**: What a capture can report depends on which outcome it
  reached, because a refusal may not have resolved the values a success reports.
  A capture carrying several findings reports each finding's own outcome, so a
  finding refused at Stage 2 or Stage 3 never withholds the written or updated
  location already resolved for the capture's other findings:
  - A capture that wrote or updated records states the pull request, the reviewed
    head, the Ronda result head, the external reviewer, how many records were
    written and how many updated, and where each one was written.
  - A capture that reached "nothing to capture" states the pull request, the head
    it checked, and that the reviewer published nothing on it. No record location
    is reported, because none was written.
  - A refused capture reports only what it had resolved before refusing, and
    never claims a head, reviewer, or record location it could not resolve. Its
    required content is the refusal reason below. A Stage 2 or Stage 3 refusal
    reports this per finding, alongside the outcome of every other finding in the
    same capture; only a Stage 1 refusal leaves the whole capture with nothing
    else to report.
- **Refusals and skips**: A refused capture states which rule refused it, so the
  operator can correct and retry. Every refusal rule in this spec is reportable,
  and the list is closed: an unresolvable pull request or head, no reviewer named,
  no Ronda result on any head, a named reviewer with no readable presence anywhere
  on the pull request — including a reviewer automatic reading does not support —
  reviewer output that cannot be interpreted, a missing required
  input, an affected category outside the closed set, a supplied verdict or
  intended follow-up outside its documented values, a supplied reviewed head that
  is malformed or was never a head of that pull request, credential-shaped
  content in any scanned field, and source or diff content in any free-text
  field the record would store.
  A credential refusal also names the matched form. This is the list the gate
  means when it tells the operator to correct "the input the refusal named", and
  it is written in **precedence order**: when more than one entry applies to the
  same capture or finding, the reported reason is the first applicable entry in
  this list. The reason an operator sees is therefore determinate — it is
  observable output, not an internal ordering, which is why the spec fixes it
  here rather than deferring it to the plan.
- **Adjudication refusals**: A refused adjudication likewise states which rule
  refused it — a missing rationale, an invalid verdict or intended follow-up
  value, a credential-shaped rationale, or a rationale carrying source or diff
  content — and names the matched form for the credential case. When more than one
  applies at once, the adjudication is refused either way and the record is left
  unchanged, and the reported reason is the first applicable of those four,
  which are listed in precedence order.
- **Stale evidence**: A record written from heads that do not match states that
  it is stale evidence, and names both heads.
- **Unresolvable evidence**: A record read while its Ronda result head names a
  Ronda review that cannot be resolved states that it is unresolvable evidence
  for that read, counted under no verdict outcome, rather than being silently
  omitted from the read.
- **Truncation**: A record whose finding text was truncated says so on the
  record, so nobody reads a truncated finding as the reviewer's full comment.
- **Deletion**: A deletion reports whether it succeeded or was refused. A
  refusal states that the record carries a verdict or intended follow-up a
  human has already set, directing the operator to the adjudication action
  instead of deletion.
- **Audit trail**: Records are committed review-quality evidence, so the
  repository history shows when each record was captured, when a verdict or
  follow-up changed, and when a record was deleted.

---

## Acceptance Criteria

- [ ] AC1: Given a pull request whose current head has both a Ronda result and an
      external reviewer finding, when the operator runs a capture for that pull
      request and reviewer, then a miss record is written that names the pull
      request, the reviewed head, the Ronda result head, the external reviewer,
      the finding location, the finding title, the finding text, the verdict, the
      affected category, the intended follow-up, and the capture source.
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
- [ ] AC5: Given a captured record, when the operator adjudicates it — using the
      Use Case 3 action, not a capture — by setting its verdict to True positive,
      False positive, Out of scope, or Already found and setting its intended
      follow-up to Eval record, Prompt change, Backlog item, or No action, then
      both values are stored on the record together with the operator's
      rationale. Given that the operator sets **only one** of the two **and
      supplies a rationale**, then that one is stored with the rationale and the
      other keeps its current value: a single-field adjudication succeeds, and is
      neither refused for being partial nor treated as implying the other field.
      Given instead an adjudication that sets one field or both **with no
      rationale at all**, then it is refused and the record is left unchanged —
      the refusal is for the missing rationale, never for the adjudication being
      partial.
- [ ] AC6: Given **non-stale, resolvable** records with each verdict, when
      captured misses are read as review-quality evidence, then True positive
      records are reported as a Ronda miss, False positive records are reported
      as Ronda better signal, and Out of scope, Already found, and Unadjudicated
      records are not reported as confirmed misses. Given instead a record
      carrying the stale-evidence marker, then it is reported as stale evidence
      and counted under no verdict outcome, whatever its verdict, until it is
      re-captured on a shared head. Given instead a record whose Ronda review is
      unresolvable at read time, then it is reported as unresolvable evidence
      and counted under no verdict outcome, whatever its verdict, per AC48.
- [ ] AC7: Given captured miss records with each verdict, when they are read
      together with Ronda's existing review comparison evidence, then each
      verdict is reported under the mapping in Reported Evidence Mapping, the
      five outcome counts the existing quality summary already reports keep their
      current meaning — including the clean-agreement count, which no captured
      miss record adds to, subtracts from, or reclassifies — and the
      out-of-scope count, the affected-category breakdown, the stale-evidence
      count, and the unresolvable-evidence count are reported as additions
      rather than by redefining any of those five outcomes.
- [ ] AC8: Given an external finding whose reviewed head differs from the Ronda
      result head, when the operator captures it, then the record names both heads,
      labelling which is the reviewed head and which the Ronda result head, carries
      the stale-evidence marker, and is not counted as a confirmed miss. Given that
      the same stale finding is then captured again on the same reviewed head, then
      its existing record is updated in place and no duplicate record is created,
      because only the reviewed head participates in identity.
- [ ] AC9: Given credential-shaped content such as an access token, private key,
      or password assignment placed in the finding text, the finding title, the
      finding location, the reviewer name, or the supplied reviewed head —
      including a title the workflow derived rather than one the reviewer
      published — when the operator captures it, then the capture is refused for
      each of those fields independently, no record is written, and the refusal
      names the field and the rule that refused it. This does not apply when the
      matched value equals a published placeholder literal, which AC18 requires to
      be accepted.
- [ ] AC10: Given a captured record, when the record is inspected, then it
      contains the external reviewer's finding text and the location it points at,
      and carries no more of the reviewed source file's contents or the pull
      request's diff than the short quoted excerpt AC38 permits — never a diff
      hunk, and never more than five consecutive matching lines. Given instead a
      finding any of whose stored free-text fields — reviewer name, supplied
      reviewed head, finding location, finding title, or finding text — carries
      source or diff content beyond that permitted excerpt, then the capture is
      refused for each of those fields independently, nothing is stored, and the
      refusal names which field carried it — so the guarantee is reached by
      refusing such input, never by trimming it after the fact.
- [ ] AC11: Given a credential-free external finding whose text exceeds 2,000
      characters, when the operator captures it, then the stored finding text is
      truncated to 2,000 characters and the record states that truncation
      happened. Given instead that the text carries credential-shaped content
      beyond the 2,000-character boundary, then the capture is refused rather than
      truncated, because scanning precedes truncation.
- [ ] AC12: Given a record that already exists for a finding on a reviewed head,
      when the operator captures a finding matching all six identity values —
      same pull request, external reviewer, reviewed head, finding location,
      finding title, and finding text — then the existing record is updated in
      place and no second record for that finding and head exists. This holds
      when the second capture is manual and the first was automatic.
- [ ] AC13: Given an affected category outside the documented closed set, when
      the operator captures a finding with it, then the capture is refused and the
      refusal names the accepted categories.
- [ ] AC14: Given the capture workflow, when an operator follows the committed
      review-quality runbook, then the runbook states the four gate stages in
      order, the evaluation order within Stage 1 and Stage 2, all four capture
      outcomes — capture refused, nothing to capture, record written, and record
      updated in place — that stale evidence is a record attribute rather
      than an outcome, that Stage 1 refuses the whole capture while Stages 2 and 3
      refuse only the affected finding — Stage 4 never refuses, reaching only
      "record written" or "record updated in place" — and matches the capture
      command's own help output.
- [ ] AC15: Given a record that already exists for a finding on a reviewed head,
      when the operator captures a finding whose finding location, finding
      title, or finding text differs from it after canonical comparison, then a
      second, separate record is written rather than the first being
      overwritten.
- [ ] AC16: Given that the named external reviewer is the Codex GitHub reviewer
      automatic reading supports, and it has published on the pull request but
      nothing on its current head, when the operator runs an
      **automatic** capture,
      then no record is written, the result is reported as success with nothing to
      capture, and the head that was checked is named.
- [ ] AC17: Given a pull request that cannot be resolved or a capture with no
      reviewer named, when the operator runs a capture on **either** path, then the
      capture is refused, no record and no partial record is written, and the
      refusal names which condition applied. Given a named reviewer with no
      presence anywhere on the pull request, or a reviewer automatic reading does
      not support, or reviewer output on the current head that cannot be
      interpreted as findings, when the operator runs an
      **automatic** capture, then the capture is likewise refused. A reviewer
      present on the pull request but silent on the current head is AC16's success
      case, not a refusal.
- [ ] AC18: Given finding text in which a credential would otherwise be
      recognised but whose value equals a literal on the published placeholder
      list, such as `REDACTED`, `example`, or `changeme`, when the operator
      captures it, then the capture is **not** refused and the record is written.
      Given instead a value that matches a refusal form and is not equal to any
      listed literal — including a value that merely resembles a placeholder, such
      as a run of one repeated character — then the capture **is** refused,
      because the placeholder list holds whole literal values only and admits no
      pattern or length rule.
- [ ] AC19: Given a manually supplied finding that omits any one of the required
      inputs — the external reviewer, the finding location, the finding text, or
      the affected category — when the operator captures it, then the capture is
      refused, no record is written, and the refusal names the missing input.
- [ ] AC20: Given an external finding for which the reviewer published no distinct
      title, when the operator captures it, then the record's finding title is the
      first non-blank line of the finding text, trimmed of surrounding whitespace
      and truncated to 120 characters, and the same derivation applies when the
      operator supplies no title in manual entry.
- [ ] AC21: Given a manually supplied finding that omits only derived or defaulted
      fields — the finding title, the verdict, or the intended follow-up — when
      the operator captures it, then the capture is **not** refused and the title
      is derived. Given that no record yet exists for the finding's identity, then
      the new record's verdict is Unadjudicated and its intended follow-up is
      Undecided. Given instead that a record already exists for that identity,
      then the omitted verdict and intended follow-up keep the record's existing
      values under the merge rule, as AC29 states.
- [ ] AC22: Given a resolved pull request for which Ronda has published no review
      result on any head, when the operator captures a finding against it on either
      path, then the capture is refused and no record is written. Given instead that
      Ronda has published a result on a head other than the finding's reviewed head,
      then the capture is **not** refused and the record is written carrying the
      stale-evidence marker.
- [ ] AC23: Given a same-head, credential-free finding whose affected category is
      outside the closed set or whose required inputs are incomplete, when the
      operator captures it, then the capture is refused at gate Stage 2 and no
      record is written, even though Stage 4's head and existing-record inputs
      would otherwise have written one.
- [ ] AC24: Given two or more Stage 1 or Stage 2 conditions failing at once, when
      the operator runs a capture, then the reported condition is the
      lowest-numbered failing condition that **applies to the capture path in
      use** — so a manual capture never reports condition 4, 5, or 6.
- [ ] AC25: Given a finding whose location is present but cannot be resolved to a
      file and a line, when the operator captures it, then the capture is **not**
      refused: the record stores the location as given, marks it unresolved, and
      uses all six identity values so a second finding whose location text,
      title, or finding text differs after canonical comparison remains a
      separate record. Given instead a finding with no location at all, then the
      capture is refused.
- [ ] AC26: Given a capture in which the operator supplies a verdict, an intended
      follow-up, or both but no rationale, when the capture runs, then the capture
      is **not** refused: the record is written with the supplied values and no
      rationale. Given that the operator later revises either value on that
      record through the Use Case 3 adjudication action without a rationale, then
      only that revision is refused and the record is left unchanged. Given
      instead that a further capture reaches Stage 4's "Record updated in place"
      for that same finding identity and head and supplies a verdict, a
      follow-up, or both that **match** what the record already carries, or
      supplies neither, then that capture is **not** refused: the record is
      updated and the existing rationale is **preserved**, matching the merge
      rule. Given instead that such a capture supplies a verdict or follow-up
      that **differs** from what the record already carries, then that capture
      is likewise **not** refused, but the changed field is replaced and the
      existing rationale is **cleared**, per AC43.
- [ ] AC27: Given a finding that automatic reading cannot return — because the
      named reviewer has no presence on the pull request, or is a reviewer
      automatic reading does not support, or published output that cannot be
      interpreted, or raised the finding outside the pull request — when
      the operator supplies it through manual entry against a resolvable pull
      request with a Ronda result, every required input, and a category from the
      closed set, then the capture is **not** refused and the record is written.
      Conditions 4, 5, and 6 are not evaluated on the manual path.
- [ ] AC28: Given an existing record and an adjudication that supplies a rationale
      containing credential-shaped content, when the operator applies it, then the
      rationale is refused, the refusal names the matched form, the verdict and
      intended follow-up are unchanged, and the record is left as it was. This
      refusal reads differently from AC5's no-rationale-supplied refusal, which
      names a missing rationale rather than a matched credential form.
- [ ] AC29: Given an existing record carrying a human verdict, intended follow-up,
      and rationale, when a re-capture of that same finding supplies none of those
      values, then the record's evidence fields are replaced and the verdict,
      follow-up, and rationale are preserved unchanged. Given instead that the
      re-capture supplies the **same** verdict the record already carries, then
      the outcome is identical: the verdict, follow-up, and rationale are all
      preserved unchanged, per AC43.
- [ ] AC30: Given the same finding entered twice — once read automatically and once
      supplied manually, differing only in how the reviewer was named, how the
      commit identifier was abbreviated, and in letter case and surrounding
      whitespace in the location, title, and finding text — when both captures
      run, then exactly one record exists, and it stores the external reviewer,
      location, title, and finding text as its most recent source gave them.
- [ ] AC31: Given a manual capture supplying a reviewed head that is malformed or
      that names a commit which was never a head of the referenced pull request,
      when the capture runs, then it is refused and no record is written.
- [ ] AC32: Given a **credential-free** adjudication rationale, carrying no source
      or diff content, that exceeds 2,000 characters, when the operator applies it,
      then the stored rationale is truncated to 2,000 characters and the record
      states that truncation happened, and the verdict and follow-up change as
      asked. Given instead that such a rationale carries credential-shaped content
      anywhere, including beyond the 2,000-character boundary, then AC28's refusal
      applies and nothing is stored, because scanning precedes truncation here
      exactly as it does for the finding text. Given instead a rationale carrying the
      reviewed source file's contents or the pull request's diff, then the whole
      adjudication is **refused**: nothing is stored, the verdict and follow-up are
      unchanged, and the refusal says the rationale carried source or diff
      content. Refusing rather than silently sanitising keeps the operator aware
      that their text was rejected.
- [ ] AC33: Given a finding in which credential-shaped content appears in more than
      one scanned field, when the operator captures it, then the capture is refused
      once, no record is written, and the refusal names one matched field and the
      form it matched so the operator knows what to remove.
- [ ] AC34: Given a supplied verdict or intended follow-up that is not one of its
      documented values, when the operator captures the finding, then the capture
      is refused, no record is written, and the refusal names the accepted values
      for that field. An **omitted** verdict or follow-up is not a refusal: on a
      newly written record it takes its documented default, and on an update to
      an existing record it keeps that record's existing value under the merge
      rule, as AC21 and AC29 state. Given the same invalid value supplied through
      the Use Case 3 adjudication action instead, then the adjudication is refused,
      the record is left unchanged, and the refusal likewise names the accepted
      values.
- [ ] AC35: Given a capture carrying several findings of which one is refused at
      gate Stage 2 or Stage 3, when the capture runs, then only that finding is
      refused and the remaining findings are still written or updated, each with
      its own reported outcome. Given instead a Stage 1 refusal, then the whole
      capture is refused and no finding is written.
- [ ] AC36: Given a record marked stale because Ronda had published no result for
      its reviewed head, when Ronda later publishes a result for that same reviewed
      head and the operator re-captures the finding, then the record's Ronda result
      head resolves to its reviewed head, the stale marker is cleared, and the
      record becomes eligible for the Reported Evidence Mapping.
- [ ] AC37: Given a pull request whose heads were pushed in the order A, B, C,
      with Ronda results published for A and B but not for C, where the result
      for A was published after the result for B, when the operator captures a finding
      whose reviewed head is C, then the record's Ronda result head is B, because
      B was pushed after A, and the record carries the stale-evidence marker
      naming C and B.
- [ ] AC38: Given a finding text that quotes five consecutive non-blank lines
      from a file the pull request changes at the reviewed head, when the operator
      captures it, then the capture is **not** refused for source or diff content.
      Given instead a finding text quoting six such consecutive lines, or one
      containing a line beginning `@@`, a line beginning `diff --git`, or a line
      beginning `--- ` immediately followed by a line beginning `+++ `, then the
      capture is refused and the refusal names the finding text as carrying source
      or diff content. The same thresholds apply to every other stored free-text
      field and to an adjudication rationale.
- [ ] AC49: Given a finding text containing the same hunk marker as AC38, but
      formatted as a Markdown block quote (`> @@ ...`) or indented as a code
      block, when the operator captures it, then the capture is refused for
      carrying source or diff content exactly as the unquoted, unindented form
      is, because the marker check strips leading block-quote markers and
      whitespace before matching.
- [ ] AC50: Given a finding text quoting six consecutive non-blank lines from a
      file the pull request changes at the reviewed head, each line formatted
      as a Markdown block quote (`> ...`) or indented as a code block, when the
      operator captures it, then the capture is refused for carrying source or
      diff content exactly as the unquoted, unindented form is, because the
      five-consecutive-lines comparison strips leading block-quote markers and
      whitespace before matching, the same way the marker check does for
      AC49.
- [ ] AC39: Given a finding captured automatically from
      `chatgpt-codex-connector[bot]`, when the same finding on the same reviewed
      head is then captured manually naming the reviewer as `Codex`, then exactly
      one record exists. Given instead that the manual capture names the reviewer
      as `Codex Bot`, which is not on the alias list, then a second, separate
      record is written.
- [ ] AC40: Given the same commit as the current head of two different pull
      requests, when the operator captures the same reviewer's finding at the
      same location and title on both pull requests, then two separate records
      are written, one per pull request, because the pull request is one of the
      six identity values.
- [ ] AC41: Given the same reviewer reporting two distinct findings at the same
      location with the same title on the same pull request and reviewed head,
      when the operator captures both, then two separate records are written,
      because their finding text differs and finding text is one of the six
      identity values. Given instead that a second capture of the same finding
      supplies finding text differing only by letter case or surrounding
      whitespace, then the existing record is updated in place rather than a
      second one being written.
- [ ] AC42: Given an existing record whose affected category was captured
      incorrectly, when the operator re-captures the same finding supplying the
      corrected category, then the existing record is updated in place and its
      stored affected category is replaced with the corrected value, with no
      rationale needed, because the affected category is an evidence field, not
      a judgement.
- [ ] AC43: Given an existing record carrying a human verdict and a rationale
      that explains it, when a further capture of that same finding supplies a
      **different** verdict, then the record's verdict is replaced with the
      newly supplied value and the existing rationale is **cleared**, so the
      record never pairs a stored rationale with a judgement it no longer
      explains. This holds symmetrically for the intended follow-up and its
      rationale. Given instead that the further capture leaves **both** the
      verdict and the intended follow-up unchanged from what the record already
      carries — whether by omitting them, by supplying the same values, or any
      combination of the two — then the rationale is **preserved** unchanged.
- [ ] AC44: Given a record whose verdict is Unadjudicated and whose intended
      follow-up is Undecided, when the operator deletes it, then the record is
      removed from the committed evidence, and a later capture of the same
      finding identity writes a new record rather than finding an existing one
      to update.
- [ ] AC45: Given a record whose verdict is not Unadjudicated, or whose intended
      follow-up is not Undecided, when the operator attempts to delete it, then
      the deletion is refused, the record is left unchanged, and the refusal
      directs the operator to the adjudication action instead.
- [ ] AC46: Given an automatic capture in which the workflow asks the operator
      to supply the affected category, when the operator supplies none, then the
      capture is refused under Missing And Unreadable Input condition 7, exactly
      as an omitted category refuses manual entry.
- [ ] AC47: Given a record carrying a human-set verdict, an intended follow-up,
      or both, when the operator adjudicates either field again, then the new
      value is never Unadjudicated or Undecided respectively — adjudication
      revises a judgement, it never withdraws one back to no judgement — so a
      record a human has judged can never satisfy AC44's deletion condition
      again.
- [ ] AC48: Given a captured **non-stale** miss record whose Ronda result head
      names a Ronda review that can no longer be resolved, when captured misses
      are read alongside existing quality evidence, then the record is reported
      as unresolvable evidence, counted under no verdict outcome. Given that a
      later read finds that same Ronda review resolvable again, then the record
      is reported under its ordinary mapping outcome on that read, with no
      re-capture required. Given instead a record already carrying the
      stale-evidence marker whose Ronda result head also names a Ronda review
      that cannot be resolved, then that read reports the record under **both**
      the stale-evidence and the unresolvable-evidence counts, not just one.
      Given that a later read then finds that same Ronda review resolvable
      again while the stale-evidence marker is still set, then the record is
      reported under stale evidence alone — the unresolvable-evidence count
      drops, but the record is **not** admitted to the verdict mapping and
      needs re-capture on a shared head to clear the stale marker, unlike the
      unresolvable-only case above.

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
- Automatically reading findings from external reviewers other than the Codex
  GitHub reviewer, which is the one reviewer automatic capture supports. Naming
  another reviewer on the automatic path is refused under Stage 1 condition 4,
  with the refusal directing the operator to manual entry, which accepts any
  reviewer name. Adding a second automatically read reviewer is out of scope for
  this iteration.
- Capturing findings from repositories the operator cannot read with their
  existing GitHub access. No new credential or permission is introduced.
- Any change to Ronda's own review behavior, its one-review-per-head contract,
  or its published check run.

---

## Deferred To The Implementation Plan

These are deliberately left to the implementation plan rather than fixed here,
because they have no product-visible consequence and pinning them in a product
contract would state design rather than requirements. The plan must specify each
one; the spec states only the guarantee it must deliver.

| Deferred decision                                                                                                     | The guarantee the spec requires                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How the six identity values are compared so that meaningless differences are ignored                                  | The same finding entered two ways is one record, storing the external reviewer, location, title, and finding text as the most recent source gave them, never normalised (AC30)     |
| Whether captured misses reach the existing quality evidence by extending the shared contract or by projecting into it | The five existing outcome counts keep their meaning; out-of-scope counts, category breakdowns, the stale-evidence count, and the unresolvable-evidence count are additive (AC7)    |
| The exact contents of the published credential refusal list and placeholder list                                      | Both are published and versioned with the workflow, the refusal list recognises at least the six named forms, and the placeholder list holds whole literal values only (AC9, AC18) |

## Brief Coverage Matrix

| Brief objective                                                                                     | Covered by                                                                       |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Repeatable workflow for recording external-review findings Ronda missed                             | Use Cases 1-3, AC1, AC3, AC14, AC27                                              |
| Record includes the pull request                                                                    | AC1, AC40                                                                        |
| Record includes the head SHA                                                                        | AC1, AC8, AC22, AC31, AC36, AC37                                                 |
| Record includes the reviewer                                                                        | AC1, AC3, AC39                                                                   |
| Record includes the finding text                                                                    | AC1, AC10, AC11, AC30, AC41                                                      |
| Record includes the finding location, resolvable or not                                             | AC1, AC25                                                                        |
| Record includes the finding title used for finding identity                                         | AC1, AC3, AC12, AC15, AC20, AC30, AC41                                           |
| A repeatable workflow handles missing, empty, and unreadable input                                  | AC16, AC17, AC19, AC21, AC22, AC24, AC27, AC35, and Missing And Unreadable Input |
| Record includes the adjudication                                                                    | AC1, AC4, AC5, AC6, AC26, AC29, AC34, AC43                                       |
| Record includes the affected category                                                               | AC1, AC13, AC23, AC42                                                            |
| Record states whether it becomes an eval, prompt change, or backlog item                            | AC5, and the Intended follow-up enum                                             |
| A command or documented workflow captures a Codex GitHub finding from a PR into a structured record | Use Case 1, AC1, AC14, and the capture source field                              |
| Records preserve current-head evidence                                                              | AC1, AC8                                                                         |
| Records distinguish true positives, false positives, and out-of-scope findings                      | AC5, AC6, AC7, and the Verdict enum                                              |
| Captured misses can feed the existing review comparison / quality summary tooling                   | Use Case 4, AC6, AC7, and Reported Evidence Mapping                              |
| The workflow avoids storing secrets or full sensitive patches unnecessarily                         | AC9, AC10, AC11, AC18, AC28, AC32, AC33, AC38, AC49, AC50                        |

No brief objective is deferred to Out of Scope, so there are no deferral notes.
