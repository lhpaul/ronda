# Spec/plan miss experiment — results and match table (#143)

Rerun with **no PR description for any arm** (the first run replayed the current description, which holds post-head decisions; it is kept as `spec-plan-experiment-143-superseded-current-pr-body.jsonl` and not used here). Raw findings: `spec-plan-experiment-143.jsonl`. Arm C: requested `qwen3.8-max-2026-09-02`, endpoint reports `qwen3.8-max-0902`. 8 heads, 29 recorded misses, 3 runs per head.

Scoring was done by reviewer agents reading each finding against the document at its head; a match needs the same defect, not proximity. Verdicts on unmatched findings are a single-judge read, not ground truth.

## Summary

| Arm | Misses recovered (any run) | Clearly false per pass (mean / max) | Findings per pass |
| --- | --- | --- | --- |
| A (production prompt, `qwen-plus-2025-12-01`) | 0 of 29 (0%) | 0 / 0 | 0 |
| B (spec/plan prompt, same model) | 3 of 29 (10%) | 4.1 / 6 | 3-6 |
| C (spec/plan prompt, `qwen3.8-max`) | 15 of 29 (52%) | 3.8 / 10 (2.7 mean excluding 27 findings that only ask for a PR-description log the harness did not supply) | 10-25 |

## Decision (thresholds: B ≥ 30% recovered and ≤ 1 clearly false finding per pass)

- B fails both: 10% recovered, ~4.1 clearly false per pass.
- C clears the recovery bar (52%) but not the precision bar: ~3.8 clearly false per pass (2.7 after removing the PR-description artifacts), against a limit of 1.
- By the stated rule, **neither clears it**: do not build the mode as designed. The model is the larger lever (3 → 15 recovered), but a stronger model alone is not enough at this noise level.
- What the unreached 14 have in common (C): the typo-level defects (e.g. the extra closing parenthesis on `40b89f74`) and head `8c28ba8c` (0 of 3, precision-evidence pairing) are never named; the misses C recovers are mostly contradiction or undefined-case defects, plus the stray fragment and duplicated word on `40b89f74` (the extra closing parenthesis is not named).
- Cost: C ~11 min and 10-25 findings per pass; B ~10 s and 3-6 findings.
- Caveats: single judge; the real/plausible split on unmatched findings is the softest part (C: 206 real, 125 plausible, 92 clearly false of 423 unmatched); recovery varies across runs (C: 8, 14, 12 per run).
- Possible next step (not part of this experiment): a precision filter or findings cap on C's output, then re-measure; tracked in #157.

## Arm B match table

| Head | Run | Miss | Finding # | Reason |
| --- | --- | --- | --- | --- |
| 40b89f74 | 2 | 46fdd12072ad | 4 | Reports the duplicated trailing fragment "they do not pair the claim." (present twice in the claim-admissibility matrix row example); line numbers are off but the defect is the same. |
| a691d010 | 2 | b596514c8898 | 3 | Names OQ4/AC15 threshold-of-ten and adjudication condition as unresolved yet written as fixed; asks to resolve OQ4 (finding overstates it as a contradiction, but same underlying unresolved-decision defect). |
| a691d010 | 3 | 1317057ec63b | 0 | Says AC6 needs every candidate decided but OQ1/OQ8 leave candidates pending so the list cannot be marked current while the spec presents it as the initial list: same defect as the miss. |
| a691d010 | 3 | 1317057ec63b | 1 | AC6 violated by the documented list while OQ1/OQ8 unresolved, so no valid current list exists: same defect as the miss. |

## Arm C match table

