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
`configuration` block, and nothing is carried over from a run that failed. The
records replace an earlier campaign that ran against the mutable alias
`qwen-plus`; no figure from those superseded records is used here.

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
| `sweep-off-extended.json` | `193cc37bed0e38a155f60a221cd7bef7788511627052b1f99adffa9e869ba4bc` |
| `sweep-on-extended.json` | `3276c3d358703228bf4b3a1284da6431964dfe17da8ec422c24c74308b98fa2e` |
| `sweep-off-original-thirteen.json` | `ad980022cb6f5c43b1d63f08fc9cdfe0d6be1147d7b6727fae562f07307f5415` |
| `sweep-on-original-thirteen.json` | `f716fa15dd4314d6daecbc38c94dcc2adfe7baa5b32307cefdb9407acfd0ff2f` |
| `sweep-off-precision.json` | `a87f0b59bc3e534d060c3b41f93c2f711e64f5ca87047c6adb26729a7db28d39` |
| `sweep-on-precision.json` | `e0f94025998814dbe4c484025fe712774f76ba6808329a6f8048a6b8b43324a3` |

Run timestamps (first–last record per file, in array order), read from each
record's `timestamp`:

| File | First | Last |
| --- | --- | --- |
| `sweep-off-extended.json` | 2026-09-28T21:32:05.895Z | 2026-09-28T21:33:04.903Z |
| `sweep-on-extended.json` | 2026-09-28T21:32:05.895Z | 2026-09-28T21:33:09.765Z |
| `sweep-off-original-thirteen.json` | 2026-09-28T21:32:05.906Z | 2026-09-28T21:33:00.441Z |
| `sweep-on-original-thirteen.json` | 2026-09-28T21:32:05.895Z | 2026-09-28T21:32:55.910Z |
| `sweep-off-precision.json` | 2026-09-28T21:32:05.896Z | 2026-09-28T21:33:03.434Z |
| `sweep-on-precision.json` | 2026-09-28T21:32:05.895Z | 2026-09-28T21:33:01.215Z |

The six files' first records are stamped within 11 ms of one another
(2026-09-28T21:32:05.895Z to 2026-09-28T21:32:05.906Z), and the whole campaign spans 2026-09-28T21:32:05.895Z to
2026-09-28T21:33:09.765Z. That is consistent with the six legs having run concurrently, not
one after another as the command listing reads; the five runs inside each file
are sequential. Concurrent legs would share the provider endpoint, so the elapsed-time
figures under [Cost evidence](#cost-evidence-ac11) were likely taken under that
shared load. It applies to both arms alike, and it is stated here because it bears on
how far those figures can be read.

Reviewed target: `issue-15-recall-benchmark` on every record in every file.

Driver commit: the campaign ran from `b35aa63`, the local head of the feature
branch. `git diff --stat 6bb5d37 b35aa63` shows a single changed file, the
release-note fragment `changelog.d/105.added.category-forced-review-sweep.md`
(1 line), so the executable source, the fixtures, and the recorded category list
are identical to the runbook's tested commit `6bb5d37`. The fixture hashes
recorded in each record's own `fixture` block match the content of the manifest
and patch files at `6bb5d37`.

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
| Extended / precision | `tests/fixtures/recall-benchmark/manifest.json` | `issue-15-recall-benchmark` | 18 | `8c8a8e3b5300d458239a5c02784b14dd58bfc513106095e8a534b9524a1ab325` | `76ed1583caadd7088864a54d814244d06ddf29961c9b18d33579295831faf81a` |
| Original-thirteen control | `tests/fixtures/recall-benchmark/original-thirteen/manifest.json` | `issue-15-recall-benchmark` | 13 | `1ff80de715d320db744f0b866b51df1c7501e952fce63dfa48ef60a1529eb497` | `e548bd03e17accf6f003d16c361c941fb26d57cddd23e2f8999443d98f0e1b61` |

The original-thirteen control shares the extended fixture's `benchmarkId` (the
snapshot is a byte-identical copy) and is nonetheless distinct evidence: it
differs by `manifestPath`, by `seedCount`, and by both content hashes, so it is
demonstrably not the extended fixture re-run. Note that it also carries a
different `promptFingerprint` (`42c6d53f…`) than the
extended and precision legs (`1f76380e…`), because the prompt embeds
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
finds no consistent overall recall effect.

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
| Sweep off | 8, 8, 8, 7, 7 | 0.444444, 0.444444, 0.444444, 0.388889, 0.388889 | 0.388889 | 0.444444 | 0.027217 | 0.422222 |
| Sweep on | 9, 11, 7, 7, 7 | 0.500000, 0.611111, 0.388889, 0.388889, 0.388889 | 0.388889 | 0.611111 | 0.088889 | 0.455556 |

