# Read-Only Repository Context Effect Evidence

Evidence for read-only repository context
([#106](https://github.com/lhpaul/ronda/issues/106), epic
[#52](https://github.com/lhpaul/ronda/issues/52)): the fixture-comparison
admissibility statement AC13 requires **before any recall or precision
figure**, recorded now; the recall, precision, and cost campaign itself
(spec Use Case 5 and Use Case 6; plan steps 13's interleaved run and 14) is
explicitly **deferred to a follow-up evidence pull request**, the same way
`#105`'s own campaigns landed as `#119`/`#120`/`#123` after that item's
implementation PR.

## Evidence-tier ledger

| Field | Value |
| --- | --- |
| Tier | `fixture_only` |
| Counted pull requests | 0 |
| Configuration the count accrues under | Not applicable — repository context is not yet enabled for this repository (AC19's ordering gate: the switch is set on only after the AC4, AC5, and AC23 evidence is committed, and only after this document's fixture-comparison and real-PR sections are populated by the follow-up evidence work) |
| Date recorded | 2026-09-29 |

No real-pull-request review with repository context enabled exists yet, so
`fixture_only` is the only tier this ledger can honestly claim (Statuses /
Enum Values → Evidence tier, spec).

## AC13: fixture admissibility (recorded 2026-09-29, before any figure)

**Not admissible for the three target seeds as the fixture stands today.**

The three seeds AC13 names —
`api-evidence-state-reconstruction` (`src/benchmark/git-history.ts`),
`external-output-parsing-lossy` (`src/benchmark/output.ts`), and
`guard-fails-open` (`src/benchmark/guard.ts`) — are each a single,
self-contained added file in
[`tests/fixtures/recall-benchmark/patches.json`](../../../tests/fixtures/recall-benchmark/patches.json)
with **no `import` statement at all**. Repository context resolves the
*definitions* a changed line depends on through an import (**Context
Selection Order**, spec); a changed line that imports nothing has nothing
for repository context to resolve, regardless of how the mechanism itself
behaves.

This is a recorded, reproducible finding, not an assertion: `npx tsx --test
tests/unit/cli/recall-benchmark-repository-context.test.ts`'s
`"computeBenchmarkRepositoryContext returns empty for the three current AC13
target seeds — none reference an external symbol"` test runs the real
resolver (`identifyCandidates` / `buildSourceFileSet` / `resolveSymbols`,
the same core the review pass uses) against these exact three seeds' committed
patches and asserts zero candidates are requested.

**Why this is not fixed in this pull request**: giving these three seeds a
resolvable dependency means editing their committed patches, which changes
`patchesSha256` and invalidates every existing recorded campaign keyed to it
(see `sweep-effect-evidence.md`'s own note on exactly this consequence for a
smaller patch edit). The spec's **Out of Scope (MVP)** list already defers
"rebalancing the benchmark fixture's existing seeds" as a decision the
`#105` item recorded, and this item does not reopen it. The mechanism itself
— `src/cli/recall-benchmark.ts`'s `--repository-context on|off` arm reading
from `tests/fixtures/recall-benchmark/repository-context/` — is real, wired
through the same `identifyCandidates` / `buildSourceFileSet` / `resolveSymbols`
core the review pass uses, and independently proven correct on a synthetic
fixture (`"computeBenchmarkRepositoryContext resolves a candidate when the
fixture directory provides one"`, same test file). What is missing is not
the arm; it is a fixture target that actually has surrounding source to
resolve.

**What this means for a recall claim**: per the spec's own recorded fallback
(Use Case 5 → Actions available), the fixture comparison is declared
inadmissible here, and any recall claim for this feature must rely on the
real-pull-request cohort instead, once that cohort exists (see the
evidence-tier ledger above — it does not yet).

## Deferred to the follow-up evidence pull request

The following plan-step 13/14 work is **not** performed in this pull
request, per the owner's explicit scope for the implementation PR:

- Running the interleaved recall/precision campaign (context-off vs.
  context-on, same seeds, one immutable model version, equal run counts)
  against whatever fixture target(s) do have resolvable surrounding source.
- Measuring cost arms on real passes (AC14) — the published arm at this
  repository's then-current setting, and an operator-initiated control pass
  (`npm run quality:control-pass`, AC22) for the opposite arm.
- Populating the evidence-tier ledger past `fixture_only` as real-pull-request
  reviews with repository context enabled accumulate.
- Setting this repository's `RONDA_REPOSITORY_CONTEXT` variable to `on` (plan
  step 15) — a repository-settings change reserved for the human owner, and
  gated on this document's fixture and real-PR sections being populated
  first (AC19's demonstrations-before-the-switch business rule).

This mirrors how `#105`'s own recall/precision/cost campaign landed as
follow-up pull requests `#119`, `#120`, and `#123` after that item's
implementation PR, rather than inside it.
