# #53 planted-violation proof record (sensitive-content guards)

Recorded for PR #98 / issue #53. Each proof names a concrete assertion, plant
location, **executed** fail command, and restored passing run (REVIEW.md Pass 2).

## Executed suite (same PR)

```bash
node --import tsx --test --test-name-pattern='validator planted-violation|CLI planted-violation|AC37 ordinary|AC35 count-mismatched|review-body findings capture|malformed --pr|blank lines in corpus' \
  tests/unit/quality/miss-content-validator.test.ts \
  tests/unit/cli/capture-external-review-misses.test.ts \
  tests/unit/quality/miss-github-evidence.test.ts \
  tests/unit/quality/miss-capture-gate.test.ts
```

Result on this branch tip: **7 pass / 0 fail** (re-run locally or in CI to refresh).

## P1 — credential form refusal (AC9)

- **Assertion:** `validateCaptureFields` / `findCredentialMatch` refuses
  `password = "..."` assignments with non-placeholder values.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts:203`
- **Fail evidence:** plant present → `credential` kind (test asserts).
- **Pass evidence:** clean text → `null` (same test, lines 208–213).

## P2 — diff-marker refusal (AC38)

- **Assertion:** finding text containing `@@` hunk markers is refused.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts:216-222`
- **Fail evidence:** → `diff_marker`.
- **Pass evidence:** lines 227–232 clean text → `null`.

## P3 — six-line source excerpt refusal (AC50)

- **Assertion:** six consecutive corpus lines refused; five not. Blank lines in
  the corpus break consecutiveness (do not collapse).
- **Plant location:** six-line plant at
  `miss-content-validator.test.ts:236-242`; corpus blank-boundary at 124–147.
- **Fail evidence:** → `source_excerpt` / `hasExcessiveSourceExcerpt === true`.
- **Pass evidence:** five lines → `null`; blank-separated corpus → `false`.

## P4 — CLI capture boundary (integration)

- **Assertion:** manual capture refuses credential / bearer / mixed-secret /
  diff / source plants before write; clean input writes one record; malformed
  `--pr` refused before GitHub.
- **Plant location:**
  `tests/unit/cli/capture-external-review-misses.test.ts:454-635`
  (CLI planted-violation); malformed `--pr` at 409–441.
- **Fail evidence:** plant → exit `1` / throw, zero files.
- **Pass evidence:** clean → `record_written`, one JSON file.

## P5 — authorization bearer (AC9)

- **Assertion:** non-placeholder Bearer refused; placeholder accepted; placeholder
  must not hide a later real bearer.
- **Plant location:** unit `miss-content-validator.test.ts:39-48`; CLI
  `capture-external-review-misses.test.ts:541-558`.
- **Fail / pass:** covered by the executed suite above.

## P6 — mixed placeholder then real secret assignment (AC9)

- **Assertion:** after `password=REDACTED`, later non-placeholder assignments
  still refuse.
- **Plant location:** unit `miss-content-validator.test.ts:62-65`; CLI
  `capture-external-review-misses.test.ts:564-577`.
- **Fail / pass:** covered by the executed suite above.

## P7 — push-order / review location / AC35 siblings

- **AC37 ordinary commits:** `miss-github-evidence.test.ts` —
  `AC37 ordinary linear commits provide push-order without force-push events`
- **Review body `path:line`:** `review-body findings capture path:line from interpretable text`
- **AC35 per-finding categories:** `AC35 count-mismatched categories refuse only uncovered findings`
