# Review Quality Baseline: 2026-09-10

**Command**: `npm run benchmark:quality -- --comparison-file tests/fixtures/recall-benchmark/comparisons/clean-agreement.json --reviewed-target quality-same-head-smoke`
**Sample count**: 5
**Model**: `qwen-plus`
**Local evidence directory**: `/tmp/ronda-quality-samples-20260910170132`

## Summary

| Run | Seeded defects found | False positives | Precision clean |
| --- | --- | --- | --- |
| 1 | 7 / 13 | 1 | true |
| 2 | 8 / 13 | 0 | true |
| 3 | 8 / 13 | 0 | true |
| 4 | 8 / 13 | 0 | true |
| 5 | 6 / 13 | 0 | true |

## Defect-Level Counts

| Defect | Found count | Missed count |
| --- | --- | --- |
| `async-race-duplicate-processing` | 2 | 3 |
| `authorization-bypass` | 0 | 5 |
| `cache-capacity-off-by-one` | 5 | 0 |
| `configuration-debug-default` | 0 | 5 |
| `data-loss-overwrite` | 0 | 5 |
| `empty-word-title-casing` | 4 | 1 |
| `expired-session-inversion` | 2 | 3 |
| `invalid-range-parsing` | 0 | 5 |
| `lexicographic-numeric-sort` | 5 | 0 |
| `lower-element-median` | 5 | 0 |
| `sensitive-value-exposure` | 5 | 0 |
| `sql-interpolation` | 5 | 0 |
| `stale-sha-review-publication` | 4 | 1 |

## Calibration Note

Run 1 reported one false positive:

- `src/benchmark/jobs.ts`: `Race condition in job deduplication`

That finding maps to the existing `async-race-duplicate-processing` seed. The
benchmark fixture now credits the `race` + `job` + `deduplication` wording so
future runs classify this as recall evidence instead of noise.

## Initial Read

- Precision stayed clean in all five runs.
- The model was stable on sensitive value exposure, SQL interpolation, cache
  capacity, numeric sort, and median defects.
- The model consistently missed authorization bypass, data-loss overwrite,
  configuration debug default, and invalid range parsing.
- Same-head recall varied between 6 and 8 found defects, so future prompt/model
  work should track variance as well as average recall.
