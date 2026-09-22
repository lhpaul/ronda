# #53 planted-violation proof record (sensitive-content guards)

Recorded for PR #98 / issue #53. Each proof names a concrete assertion, plant
location, failing run, and restored passing run (REVIEW.md Pass 2).

## P1 — secret_assignment (AC9)

- **Assertion:** `findCredentialMatch` refuses `password = "..."` assignments
  with non-placeholder values.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts`
  (`AC9 planted proof: secret_assignment` — `password = "s3cret-value"`).
- **Fail run:** that test with a non-placeholder assignment → `secret_assignment`.
- **Pass run:** same block with `password=REDACTED` → `null`.

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
  write; clean input writes exactly one record. Also covers malformed `--pr`.
- **Plant location:** `tests/unit/cli/capture-external-review-misses.test.ts:501-680`
  (`CLI planted-violation fail-then-pass`); malformed `--pr` at 456–487.
- **Fail run:** each plant → exit `1` / throw, zero files in miss dir.
- **Pass run:** remove plant → `OUTCOME=record_written`, one JSON record.

## P5 — authorization_bearer (AC9)

- **Assertion:** non-placeholder `Authorization: Bearer …` values are refused;
  published placeholders are accepted; a placeholder must not hide a later real
  bearer token.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts`
  (`AC9 planted proof: authorization_bearer`); CLI plant at
  `capture-external-review-misses.test.ts:587-607`.
- **Fail run:** real bearer → `authorization_bearer` / capture refused.
- **Pass run:** `Bearer REDACTED` → `null` / record written.

## P6 — mixed placeholder then real secret assignment (AC9)

- **Assertion:** after matching `password=REDACTED`, later non-placeholder
  assignments in the same text are still refused.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts`
  (`AC9 planted proof: secret_assignment` — mixed line); CLI plant at
  `capture-external-review-misses.test.ts:610-627`.
- **Fail run:** `password=REDACTED password=supersecret…` → `secret_assignment`.
- **Pass run:** `password=REDACTED` alone → `null` / record written.

## P7 — code_hosting_access_token (AC9)

- **Assertion:** GitHub-style `ghp_…` tokens are refused.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts`
  (`AC9 planted proof: code_hosting_access_token`).
- **Fail run:** planted `ghp_…` substring → `code_hosting_access_token`.
- **Pass run:** remove token-shaped substring → `null`.

## P8 — api_key (AC9)

- **Assertion:** `sk-…` / `sk-proj-…` key material and `OPENAI_API_KEY=…`
  prefixed assignments are refused.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts`
  (`AC9 planted proof: api_key`).
- **Fail run:** `sk-proj-…` or prefixed assignment → `api_key`.
- **Pass run:** prose without key-shaped tokens → `null`.

## P9 — private_key_block (AC9)

- **Assertion:** PEM private-key blocks are refused.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts`
  (`AC9 planted proof: private_key_block`).
- **Fail run:** BEGIN/END PRIVATE KEY block → `private_key_block`.
- **Pass run:** remove PEM block → `null`.

## P10 — cloud_access_key_identifier (AC9)

- **Assertion:** `AKIA…` / `ASIA…` cloud access-key identifiers are refused.
- **Plant location:** `tests/unit/quality/miss-content-validator.test.ts`
  (`AC9 planted proof: cloud_access_key_identifier`).
- **Fail run:** `AKIAIOSFODNN7EXAMPLE` → `cloud_access_key_identifier`.
- **Pass run:** remove identifier → `null`.

## P11 — multi-commit push head tips (AC31)

- **Assertion:** consecutive timeline `committed` events with the same author
  timestamp collapse to one PR head tip; intermediate SHAs are not known heads.
- **Plant location:** `tests/unit/quality/miss-github-evidence.test.ts`
  (`AC31 planted-violation fail-then-pass for multi-commit push tips` — `plantOrdered`
  simulates per-commit head acceptance).
- **Fail run:** same test block’s plant branch → `isKnownPullRequestHead(HEAD_B)` is
  `true` (wrong acceptance).
- **Pass run:** production grouping → ordered `[HEAD_C]` only and
  `isKnownPullRequestHead(HEAD_B)` is `false`.
