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
| The credential guard fails with the secret empty | Yes, against the workflow file rather than a paraphrase. The `run:` script of the `Require model credential` step (`.github/workflows/pr-agent.yml` lines 34-37) was extracted from the YAML and executed with `bash -e`: `DEEPSEEK_API_KEY=` (empty) exits 1 and prints the `::error` annotation, the variable unset exits 1, and `DEEPSEEK_API_KEY=x` exits 0. The hosted workflow was not run with the secret removed, to avoid disabling a live secret. |

## Added per-PR Actions time

| Measure | Value |
| --- | --- |
| Run `36067989986`, `created_at` → `updated_at` | 44 s |
| Same run, job `PR-Agent review` | 41 s |
| Same run, `PR-Agent` step (the model call) | 12 s |
| Last no-op run before the secret (`36060970656`), `PR-Agent` step | 11 s |
| Run `8cd0406` (second push to #110), `created_at` → `updated_at` | 36 s |
| Mean of the 127 most recent successful `pull_request` runs of this workflow, before and after the secret existed | 49 s |

The added Actions wall time per PR is therefore effectively zero: the earlier
no-op runs already executed the full container build and reached the model call,
and the `PR-Agent` step took 11 s before the secret existed and 12 s after. The
89.5 m recovered by removal would have come from the same runs, so the fix keeps
that spend and turns it into a review.

The guard step itself takes under 1 s, but it runs after the action's container
build (about 26 s in run `36067989986`), because the runner builds the action
image before the first step. A run that fails the guard therefore still spends
the build time; the guard makes the failure visible, not cheaper.

Not measured: DeepSeek API cost per PR. PR-Agent's `output_run_cost` is off
(`false` in the run log's config dump) and the figure was not read from the
provider. The run log shows PR-Agent's own defaults, which `.pr_agent.toml` does
not override, bounding a review at `max_model_tokens` 32000 per call and
`max_number_of_calls` 3. Read the actual figure from the DeepSeek usage
dashboard after several PRs.

## Follow-ups

- The baseline's 89.5 m / 196 runs averages about 27 s per run, below the 49 s
  successful-run mean above. Checked with `gh run list --workflow pr-agent.yml`
  over the baseline window: 109 `pull_request` runs (mean 47 s, 85.8 m) plus 87
  `issue_comment` runs that were skipped by the job `if:` (mean 2.6 s, 3.7 m)
  sum to 196 runs and 89.5 m, so the gap is the skipped runs.
- PR #110's diff is small. A large diff still prunes against the 32000-token
  limit (the original log showed 79482 tokens) and may produce a thinner review.
