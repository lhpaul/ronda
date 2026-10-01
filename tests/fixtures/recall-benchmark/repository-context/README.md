# Recall-benchmark repository-context source tree (#106, AC13)

This directory is the source tree
`src/cli/recall-benchmark.ts`'s `--repository-context on` arm reads from
(`computeBenchmarkRepositoryContext`, default
`tests/fixtures/recall-benchmark/repository-context`), mirroring the
`--repository-context` arm the real review pass uses.

Its path namespace mirrors the recall-benchmark's own changed-file paths
(`src/benchmark/...`), so a relative module specifier in a benchmark seed's
patch resolves against a file placed here at the matching path — for
example, a seed patch that reads `import { helper } from "./util.js"` from
`src/benchmark/caller.ts` would resolve against
`src/benchmark/util.ts` placed under this directory.

## AC13 admissibility (recorded 2026-09-29)

This directory is currently **empty of seed-matching source** because the
three AC13 target seeds' committed patches
(`api-evidence-state-reconstruction` → `src/benchmark/git-history.ts`,
`external-output-parsing-lossy` → `src/benchmark/output.ts`,
`guard-fails-open` → `src/benchmark/guard.ts`) reference **no symbol outside
their own file** — each is a single self-contained added file with no
`import` statement at all (verified in
`tests/unit/cli/recall-benchmark-repository-context.test.ts`, whose
`"computeBenchmarkRepositoryContext returns empty for the three current AC13
target seeds"` test runs the real resolver against these exact committed
patches and asserts zero candidates).

Per AC13, that admissibility finding is recorded **before any recall or
precision figure**, in
[`docs/testing/ronda/repository-context-effect-evidence-106.md`](../../../../docs/testing/ronda/repository-context-effect-evidence-106.md):
the fixture, **as it stands today**, cannot test read-only repository
context's effect on these three seeds, because repository context can only
help where the reviewed target actually has surrounding source for the
symbols its changed lines name (spec, Use Case 5). Giving these three seeds a
resolvable dependency would mean editing their committed patches —
"rebalancing the benchmark fixture's existing seeds," which the spec's
**Out of Scope (MVP)** list defers, the same way `105-category-forced-review-sweep`
already recorded. This item does not do that rebalancing.

The `--repository-context` **mechanism** itself is real and tested — see
`computeBenchmarkRepositoryContext`'s own positive-path test, which proves it
resolves a candidate correctly when a fixture placed here *does* provide one.
Populating this directory with real seed dependencies, or targeting a
different fixture whose seeds already have resolvable surrounding source, is
future work for whoever runs the interleaved recall/precision/cost campaign
(plan step 14, explicitly deferred past this pull request).
