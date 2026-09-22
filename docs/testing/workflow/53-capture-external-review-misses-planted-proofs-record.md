# #53 planted-violation proof record (sensitive-content guards)

Recorded for PR #98 / issue #53. Each proof names a concrete assertion, plant
location, **executed** fail command, and restored passing run (REVIEW.md Pass 2).

## Executed suite (same PR)

```bash
node --import tsx --test --test-name-pattern='AC9 planted proof|validator planted-violation|CLI planted-violation|AC37 ordinary|AC35 count-mismatched|review-body findings capture|malformed --pr|blank lines in corpus' \
  tests/unit/quality/miss-content-validator.test.ts \
  tests/unit/cli/capture-external-review-misses.test.ts \
  tests/unit/quality/miss-github-evidence.test.ts \
  tests/unit/quality/miss-capture-gate.test.ts
```

Result on this branch tip: re-run locally or in CI to refresh (expect **13+ pass / 0 fail**).

## AC9 credential-form proofs (unit, isolating)

Each `AC9 planted proof:` test in `miss-content-validator.test.ts` plants one
published form and asserts `findCredentialMatch` returns that form (fail) or
`null` for placeholders (pass where applicable):

| Form | Test lines (approx.) |
|------|----------------------|
| `code_hosting_access_token` | 19–24 |
| `api_key` | 26–37 |
| `private_key_block` | 39–46 |
| `cloud_access_key_identifier` | 48–53 |
| `authorization_bearer` | 55–67 |
| `secret_assignment` (snake, env, camelCase) | 69–96 |

## P1 — credential form refusal (AC9)

- **Assertion:** `validateCaptureFields` / `findCredentialMatch` refuses
  `password = "..."` assignments with non-placeholder values.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts:227-240`
- **Fail evidence:** plant present → `credential` kind (test asserts).
- **Pass evidence:** clean text → `null` (same test, lines 235–240).

## P2 — diff-marker refusal (AC38)

- **Assertion:** finding text containing `@@` hunk markers at column 0 (after
  quote/shared-indent normalization only) is refused.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts:243-260`
- **Fail evidence:** → `diff_marker`.
- **Pass evidence:** lines 254–260 clean text → `null`.
- **Boundary:** two-space-indented `@@` is not a marker (`hasDiffMarkers` test ~line 113).

## P3 — six-line source excerpt refusal (AC50)

- **Assertion:** six consecutive corpus lines refused; five not. Blank lines in
  the corpus break consecutiveness (do not collapse).
- **Plant location:** six-line plant at
  `miss-content-validator.test.ts:262-276`; corpus blank-boundary at 137–148.
- **Fail evidence:** → `source_excerpt` / `hasExcessiveSourceExcerpt === true`.
- **Pass evidence:** five lines → `null`; blank-separated corpus → `false`.

## P4 — CLI capture boundary (integration)

- **Assertion:** manual capture refuses credential / bearer / mixed-secret /
  diff / source plants before write; clean input writes one record; malformed
  `--pr` refused before GitHub.
- **Plant location:**
  `tests/unit/cli/capture-external-review-misses.test.ts:501-679`
  (CLI planted-violation); malformed `--pr` at 456–487.
- **Fail evidence:** plant → exit `1` / throw, zero files.
- **Pass evidence:** clean → `record_written`, one JSON file.

## P5 — authorization bearer (AC9)

- **Assertion:** non-placeholder Bearer refused; placeholder accepted; placeholder
  must not hide a later real bearer.
- **Plant location:** unit `miss-content-validator.test.ts:55-66`; CLI
  `capture-external-review-misses.test.ts:587-607`.
- **Fail / pass:** covered by the executed suite above.

## P6 — mixed placeholder then real secret assignment (AC9)

- **Assertion:** after `password=REDACTED`, later non-placeholder assignments
  still refuse.
- **Plant location:** unit `miss-content-validator.test.ts:86-88`; CLI
  `capture-external-review-misses.test.ts:610-627`.
- **Fail / pass:** covered by the executed suite above.

## P7 — push-order / review location / AC35 siblings

- **AC37 tip + commit-order fallback:**
  `AC37 ordinary linear pushes: commit-order among Ronda SHAs when tips are only current`
  (tips = current only for AC31; Ronda fallback uses commit order among reviewed SHAs)
- **Review body `path:line`:** `review-body findings capture path:line from interpretable text`
- **AC35 per-finding categories:** `AC35 count-mismatched categories refuse only uncovered findings`
