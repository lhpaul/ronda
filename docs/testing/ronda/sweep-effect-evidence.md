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

**This set replaces earlier sets.** The previous set (feature commit `0542d9e`)
is superseded because the `external-output-parsing-lossy` seed's patch did not
contain its defect: the patch was a plausible bullet parser, and the seed was
found in 0 of the 20 runs of that set that contain it (the previous set had
30 runs in all). Feature commit `5d4b413` rewrote that patch so it states the
external tool's item formats, carries a sample of all three, and keeps a parser
that loses two of the three; that changed the extended fixture's
`patchesSha256`, and the whole campaign was re-recorded. The set before that
was superseded likewise for the `credential-pattern-gap-camel` seed, whose patch
did not contain its defect either (found in 0 of the 20 runs that
contain it). The manifest and the original-thirteen control's inputs did not
change. The records also replace a still earlier campaign that ran against the
mutable alias `qwen-plus`. No figure or seed-level statement from any earlier
set is used here.

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
| `sweep-off-extended.json` | `8faef7359860d3460cd5c9bb9cf1390311dc16536e0cd7f0b5dc53406b91607a` |
| `sweep-on-extended.json` | `ee0c47bbe6d2c77909adb3d37b13f914c94d90fcefaa198278e4d77175f062fa` |
| `sweep-off-original-thirteen.json` | `0915900f5c3a1813119af432a5910269f691c82dcffac2172310f0ee680ef9d3` |
| `sweep-on-original-thirteen.json` | `3073ead2cd701e985c093fab795496904e52c9e512cb782909ad3cf5d8b0699c` |
| `sweep-off-precision.json` | `02224e29c510f4145e928653eac8f4f3d6f8a8c81c7827990232138905536cd2` |
| `sweep-on-precision.json` | `b34f00f2544bbdd29ad60b6e924e537e4feb44b242a430e95801cc000feb9f38` |

Run timestamps (first–last record per file, in array order), read from each
record's `timestamp`:

| File | First | Last |
| --- | --- | --- |
| `sweep-off-extended.json` | 2026-09-29T11:09:27.512Z | 2026-09-29T11:10:50.133Z |
| `sweep-on-extended.json` | 2026-09-29T11:09:27.506Z | 2026-09-29T11:10:31.729Z |
| `sweep-off-original-thirteen.json` | 2026-09-29T11:09:27.508Z | 2026-09-29T11:10:16.100Z |
| `sweep-on-original-thirteen.json` | 2026-09-29T11:09:27.506Z | 2026-09-29T11:10:19.244Z |
| `sweep-off-precision.json` | 2026-09-29T11:09:27.507Z | 2026-09-29T11:10:34.044Z |
| `sweep-on-precision.json` | 2026-09-29T11:09:27.508Z | 2026-09-29T11:10:27.491Z |

