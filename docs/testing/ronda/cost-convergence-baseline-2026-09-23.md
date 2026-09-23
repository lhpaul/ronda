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
| 99 | release → `main` | 171 | +30968 / -916 | 316 | 0.20 h | 14 | 19.1 m | 0 | 0 |
| 100 | release → `develop` | 28 | +30 / -35 | 1 | 0.20 h | 15 | 19.3 m | 0 | 0 |

Measurement notes:

- **Wall clock** is `mergedAt - createdAt` on the PR. It includes human idle
  time and is not an attempt at active-work time.
- **Files, +/- and commits are not taken from `gh pr view`**, which silently
  caps `commits` and `files` at 100. On PR #99 that cap reported
  `100 commits / 100 files / +16223 / -819` against a true
  `316 commits / 171 files / +30968 / -916` — a 3x understatement of commits and
  a 1.9x understatement of added lines. The paginated
  `pulls/{n}/commits` endpoint is not a fix either: it has its own documented
  250-commit ceiling and reported 250. The figures above come from the
  **merge-parent compare**, which is the only method that agrees with the diff:

  ```bash
  mc=$(gh pr view <n> --json mergeCommit --jq '.mergeCommit.oid')
  read -r base head < <(gh api "repos/<owner>/<repo>/commits/$mc" \
    --jq '[.parents[].sha] | @tsv')
  gh api "repos/<owner>/<repo>/compare/$base...$head" \
    --jq '{commits: .total_commits, files: (.files | length),
           additions: ([.files[].additions] | add),
           deletions: ([.files[].deletions] | add)}'
  ```

  Only PR #99 exceeded either cap — every other row reports well under 100
  commits and 100 files, so truncation cannot have applied to them. The five
  two-parent merges among them (#94, #95, #97, #98, #100) were re-verified under
  the compare method and matched exactly. #93 and #96 were squash-merged, so
  their merge commits have a single parent and the compare method does not
  apply; both are far below the cap.
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

**Window**: runs created between `2026-09-17T00:00:00Z` and
`2026-09-23T10:36:01Z` — the merge of #100, the last PR in scope. The upper
bound matters: without it the total keeps growing as later PRs (including the
one carrying this baseline) run CI, and the denominator would not be stable
enough to compare against later.

An earlier draft of this table used
`actions-cost-audit.sh --limit 500`, which returned **exactly** 500 runs — the
cap — so its 580.3 m total was truncated and its percentages were wrong. The
script's own "Data limitations" section warns about this. Re-running with
`--limit 3000` returns 1056 runs, comfortably under the cap and therefore
complete, but it has no `--until` flag, so it cannot be bounded at #100's
merge. The table below is derived directly from the runs API with both bounds
applied; the script command is given afterwards as the closest reproducible
approximation.

| Workflow | Runs | Total wall time | Share |
| --- | ---: | ---: | ---: |
| workflow test harnesses | 109 | 331.6 m | 37.3% |
| ShellCheck | 53 | 311.8 m | 35.1% |
| PR-Agent | 196 | 89.5 m | 10.1% |
| PR policy | 296 | 55.8 m | 6.3% |
| Markdown Lint | 102 | 46.5 m | 5.2% |
| Node CI | 64 | 37.5 m | 4.2% |
| E2E / Regression Tests (Template Placeholder) | 145 | 6.4 m | 0.7% |
| Update tracker status on PR merge | 29 | 4.6 m | 0.5% |
| Workflow lint | 24 | 3.9 m | 0.4% |
| Auto-tag release | 1 | 0.2 m | 0.0% |
| Claude Code Action PR Review | 0 | 0.0 m | 0.0% |
| Deploy (Template Placeholder) | 0 | 0.0 m | 0.0% |
| **Ronda review** | **0** | **0.0 m** | **0.0%** |
| **Total** | **1019** | **887.9 m** | |

All 13 active workflows are listed, including the three with no runs in the
window. A workflow that never ran is reported as a zero row rather than omitted
— "`Ronda review` has 0 runs" is the finding, and a table that simply left it
out would hide it.

887.9 m of Actions wall time across 1019 runs over six days. Per-workflow
figures are rounded to one decimal, so the rows sum to 887.8 m and the shares to
99.8%; the total is the unrounded sum.

Repository visibility is public and the workflows use standard GitHub-hosted
runners, so this window is expected to be zero-billable here. The number matters
as the **downstream** cost a private adopting repository would inherit, and as
the denominator for any later claim that a Ronda change made review cheaper.

The per-PR table above is **not** affected by the cap: each row was computed
from a branch-scoped, fully paginated query bounded by that PR's own
`createdAt`/`mergedAt`, with no run limit.

## Cost findings

1. **`Ronda review` contributes zero Actions time because it never runs.**
   `.github/workflows/ronda-review.yml` is `on: workflow_call` only and no
   workflow in this repository calls it. The last runs of any kind were
   2026-09-10 on `smoke/ronda-v0`, all `failure`. The only four Ronda reviews
   that exist anywhere in this repository are on two closed smoke-test PRs (#8,
   #21), posted by manual local runs on 2026-09-10. Ronda is not dogfooded. See
   Deliverable 1 in the baseline document.

2. **PR-Agent runs 196 times and publishes nothing.** Its run log shows
   `DEEPSEEK_API_KEY:` empty and `OPENAI_KEY not set`; the run reaches
   `Tokens: 79482, total tokens over limit: 32000, pruning diff.` and then ends
   without posting a review. No `PR Reviewer Guide` comment exists on any of
   #93–#100. 89.5 m of Actions wall time in this window — 10.1% of the total —
   produced no review signal. It is also the reason PR-Agent could not be used as a second
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
   combined.** 643.4 m of 887.9 m (72.5%) across 162 runs, both on
   `pull_request`. Neither is review quality; both are candidates for path or
   event narrowing if downstream Actions cost becomes a concern.

## Reproduction

Repository-wide audit. Use a limit high enough that the reported run count is
strictly below it — at `--limit 500` this repository returns exactly 500 runs,
which means the result is truncated and every total derived from it is wrong:

<!-- workflow-shell-contract: bash-zsh -->
```bash
set -euo pipefail
./scripts/development-workflow/actions-cost-audit.sh \
  --limit 3000 --since 2026-09-17T00:00:00Z --format markdown
```

The script has no `--until`, so its totals include everything up to the moment
it runs and cannot reproduce a fixed window. The window-bounded table above is
produced by a committed script that applies both bounds and performs the same
grouping, duration aggregation, run counting, and share calculation:

<!-- workflow-shell-contract: bash-zsh -->
```bash
set -euo pipefail
./docs/testing/ronda/scripts/actions-window-audit.sh
```

It takes optional `[repo] [since] [until]` arguments; the defaults are
`lhpaul/ronda`, `2026-09-17T00:00:00Z`, and `2026-09-23T10:36:01Z` (the merge of
#100), and reproduce the table above verbatim — including the 887.9 m total and
every share. It refuses rather than printing an empty table when no runs match
the window.

Per-PR figures:

```bash
gh pr view <n> --json number,createdAt,mergedAt,headRefName,commits,files
gh api "repos/lhpaul/ronda/actions/runs?branch=<head>&per_page=100" --paginate
```
