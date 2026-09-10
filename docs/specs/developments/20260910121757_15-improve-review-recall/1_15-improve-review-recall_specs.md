# Improve Review Recall — Spec

---

## Overview

Ronda should remain a trustworthy comment-only reviewer, but it must catch more
real defects before teams can rely on it as an external review provider. This
feature defines the product bar for review quality: a repeatable benchmark,
higher recall on known seeded defects, explicit protection for secret and
credential exposure, and lower run-to-run variance on the same pull request
head.

The goal is not to make Ronda noisy. A review pass is still successful only
when its findings are actionable and credible enough for a human or ADF
reviewer-loop to use without treating the bot as background chatter.

---

## Use Cases

### Use Case 1: An operator measures Ronda against a seeded benchmark

**Actor**: Ronda operator

**Preconditions**:

- The operator has access to a benchmark pull request or fixture set containing
  a documented list of seeded defects.
- Ronda can run a normal review pass against that benchmark using the configured
  model.

**Steps**:

1. The operator starts the benchmark review run.
2. Ronda reviews the benchmark changes using the same review contract it uses
   for ordinary pull requests.
3. The operator compares the published findings with the documented seeded
   defects.

**Postconditions**:

- The benchmark result shows how many seeded defects were found.
- The result separates missed seeded defects from false positives.
- The result is reproducible enough to compare one Ronda version with another.

**Information shown**:

- Total seeded defects, found seeded defects, missed seeded defects, and false
  positives.
- Finding categories, including security-sensitive findings.
- The model used, the reviewed head or fixture identity, and the run timestamp.

**Actions available**:

- Re-run the benchmark on the same Ronda version.
- Compare two benchmark results.
- Use the result as release evidence for a recall-tuning change.

**Considerations**:

- A model stub may be used to test prompt shape and output parsing, but it does
  not prove recall.
- Real recall evidence requires a real model review against known seeded
  defects.

---

### Use Case 2: A pull request contains multiple defects in the same file or region

**Actor**: Pull request author or ADF reviewer-loop

**Preconditions**:

- A ready pull request has more than one real defect in changed lines.
- At least two defects are close together in the same file or hunk.

**Steps**:

1. Ronda runs a review pass for the pull request head.
2. Ronda identifies each independently actionable defect.
3. Ronda publishes all findings in the pass's single GitHub review.

**Postconditions**:

- Ronda does not stop at the first finding in a file, hunk, or line region.
- Distinct defects are reported separately when each one needs its own author
  action.

**Information shown**:

- One finding per independently actionable defect.
- Severity and explanation for each defect.

**Actions available**:

- The author can fix each finding independently.
- The consuming workflow can decide whether any finding blocks the merge.

**Considerations**:

- Duplicate comments for the same underlying defect are still not acceptable.
- A closely related cause and consequence may remain one finding when one fix
  resolves both.

---

### Use Case 3: A pull request exposes a credential or secret

**Actor**: Pull request author, reviewer, or ADF reviewer-loop

**Preconditions**:

- A ready pull request changes code or configuration in a way that exposes a
  credential, token, secret, authorization value, or equivalent sensitive
  access material.

**Steps**:

1. Ronda runs a review pass for the pull request head.
2. Ronda detects the exposed sensitive material risk.
3. Ronda publishes a Blocking finding that explains the exposure and the needed
   correction without repeating the sensitive value.

**Postconditions**:

- The published review includes a Blocking finding for the sensitive exposure.
- The review body does not copy the sensitive value.
- The pull request branch is unchanged.

**Information shown**:

- The affected file and changed line when the finding maps to a changed line.
- A short explanation of why the exposure is unsafe.
- A remediation direction that avoids storing or logging the sensitive value.

**Actions available**:

- The author can remove the exposure and push a new commit.
- The consuming workflow can treat the finding as merge-blocking.

**Considerations**:

- This category is a must-find benchmark category for this feature.
- The finding may be reported without inline placement only when GitHub cannot
  attach it to a changed line.

---

### Use Case 4: An operator re-runs Ronda on the same head

**Actor**: Ronda operator

**Preconditions**:

- A pull request head has already been reviewed by Ronda.
- The operator asks for another pass on the unchanged head.

**Steps**:

1. Ronda runs another review pass on the same head with the same model and
   review configuration.
2. Ronda publishes the new review using the existing v0 review contract.
3. The operator compares the new findings with the prior findings.

**Postconditions**:

- The two passes are similar enough that re-running a review does not materially
  change the merge decision for the same head.
- Any remaining variance is visible in the benchmark or smoke evidence.

**Information shown**:

- Findings by severity for each pass.
- The reviewed head and model identity for each pass.

**Actions available**:

- The operator can accept the result as repeatable enough for the configured
  quality bar.
- The operator can reject the change if variance remains too high.

**Considerations**:

- Exact wording may vary between passes.
- The product bar is about stable defect coverage and stable merge-relevant
  severity, not byte-identical prose.

---

## Business Rules

- Ronda remains comment-only: it never pushes fixes, changes pull request state,
  or merges.
- The review quality target is measured against a documented seeded-defect
  benchmark, not by subjective review impressions.
- The minimum acceptance bar for this feature is at least six of eight known
  seeded defects found on the benchmark that exposed the v0 recall gap.
- The benchmark must include the four previously missed defect classes:
  sensitive-value exposure, off-by-one cache capacity, lexicographic numeric
  sorting, and empty-word title casing.
- Sensitive-value exposure is a must-find category. Missing that category fails
  the feature even if aggregate recall meets the numeric threshold.
