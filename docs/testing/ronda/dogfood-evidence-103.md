# Ronda Dogfooding Evidence: #103

Records how Ronda was wired to review this repository's own pull requests
([#103](https://github.com/lhpaul/ronda/issues/103), epic
[#52](https://github.com/lhpaul/ronda/issues/52)), the decisions taken, and the
first live evidence. The starting point is
[`quality-cost-baseline-2026-09-23.md`](quality-cost-baseline-2026-09-23.md),
which found that no merged pull request in this repository had ever carried a
Ronda review.

## Decisions

| Question | Decision | Knob |
| --- | --- | --- |
| Which PRs get a pass? | Every non-draft PR targeting `develop` (`opened`, `reopened`, `ready_for_review`, `synchronize`). Spec, plan and docs-only PRs are included so their review quality also produces evidence. | `on.pull_request.branches` in `ronda-review-dogfood.yml` |
| Cost cap per pass | Reusable-workflow default: `pass_timeout_minutes: 10` (job backstop 12). | `pass_timeout_minutes` input |
| Manual rerun | Not in #107. The `/ronda review` comment trigger was requested but dropped from this PR: GitHub loads `issue_comment` workflows from the default branch, so it cannot be exercised, and so cannot carry the same-PR proof `REVIEW.md` requires, until the PR merges. Follow-up. | `on.issue_comment` (absent) |
| Which Ronda reviews? | The reusable workflow's default `ronda_ref: main` (released v0.2.0). At the time of writing `develop` is 31 commits ahead, so this evidence describes the released reviewer, not unreleased work. | `ronda_ref` input |
| Trigger safety | `pull_request`, never `pull_request_target`. Fork PRs get no secrets and are skipped by the reusable workflow's fork guard. | |

## Evaluation caveat

Ronda now reviews the codebase it is developed in, and its prompts and
authoritative-document selection were written against that same codebase. Miss
evidence drawn from these PRs is therefore not independent of the reviewer's
tuning, and a rising catch rate here should not be read as generalisation to
other repositories. Treat it as regression evidence for this repository. The
caveat applies to every record captured from a PR reviewed after this change.

## Wiring defects found while dogfooding

Both were found on the first passes and are why the caller differs from the
adopter snippet in [`ronda-review-adoption.md`](../../adoption/ronda-review-adoption.md).

1. **Caller job name shadowed the check-run name.** The caller job was named
   `Ronda review`, which is also the constant name of the check run Ronda
   publishes. `findExistingCheckRun` matches on name alone, so the caller's own
   job check (including the `skipped` one a draft PR produces) made the
   automatic pass exit `already_reviewed_automatically` and publish nothing.
   Run 36037017660 succeeded green while posting no review. The caller job is
   now named `Ronda dogfood`. The adoption doc's snippet leaves the job unnamed,
   which avoids this by accident; it is not documented as a requirement.
2. **Workflow-level `cancel-in-progress` is entered by every PR comment.**
   Applies to the adoption snippet and to the follow-up that adds the comment
   trigger here, not to #107 itself, which has no comment trigger. The snippet's
   concurrency group is evaluated before any job `if:`, so an unrelated comment
   cancels an in-flight pass and is then skipped by Ronda, leaving no check run
   for that head SHA. The follow-up must not let a comment run cancel a pass
   (for example `cancel-in-progress` true only for `pull_request` runs). Found
   by reading the workflow semantics and `resolve-trigger.ts`, never observed
   live.

## Planted-violation proofs (`REVIEW.md`, Verification Discipline)

Each row is a run on this PR, addressed by workflow-run id. "Plant" is the
violation; the check must reject it and admit the same event once it is removed.

| Check | Plant | Fails with plant | Passes with plant removed |
| --- | --- | --- | --- |
| Draft pre-filter, `ronda-review-dogfood.yml` `jobs.ronda.if`, `pull_request` branch (`github.event.pull_request.draft != true`) | PR #107 opened as a draft | Runs 36036822400 and 36036974299: job `skipped`, no review, no check run | Run 36037017660 after `gh pr ready`: job executes |
| Caller job name must not equal `Ronda review`, `jobs.ronda.name` | Job named `Ronda review` (commit `b22369c`) | Run 36037017660 at head `b22369c`: green, `pass_skipped` reason `already_reviewed_automatically`, no review posted | Run 36037217176 at head `20ef109` (the only change is the rename): review posted, check run `success` |
| `on.pull_request.branches: [develop]`, `ronda-review-dogfood.yml` line 29 | Throwaway PR #108, non-draft, same tree as #107 (head `3d25631`) but base `tmp/103-branch-filter-base` instead of `develop` | #108: `PR-Agent`, `PR policy` and `Workflow lint` ran; no `Ronda review (dogfood)` run exists for its head branch | #107, same tree, base `develop`: run 36038367104 executed and succeeded |

#108 was closed and both of its throwaway branches were deleted immediately
after the observation. `pull_request` runs on every non-draft PR to `develop` are
shown by #107 itself. The `issue_comment` path is out of scope for this PR for the
reason given above.

## Live evidence (acceptance criteria 2 and 3)

Pull request [#107](https://github.com/lhpaul/ronda/pull/107), head
`20ef1099591e0ee4b7f7d19d8f2df4c6cddb9b7a`, a real (non-smoke) implementation PR:

- Published review: `## Ronda review`, trigger `Automatic`, model `qwen-plus`,
  duration 6 s, 2 files (+82/-0), by `github-actions`.
- Terminal check run: `Ronda review`, app `github-actions`, conclusion
  `success`, title `Review posted — 1 finding(s)`.
- The pass did not fail with `Review failed — model credential missing` or
  `... invalid`; `RONDA_MODEL_API_KEY` reached the pass.

The review's one finding (Blocking, "insecure comment text matching") was
directed at the substring match in the comment pre-filter. Its stated
consequence, "command injection", was overstated: Ronda re-checks the exact
command and the commenter's association itself, so nothing untrusted runs. But
the finding pointed at a real residual gap that the author had initially
dismissed and two other reviewers (the internal code reviewer and
`local-ai-reviewer`) independently reached: a comment that merely contains the
command can enter the concurrency group and cancel an in-flight pass, which
Ronda then skips. The comment trigger has since been removed from #107 (see
Decisions), so the finding is resolved by removal. Classification of this
finding as a true or false positive has not been independently adjudicated;
treat it as partially valid, mis-rated on impact.

## Miss capture (acceptance criterion 4)

`npm run quality:misses -- capture --pr 107 --reviewer codex-github ...` no
longer refuses at Stage 1 condition 3 (`no Ronda result to compare against`). Its
refusal on this PR moved to the next Stage 1 condition: the Codex GitHub
reviewer had no readable presence on the PR at the time of the run. That is a
property of when it was run, not of Ronda, and clears once the Codex review is
posted.

## Cost impact (acceptance criterion 5)

Baseline: 887.9 runner-minutes over 1,019 runs in the six-day #93–#100 window
([`cost-convergence-baseline-2026-09-23.md`](cost-convergence-baseline-2026-09-23.md)).

Measured on #107 (job start to job end, from the Actions jobs API):

| Run | Outcome | `setup` | `review` | Job time | Run wall time |
| --- | --- | ---: | ---: | ---: | ---: |
| 36037217176 | review published | 2 s | 21 s | 23 s | 29 s |
| 36037017660 | skipped (`already_reviewed_automatically`) | 3 s | 16 s | 19 s | n/a |

Every pass pays checkout, `npm ci` and Node setup whether or not it reviews, so
a skipped pass costs nearly as much as a real one. GitHub bills each job rounded
up to a whole minute, so one pass is 2 billed minutes (two jobs) regardless of
the 19–23 s measured.

Projection, an estimate and not a measurement: the #93–#98 non-release PRs
contain 68 commits (3 + 1 + 4 + 2 + 25 + 33). Each push is one `synchronize`
run, so the same window would have added at most about 136 billed minutes,
roughly 15% of the 887.9 baseline, plus one extra run per `opened` and
`ready_for_review` transition. The bulk sits in #97 and #98 (58 of the 68
commits, about 116 minutes), which is where `pass_timeout_minutes` matters: this
measurement is a 6-second model call on an 82-line diff, and the projection
assumes passes stay near that. Passes over the large diffs in #97 and #98
(+2,988 and +6,813 lines) would run longer, up to the 12-minute job backstop.
One sample does not support a per-line estimate.

Re-run the #101 baseline after roughly 10 dogfooded PRs and replace this
projection with a measured figure.
