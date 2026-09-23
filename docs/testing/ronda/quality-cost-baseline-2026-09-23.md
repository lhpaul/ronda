# Ronda Quality and Cost Baseline: 2026-09-23

Evidence baseline for [#101](https://github.com/lhpaul/ronda/issues/101), which
scopes the rest of the review-quality track under epic
[#52](https://github.com/lhpaul/ronda/issues/52). Evidence only — this baseline
changes no product behaviour, no prompt, and no architecture decision.

Window: pull requests #93–#100, merged 2026-09-17 → 2026-09-23.

Companion documents:

- [`quality-report-2026-09-23.md`](quality-report-2026-09-23.md) — Deliverable 2
- [`cost-convergence-baseline-2026-09-23.md`](cost-convergence-baseline-2026-09-23.md) — Deliverable 3
- [`pr-98-external-finding-corpus-2026-09-23.md`](pr-98-external-finding-corpus-2026-09-23.md) — evidence behind Deliverable 4
- [`review-quality-baseline-2026-09-10.md`](review-quality-baseline-2026-09-10.md) — the synthetic baseline this one is compared against

---

## Headline

**Ronda has never reviewed a pull request in this repository.** Zero of #93–#100
carry a Ronda review, so the external-review miss backfill that #101 asks for
cannot be produced at all — not partially, not with some records stale, but not
at all. The premise that "real adjudicated evidence can be produced from
already-merged tooling" is false as of this date: the capture tooling shipped in
[#53](https://github.com/lhpaul/ronda/issues/53) works, but it has nothing to
compare against.

The rest of the baseline is complete. The category ranking below is derived from
a real PR's finding corpus rather than from Ronda misses, and is explicit about
being a substitute.

---

## Deliverable 1 — Real miss evidence: **not achievable**

### What was attempted

`npm run quality:misses -- capture` was run against every PR in the window:

```text
PR  93: OUTCOME=capture_refused  REASON=Capture refused: there is no Ronda result to compare against on this pull request.
PR  94: OUTCOME=capture_refused  REASON=Capture refused: there is no Ronda result to compare against on this pull request.
PR  95: OUTCOME=capture_refused  REASON=Capture refused: there is no Ronda result to compare against on this pull request.
PR  96: OUTCOME=capture_refused  REASON=Capture refused: there is no Ronda result to compare against on this pull request.
PR  97: OUTCOME=capture_refused  REASON=Capture refused: there is no Ronda result to compare against on this pull request.
PR  98: OUTCOME=capture_refused  REASON=Capture refused: there is no Ronda result to compare against on this pull request.
PR  99: OUTCOME=capture_refused  REASON=Capture refused: there is no Ronda result to compare against on this pull request.
PR 100: OUTCOME=capture_refused  REASON=Capture refused: there is no Ronda result to compare against on this pull request.
```

8 of 8 refused at Stage 1, condition 3. Independently confirmed against the
GitHub API — the number of reviews whose body contains the
`## Ronda review` heading (`RONDA_REVIEW_HEADING`, the marker
`readPullRequestEvidence` keys on) is **0** for every PR in the window:

```bash
for n in 93 94 95 96 97 98 99 100; do
  gh api "repos/lhpaul/ronda/pulls/$n/reviews" --paginate \
    --jq '[.[] | select(.body // "" | contains("## Ronda review"))] | length'
done
```

### Root cause

[`.github/workflows/ronda-review.yml`](../../../.github/workflows/ronda-review.yml)
is declared `on: workflow_call` only. It is a **reusable** workflow intended for
adopting repositories, and no workflow in this repository calls it. There is no
`pull_request` or `issue_comment` trigger wired to it here.

Two supporting facts:

- The workflow's last runs of any kind were 2026-09-10 on `smoke/ronda-v0`, all
  `failure`. It has not run since, on any branch.
- `gh secret list` shows only `GH_PROJECT_TOKEN`. `RONDA_MODEL_API_KEY` — the
  secret the reusable workflow requires as `model_api_key` — is not configured
  on this repository, so the workflow could not complete a pass even if it were
  called.

The six existing records in `docs/testing/ronda/comparisons/` were produced on
2026-09-10 by **manual local runs** of `npm run review` plus
`npm run quality:comparison`, not by an automated GitHub pass. That is the only
pathway that has ever produced a Ronda result against a real PR.

### Why it was not worked around

Two workarounds were considered and rejected:

1. **Run Ronda locally against the merged PRs now.** `npm run review` publishes
   a GitHub review as part of the pass; there is no read-only mode. Doing this
   would post bot reviews onto eight already-merged pull requests. #101
   explicitly requires capture to be "read-only against GitHub (no PR mutation)
   per #53's contract", so this is out of scope for this item and was not done.
2. **Record comparisons by hand instead.** `npm run quality:comparison` needs a
   Ronda result for the same head, so it hits the identical blocker.

### Records committed

None. `docs/testing/ronda/misses/` still contains only `.gitkeep`. Writing a
record without a Ronda result would fabricate the evidence the item exists to
collect.

### What unblocks it

Ronda must review real pull requests before any miss evidence can exist. The
smallest version is a caller workflow in this repository that invokes
`ronda-review.yml` on `pull_request`, plus a `RONDA_MODEL_API_KEY` repository
secret. That is a product/infrastructure change and therefore out of scope for
this evidence-only item; it is filed as the prerequisite for the rest of the
track.

---

## Deliverable 2 — Quality report: **committed, near-empty**

Full output and reading in
[`quality-report-2026-09-23.md`](quality-report-2026-09-23.md).

| Outcome | Count |
| --- | ---: |
| `true_positive` | 0 |
| `false_positive` | 0 |
| `false_clean` | 0 |
| `stale_head` | 0 |
| `unadjudicated` | 1 |
| `clean_agreement` | 5 |
| `unresolvable_evidence` | 0 |
| Comparison records in scope | 6 |
| Miss records in scope | 0 |

The one unadjudicated record is on `lhpaul/ai-dev-framework-template#1729`,
where Ronda reported clean and PR-Agent reported three findings in
`resolve-reviewer-availability.sh`. Two of those three are `timeouts` /
`concurrency` shaped. It remains the only recorded case anywhere of Ronda being
clean where another reviewer was not, and it has never been adjudicated.

---

## Deliverable 3 — Cost and convergence: **committed**

Full tables in
[`cost-convergence-baseline-2026-09-23.md`](cost-convergence-baseline-2026-09-23.md).

| Measure | #93–#96 | #97 | #98 |
| --- | ---: | ---: | ---: |
| Commits | 10 | 25 | 33 |
| Wall clock | 0.52 h | 70.12 h | 21.13 h |
| Actions runs | 48 | 179 | 193 |
| Actions wall time | 32.9 m | 316.4 m | 186.8 m |
| Reviewer-loop iterations (recorded) | 9 | 3 (final run only) | 26 |
| Escalations | 6 | 3 | 10 |

Repository-wide, 580.3 m of Actions wall time over the six-day window across 500
runs. `Ronda review` accounts for 0 m of it.

Headline cost findings:

1. `Ronda review` never runs (Deliverable 1).
2. PR-Agent ran 80 times for 46.3 m and published **no review at all** — its log
   shows `DEEPSEEK_API_KEY:` empty and `OPENAI_KEY not set`.
3. Codex GitHub was rate-limited on #93–#96 and never triggered on #97. Real
   external-reviewer coverage in this window is **1 of 6** reviewable PRs.
4. ShellCheck plus the workflow test harnesses are 449.6 m of the 580.3 m (77%).
5. PR #98's convergence cost is dominated by re-finding one defect 14 times.

### Measurement gap

PR #97's committed reviewer-loop history records only its final clean invocation
(3 iterations, 0 blocking findings), even though the PR took 25 commits over 70
hours with three escalations. The history comment is rewritten in place per loop
invocation, so earlier invocations are not recoverable. **#97's true convergence
cost cannot be reconstructed from committed evidence.** Any future comparison
should treat #98 as the only fully-instrumented expensive PR in this window.

---

## Deliverable 4 — Ranked category list from real PRs

### Provenance and its limits

This ranking is **not** derived from Ronda misses, because none exist. It is
derived from the 79 findings two independent reviewers raised on PR #98 — 74
from `local-ai-reviewer` across 26 loop iterations, 5 from `codex-github` across
2 passes. Details and the full row-by-row mapping are in
[`pr-98-external-finding-corpus-2026-09-23.md`](pr-98-external-finding-corpus-2026-09-23.md).

Three limits, stated up front:

- **n = 1 pull request.** #98 is a TypeScript PR about security guards and
  evidence records. Its category mix is partly a property of what it changed.
- **These are not Ronda's misses.** They are defects reviewers found. Whether
  Ronda would have found them is untested. The ranking says what real PRs in
  this repository contain, not what Ronda is blind to.
- **Category assignment is manual.** The closed `AFFECTED_CATEGORIES` set was
  applied by hand from finding text; every row is listed so it can be disputed.

### Ranked list

| Rank | Category | Findings | Share | Evidence strength |
| ---: | --- | ---: | ---: | --- |
| 1 | `correctness` | 44 | 55.7% | Strong, but too coarse to act on — see sub-themes |
| 2 | `security` | 15 | 19.0% | Strong, and the only category both reviewers hit independently |
| 3 | `other` | 11 | 13.9% | Mostly process evidence, not product defects |
| 4 | `idempotency` | 6 | 7.6% | Moderate; all record-identity collisions |
| 5 | `partial_success` | 3 | 3.8% | Weak, but both reviewers hit it |
| — | `durability` | 0 | 0% | No signal in this window |
| — | `retries` | 0 | 0% | No signal in this window |
| — | `timeouts` | 0 | 0% | No signal here; 1 external hit on template #1729 |
| — | `concurrency` | 0 | 0% | No signal here; 1 external hit on template #1729 |
| — | `configuration` | 0 | 0% | No signal in this window |
| — | `observability` | 0 | 0% | No signal in this window |

`correctness` at 56% is not a usable target for a prompt sweep. The actionable
ranking is by sub-theme:

| Rank | Sub-theme | Findings | Closed category |
| ---: | --- | ---: | --- |
| 1 | `pr-head-push-order` | 14 | `correctness` |
| 2 | `planted-proof-evidence` | 10 | `other` |
| 3 | `credential-pattern-gap` | 9 | `security` |
| 4 | `external-output-parsing` | 8 | `correctness` |
| 5 | `record-identity` | 7 | `idempotency` / `correctness` |
| 5 | `spec-ac-compliance` | 7 | `correctness` |
| 7 | `guard-fails-open` | 5 | `security` |
| 8 | `excerpt-sequence-boundaries` | 4 | `correctness` |
| 8 | `per-finding-resolution` | 4 | `partial_success` / `correctness` |
| 10 | `placeholder-exemption` | 3 | `correctness` |
| 10 | `refusal-precedence` | 3 | `correctness` |
| 12 | `input-validation` | 2 | `correctness` |
| 13 | `github-api-pagination` | 1 | `correctness` |
| 13 | `operator-usability` | 1 | `other` |
| 13 | `path-traversal` | 1 | `security` |

(Counts combine both reviewers, so they differ from the reviewer-split table in
the corpus document: `credential-pattern-gap` is 6 local + 3 Codex,
`guard-fails-open` 4 local + 1 Codex, `per-finding-resolution` 3 local + 1
Codex. Total 79.)

### Reading

1. **Security-guard completeness is the highest-confidence target.** It is the
   only theme two independent reviewers found independently:
   `credential-pattern-gap` (9) and `guard-fails-open` (5) together are 14 of
   79 findings, and 4 of Codex's 5. The failure shape is consistent — a
   regex or guard that covers the canonical form and misses a qualified,
   camelCase, hyphenated, or wrapped variant, or that fails open when its input
   cannot be loaded.

2. **State-reconstruction-from-API-evidence is the most expensive theme.**
   `pr-head-push-order` was re-found 14 times across 22 iterations and only
   ended by human waiver. It is a single defect the loop could not converge on.
   A reviewer that reasons about what an API response actually proves — versus
   what it is being assumed to prove — would have collapsed 14 iterations into
   one.

3. **Identity and dedup logic is a real, distinct cluster.** 7 findings on
   alias normalisation, SHA spelling, truncated-text hashing, and source-ID
   namespacing. It maps to `idempotency` in the closed set.

4. **`planted-proof-evidence` at 10 findings is a workflow-gate artefact, not a
   product defect class.** It should be excluded when scoping a Ronda prompt
   change, which brings the actionable corpus to 69.

---

## Comparison with the synthetic baseline

[`review-quality-baseline-2026-09-10.md`](review-quality-baseline-2026-09-10.md)
reports 6–8/13 recall on a 13-defect fixture with four categories at 0/5 in
every run. Mapping those four dead categories against this window:

| Synthetic dead category | Closed category | Real-PR findings in this window | Verdict |
| --- | --- | ---: | --- |
| `authorization-bypass` | `security` | 0 direct; 15 `security` findings, none authorization | **Unconfirmed** |
| `data-loss-overwrite` | `correctness` / `idempotency` | 0 direct; 7 `record-identity` collisions are adjacent | **Partially adjacent** |
| `configuration-debug-default` | `configuration` | 0 | **Unconfirmed** |
| `invalid-range-parsing` | `correctness` | 2 `input-validation` findings | **Weakly adjacent** |

And in the other direction — themes real PRs produced that the fixture does not
seed at all:

| Real-PR theme | Findings | Seeded in fixture? |
| --- | ---: | --- |
| `pr-head-push-order` (state reconstruction from API evidence) | 14 | No |
| `credential-pattern-gap` (guard covers canonical form, misses variants) | 9 | Partially — `sensitive-value-exposure`, found 5/5 |
| `external-output-parsing` | 8 | No |
| `guard-fails-open` (security check skipped on load failure) | 5 | No |
| `record-identity` / dedup collisions | 7 | No |

### Conclusion

Where the two disagree, #101 says real evidence wins. It wins here only weakly,
because this comparison is **not apples to apples**: the synthetic numbers
measure *Ronda's recall*, while the real numbers measure *what defects exist*.
A category can be absent from this window because Ronda is good at it, because
no PR contained it, or because no reviewer looked. These data cannot tell those
apart — only Ronda reviews on real PRs can, which is Deliverable 1's blocker.

What the comparison does support:

- **The synthetic fixture's four dead categories are unvalidated.** None is
  confirmed by real-PR evidence. They should not be the sole scope of the
  category-forced sweep.
- **The fixture is missing seeds for the themes real PRs actually produce.**
  `pr-head-push-order`, `guard-fails-open`, `external-output-parsing`, and
  `record-identity` have no fixture representation. `sensitive-value-exposure`
  is seeded and found 5/5, yet `credential-pattern-gap` is the single most
  common real security theme — which suggests the seed is easier than the real
  shape, and is itself a reason to add harder variants.
- **The fixture over-weights single-line algorithmic defects.**
  `lexicographic-numeric-sort`, `lower-element-median`, `cache-capacity-off-by-one`
  are all found 5/5. Nothing in the 79 real findings looks like them.

---

## Recommendations for the rest of the track

1. **Unblock dogfooding first.** A caller workflow plus a `RONDA_MODEL_API_KEY`
   secret. Until Ronda reviews real PRs, no miss evidence can be produced, and
   both the category sweep and the symbol-context work stay specced against a
   fixture. This is the single highest-leverage item in the track.
2. **Re-run this baseline after ~10 dogfooded PRs.** The capture and report
   tooling from #53/#56 works; it is only starved of input.
3. **Scope the category-forced sweep on the sub-theme list, not the closed
   category list.** `correctness` at 56% is not a target;
   `credential-pattern-gap`, `guard-fails-open`, `pr-head-push-order`,
   `external-output-parsing`, and `record-identity` are.
4. **Add fixture seeds for the five unseeded real themes** before treating the
   synthetic baseline as a regression gate again.
5. **Adjudicate the template #1729 record.** It is the only existing
   Ronda-clean / other-reviewer-found case, and it points at `timeouts` and
   `concurrency`, which nothing else in the corpus touches.
6. **Fix or remove PR-Agent.** 80 runs, 46.3 m, zero output. It is also a lost
   second external-reviewer source for exactly this kind of evidence.
7. **Preserve reviewer-loop history across invocations.** #97's cost is
   unrecoverable because the history comment is rewritten in place.

---

## Reproduction

```bash
# Deliverable 1 — capture refusal for every PR in the window
for n in 93 94 95 96 97 98 99 100; do
  npm run quality:misses -- capture --pr "$n" --reviewer codex-github --categories correctness
done

# Deliverable 1 — independent confirmation that no Ronda review exists
for n in 93 94 95 96 97 98 99 100; do
  gh api "repos/lhpaul/ronda/pulls/$n/reviews" --paginate \
    --jq '[.[] | select(.body // "" | contains("## Ronda review"))] | length'
done

# Deliverable 2
npm run quality:report -- --format markdown

# Deliverable 3
./scripts/development-workflow/actions-cost-audit.sh \
  --limit 500 --since 2026-09-17T00:00:00Z --format markdown
```
