# Refutation-marker dedupe — offline measurement (#174)

Offline only: no model call, no GitHub write, no credential used.

## What changed

Ronda skips a finding only when a maintainer explicitly refuted the same
claim on the same code:

- **Marker.** Every inline comment whose cited code Ronda could read ends with
  a hidden HTML comment, `<!-- ronda:finding v1 claim=<sha256> code=<sha256> -->`.
  `claim` hashes the normalized title (lowercase, non-alphanumeric runs
  collapsed to one space). `code` hashes the cited line plus ten lines on each
  side in the file at the reviewed head, and the cited line's offset.
- **Refutation.** A resolved thread whose first comment is bot-authored and
  carries a valid marker, with a later reply whose first line is exactly
  `/ronda refuted` from an `OWNER`, `MEMBER`, or `COLLABORATOR`.
- **Suppression.** A new finding is dropped only when its path, claim hash,
  and code hash (recomputed at the new head) all match a refutation.
- **Fail open.** No thread reader, a failed thread read, an unreadable file, a
  finding without a line, or any inexact match keeps the finding.

Each suppression is counted in the review summary and logged as
`findings_suppressed` with reason `refuted_by_maintainer`, counts only.

## Measurement

The fixture (`tests/fixtures/refutation-marker-174.ts`) reproduces the case
that made #158 drop resolved-thread dedupe: an ownership guard on line 26
above a protected write on line 30. The refuted thread's root is the inline
comment Ronda itself publishes on the guarded head, read back from a first
pass. "Before" is a port without a thread reader (behaviour on `develop`
after #158); "after" reads the fixture threads.

| Case | Before | After |
| --- | --- | --- |
| Refuted, unchanged code | published | not published |
| Refuted, title differs only in case/punctuation | published | not published |
| Refuted, change outside the ±10-line window | published | not published |
| Fixed then regressed (resolved, no refutation reply) | published | published |
| Refuted, guard removed inside the window (write line unchanged) | published | published |
| Refutation reply by a `CONTRIBUTOR` | published | published |
| Different claim on the refuted line | published | published |
| **Total published** | **7** | **4** |

Reproduce: `npm test` (`tests/unit/core/run-review-pass-refutation.test.ts`,
the AC7 test; `tests/unit/review/refutation-marker.test.ts`).

## Limits

- The window is ten lines on each side. A security-relevant change further
  away from the cited line (a guard removed in another function or file)
  does not expire a refutation. A maintainer had to refute that exact claim
  explicitly first, and the summary always states the count.
- Only exact normalized titles match. A reworded claim is published again.
- Comments past the first 100 in a thread, and threads past 5,000, are not
  read; this can only miss a refutation.
- The fixture is a reproduction. Confirming on a live pull request needs a
  live pass and is left to a maintainer.