- Precision remains part of the product contract. The benchmark must report
  false positives, and a result with known false positives needs explicit human
  review before it can be treated as ready.
- Ronda must report multiple independently actionable defects in the same file
  or nearby region when they require separate fixes.
- Re-running the same model and configuration on the same head should not
  materially change the merge-relevant outcome.
- The configured model may change only through operator configuration. The
  GitHub review shape, check-run contract, and consuming-workflow contract stay
  unchanged.
- Model stubs can validate prompt formatting and parser behavior, but they do
  not count as recall evidence.

---

## Operational Visibility

- **Benchmark result**: records seeded defect count, found count, missed count,
  false-positive count, model identity, reviewed target, and timestamp.
- **Review summary**: continues to show the normal Ronda finding counts and
  model identity.
- **Logs**: may record benchmark counts and non-sensitive defect category names.
  Logs must not include credential, token, secret, or authorization values.
- **Notifications**: none beyond GitHub's existing review and check-run
  surfaces.
- **Audit trail**: the spec, implementation plan, benchmark evidence, GitHub
  review, and check run are the audit surfaces for this quality change.

---

## Acceptance Criteria

- [ ] Running the documented recall benchmark reports total seeded defects,
      found seeded defects, missed seeded defects, false positives, model
      identity, reviewed target, and run timestamp.
- [ ] The benchmark includes all eight seeded defects from issue #15's
      measurement table.
- [ ] Ronda finds at least six of the eight seeded defects in the benchmark.
- [ ] Ronda finds the sensitive-value exposure seeded defect and reports it as
      Blocking without repeating the sensitive value in the finding body.
- [ ] Ronda reports the lexicographic numeric-sort defect and the even-length
      median defect as distinct actionable findings when both are present in the
      same changed file.
- [ ] Ronda reports the off-by-one cache-capacity defect when the changed code
      admits one more cached entry than the configured maximum.
- [ ] Ronda reports the empty-word title-casing defect when a changed string
      operation can throw on empty input.
- [ ] The benchmark output records zero known false positives, or the PR
      includes explicit human approval accepting the precision tradeoff.
- [ ] Two review passes on the same benchmark head with the same model and
      configuration produce the same set of merge-relevant seeded-defect
      categories.
- [ ] A normal pull-request review still publishes findings through one GitHub
      pull-request review plus the existing Ronda check run, with no branch
      mutation.
- [ ] A model-stub-only test cannot be used as the sole evidence for the recall
      acceptance criteria.
- [ ] The feature's implementation evidence names the benchmark run, model, and
      reviewed target used to prove the recall result.

---

## Out of Scope (MVP)

- Replacing the ADF reviewer-loop, Helm workflow, or `local-ai-reviewer`.
- Carrying findings between passes, deduplicating against earlier reviews, or
  tracking unresolved review history across commits.
- Guaranteeing byte-identical finding wording across repeated model calls.
- Hosting or selecting a local model backend.
- Registering a GitHub App or changing the webhook/tunnel architecture.
- Automatically fixing review findings or suggesting commits through GitHub's
  suggested-change UI.
- Expanding the benchmark beyond the seeded defect classes needed to prove this
  recall improvement.

---

## Coverage Matrix

Objectives are derived from the tracker brief for issue #15.

| # | Brief objective | Covered by |
| - | --------------- | ---------- |
| 1 | Decide the target behaviour for recall without giving up credible precision | Overview; Business Rules on benchmark target and precision; ACs 1, 3, 8, 12 |
| 2 | Address the observed 4-of-8 recall gap from the v0 smoke test | Use Case 1; Business Rules on the eight-defect benchmark; ACs 1, 2, 3 |
| 3 | Avoid stopping at one finding per line, hunk, or nearby region | Use Case 2; Business Rule on multiple independently actionable defects; AC 5 |
| 4 | Treat credential and secret exposure as non-negotiable | Use Case 3; Business Rules on sensitive-value exposure; AC 4 |
| 5 | Reduce run-to-run variance on the same head SHA and model | Use Case 4; Business Rule on stable merge-relevant outcome; AC 9 |
| 6 | Preserve Ronda's existing comment-only GitHub review contract | Business Rules; AC 10; Out of Scope entries on fixing, webhook/App changes, and reviewer-loop replacement |
| 7 | Keep model choice swappable and evidence-based | Business Rule on model configuration; ACs 11, 12; Out of Scope entry on local model hosting |
| 8 | Rebuild the smoke-test fixtures into a fixed benchmark before tuning | Use Case 1; Operational Visibility; ACs 1, 2, 12 |

### Deferral Notes

- **Carrying findings between passes or deduplicating against earlier reviews.**
  The issue brief explicitly keeps this out of scope for the recall improvement.
  Ronda continues to review each pass fresh.
- **Replacing ADF or `local-ai-reviewer`.** The constitution keeps Ronda as the
  GitHub-facing review provider only. The consuming workflow still decides how
  to react to findings.
- **Local model hosting.** The brief asks whether the current API model is the
  right choice, but the MVP only requires evidence that model choice can be
  evaluated. Hosting or serving a local model remains a later capability.
- **Exact deterministic prose.** The run-to-run variance target is scoped to
  stable defect categories and merge-relevant severity, because exact natural
  language wording is not a product requirement.

---

## Assumptions

- The eight-defect benchmark from issue #15 is the initial recall bar because it
  is the evidence that created this feature.
- Six of eight found defects is the minimum improvement worth shipping for this
  iteration; later work can raise the bar once there is benchmark history.
- A result with any accepted false positive is not automatically disqualified,
  but it requires explicit human approval because the issue brief names
  credibility as a core value.
