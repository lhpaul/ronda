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
   keyword co-occurrence alone never suppresses. Such a claim is dropped only when the cited added/context line is
   positively recognised as harmless: an error constructor, `throw`, or
   log/print call whose sole argument is one fixed string literal that is a
   credential-name-only message: every word comes from a closed vocabulary of
   credential-meta and neutral function words (a credential env-var name or a
   letters-only doc path is also allowed), with no digits, `=`, or other
   punctuation beyond spaces and `. , ; : !`, and at least one credential
   word. An unknown word (for example a candidate value, as in `"The password
   is hunter2"`) keeps the finding. Credential nouns (`password`, `token`,
   `secret`, `key`, ...) may only name the credential: after a copula
   (`is`/`are`/`was`/`be`) or after a colon that follows a credential noun
   (`password: missing`) only a closed status set (`missing`, `not`, `set`,
   `unset`, `expired`, `configured`, `failed`, ...) is allowed, and a
   credential noun may not directly follow another (except modifiers such as
   `API`), so `"The password is secret"` and `"password: secret"` keep the
   finding. Any other expression (extra
   arguments, variables, calls, operators, interpolation) is ambiguous and
   keeps the finding. A missing line or unreadable patch also keeps it.
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
