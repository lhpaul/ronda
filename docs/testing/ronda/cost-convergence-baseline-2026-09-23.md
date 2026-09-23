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
- **Files, +/- and commits come from the pull request object**
  (`gh api repos/<owner>/<repo>/pulls/<n>`), whose `commits`, `changed_files`,
  `additions` and `deletions` fields are authoritative totals with no item cap.
  Two tempting alternatives are wrong and were both tried first:

  - `gh pr view --json commits,files` silently caps each array at 100. On PR #99
    that reported `100 commits / 100 files / +16223 / -819` against the true
    `316 / 171 / +30968 / -916` — a 3x understatement of commits and 1.9x of
    added lines. Every other PR here is under the cap and was unaffected.
  - `compare/<base>...<head>` between the merge commit's parents resolves a
    different merge base than the pull request's own, and reports
    `+18437 / -902` for PR #99 against the same 171 files. It is also
    inapplicable to the squash-merged PRs (#93, #96), whose merge commits have a
    single parent.

  All eight rows above were re-derived from the pull request object and match.

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

The table below is **derived from a committed snapshot**, not from a live query:
[`evidence/actions-window-2026-09-17_2026-09-23.csv`](evidence/actions-window-2026-09-17_2026-09-23.csv).
The snapshot holds one row per workflow-run attempt in the window
(`run_id, attempt, workflow, attempt_started, attempt_ended`), plus one row with
empty columns for each workflow that had no attempts at all, so zero-run
workflows stay visible.

`run_id` and `attempt` are carried so the counts are **auditable from the data
itself** rather than asserted: 1020 attempt rows, 1019 distinct `run_id` values,
and zero repeated `(run_id, attempt)` pairs. Without those columns, two
byte-identical rows could equally mean two genuine runs or one accidentally
collected twice, and a duplicate or omission would shift the baseline
undetectably. The derivation below asserts all three invariants and fails loudly
if the file is ever edited into an inconsistent state.

Freezing the inputs is the point. An earlier revision of this document
re-derived the table by re-querying the Actions API on every run, and each
review round found a new way that query could disagree with itself over time: a
truncating run limit, a workflow roster read from mutable current state, and
three separate mistakes about which attempt of a re-run belongs to a historical
window. A baseline whose inputs are committed has none of those failure modes —
the numbers cannot move unless someone edits the data, and the edit shows up in
review.

| Workflow | Runs | Total wall time | Share |
| --- | ---: | ---: | ---: |
| workflow test harnesses | 109 | 331.6 m | 37.3% |
| ShellCheck | 53 | 311.8 m | 35.1% |
| PR-Agent | 196 | 89.5 m | 10.1% |
| PR policy | 297 | 56.0 m | 6.3% |
| Markdown Lint | 102 | 46.5 m | 5.2% |
| Node CI | 64 | 37.5 m | 4.2% |
| E2E / Regression Tests (Template Placeholder) | 145 | 6.4 m | 0.7% |
| Update tracker status on PR merge | 29 | 4.6 m | 0.5% |
| Workflow lint | 24 | 3.9 m | 0.4% |
| Auto-tag release | 1 | 0.2 m | 0.0% |
| Claude Code Action PR Review | 0 | 0.0 m | 0.0% |
| Deploy (Template Placeholder) | 0 | 0.0 m | 0.0% |
| **Ronda review** | **0** | **0.0 m** | **0.0%** |
| **Total** | **1020** | **888.1 m** | |

All 13 active workflows are listed, including the three with no runs in the
window. A workflow that never ran is reported as a zero row rather than omitted
— "`Ronda review` has 0 runs" is the finding, and a table that simply left it
out would hide it.

Re-runs are counted **per attempt**. GitHub keeps a re-run's original
`created_at` but exposes only the *latest* attempt's `run_started_at` and
`updated_at`. Aggregating the listing as-is would let a re-run performed after
the cutoff silently rewrite this fixed historical window; attributing everything
to attempt 1 instead would discard re-runs that genuinely happened inside it and
undercount the cost. The script therefore enumerates every attempt of any run
with `run_attempt > 1` and counts each one whose `run_started_at` falls inside
the window, excluding attempts started after the cutoff.

Candidate runs are selected by `created_at <= until` **only**. A lower bound on
`created_at` would drop a run created *before* the window whose re-run attempt
started *inside* it, since `created_at` is not updated by a re-run. Window
membership is decided entirely by each attempt's own `run_started_at`.

Exactly one run in this window is affected: `PR policy`, id `35218024569`,
`run_attempt: 2`. Both attempts started inside the window — 8 s and 10 s — so it
contributes 2 attempts and 18 s, giving 1020 attempts across 1019 distinct runs.
Counting only the latest attempt would have given 1019 / 887.9 m with a total
that drifts on any future re-run; counting only the first, 1019 / 887.9 m with
10 s missing.

The repository has 8 multi-attempt runs created at or before the cutoff, 7 of
them before the window opened. None of those 7 has an attempt inside the window,
so dropping the `created_at` lower bound changes no number here — the hole it
closes is latent on this data, not active. It is closed anyway because the
correct result must not depend on that coincidence.

888.1 m of Actions wall time across 1020 workflow-run attempts over six days.
Per-workflow figures are rounded to one decimal, so the rows sum to 888.0 m and
the shares to 99.8%; the total is the unrounded sum.

The **Runs** column counts *attempts*, not distinct run records — a re-run
consumed Actions minutes twice and is counted twice. Exactly one run in this
window was re-run, so 1020 attempts come from 1019 distinct runs, which the
snapshot's `run_id` column makes checkable.

Regenerate the table from the snapshot. No network and no API, so the same
input always produces the same table:

```python
import csv, collections, datetime

agg = collections.defaultdict(lambda: [0, 0.0])
seen_attempts = set()
run_ids = set()


def parse(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))


path = "docs/testing/ronda/evidence/actions-window-2026-09-17_2026-09-23.csv"
with open(path) as handle:
    for row in csv.DictReader(handle):
        entry = agg[row["workflow"]]          # materialises zero-run workflows
        if not row["attempt_started"]:
            continue
        key = (row["run_id"], row["attempt"])
        assert key not in seen_attempts, f"duplicate attempt row: {key}"
        seen_attempts.add(key)
        run_ids.add(row["run_id"])
        entry[0] += 1
        entry[1] += (parse(row["attempt_ended"])
                     - parse(row["attempt_started"])).total_seconds() / 60

total = sum(minutes for _, minutes in agg.values())
runs = sum(count for count, _ in agg.values())

assert runs == len(seen_attempts) == 1020, runs
assert len(run_ids) == 1019, len(run_ids)

print("| Workflow | Runs | Total wall time | Share |")
print("| --- | ---: | ---: | ---: |")
for name, (count, minutes) in sorted(agg.items(), key=lambda kv: (-kv[1][1], kv[0])):
    print(f"| {name} | {count} | {minutes:.1f} m | {minutes / total * 100:.1f}% |")
print(f"| **Total** | **{runs}** | **{total:.1f} m** | |")
```

### Cost: runner minutes, not run wall time

The table above measures **workflow-run wall time**, which is elapsed latency,
not compute consumed. A run's wall time is counted once across the whole run,
but every job inside it consumes runner time separately — and the job counts
here differ by three orders of magnitude:

| Workflow | Jobs | Wall time | Share of wall | Runner minutes | Share of minutes |
| --- | ---: | ---: | ---: | ---: | ---: |
| workflow test harnesses | 3,271 | 331.6 m | 37.3% | **3,540 m** | **78.5%** |
| ShellCheck | 53 | 311.8 m | 35.1% | 338 m | 7.5% |
| PR policy | 297 | 56.0 m | 6.3% | 300 m | 6.7% |
| PR-Agent | 196 | 89.5 m | 10.1% | 110 m | 2.4% |
| Markdown Lint | 102 | 46.5 m | 5.2% | 102 m | 2.3% |
| Node CI | 64 | 37.5 m | 4.2% | 64 m | 1.4% |
| Update tracker on merge | 29 | 4.6 m | 0.5% | 29 m | 0.6% |
| Workflow lint | 24 | 3.9 m | 0.4% | 24 m | 0.5% |
| Auto-tag release | 1 | 0.2 m | 0.0% | 1 m | 0.0% |
| E2E / Regression (placeholder) | 145 | 6.4 m | 0.7% | 0 m | 0.0% |
| **Ronda review** | **0** | **0.0 m** | **0%** | **0 m** | **0%** |
| **Total** | **4,182** | **888.1 m** | | **4,508 m** | |

`workflow-tests.yml` runs its suites as a `max-parallel: 8` matrix — one
observed run expanded to 82 jobs — while ShellCheck runs a single job. **Ranking
by wall time gets the answer wrong, not merely imprecise**: ShellCheck and the
harnesses look comparable at 35.1% and 37.3% of wall time, but in runner minutes
the harnesses are 78.5% and ShellCheck is 7.5%, a 10x difference. Total runner
minutes are 4,508 against 888.1 m of wall time, 5.1x.

#### What "runner minutes" means here

This is an **estimate of the rounded runner minutes a private repository would
consume**, not a bill and not actual billed usage. This repository is public on
standard GitHub-hosted runners, so its real billable total for this window is
expected to be **zero**. The number exists to size downstream exposure and to
rank where compute goes.

The estimate is built as follows, and each rule is visible in the derivation
below:

- **A job is charged only when it has a positive measured duration.** 267 of the
  4,182 jobs do not: 261 `skipped` and 6 `cancelled`, of which 149 report
  `completed_at` before `started_at` and 118 report the two as equal. Those
  records carry no evidence that a runner ran, so they are charged 0 rather than
  rounded up to a minute. This is why the E2E placeholder shows 145 jobs and
  0 m — every one of its jobs skips — and why PR-Agent's 110 m sits well below
  its 196 jobs.
- **Rounding dominates the rest.** Raw job time across the 3,915 measurable jobs
  is 1,506.4 m. GitHub rounds each job up to the minute, and rounding 3,271
  mostly-sub-minute harness jobs to a minute each is what turns 1,506.4 into
  4,508.
- **A 1x runner multiplier is assumed**, true for this repository's
  `ubuntu-latest` but not necessarily for a downstream adopter. Larger or
  non-Linux runners bill at a multiple.

The charge rule keys on measured duration rather than on `conclusion`, so a
cancelled job that did consume runner time before being cancelled is still
counted — 73 of the 79 cancelled jobs are. Only the 6 with no positive duration
are not.

Use the account's billing data for an exact figure.

#### Provenance

[`evidence/actions-window-jobs-2026-09-17_2026-09-23.csv`](evidence/actions-window-jobs-2026-09-17_2026-09-23.csv)
is a frozen snapshot of every job belonging to the 1,020 attempts above, carrying
`workflow, run_id, attempt, job_id, job, status, conclusion, started_at,
completed_at`. The identity columns are what make the cost ranking auditable:
`job_id` is unique across all 4,182 rows, and every `(run_id, attempt)` pair
appears in the attempt snapshot. The derivation asserts both.

Collected via `/actions/runs/<id>/attempts/<n>/jobs` for **every** attempt,
including attempt 1:

<!-- workflow-shell-contract: bash-zsh -->
```bash
set -euo pipefail
repo=lhpaul/ronda
out=/tmp/actions-window-jobs.csv
snapshot=docs/testing/ronda/evidence/actions-window-2026-09-17_2026-09-23.csv

printf 'workflow,run_id,attempt,job_id,job,status,conclusion,started_at,completed_at\n' > "$out"

tail -n +2 "$snapshot" | while IFS=, read -r run_id attempt workflow rest; do
  [ -n "$run_id" ] || continue
  gh api "repos/${repo}/actions/runs/${run_id}/attempts/${attempt}/jobs?per_page=100" \
    --paginate --jq \
    ".jobs[] | [\"${workflow}\", \"${run_id}\", \"${attempt}\", (.id|tostring),
                .name, (.status // \"\"), (.conclusion // \"\"),
                (.started_at // \"\"), (.completed_at // \"\")] | @csv" >> "$out"
done

diff <(tail -n +2 "$out" | sed 's/"//g' | sort) \
     <(tail -n +2 docs/testing/ronda/evidence/actions-window-jobs-2026-09-17_2026-09-23.csv \
       | sed 's/"//g' | sort)
```

A clean `diff` re-derives the snapshot's completeness: no job of any in-window
attempt was dropped during collection. It was executed against the committed
snapshot while preparing this document and returned no differences.

**Use the per-attempt endpoint, not `/actions/runs/<id>/jobs`.** The generic
endpoint returns the *latest* attempt's jobs whatever attempt you meant, so
collecting attempt 1 through it silently records attempt 2's job id, timings and
conclusion under `attempt,1`. An earlier revision of this snapshot did exactly
that and, for the one re-run in this window (`PR policy`, run `35218024569`),
recorded the same `job_id` twice — which looked like GitHub not retaining a job
record per attempt, and was written up here as a limitation. It was not. The
per-attempt endpoint returns two genuinely distinct jobs: `105191051145`
(`failure`, 11:52:51) for attempt 1 and `105197350130` (`success`, 12:14:04) for
attempt 2. All 4,182 `job_id` values are distinct and no deduplication is
needed.

#### Regenerating the runner-minutes table

```python
import csv, collections, math, datetime

agg = collections.defaultdict(lambda: [0, 0.0, 0])
job_ids = set()
attempts = set()


def parse(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))


jobs_path = "docs/testing/ronda/evidence/actions-window-jobs-2026-09-17_2026-09-23.csv"
runs_path = "docs/testing/ronda/evidence/actions-window-2026-09-17_2026-09-23.csv"

known_attempts = {
    (row["run_id"], row["attempt"])
    for row in csv.DictReader(open(runs_path)) if row["run_id"]
}

with open(jobs_path) as handle:
    for row in csv.DictReader(handle):
        assert row["job_id"] not in job_ids, f"duplicate job_id {row['job_id']}"
        job_ids.add(row["job_id"])
        attempts.add((row["run_id"], row["attempt"]))

        minutes = 0.0
        if row["started_at"] and row["completed_at"]:
            minutes = (parse(row["completed_at"])
                       - parse(row["started_at"])).total_seconds() / 60
        # A job is charged only on positive measured duration. Skipped and
        # instantly-cancelled legs report completed_at <= started_at and carry
        # no evidence a runner ran, so they are 0 rather than a rounded-up
        # minute. Everything measurable rounds up per job.
        billed = 0 if minutes <= 0 else max(1, math.ceil(minutes))
        minutes = max(0.0, minutes)

        entry = agg[row["workflow"]]
        entry[0] += 1
        entry[1] += minutes
        entry[2] += billed

assert attempts <= known_attempts, attempts - known_attempts
assert len(job_ids) == 4182, len(job_ids)

total = sum(billed for _, _, billed in agg.values())
print(f"jobs={len(job_ids)} raw={sum(r for _, r, _ in agg.values()):.1f} m "
      f"runner-minutes={total} m")
for name, (count, raw, billed) in sorted(agg.items(), key=lambda kv: -kv[1][2]):
    print(f"{name:<46}{count:>6}{raw:>9.1f}{billed:>7}{billed / total * 100:>7.1f}%")
```

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

5. **The workflow test harnesses alone are four fifths of compute cost.**
   3,540 of 4,508 runner minutes (78.5%) across 3,271 jobs, from a
   `max-parallel: 8` suite matrix on `pull_request`. It is the single
   highest-value target for path or event narrowing if downstream Actions cost
   matters.

   An earlier revision of this document ranked by wall time and reported
   "ShellCheck and the workflow test harnesses are 72.4% combined". That was
   **wrong, not merely imprecise**: by wall time the two look comparable (35.1%
   and 37.3%), but ShellCheck runs one job per run and is 7.5% of runner
   minutes, while the harnesses are 78.5%. Wall time hid a 10x difference. The
   corrected ranking is in the runner-minutes table above.

## Reproduction

Repository-wide audit. The committed table is regenerated from the frozen
snapshot with the snippet in the audit section above — no network, no API.

How the snapshot was collected. This is the complete, executable collection —
run it and diff against the committed file to re-derive the snapshot's
completeness, which the file's internal checks cannot establish on their own:

<!-- workflow-shell-contract: bash-zsh -->
```bash
set -euo pipefail
repo=lhpaul/ronda
since=2026-09-17T00:00:00Z
until=2026-09-23T10:36:01Z
out=/tmp/actions-window.csv

# Candidate runs are selected by the UPPER bound only. A lower bound on
# created_at would drop a run created before the window whose re-run attempt
# started inside it, because GitHub does not update created_at on a re-run.
candidates="$(gh api "repos/${repo}/actions/runs?per_page=100" --paginate \
  | jq -r --arg until "$until" '
      .workflow_runs[]
      | select(.created_at <= $until)
      | [(.id | tostring), (.run_attempt | tostring), .name,
         .run_started_at, .updated_at]
      | @tsv')"

printf 'run_id,attempt,workflow,attempt_started,attempt_ended\n' > "$out"

# Expand each candidate into attempts and keep those that STARTED in the window.
printf '%s\n' "$candidates" | while IFS=$'\t' read -r id attempts name started ended; do
  [ -n "$id" ] || continue
  if [ "$attempts" = "1" ]; then
    if [ ! "$started" \< "$since" ] && [ ! "$started" \> "$until" ]; then
      printf '%s,1,"%s",%s,%s\n' "$id" "$name" "$started" "$ended" >> "$out"
    fi
    continue
  fi
  n=1
  while [ "$n" -le "$attempts" ]; do
    row="$(gh api "repos/${repo}/actions/runs/${id}/attempts/${n}" \
      --jq '[.run_started_at, .updated_at] | @tsv')"
    a_started="$(printf '%s' "$row" | cut -f1)"
    a_ended="$(printf '%s' "$row" | cut -f2)"
    if [ -n "$a_started" ] && [ ! "$a_started" \< "$since" ] \
        && [ ! "$a_started" \> "$until" ]; then
      printf '%s,%s,"%s",%s,%s\n' "$id" "$n" "$name" "$a_started" "$a_ended" >> "$out"
    fi
    n=$((n + 1))
  done
done

# One empty-column row per workflow that contributed no attempts, so zero-run
# workflows stay visible in the table. The roster is PINNED to the 13 workflows
# active at the cutoff. Querying /actions/workflows here would return the
# CURRENT roster instead, so a workflow enabled, disabled, renamed, or deleted
# after the window would change the generated rows and break this check even
# with every run still retained.
while IFS= read -r wf; do
  if ! grep -q ",\"${wf}\"," "$out"; then
    printf ',,"%s",,\n' "$wf" >> "$out"
  fi
done <<'ROSTER'
Auto-tag release
Claude Code Action PR Review
Deploy (Template Placeholder)
E2E / Regression Tests (Template Placeholder)
Markdown Lint
Node CI
PR policy
PR-Agent
Ronda review
ShellCheck
Update tracker status on PR merge
Workflow lint
workflow test harnesses
ROSTER

# Compare against the committed snapshot. Sorting drops ordering differences;
# any remaining diff is a real discrepancy.
diff <(tail -n +2 "$out" | sed 's/"//g' | sort) \
     <(tail -n +2 docs/testing/ronda/evidence/actions-window-2026-09-17_2026-09-23.csv \
       | sed 's/"//g' | sort)
```

A clean `diff` is the completeness evidence for the **attempt** rows: it shows
that no attempt was dropped during collection. It was executed against the
committed snapshot while preparing this document and returned no differences.

The **zero-run** rows are evidence of a weaker kind. Their roster is pinned to
the 13 workflows active at the cutoff — the list is literal in the snippet above
so it is auditable — which means the diff confirms the snapshot agrees with that
recorded roster, not that the roster itself was complete at the time. Pinning is
still necessary: reading `/actions/workflows` at re-collection time would return
the *current* roster, so any workflow enabled, disabled, renamed, or deleted
since the window would produce a spurious diff while every run was still
retained. The roster's own provenance is the single `/actions/workflows` query
run during collection, recorded here rather than re-derivable. The assertions in the derivation above
are a weaker, offline complement — they catch a duplicated or deleted row and a
changed total, but cannot by themselves prove nothing was missed at collection
time, because a uniformly incomplete file is internally consistent.

Re-collection is only exact while GitHub retains these runs. Actions run and
log retention is finite; once runs age out, the committed snapshot becomes the
sole record, which is the other reason it is committed rather than re-derived.

`scripts/development-workflow/actions-cost-audit.sh` is **not** the source of
this table and cannot be. It has no `--until`, so its totals grow every time it
runs, and at `--limit 500` this repository returns exactly 500 runs — a silently
truncated result whose derived totals are all wrong. It remains useful for a
rough current-state view:

<!-- workflow-shell-contract: bash-zsh -->
```bash
set -euo pipefail
./scripts/development-workflow/actions-cost-audit.sh \
  --limit 3000 --since 2026-09-17T00:00:00Z --format markdown
```

Per-PR figures. Use the pull request object for commits, files and line
counts — not `gh pr view` (caps at 100) and not `compare` (different merge
base):

<!-- workflow-shell-contract: bash-zsh -->
```bash
set -euo pipefail
repo=lhpaul/ronda
for n in 93 94 95 96 97 98 99 100; do
  gh api "repos/${repo}/pulls/${n}" --jq \
    '[.number, .commits, .changed_files, .additions, .deletions,
      .created_at, .merged_at] | @tsv'
  head_ref="$(gh api "repos/${repo}/pulls/${n}" --jq '.head.ref')"
  gh api "repos/${repo}/actions/runs?branch=${head_ref}&per_page=100" --paginate \
    --jq '.workflow_runs[] | [.name, .run_started_at, .updated_at] | @tsv'
done
```

Actions runs per PR are additionally filtered to that PR's own
`[created_at, merged_at]` window before summing.
