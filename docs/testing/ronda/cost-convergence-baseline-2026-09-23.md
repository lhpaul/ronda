# Ronda Cost and Convergence Baseline: 2026-09-23

Deliverable 3 of [#101](https://github.com/lhpaul/ronda/issues/101). Committed
so later quality work (category-forced sweep, read-only checkout with symbol
context, model tiering) can be measured against a real starting number instead
of the qualitative recollections in the issue body.

Scope: every pull request merged in the #93–#100 window
(2026-09-17 → 2026-09-23), the same window as
[`quality-cost-baseline-2026-09-23.md`](quality-cost-baseline-2026-09-23.md).

## Per-PR convergence

| PR | Kind | Files | +/- | Commits | Wall clock | Actions runs | Actions wall time | Loop summaries | Declared escalations |
| ---: | --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 93 | feature | 20 | +976 / -4 | 3 | 0.14 h | 20 | 9.3 m | 1 | 0 |
| 94 | plan | 2 | +363 / -0 | 1 | 0.10 h | 6 | 1.9 m | 1 | 0 |
| 95 | feature | 7 | +222 / -9 | 4 | 0.17 h | 8 | 14.3 m | 1 | 0 |
| 96 | feature | 9 | +464 / -37 | 2 | 0.11 h | 14 | 7.4 m | 1 | 0 |
| 97 | feature | 48 | +2988 / -42 | 25 | **70.12 h** | 179 | **316.4 m** | 2 | 0 |
| 98 | feature | 27 | +6813 / -19 | 33 | **21.13 h** | 193 | **186.8 m** | 5 | 3 |
| 99 | release → `main` | 100 | +16223 / -819 | 100 | 0.20 h | 14 | 19.1 m | 0 | 0 |
| 100 | release → `develop` | 28 | +30 / -35 | 1 | 0.20 h | 15 | 19.3 m | 0 | 0 |

Measurement notes:

- **Wall clock** is `mergedAt - createdAt` on the PR. It includes human idle
  time and is not an attempt at active-work time.
- **Actions runs / wall time** counts every workflow run on the PR's head branch
  between `createdAt` and `mergedAt`, summing `updated_at - run_started_at`. It
  is run wall time, not billable minutes, and parallel jobs inside one run are
  counted once. PRs #99 and #100 share the head branch `release/v0.2.0`, so
  their run sets overlap and must not be added together.
- **Loop summaries** counts issue comments whose body contains
  `Automated Reviewer Loop`. **Declared escalations** counts issue comments
  whose *first line* matches `escalat`. The heading test matters: a routine loop
  summary can mention the word inside its embedded history payload without being
  an escalation, which is true of one comment each on #94, #95 and #97 and two
  on #98. A body-substring count would report 2 / 4 / 3 / 10 for those PRs
  instead of 0 / 0 / 0 / 3.
- Loop summaries are a lower bound on passes: the loop rewrites one summary
  comment in place across iterations, so a single summary can represent many.
  The authoritative per-iteration count is in the embedded
  `reviewer-loop-history:v1` payload.
- **PR #98 is the only PR in this window with any declared escalation.** Its
  three are `escalation summary`, `escalated (low-value / thrashing)`, and
  `escalated (AC31 thrashing)`.

## Reviewer-loop iteration counts

From the embedded `reviewer-loop-history:v1` payload on each PR:

| PR | Loop iterations | Blocking findings (sum) | Unique blocking findings |
| ---: | ---: | ---: | ---: |
| 93 | 2 | 0 | 0 |
| 94 | 3 | 0 | 0 |
| 95 | 3 | 0 | 0 |
| 96 | 1 | 0 | 0 |
| 97 | 3 | 0 | 0 |
| 98 | **26** | **79** | **74** |
| 99 | — | — | — |
| 100 | — | — | — |

The history comment records only the most recent loop invocation's iteration
series. PR #97 took 25 commits over 70 hours and 316.4 m of Actions wall time,
so its `3 iterations / 0 blocking` row reflects the final clean run, not the
whole history. **#97's true convergence cost is not recoverable from committed
evidence** — this is a measurement gap, recorded in the baseline document.

## Aggregate

| Measure | #93–#96 (four small PRs) | #97 | #98 |
| --- | ---: | ---: | ---: |
| Commits | 10 | 25 | 33 |
| Wall clock | 0.52 h | 70.12 h | 21.13 h |
| Actions wall time | 32.9 m | 316.4 m | 186.8 m |
| Actions runs | 48 | 179 | 193 |
| Actions min / commit | 3.3 | 12.7 | 5.7 |
| Actions runs / commit | 4.8 | 7.2 | 5.8 |

Two PRs (#97, #98) account for **93.9%** of Actions wall time (503.2 m of
536.1 m) and **88.6%** of Actions runs (372 of 420) while carrying 58 of 68
commits. The denominator is the sum of the six non-release PRs #93–#98; #99 and
#100 are excluded because they share the head branch `release/v0.2.0` and their
run sets overlap, so they cannot be added to this total.

## Repository-wide Actions audit

`scripts/development-workflow/actions-cost-audit.sh --limit 500 --since 2026-09-17T00:00:00Z`
(500 runs; 0 incomplete duration records):

| Workflow | Runs | Total wall time | Avg | Dominant events |
| --- | ---: | ---: | ---: | --- |
| workflow test harnesses | 61 | 227.1 m | 3.7 m | `pull_request` (55), `schedule` (6) |
| ShellCheck | 37 | 222.5 m | 6.0 m | `pull_request` (37) |
| PR-Agent | 80 | 46.3 m | 0.6 m | `pull_request` (55), `issue_comment` (25) |
| Node CI | 56 | 32.6 m | 0.6 m | `pull_request` (53), `push` (3) |
| Markdown Lint | 55 | 26.1 m | 0.5 m | `pull_request` (55) |
| PR policy | 118 | 18.7 m | 0.2 m | `issue_comment` (63), `pull_request_target` (55) |
| Workflow lint | 24 | 3.9 m | 0.2 m | `pull_request` (23), `push` (1) |
| E2E / Regression (placeholder) | 64 | 2.3 m | 0.0 m | `pull_request` (62) |
| Update tracker on merge | 4 | 0.6 m | 0.2 m | `pull_request` (4) |
| Auto-tag release | 1 | 0.2 m | 0.2 m | `pull_request` (1) |
| **Ronda review** | **0** | **0 m** | — | **never triggered** |

Total: 580.3 m of Actions wall time over six days.

Repository visibility is public and the workflows use standard GitHub-hosted
runners, so this window is expected to be zero-billable here. The number matters
as the **downstream** cost a private adopting repository would inherit, and as
the denominator for any later claim that a Ronda change made review cheaper.

## Cost findings

1. **`Ronda review` contributes zero Actions time because it never runs.**
   `.github/workflows/ronda-review.yml` is `on: workflow_call` only and no
   workflow in this repository calls it. The last runs of any kind were
   2026-09-10 on `smoke/ronda-v0`, all `failure`. The only four Ronda reviews
   that exist anywhere in this repository are on two closed smoke-test PRs (#8,
   #21), posted by manual local runs on 2026-09-10. Ronda is not dogfooded. See
   Deliverable 1 in the baseline document.

2. **PR-Agent runs 80 times and publishes nothing.** Its run log shows
   `DEEPSEEK_API_KEY:` empty and `OPENAI_KEY not set`; the run reaches
   `Tokens: 79482, total tokens over limit: 32000, pruning diff.` and then ends
   without posting a review. No `PR Reviewer Guide` comment exists on any of
   #93–#100. 46.3 m of Actions wall time in this window produced no review
   signal. It is also the reason PR-Agent could not be used as a second
   external-reviewer source for the category ranking.

3. **Codex GitHub was rate-limited on four of six reviewable PRs.** #93–#96 each
   received `You have reached your Codex usage limits for code reviews` within
   seconds of the `@codex review` trigger. #97 was never triggered. Only #98
   produced real Codex output. External-reviewer coverage in this window is
   therefore **1 of 6** reviewable PRs.

4. **Convergence cost is dominated by re-finding one defect.** 14 of PR #98's
   74 unique blocking findings are restatements of the same PR-head / push-order
   reconstruction problem across iterations 1–22. The loop escalated three times
   and twice self-reported thrashing
   (`escalated (low-value / thrashing)`, `escalated (AC31 thrashing)`), and the
   PR was finally closed out under an explicit
   `Human product decision — waive local-ai AC31 tip finding`.

5. **ShellCheck and the workflow test harnesses cost more than everything else
   combined.** 449.6 m of 580.3 m (77%) across 98 runs, both on `pull_request`.
   Neither is review quality; both are candidates for path or event narrowing if
   downstream Actions cost becomes a concern.

## Reproduction

```bash
./scripts/development-workflow/actions-cost-audit.sh \
  --limit 500 --since 2026-09-17T00:00:00Z --format markdown
```

Per-PR figures:

```bash
gh pr view <n> --json number,createdAt,mergedAt,headRefName,commits,files
gh api "repos/lhpaul/ronda/actions/runs?branch=<head>&per_page=100" --paginate
```
