# Refuted credential finding — offline measurement (#158)

Offline only: no model call, no GitHub write, no credential used.

## What changed

Two deterministic post-filters run on parsed findings, after the model call
and before classification and publication. Neither touches the prompt or the
default model, and both fail open.

1. **Named-credential filter** — drops a "credential exposed in a
   message/log/output" finding only when the cited added/context line is
   positively recognised as harmless: an error constructor, `throw`, or
   log/print call whose sole argument is one fixed string literal, with no
   secret-looking value (token prefix, `key=value` assignment, long
   high-entropy word) inside the literal. Any other expression (extra
   arguments, variables, calls, operators, interpolation) is ambiguous and
   keeps the finding. A missing line or unreadable patch also keeps it.
2. **Resolved-thread dedupe** — drops a finding whose `(path, normalized
   claim)` matches the first comment of a review thread a maintainer already
   resolved, where that thread was opened by Ronda: the first comment's author
   must be a GitHub `Bot` and its pull-request review body must carry the
   `## Ronda review` heading (the marker `findExistingRondaReview` trusts).
   Threads from humans, other bots, or unknown authors never suppress. Line numbers are ignored (they shift every push); the claim
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
