# Read-Only Repository Context — Resolution Precision (AC23)

Evidence for read-only repository context
([#106](https://github.com/lhpaul/ronda/issues/106)): the measured resolution
precision of plan decision D2 (the TypeScript compiler API, in-process) on
the recorded fixture the spec's **Context Selection Order** → Resolution
correctness paragraph and AC23 require.

**Measured on**: 2026-09-29, feature branch `feature/106-read-only-symbol-context`,
commit `bcc9542` (parent of this evidence's own commit). `typescript` `5.8.3`.

**Method** (D2): the TypeScript compiler API, in-process, over a virtual
`CompilerHost` backed by the in-memory file set the pass's own reads produced.
A resolved candidate is the single declaration
`checker.getSymbolAtLocation(...)` binds the reference to, following the
alias chain through a re-export; zero or more than one bound declaration is
dropped `ambiguous_resolution`.

## Fixture

[`tests/fixtures/repository-context/resolution/`](../../../tests/fixtures/repository-context/resolution/),
exercised by `tests/unit/review/symbol-resolver.test.ts`'s
`"scenario 12 (AC23): resolution precision on the recorded fixture is 100%"`
test. Reproduce with:

```bash
npx tsx --test tests/unit/review/symbol-resolver.test.ts
```

The fixture's single changed file, `changed.ts`, names every reference AC23
requires:

| Reference | Changed line | What it tests |
| --- | --- | --- |
| `a.read("x")` | 9 | Same-named method (`read`) on `A`, one of two same-named declarations on different types |
| `b.read("y")` | 9 | Same-named method (`read`) on `B` — must never be confused with `A`'s |
| `outer()` | 13 | A symbol reached through a re-export (`reexport.ts` re-exports `inner.ts`'s `inner` as `outer`) |
| `overlap(1)` | 17 | A reference that cannot be bound to exactly one declaration — the overloaded symbol carries three declarations (two signatures, one implementation) |
| `sharedHelper()` (in `withoutShadow`) | 26 | A name a local shadow elsewhere in the file must not affect — resolves to the real import |

A sixth case — a name shadowed by a local (`withShadow`'s own `const
sharedHelper`, line 20) — is deliberately **absent** from the resolved/dropped
count below: its declaration is in the changed file itself, so it is excluded
as a candidate before resolution ever runs (the spec's E8 rule — "the
definition is not attached as a candidate for its own declaration site"). Its
correctness (that the resolver never confuses it with the imported
`sharedHelper`) is the dedicated shadowing test in
`tests/unit/review/symbol-resolver.test.ts` ("E2: a local shadowing
declaration is never attached as the module-level candidate"), which asserts
zero candidates are produced for that occurrence — proving nothing is ever
wrongly attached, local or otherwise.

The exact expected binding for each of the five is committed in
[`tests/fixtures/repository-context/resolution/expected.json`](../../../tests/fixtures/repository-context/resolution/expected.json).

## Measured result

| Figure | Value |
| --- | --- |
| Candidates requested | 7 (5 resolved + 1 ambiguous + the two type-annotation references `A`/`B` on line 8, both resolved) |
| Candidates resolved | 6 |
| Candidates dropped `ambiguous_resolution` | 1 (`overlap`) |
| Resolved candidates matching `expected.json` exactly (path, line, endLine) | 6 / 6 |
| **Precision** (resolved candidates that are correct over all resolved candidates) | **6 / 6 = 100%** |

Every one of the six resolved candidates matched its expected declaration's
`path`, `line`, and `endLine` exactly; the seventh reference (`overlap`) was
correctly dropped `ambiguous_resolution` rather than bound to a guess. A
precision below 100% on this fixture would be a defect to fix before this
repository's own switch is set on (AC23) — not a figure to report — and none
was observed.

The type-annotation references (`A`, `B` on line 8) are a byproduct of the
resolver treating any identifier the checker can bind as a reference,
including a parameter's type name, not only its value calls — a changed line
depends on the type it names too. Both resolved correctly to their declaring
class (see `expected.json`), so they are included in the precision figure
rather than excluded from it.

## Reproducibility

Re-run with `npx tsx --test tests/unit/review/symbol-resolver.test.ts`. The
fixture, `expected.json`, and the assertions are all committed; a future
measurement on a later version should append a new dated section below
rather than editing this one.