All 18 seeds were present in every run of both arms (no seed reported absent
from the fixture), so the denominator is 18 throughout.

### Original-thirteen control — 13 seeded defects, sample count 5

| Arm | Per-run found (of 13) | Per-run recall | Low | High | Population SD | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| Sweep off | 9, 6, 7, 8, 8 | 0.692308, 0.461538, 0.538462, 0.615385, 0.615385 | 0.461538 | 0.692308 | 0.078446 | 0.584615 |
| Sweep on | 8, 7, 8, 6, 8 | 0.615385, 0.538462, 0.615385, 0.461538, 0.615385 | 0.461538 | 0.615385 | 0.061538 | 0.569231 |

The recall denominator here is the fixture's 13 seeds, not the confirmed-defect
denominator AC15(d)'s real-pull-request tier uses, so this fixture comparison is
never reported as not applicable for want of a confirmed defect.

### Recall pass of the paired precision legs — 18 seeded defects, sample count 5

The `--quality` legs also run the recall pass, on the same extended fixture and
prompt. Their recall figures are reported for completeness, and are read from
the same fields as above.

| Arm | Per-run found (of 18) | Per-run recall | Low | High | Population SD | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| Sweep off | 8, 8, 9, 8, 7 | 0.444444, 0.444444, 0.500000, 0.444444, 0.388889 | 0.388889 | 0.500000 | 0.035136 | 0.444444 |
| Sweep on | 6, 7, 8, 6, 9 | 0.333333, 0.388889, 0.444444, 0.333333, 0.500000 | 0.333333 | 0.500000 | 0.064788 | 0.400000 |

### Original-thirteen subset, read from the extended runs

Each extended run record carries an `originalThirteenSubset` block: the
13-seed original fixture evaluated against the same run's 18-seed patch set.
This is reported separately from the standalone original-thirteen control
above, because the two answer different questions — the subset holds the patch
set fixed and narrows the seed list, while the control changes both.

| Arm | Subset run positions 0–4 (seeds) | Subset run positions 0–4 (misses) | Subset recall (of 13) |
| --- | --- | --- | --- |
| Sweep off (extended) | 8, 8, 8, 7, 7 | 5, 5, 5, 6, 6 | 0.615385, 0.615385, 0.615385, 0.538462, 0.538462 |
| Sweep on (extended) | 8, 9, 6, 5, 6 | 5, 4, 7, 8, 7 | 0.615385, 0.692308, 0.461538, 0.384615, 0.461538 |

### Per-defect found and missed counts

Counts are out of the 5 runs of the leg, read from each record's
`foundSeededDefects` and `missedSeededDefects` arrays.

#### Extended fixture

| Seed | Off found | Off missed | On found | On missed |
| --- | --- | --- | --- | --- |
| `expired-session-inversion` | 0 | 5 | 2 | 3 |
| `sensitive-value-exposure` | 5 | 0 | 2 | 3 |
| `cache-capacity-off-by-one` | 5 | 0 | 5 | 0 |
| `sql-interpolation` | 5 | 0 | 5 | 0 |
| `invalid-range-parsing` | 0 | 5 | 0 | 5 |
| `lexicographic-numeric-sort` | 5 | 0 | 5 | 0 |
| `lower-element-median` | 5 | 0 | 5 | 0 |
| `empty-word-title-casing` | 5 | 0 | 2 | 3 |
| `authorization-bypass` | 0 | 5 | 0 | 5 |
| `data-loss-overwrite` | 0 | 5 | 1 | 4 |
| `async-race-duplicate-processing` | 5 | 0 | 2 | 3 |
| `configuration-debug-default` | 0 | 5 | 0 | 5 |
| `stale-sha-review-publication` | 3 | 2 | 5 | 0 |
| `api-evidence-state-reconstruction` | 0 | 5 | 2 | 3 |
| `external-output-parsing-lossy` | 0 | 5 | 0 | 5 |
| `guard-fails-open` | 0 | 5 | 5 | 0 |
| `record-identity-drift` | 0 | 5 | 0 | 5 |
| `credential-pattern-gap-camel` | 0 | 5 | 0 | 5 |

#### Original-thirteen control

