# Spec/plan miss experiment — results and match table (#143)

> **Superseded.** These numbers come from a run that gave every head the *current* PR description, which holds decisions made after the replayed head (hindsight). The data is kept in `spec-plan-experiment-143-superseded-current-pr-body.jsonl`. The experiment was rerun with no PR description for any arm; see the rerun results.

Scoring was done by two reviewer agents reading each finding against the document at its head; matches require the same defect, not proximity. Verdicts on unmatched findings are a single-judge read, not ground truth. Raw findings: `spec-plan-experiment-143.jsonl`. Arm C: requested `qwen3.8-max-2026-09-02`, endpoint reports `qwen3.8-max-0902`.

## Arm B

- Distinct misses recovered: **1 of 29** (3%)
- Unmatched findings: {'plausible': 15, 'clearly_false': 79}
- Clearly false per (head, run): max 5, mean 3.29

| Head | Run | Miss | Finding # | Reason |
| --- | --- | --- | --- | --- |
| a691d010 | 1 | 1317057ec63b | 0 | claims valid-list/AC6 contradiction; centered on OQ1/8 unresolved so list cannot be current (weak match to M1) |
| a691d010 | 2 | 1317057ec63b | 0 | same OQ1/8-unresolved vs current-list point as M1 (weak) |
| a691d010 | 2 | 1317057ec63b | 1 | AC6 requires every candidate swept/excluded, yet OQ1/8 candidates remain undecided: same defect as M1 |
| a691d010 | 3 | 1317057ec63b | 1 | OQ1/8 unresolved vs list currency: M1 |

## Arm C

- Distinct misses recovered: **18 of 29** (62%)
- Unmatched findings: {'plausible': 291, 'real': 120}
- Clearly false per (head, run): max 0, mean 0.00

| Head | Run | Miss | Finding # | Reason |
| --- | --- | --- | --- | --- |
| 194f66e5 | 1 | 50e9639c0561 | 4 | version-attestation basis has no flag/config input |
| 194f66e5 | 1 | b463fa6cc2be | 20 | --runs 1 output identical claim contradicts unconditional identity blocks |
| 194f66e5 | 2 | 50e9639c0561 | 5 | version-attestation basis has no input |
| 194f66e5 | 2 | b463fa6cc2be | 12 | default --runs output identical claim contradicts new blocks |
| 194f66e5 | 3 | b463fa6cc2be | 2 | default output stability vs unconditional identity blocks |
| 40b89f74 | 1 | 46fdd12072ad | 18 | stray 'they do not pair the claim.' in claim admissibility row |
| 40b89f74 | 1 | 8c1a912944bc | 17 | duplicated 'used.' in AC9 |
| 40b89f74 | 2 | 46fdd12072ad | 16 | stray 'they do not pair the claim.' sentence |
| 40b89f74 | 2 | 8c1a912944bc | 15 | duplicated 'used.' in AC9 |
| 40b89f74 | 3 | 46fdd12072ad | 19 | stray fragment 'they do not pair the claim.' |
| 40b89f74 | 3 | 8c1a912944bc | 18 | duplicated 'used.' in AC9 |
| 8a637efc | 1 | a60379f3bbca | 7 | repeated-run membership: which record governs when a defect is published in only some runs |
| 8a637efc | 2 | 6d7d5a13709f | 2 | clean counting while human-only defect exists; no terminal outcome for human-only defect |
| 8a637efc | 3 | 6d7d5a13709f | 1 | human-recorded defect must block clean-result confirmation |
| 8c28ba8c | 2 | 15abc9766ee4 | 2 | no outcome code/record shape for human-recorded defect with no compared finding (terminal miss record) |
| 90a694ea | 1 | 25cd1570c897 | 1 | terminal miss record lacks sweep-off control miss entry |
| 90a694ea | 1 | b3bda1d52264 | 5 | AC8 'baseline comparability' contradicts statement baseline cannot be reproduced (fix suggestion differs) |
| 90a694ea | 2 | 25cd1570c897 | 3 | terminal miss record lacks control miss entry |
| 90a694ea | 2 | b3bda1d52264 | 12 | same AC8 baseline comparability vs non-reproducible baseline contradiction (nit) |
| 90a694ea | 3 | 25cd1570c897 | 2 | control miss has no terminal record |
| 90a694ea | 3 | b3bda1d52264 | 14 | same AC8 comparability vs reproduction wording |
| a244cabd | 2 | c0431a0f26cb | 16 | per-category version field on SweepCategory not in artifact |
| a244cabd | 2 | cbbd7afa9034 | 2 | not_determined must follow result availability, not publication |
| a244cabd | 3 | 786e12c3ef38 | 8 | substring matchTerms classification cannot attribute paraphrased findings; wants model-provided category |
| a244cabd | 3 | c0431a0f26cb | 18 | per-category version field inconsistent with list-level version |
| a691d010 | 1 | 1317057ec63b | 1 | names OQ1/OQ8 unresolved blocking AC6 list currency (also findings [2]) |
| a691d010 | 1 | b596514c8898 | 3 | OQ4/AC15 threshold still provisional |
| a691d010 | 1 | f5531b2144bc | 4 | OQ7 per-category record surface unnamed |
| a691d010 | 2 | 1317057ec63b | 4 | OQ1/OQ8 unresolved leaves no current list under AC6 |
| a691d010 | 2 | 650c2ce575d3 | 9 | AC18 never defines recognized on/off values |
| a691d010 | 2 | b596514c8898 | 8 | bundled: AC15/OQ4 still conditional (among other OQ refs) |
| a691d010 | 2 | f5531b2144bc | 5 | OQ7 surface for pass record unnamed |
| a691d010 | 3 | 1317057ec63b | 4 | OQ1/OQ8 unresolved, AC6 list cannot be current |
| a691d010 | 3 | 650c2ce575d3 | 8 | AC18 recognized values undefined |
| a691d010 | 3 | b596514c8898 | 6 | AC15 subject to OQ4 |
| a691d010 | 3 | f5531b2144bc | 5 | pass record surface undefined |
| e991d21c | 1 | f3aba42b7fc2 | 3 | original-fixture inputs undefined after step 9 mutates only manifest |
| e991d21c | 2 | f3aba42b7fc2 | 10 | original-fixture control inputs not materialized |
| e991d21c | 3 | 4d9ab8fceee1 | 7 | per-category record shown for sweep-off runs; wants it conditional on sweep-on |
| e991d21c | 3 | f3aba42b7fc2 | 9 | bundled: plan does not specify where original fixture files live after extension (also flag verification) |

## Arm A

0 findings in 24 of 24 runs; 0 of 29 recovered.

## Decision rule (thresholds: B ≥ 30% recovered, ≤ 1 clearly false finding per pass)

- B: fails both (3% recovered; mean ~3.3 clearly false per pass).
- C: clears both (see above) → only C clears the bar, so per #143 build the mode together with a stronger model for spec/plan PRs and record the per-pass cost: C took ~4.6 h across 24 passes (~11 min/pass) vs ~10 s/pass for B.
- Caveats: single judge; C's unmatched findings are mostly "plausible" (291 of 411) rather than verified real; the clearly-false asymmetry between B and C may partly reflect judging strictness.
