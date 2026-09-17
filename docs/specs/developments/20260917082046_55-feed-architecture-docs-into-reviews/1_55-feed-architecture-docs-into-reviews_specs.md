# Feed Architecture and Operating Docs into Ronda Reviews — Spec

---

## Overview

Ronda today reviews a pull request from its title, description, and changed
diff alone. That is enough for many local defects, but it misses findings that
depend on how the repository is supposed to behave: comment-only boundaries,
webhook delivery expectations, check-run contracts, and other locked product
rules that live in authoritative documentation rather than in the diff.

This feature adds **selective, bounded inclusion** of authoritative repository
documentation in a review pass. Ronda must attach only the docs that materially
help judge the changed work, keep the total context within an operator-controlled
budget, and tell the model which material is **binding** versus **advisory** so
reviews stay credible without turning every pass into a whole-repo dump.

---

## Use Cases

### Use Case 1: A webhook or reviewer change is reviewed with product contract context

**Actor**: Pull request author, ADF reviewer-loop, or Ronda operator

**Preconditions**:

- A ready (non-draft) pull request changes code or configuration that affects
  webhook handling, review publication, check-run behavior, or another surface
  governed by the repository constitution or architecture docs.
- The authoritative docs for those rules exist in the repository at the
  reviewed commit.

**Steps**:

1. Ronda starts a normal review pass for the pull request head.
2. Ronda evaluates the changed files and paths against a documented catalog of
  authoritative doc categories.
3. Ronda selects zero or more docs whose content is relevant to the change,
  respecting a configured maximum doc count and character budget.
4. Ronda runs the model review with the diff plus the selected docs, labeling
  each included doc as binding product/architecture constraint or advisory
  operating context.
5. Ronda publishes findings through the existing single GitHub review and check
  run.

**Postconditions**:

- When webhook or reviewer behavior is in scope, the pass includes the
  constitution (or equivalent locked contract) and any other catalog docs that
  materially apply, not merely the raw diff.
- When no catalog doc materially applies, the pass behaves like today (diff
  only) without error.
- The published review remains comment-only; Ronda does not push fixes or merge.

**Information shown**:

- Normal Ronda review summary and inline findings on GitHub.
- No new user-facing UI; operators infer doc inclusion from review quality,
  logs, or documented smoke scenarios.

**Actions available**:

- Authors fix findings and push a new commit for a new pass.
- Operators adjust configuration if doc selection is too sparse or too heavy.

**Considerations**:

- Doc selection must be deterministic for the same head SHA and configuration.
- Missing or unreadable doc files must not crash the pass; they are omitted with
  operator-visible evidence.

---

### Use Case 2: An operator configures doc inclusion limits

**Actor**: Ronda operator

**Preconditions**:

- The operator can change Ronda configuration for the repository or deployment.

**Steps**:

1. The operator sets limits on how many authoritative docs may be attached and
  how large the combined doc excerpt budget may be.
2. The operator runs or triggers a review on a pull request known to touch
  governed surfaces.
3. The operator verifies that selected docs stay within the configured limits.

**Postconditions**:

- Doc inclusion never silently exceeds the configured maximum count or character
  budget.
- When the catalog has more candidates than the limit allows, Ronda keeps the
  highest-relevance docs and drops the rest with traceable evidence.

**Information shown**:

- Configuration values for doc count and size limits.
- Evidence in logs or smoke output listing which docs were selected or skipped
  and why.

**Actions available**:

- Tighten limits to protect model cost and latency.
- Loosen limits temporarily for a high-risk change (within operator policy).

**Considerations**:

- Limits apply in addition to the existing diff size budget; both must be
  respected.

---

### Use Case 3: A change outside governed surfaces stays diff-only

**Actor**: Pull request author

**Preconditions**:

- A ready pull request changes only localized logic (for example, a pure utility
  or test fixture) with no material tie to webhook ingress, review publication,
  or locked product boundaries.

**Steps**:

1. Ronda runs a review pass.
2. Ronda evaluates the change against the authoritative doc catalog.
3. Ronda finds no material match.

**Postconditions**:

- The pass does not attach authoritative docs solely because they exist in the
  repository.
- Review latency and prompt size remain comparable to the pre-feature baseline
  for diff-only passes.

**Information shown**:

- Standard review output only.

**Actions available**:

- Same as any other Ronda review pass.

**Considerations**:

- Keyword overlap alone must not force doc inclusion; relevance requires a
  documented, testable rule tied to changed paths or surfaces.

---

## Business Rules

- Ronda remains comment-only: no pushes, merges, or suggested commits through
  this feature.
- Authoritative doc inclusion is **optional per pass** and driven by relevance
  to the changed work, not by always attaching a fixed bundle.
- The **authoritative doc catalog** must cover at minimum: locked product
  contract (constitution), software architecture description, operator/adoption
  guidance for running reviews, and the canonical review contract used by
  consuming workflows. Additional catalog entries may be added only when they
  meet the same “authoritative for review judgment” bar.
