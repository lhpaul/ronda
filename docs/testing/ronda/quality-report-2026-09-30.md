# Ronda Review Quality Report: 2026-09-30 (dogfood misses, v0.2.0 baseline)

Deliverable of [#136](https://github.com/lhpaul/ronda/issues/136), under epic
#52. Committed rollup of 172 external-review miss records captured from the
dogfood passes on PRs #107, #115, #117, #118 and #119, produced with
`npm run quality:report`. Previous rollup:
[`quality-report-2026-09-23.md`](quality-report-2026-09-23.md) (zero miss records).

## Read this first

1. **Verdicts are assistant-drafted, not human-adjudicated.** The issue asks
   for a human verdict on every record. The repository owner said they had no
   time for that and delegated the verdicts to an assistant session, then
   accepted the result without a per-record review. Every record's rationale
   ends with that statement. Do not cite these as per-record human
   adjudication. The `true_positive` counts below are an assistant's reading of
   the evidence, and the owner's acceptance is of the batch only.
   **Until [#139](https://github.com/lhpaul/ronda/issues/139) lands, read
   every "confirmed" or `true_positive` figure in this report as an
   owner-accepted draft.** The owner accepted the verdicts for this PR only
   (decision on #138), knowing they do not meet the #53 bar for confirmed
   misses as written. #139 adds a verdict-provenance field, backfills these
   records, and makes `quality:report` show accepted drafts separately.
2. **Baseline label: released v0.2.0, no sweep, no repository context.** Every
   pass ran v0.2.0 (`ronda_ref: main` is still v0.2.0, see #135). These records
   measure the released reviewer. They are the baseline #135's passes will be
   compared against, and they are not evidence about #105 (sweep) or #106
   (repository context).
3. **Own-repository, not independent.** All records come from Ronda's own
   repository, reviewing PRs that shaped Ronda itself. The independence caveat
   in [`dogfood-evidence-103.md`](dogfood-evidence-103.md) applies in full.
4. **Precision of the external reviewers is not measured here.** Only
   findings Ronda did not report were captured. `true_positive` means the
   external finding was a real defect Ronda missed, so the rows below are a
   miss count, not a recall percentage: there is no denominator of all
   defects.

## Method

- **Sources.** Codex GitHub inline review comments (91) and `local-ai-reviewer`
  findings (81 captured). No other external reviewer was read.
- **Capture.** `quality:misses -- capture` where the tool could read the
  evidence (#107: 1, #118: 9). `capture-manual` for everything else, because
  the automatic path reads only current-head findings (older heads are out of
  its reach), and on #115 and #119 it refused with "the Codex GitHub reviewer
  has no readable presence on this pull request", so those current-head
  findings went in manually too. Manual records carry `--reviewed-head`, which
  the tool checks against the PR's real heads.
- **`local-ai-reviewer` recovery.** The final reviewer-loop summaries
  rewrite local findings to "clean" or "escalate" and drop the text. The text
  survives in each summary comment's embedded `reviewer_loop_history.v1`
  JSON (`local_blocking_findings`: path, line, message). Every iteration where
  `local-ai-reviewer` raw-reported `needs_fixes` (#115: 38, #117: 20, #118: 9,
  #119: 5, #107: 4) still has its finding text. 110 unique findings were
  recovered.
- **Categories.** Assigned by the capturing assistant, not by the reviewers.
  Codex categories came from reading each finding. `local-ai-reviewer`
  categories came from a keyword heuristic and are weaker. The closed category
  list is code-oriented, so most spec and plan findings fall into
  `correctness`.
- **Verdicts.** Drafted by an assistant from: the author's replies on the 91
  Codex threads (mostly "Fixed in <sha>"; two dispute the finding); whether
  the flagged lines changed in a later commit of the same PR (within 10 lines,
  measured on the reviewed head); and Ronda's own findings on the same PR.
  Spec and plan PRs are counted in scope because Ronda reviews them and posts
  "no findings".
- **Read-only.** Capture made no change to any PR, and no new Ronda review was
  posted on any merged PR.

### Judgement calls

- The local "Trigger ambiguity" record (#107) was first drafted as
  `already_found`, because Ronda raised the same defect on head 6cac87a. The
  record reviews head 42f6e1c, and the #138 reviewer loop pointed out the head
  mismatch, so it was re-adjudicated as `true_positive` on its own head.
- Both #119 `out_of_scope` records need knowledge of sibling PR #118.
- Two #118 `local-ai-reviewer` records were corrected after a Codex comment on
  the evidence PR (#138) and checked against the code. The logs-only-record
  finding was wrong on its recorded head (`sweepMetadata()` logs before
  `onReviewPublished` runs), so it became `false_positive`. The timed-out
  request finding was fixed in the direct child commit 51340557, so its
  rationale now cites that fix.
- 72 of the 81 `local-ai-reviewer` records rest only on "the flagged lines
  changed later". That is weaker evidence than an author reply.

## Command

<!-- workflow-shell-contract: bash-zsh -->
```bash
set -euo pipefail
npm run quality:report -- --format markdown
```

Miss records are in scope, so the run performed read-only GitHub lookups to
refresh Ronda resolvability (#53 AC48). Per-record id lists from the output
are omitted below for length; they are reproducible from the same command.

## Output

### Ronda review quality report

Generated: 2026-09-30T20:02:15.163Z

## Scope
- Comparisons: 6 record(s) from 6 file(s)
- Miss records: 172 record(s) from 172 file(s); 172 in scope after filters

## Primary outcomes
- true_positive: 167
- false_positive: 2
- false_clean: 0
- stale_head: 0
- unadjudicated: 1
  - lhpaul-ai-dev-framework-template-pr-1729-pr-agent-20260910 (lhpaul/ai-dev-framework-template#1729, PR-Agent, uncategorized)

## Clean agreement
- count: 5

## False-clean candidates
- count: 1

## Supplementary
- duplicate: 1
- out_of_scope: 2
- unresolvable_evidence: 0

## Improvement
- Top missed category: correctness (83)
- Top missed category: configuration (23)
- Top missed category: observability (21)
- Top missed category: partial_success (12)
- Top missed category: other (8)
- Seed eval or prompt work for category other (8 confirmed misses)
- Seed eval or prompt work for category correctness (83 confirmed misses)
- Seed eval or prompt work for category observability (21 confirmed misses)
- Seed eval or prompt work for category concurrency (5 confirmed misses)
- Seed eval or prompt work for category partial_success (12 confirmed misses)

## Split by PR kind

The tool's rollup is aggregate only. The split below was computed from the
committed records (`docs/testing/ronda/misses/*.json`).

| Kind | PR | Ronda passes | Ronda findings | Codex `true_positive` | Local `true_positive` | Other verdicts |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Spec | #115 | 76 | 0 | 48 | 36 | none |
| Plan | #117 | 28 | 0 | 17 | 24 | none |
| Code | #118 | 26 | 1 | 15 | 8 | 1 Codex and 1 local `false_positive` |
| Evidence | #119 | 13 | 55 (false positives, #134) | 7 | 4 | 2 local `out_of_scope` |
| Code/workflow | #107 | 16 | 5 | 2 | 6 | 1 Codex `already_found` |

Ronda pass and finding counts are the 2026-09-30 checkpoint figures quoted in
#136, not recomputed here.

| Kind | Confirmed misses (all sources) | Ronda findings on the PR |
| --- | ---: | ---: |
| Spec (#115) | 84 | 0 |
| Plan (#117) | 41 | 0 |
| Code (#118 + #107) | 31 | 6 |
| Evidence (#119) | 11 | 55 (false positives) |

Counts are finding instances, not distinct defects. The same defect can appear
in several records across heads and across the two reviewers.

**What the split supports.** On spec and plan PRs Ronda reported nothing
across 104 passes, while 125 external findings were judged real. On code it
reported 6 findings against 31 confirmed misses. This is consistent with the
working hypothesis that the code-oriented prompt does not review spec and plan
text, and it is the strongest gap in the data. Two limits: the verdicts are
assistant-drafted (see above), and spec/plan PRs here are all about one
feature (#105), so the spec/plan signal is one design discussion, not a
sample. It is evidence for considering a spec/plan review mode, not a
measurement of how much one would gain.

### Affected category by PR kind (`true_positive` only)

| Category | Spec | Plan | Code | Code/workflow | Evidence |
| --- | ---: | ---: | ---: | ---: | ---: |
| correctness | 54 | 11 | 10 | 4 | 4 |
| configuration | 11 | 7 | 3 | 0 | 2 |
| observability | 7 | 8 | 2 | 1 | 3 |
| partial_success | 7 | 4 | 1 | 0 | 0 |
| security | 2 | 6 | 0 | 0 | 0 |
| timeouts | 0 | 3 | 4 | 0 | 0 |
| concurrency | 0 | 1 | 2 | 2 | 0 |
| other | 3 | 1 | 1 | 1 | 2 |

The category list was designed for code defects, so `correctness` absorbs most
spec and plan findings. That is a limit of the list, not a finding.

## Follow-ups recorded

136 `prompt_change` (#115, #117, #119), 28 `eval_record` (#107, #118), 8
`no_action`. These are intended follow-ups only; none was started here.

## Excluded and unresolved evidence

| PR | Stale-head records (left out of verdicts) | `local-ai-reviewer` findings refused by the reviewed-head check |
| --- | ---: | ---: |
| #107 | 0 | 0 |
| #115 | 0 | 24 |
| #117 | 0 | 5 |
| #118 | 0 | 0 |
| #119 | 0 | 0 |

No captured record is stale: Ronda reviewed every head that a record cites.
The 29 refused findings sit on commits that exist on GitHub but were never PR
tips (intermediate commits of multi-commit pushes). The capture tool accepts
only force-push tips and the current head (#53 AC31), so they were not
recorded against another head. Their text remains in the loop history, so
they are unrecorded rather than lost. The recorded `local-ai-reviewer` counts
are therefore a lower bound for #115 and #117.

## Comparison with `sweep-categories.json`

`sweep-categories-v1` (activated 2026-09-27) targets five categories derived
from PR #98 alone (n=1): `pr-head-push-order`, `credential-pattern-gap`,
`external-output-parsing`, `record-identity`, `guard-fails-open`.

The records use the closed `AFFECTED_CATEGORIES` set, which does not share
identifiers with the sweep list, so the comparison used each category's
`matchTerms` against the record title and text (case-insensitive substring).
That is a crude, mechanical proxy, and a miss can be a wording mismatch rather
than a different defect.

- **3 of 167 `true_positive` records match any sweep category** (1 code on
  `credential-pattern-gap`, 1 plan and 1 evidence on `pr-head-push-order`).
  The other 164 match none: spec 84, plan 40, code 22, code/workflow 8,
  evidence 10.
- **`external-output-parsing`, `record-identity` and `guard-fails-open`
  matched zero records.**
- The five sweep categories are all code-shaped failure modes. The bulk of the
  real misses here are spec and plan defects such as undefined metrics,
  aggregation units, admissibility gates and cohort rules. They fall outside
  the sweep's list by construction.

**Reading.** On this baseline, the list the sweep targets would not have
covered the misses that occurred, including on code PR #118. With n=1 behind
the list and a term-match proxy on this side, the comparison cannot show that
the list is wrong. It does show that the list is narrow relative to what the
external reviewers raised.

## Caveats, repeated

- Assistant-drafted verdicts accepted in batch by the owner; not per-record
  human adjudication.
- v0.2.0 baseline only: no sweep, no repository context.
- Own-repository evidence; not independent of the reviewer's development.
- Miss counts have no denominator; no recall figure is claimed.
