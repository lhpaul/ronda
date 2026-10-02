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
| Tier | `real_pr_provisional` |
| Counted pull requests | 0 |
| Configuration the count accrues under | `RONDA_REPOSITORY_CONTEXT=on` on this repository's dogfood pass (reusable-workflow ingress only), recorded budget defaults — **effective only from the first release containing #106 on `main`**, not from the variable's creation (see **Switch history**) |
| Date recorded | 2026-10-02 (promoted from `fixture_only`, recorded 2026-09-30) |

The spec's first valid transition (`fixture_only` → `real_pr_provisional`)
fires when the first real-PR review with repository context enabled is recorded,
even before adjudication. That review is the dogfood pass on PR #145 head
`6ee6a58` (check run 110818602318), run on release v0.3.0 (`09e6aab`) with the
switch `on`: its summary carries a repository-context line (`Repository context
unavailable`, 0 of 6 candidates resolved, all `ambiguous_resolution`). The
revert pass (run 110818884680) reports `nothing to resolve`. **The counted total
stays `0`**: neither pass is adjudicated, and the first is a deliberate plant, so
it is the promotion trigger and not a counted pull request. The context was
active alongside the sweep, so no context-only effect can be read from these
passes.

## Switch history

AC19 requires this repository's switch to go on only after the AC4, AC5 and
AC23 evidence is committed, verifiable from the order of the evidence commits
and the setting's change.

| Time (UTC) | Change | By | Ordering evidence |
| --- | --- | --- | --- |
| 2026-09-30T14:24:02Z | `RONDA_REPOSITORY_CONTEXT` repository variable created with value `on` | Repository owner | The AC4/AC5 record (`repository-context-read-only-evidence-106.md`) and the AC23 record (`repository-context-resolution-precision-106.md`, precision 6 / 6 = 100%) reached `develop` with PR [#130](https://github.com/lhpaul/ronda/pull/130), merged 2026-09-30T14:16:57Z — before the switch. Timestamp read from the Actions variables API (`created_at`). |
| 2026-10-01T18:11:44Z | Release **v0.3.0**, which contains #106, reached `main` (PR [#147](https://github.com/lhpaul/ronda/pull/147), merge commit `09e6aab`). Repository context is therefore **active** for dogfood passes from here, with the switch already `on` | Release of #135 (no change to the variable) | The variable was not flipped by this release; the owner's 2026-09-30 setting took effect when `ronda_ref` (default `main`) began resolving to a release containing #106. #135 also turns the sweep on, so passes from this point run **both** features — counted pull requests under this ledger start here and carry the sweep too. Record the first pass whose summary shows a repository-context line as the confirming observation. |

**The variable being `on` is not the feature being active.** The dogfood
pass (`.github/workflows/ronda-review-dogfood.yml`) runs Ronda's code checked
out from `ronda_ref`, which defaults to `main`. When the variable was created,
`main` was release v0.2.0, which predates #106 and ignores the input: the
first pass after the switch (PR
[#133](https://github.com/lhpaul/ronda/pull/133), 2026-09-30T14:26Z) received
`RONDA_REPOSITORY_CONTEXT: on` and published a review with no
repository-context line. Repository context becomes active on the first pass
that runs a release containing #106. Record that release and the time it
reached `main` as the next row of this table; the ledger's counted pull
requests start from it, not from the variable's creation.

The webhook ingress stays off until
[#131](https://github.com/lhpaul/ronda/issues/131) moves the synchronous
compiler work into a terminable worker thread. Record every later change to
the switch here, with its time, so the ledger's counted pull requests stay
attributable to one configuration.

**Gate wording, corrected.** An earlier version of this document also gated
the switch on this document's fixture-comparison and real-PR sections being
populated. That is not the spec's gate, and it could never be met: the real-PR
sections only fill from reviews run with the switch on. The spec's
demonstrations-before-the-switch business rule and AC19 require the AC4, AC5
and AC23 evidence only, and the plan's own step 14 records that the cost arms
need no particular switch position.

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
  step 15) — a repository-settings change reserved for the human owner.
  **Done 2026-09-30T14:24:02Z**; see **Switch history**.

The remaining campaign work is tracked as
[#132](https://github.com/lhpaul/ronda/issues/132).

This mirrors how `#105`'s own recall/precision/cost campaign landed as
follow-up pull requests `#119`, `#120`, and `#123` after that item's
implementation PR, rather than inside it.