| Seed | Off found | Off missed | On found | On missed |
| --- | --- | --- | --- | --- |
| `expired-session-inversion` | 2 | 3 | 0 | 5 |
| `sensitive-value-exposure` | 5 | 0 | 4 | 1 |
| `cache-capacity-off-by-one` | 5 | 0 | 5 | 0 |
| `sql-interpolation` | 5 | 0 | 5 | 0 |
| `invalid-range-parsing` | 0 | 5 | 0 | 5 |
| `lexicographic-numeric-sort` | 5 | 0 | 5 | 0 |
| `lower-element-median` | 5 | 0 | 5 | 0 |
| `empty-word-title-casing` | 3 | 2 | 4 | 1 |
| `authorization-bypass` | 0 | 5 | 0 | 5 |
| `data-loss-overwrite` | 0 | 5 | 0 | 5 |
| `async-race-duplicate-processing` | 4 | 1 | 4 | 1 |
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
| `empty-word-title-casing` | 4 | 1 | 0 | 5 |
| `authorization-bypass` | 0 | 5 | 0 | 5 |
| `data-loss-overwrite` | 1 | 4 | 0 | 5 |
| `async-race-duplicate-processing` | 5 | 0 | 1 | 4 |
| `configuration-debug-default` | 0 | 5 | 0 | 5 |
| `stale-sha-review-publication` | 5 | 0 | 5 | 0 |
| `api-evidence-state-reconstruction` | 0 | 5 | 3 | 2 |
| `external-output-parsing-lossy` | 0 | 5 | 0 | 5 |
| `guard-fails-open` | 0 | 5 | 5 | 0 |
| `record-identity-drift` | 0 | 5 | 1 | 4 |
| `credential-pattern-gap-camel` | 0 | 5 | 0 | 5 |

### What the recall evidence shows

- **Overall recall: no consistent effect of the sweep is shown, in either
  direction.** The mean recall difference (sweep on minus sweep off) is
  +0.033333 on the extended fixture, −0.015385 on the original-thirteen
  control, and −0.044444 on the recall pass of the precision legs: positive on one leg,
  negative on the other two. In defects per run that is +0.6,
  −0.2, and −0.8. Within a leg the run-by-run
  differences are also mixed in sign: 1, 3, −1, 0, 0 (extended),
  −1, 1, 1, −2, 0 (original-thirteen), −2, −1, −1, −2, 2 (precision), in found defects by
  run position. The two 18-seed legs share a recall-pass prompt, so pooling
  their 10 runs per arm is a descriptive convenience: mean recall
  0.433333 sweep off against 0.427778 sweep on.
  Sweep-on recall is not uniformly higher than sweep-off: the extended fixture's
  sweep-on range is 0.388889–0.611111 against sweep-off
  0.388889–0.444444, and the original-thirteen control's
  sweep-on range is 0.461538–0.615385 against sweep-off
  0.461538–0.692308.
- **Spread: no consistent effect either.** The population SD of per-run recall
  moves 0.027217 → 0.088889 on the extended fixture (wider),
  0.078446 → 0.061538 on the original-thirteen control (narrower), and
  0.035136 → 0.064788 on the recall pass of the precision legs (wider). The
  widest sweep-on figure comes from a single extended run that found 11 of 18
  (run position 1), which also carries the leg's highest recall-pass false-positive
  count.
- **What a 5-run sample can and cannot show.** The between-arm mean differences
  (0.015385 to 0.044444 in absolute value) are of the same order as
  the within-arm spread (population SD 0.027217 to 0.088889), and the per-run ranges of the
  two arms overlap on every leg. Five runs per arm at this spread cannot tell a
  real change of a fraction of a defect per run from run-to-run variation, and
  a standard deviation estimated from five runs is itself imprecise, so neither a
  recall improvement nor a recall loss, nor a change in variance, is supported.
  What five runs can show is a large, repeatable, seed-specific change, and
  there is one (next point).
- **The one clear seed-level effect is `guard-fails-open`.** It was found in 5
  of 5 sweep-on runs on the extended fixture and 5 of 5 on the precision legs
  (10 of 10), and in 0 of 10 sweep-off runs. That is the largest
  repeatable seed-level change in these tables. It shows the sweep can
  bring out a finding on a seeded defect that matches one of its categories,
  on a fixture from Ronda's own repository; it says nothing about real pull
  requests. `api-evidence-state-reconstruction` moves 0/5 → 2/5 on the
  extended fixture and 0/5 → 3/5 on the precision legs, and
  `stale-sha-review-publication` moves 3/5 → 5/5 on the extended fixture, 4/5 →
  5/5 on the control, and stays 5/5 on the precision legs; these are smaller
  moves that five runs cannot separate from variation.