The six files' first records are stamped within 6 ms of one another
(2026-09-29T11:09:27.506Z to 2026-09-29T11:09:27.512Z), and the whole campaign spans 2026-09-29T11:09:27.506Z to
2026-09-29T11:10:50.133Z. That is consistent with the six legs having run concurrently, not
one after another as the command listing reads; the five runs inside each file
are sequential. The legs appear to have run concurrently against one provider
endpoint, so the elapsed-time figures under [Cost evidence](#cost-evidence-ac11)
were likely taken under that shared load. It applies to both arms alike, and it
is stated here because it bears on how far those figures can be read.

Reviewed target: `issue-15-recall-benchmark` on every record in every file.

Driver commit: the campaign ran from `5d4b413`, the head of the feature branch
`feature/105-category-forced-review-sweep` ([#118](https://github.com/lhpaul/ronda/pull/118))
at run time, so the executable source, the fixtures, and the recorded category
list the campaign ran are the ones at that commit. The fixture hashes recorded in
each record's own `fixture` block match the content of the manifest and patch
files at `5d4b413`. The extended fixture's `patchesSha256` differs from the
previous set's because that commit rewrote the `external-output-parsing-lossy`
seed's patch; its `manifestSha256` and the original-thirteen control's hashes
are unchanged.

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
`durabilityMode`, `durabilityModeApplied`, `durabilityModeDefault`, `maxPatchChars`, `modelName`, `promptFingerprint`, `requestParameters`, `requests`, `versionAttestation`. The shared values are `maxPatchChars`
400000, `durabilityMode` `default` (`durabilityModeDefault`
false), and `requestParameters`
`{"temperature": 0}`. The `configuration` block contains no credential field.

`durabilityMode` and `durabilityModeDefault` are configured values, recorded as
configuration only. The benchmark's prompts carry no durability instructions or
mode document, and every one of the 30 records carries
`durabilityModeApplied: false`, which the driver writes to state that the
benchmark never applies the durability mode. The recorded `default` is therefore
the operator's configured value, not a mode that shaped any request, and it is
not a variable of this campaign.

Fixture version, read from each record's own `fixture` block:

| Leg | `manifestPath` | `benchmarkId` | `seedCount` | `manifestSha256` | `patchesSha256` |
| --- | --- | --- | --- | --- | --- |
| Extended / precision | `tests/fixtures/recall-benchmark/manifest.json` | `issue-15-recall-benchmark` | 18 | `8c8a8e3b5300d458239a5c02784b14dd58bfc513106095e8a534b9524a1ab325` | `5108572af57b51eda6d4c0ee44d923df894971415f2eaa8c24bc9f6c4c188a8d` |
| Original-thirteen control | `tests/fixtures/recall-benchmark/original-thirteen/manifest.json` | `issue-15-recall-benchmark` | 13 | `1ff80de715d320db744f0b866b51df1c7501e952fce63dfa48ef60a1529eb497` | `e548bd03e17accf6f003d16c361c941fb26d57cddd23e2f8999443d98f0e1b61` |

The original-thirteen control shares the extended fixture's `benchmarkId` (the
snapshot is a byte-identical copy) and is nonetheless distinct evidence: it
differs by `manifestPath`, by `seedCount`, and by both content hashes, so it is
demonstrably not the extended fixture re-run. Note that it also carries a
different `promptFingerprint` (`42c6d53f…`) than the
extended and precision legs (`8636d575…`), because the prompt embeds
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
| Sweep off | 9, 7, 9, 8, 9 | 0.500000, 0.388889, 0.500000, 0.444444, 0.500000 | 0.388889 | 0.500000 | 0.044444 | 0.466667 |
| Sweep on | 11, 9, 7, 7, 7 | 0.611111, 0.500000, 0.388889, 0.388889, 0.388889 | 0.388889 | 0.611111 | 0.088889 | 0.455556 |

All 18 seeds were present in every run of both arms (no seed reported absent
from the fixture), so the denominator is 18 throughout.

### Original-thirteen control — 13 seeded defects, sample count 5

| Arm | Per-run found (of 13) | Per-run recall | Low | High | Population SD | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| Sweep off | 10, 6, 9, 8, 8 | 0.769231, 0.461538, 0.692308, 0.615385, 0.615385 | 0.461538 | 0.769231 | 0.102050 | 0.630769 |
| Sweep on | 9, 8, 7, 5, 7 | 0.692308, 0.615385, 0.538462, 0.384615, 0.538462 | 0.384615 | 0.692308 | 0.102050 | 0.553846 |

The recall denominator here is the fixture's 13 seeds, not the confirmed-defect
denominator AC15(d)'s real-pull-request tier uses, so this fixture comparison is
never reported as not applicable for want of a confirmed defect.

### Recall pass of the paired precision legs — 18 seeded defects, sample count 5

The `--quality` legs also run the recall pass, on the same extended fixture and
prompt. Their recall figures are reported for completeness, and are read from
the same fields as above.

| Arm | Per-run found (of 18) | Per-run recall | Low | High | Population SD | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| Sweep off | 8, 7, 8, 7, 8 | 0.444444, 0.388889, 0.444444, 0.388889, 0.444444 | 0.388889 | 0.444444 | 0.027217 | 0.422222 |
| Sweep on | 7, 7, 7, 6, 7 | 0.388889, 0.388889, 0.388889, 0.333333, 0.388889 | 0.333333 | 0.388889 | 0.022222 | 0.377778 |

### Original-thirteen subset, read from the extended runs

Each extended run record carries an `originalThirteenSubset` block: the
13-seed original fixture evaluated against the same run's 18-seed patch set.
This is reported separately from the standalone original-thirteen control
above, because the two answer different questions — the subset holds the patch
set fixed and narrows the seed list, while the control changes both.

| Arm | Subset run positions 0–4 (seeds) | Subset run positions 0–4 (found) | Subset run positions 0–4 (misses) | Subset recall (of 13) |
| --- | --- | --- | --- | --- |
| Sweep off (extended) | 13, 13, 13, 13, 13 | 9, 7, 9, 8, 9 | 4, 6, 4, 5, 4 | 0.692308, 0.538462, 0.692308, 0.615385, 0.692308 |
| Sweep on (extended) | 13, 13, 13, 13, 13 | 8, 6, 5, 4, 5 | 5, 7, 8, 9, 8 | 0.615385, 0.461538, 0.384615, 0.307692, 0.384615 |

### Per-defect found and missed counts

Counts are out of the 5 runs of the leg, read from each record's
`foundSeededDefects` and `missedSeededDefects` arrays.

#### Extended fixture

| Seed | Off found | Off missed | On found | On missed |
| --- | --- | --- | --- | --- |
| `expired-session-inversion` | 3 | 2 | 1 | 4 |
| `sensitive-value-exposure` | 5 | 0 | 1 | 4 |
| `cache-capacity-off-by-one` | 5 | 0 | 5 | 0 |
| `sql-interpolation` | 5 | 0 | 5 | 0 |
| `invalid-range-parsing` | 0 | 5 | 0 | 5 |
| `lexicographic-numeric-sort` | 5 | 0 | 5 | 0 |
| `lower-element-median` | 5 | 0 | 5 | 0 |
| `empty-word-title-casing` | 4 | 1 | 1 | 4 |
| `authorization-bypass` | 0 | 5 | 0 | 5 |
| `data-loss-overwrite` | 1 | 4 | 0 | 5 |
| `async-race-duplicate-processing` | 4 | 1 | 2 | 3 |
| `configuration-debug-default` | 0 | 5 | 0 | 5 |
| `stale-sha-review-publication` | 5 | 0 | 3 | 2 |
| `api-evidence-state-reconstruction` | 0 | 5 | 3 | 2 |
| `external-output-parsing-lossy` | 0 | 5 | 1 | 4 |
| `guard-fails-open` | 0 | 5 | 5 | 0 |
| `record-identity-drift` | 0 | 5 | 0 | 5 |
| `credential-pattern-gap-camel` | 0 | 5 | 4 | 1 |

#### Original-thirteen control

| Seed | Off found | Off missed | On found | On missed |
| --- | --- | --- | --- | --- |
| `expired-session-inversion` | 4 | 1 | 3 | 2 |
| `sensitive-value-exposure` | 5 | 0 | 1 | 4 |
| `cache-capacity-off-by-one` | 5 | 0 | 5 | 0 |
| `sql-interpolation` | 5 | 0 | 5 | 0 |
| `invalid-range-parsing` | 0 | 5 | 1 | 4 |
| `lexicographic-numeric-sort` | 5 | 0 | 5 | 0 |
| `lower-element-median` | 5 | 0 | 5 | 0 |
| `empty-word-title-casing` | 4 | 1 | 2 | 3 |
| `authorization-bypass` | 0 | 5 | 0 | 5 |
| `data-loss-overwrite` | 1 | 4 | 0 | 5 |
| `async-race-duplicate-processing` | 3 | 2 | 4 | 1 |
| `configuration-debug-default` | 0 | 5 | 0 | 5 |
| `stale-sha-review-publication` | 4 | 1 | 5 | 0 |

#### Paired precision legs

| Seed | Off found | Off missed | On found | On missed |
| --- | --- | --- | --- | --- |
| `expired-session-inversion` | 0 | 5 | 1 | 4 |
| `sensitive-value-exposure` | 5 | 0 | 0 | 5 |
| `cache-capacity-off-by-one` | 5 | 0 | 5 | 0 |
| `sql-interpolation` | 5 | 0 | 5 | 0 |
| `invalid-range-parsing` | 0 | 5 | 0 | 5 |
| `lexicographic-numeric-sort` | 5 | 0 | 5 | 0 |
| `lower-element-median` | 5 | 0 | 5 | 0 |
| `empty-word-title-casing` | 5 | 0 | 0 | 5 |
| `authorization-bypass` | 0 | 5 | 0 | 5 |
| `data-loss-overwrite` | 0 | 5 | 0 | 5 |
| `async-race-duplicate-processing` | 5 | 0 | 1 | 4 |
| `configuration-debug-default` | 0 | 5 | 0 | 5 |
| `stale-sha-review-publication` | 2 | 3 | 1 | 4 |
| `api-evidence-state-reconstruction` | 0 | 5 | 0 | 5 |
| `external-output-parsing-lossy` | 0 | 5 | 2 | 3 |
| `guard-fails-open` | 0 | 5 | 5 | 0 |
| `record-identity-drift` | 0 | 5 | 0 | 5 |
| `credential-pattern-gap-camel` | 1 | 4 | 4 | 1 |

### What the recall evidence shows

- **Overall recall: inconclusive, and not read as an effect.** The mean recall
  difference (sweep on minus sweep off) is −0.011111 on the extended fixture,
  −0.076923 on the original-thirteen control, and −0.044444 on the recall pass of
  the precision legs: sweep on is lower on all three legs as observed, by
  0.011111 to 0.076923 in absolute value. In defects per run that is
  −0.2, −1.0, and −0.8. The run-by-run
  differences in found defects, by run position, are +2, +2, −2, −1, −2
  (extended), −1, +2, −2, −3, −1 (original-thirteen), and
  −1, 0, −1, −1, −1 (precision-leg recall pass): mixed in sign on
  the first two, never positive on the third. The two 18-seed legs share a
  recall-pass prompt, so pooling their 10 runs per arm is a descriptive
  convenience: mean recall 0.444444 sweep off against 0.416667
  sweep on. The per-run ranges of the two arms overlap on the extended fixture
  (sweep-on 0.388889–0.611111 against sweep-off 0.388889–0.500000) and on the
  original-thirteen control (sweep-on 0.384615–0.692308 against sweep-off
  0.461538–0.769231), and only touch, at the single value
  0.388889, on the precision-leg recall pass (sweep-on
  0.333333–0.388889 against sweep-off 0.388889–0.444444).
- **Spread: inconclusive.** The population SD of per-run recall moves
  0.044444 → 0.088889 on the extended
  fixture (wider), 0.102050 → 0.102050 on the
  original-thirteen control (unchanged at six places), and
  0.027217 → 0.022222 on the recall pass of
  the precision legs (narrower). The widest sweep-on figure is the extended leg's
  (found 11, 9, 7, 7, 7 of 18, the high of 11 at run
  position 0).
- **What a 5-run sample can and cannot show.** On the extended fixture and the
  control the between-arm mean difference (0.011111 and 0.076923 in absolute
  value) is smaller than the within-arm spread (population SD
  0.044444 to
  0.102050), and the per-run ranges overlap. On the
  precision-leg recall pass the mean difference (0.044444) is larger than
  either arm's spread (0.027217 and 0.022222), the
  differences are never positive, and the ranges only touch; that is the leg
  where the observed direction is most consistent, and it is one leg of five
  runs per arm. It is not set apart from run-to-run variation by the records
  themselves: the extended and precision legs' recall passes ran the same prompt
  on the same fixture, and their arms already differ from each other by
  0.044444 (sweep off) and 0.077778 (sweep on) in mean recall, the same order as the
  between-arm differences. Five runs per arm cannot tell a real change of a
  fraction of a defect per run from run-to-run variation, and a standard
  deviation estimated from five runs is itself imprecise, so neither a recall
  improvement nor a recall loss, nor a change in variance, is supported. What
  five runs can show is a large, repeatable, seed-specific change, and there are
  several (next point).
- **The largest seed-level movements observed run in both directions.**
  `guard-fails-open` was found in 10 of 10 sweep-on 18-seed runs (extended
  5/5, precision legs 5/5) and in 0 of 10 sweep-off
  runs. `sensitive-value-exposure` moved the other way and by more: found in
  15 of 15 sweep-off runs (extended 5/5, control
  5/5, precision legs 5/5) and in 2 of 15 sweep-on runs (extended
  1/5, control 1/5, precision legs 0/5). All 13
  sweep-on misses of it carry a same-file unmatched finding on
  `src/benchmark/auth.ts` (lines 2, 3, titled as a hardcoded, exposed, or
  sensitive value or credential), so they are consistent with the reviewer raising the
  finding in wording the lexical matcher does not credit; that is not
  adjudicated finding by finding. The harder credential seed
  `credential-pattern-gap-camel` was found in 1 of 10 sweep-off and
  8 of 10 sweep-on 18-seed runs (extended 0/5 to 4/5, precision legs 1/5 to 4/5),
  `api-evidence-state-reconstruction` in 0 of 10 and
  3 of 10 (extended 0/5 to 3/5, precision legs 0/5 to 0/5), and
  `external-output-parsing-lossy`, the seed whose patch was rewritten for this
  set, in 0 of 10 and 3 of 10 (extended 0/5 to 1/5, precision legs 0/5 to 2/5). These
  are observations, not attributed effects: the arms are not an admissible
  same-configuration comparison, so model drift between the arms can explain any
  between-arm difference here, these included, and five runs cannot separate them
  from variation. They come from a fixture in Ronda's own repository and say
  nothing about real pull requests.
- **Some seeds were found less often in the sweep-on arm on some legs, recorded
  as observed, not as a finding of harm.** Found counts out of 5, sweep off to
  sweep on, on the extended / original-thirteen / precision legs (every seed
  listed is on all three legs; `sensitive-value-exposure` is the large one above):

  | Seed | Extended | Original-thirteen | Precision legs |
  | --- | --- | --- | --- |
  | `expired-session-inversion` | 3 to 1 | 4 to 3 | 0 to 1 |
  | `sensitive-value-exposure` | 5 to 1 | 5 to 1 | 5 to 0 |
  | `empty-word-title-casing` | 4 to 1 | 4 to 2 | 5 to 0 |
  | `data-loss-overwrite` | 1 to 0 | 1 to 0 | 0 to 0 |
  | `async-race-duplicate-processing` | 4 to 2 | 3 to 4 | 5 to 1 |
  | `stale-sha-review-publication` | 5 to 3 | 4 to 5 | 2 to 1 |

  The seed-level picture is mixed and these are mostly small counts. Whether the
  sweep displaced those findings or the runs varied cannot be settled from five
  runs per arm; it is the observation a larger sample should test first.
- **Misses that coincide with an unmatched finding on the seed's own file occur
  in both arms.** Across the three legs, 34 of 124 sweep-off and 23 of 134 sweep-on
  seed misses (a seed missed in a run) carry a same-file finding among that run's
  unmatched findings. Besides the 13 sweep-on `sensitive-value-exposure` misses
  above (no sweep-off run missed it): `external-output-parsing-lossy`
  (`src/benchmark/output.ts`) has 9 of 10 sweep-off and
  6 of 7 sweep-on misses with a same-file unmatched finding (lines
  14, 15 on the sweep-off arm and 13, 14, 15 on the sweep-on arm, titled as
  a parsing, line-filtering, or classification problem), and
  `credential-pattern-gap-camel` (`src/benchmark/credentials.ts`) has 7 of
  9 sweep-off and 2 of 2 sweep-on misses with one (line 13 on the sweep-off
  arm and line 3 on the sweep-on arm, each titled as a credential-redaction or
  credential-pattern gap). The seed's matcher credits particular wording, so
  this is consistent with the reviewer raising the finding in wording the
  lexical matcher does not credit, and it is not established that the reviewer
  failed to see the defect. That reading was not adjudicated finding by
  finding; it means the recall figures count only the findings the matcher
  credits, and the measured figure for these seeds may reflect matcher wording
  rather than a missing finding.
- **Three seeds were found in no run of either arm on any leg that contains
  them:** `authorization-bypass` and `configuration-debug-default` (all three
  legs, 0 of 30 runs each), and `record-identity-drift` (the two 18-seed legs,
  0 of 20 runs). Of the four defect kinds the 2026-09-10
  baseline's calibration note identified as consistently missed,
  `authorization-bypass` and `configuration-debug-default` are found in none of
  these runs, `data-loss-overwrite` was found in 2 of 30 runs that contain it
  (one sweep-off extended run and one sweep-off control run) and
  `invalid-range-parsing` in 1 of 30 (one sweep-on control run), so all four
  remain almost never found. The never-found set is the same under both arms.
- **Of the five AC12/AC13 seeds, one is never found under either arm:**
  `record-identity-drift`. The category `record-identity` produced findings in
  0 of the 10 sweep-on 18-seed runs, and in 1 run of the original-thirteen
  control, whose fixture has no record-identity seed (see
  [Per-category attribution](#per-category-attribution-ac9)), so the sweep did not
  bring out that seeded defect. The other four are found only in some runs:
  `guard-fails-open` (0 of 10 sweep-off, 10 of 10 sweep-on),
  `credential-pattern-gap-camel` (1 of 10, 8 of 10),
  `api-evidence-state-reconstruction` (0 of 10, 3 of 10), and
  `external-output-parsing-lossy` (0 of 10, 3 of 10). The rewritten
  `external-output-parsing-lossy` patch is found in 3 of 20 runs of this set, against
  0 of 20 in the previous set's. This is recorded as it stands: these
  seeds reflect the reviewer on this model, not the fixture.

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
| Sweep off | 0 | 1 |
| Sweep off | 1 | 4 |
| Sweep off | 2 | 2 |
| Sweep off | 3 | 4 |
| Sweep off | 4 | 2 |
| **Sweep off total** | | **13** |
| Sweep on | 0 | 1 |
| Sweep on | 1 | 2 |
| Sweep on | 2 | 2 |
| Sweep on | 3 | 2 |
| Sweep on | 4 | 1 |
| **Sweep on total** | | **8** |

The other two legs' recall passes record the same field:

| Leg | Sweep off per run | Sweep off total | Sweep on per run | Sweep on total |
| --- | --- | --- | --- | --- |
| Extended fixture | 4, 1, 6, 5, 4 | 20 | 3, 2, 1, 1, 4 | 11 |
| Original-thirteen control | 1, 0, 0, 0, 0 | 1 | 1, 0, 1, 1, 1 | 4 |
| Paired precision | 1, 4, 2, 4, 2 | 13 | 1, 2, 2, 2, 1 | 8 |

These totals are descriptive. No test in the spec is stated over them, and no
regression claim is made from them. The sweep-on total is lower on the precision legs
(8 against 13) and on the extended fixture (11 against
20), and higher on the control (4 against 1). Those are
observations, not a claim that the sweep changes noise: five runs cannot separate the
arms, and the between-arm comparison is inconclusive.

#### Recall-pass false positives, by run

| Arm | Run position | Path | Line | Severity | Title |
| --- | --- | --- | --- | --- | --- |
| Sweep off | 0 | `src/benchmark/credentials.ts` | 13 | important | Credential redaction only matches exact field name 'authToken' |
| Sweep off | 1 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion in updateProfile |
| Sweep off | 1 | `src/benchmark/output.ts` | 14 | nit | Overly restrictive line filtering |
| Sweep off | 1 | `src/benchmark/guard.ts` | 10 | important | Overly permissive error handling |
| Sweep off | 1 | `src/benchmark/credentials.ts` | 13 | important | Insufficient credential redaction pattern |
| Sweep off | 2 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion bypassing type safety |
| Sweep off | 2 | `src/benchmark/output.ts` | 15 | nit | Overly narrow line filtering |
| Sweep off | 3 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion bypasses type safety |
| Sweep off | 3 | `src/benchmark/output.ts` | 14 | nit | Hardcoded sample output limits test flexibility |
| Sweep off | 3 | `src/benchmark/guard.ts` | 10 | important | Policy enforcement swallows all errors silently |
| Sweep off | 3 | `src/benchmark/credentials.ts` | 13 | important | Credential redaction relies on overly broad name matching |
| Sweep off | 4 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion in updateProfile |
| Sweep off | 4 | `src/benchmark/output.ts` | 15 | important | Overly restrictive finding classification |
| Sweep on | 0 | `src/benchmark/auth.ts` | 3 | blocking | Hardcoded sensitive value |
| Sweep on | 1 | `src/benchmark/auth.ts` | 2 | blocking | Hardcoded sensitive value exposed in logging |
| Sweep on | 1 | `src/benchmark/credentials.ts` | 3 | important | Credential name pattern too narrow |
| Sweep on | 2 | `src/benchmark/auth.ts` | 3 | blocking | Hardcoded sensitive value |
| Sweep on | 2 | `src/benchmark/output.ts` | 15 | important | Line classification is lossy |
| Sweep on | 3 | `src/benchmark/auth.ts` | 3 | blocking | Hardcoded sensitive value |
| Sweep on | 3 | `src/benchmark/output.ts` | 14 | important | Incomplete external output parsing |
| Sweep on | 4 | `src/benchmark/auth.ts` | 3 | blocking | Exposed sensitive credential value |

Every title above is a finding description. None contains a credential value,
token, or authorization value; a title that mentions `token` or `authToken` names
the field the finding is about, not a value. The AC14 scan in plan step 14 runs
over these artifacts and must come back green; this list is not a substitute for it.

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
| `pr-head-push-order` | 1 | 14 |
| `credential-pattern-gap` | 2 | 13 |
| `external-output-parsing` | 0 | 15 |
| `record-identity` | 1 | 14 |
| `guard-fails-open` | 10 | 5 |

### Published findings attributed

Across the 15 sweep-on runs, 134 findings were published: 14 were attributed to
at least one category and 120 were uncategorized. Per-category attribution of
published findings:

| Category identifier | Published findings attributed |
| --- | --- |
| `guard-fails-open` | 10 |
| `credential-pattern-gap` | 2 |
| `pr-head-push-order` | 1 |
| `record-identity` | 1 |
| `external-output-parsing` | 0 |

No published finding in this campaign was attributed to more than one category,
so the attribution total and the attributed-finding total coincide at 14. The
record carries each finding's publication index and its category identifiers,
never the finding's own text. These are the recall passes' findings; the
precision fixture's passes published none (see above).

**Reading the two tables together:** `guard-fails-open` produced findings in
10 of 15 sweep-on runs (all 10 of the 18-seed runs, which contain that seed, and none of
the 5 control runs, whose fixture has no such seed) and the seed was found in the same 10 runs.
`credential-pattern-gap` produced findings in 2 of 15, `pr-head-push-order` in
1, and `record-identity` in 1, so only `guard-fails-open` attributes
findings in more than 2 of the 15 runs. `external-output-parsing`
produced none in any of the 15 runs, although the
`external-output-parsing-lossy` seed was found in 3 of the 10 sweep-on
18-seed runs. `credential-pattern-gap` produced findings in 2 of the 10 sweep-on
18-seed runs while `credential-pattern-gap-camel` was found in 8 of those 10; both were true
together in 2 runs, so the category record and the seed's matcher do not line
up run by run. The one `record-identity` run is on the original-thirteen control,
whose fixture has no record-identity seed, and none of the 10 sweep-on 18-seed
runs (which do contain that seed) produced one, so that seed was not brought
out. That is a statement about these fixtures, not about the categories' value
on real pull requests.

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
| Extended fixture | 22039, 12509, 25433, 22640, 18161 | 21797, 16786, 14453, 11188, 15355 | −242, +4277, −10980, −11452, −2806 | −4240.6 |
| Original-thirteen control | 17120, 9154, 11651, 10666, 12187 | 17347, 12816, 11936, 9638, 13847 | +227, +3662, +285, −1028, +1660 | +961.2 |
| Paired precision | 16384, 17197, 15257, 17700, 17054 | 15540, 14998, 15885, 13559, 12767 | −844, −2199, +628, −4141, −4287 | −2168.6 |

Per-arm figures for each leg, read from the same records:

| Leg | Arm | Mean (ms) | Min (ms) | Max (ms) |
| --- | --- | --- | --- | --- |
| Extended fixture | Sweep off | 20156.4 | 12509 | 25433 |
| Extended fixture | Sweep on | 15915.8 | 11188 | 21797 |
| Original-thirteen control | Sweep off | 12155.6 | 9154 | 17120 |
| Original-thirteen control | Sweep on | 13116.8 | 9638 | 17347 |
| Paired precision | Sweep off | 16718.4 | 15257 | 17700 |
| Paired precision | Sweep on | 14549.8 | 12767 | 15885 |

Both configurations' figures are recorded above. The paired means are
−4240.6 ms on the extended leg, +961.2 ms on the control, and −2168.6 ms on the
precision legs: negative on two legs and positive on the third, and the paired
differences within each leg are mixed in sign. Each of the extended and control
means is smaller than the population SD of its own paired differences
(6132 and 1596 ms); the precision-leg mean (2168.6 ms) is larger
than its own (1895 ms), and four of its five differences are
negative. No consistent elapsed-time difference is observed across the legs, and
the comparison is inconclusive. The largest single figure, 25433 ms, is a
sweep-off extended fixture run (position 2). The six legs
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
  seed-level movements in both directions (notably `guard-fails-open` up and
  `sensitive-value-exposure` down), not attributed effects, and no consistent
  overall variance or elapsed-time difference; the lower sweep-on mean recall on all three legs is
  an observation that model drift or run-to-run variation could explain, and it
  does not show that the sweep changes recall either.
