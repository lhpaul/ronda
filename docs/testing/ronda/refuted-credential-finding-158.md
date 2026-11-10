# Refuted credential finding — offline measurement (#158)

Offline only: no model call, no GitHub write, no credential used.

## What changed

Two deterministic post-filters run on parsed findings, after the model call
and before classification and publication. Neither touches the prompt or the
default model, and both fail open.

1. **Named-credential filter** — drops a "credential exposed in a
   message/log/output" finding only when the cited added/context line is
   positively recognised as harmless: an error constructor, `throw`, or
   log/print call whose sole argument is one fixed string literal that is a
   credential-name-only message: every word comes from a closed vocabulary of
   credential-meta and neutral function words (a credential env-var name or a
   letters-only doc path is also allowed), with no digits, `=`, or other
   punctuation beyond spaces and `. , ; : !`, and at least one credential
   word. An unknown word (for example a candidate value, as in `"The password
   is hunter2"`) keeps the finding. Credential nouns (`password`, `token`,
   `secret`, `key`, ...) may only name the credential: after a copula
   (`is`/`are`/`was`/`be`) only a closed status set (`missing`, `not`, `set`,
   `unset`, `expired`, `configured`, `failed`, ...) is allowed, and a
   credential noun may not directly follow another (except modifiers such as
   `API`), so `"The password is secret"` and `"password: secret"` keep the
   finding. Any other expression (extra
   arguments, variables, calls, operators, interpolation) is ambiguous and
   keeps the finding. A missing line or unreadable patch also keeps it.
2. **Resolved-thread dedupe** — drops a finding whose `(path, normalized
   claim)` matches the first comment of a review thread a maintainer already
   resolved, where that thread was opened by Ronda: the first comment's author
   must be a GitHub `Bot` and its pull-request review body must carry the
   `## Ronda review` heading (the marker `findExistingRondaReview` trusts).
   Threads from humans, other bots, or unknown authors never suppress. The claim
   matches on normalized title or ≥0.8 token overlap, and the finding's cited
   line content in the current diff must equal the trimmed code line the thread
   was attached to (read from the thread's `diffHunk` at its `originalLine`/`line`).
   Content, not line number, is compared (numbers shift every push). A finding on
   different code, with no cited line, or a thread whose code cannot be read keeps
   the finding. The thread read is a
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
| After, next push (resolved-thread dedupe on the refuted claim's line 42 code) | 1 | 0 | yes — the control is on different code (line 45), so the resolution does not cover it |

Reproduce: `npm test` (`tests/unit/review/refuted-findings.test.ts`,
`tests/unit/core/run-review-pass-refuted-findings.test.ts`).

## Limits

- The fixture is a reproduction, not the live #156 thread set. A real-model
  confirmation needs a live pass and is left to a maintainer.
- Dedupe trusts the maintainer's resolution only for the same claim on the same
  code line: if the thread's line text changes or the finding cites different
  code, the finding is kept. A resolution that meant "fixed" can still suppress
  a regression that reproduces the identical line text with the same title.
