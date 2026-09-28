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

This document is also the single authoritative home of the regression-gate
status statement required by AC17 — see
[Regression-gate status](#regression-gate-status-ac17).

## Campaign shape

| Leg | Sweep off | Sweep on | Seeds | Runs per arm | Model calls per pass |
| --- | --- | --- | --- | --- | --- |
| Extended fixture | `sweep-off-extended.json` | `sweep-on-extended.json` | 18 | 5 | 1 recall |
| Original-thirteen control | `sweep-off-original-thirteen.json` | `sweep-on-original-thirteen.json` | 13 | 5 | 1 recall |
| Paired precision | `sweep-off-precision.json` | `sweep-on-precision.json` | 18 | 5 | 1 recall + 1 precision |

Commands, verbatim from the runbook:

```bash
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
| `sweep-off-extended.json` | `3985649fc004702ca85e338e4a7765cf2bf19567a5d6046f12819569746a28de` |
| `sweep-on-extended.json` | `483c557d4c3ba529049e779f8965f8e477dbf68e2f562bb1ea9ab01538b159bb` |
| `sweep-off-original-thirteen.json` | `03ff8c73e57d83cd9ec2fef3f3756a3862b08fe4629c1caaab5febd7ffe6ee67` |
| `sweep-on-original-thirteen.json` | `285ae2a0ad90031904e67a266bad92c3da596d27d735c47b32d24cc6eda401ea` |
| `sweep-off-precision.json` | `75bacecb4731ab80cea266ad8c36fcefbfc952b27e9dfb37ab0f3e6c237fdeaa` |
| `sweep-on-precision.json` | `e12334d2d88d56d0d17108feda80f9c0444a24e4e01917797f8a69421d7c8815` |

Run timestamps (first–last record per file), read from each record's
`timestamp`:

| File | First | Last |
| --- | --- | --- |
| `sweep-off-extended.json` | 2026-09-28T14:03:15.497Z | 2026-09-28T14:04:15.158Z |
| `sweep-on-extended.json` | 2026-09-28T14:04:28.125Z | 2026-09-28T14:05:27.538Z |
| `sweep-off-original-thirteen.json` | 2026-09-28T14:05:59.726Z | 2026-09-28T14:06:54.324Z |
| `sweep-on-original-thirteen.json` | 2026-09-28T14:07:09.439Z | 2026-09-28T14:08:05.002Z |
| `sweep-off-precision.json` | 2026-09-28T14:08:31.031Z | 2026-09-28T14:09:31.660Z |
| `sweep-on-precision.json` | 2026-09-28T14:09:46.407Z | 2026-09-28T14:10:52.561Z |

Reviewed target: `issue-15-recall-benchmark` on every record in every file.

## Model identity — the comparison is inconclusive

The runbook's model-identity check reads each request's own reported value, not
the configured alias, and records the run set as **unattested** when a block
restates the alias, omits the field, or shows differing reported values across
the run set. That is the case here, in every leg:

- `configuration.modelName` is `qwen-plus` on every record.
- Every request's `reportedModel` is `qwen-plus` — `[{"kind": "recall",
  "reportedModel": "qwen-plus"}]` on the recall legs, and
  `[{"kind": "recall", "reportedModel": "qwen-plus"}, {"kind": "precision",
  "fixtureId": "harmless-session-refactor", "reportedModel": "qwen-plus"}]` on
  the precision legs. The reported value restates the configured alias exactly.
- The record-level `model` field is `qwen-plus` on every record.

The recorded version-attestation basis, present on all 30 records and identical
on both arms of every leg, states the consequence in the file itself:

> provider-reported identity only; endpoint dashscope-intl compatible-mode/v1,
> reported model qwen-plus, 2026-09-28; the operator configures a mutable alias
> and the provider exposes no immutable model-artifact identifier, so this run
> set carries no same-configuration claim and is recorded as inconclusive

**This run set therefore supports no AC8/AC9 same-configuration claim.** The
recall, spread, precision, and cost figures below are reported as observed
evidence from the campaign; they are not offered as a same-configuration
comparison, because the fixture cannot show that both arms ran the same
immutable model artifact. Closing that gap needs a provider that reports an
immutable model-artifact identifier, or an attestation the provider itself
signs — neither is available from this endpoint today.

## Admissibility of the pairing

The runbook requires each pair to share an equal `fixture` block and
`configuration` blocks differing only in `sweepMode`. Both hold on all three
pairs.

| Pair | `fixture` blocks equal | `configuration` keys differing |
| --- | --- | --- |
| Extended | yes | `['sweepMode']` |
| Original-thirteen control | yes | `['sweepMode']` |
| Precision | yes | `['sweepMode']` |

The remaining `configuration` keys are identical across both arms of every leg:
`durabilityMode`, `durabilityModeDefault`, `maxPatchChars`, `modelName`,
`promptFingerprint`, `requestParameters`, `requests`, `versionAttestation`, and
`sweepMode`. The `configuration` block contains no credential field.

Fixture version, read from each record's own `fixture` block:

| Leg | `manifestPath` | `benchmarkId` | `seedCount` | `manifestSha256` | `patchesSha256` |
| --- | --- | --- | --- | --- | --- |
| Extended / precision | `tests/fixtures/recall-benchmark/manifest.json` | `issue-15-recall-benchmark` | 18 | `8c8a8e3b5300d458239a5c02784b14dd58bfc513106095e8a534b9524a1ab325` | `76ed1583caadd7088864a54d814244d06ddf29961c9b18d33579295831faf81a` |
| Original-thirteen control | `tests/fixtures/recall-benchmark/original-thirteen/manifest.json` | `issue-15-recall-benchmark` | 13 | `1ff80de715d320db744f0b866b51df1c7501e952fce63dfa48ef60a1529eb497` | `e548bd03e17accf6f003d16c361c941fb26d57cddd23e2f8999443d98f0e1b61` |

The original-thirteen control shares the extended fixture's `benchmarkId` (the
snapshot is a byte-identical copy) and is nonetheless distinct evidence: it
differs by `manifestPath`, by `seedCount`, and by both content hashes, so it is
demonstrably not the extended fixture re-run. Note that it also carries a
different `promptFingerprint` (`42c6d53f…`) than the extended legs
(`1f76380e…`), because the prompt embeds the reviewed patch set; that
difference is a property of the fixture, not a configuration difference between
the sweep arms.

`promptFingerprint` is identical across the two arms of every leg, including
the original-thirteen control.

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
| Sweep off | 6, 7, 9, 9, 7 | 0.333333, 0.388889, 0.500000, 0.500000, 0.388889 | 0.333333 | 0.500000 | 0.066667 | 0.422222 |
| Sweep on | 8, 8, 7, 8, 9 | 0.444444, 0.444444, 0.388889, 0.444444, 0.500000 | 0.388889 | 0.500000 | 0.035136 | 0.444444 |

All 18 seeds were present in every run of both arms (no seed reported absent
from the fixture), so the denominator is 18 throughout.

### Original-thirteen control — 13 seeded defects, sample count 5

| Arm | Per-run found (of 13) | Per-run recall | Low | High | Population SD | Mean |
| --- | --- | --- | --- | --- | --- | --- |
| Sweep off | 8, 9, 9, 9, 8 | 0.615385, 0.692308, 0.692308, 0.692308, 0.615385 | 0.615385 | 0.692308 | 0.037684 | 0.661538 |
| Sweep on | 9, 7, 9, 8, 6 | 0.692308, 0.538462, 0.692308, 0.615385, 0.461538 | 0.461538 | 0.692308 | 0.089707 | 0.600000 |

The recall denominator here is the fixture's 13 seeds, not the confirmed-defect
denominator AC15(d)'s real-pull-request tier uses, so this fixture comparison is
never reported as not applicable for want of a confirmed defect.

### Original-thirteen subset, read from the extended runs

Each extended run record carries an `originalThirteenSubset` block: the
13-seed original fixture evaluated against the same run's 18-seed patch set.
This is reported separately from the standalone original-thirteen control
above, because the two answer different questions — the subset holds the patch
set fixed and narrows the seed list, while the control changes both.

| Arm | Subset run positions 0–4 (seeds) | Subset run positions 0–4 (misses) | Subset recall (of 13) |
| --- | --- | --- | --- |
| Sweep off (extended) | 6, 7, 9, 9, 7 | 7, 6, 4, 4, 6 | 0.461538, 0.538462, 0.692308, 0.692308, 0.538462 |
| Sweep on (extended) | 7, 6, 6, 7, 8 | 6, 7, 7, 6, 5 | 0.538462, 0.461538, 0.461538, 0.538462, 0.615385 |

### Per-defect found and missed counts

Counts are out of the 5 runs of the leg, read from each record's
`foundSeededDefects` and `missedSeededDefects` arrays.

#### Extended fixture

| Seed | Off found | Off missed | On found | On missed |
| --- | --- | --- | --- | --- |
| `expired-session-inversion` | 0 | 5 | 1 | 4 |
| `sensitive-value-exposure` | 4 | 1 | 3 | 2 |
| `cache-capacity-off-by-one` | 5 | 0 | 3 | 2 |
| `sql-interpolation` | 5 | 0 | 5 | 0 |
| `invalid-range-parsing` | 0 | 5 | 0 | 5 |
| `lexicographic-numeric-sort` | 5 | 0 | 5 | 0 |
| `lower-element-median` | 5 | 0 | 5 | 0 |
| `empty-word-title-casing` | 5 | 0 | 3 | 2 |
| `authorization-bypass` | 0 | 5 | 0 | 5 |
| `data-loss-overwrite` | 3 | 2 | 0 | 5 |
| `async-race-duplicate-processing` | 4 | 1 | 4 | 1 |
| `configuration-debug-default` | 0 | 5 | 0 | 5 |
| `stale-sha-review-publication` | 2 | 3 | 5 | 0 |
| `api-evidence-state-reconstruction` | 0 | 5 | 1 | 4 |
| `external-output-parsing-lossy` | 0 | 5 | 0 | 5 |
| `guard-fails-open` | 0 | 5 | 5 | 0 |
| `record-identity-drift` | 0 | 5 | 0 | 5 |
| `credential-pattern-gap-camel` | 0 | 5 | 0 | 5 |

#### Original-thirteen control

| Seed | Off found | Off missed | On found | On missed |
| --- | --- | --- | --- | --- |
| `expired-session-inversion` | 5 | 0 | 3 | 2 |
| `sensitive-value-exposure` | 5 | 0 | 5 | 0 |
| `cache-capacity-off-by-one` | 5 | 0 | 5 | 0 |
| `sql-interpolation` | 5 | 0 | 5 | 0 |
| `invalid-range-parsing` | 0 | 5 | 0 | 5 |
| `lexicographic-numeric-sort` | 5 | 0 | 5 | 0 |
| `lower-element-median` | 5 | 0 | 5 | 0 |
| `empty-word-title-casing` | 5 | 0 | 4 | 1 |
| `authorization-bypass` | 0 | 5 | 0 | 5 |
| `data-loss-overwrite` | 0 | 5 | 0 | 5 |
| `async-race-duplicate-processing` | 3 | 2 | 2 | 3 |
| `configuration-debug-default` | 0 | 5 | 0 | 5 |
| `stale-sha-review-publication` | 5 | 0 | 5 | 0 |

#### Paired precision legs

| Seed | Off found | Off missed | On found | On missed |
| --- | --- | --- | --- | --- |
| `expired-session-inversion` | 0 | 5 | 2 | 3 |
| `sensitive-value-exposure` | 5 | 0 | 3 | 2 |
| `cache-capacity-off-by-one` | 5 | 0 | 5 | 0 |
| `sql-interpolation` | 5 | 0 | 5 | 0 |
| `invalid-range-parsing` | 0 | 5 | 0 | 5 |
| `lexicographic-numeric-sort` | 5 | 0 | 5 | 0 |
| `lower-element-median` | 5 | 0 | 5 | 0 |
| `empty-word-title-casing` | 5 | 0 | 1 | 4 |
| `authorization-bypass` | 0 | 5 | 0 | 5 |
| `data-loss-overwrite` | 0 | 5 | 0 | 5 |
| `async-race-duplicate-processing` | 5 | 0 | 2 | 3 |
| `configuration-debug-default` | 0 | 5 | 0 | 5 |
| `stale-sha-review-publication` | 4 | 1 | 5 | 0 |
| `api-evidence-state-reconstruction` | 0 | 5 | 1 | 4 |
| `external-output-parsing-lossy` | 0 | 5 | 0 | 5 |
| `guard-fails-open` | 0 | 5 | 5 | 0 |
| `record-identity-drift` | 0 | 5 | 1 | 4 |
| `credential-pattern-gap-camel` | 0 | 5 | 0 | 5 |

### What the recall evidence shows

- **The sweep is a classification and attribution layer, not a broad recall
  booster.** On the extended fixture mean recall moves from 0.422222 to
  0.444444, and the per-run spread narrows (SD 0.066667 → 0.035136); on the
  standalone original-thirteen control mean recall moves the other way
  (0.661538 → 0.600000) and the spread widens (0.037684 → 0.089707).
  Per-run differences are not consistent in sign on either leg, so no direction
  claim is supported.
- **Its clearest single effect is `guard-fails-open`.** It was found in 5 of 5
  sweep-on runs on both the extended fixture and the paired precision legs, and
  0 of 5 sweep-off runs on either. On the extended fixture
  `stale-sha-review-publication` likewise moves 2/5 → 5/5.
- **Four seeds are missed in 5 of 5 runs under both arms on both fixtures:**
  `authorization-bypass`, `configuration-debug-default`,
  `invalid-range-parsing`, and `data-loss-overwrite`. These are the same defect
  kinds the 2026-09-10 baseline's calibration note identified as consistently
  missed. The sweep does not change them.
- **Three of the five new AC12/AC13 seeds are missed in 5 of 5 runs under both
  arms on the extended fixture:** `credential-pattern-gap-camel`,
  `external-output-parsing-lossy`, and `record-identity-drift`. This is
  recorded as it stands. `external-output-parsing-lossy` was also 0/5 on both
  arms of the paired precision legs, so it reflects the reviewer, not the
  fixture.

## Precision evidence and the strict regression result (AC9)

### Paired precision runs

`--quality` runs a recall pass and a precision pass, so these legs record 2
model calls per run. The precision fixture is `harmless-session-refactor`,
expected clean. Its per-run record is
`{"id": "harmless-session-refactor", "expected": "clean", "clean": true, "falsePositiveCount": 0, "falsePositives": []}`.

| Arm | Run position | Unexpected findings | Fixture clean |
| --- | --- | --- | --- |
| Sweep off | 0 | 2 | true |
| Sweep off | 1 | 1 | true |
| Sweep off | 2 | 1 | true |
| Sweep off | 3 | 1 | true |
| Sweep off | 4 | 2 | true |
| **Sweep off total** | | **7** | 5 of 5 clean |
| Sweep on | 0 | 2 | true |
| Sweep on | 1 | 2 | true |
| Sweep on | 2 | 2 | true |
| Sweep on | 3 | 2 | true |
| Sweep on | 4 | 0 | true |
| **Sweep on total** | | **8** | 5 of 5 clean |

`qualityCategories` is identical on all 10 precision runs. `comparisons` is
empty on every precision record.

### The strict no-tolerance test

The test from the spec, applied as written:

- **Clause 1 — total unexpected findings.** Sweep-on runs produced 8 unexpected
  findings in total; sweep-off runs produced 7, across the same precision
  fixtures and the same sample count of 5. `8 > 7`, so **clause 1 fires.**
- **Clause 2 — a fixture that was clean under every sweep-off run.** The only
  precision fixture, `harmless-session-refactor`, was clean in 5 of 5 sweep-off
  runs and clean in 5 of 5 sweep-on runs. No fixture that stayed clean in every
  sweep-off run failed to stay clean in a sweep-on run, so **clause 2 does not
  fire.**

**Precision regression result: REGRESSED.** The counts that decided it are the
totals above: sweep-off 7 unexpected findings `[2, 1, 1, 1, 2]` against
sweep-on 8 `[2, 2, 2, 2, 0]`.

Unexpected findings are counted as findings, not as category attributions: a
finding attributed to more than one category counts once toward the total. The
test has no tolerance, and none was applied here.

No product code implements this test; it is an operator read, recorded here.
Under Use Case 4, the available action is to accept the result, or to record
the regression and revise or narrow the category list. This record states the
result and takes no action on it.

### Unexpected findings, by run

| Arm | Run position | Path | Line | Severity | Title |
| --- | --- | --- | --- | --- | --- |
| Sweep off | 0 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion bypasses type safety |
| Sweep off | 0 | `src/benchmark/guard.ts` | 10 | important | Overly permissive fallback on rule load failure |
| Sweep off | 1 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion bypasses type safety |
| Sweep off | 2 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion in updateProfile |
| Sweep off | 3 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion bypasses type safety |
| Sweep off | 4 | `src/benchmark/storage.ts` | 3 | important | Unsafe type assertion bypasses type safety |
| Sweep off | 4 | `src/benchmark/stale-sha.ts` | 4 | important | Ignores SHA comparison logic |
| Sweep on | 0 | `src/benchmark/git-history.ts` | 7 | important | Branch head inference from commit list is unreliable |
| Sweep on | 0 | `src/benchmark/records.ts` | 2 | important | Record ID derivation uses unsafe indexing without bounds check |
| Sweep on | 1 | `src/benchmark/records.ts` | 2 | important | Unsafe array index access without bounds check |
| Sweep on | 1 | `src/benchmark/credentials.ts` | 2 | nit | Misleading credential description with placeholder |
| Sweep on | 2 | `src/benchmark/auth.ts` | 2 | blocking | Hardcoded sensitive credential exposed in logging |
| Sweep on | 2 | `src/benchmark/records.ts` | 2 | important | Unsafe indexing without bounds check |
| Sweep on | 3 | `src/benchmark/auth.ts` | 2 | blocking | Hardcoded sensitive credential exposed in logging |
| Sweep on | 3 | `src/benchmark/git-history.ts` | 7 | important | Branch head inference from commit list is unreliable |

Every title above is a finding description. None contains a credential value,
token, or authorization value; the two `auth.ts` entries describe a hardcoded
credential as a class, not its contents. The AC14 scan in plan step 14 runs
over these artifacts and must come back green; this list is not a substitute
for it.

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
| `pr-head-push-order` | 7 | 8 |
| `credential-pattern-gap` | 0 | 15 |
| `external-output-parsing` | 0 | 15 |
| `record-identity` | 2 | 13 |
| `guard-fails-open` | 10 | 5 |

### Published findings attributed

Across the 15 sweep-on runs, 135 findings were published: 19 were attributed to
at least one category and 116 were uncategorized. Per-category attribution of
published findings:

| Category identifier | Published findings attributed |
| --- | --- |
| `guard-fails-open` | 10 |
| `pr-head-push-order` | 7 |
| `record-identity` | 2 |
| `credential-pattern-gap` | 0 |
| `external-output-parsing` | 0 |

No published finding in this campaign was attributed to more than one category,
so the attribution total and the attributed-finding total coincide at 19. The
record carries each finding's publication index and its category identifiers,
never the finding's own text.

**Reading the two tables together:** `guard-fails-open` produced findings in 10
of 15 sweep-on runs, and `pr-head-push-order` in 7 of 15, so both categories
are doing attribution work on this fixture. `credential-pattern-gap` and
`external-output-parsing` produced none in any of the 15 runs — the reviewer
raised no finding on either fixture that matched them. That is a statement
about these fixtures, not about the categories' value on real pull requests.

## Cost evidence (AC11)

**No cost ceiling applies to this feature, so no cost figure fails it.**

The comparative claim is stated over the two metrics AC11 names, each paired by
run position within each configuration's identical run sequence and averaged
across those runs. Standalone or aggregated figures do not support the claim
and are not used here.

### Model calls per pass

| Leg | Sweep off per run | Sweep on per run | Paired differences (on − off) | Paired mean |
| --- | --- | --- | --- | --- |
| Extended | 1, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 | 0.0 |
| Original-thirteen control | 1, 1, 1, 1, 1 | 1, 1, 1, 1, 1 | 0, 0, 0, 0, 0 | 0.0 |
| Paired precision | 2, 2, 2, 2, 2 | 2, 2, 2, 2, 2 | 0, 0, 0, 0, 0 | 0.0 |

The sweep adds no model call on any leg. The precision legs take 2 calls per
pass because `--quality` runs a recall pass and a precision pass; both arms pay
that identically.

### Elapsed time per pass

| Leg | Sweep off per run (ms) | Sweep on per run (ms) | Paired differences (on − off, ms) | Paired mean (ms) |
| --- | --- | --- | --- | --- |
| Extended | 15679, 14147, 15047, 14783, 12623 | 16019, 14198, 13768, 15421, 19445 | 340, 51, −1279, 638, 6822 | +1314.4 |
| Original-thirteen control | 12780, 13234, 14112, 14464, 14891 | 15873, 13348, 14550, 11786, 10180 | 3093, 114, 438, −2678, −4711 | −748.8 |
| Paired precision | 16844, 14032, 14440, 15305, 14520 | 18274, 19217, 13465, 15189, 12776 | 1430, 5185, −975, −116, −1744 | +756.0 |

Both configurations' figures are recorded above. The paired means are of
opposite sign across legs and are small against the run-to-run spread within
each arm, so the sweep shows no consistent elapsed-time effect.

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
alias — consistent with the current finding that this endpoint exposes no
immutable model-artifact identifier. No run above is classified as baseline
reproduction, and no field of the baseline is compared against the recorded
alias, nor is any figure from it carried into a comparison here. Its recall
figures are reproduced in this section only to identify the document; they are
not compared against the campaign.

The 2026-09-10 baseline is admissible for nothing except the observation that
the four defect kinds it identified as consistently missed are still missed —
and that observation is grounded in this campaign's own legs, not in the
baseline's numbers.

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
including the REGRESSED precision result recorded above. Acting on that result
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
- **The model identity is unattested**, as stated under
  [Model identity](#model-identity--the-comparison-is-inconclusive). Nothing
  above is a same-configuration claim.
