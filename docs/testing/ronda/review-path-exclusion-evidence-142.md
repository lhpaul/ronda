# Review path exclusion: #119 control-pass evidence (#142)

Acceptance evidence for review path exclusion (#134, merged in #137) on the
real data that produced the original false positives: the head of
[#119](https://github.com/lhpaul/ronda/pull/119)
(`81fa5a7b881ea3c746a476aa37dee3bcf0e8464d`), which commits the #105 sweep
campaign JSON records.

Raw records: [`review-path-exclusion-control-passes.jsonl`](review-path-exclusion-control-passes.jsonl)
(one JSON line per pass, in run order).

## How the passes were run

Every pass is the non-publishing control pass (`npm run quality:control-pass`):
GitHub reads only, and every write is refused and counted. A non-zero count
fails the run, and all six passes exited 0. Nothing was posted to #119 or any
other pull request. All six passes used:

- `--pr 119 --repository-context off`
- `RONDA_MODEL_NAME=qwen-plus-2025-12-01` (the dated snapshot the dogfood
  workflow pins), set for these runs only. The default model and prompt are
  unchanged.
- Exclusion arm: `RONDA_EXCLUDE_PATH_GLOBS="docs/testing/ronda/**/*.json,tests/fixtures/recall-benchmark/**"`,
  the same globs `ronda-review-dogfood.yml` passes. Baseline arm: unset.
- Sweep off (operator default) for passes 1–3. Sweep on
  (`RONDA_SWEEP_MODE=on`, as the dogfood workflow runs) for passes 4–6.

The planted pass adds `--plant-fixture tests/fixtures/review-path-exclusion/planted-defect.json`.
That appends one synthetic changed file to #119's real changed-file list, in
memory and for that pass alone. The file is `src/review/excluded-bytes.ts`: a
non-excluded `.ts` file with an off-by-one loop bound
(`index <= listed.length`) that throws a `TypeError` on every call. The file
exists only in the fixture. Nothing was pushed to #119 or to any branch.

## Results

| # | Sweep | Exclusion | Planted `.ts` | Files reviewed | Lines (+/-) | Excluded listed | Findings | Model calls |
| - | ----- | --------- | ------------- | -------------- | ----------- | --------------- | -------- | ----------- |
| 1 | off | on | no | 5 | +1109/-14 | 7 | 0 | 1 |
| 2 | off | on | yes | 6 | +1123/-14 | 7 | 1 blocking, `src/review/excluded-bytes.ts:10` | 1 |
| 3 | off | off (baseline) | no | 12 | +5709/-14 | 0 | 0 | 1 |
| 4 | on | on | no | 5 | +1109/-14 | 7 | 0 | 1 |
| 5 | on | on | yes | 6 | +1123/-14 | 7 | 1 blocking, `src/review/excluded-bytes.ts:10` | 1 |
| 6 | on | off (baseline) | no | 12 | +5709/-14 | 0 | 0 | 1 |

Six model calls in total. Every pass succeeded.

The summary each exclusion pass would have published (recorded verbatim in
the `summary` field) contains:

```text
### Excluded from review

7 file(s) excluded before review:
- `docs/testing/ronda/sweep-categories.json`
- `docs/testing/ronda/sweep-off-extended.json`
- `docs/testing/ronda/sweep-off-original-thirteen.json`
- `docs/testing/ronda/sweep-off-precision.json`
- `docs/testing/ronda/sweep-on-extended.json`
- `docs/testing/ronda/sweep-on-original-thirteen.json`
- `docs/testing/ronda/sweep-on-precision.json`
```

## Acceptance criteria

- **Zero findings on `docs/testing/ronda/**/*.json`: met.** No exclusion pass
  (1, 2, 4, 5) produced a finding on any `docs/testing/ronda/**/*.json` path.
  The seven matching files never reached the prompt: reviewed changed lines
  fell from +5709 to +1109.
- **The summary lists the excluded files (count + bounded list): met.** Each
  exclusion pass's summary states `7 file(s) excluded before review:` followed
  by the seven paths (the list caps at 20 entries).
- **A planted real defect in a non-excluded `.ts` file is still reported:
  met.** Passes 2 and 5 each report the planted off-by-one as a single
  Blocking finding at `src/review/excluded-bytes.ts:10` (the planted loop
  line), in the same pass that excluded the seven JSON files. Pass 2 titles
  it "Off-by-one loop bound in excludedBytesWithinLimit" and pass 5
  "Off-by-one loop bound causes out-of-bounds access".
- **The seeded recall benchmark is unchanged: met.** This change touches
  nothing under `tests/fixtures/recall-benchmark/`, and the benchmark's tests
  pass unchanged in `npm test`.

## Limitation: the original false positives do not reproduce today

The baseline passes (3, 6) review all twelve files, the seven JSON records
included, and report **zero** findings with the same pinned model, with sweep
both off and on. The 55 Blocking false positives in #134 do not reproduce on
today's `develop`, even without exclusion. These passes therefore show that
exclusion keeps the campaign JSON out of the prompt and names it in the
summary. They do not show findings dropping from 55 to 0. What changed since
the original dogfood passes was not isolated here. One candidate is the #158
filter, which drops credential claims made against fixed strings that only
name a credential, the same class as the original "Hardcoded sensitive
credential" titles. Model sampling variance is another.
