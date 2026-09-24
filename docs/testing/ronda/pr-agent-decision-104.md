# PR-Agent Decision: Fix, Not Remove

Decision record for [#104](https://github.com/lhpaul/ronda/issues/104), which
found the `PR-Agent` workflow running on every pull request and publishing
nothing (see "Cost findings" item 2 of
[`cost-convergence-baseline-2026-09-23.md`](cost-convergence-baseline-2026-09-23.md)).

## Decision

**Fix.** Keep `.github/workflows/pr-agent.yml`, configure the model credential,
and make the job fail when the credential is missing.

## What changed

- The `DEEPSEEK_API_KEY` repository secret was created on 2026-09-24. Before
  that the run log showed `DEEPSEEK_API_KEY:` empty and no review was posted.
- `pr-agent.yml` gains a first step, `Require model credential`, that exits 1
  with an `::error` annotation when `DEEPSEEK_API_KEY` is empty. The secret is
  passed through `env` and never echoed. Previously the job ran to the model
  call, published nothing and reported `success`.

## Evidence

| Check | Result |
| --- | --- |
| A real pull request carries a PR-Agent review comment | Yes. [#110](https://github.com/lhpaul/ronda/pull/110) received a `PR Reviewer Guide` comment on its first push (run `36067989986`). |
| The credential guard passes with the secret set | Yes. `Require model credential` concluded `success` in the same run. |
| The credential guard fails with the secret empty | Confirmed for the shell condition only (`DEEPSEEK_API_KEY= bash -c '[ -z "$DEEPSEEK_API_KEY" ]'` exits 1). The workflow was not run with the secret removed, to avoid disabling a live secret. |

## Added per-PR Actions time

| Measure | Value |
| --- | --- |
| Run `36067989986`, `created_at` → `updated_at` | 44 s |
| Same run, job `PR-Agent review` | 41 s |
| Mean of the 127 most recent successful `pull_request` runs of this workflow, before and after the secret existed | 49 s |

The added Actions wall time per PR is therefore effectively zero: the earlier
no-op runs already executed the full container build and reached the model call.
The 89.5 m recovered by removal would have come from the same runs, so the fix
keeps that spend and turns it into a review.

Not measured: DeepSeek API cost per PR. PR-Agent's `output_run_cost` is off and
this repository has no provider billing access. It is bounded by
`max_model_tokens = 32000` in `.pr_agent.toml` per call and at most three calls
(`max_number_of_calls`). Read the actual figure from the DeepSeek usage
dashboard after several PRs.

## Follow-ups

- The baseline's 89.5 m / 196 runs averages about 27 s per run, below the 49 s
  successful-run mean above. Skipped runs (for example on `develop`) are listed
  by `gh run list` and probably account for the gap, but that was not checked.
- PR #110's diff is small. A large diff still prunes against the 32000-token
  limit (the original log showed 79482 tokens) and may produce a thinner review.
