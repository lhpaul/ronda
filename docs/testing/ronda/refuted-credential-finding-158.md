# Refuted credential finding — offline measurement (#158)

Offline only: no model call, no GitHub write, no credential used.

## What changed

One deterministic post-filter runs on parsed findings, after the model call
and before classification and publication. It does not touch the prompt or the
default model, and it fails open.

**Named-credential filter** — considers only findings that positively
   assert credential exposure: an exposure verb (`exposes`, `leaks`, `logs`,
   `prints`, `discloses`, `reveals`, `includes`, `interpolates`, `echoes`)
   tied to a credential word, in a message/log/output context. Any negation
   or disclaimer (`no`, `not`, `without`, `never`, `n't`, ...) or HTTP
   status wording (`401`, `500`, `status`, `returns`) keeps the finding, so
   keyword co-occurrence alone never suppresses. Such a claim is dropped only
   when the cited added/context line is an error constructor, `throw`, or
   log/print call whose sole argument is one fixed string literal that equals,
   exactly, one of a closed set of two Ronda-owned templates (case-sensitive,
   after trimming, no free slots): the "no model credential is configured"
   message pointing to the adoption doc path, and the same message pointing
   to the `RONDA_MODEL_API_KEY` variable name.

   The suppression is intentionally narrow and covers only those enumerated
   Ronda templates. There is no vocabulary, word list, or pattern matching:
   any other literal (a near miss, a different wording, extra punctuation,
   or a credential-looking word in any position) keeps the finding, as do
   extra arguments, variables, calls, operators, interpolation, a missing
   line, or an unreadable patch.

Dedupe against resolved review threads is intentionally out of scope: GitHub
thread data cannot tell a refuted claim from one that was fixed, so it could
silently suppress a legitimate renewed finding. It is tracked in #174 with an
explicit refutation marker.

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

Reproduce: `npm test` (`tests/unit/review/refuted-findings.test.ts`,
`tests/unit/core/run-review-pass-refuted-findings.test.ts`).

## Limits

- The fixture is a reproduction, not the live #156 thread set. A real-model
  confirmation needs a live pass and is left to a maintainer.
