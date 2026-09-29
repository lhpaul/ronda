# Category-Forced Sweep Effect Evidence

Evidence for the category-forced review sweep
([#105](https://github.com/lhpaul/ronda/issues/105), epic
[#52](https://github.com/lhpaul/ronda/issues/52)): what the sweep changed about
recall, its spread, precision, and per-pass cost, recorded under the paired
sweep-off / sweep-on campaign the smoke test runbook
([`105-category-forced-review-sweep.smoke-test.md`](105-category-forced-review-sweep.smoke-test.md))
prescribes.

Every figure below is read from the committed campaign records named in
[Provenance](#provenance). Nothing is re-typed from a run's own `fixture` or
`configuration` block, and nothing is carried over from a run that failed.

**This set replaces an earlier set.** The earlier records ran the same
campaign, on the same pinned snapshot, against an older fixture: the harder
credential seed `credential-pattern-gap-camel` says a guard that recognizes only the
canonical credential name misses a camelCase variant, but its patch did not
contain that guard, so its defect was not in the earlier patch. The patch was
rewritten (feature commit `0542d9e`), which changed the extended fixture's
`patchesSha256`, and the whole campaign was re-recorded. In the earlier set that
seed was found in 0 of the 20 runs that contain it (the earlier set had 30 runs
in all), so it is superseded, and no figure or seed-level statement from it is
used here. The original-thirteen control's inputs did not change. The records
also replace a still earlier campaign that ran against the mutable alias
`qwen-plus`; nothing from those is used either.

This document is also the single authoritative home of the regression-gate
status statement required by AC17 — see
[Regression-gate status](#regression-gate-status-ac17).

## Campaign shape

| Leg | Sweep off | Sweep on | Seeds | Runs per arm | Model calls per pass |
| --- | --- | --- | --- | --- | --- |
| Extended fixture | `sweep-off-extended.json` | `sweep-on-extended.json` | 18 | 5 | 1 recall |
| Original-thirteen control | `sweep-off-original-thirteen.json` | `sweep-on-original-thirteen.json` | 13 | 5 | 1 recall |
| Paired precision | `sweep-off-precision.json` | `sweep-on-precision.json` | 18 | 5 | 1 recall + 1 precision |

Commands, from the runbook with the model pinned by `RONDA_MODEL_NAME` (`<the recorded basis>` is the
version-attestation text quoted under
[Model identity](#model-identity-and-version-attestation), passed identically on
every command):

```bash
set -euo pipefail
export RONDA_MODEL_NAME=qwen-plus-2025-12-01
npx tsx src/cli/recall-benchmark.ts --sweep-mode off --runs 5 \
  --version-attestation "<the recorded basis>" \
  --output-file docs/testing/ronda/sweep-off-extended.json
npx tsx src/cli/recall-benchmark.ts --sweep-mode on --runs 5 \
  --version-attestation "<the recorded basis>" \
  --output-file docs/testing/ronda/sweep-on-extended.json

npx tsx src/cli/recall-benchmark.ts --sweep-mode off --runs 5 \
  --version-attestation "<the recorded basis>" \
  --manifest tests/fixtures/recall-benchmark/original-thirteen/manifest.json \
  --patches tests/fixtures/recall-benchmark/original-thirteen/patches.json \
  --output-file docs/testing/ronda/sweep-off-original-thirteen.json
npx tsx src/cli/recall-benchmark.ts --sweep-mode on --runs 5 \
  --version-attestation "<the recorded basis>" \
  --manifest tests/fixtures/recall-benchmark/original-thirteen/manifest.json \
  --patches tests/fixtures/recall-benchmark/original-thirteen/patches.json \
  --output-file docs/testing/ronda/sweep-on-original-thirteen.json

npx tsx src/cli/recall-benchmark.ts --sweep-mode off --runs 5 --quality \
  --version-attestation "<the recorded basis>" \
  --output-file docs/testing/ronda/sweep-off-precision.json
npx tsx src/cli/recall-benchmark.ts --sweep-mode on --runs 5 --quality \
  --version-attestation "<the recorded basis>" \
  --output-file docs/testing/ronda/sweep-on-precision.json
```

**Zero failure records.** Every leg has 5 records at array positions 0–4, each
without a `failure` block, so all three legs are complete sets and none is
partial. `runIndex` is not a field of a successful record; positions are named
by their array index, which is also the pairing position.

## Provenance

| File | SHA-256 |
| --- | --- |
| `sweep-off-extended.json` | `91d3f17a9e3e662b054a07bd7ee31ac01f65cb0d0baa3ab205f2acf2acd67b0a` |
| `sweep-on-extended.json` | `26bbced763c2c75d8caf21501508308aa646eb691001837c25ee3f7afc6f3db5` |
| `sweep-off-original-thirteen.json` | `1673fe8d801c0e5038f68a014f78230a4367a87074f03e10907082256cfe05fc` |
| `sweep-on-original-thirteen.json` | `086faacbde83b4b2ca728b9ca635a2afcc47152b39d46f41ece03590285629a6` |
| `sweep-off-precision.json` | `cc8d3f71c869157769b9cf9f5895099c7908ef626705428a4272aa1f89ab6ae7` |
| `sweep-on-precision.json` | `5130f5ffac724c43f3cdcdee1b57a6de927ca191114c4197f079faa33e50155f` |

Run timestamps (first–last record per file, in array order), read from each
record's `timestamp`:

| File | First | Last |
| --- | --- | --- |
| `sweep-off-extended.json` | 2026-09-29T08:39:24.382Z | 2026-09-29T08:40:32.497Z |
| `sweep-on-extended.json` | 2026-09-29T08:39:24.386Z | 2026-09-29T08:40:25.263Z |
| `sweep-off-original-thirteen.json` | 2026-09-29T08:39:24.382Z | 2026-09-29T08:40:24.215Z |
| `sweep-on-original-thirteen.json` | 2026-09-29T08:39:24.383Z | 2026-09-29T08:40:20.566Z |
| `sweep-off-precision.json` | 2026-09-29T08:39:24.382Z | 2026-09-29T08:40:30.103Z |
| `sweep-on-precision.json` | 2026-09-29T08:39:24.382Z | 2026-09-29T08:40:29.262Z |

The six files' first records are stamped within 4 ms of one another
(2026-09-29T08:39:24.382Z to 2026-09-29T08:39:24.386Z), and the whole campaign spans 2026-09-29T08:39:24.382Z to
2026-09-29T08:40:32.497Z. That is consistent with the six legs having run concurrently, not
one after another as the command listing reads; the five runs inside each file
are sequential. The legs appear to have run concurrently against one provider
endpoint, so the elapsed-time figures under [Cost evidence](#cost-evidence-ac11)
were likely taken under that shared load. It applies to both arms alike, and it
is stated here because it bears on how far those figures can be read.

Reviewed target: `issue-15-recall-benchmark` on every record in every file.

Driver commit: the campaign ran from `0542d9e`, the head of the feature branch
`feature/105-category-forced-review-sweep` ([#118](https://github.com/lhpaul/ronda/pull/118))
at run time, so the executable source, the fixtures, and the recorded category
list the campaign ran are the ones at that commit. The fixture hashes recorded in
each record's own `fixture` block match the content of the manifest and patch
files at `0542d9e`. The extended fixture's `patchesSha256` differs from the
superseded set's because that commit rewrote the `credential-pattern-gap-camel` seed's patch.

## Model identity and version attestation

The runbook's model-identity check reads each request's own reported value, not
the configured name. It records the run set as **unattested**, and the
comparison as inconclusive, when a block restates the alias, omits the field, or
shows differing reported values across the run set. Read from the six files, in
every leg:

- `configuration.modelName` is `qwen-plus-2025-12-01` on all 30 records. That
  is a dated provider snapshot identifier, not the mutable alias `qwen-plus`.
- The per-request reported identities are under `configuration.requests`. There
  are 40 requests in the campaign (30 recall and
  10 precision, the precision requests carrying
  `fixtureId` `harmless-session-refactor`), and every request's `reportedModel`
  is `qwen-plus-2025-12-01`. No request omits the field and no two requests
  differ.
- The record-level `model` field is `qwen-plus-2025-12-01` on every record.

The version-attestation basis is recorded in `configuration.versionAttestation`
on all 30 records, is one identical string across both arms of every leg,
and reads:

> Provider-published dated snapshot identifier qwen-plus-2025-12-01 configured explicitly on every leg; frozen-artifact status rests on the provider's dated-snapshot naming and is not independently verified

**What this establishes.** All 40 requests of the campaign report one
model identity, the same one the operator configured explicitly, and it is a
provider-published dated snapshot name. The reported value is consistent across
both arms and all three legs, so the "differing reported values" branch of the
unattested rule does not apply. The attestation is part of each record's
`configuration` block as the driver wrote it.

**What this does not establish.** The attestation says of itself that
frozen-artifact status "rests on the provider's dated-snapshot naming and is not
independently verified". Nothing in the records shows that the provider serves
an unchanging artifact behind that name for the duration of the campaign: no
provider-signed attestation, artifact hash, or weights identifier is recorded.
The records also cannot distinguish a provider that resolves the request to the
named snapshot from one that echoes the requested name back, and the recorded
basis names no endpoint. The identity claim is therefore exactly as strong as
the provider's dated-snapshot naming and no stronger.

## Admissibility of the pairing

The runbook requires each pair to share an equal `fixture` block and
`configuration` blocks differing only in `sweepMode`. Both hold on all three
pairs.

| Pair | `fixture` blocks equal | `configuration` keys differing |
| --- | --- | --- |
| Extended | yes | `['sweepMode']` |
| Original-thirteen control | yes | `['sweepMode']` |
| Precision | yes | `['sweepMode']` |

Every other `configuration` key is identical across both arms of every leg:
`durabilityMode`, `durabilityModeDefault`, `maxPatchChars`, `modelName`, `promptFingerprint`, `requestParameters`, `requests`, `versionAttestation`. The shared values are `maxPatchChars`
400000, `durabilityMode` `default` (`durabilityModeDefault`
false), and `requestParameters`
`{"temperature": 0}`. The `configuration` block contains no credential field.

Fixture version, read from each record's own `fixture` block:

| Leg | `manifestPath` | `benchmarkId` | `seedCount` | `manifestSha256` | `patchesSha256` |
| --- | --- | --- | --- | --- | --- |
| Extended / precision | `tests/fixtures/recall-benchmark/manifest.json` | `issue-15-recall-benchmark` | 18 | `8c8a8e3b5300d458239a5c02784b14dd58bfc513106095e8a534b9524a1ab325` | `cd9526be7cffdd926300403edbb69bce4714dd2252cb1423f1d90330e32994eb` |
| Original-thirteen control | `tests/fixtures/recall-benchmark/original-thirteen/manifest.json` | `issue-15-recall-benchmark` | 13 | `1ff80de715d320db744f0b866b51df1c7501e952fce63dfa48ef60a1529eb497` | `e548bd03e17accf6f003d16c361c941fb26d57cddd23e2f8999443d98f0e1b61` |

The original-thirteen control shares the extended fixture's `benchmarkId` (the
snapshot is a byte-identical copy) and is nonetheless distinct evidence: it
differs by `manifestPath`, by `seedCount`, and by both content hashes, so it is
demonstrably not the extended fixture re-run. Note that it also carries a
different `promptFingerprint` (`42c6d53f…`) than the
extended and precision legs (`6f64eb67…`), because the prompt embeds
the reviewed patch set; that difference is a property of the fixture, not a
configuration difference between the sweep arms.

`promptFingerprint` is identical across the two arms of every leg, including the
original-thirteen control. Each request's own `promptFingerprint` under
`configuration.requests` is likewise identical across the arms, including the
precision request (`41593c7c…`). The extended and precision legs
carry the same recall-pass fingerprint, so their recall passes review the same
prompt.

**Applying the model-identity clause honestly.** The runbook's rule makes the
comparison admissible "only when the operator has recorded that the endpoint
pins a frozen model artifact and every request's reported value matches it". It
has two parts, and they are met to different degrees:

- *Every request's reported value matches* the recorded identity: met without
  qualification, 40 of 40 requests.
- *The operator has recorded the pin*: **not met.** The operator recorded that a
  provider-published dated snapshot identifier was configured explicitly on
  every leg, and recorded in the same sentence that the frozen status of that
  snapshot rests on the provider's naming and is not independently verified.
  That is a record that a dated name was configured, not a record that the
  endpoint pins a frozen artifact behind it, which is what the rule requires. No
  provider-signed attestation or artifact hash is recorded, and the records
  cannot distinguish a provider that resolves the snapshot from one that echoes
  the name back.

**Conclusion.** The pairing is **not admissible** as an AC8/AC9
same-configuration comparison, and AC8 and AC9 stay open. What is established is
narrower: both arms of every leg ran the same prompt, parameters, and fixture
against one provider-named dated snapshot, every request reported that name, and
the arms differ only in `sweepMode`. What is not established is that the
snapshot is a frozen artifact. Closing the gap needs an operator or provider
attestation that the endpoint pins the snapshot; re-running the campaign would
not change that. The figures below are campaign evidence, not a
same-configuration claim, and they are not a claim that the sweep had an effect:
see [What the recall evidence shows](#what-the-recall-evidence-shows), which
treats every between-arm comparison as inconclusive.

## Recall evidence (AC8)

Per-run recall is `found ÷ seeded defects` for that leg's fixture. The
population standard deviation is computed over the runs performed, using the
population formula, as AC8 requires.

No recall target and no variance ceiling are defined for this feature, so the
recall and variance figures below are **reported evidence, not a pass or fail
outcome**.

### Extended fixture — 18 seeded defects, sample count 5

| Arm | Per-run found (of 18) | Per-run recall | Low | High | Population SD | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| Sweep off | 10, 8, 9, 8, 9 | 0.555556, 0.444444, 0.500000, 0.444444, 0.500000 | 0.444444 | 0.555556 | 0.041574 | 0.488889 |
| Sweep on | 10, 8, 7, 7, 11 | 0.555556, 0.444444, 0.388889, 0.388889, 0.611111 | 0.388889 | 0.611111 | 0.090267 | 0.477778 |

All 18 seeds were present in every run of both arms (no seed reported absent
from the fixture), so the denominator is 18 throughout.

### Original-thirteen control — 13 seeded defects, sample count 5

| Arm | Per-run found (of 13) | Per-run recall | Low | High | Population SD | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| Sweep off | 11, 8, 8, 8, 8 | 0.846154, 0.615385, 0.615385, 0.615385, 0.615385 | 0.615385 | 0.846154 | 0.092308 | 0.661538 |
| Sweep on | 8, 9, 7, 9, 7 | 0.615385, 0.692308, 0.538462, 0.692308, 0.538462 | 0.538462 | 0.692308 | 0.068802 | 0.615385 |

The recall denominator here is the fixture's 13 seeds, not the confirmed-defect
denominator AC15(d)'s real-pull-request tier uses, so this fixture comparison is
never reported as not applicable for want of a confirmed defect.

### Recall pass of the paired precision legs — 18 seeded defects, sample count 5

The `--quality` legs also run the recall pass, on the same extended fixture and
prompt. Their recall figures are reported for completeness, and are read from
the same fields as above.

| Arm | Per-run found (of 18) | Per-run recall | Low | High | Population SD | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| Sweep off | 8, 7, 8, 10, 8 | 0.444444, 0.388889, 0.444444, 0.555556, 0.444444 | 0.388889 | 0.555556 | 0.054433 | 0.455556 |
| Sweep on | 8, 8, 8, 8, 8 | 0.444444, 0.444444, 0.444444, 0.444444, 0.444444 | 0.444444 | 0.444444 | 0.000000 | 0.444444 |

### Original-thirteen subset, read from the extended runs

Each extended run record carries an `originalThirteenSubset` block: the
13-seed original fixture evaluated against the same run's 18-seed patch set.
This is reported separately from the standalone original-thirteen control
above, because the two answer different questions — the subset holds the patch
set fixed and narrows the seed list, while the control changes both.

| Arm | Subset run positions 0–4 (seeds) | Subset run positions 0–4 (found) | Subset run positions 0–4 (misses) | Subset recall (of 13) |
| --- | --- | --- | --- | --- |
| Sweep off (extended) | 13, 13, 13, 13, 13 | 9, 8, 9, 8, 9 | 4, 5, 4, 5, 4 | 0.692308, 0.615385, 0.692308, 0.615385, 0.692308 |
| Sweep on (extended) | 13, 13, 13, 13, 13 | 8, 6, 7, 6, 8 | 5, 7, 6, 7, 5 | 0.615385, 0.461538, 0.538462, 0.461538, 0.615385 |

### Per-defect found and missed counts

Counts are out of the 5 runs of the leg, read from each record's
`foundSeededDefects` and `missedSeededDefects` arrays.

#### Extended fixture

| Seed | Off found | Off missed | On found | On missed |
| --- | --- | --- | --- | --- |
| `expired-session-inversion` | 4 | 1 | 0 | 5 |
| `sensitive-value-exposure` | 5 | 0 | 5 | 0 |
| `cache-capacity-off-by-one` | 5 | 0 | 5 | 0 |
| `sql-interpolation` | 5 | 0 | 5 | 0 |
| `invalid-range-parsing` | 0 | 5 | 0 | 5 |
| `lexicographic-numeric-sort` | 5 | 0 | 5 | 0 |
| `lower-element-median` | 5 | 0 | 5 | 0 |
| `empty-word-title-casing` | 5 | 0 | 3 | 2 |
| `authorization-bypass` | 0 | 5 | 0 | 5 |
| `data-loss-overwrite` | 0 | 5 | 0 | 5 |
| `async-race-duplicate-processing` | 4 | 1 | 4 | 1 |
| `configuration-debug-default` | 0 | 5 | 0 | 5 |
| `stale-sha-review-publication` | 5 | 0 | 3 | 2 |
| `api-evidence-state-reconstruction` | 0 | 5 | 2 | 3 |
| `external-output-parsing-lossy` | 0 | 5 | 0 | 5 |
| `guard-fails-open` | 0 | 5 | 4 | 1 |
| `record-identity-drift` | 0 | 5 | 0 | 5 |
| `credential-pattern-gap-camel` | 1 | 4 | 2 | 3 |

#### Original-thirteen control

| Seed | Off found | Off missed | On found | On missed |
| --- | --- | --- | --- | --- |
| `expired-session-inversion` | 3 | 2 | 2 | 3 |
| `sensitive-value-exposure` | 5 | 0 | 4 | 1 |
| `cache-capacity-off-by-one` | 5 | 0 | 5 | 0 |
| `sql-interpolation` | 5 | 0 | 5 | 0 |
| `invalid-range-parsing` | 1 | 4 | 1 | 4 |
| `lexicographic-numeric-sort` | 5 | 0 | 5 | 0 |
| `lower-element-median` | 5 | 0 | 5 | 0 |
| `empty-word-title-casing` | 5 | 0 | 5 | 0 |
| `authorization-bypass` | 0 | 5 | 0 | 5 |
| `data-loss-overwrite` | 1 | 4 | 0 | 5 |
| `async-race-duplicate-processing` | 4 | 1 | 4 | 1 |
| `configuration-debug-default` | 0 | 5 | 0 | 5 |
| `stale-sha-review-publication` | 4 | 1 | 4 | 1 |

#### Paired precision legs

| Seed | Off found | Off missed | On found | On missed |
| --- | --- | --- | --- | --- |
| `expired-session-inversion` | 1 | 4 | 1 | 4 |
| `sensitive-value-exposure` | 5 | 0 | 3 | 2 |
| `cache-capacity-off-by-one` | 5 | 0 | 5 | 0 |
| `sql-interpolation` | 5 | 0 | 5 | 0 |
| `invalid-range-parsing` | 0 | 5 | 0 | 5 |
| `lexicographic-numeric-sort` | 5 | 0 | 5 | 0 |
| `lower-element-median` | 5 | 0 | 5 | 0 |
| `empty-word-title-casing` | 5 | 0 | 2 | 3 |
| `authorization-bypass` | 0 | 5 | 0 | 5 |
| `data-loss-overwrite` | 0 | 5 | 0 | 5 |
| `async-race-duplicate-processing` | 4 | 1 | 1 | 4 |
| `configuration-debug-default` | 0 | 5 | 0 | 5 |
| `stale-sha-review-publication` | 5 | 0 | 4 | 1 |
| `api-evidence-state-reconstruction` | 0 | 5 | 0 | 5 |
| `external-output-parsing-lossy` | 0 | 5 | 0 | 5 |
| `guard-fails-open` | 0 | 5 | 5 | 0 |
| `record-identity-drift` | 0 | 5 | 0 | 5 |
| `credential-pattern-gap-camel` | 1 | 4 | 4 | 1 |

### What the recall evidence shows

- **Overall recall: inconclusive, and no consistent difference is supported.**
  The mean recall difference (sweep on minus sweep off) is
  −0.011111 on the extended fixture, −0.046154 on the
  original-thirteen control, and −0.011111 on the recall pass of the
  precision legs: negative on all three, by 0.011111 to 0.046154
  in absolute value. In defects per run that is −0.2,
  −0.6, and −0.2. Within a leg the run-by-run
  differences are mixed in sign: 0, 0, −2, −1, +2 (extended),
  −3, +1, −1, +1, −1 (original-thirteen), 0, +1, 0, −2, 0 (precision), in found defects by
  run position. The two 18-seed legs share a recall-pass prompt, so pooling
  their 10 runs per arm is a descriptive convenience: mean recall
  0.472222 sweep off against 0.461111 sweep on. The per-run ranges of the
  two arms overlap on every leg: extended sweep-on
  0.388889–0.611111 against sweep-off
  0.444444–0.555556, original-thirteen control
  sweep-on 0.538462–0.692308 against sweep-off
  0.615385–0.846154, precision-leg recall pass
  sweep-on 0.444444–0.444444 against sweep-off
  0.388889–0.555556.
- **Spread: inconclusive, and no consistent difference either.** The population
  SD of per-run recall moves 0.041574 → 0.090267 on
  the extended fixture (wider),
  0.092308 → 0.068802 on the original-thirteen
  control (narrower), and
  0.054433 → 0.000000 on the recall pass of the
  precision legs (narrower). The widest sweep-on
  figure is the extended leg's (found 10, 8, 7, 7, 11 of 18, the high of
  11 at run position 4); the sweep-on precision-leg recall pass found
  8 of 18 in every run, which is why its SD is
  0.000000.
- **What a 5-run sample can and cannot show.** The between-arm mean differences
  (0.011111 to 0.046154 in absolute value) are smaller than or of the same order as
  the within-arm spread (population SD 0.041574 to 0.092308
  where non-zero), and the per-run ranges of the two arms overlap on every leg.
  Five runs per arm at this spread cannot tell a real change of a fraction of a
  defect per run from run-to-run variation, and a standard deviation estimated
  from five runs is itself imprecise, so neither a recall improvement nor a
  recall loss, nor a change in variance, is supported. What five runs can show
  is a large, repeatable, seed-specific change, and there is one (next point).
- **The largest seed-level movement observed is `guard-fails-open`.** It was
  found in 4 of 5 sweep-on runs on the extended
  fixture and 5 of 5 on the precision legs
  (9 of 10), and in 0 of 10 sweep-off runs. That is the
  largest repeatable seed-level change in these tables. It is an observation,
  not an attributed effect: the arms are not an admissible same-configuration
  comparison, so model drift between the arms can explain any between-arm
  difference here, this one included. It comes from a fixture in Ronda's own
  repository and says nothing about real pull requests. The harder credential
  seed moves less: `credential-pattern-gap-camel` was found in 1 of 5 sweep-off and 2 of 5
  sweep-on extended runs, and in 1 of 5 and 4 of 5 on the precision
  legs (2 of 10 against 6 of 10). `api-evidence-state-reconstruction`
  was found in 0 of 10 sweep-off and 2 of 10 sweep-on 18-seed runs
  (extended 0/5 to 2/5,
  precision legs 0/5 to 0/5).
  These are moves five runs cannot separate from variation, and the same non-attribution applies.
- **Some seeds were found less often in the sweep-on arm on some legs, recorded
  as observed, not as a finding of harm.** Found counts out of 5, sweep off to
  sweep on, on the extended / original-thirteen / precision legs (every seed
  listed is on all three legs):

  | Seed | Extended | Original-thirteen | Precision legs |
  | --- | --- | --- | --- |
  | `expired-session-inversion` | 4 to 0 | 3 to 2 | 1 to 1 |
  | `sensitive-value-exposure` | 5 to 5 | 5 to 4 | 5 to 3 |
  | `empty-word-title-casing` | 5 to 3 | 5 to 5 | 5 to 2 |
  | `data-loss-overwrite` | 0 to 0 | 1 to 0 | 0 to 0 |
  | `async-race-duplicate-processing` | 4 to 4 | 4 to 4 | 4 to 1 |
  | `stale-sha-review-publication` | 5 to 3 | 4 to 4 | 5 to 4 |

  The seed-level picture is mixed and these are small counts. Whether the sweep
  displaced those findings or the runs varied cannot be settled from five runs
  per arm; it is the observation a larger sample should test first.
- **Misses that coincide with an unmatched finding on the seed's own file occur
  in both arms.** Across the three legs, 23 of 117 sweep-off and 13 of 122 sweep-on
  seed misses (a seed missed in a run) carry a same-file finding among that run's
  unmatched findings. All 3 sweep-on runs that missed `sensitive-value-exposure` are of this kind
  (`src/benchmark/auth.ts`, line 3, titled as a hardcoded sensitive credential or secret);
  no sweep-off run missed it. For `credential-pattern-gap-camel` (`src/benchmark/credentials.ts`),
  6 of 8 sweep-off misses and 4 of 4 sweep-on misses
  carry a same-file unmatched finding: on the sweep-off arm at lines
  12 and 13 and on the sweep-on arm at line 3, each titled as
  a credential-redaction or credential-pattern gap. The seed's matcher credits
  particular wording, so this is consistent with the reviewer raising the finding
  in wording the lexical matcher does not credit, and it is not established that
  the reviewer failed to see the defect. That reading was not adjudicated finding by finding; it
  means the recall figures count only the findings the matcher credits, and the
  measured figure for these seeds may reflect matcher wording rather than a
  missing finding.
- **Four seeds were found in no run of either arm on any leg that contains
  them:** `authorization-bypass` and `configuration-debug-default` (all three
  legs, 0 of 30 runs each), and `external-output-parsing-lossy` and
  `record-identity-drift` (the two 18-seed legs, 0 of 20 runs each). Of the four
  defect kinds the 2026-09-10 baseline's calibration note identified as
  consistently missed, `authorization-bypass` and `configuration-debug-default`
  are found in none of these runs, `data-loss-overwrite` was found in 1 of the 30 runs that
  contain it (a sweep-off original-thirteen control run) and `invalid-range-parsing` in 2 of 30
  (one sweep-off and one sweep-on control run), so all four remain almost never found.
  The never-found set is the same under both arms.
- **Of the five AC12/AC13 seeds, two are never found under either arm:**
  `external-output-parsing-lossy` and `record-identity-drift`. The category
  `external-output-parsing` produced findings in none of the 15 sweep-on runs,
  and `record-identity` in 1 (a run of the
  original-thirteen control, whose fixture has no record-identity seed; see
  [Per-category attribution](#per-category-attribution-ac9)), so the sweep did not
  bring out either seeded defect. The other three are found only in some runs:
  `guard-fails-open` (0 of 10 sweep-off, 9 of 10 sweep-on),
  `credential-pattern-gap-camel` (2 of 10, 6 of 10), and
  `api-evidence-state-reconstruction` (0 of 10, 2 of 10). This is recorded
  as it stands: these seeds reflect the reviewer on this model, not the fixture.

## Precision evidence and the strict regression result (AC9)

### Paired precision runs

`--quality` runs a recall pass and a precision pass, so these legs record 2
model calls per run. The precision fixture is `harmless-session-refactor`,
expected clean. Its per-run record has the shape
`{"id": "harmless-session-refactor", "expected": "clean", "clean": true, "falsePositiveCount": 0, "falsePositives": []}`.

The unexpected findings below are read from each record's
`precisionFixtures[].falsePositiveCount` — the precision pass over the precision
fixture, which is what Use Case 4's test counts. They are **not** read from the
record's top-level `falsePositives`, which belongs to the same leg's recall pass
over the seeded benchmark (see [below](#recall-pass-false-positives-in-the-precision-legs)).

| Arm | Run position | Unexpected findings | Fixture clean |
| --- | --- | --- | --- |
| Sweep off | 0 | 0 | true |
| Sweep off | 1 | 0 | true |
| Sweep off | 2 | 0 | true |
| Sweep off | 3 | 0 | true |
| Sweep off | 4 | 0 | true |
| **Sweep off total** | | **0** | 5 of 5 clean |
| Sweep on | 0 | 0 | true |
| Sweep on | 1 | 0 | true |
| Sweep on | 2 | 0 | true |
| Sweep on | 3 | 0 | true |
| Sweep on | 4 | 0 | true |
| **Sweep on total** | | **0** | 5 of 5 clean |

`qualityCategories` is identical on all 10 precision runs. `comparisons` is
empty on every precision record.

### The strict no-tolerance test

The test from the spec, applied as written:

- **Clause 1 — total unexpected findings.** Sweep-on runs produced 0 unexpected
  findings in total; sweep-off runs produced 0, across the same precision
  fixture and the same sample count of 5. `0 > 0` is false, so **clause 1
  does not fire.**
- **Clause 2 — a fixture that was clean under every sweep-off run.** The only
  precision fixture, `harmless-session-refactor`, was clean in 5 of 5 sweep-off
  runs and clean in 5 of 5 sweep-on runs. No fixture that stayed clean in every
  sweep-off run failed to stay clean in a sweep-on run, so **clause 2 does not
  fire.**

**Precision regression result: computed as NOT REGRESSED, reported as
inconclusive.** The strict test does not fire on these records, but the arms are
not an admissible same-configuration comparison, so the reading carries no
comparison weight until the endpoint pin is attested. The counts that decided it
are
the totals above: sweep-off 0 unexpected findings `[0, 0, 0, 0, 0]` against
sweep-on 0 `[0, 0, 0, 0, 0]`, with the fixture clean in 5 of 5 runs on the sweep-off arm and 5 of 5 on the sweep-on arm.

Unexpected findings are counted as findings, not as category attributions: a
finding attributed to more than one category counts once toward the total. The
test has no tolerance, and none was applied here. With no precision-fixture
finding on either arm, no sweep-on unexpected finding exists to attribute to a
category and no sweep-off unexpected finding exists to report as unattributed.
The precision fixture's own per-category record on the sweep-on runs agrees:
in all 5 runs every category is `produced_none`, with 0 published findings and
an uncategorized count of 0.

This result rests on one precision fixture. A single clean fixture detects a
sweep that manufactures findings on harmless code; it cannot measure a smaller
precision change, so the computed reading here means only that this fixture
stayed clean on both arms.

No product code implements this test; it is an operator read, recorded here.
Under Use Case 4, the available action is to accept the result, or to record
a regression and revise or narrow the category list. This record states the
result and takes no action on it.

### Recall-pass false positives in the precision legs

Each precision leg's recall pass also reviewed the seeded benchmark, and those
passes raised findings that match no seeded defect. They are the record's
top-level `falsePositives`. They are recall-side noise on the benchmark, not
precision-fixture findings, and they do not enter the strict test above.

| Arm | Run position | Recall-pass false positives |
| --- | --- | --- |
| Sweep off | 0 | 2 |
| Sweep off | 1 | 3 |
| Sweep off | 2 | 1 |
| Sweep off | 3 | 2 |
| Sweep off | 4 | 1 |
| **Sweep off total** | | **9** |
| Sweep on | 0 | 0 |
| Sweep on | 1 | 2 |
| Sweep on | 2 | 1 |
| Sweep on | 3 | 0 |
| Sweep on | 4 | 1 |
| **Sweep on total** | | **4** |

The other two legs' recall passes record the same field:

| Leg | Sweep off per run | Sweep off total | Sweep on per run | Sweep on total |
| --- | --- | --- | --- | --- |
| Extended fixture | 3, 4, 2, 2, 2 | 13 | 1, 1, 2, 1, 1 | 6 |
| Original-thirteen control | 1, 1, 1, 0, 0 | 3 | 0, 0, 1, 2, 0 | 3 |
| Paired precision | 2, 3, 1, 2, 1 | 9 | 0, 2, 1, 0, 1 | 4 |

These totals are descriptive. No test in the spec is stated over them, and no
regression claim is made from them. The sweep-on total is lower on the precision legs
(4 against 9) and on the extended fixture (6 against
13), and equal on the control (3 against 3). Those are
observations, not a claim that the sweep reduces noise: five runs cannot separate the
arms, and the between-arm comparison is inconclusive.

#### Recall-pass false positives, by run

| Arm | Run position | Path | Line | Severity | Title |
| --- | --- | --- | --- | --- | --- |
| Sweep off | 0 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion bypasses type safety |
| Sweep off | 0 | `src/benchmark/guard.ts` | 10 | important | Policy failure defaults to permissive behavior |
| Sweep off | 1 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion bypasses type safety |
| Sweep off | 1 | `src/benchmark/jobs.ts` | 5 | important | Race condition in job processing |
| Sweep off | 1 | `src/benchmark/credentials.ts` | 12 | important | Insufficient credential redaction pattern |
| Sweep off | 2 | `src/benchmark/credentials.ts` | 13 | important | Insufficient credential redaction pattern |
| Sweep off | 3 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion bypasses type safety |
| Sweep off | 3 | `src/benchmark/credentials.ts` | 14 | blocking | Credentials leaked in describeRequest output |
| Sweep off | 4 | `src/benchmark/credentials.ts` | 12 | important | Credential redaction only checks key name, not value content |
| Sweep on | 1 | `src/benchmark/git-history.ts` | 7 | important | Branch head inference from commit list is unreliable |
| Sweep on | 1 | `src/benchmark/credentials.ts` | 3 | important | Credential redaction pattern matches only exact 'token' name |
| Sweep on | 2 | `src/benchmark/auth.ts` | 3 | blocking | Hardcoded sensitive credential exposed in logging |
| Sweep on | 4 | `src/benchmark/auth.ts` | 3 | blocking | Hardcoded sensitive credential exposed in logging |

Every title above is a finding description. None contains a credential value,
token, or authorization value; a title that mentions `token` names the field the
finding is about, not a value. The AC14 scan in plan step 14 runs over these
artifacts and must come back green; this list is not a substitute for it.

## Per-category attribution (AC9)

`sweepPassRecord` is present on all sweep-on records and absent from all
sweep-off records, and `sweepListVersion` is `sweep-categories-v1` on every
sweep-on record and absent from sweep-off. The list version is read from each
sweep-on record, not from the list file.

A sweep-off pass has no per-category pass record, so **a sweep-off unexpected
finding is reported as unattributed.**

### Per-category outcomes across the 15 sweep-on runs

| Category identifier | Runs producing findings | Runs producing none |
| --- | --- | --- |
| `pr-head-push-order` | 4 | 11 |
| `credential-pattern-gap` | 4 | 11 |
| `external-output-parsing` | 0 | 15 |
| `record-identity` | 1 | 14 |
| `guard-fails-open` | 10 | 5 |

### Published findings attributed

Across the 15 sweep-on runs, 136 findings were published: 19 were attributed to
at least one category and 117 were uncategorized. Per-category attribution of
published findings:

| Category identifier | Published findings attributed |
| --- | --- |
| `guard-fails-open` | 10 |
| `pr-head-push-order` | 4 |
| `credential-pattern-gap` | 4 |
| `record-identity` | 1 |
| `external-output-parsing` | 0 |

No published finding in this campaign was attributed to more than one category,
so the attribution total and the attributed-finding total coincide at 19. The
record carries each finding's publication index and its category identifiers,
never the finding's own text. These are the recall passes' findings; the
precision fixture's passes published none (see above).

**Reading the two tables together:** `guard-fails-open` produced findings in
10 of 15 sweep-on runs, `pr-head-push-order` and `credential-pattern-gap`
in 4 of 15 each, and `record-identity` in 1, so those categories are doing
attribution work on these fixtures. `external-output-parsing` produced none in any of
the 15 runs. The one `record-identity` run is on the original-thirteen control, whose
fixture has no record-identity seed, and none of the 10 sweep-on 18-seed runs (which
do contain that seed) produced one, so the seed was not brought out. `credential-pattern-gap`
produced findings in 4 of the 10 sweep-on 18-seed runs, and `credential-pattern-gap-camel` was found in
6 of those 10; both were true together in 3 runs, so the category record and
the seed's matcher do not line up run by run. That is a statement about these fixtures, not about the
categories' value on real pull requests.

## Cost evidence (AC11)

**No cost ceiling applies to this feature, so no cost figure fails it.**

The comparative claim is stated over the two metrics AC11 names, each paired by
run position within each configuration's identical run sequence and averaged
across those runs. Standalone or aggregated figures do not support the claim
and are not used here.

### Model calls per pass

| Leg | Sweep off per run | Sweep on per run | Paired differences (on − off) | Paired mean |
| --- | --- | --- | --- | --- |
| Extended fixture | 1, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 | 0.0 |
| Original-thirteen control | 1, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 | 0.0 |
| Paired precision | 2, 2, 2, 2, 2 | 2, 2, 2, 2, 2 | 0, 0, 0, 0, 0 | 0.0 |

The sweep adds no model call on any leg. The precision legs take 2 calls per
pass because `--quality` runs a recall pass and a precision pass; both arms pay
that identically.

### Elapsed time per pass

| Leg | Sweep off per run (ms) | Sweep on per run (ms) | Paired differences (on − off, ms) | Paired mean (ms) |
| --- | --- | --- | --- | --- |
| Extended fixture | 21246, 16284, 14641, 15942, 16383 | 18409, 14475, 15897, 12095, 18877 | −2837, −1809, +1256, −3847, +2494 | −948.6 |
| Original-thirteen control | 20379, 12948, 14307, 12198, 13127 | 13858, 14685, 11025, 16612, 10893 | −6521, +1737, −3282, +4414, −2234 | −1177.2 |
| Paired precision | 17218, 15533, 15108, 17858, 14951 | 15732, 20293, 14652, 14201, 14682 | −1486, +4760, −456, −3657, −269 | −221.6 |

Per-arm figures for each leg, read from the same records:

| Leg | Arm | Mean (ms) | Min (ms) | Max (ms) |
| --- | --- | --- | --- | --- |
| Extended fixture | Sweep off | 16899.2 | 14641 | 21246 |
| Extended fixture | Sweep on | 15950.6 | 12095 | 18877 |
| Original-thirteen control | Sweep off | 14591.8 | 12198 | 20379 |
| Original-thirteen control | Sweep on | 13414.6 | 10893 | 16612 |
| Paired precision | Sweep off | 16133.6 | 14951 | 17858 |
| Paired precision | Sweep on | 15912 | 14201 | 20293 |

Both configurations' figures are recorded above. The paired means are negative on
all three legs (−948.6, −1177.2, and −221.6 ms), but the paired differences within each leg
are mixed in sign and each mean is smaller than the population SD of its own paired differences
(2426, 3843, 2767 ms), so no consistent elapsed-time difference is observed, and the
comparison is inconclusive. The largest single figure, 21246 ms, is a sweep-off extended run
(position 0). The six legs
appear to have run concurrently (see
[Provenance](#provenance)), so these figures were likely taken under shared
load and are not a quiet measurement of per-pass latency.

### Against the recorded baseline

The comparison target is
[`cost-convergence-baseline-2026-09-23.md`](cost-convergence-baseline-2026-09-23.md),
whose repository-wide Actions audit records the Ronda review row as
`0` jobs, `0.0 m` wall time, `0%` of wall time, `0 m` runner minutes, `0%` of
runner minutes.

**That baseline contains no Ronda pass cost at all — Ronda accounted for none
of the Actions time in that window — so it supplies no Ronda figure to compare
against.** The sweep-off arm of each leg above is the only same-shape cost
comparison available, and it is the comparison used. No claim is made here
about how this feature's cost relates to any pre-#103 window.

## Baseline comparability

The historical baseline is
[`review-quality-baseline-2026-09-10.md`](review-quality-baseline-2026-09-10.md):
command `npm run benchmark:quality -- --comparison-file
tests/fixtures/recall-benchmark/comparisons/clean-agreement.json
--reviewed-target quality-same-head-smoke`, sample count 5, model `qwen-plus`,
per-run seeded found 7, 8, 8, 8, 6 of 13, false positives 1, 0, 0, 0, 0, and
precision clean in all 5 runs.

**That baseline is labeled non-comparable, at every site this criterion
governs.** It records only a command, a sample count, and a mutable model
alias (`qwen-plus`) — no prompt revision, inference parameters, or immutable
model identity. This campaign ran against the dated snapshot
`qwen-plus-2025-12-01` at temperature 0, and nothing shows that the baseline's
alias resolved to that snapshot on 2026-09-10, so a difference between the two
could lie in the prompt, the parameters, or the model. No run above is
classified as baseline reproduction, and no field of the baseline is compared
against the recorded identity, nor is any figure from it carried into a
comparison here. Its recall figures are reproduced in this section only to
identify the document; they are not compared against the campaign.

The 2026-09-10 baseline is admissible for nothing except the observation that
the defect kinds it identified as consistently missed are still mostly missed —
and that observation is grounded in this campaign's own legs, not in the
baseline's numbers: see the never-found set under
[What the recall evidence shows](#what-the-recall-evidence-shows).

## Regression-gate status (AC17)

**The seeded benchmark is not a regression gate until the fixture cases
required by AC12 and AC13 exist.**

The operator may declare the extended fixture ready to serve as the basis of a
regression gate, once the cases required by Use Case 5 exist: a seeded case for
each of the four real themes that had no fixture representation, and at least
one credential-pattern case that is harder than the existing always-found
sensitive-value case. The declaration is recorded per Use Case 5. **This
declaration has not been made, and no benchmark result is treated as a gate.**

**What a restored gate rejects — its pass/fail contract — is a deferred
decision**, so the declaration alone makes no benchmark result pass or fail,
including the precision result recorded above. Acting on any benchmark result
is a human decision that is recorded with the evidence.

## Constraints this evidence does not resolve

- **Independence.** All evidence here is drawn from Ronda's own repository and
  the seeded fixture its prompts were written against, so every effect claim
  above is labeled **own-repository**. No claim asserts corroboration in
  another repository, and none is required.
- **Real-pull-request evidence is absent by design.** At ship time this record
  stands at `fixture_only` with zero counted pull requests; see
  [`sweep-real-pr-evidence.md`](sweep-real-pr-evidence.md). The ten-pull-request
  count accumulates over time, and nothing in this document may be read as a
  real-PR effect claim.
- **The frozen status of the model snapshot is unverified.** The configuration
  is not established as a same-configuration one; see
  [Model identity](#model-identity-and-version-attestation): a provider-named
  dated snapshot, reported consistently on every request, with the provider's
  naming as the only basis for treating it as frozen. AC8 and AC9 stay open on
  that point.
- **A 5-run sample cannot resolve small effects.** The campaign observed
  seed-level movements (notably `guard-fails-open`), not attributed effects, and no
  consistent overall recall, variance, or elapsed-time difference; it does not show that the sweep leaves
  recall unchanged either.
