# #53 planted-violation proof record (sensitive-content guards)

Recorded for PR #98 / issue #53. Each proof names a concrete assertion, plant
location, failing run, and restored passing run (REVIEW.md Pass 2).

## P1 — credential form refusal (AC9)

- **Assertion:** `validateCaptureFields` / `findCredentialMatch` refuses
  `password = "..."` assignments with non-placeholder values.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts:166-170`
  (planted `password = "s3cret-value"` in `validateCaptureFields`).
- **Fail run:** `npm test -- tests/unit/quality/miss-content-validator.test.ts`
  with plant present → `credential` refusal kind.
- **Pass run:** same test block lines 172-177 (clean text) → `null` refusal;
  full file passes in CI.

## P2 — diff-marker refusal (AC38)

- **Assertion:** finding text containing `@@` hunk markers is refused.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts:181-188`
  (`@@ -1,3 +1,4 @@` in finding text).
- **Fail run:** isolated validator test → `diff_marker`.
- **Pass run:** lines 191-196 clean text → `null`.

## P3 — six-line source excerpt refusal (AC50)

- **Assertion:** six consecutive corpus lines in finding text are refused; five
  are not.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts:200-206`
  (six planted lines).
- **Fail run:** → `source_excerpt`.
- **Pass run:** lines 207-212 (five lines) → `null`.

## P4 — CLI capture boundary (integration)

- **Assertion:** manual capture refuses credential/diff/source plants before
  write; clean input writes exactly one record.
- **Plant location:** `tests/unit/cli/capture-external-review-misses.test.ts:418-520`
  (`CLI planted-violation fail-then-pass` test).
- **Fail run:** each plant → `OUTCOME=capture_refused`, zero files in miss dir.
- **Pass run:** remove plant → `OUTCOME=record_written`, one JSON record.
