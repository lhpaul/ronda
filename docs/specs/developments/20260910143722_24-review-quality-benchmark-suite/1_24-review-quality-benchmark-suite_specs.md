# Improve Ronda Review Quality Benchmark Suite - Spec

---

## Overview

Ronda needs an operator-visible way to judge review quality beyond a single
manual smoke test or a subjective sense that comments look reasonable. This
feature expands the quality evidence suite so operators can measure Ronda
against known seeded defects, quiet precision cases, real pull request review
comparisons, and the most important failure mode: Ronda saying a head is clean
when another reviewer or a human still finds a real issue.

The feature keeps Ronda's existing review contract unchanged. Ronda remains a
comment-only GitHub reviewer; the new product surface is the evidence operators
use to decide whether a model, prompt, or release is good enough to trust.

---

## Use Cases

### Use Case 1: Operator Measures Ronda Against Seeded Defects

**Actor**: Ronda operator

**Preconditions**:

- Ronda has a documented quality benchmark containing known seeded defects.
- The operator has a configured model credential for a real model review run.
- The operator can run Ronda against the benchmark target.

**Steps**:

1. The operator starts a benchmark run for a specific Ronda version or working
   branch.
2. Ronda reviews the benchmark target through the same review behavior used for
   ordinary pull requests.
3. The operator reads the benchmark evidence and compares found findings,
   missed findings, and false positives.

**Postconditions**:

- The operator can tell which seeded defects Ronda found.
- The operator can tell which seeded defects Ronda missed.
- The operator can tell whether Ronda produced extra findings that were not
  expected.
- The result can be compared with a later model, prompt, or release.

**Information shown**:

- Total seeded defects.
- Found seeded defects.
- Missed seeded defects.
- False-positive count.
- Defect categories.
- Model identity.
- Reviewed target.
- Run timestamp.

**Actions available**:

- Re-run the benchmark on the same target.
- Compare two benchmark results.
- Use the result as release or tuning evidence.

**Considerations**:

- Real quality evidence requires a real model run. A stubbed response may prove
  mechanics, but it does not prove review quality.
- Seeded fixtures should include security, authorization, data-loss, async or
  race, configuration, stale-SHA, sorting, text-normalization, and multi-finding
  cases.

---

### Use Case 2: Operator Confirms Ronda Stays Quiet On Clean Changes

**Actor**: Ronda operator

**Preconditions**:

- Ronda has at least one documented precision fixture where no review finding
  should be published.
- The operator can run Ronda against that fixture with the configured model.

**Steps**:

1. The operator starts a precision benchmark run.
2. Ronda reviews a change that should be acceptable.
3. The operator checks whether any findings were produced.

**Postconditions**:

- A clean precision fixture is reported as clean.
- Any unexpected finding is visible as quality evidence and can be reviewed.

**Information shown**:

- Clean fixture identity.
- Ronda result.
- Unexpected finding count, when present.
- Model identity and timestamp.

**Actions available**:

- Mark the result as clean agreement.
- Mark any unexpected finding as noise after human review.

**Considerations**:

- Precision evidence is required because a noisy reviewer loses trust even when
  it catches real defects.
- Noise classification remains a human judgment when the finding is debatable.

---

### Use Case 3: Operator Compares Ronda With Another Reviewer On A Real Pull Request

**Actor**: Ronda operator

**Preconditions**:

- A real pull request has been reviewed by Ronda.
- Another reviewer platform is available for the same repository and head.
- The operator can inspect both reviewer outputs.

**Steps**:

1. Ronda reviews the pull request head.
2. The other reviewer reviews the same pull request head.
3. The operator records where the reviewers agree and disagree.
4. The operator classifies disagreements as Ronda missed finding, Ronda better
   signal, duplicate finding, or unclear.

**Postconditions**:

- The comparison identifies findings only Ronda produced.
- The comparison identifies findings only the other reviewer produced.
- Disagreements are preserved for later prompt, model, or fixture improvements.

**Information shown**:

- Repository, pull request, and head identity.
- Ronda result and finding count.
- Other reviewer result and finding count.
- Agreement count.
- Disagreement classification.

**Actions available**:

- Accept an agreement as supporting evidence.
- Promote a real missed finding into a future benchmark case.
- Mark the other reviewer output as noisy when it is not actionable.

**Considerations**:

- The other reviewer is a second opinion, not the source of truth.
- Human adjudication decides whether a mismatch is a Ronda miss, a noisy
  external finding, a duplicate, or unclear.

---

### Use Case 4: Operator Runs A Second-Opinion Gate After Ronda Says Clean

**Actor**: Ronda operator or consuming workflow owner

**Preconditions**:

- Ronda has reviewed a pull request head and reported no findings.
- The repository has another reviewer platform that can be triggered on demand
  or observed after Ronda's result.

**Steps**:

1. Ronda completes a review pass and reports the head as clean.
2. The operator or workflow triggers the other reviewer platform for the same
   head.
3. The operator records whether the other reviewer finds a meaningful issue.
4. The operator classifies any meaningful external-only issue as a candidate
   Ronda false clean.

**Postconditions**:

- Clean agreement between Ronda and the other reviewer is recorded.
- Any external-only actionable finding after a Ronda-clean result is visible as
  a false-clean candidate.
- Ronda quality discussions can focus on the rate and severity of false-clean
  candidates.

**Information shown**:

- Ronda clean result.
- Other reviewer result.
- Whether the other reviewer was triggered after Ronda clean.
- False-clean candidate count.
- Human adjudication outcome.

**Actions available**:

- Treat clean agreement as confidence evidence.
- Convert a confirmed false clean into a benchmark seed.
- Leave an unclear mismatch open for later review.

**Considerations**:

- The second-opinion reviewer should run only after Ronda is clean for this
  gate, so expensive external review is reserved for the most important quality
  question.
- The gate measures review quality; it does not authorize Ronda to merge or
  mutate pull requests.

---

## Business Rules

- Ronda remains comment-only and never pushes fixes, changes branches, changes
  pull request state, or merges.
- Review quality evidence must include both recall and precision signals.
- A seeded benchmark result must identify the reviewed target, model identity,
  timestamp, found seeded defects, missed seeded defects, and false positives.
- Seeded fixtures must include representative security, authorization,
  data-loss, async or race, configuration, stale-SHA, sorting,
  text-normalization, and multi-finding cases.
- At least one precision fixture must represent a change where Ronda should
  publish no findings.
- A second reviewer is treated as a comparison signal, not absolute truth.
- External-only findings require human adjudication before they count as Ronda
  misses.
- The second-opinion gate may trigger another reviewer directly or record an
  operator-triggered reviewer run, but the evidence must show that the reviewed
  repository, pull request, and head match Ronda's clean result.
- The second-opinion gate runs only after Ronda reports clean for the same head.
- The primary quality metric is the false-clean rate: how often Ronda reports a
  head as clean when a human-adjudicated second opinion identifies a real issue.
- Confirmed Ronda misses should be candidates for future benchmark fixtures.
- Quality evidence must avoid storing or displaying secret values, credentials,
  tokens, authorization values, or other sensitive seeded material.
- Ronda's GitHub review output contract and check-run behavior remain unchanged
  by this feature.
- Issue #25, the local webhook service, is orthogonal to this feature. Local
  execution may later make quality runs cheaper, but #24 does not depend on it.

---

## Statuses / Enum Values

| Code value        | Display label       | Description |
| ----------------- | ------------------- | ----------- |
| `ronda_miss`      | Ronda miss          | Another reviewer or human found a real issue that Ronda missed. |
| `ronda_better`    | Ronda better signal | Ronda avoided a finding that human adjudication considers noisy or irrelevant. |
| `duplicate`       | Duplicate finding   | Ronda and the other reviewer found the same underlying issue with different wording or placement. |
| `clean_agreement` | Clean agreement     | Ronda and the second-opinion reviewer both found no actionable issue. |
| `unclear`         | Unclear             | The mismatch needs more human review before it can be used as quality evidence. |

**Valid transitions**:

- Unclassified comparison -> Ronda miss when human adjudication confirms an
  external-only actionable issue.
- Unclassified comparison -> Ronda better signal when human adjudication
  rejects an external-only finding as noise.
- Unclassified comparison -> Duplicate finding when both reviewers identified
  the same underlying issue.