| Head | Run | Miss | Finding # | Reason |
| --- | --- | --- | --- | --- |
| 194f66e5 | 1 | 50e9639c0561 | 9 | no mechanism supplies version-attestation basis; same defect |
| 194f66e5 | 2 | 50e9639c0561 | 4 | no mechanism supplies version-attestation basis; same defect |
| 194f66e5 | 2 | b463fa6cc2be | 20 | default single-run output identical vs new unconditional fields; same contradiction |
| 194f66e5 | 3 | 50e9639c0561 | 10 | no mechanism supplies version-attestation basis; same defect |
| 194f66e5 | 3 | b463fa6cc2be | 11 | default --runs output identical claim vs added fields; same contradiction |
| 40b89f74 | 1 | 46fdd12072ad | 14 | same stray fragment 'they do not pair the claim.' in matrix example |
| 40b89f74 | 1 | 8c1a912944bc | 15 | duplicated 'used.' in AC9 |
| 40b89f74 | 2 | 46fdd12072ad | 19 | same stray sentence in claim admissibility example |
| 40b89f74 | 2 | 8c1a912944bc | 18 | duplicated 'used.' in AC9 |
| 40b89f74 | 3 | 46fdd12072ad | 14 | same stray fragment in matrix example |
| 40b89f74 | 3 | 8c1a912944bc | 13 | duplicated 'used.' in AC9 |
| 8a637efc | 2 | 6d7d5a13709f | 11 | human-only defect on all-clean head has no terminal path / interacts with clean_agreement |
| 8a637efc | 2 | a60379f3bbca | 8 | repeated-run membership conflict for same defect has no resolution rule |
| 8a637efc | 3 | 1a6dc4d2446e | 10 | cohort cutoff can be chosen after results are visible to exclude unfavorable PRs; same outcome-aware cutoff selection |
| 90a694ea | 1 | 25cd1570c897 | 5 | Terminal miss record lacks sweep-off control miss entry |
| 90a694ea | 1 | b3bda1d52264 | 10 | AC8 'baseline comparability' vs no baseline reproduction possible; same inconsistency |
| 90a694ea | 2 | 25cd1570c897 | 6 | same: no control-miss code in terminal miss record |
| 90a694ea | 2 | b3bda1d52264 | 8 | same AC8 comparability label vs inability to reproduce baseline |
| 90a694ea | 3 | 25cd1570c897 | 5 | same: recorded control missing from terminal miss record |
| 90a694ea | 3 | b3bda1d52264 | 9 | same AC8 comparability vs reproduction contradiction |
| a244cabd | 2 | 786e12c3ef38 | 13 | literal matchTerms substring classification misses paraphrased findings; same defect |
| a244cabd | 2 | c0431a0f26cb | 15 | SweepCategory type has per-category version not in artifact/spec |
| a244cabd | 3 | c0431a0f26cb | 11 | SweepCategory per-category version field conflicts with list-level version |
| a691d010 | 1 | 1317057ec63b | 2 | no-current-list state vs exactly-one-current/AC6 with OQ1/8 undecided |
| a691d010 | 1 | 650c2ce575d3 | 3 | AC18 recognized on/off values undefined |
| a691d010 | 1 | f5531b2144bc | 6 | OQ7 operator-facing surface undefined for AC1/AC20 |
| a691d010 | 2 | 1317057ec63b | 2 | same: sweep enabled with no current list while OQ1/8 block currency |
| a691d010 | 2 | 1317057ec63b | 16 | every-candidate swept-or-excluded rule vs awaiting candidates |
| a691d010 | 2 | 650c2ce575d3 | 12 | AC18 recognized values undefined |
| a691d010 | 2 | f5531b2144bc | 6 | OQ7 surface |
| a691d010 | 3 | 1317057ec63b | 3 | AC6/OQ1,8 non-current list vs AC18/UC1 current-list assumption |
| a691d010 | 3 | 650c2ce575d3 | 2 | AC18 recognized values undefined |
| a691d010 | 3 | f5531b2144bc | 4 | OQ7 surface |
| e991d21c | 2 | f3aba42b7fc2 | 11 | secondary clause: no way given to access original 13-seed fixture after extending manifest |
| e991d21c | 3 | f3aba42b7fc2 | 3 | original 13-seed fixture paths not preserved before fixture is mutated; same defect |

## Arm A

0 findings in 24 of 24 runs; 0 of 29 recovered.
