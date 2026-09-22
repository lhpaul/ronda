# #53 planted-violation proof record (sensitive-content guards)

Recorded for PR #98 / issue #53. Each proof names a concrete assertion, plant
location, failing run, and restored passing run (REVIEW.md Pass 2).

## P1 — credential form refusal (AC9)

- **Assertion:** `validateCaptureFields` / `findCredentialMatch` refuses
  `password = "..."` assignments with non-placeholder values.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts:203`
  (planted `password = "s3cret-value"` in `validateCaptureFields`).
- **Fail run:** `npm test -- tests/unit/quality/miss-content-validator.test.ts`
  with plant present → `credential` refusal kind.
- **Pass run:** same test block lines 208–213 (clean text) → `null` refusal;
  full file passes in CI.

## P2 — diff-marker refusal (AC38)

- **Assertion:** finding text containing `@@` hunk markers is refused.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts:216-222`
  (`@@ -1,3 +1,4 @@` in finding text).
- **Fail run:** isolated validator test → `diff_marker`.
- **Pass run:** lines 227–232 clean text → `null`.

## P3 — six-line source excerpt refusal (AC50)

- **Assertion:** six consecutive corpus lines in finding text are refused; five
  are not. Blank lines in the corpus break consecutiveness (do not collapse).
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts:236-242`
  (six planted lines); corpus blank-boundary coverage at lines 124–147.
- **Fail run:** → `source_excerpt`.
- **Pass run:** lines 243–248 (five lines) → `null`; corpus-blank case → `false`.

## P4 — CLI capture boundary (integration)

- **Assertion:** manual capture refuses credential/diff/source plants before
  write; clean input writes exactly one record. Also covers bearer headers and
  mixed placeholder-then-real secret assignments, and refuses malformed `--pr`.
- **Plant location:** `tests/unit/cli/capture-external-review-misses.test.ts:454-635`
  (`CLI planted-violation fail-then-pass` test); malformed `--pr` at 409–441.
- **Fail run:** each plant → exit `1` / throw, zero files in miss dir.
- **Pass run:** remove plant → `OUTCOME=record_written`, one JSON record.

## P5 — authorization bearer (AC9)

- **Assertion:** non-placeholder `Authorization: Bearer …` values are refused;
  published placeholders are accepted; a placeholder must not hide a later real
  bearer token.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts:39-48`
  and CLI plant at `capture-external-review-misses.test.ts:541-558`.
- **Fail run:** real bearer → `authorization_bearer` / capture refused.
- **Pass run:** `Bearer REDACTED` → `null` / record written.

## P6 — mixed placeholder then real secret assignment (AC9)

- **Assertion:** after matching `password=REDACTED`, later non-placeholder
  assignments in the same text are still refused.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts:62-65`
  and CLI plant at `capture-external-review-misses.test.ts:564-577`.
- **Fail run:** `password=REDACTED password=supersecret…` → `secret_assignment`.
- **Pass run:** `password=REDACTED` alone → `null` / record written.
