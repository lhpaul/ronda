# Refuted credential finding — offline measurement (#158)

Offline only: no model call, no GitHub write, no credential used.

## What changed

Two deterministic post-filters run on parsed findings, after the model call
and before classification and publication. Neither touches the prompt or the
default model, and both fail open.

1. **Named-credential filter** — drops a "credential exposed in a
   message/log/output" finding when the cited added/context line is a fixed
   string literal that only names a credential variable or config key: no
   interpolation, no concatenation, no format placeholder, and no
   credential-looking identifier outside the literal. A missing line, an
   unreadable patch, or any doubt keeps the finding.
2. **Resolved-thread dedupe** — drops a finding whose `(path, normalized
   claim)` matches the first comment of a review thread a maintainer already
   resolved. Line numbers are ignored (they shift every push); the claim
   matches on normalized title or ≥0.8 token overlap. The thread read is a
   best-effort GraphQL call; if it is unavailable the pass publishes as before.

Each suppression is logged as `findings_suppressed` with counts by reason
only — never finding text.

## Measurement

The #156 thread set is not committed, so the fixture
(`tests/fixtures/refuted-credential-finding-158.ts`) reproduces its shape: the
fixed "No model credential is configured" message, four shifting-wording
variants of the same claim at the same line, and one control that really
interpolates the key.

| Arm | Published findings | Refuted variants published | Real leak published |
| --- | --- | --- | --- |
| Before (no filters) | 5 | 4 | yes |
| After (named-credential filter) | 1 | 0 | yes |
| After, next push (resolved-thread dedupe on the control's claim) | 0 | 0 | no — by design, a maintainer resolved it |

Reproduce: `npm test` (`tests/unit/review/refuted-findings.test.ts`,
`tests/unit/core/run-review-pass-refuted-findings.test.ts`).

## Limits

- The fixture is a reproduction, not the live #156 thread set. A real-model
  confirmation needs a live pass and is left to a maintainer.
- Dedupe trusts the maintainer's resolution: a resolved thread suppresses the
  same claim on the same path for the rest of the PR, even if the code under it
  later changes.
