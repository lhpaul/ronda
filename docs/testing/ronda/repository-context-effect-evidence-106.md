# Read-Only Repository Context Effect Evidence

Evidence for read-only repository context
([#106](https://github.com/lhpaul/ronda/issues/106), epic
[#52](https://github.com/lhpaul/ronda/issues/52)): the fixture-comparison
admissibility statement AC13 requires **before any recall or precision
figure**, recorded 2026-09-29. The recall, precision and cost campaign (spec Use
Case 5 and Use Case 6; plan steps 13's interleaved run and 14) was deferred
from the implementation PR and landed with
[#132](https://github.com/lhpaul/ronda/issues/132) on 2026-11-15, the same way
`#105`'s own campaigns landed as `#119`/`#120`/`#123`.

## Evidence-tier ledger

| Field | Value |
| --- | --- |
| Tier | `real_pr_provisional` |
| Counted pull requests | 0 |
| Configuration the count accrues under | `RONDA_REPOSITORY_CONTEXT=on` on this repository's dogfood pass (reusable-workflow ingress only), recorded budget defaults — **effective only from the first release containing #106 on `main`**, not from the variable's creation (see **Switch history**) |
| Date recorded | 2026-11-15 (re-confirmed with the #132 campaign; promoted from `fixture_only` 2026-10-02, recorded 2026-09-30) |

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

The webhook ingress was held off until
[#131](https://github.com/lhpaul/ronda/issues/131) moved the synchronous
compiler work into a terminable worker thread. #131 lands that change
([#179](https://github.com/lhpaul/ronda/pull/179)), so the technical blocker
is gone, but the ingress stays off: switching it on remains the repository
owner's decision, and no switch change is recorded by #131 itself. Record
every later change to the switch here, with its time, so the ledger's counted
pull requests stay attributable to one configuration.

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

## AC13: admissibility of the #132 seed fixture (recorded 2026-11-15, before any figure)

**Admissible for two of the four new seeds as a context-dependent test, and
for one more only weakly. The fourth turned out to be inferable from the diff
alone. The three original target seeds stay inadmissible, as recorded above.**

[#132](https://github.com/lhpaul/ronda/issues/132) adds a **separate** seed
fixture,
[`tests/fixtures/recall-benchmark/repository-context-seeds/`](../../../tests/fixtures/recall-benchmark/repository-context-seeds/),
rather than editing the extended fixture. The extended fixture's
`manifest.json` and `patches.json` are byte-for-byte unchanged, so every
campaign already recorded against their hashes (`sweep-effect-evidence.md`)
stays valid, and the AC13 statement above about the three original seeds
still stands.

Each new seed is one added file under `src/benchmark/ctx/` that imports a
definition from the repository-context source tree
([`tests/fixtures/recall-benchmark/repository-context/src/benchmark/ctx/`](../../../tests/fixtures/recall-benchmark/repository-context/src/benchmark/ctx/)).
The defect is stated only in the body of that definition, which is never part
of the diff:

| Seed | Sub-theme | Changed file | Definition that carries the defect |
| --- | --- | --- | --- |
| `ctx-state-reconstruction-event-order` | State reconstruction from API evidence | `deploy-status.ts` | `listDeployEvents` returns events newest first, so `events[events.length - 1]` is the oldest |
| `ctx-state-reconstruction-first-page` | State reconstruction from API evidence | `approval-state.ts` | `listReviews` returns only the first page (30 reviews) |
| `ctx-lossy-parsing-fatal-level` | Lossy external-output parsing | `checker-summary.ts` | `parseCheckerLine` also emits a `fatal` level, which the changed code counts as a warning |
| `ctx-lossy-parsing-unrecognised-summary` | Lossy external-output parsing | `ci-gate.ts` | `parseTestSummary` returns zero counts for an unrecognised or missing summary, so a crashed run reads as green |

The resolver resolves every seed's definition from the tree. This is a test,
not just a claim:
`tests/unit/cli/recall-benchmark-repository-context.test.ts` (`"#132 seed
fixture: every seed's changed lines resolve the out-of-diff definition that
carries its defect"`) runs `computeBenchmarkRepositoryContext` (the same
`identifyCandidates` / `buildSourceFileSet` / `resolveSymbols` core the
review pass uses) and asserts that each seed's defect-carrying definition is
among the candidates and is absent from the seed's own patch. The clean
precision fixture `harmless-deploy-label` also imports from the tree, so the
paired precision pass receives repository context under the `on` arm (see
its own test in the same file).

**Seed-construction limitation, found by the campaign.** On the context-off
arm the model flagged `checker-summary.ts` in 10 of 10 runs as "Misclassified
non-error, non-warning lines (as warnings)". That describes the
`ctx-lossy-parsing-fatal-level` defect without naming the level: the changed
code's catch-all `else` branch reveals the defect class with no context at
all. That seed therefore **does not isolate repository context**. Its strict
matcher credits a finding only when it names `fatal`, so its strict
off-to-on movement (0/10 to 10/10) is a vocabulary effect, and it is
reported apart from the other three below. The seed is **not rewritten**: a
rewrite would change `patchesSha256` and invalidate this campaign. A future
campaign that wants a fourth isolating seed should add one rather than edit
this one.

## Recall and precision campaign (AC13, AC15, AC16)

### Campaign shape and pairing (AC15)

| Field | Value |
| --- | --- |
| Fixture | `issue-132-repository-context-seeds`, 4 seeds, 1 clean precision fixture; `manifestSha256` `1b80521eebaf7635e3f79789e5813f738646a4e4a08affe7f0be94118b44fa67`, `patchesSha256` `39eac28793fc4446a81c1c9fcf611a72ce83b8054831bae9d9b236120a6e209b` (equal on all 20 records) |
| Arms | `--repository-context off` and `--repository-context on`, with `--quality` (1 recall call and 1 precision call per run) |
| Runs | 10 per arm, interleaved one run at a time: off 0, on 0, off 1, on 1, … off 9, on 9. Each `on` run started about 8 s (7.8–8.8 s) after its paired `off` run; the whole campaign ran 2026-11-15T11:14:06Z–11:17:05Z |
| Model | `qwen-plus-2025-12-01` configured on every run; all 40 requests report `reportedModel` `qwen-plus-2025-12-01` |
| Version attestation | The same string as the #105 sweep campaign on all 20 records: *Provider-published dated snapshot identifier qwen-plus-2025-12-01 configured explicitly on every leg; frozen-artifact status rests on the provider's dated-snapshot naming and is not independently verified* |
| Other configuration | Sweep `off`, `maxPatchChars` 400000, temperature 0, durability mode `default` (not applied by the benchmark) |
| Driver commit | `cf708bc` on `feature/132-repository-context-campaign` |
| Failure records | 0 on either arm |

**Pairing check.** On every one of the ten pairs, the `fixture` blocks are
equal and the `configuration` blocks differ only in `repositoryContextMode`
and `requests`. `requests` differs because each request's own prompt
fingerprint covers the repository-context section the `on` arm adds; its
`reportedModel` values are identical. The run-level `promptFingerprint`
(`5309fd31…`), which excludes repository context, is equal on all 20 records.
This satisfies AC15's interleaved, one-model-version, equal-run-count
requirement for these **fixture** figures, with the attestation's own caveat
about how far the model identity can be verified.

**Context supplied.** Every `on` record lists 11 recall candidates and 4
precision candidates (identifiers only, under `repositoryContext`). Every
`off` record lists 0 and 0.

### Recall per seed (AC13)

Strict figures are the benchmark matcher's credit, read from each record's
`foundSeededDefects`. Adjudicated figures re-read every unmatched finding's
title (the record keeps titles, not bodies) for a description of the seed's
own defect.

| Seed | Off, strict | On, strict | Off, adjudicated | On, adjudicated |
| --- | ---: | ---: | ---: | ---: |
| `ctx-state-reconstruction-event-order` | 0/10 | 3/10 | 0/10 | 3/10 |
| `ctx-state-reconstruction-first-page` | 0/10 | 4/10 | 0/10 | 4/10 |
| `ctx-lossy-parsing-unrecognised-summary` | 0/10 | 1/10 | 0/10 | 1/10 |
| `ctx-lossy-parsing-fatal-level` (non-isolating, see above) | 0/10 | 10/10 | 10/10 | 10/10 |

Per-run recall, strict, out of 4: off `[0, 0, 0, 0, 0, 0, 0, 0, 0, 0]`
(mean 0.0); on `[2, 4, 2, 1, 2, 2, 2, 1, 1, 1]` (mean 1.8, population SD
0.87). Over the **three isolating seeds** only, out of 3: off 0 in every run;
on `[1, 3, 1, 0, 1, 1, 1, 0, 0, 0]` (8 of 30 seed-runs).

None of the off arm's unmatched findings on `deploy-status.ts`,
`approval-state.ts` or `ci-gate.ts` describes the seed defect. They are an
index-out-of-bounds concern on `deploy-status.ts` (10 of 10 runs) and a
"latest review selection logic" concern on `approval-state.ts` (10 of 10
runs), and both also appear on the `on` arm. `ci-gate.ts` drew no finding on
either arm except the one `on` run that found its seed.

### Paired precision (AC16)

| Measure | Off | On |
| --- | ---: | ---: |
| Precision fixture `harmless-deploy-label` clean | 10/10 | 10/10 |
| Precision fixture unexpected findings, total | 0 | 0 |
| Recall-pass findings not matched to any seed (strict), total | 30 | 13 |
| … of which describe the non-isolating `fatal` seed (adjudicated) | 10 | 0 |
| Recall-pass noise after adjudication, total (per run) | 20 (2 every run) | 13 (0–2 per run) |

**Regression result: no precision regression on the `on` arm.** The clean
fixture stayed clean on 10 of 10 runs of both arms, and the `on` arm produced
no more unmatched recall-pass findings than the `off` arm (13 against 20
after adjudication). The noise that remains on both arms is the same two
concerns on `deploy-status.ts` and `approval-state.ts`. On the `on` arm some
of the `deploy-status.ts` ones are rated `blocking`, where every `off`-arm
instance is `important`.

### What these fixture figures admit

- **Admitted (fixture claim, AC13/AC15/AC16).** On this fixture, under one
  provider-named model snapshot, interleaved, with equal run counts and paired
  precision showing no regression, repository context moved the three
  isolating seeds from 0 of 30 seed-runs to 8 of 30. Every finding came from
  seeds whose defect is visible only in a definition outside the diff. The
  admissible conclusion is narrow. When the defining fact sits in the body of a
  resolvable definition, the reviewer sometimes uses it: 3, 4 and 1 runs in 10
  for the three seeds. It often does not, and context is no guarantee of
  recall.
- **Not admitted.** A recall effect on **real pull requests**. These are
  fixture figures on four seeds written for this purpose, with definitions
  that state their own pitfall in a comment. That is easier than most real
  code, so the figures are an upper-leaning illustration, not an estimate of
  real-PR recall. Ten runs per arm cannot distinguish an effect of 1 in 10
  (`ctx-lossy-parsing-unrecognised-summary`) from run-to-run variation.

## Cost arms on real passes (AC14, AC22)

### Shape and pairing (AC15)

Both arms ran as **non-publishing control passes**
(`npm run quality:control-pass`, AC22) on the same five fixed heads. The
published dogfood passes on those heads are used below only as a descriptive
reference, not as an arm. Running both arms as control passes keeps every
other setting identical: the same machine, the same pinned model, and the same
sweep setting. A published Actions pass would differ from the control pass in
runner, time and model configuration. Records:
[`repository-context-control-passes.jsonl`](repository-context-control-passes.jsonl)
(20 lines, SHA-256
`a99579f981c2d7194059bc18ab44624f3b271563c2e95a29fde991827d1ead13`).

| Field | Value |
| --- | --- |
| Heads | PR #176 `0a64132`, #173 `62381cb`, #155 `3b25d00`, #146 `24ace7c`, #96 `e4f7a7d` (all merged, same-repository heads, so each head is fixed) |
| Runs | 2 per arm per head (20 passes). Both rounds visit the heads in the same order. The arm that runs first alternates by head parity (`(round + PR number) mod 2`), so each head gets both orders across the two rounds. The campaign ran 2026-11-15T11:17Z–11:26:43Z |
| Model | `qwen-plus-2025-12-01` configured and reported on all 20 passes |
| Sweep | `on` on both arms (this repository's dogfood setting) |
| Budgets | Recorded defaults: 12 candidates / 24,000 chars / 120,000 ms; pass budget 10 min |
| Where | One operator workstation (local CLI). **No Actions runner was used, so billed minutes are 0 on both arms** |
| Outcome | 20 of 20 `succeeded`; 0 refused write attempts; nothing published (AC22) |

### Per-arm measurements (paired runs; no comparative claim drawn)

The two arms were run paired, interleaved and under one model so that a
comparative cost claim **can** be drawn once the tier admits one. **This
ledger is at `real_pr_provisional`**, and the spec's claim-admissibility rule
permits a comparative claim about real pull requests only at
`real_pr_measured`. An inadmissible claim is omitted, not hedged. This section
therefore records each arm's own measured figures, as AC14 requires, and
states **no difference between the arms and no effect attributed to
repository context**. The records stay in
[`repository-context-control-passes.jsonl`](repository-context-control-passes.jsonl)
for the comparison to be read when the tier reaches `real_pr_measured`.

Context-off arm (10 passes):

| Head | Elapsed (s) | Model calls per pass | Published findings in record |
| --- | --- | --- | --- |
| #176 | 8.9, 6.5 | 1, 1 | 0, 0 |
| #173 | 8.7, 6.9 | 1, 1 | 0, 0 |
| #155 | 9.5, 6.9 | 1, 1 | 0, 0 |
| #146 | 7.0, 10.1 | 1, 1 | 1, 3 |
| #96 | 22.8, 14.1 | 1, 1 | 5, 4 |

Context-on arm (10 passes):

| Head | Elapsed (s) | Model calls per pass | Outcome | Candidates requested / resolved | `contentRequestCount` | Context time used (s) | Characters used | Published findings in record |
| --- | --- | --- | --- | --- | ---: | --- | ---: | --- |
| #176 | 54.9, 53.7 | 1, 1 | `partial` | 24 / 12 | 151 | 40.5, 39.0 | 15,772 | 1, 1 |
| #173 | 37.3, 34.6 | 1, 1 | `partial` | 57 / 12 | 81 | 21.4, 20.4 | 2,917 | 2, 2 |
| #155 | 35.1, 32.3 | 1, 1 | `partial` | 180 / 12 | 67 | 17.8, 17.4 | 4,875 | 6, 5 |
| #146 | 31.3, 30.3 | 1, 1 | `used` | 2 / 2 | 68 | 20.4, 19.3 | 4,548 | 2, 2 |
| #96 | 49.1, 49.1 | 1, 1 | `partial` | 65 / 12 | 110 | 29.2, 28.9 | 3,251 | 5, 5 |

- **Billed minutes: 0 on both arms.** Every pass ran as a local CLI on one
  operator workstation; no Actions runner was used. Elapsed times are
  workstation-to-API latencies, not Actions runner figures.
- **Drops on the context-on arm.** `candidate_count_budget` cut 9–40
  resolved candidates on four of five heads, and `ambiguous_resolution`
  dropped 2–159. No `time_budget` or `read_failed` drop occurred.
- **Budget exhaustion (AC14).** **0 of 10** context-on passes exhausted the
  120 s context time budget (maximum 40.5 s used). **0 of 20** passes hit the
  10-minute pass budget or the job backstop (longest 54.9 s). The pass
  budget in effect was **sufficient** for every pass measured.
- **Findings** are counts from each record, **not adjudicated**, and no
  claim about their truth or about any difference between arms is made.

### Descriptive references (not arms, never paired)

- **Committed 2026-09-23 baseline**
  ([`cost-convergence-baseline-2026-09-23.md`](cost-convergence-baseline-2026-09-23.md)):
  `Ronda review` had **0 runs, 0.0 m wall time and 0 runner minutes** in its
  window. Ronda's Actions cost was nil before the dogfood pass existed, so the
  absolute cost below is all new spend, not a share of an earlier figure.
- **Measured dogfood passes on the same heads** (Actions job `Ronda dogfood /
  Ronda review pass`, read from the Actions jobs API; the repository is
  public, so actual billing is 0):

  | Head | Run | Job wall time | Rounded runner minutes | Repository context on that published pass |
  | --- | --- | ---: | ---: | --- |
  | #176 `0a64132` | 43009746589 | 88 s | 2 | `partial`, 45 requested / 12 resolved, 15,772 chars, 20.3 s |
  | #173 `62381cb` | 42806139155 | 66 s | 2 | `partial`, 102 requested / 12 resolved, 2,917 chars, 11.8 s |
  | #155 `3b25d00` | 37133757415 | 38 s | 1 | `partial`, 235 requested / 12 resolved, 4,875 chars, 9.4 s |
  | #146 `24ace7c` | 36899663537 | 21 s | 1 | none: this pass ran before v0.3.0 reached `main`, so context was inactive (see **Switch history**) |
  | #96 `e4f7a7d` | — | — | — | no dogfood run on this head (predates the dogfood workflow) |

  These passes ran on different dates from the Ronda code on `main` at the
  time, which need not match the code the control passes ran. #155 itself
  changed candidate identification (#153), which explains why the requested
  counts differ. No effect is read from any difference between these passes
  and the control-pass arms.

## AC18: guard-fails-open

The `guard-fails-open` seed moved under the #105 category-forced sweep
(`sweep-effect-evidence.md`: found in 10 of 10 sweep-on 18-seed runs). That
movement belongs to the sweep and **is not attributed to repository context**.
This campaign does not use that seed, and no improvement on it is claimed
here, neither on its own nor as additional to the sweep. The three original
target seeds remain inadmissible for this feature (AC13 statement above), so
no repository-context figure exists for `guard-fails-open`.

## Labels for every claim above (AC17)

- **Tier:** fixture figures are `fixture`-scoped and admitted by the #132
  admissibility statement. The real-PR figures are under ledger tier
  `real_pr_provisional`. That tier admits per-arm descriptive measurements
  only, so no comparative real-PR claim is published.
- **Independence caveat:** the seeds, the definitions they depend on, and
  their matchers were written by the same agent session that ran and
  adjudicated the campaign, with knowledge of what repository context would
  supply. The adjudication of unmatched findings is an assistant draft, not
  individual human review (see **Miss verdict provenance eligibility**).
- **Own-repository label:** every real-PR head is from this repository
  (`lhpaul/ronda`), reviewed by Ronda on its own code.

## Still open after #132

- The ledger's counted pull requests stay at **0**. No real-PR review with
  repository context has been adjudicated, so `real_pr_measured` (10
  terminally adjudicated PRs under one configuration) is not reached, and no
  comparative recall, finding-count or cost claim about real pull requests
  is admitted. The paired cost records are kept so that comparison can be
  read once the tier allows it.
- Webhook ingress stays off. Switching it on remains the repository owner's
  decision (see **Switch history**).

## Miss verdict provenance eligibility (#139)

Accepted assistant drafts cannot satisfy human-adjudication requirements for
counted pull requests or measured-tier promotion. Owner batch acceptance is not
individual human review. A miss record with `verdictProvenance` equal to
`assistant_drafted_owner_accepted` remains draft evidence even with a terminal
verdict. An absent legacy property is interpreted as `human`; an explicit invalid
value is not human evidence.

Individual human confirmation makes the record eligible for the unchanged
head, cohort, configuration and count requirements; it does not automatically
promote a tier. Independent provisional promotion triggers that do not require
adjudication remain unchanged. Record current adjudication and preserve committed
prior draft history before any promotion is claimed.