- Unclassified comparison -> Clean agreement when both reviewers report clean.
- Any unclassified or disputed comparison -> Unclear when the evidence is not
  enough to decide.

---

## Operational Visibility

- **Benchmark evidence**: records seeded-defect recall, missed categories,
  false positives, model identity, reviewed target, timestamp, and same-head
  variance evidence when repeated runs are performed.
- **Comparison evidence**: records Ronda-only findings, second-reviewer-only
  findings, duplicate findings, adjudication outcome, and false-clean
  candidates.
- **Logs**: may include non-sensitive categories, counts, reviewed targets, and
  model identity. Logs must not include seeded or real credential values.
- **Notifications**: none beyond existing GitHub review/check-run surfaces and
  any existing reviewer-platform notification behavior.
- **Audit trail**: benchmark outputs, comparison artifacts, PR evidence, and
  human adjudication notes are the audit surfaces for quality decisions.

---

## Acceptance Criteria

- [ ] A documented seeded benchmark covers security, authorization, data-loss,
      async or race, configuration, stale-SHA, sorting, text-normalization, and
      multi-finding review scenarios.
- [ ] Running the benchmark reports total seeded defects, found seeded defects,
      missed seeded defects, false positives, model identity, reviewed target,
      and run timestamp.
- [ ] At least one precision fixture expects a clean Ronda result, and any
      unexpected finding is reported as a false-positive candidate.
- [ ] Benchmark or comparison evidence redacts sensitive seeded values and does
      not store credentials, tokens, authorization values, or equivalent
      secrets.
- [ ] The evidence workflow records same-head variance when the same target is
      reviewed more than once with the same model and configuration.
- [ ] Operators can record a second-reviewer comparison for the same repository,
      pull request, and head that Ronda reviewed.
- [ ] Operators can classify mismatches as Ronda miss, Ronda better signal,
      duplicate finding, clean agreement, or unclear.
- [ ] When Ronda reports a head as clean, operators can trigger or record a
      second-opinion reviewer run for the same head and capture whether it found
      an actionable issue, producing a false-clean candidate.
- [ ] Confirmed Ronda misses can be traced back to the source comparison so they
      can become future seeded benchmark cases.
- [ ] Existing Ronda GitHub review output, check-run behavior, draft skip
      behavior, manual review trigger behavior, and no-branch-mutation contract
      remain unchanged.

---

## Brief Objective List

- Broaden the existing small recall benchmark into repeatable review-quality
  evidence.
- Cover additional seeded defect categories.
- Add precision/noise fixture coverage.
- Capture recall, missed categories, false positives, model identity, target,
  timestamp, and same-head variance.
- Support comparison with another reviewer platform after Ronda reports clean.
- Preserve Ronda's existing GitHub review output contract.

---

## Coverage Matrix

| Brief objective | Acceptance criteria | Notes |
| --- | --- | --- |
| Broaden the existing small recall benchmark into repeatable review-quality evidence. | AC1, AC2, AC5, AC9 | Evidence spans seeded benchmarks, repeated runs, and traceable misses. |
| Cover additional seeded defect categories. | AC1 | Categories include the requested security, authorization, data-loss, async/race, config, and stale-SHA cases plus existing review-risk categories. |
| Add precision/noise fixture coverage. | AC3, AC7 | Precision is measured directly and mismatch classifications separate noise from misses. |
| Capture recall, missed categories, false positives, model identity, target, timestamp, and same-head variance. | AC2, AC5 | These are required evidence fields for each benchmark run. |
| Support comparison with another reviewer platform after Ronda reports clean. | AC6, AC7, AC8 | The second-opinion gate can trigger or record same-head reviewer evidence and produces false-clean candidates. |
| Preserve Ronda's existing GitHub review output contract. | AC10 | The feature measures quality without changing Ronda's review/check-run contract. |

---

## Out of Scope (MVP)

- Automatically deciding that another reviewer is correct without human
  adjudication.
- Replacing Ronda's existing GitHub review or check-run contract.
- Triggering merges or changing pull request state based on quality evidence.
- Building the local webhook service from issue #25.
- Requiring every consumer repository to use the same second-opinion reviewer
  platform.