- **The sweep-on arm found some seeds less often, and this is recorded as
  observed, not as a finding of harm.** `sensitive-value-exposure` was found in
  5 of 5 sweep-off runs on all three legs and in 2, 4, and
  0 of 5 sweep-on runs on the extended, original-thirteen, and precision
  legs respectively. Every one of the 9 sweep-on runs that missed it also
  carries an unmatched finding on the seed's own file (`src/benchmark/auth.ts`,
  line 2), titled as a hardcoded sensitive credential, secret, or value; no
  sweep-off run has one. The seed's matcher credits particular wording, so
  this is consistent with the reviewer raising the finding in wording the
  lexical matcher does not credit, and not with the reviewer failing to see it.
  That reading was not adjudicated finding by finding; it means the recall
  figures count only the findings the matcher credits, and the drop on this
  seed may reflect matcher wording rather than a lost finding.
  `empty-word-title-casing` (5 → 2 and 4 → 0 on the two 18-seed legs; 3 → 4
  on the control) and `async-race-duplicate-processing` (5 → 2 and 5 → 1; 4 → 4 on the control) show
  no such same-file unmatched finding in their sweep-on misses, so those
  drops stand as measured. Whether the sweep displaced those findings or the
  runs varied cannot be settled from five runs per arm; it is the observation a
  larger sample should test first.
- **Five seeds were found in no run of either arm on any leg that contains
  them:** `invalid-range-parsing`, `authorization-bypass`, and
  `configuration-debug-default` (all three legs), and
  `external-output-parsing-lossy` and `credential-pattern-gap-camel` (the two
  18-seed legs). Three of these are among the four defect kinds the 2026-09-10
  baseline's calibration note identified as consistently missed; the fourth,
  `data-loss-overwrite`, was found in 2 of the 30 runs that contain it (one
  sweep-on extended run and one sweep-off precision-leg run) and missed in the
  rest. The sweep does not change the never-found set.
