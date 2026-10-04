# Repository-context non-repository filter — evidence (#153)

Before/after candidate identification for the pull request that exposed the
defect: PR #145 at head `e7e356e` (16 dogfood passes, `RONDA_REPOSITORY_CONTEXT=on`).

## Method

The identification step (`identifyCandidates`) was run on the six files changed
at `e7e356e`, with the changed lines taken from the GitHub compare diff against
the PR base `6a1609a`, once on `develop` before the change and once on this
branch. File contents are read from the commit itself.

This is the identification step only. `npm run quality:control-pass` also needs
a model credential, which was not available where this was recorded, so no full
control pass was run. Identification is the step the defect lives in: a pass
with zero requested candidates reports `nothing_to_resolve` by
`resolveRepositoryContextOutcome`, with no model call involved.

## Result

| | Requested | Skipped (non-repository) | Outcome |
| --- | --- | --- | --- |
| Before | 10 | — | every candidate dropped `ambiguous_resolution` → `unavailable` |
| After | 0 | 10 | `nothing_to_resolve` |

Before (matches the check-run summary quoted in #153):

```text
test, assert, ok, includes, indexOf, slice, exec, split, find, startsWith
```

After: no candidate. The changed test file imports only `node:test`,
`node:assert/strict`, `node:fs` and `node:url`. The ten references above are
bindings imported from `node:*` modules (`test`, `assert`, `ok`) and built-in
string, array and RegExp members. The check-run summary now carries
`Non-repository references skipped: 10` instead of the list.

## Not shown here

No real pass has yet resolved a repository symbol. The unit tests cover a
relative-import type used beside built-ins and a local initialised from a
relative import, but a real pass on a diff with repository symbols is
still to be recorded under #132.
