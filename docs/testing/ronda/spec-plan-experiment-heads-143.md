# Spec/plan miss experiment — chosen heads (#143)

Committed **before any arm runs**, as #143 requires. Nothing here was chosen by looking at what a model returns; the heads follow from the recorded misses alone.

## Selection rule

From the committed miss records under `docs/testing/ronda/misses/` (all `true_positive`, none `staleEvidence`), count the recorded misses per `reviewedHeadSha`.

- #115 (spec): the **5** heads with the most recorded misses.
- #117 (plan): the **3** heads with the most recorded misses.
- **Ties** are broken by the later commit on the pull request (a head nearer the PR tip), then fixed. This was decided before looking at which heads the tie would select.

Every chosen head is a commit on its pull request. Run each arm **3 times per head**.

## Heads

| PR | Stage | Head | Recorded misses | Commit on PR |
| --- | --- | --- | --- | --- |
| #115 | spec | `a691d010a5bbefe2e77b1750f634d26b95c152f6` | 5 | 6 of 99 |
| #115 | spec | `90a694eabddd7a1d3a45d741c85e45d0c19df7b6` | 3 | 95 of 99 |
| #115 | spec | `40b89f74c8fd1c723d2ef121e88af7bb7a3bb03f` | 3 | 92 of 99 |
| #115 | spec | `8c28ba8c8f42b22cb569f6d4a6d25002886be8e0` | 3 | 90 of 99 |
| #115 | spec | `8a637efc47e64344f3f0fb6616cc2eab328da712` | 3 | 88 of 99 |
| #117 | plan | `a244cabd81e27645ba87311893267e365c0927f1` | 5 | 16 of 33 |
| #117 | plan | `194f66e5f3d469bc897e78ce4058c4883fa93ca0` | 4 | 19 of 33 |
| #117 | plan | `e991d21c556228526c84876ac0dac773f98aabe8` | 3 | 6 of 33 |

The 8 heads carry **29** recorded misses between them. That is the denominator for "recorded misses recovered" in every arm; the other 96 of the 125 are on heads outside this experiment.

## Context for plan heads

Arms B and C give a plan head the approved spec as context (arm A does not, exactly as production). The spec is `docs/specs/developments/20260925143028_105-category-forced-review-sweep/1_105-category-forced-review-sweep_specs.md` **as merged by #115** (merge commit `def04bd48cf551c62ff5d00ef4965c6471491600`), not the current `develop` copy, so later edits do not leak into the replay.

## Recorded miss ids per head

### #115 `a691d010` (5)

- `lhpaul-ronda-pr-115-manual-1317057ec63b`
- `lhpaul-ronda-pr-115-manual-650c2ce575d3`
- `lhpaul-ronda-pr-115-manual-91f04dbff9fa`
- `lhpaul-ronda-pr-115-manual-b596514c8898`
- `lhpaul-ronda-pr-115-manual-f5531b2144bc`

### #115 `90a694ea` (3)

- `lhpaul-ronda-pr-115-manual-25cd1570c897`
- `lhpaul-ronda-pr-115-manual-60739bb43732`
- `lhpaul-ronda-pr-115-manual-b3bda1d52264`

### #115 `40b89f74` (3)

- `lhpaul-ronda-pr-115-manual-46fdd12072ad`
- `lhpaul-ronda-pr-115-manual-8c1a912944bc`
- `lhpaul-ronda-pr-115-manual-fc2583c080d9`

### #115 `8c28ba8c` (3)

- `lhpaul-ronda-pr-115-manual-15abc9766ee4`
- `lhpaul-ronda-pr-115-manual-525d40c78849`
- `lhpaul-ronda-pr-115-manual-f1919e55de29`

### #115 `8a637efc` (3)

- `lhpaul-ronda-pr-115-manual-1a6dc4d2446e`
- `lhpaul-ronda-pr-115-manual-6d7d5a13709f`
- `lhpaul-ronda-pr-115-manual-a60379f3bbca`

### #117 `a244cabd` (5)

- `lhpaul-ronda-pr-117-manual-1ea43fc566b6`
- `lhpaul-ronda-pr-117-manual-562f60cc7912`
- `lhpaul-ronda-pr-117-manual-786e12c3ef38`
- `lhpaul-ronda-pr-117-manual-c0431a0f26cb`
- `lhpaul-ronda-pr-117-manual-cbbd7afa9034`

### #117 `194f66e5` (4)

- `lhpaul-ronda-pr-117-manual-049ef9722a8e`
- `lhpaul-ronda-pr-117-manual-50e9639c0561`
- `lhpaul-ronda-pr-117-manual-8b6a50f27cad`
- `lhpaul-ronda-pr-117-manual-b463fa6cc2be`

### #117 `e991d21c` (3)

- `lhpaul-ronda-pr-117-manual-4d9ab8fceee1`
- `lhpaul-ronda-pr-117-manual-907ddb0e2386`
- `lhpaul-ronda-pr-117-manual-f3aba42b7fc2`

## Fixed before the run

- The spec/plan prompt is written once and committed before arm B runs; it is not tuned against these records. Tuning, if wanted later, uses #115 only and holds #117 out.
- The decision thresholds in #143 stand unless the owner changes them **before** the first arm runs.
