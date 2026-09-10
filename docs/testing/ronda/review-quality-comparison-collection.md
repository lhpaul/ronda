# Ronda Review Quality Comparison Collection

Use this runbook for the first Ronda-only quality batch. The goal is five real
PR comparisons before expanding to another repository.

## Scope

- Start with PRs in `lhpaul/ronda`.
- Record only same-head comparisons: Ronda and the other reviewer must inspect
  the same pull request head SHA.
- Treat disagreement records as `unclear` until a human adjudicates them.
- Do not use comparison evidence to merge, close, or relabel a PR.

## Collection Command

After Ronda is clean and the external reviewer has finished on the same head,
record the comparison:

```bash
npm run quality:comparison -- --pr 30 --other-result clean
```

The command resolves the current repository and PR head SHA with `gh`, then
writes a benchmark-compatible JSON file under `docs/testing/ronda/comparisons/`.
Use `--other-result findings`, `failed`, or `timeout` when Bugbot does not report
clean. Non-clean or stale-head records are created with an `unclear`
adjudication so a human can classify the outcome later.

Optional flags:

- `--repository owner/name` when recording evidence outside the current checkout.
- `--head-sha SHA` when the PR head must be pinned explicitly.
- `--other-reviewer "Cursor Bugbot"` to name the comparison platform.
- `--ronda-result clean|findings|failed|timeout`.
- `--ronda-head-sha SHA` and `--other-head-sha SHA` when reviewer evidence names
  explicit reviewed heads.
- `--ronda-findings-file findings.json` and `--other-findings-file findings.json`
  for structured finding arrays.
- `--adjudication ronda_miss|ronda_better|duplicate|clean_agreement|unclear`
  after human review.
- `--notes "..."` for the human adjudication rationale.
- `--out path.json` to append the record to a specific comparison file.

## First Batch Read

After five records exist, run:

```bash
npm run benchmark:quality -- --comparison-file docs/testing/ronda/comparisons/<file>.json --reviewed-target ronda-quality-batch-1
```

For a quick rollup across all committed comparison files, run
`npm run quality:summary`. Use `--file path.json` one or more times to summarize
specific files, or `--dir path` to summarize a different comparison directory.

Look for:

- Clean agreements.
- Confirmed Ronda misses.
- External-reviewer noise that Ronda avoided.
- Stale-head evidence that must be discarded or rerun.
- Miss categories that should become new seeded benchmark fixtures.