- **Of the five AC12/AC13 seeds, two are never found under either arm:**
  `credential-pattern-gap-camel` and `external-output-parsing-lossy`. They match
  the `credential-pattern-gap` and `external-output-parsing` categories, which
  produced findings in none of the 15 sweep-on runs (see
  [Per-category attribution](#per-category-attribution-ac9)), so the sweep did
  not bring out either seeded defect. `record-identity-drift` was found in 1 of
  the 10 sweep-on 18-seed runs (precision leg) and in none of the 10 sweep-off
  runs; no finding in any sweep-on run was attributed to the `record-identity`
  category. This is recorded as it stands: these seeds reflect the reviewer on
  this model, not the fixture.

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

**Precision regression result: NOT REGRESSED.** The counts that decided it are
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
precision change, so NOT REGRESSED here means only that this fixture stayed
clean on both arms.

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
| Sweep off | 1 | 0 |
| Sweep off | 2 | 0 |
| Sweep off | 3 | 1 |
| Sweep off | 4 | 3 |
| **Sweep off total** | | **5** |
| Sweep on | 0 | 2 |
| Sweep on | 1 | 1 |
| Sweep on | 2 | 1 |
| Sweep on | 3 | 2 |
| Sweep on | 4 | 1 |
| **Sweep on total** | | **7** |

The other two legs' recall passes record the same field:

| Leg | Sweep off per run | Sweep off total | Sweep on per run | Sweep on total |
| --- | --- | --- | --- | --- |
| Extended fixture | 1, 2, 2, 1, 2 | 8 | 1, 4, 1, 1, 1 | 8 |
| Original-thirteen control | 0, 0, 1, 0, 0 | 1 | 0, 1, 0, 0, 0 | 1 |
| Paired precision | 1, 0, 0, 1, 3 | 5 | 2, 1, 1, 2, 1 | 7 |

These totals are descriptive. No test in the spec is stated over them, and no
regression claim is made from them. On the precision legs the sweep-on total is
higher (7 against 5); on the extended fixture the totals are equal
(8 against 8), and on the control they are 1 against 1. At these counts
five runs cannot separate the arms.

#### Recall-pass false positives, by run

| Arm | Run position | Path | Line | Severity | Title |
| --- | --- | --- | --- | --- | --- |
| Sweep off | 0 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion bypasses type safety |
| Sweep off | 3 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion bypasses type safety |
| Sweep off | 4 | `src/benchmark/title.ts` | 2 | nit | Unsafe string indexing on empty word |
| Sweep off | 4 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion bypasses type safety |
| Sweep off | 4 | `src/benchmark/guard.ts` | 9 | important | Overly permissive fallback on rule load failure |
| Sweep on | 0 | `src/benchmark/auth.ts` | 2 | blocking | Hardcoded sensitive credential exposed |
| Sweep on | 0 | `src/benchmark/records.ts` | 2 | important | Unsafe array indexing without bounds check |
| Sweep on | 1 | `src/benchmark/auth.ts` | 2 | blocking | Hardcoded secret exposed in logging |
| Sweep on | 2 | `src/benchmark/auth.ts` | 2 | blocking | Hardcoded sensitive credential exposed in logging |
| Sweep on | 3 | `src/benchmark/auth.ts` | 2 | blocking | Hardcoded sensitive credential exposed in logging |
| Sweep on | 3 | `src/benchmark/records.ts` | 2 | important | Unsafe indexing without bounds check |
| Sweep on | 4 | `src/benchmark/auth.ts` | 2 | blocking | Hardcoded sensitive credential value |

Every title above is a finding description. None contains a credential value,
token, or authorization value; the `auth.ts` entries, where present, describe a
hardcoded credential as a class, not its contents. The AC14 scan in plan step 14
runs over these artifacts and must come back green; this list is not a
substitute for it.

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
| `credential-pattern-gap` | 0 | 15 |
| `external-output-parsing` | 0 | 15 |
| `record-identity` | 0 | 15 |
| `guard-fails-open` | 10 | 5 |

### Published findings attributed

Across the 15 sweep-on runs, 130 findings were published: 14 were attributed to
at least one category and 116 were uncategorized. Per-category attribution of
published findings:

| Category identifier | Published findings attributed |
| --- | --- |
| `guard-fails-open` | 10 |
| `pr-head-push-order` | 4 |
| `credential-pattern-gap` | 0 |
| `external-output-parsing` | 0 |
| `record-identity` | 0 |

No published finding in this campaign was attributed to more than one category,
so the attribution total and the attributed-finding total coincide at 14. The
record carries each finding's publication index and its category identifiers,
never the finding's own text. These are the recall passes' findings; the
precision fixture's passes published none (see above).

**Reading the two tables together:** `guard-fails-open` produced findings in
10 of 15 sweep-on runs, and `pr-head-push-order` in 4 of 15, so those two
categories are doing attribution work on these fixtures. `credential-pattern-gap`,
`external-output-parsing`, and `record-identity` produced none in any of the 15
runs — the reviewer raised no finding on either fixture that matched them. That
is a statement about these fixtures, not about the categories' value on real
pull requests.

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
| Extended fixture | 14311, 15836, 15636, 13221, 12605 | 15169, 23071, 12289, 13338, 15190 | 858, 7235, −3347, 117, 2585 | +1489.6 |
| Original-thirteen control | 17502, 9549, 11770, 15710, 12172 | 14584, 12326, 13525, 9577, 11749 | −2918, 2777, 1755, −6133, −423 | −988.4 |
| Paired precision | 15327, 13237, 14748, 14219, 15796 | 15287, 13495, 13045, 13488, 16981 | −40, 258, −1703, −731, 1185 | −206.2 |

Per-arm figures for each leg, read from the same records:

| Leg | Arm | Mean (ms) | Min (ms) | Max (ms) |
| --- | --- | --- | --- | --- |
| Extended fixture | Sweep off | 14321.8 | 12605 | 15836 |
| Extended fixture | Sweep on | 15811.4 | 12289 | 23071 |
| Original-thirteen control | Sweep off | 13340.6 | 9549 | 17502 |
| Original-thirteen control | Sweep on | 12352.2 | 9577 | 14584 |
| Paired precision | Sweep off | 14665.4 | 13237 | 15796 |
| Paired precision | Sweep on | 14459.2 | 13045 | 16981 |

Both configurations' figures are recorded above. The paired means are of
opposite sign across legs (+1489.6, −988.4, and −206.2 ms) and are small against the
run-to-run spread within each arm, so the sweep shows no consistent elapsed-time
effect. The largest single figure, 23071 ms, is a sweep-on extended run (position 1), the same run
that found 11 of 18; without that position the leg's paired mean would be +53.25 ms, against +1489.6 ms with it. The
six legs appear to have run concurrently against one provider endpoint (see
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
- **A 5-run sample cannot resolve small effects.** The campaign shows one clear
  seed-level effect (`guard-fails-open`) and no consistent overall recall,
  variance, or elapsed-time effect; it does not show that the sweep leaves
  recall unchanged either.