- Each included doc must be classified for the model as **binding constraint**
  (must not be violated) or **advisory context** (informs judgment but does not
  override the diff when the diff is explicit).
- Combined authoritative doc text must respect a configured **maximum doc count**
  and **maximum character budget** in addition to the existing diff budget.
- When budgets would be exceeded, Ronda must drop lower-priority docs rather
  than truncating binding contract text without evidence.
- Doc selection for a given head SHA and configuration must be **reproducible**
  so operators can debug “why didn’t Ronda see X?”.
- Unreadable, missing, or empty catalog files must not fail the entire pass;
  they are skipped and recorded for operators.
- Sensitive values must never be copied from docs into GitHub review bodies;
  existing redaction rules for findings still apply.

---

## Operational Visibility

- **Logs**: May record selected doc identifiers (paths or stable catalog keys),
  binding versus advisory classification, counts of skipped docs, and budget
  utilization. Logs must not include secrets or credential material from docs or
  diffs.
- **Notifications**: None beyond existing GitHub review and check-run surfaces.
- **Audit trail**: Spec, implementation plan, smoke tests, and sample review
  runs demonstrating doc selection for webhook/reviewer changes form the audit
  surface.

---

## Acceptance Criteria

- [ ] For a pull request that changes webhook or reviewer behavior, a review pass
      includes the locked product contract doc and any other catalog docs the
      selection rules mark as material, and the pass completes with a published
      GitHub review plus check run.
- [ ] For a pull request with no material tie to catalog surfaces, a review pass
      completes without attaching authoritative docs and without error.
- [ ] Operator configuration can cap the **number of docs** and **total doc
      characters** included in a pass; a pass never exceeds those caps.
- [ ] Every doc included in a pass is presented to the model with an explicit
      **binding** or **advisory** label consistent with the business rules.
- [ ] When more catalog candidates qualify than limits allow, the pass retains
      the highest-priority docs per documented priority rules and records which
      docs were skipped for budget or rank reasons.
- [ ] Doc selection for the same head SHA and configuration is repeatable across
      two runs (same selected doc set and classifications).
- [ ] Missing or unreadable catalog files do not abort the pass; the review
      still completes and evidence shows the skip.
- [ ] Automated tests cover doc selection for at least one webhook/reviewer
      change scenario and one diff-only scenario, without requiring a live model
      call for the selection logic itself.
- [ ] A normal review pass still respects the existing diff size limit and
      comment-only publication contract.
- [ ] Review findings must not quote secrets or credentials from attached docs.

---

## Out of Scope (MVP)

- Replacing ADF, Helm, or external reviewers such as Codex GitHub; this feature
  only enriches Ronda’s own pass inputs.
- Indexing or summarizing the entire repository on every pass.
- Pulling documentation from outside the reviewed commit (wikis, external sites,
  or other repos).
- Letting the model choose which docs to fetch mid-pass; selection is
  deterministic pre-model logic.
- Storing doc excerpts or selection results in a database for cross-pass
  history (each pass is independent, consistent with Ronda’s one-review-per-head
  model).
- Automatically updating catalog entries when docs move; catalog maintenance
  remains a human or workflow change.
- Proving recall improvement by itself; measurement against external reviewers
  belongs to sibling work under epic #52.

---

## Coverage Matrix

Objectives are derived from the tracker brief for issue #55 and the epic #52
sub-scope line on feeding authoritative docs.

| # | Brief objective | Covered by |
| - | --------------- | ---------- |
| 1 | Expand review context beyond diff-only inspection | Overview; Use Case 1; AC 1 |
| 2 | Select a small set of docs without flooding the prompt | Use Case 2; Business Rules on budgets; AC 3, 5 |
| 3 | Include constitution, architecture, adoption/operator, and review contract docs as candidates | Business Rules on catalog; AC 1 |
| 4 | Distinguish binding constraints from advisory context | Use Case 1; Business Rules; AC 4 |
| 5 | Test context selection for webhook/reviewer changes | Use Case 1; AC 8 |
| 6 | Preserve comment-only Ronda contract | Business Rules; AC 9; Out of Scope |
| 7 | Stay orthogonal to external-reviewer capture and recall trending | Out of Scope deferral on recall proof |

### Deferral Notes

- **Recall/precision trending against external reviewers.** Epic #52 tracks
  measurement separately (sibling items). This feature delivers bounded doc
  context only; it does not require before/after recall benchmarks in MVP.
- **Whole-repo or dynamic doc discovery.** Deferred to keep passes predictable
  and within operator budgets; MVP uses a fixed authoritative catalog and
  deterministic selection.

---

## Assumptions

- The authoritative documents already exist in this repository at paths stable
  enough to catalog; path churn is handled outside this feature.
- Webhook and reviewer changes are the highest-value initial surfaces for doc
  inclusion, matching the issue brief and epic intent.
- Operators accept slightly larger prompts on governed changes when limits are
  configured conservatively.
