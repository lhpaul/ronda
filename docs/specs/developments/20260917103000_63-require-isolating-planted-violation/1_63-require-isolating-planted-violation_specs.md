# Require Isolating Planted Violations Per New Assertion — Spec

---

## Overview

Pull requests that add automated checks or test assertions must prove those
controls actually detect the violations they claim to catch. The workflow already
requires planted-violation proof at a concrete file and line, and it already
rejects a plant that is masked by an **earlier** rule in the same pipeline.

That is not enough when one PR adds **several** new assertions. A single combined
rollback can leave some assertions green forever, or flip an assertion only
because a sibling field changed — evidence that looks like a proof but does not
show the assertion detects anything on its own. In one real review, the Step 7a
internal reviewer reproduced the author's stated plant output and approved; a
later external reviewer blocked because the plant set was not sufficient.

This feature tightens **implementer guidance** and **internal reviewer
behavior** so that:

- Each new assertion in a PR must have at least one **isolating** planted
  violation in the proof set.
- The Step 7a code reviewer verifies **sufficiency of the plant set**, not
  only that the PR's described runs reproduce.

The change is documentation and agent-behavior guidance only. It does not add
new CI jobs or automated plant verification tooling in this release.

---

## Issue-Objective Traceability

| # | Objective (from #63) | Where it is satisfied |
| --- | --- | --- |
| 1 | Close the guidance gap: several new assertions can mask each other under one combined plant | Business Rules; AC-1, AC-2, AC-3 |
| 2 | Extend `REVIEW.md` Workflow Policy item 4 for sibling masking | AC-1 |
| 3 | Extend Protocol 03 Test Harness Coverage Checklist consistently | AC-2 |
| 4 | Align implementer-facing planted-violation doctrine where it restates the same rule | AC-3 |
| 5 | Step 7a reviewer checks plant-set sufficiency, not only reproduction of stated output | Use Case 2; AC-4, AC-5, AC-6 |

**Spec-dispatch note**: Item #63 is **orthogonal** to batch peers #64–#66 and
#54–#57. Shared vocabulary (`reviewer`, `REVIEW.md`, `Protocol 03`) is not
dependency evidence; this spec must not claim it blocks or requires those items.

---

## Definitions

- **Assertion (for this feature)**: A distinct pass/fail outcome the PR adds or
  materially changes — for example a new test case, a new negative assertion in
  a harness, or a new enforceable check outcome named in review evidence.
- **New assertion**: An assertion introduced or materially rewritten in the PR
  under review (not an unchanged assertion merely re-run for context).
- **Planted violation (plant)**: A deliberate violation at a concrete file and
  line used to demonstrate that a check fails when the violation is present and
  passes when it is removed, as already required by workflow doctrine.
- **Isolating plant (for an assertion)**: A plant such that, when applied, the
  target assertion's outcome flips **because of what that assertion tests**, not
  because unrelated sibling assertions or fields also flipped from the same
  edit. A plant that only fails an assertion after a combined rollback collapses
  multiple fields is **masked**, not isolating.
- **Plant set**: The collection of plants the PR cites as proof for its new or
  modified checks/assertions.
- **Sufficient plant set**: For every new assertion in the PR, the plant set
  includes at least one isolating plant for that assertion, and the PR records
  both directions for that pairing (fails with plant, passes without it or with
  a plant that does not target that assertion).

---

## Use Cases

### Use Case 1: Implementer proves several new assertions

**Actor**: Developer (or agent) opening an implementation PR that adds or
materially modifies a test harness or automated check with multiple new
assertions.

**Preconditions**: The PR adds two or more new assertions, or adds one new
assertion alongside other material harness changes that could mask proof.

**Steps**:

1. The implementer lists each new assertion by name or stable identifier (test
   title, check id, scenario label).
2. For each assertion, the implementer prepares at least one isolating plant at
   a concrete file and line.
3. For each pairing, the implementer records a failing run with the plant and a
   passing run without that plant (or with a plant that does not target that
   assertion).
4. The implementer cites those pairings in PR evidence (description or linked
   plan section) before requesting review.

**Postconditions**: No new assertion relies solely on a combined rollback or
sibling collateral to appear proven.

**Considerations**:

- One physical fixture may host multiple plants if each plant isolates a
  different assertion without masking the others.
- Re-proof exemptions for pure refactors of already-proven logic remain as
  today; this feature does not remove them.

---

### Use Case 2: Step 7a internal reviewer evaluates plant-set sufficiency

**Actor**: Step 7a code reviewer (internal draft review gate).

**Preconditions**: The PR adds or materially modifies checks/assertions and
claims planted-violation proof.

**Steps**:

1. The reviewer reads the PR's list of new assertions and the cited plant set.
2. For each new assertion, the reviewer asks whether at least one cited plant
   is isolating for that assertion — not merely whether re-running the author's
   described command reproduces the author's stated failure count.
3. When any assertion lacks an isolating plant, the reviewer records a
   **blocking** finding that names the assertion and what proof is missing.
4. When the plant set is sufficient, the reviewer records that sufficiency was
   verified (brief note in review output is enough).

**Postconditions**: Vacuous or masked proofs do not pass the internal gate
because the reviewer only confirmed reproduction of a combined result.

**Considerations**:

- Reproducing the author's command output is necessary but not sufficient.
- The reviewer does not need to invent new plants; they judge whether the PR's
  evidence meets the isolating-per-assertion rule.

---

### Use Case 3: Maintainer reads aligned doctrine after merge

**Actor**: Maintainer or agent reading `REVIEW.md`, Protocol 03, or testing
best practices before a harness change.

**Steps**:

1. They read the planted-violation rules in implementer and reviewer surfaces.
2. The sibling-masking rule reads consistently across those surfaces.

**Postconditions**: A single combined plant cannot be mistaken as satisfying
proof for multiple unrelated new assertions.

---

## Business Rules

- A plant that is masked by an **earlier rule** in a pipeline remains invalid,
  as today.
- A plant that is masked by **sibling assertions or fields changed in the same
  combined edit** is equally invalid for proving any one of those assertions.
- Each **new assertion** in a PR must have **at least one isolating plant** in
  the PR's cited proof set, with both fail-with-plant and pass-without directions
  recorded for that pairing.
- A **single combined rollback** that removes the fix for multiple behaviors
  does **not** satisfy the per-assertion requirement unless the PR also shows
  isolating plants (or isolated steps) for each assertion that stayed green
  under the combined rollback.
- Step 7a internal review **must** treat insufficient plant sets as blocking,
  using the same severity as other planted-violation proof gaps in
  `REVIEW.md`.
- External reviewers may still catch gaps; this feature reduces reliance on
  them for this specific failure mode.

---

## Operational Visibility

- **Implementer visibility**: Protocol 03 Test Harness Coverage Checklist and
  planted-violation doctrine state the per-assertion isolating requirement in
  checklist form.
- **Reviewer visibility**: `REVIEW.md` Workflow Policy checklist item 4 (and
  aligned code-review planted-violation entries where they restate proof rules)
  state the sibling-masking case explicitly.
- **Agent visibility**: Step 7a code-reviewer instructions tell the agent to
  verify plant-set sufficiency per new assertion, not only reproduce stated
  runs.

---

## Acceptance Criteria

- [ ] **AC-1** — `REVIEW.md` Workflow Policy Review Checklist item 4 states that
      when a PR adds or materially modifies **multiple** checks or assertions,
      each must have an isolating plant; a plant masked by an earlier rule **or**
      by sibling changes in the same combined edit is not proof for the
      assertions it did not isolate.
- [ ] **AC-2** — Protocol 03 **Test Harness Coverage Checklist** includes an
      explicit item requiring an isolating planted violation per **new**
      assertion (with fail-with / pass-without pairing), and states that one
      combined plant does not satisfy several new assertions.
- [ ] **AC-3** — Implementer-facing planted-violation guidance in
      `docs/best-practices/3-testing.md` (Planted-Violation Proofs) aligns with
      AC-1 and AC-2 without contradicting existing earlier-rule masking language.
- [ ] **AC-4** — Step 7a code-reviewer agent instructions (Cursor and Claude
      mirrors kept consistent) require verifying **plant-set sufficiency** — one
      isolating plant per new assertion — and explicitly say that reproducing
      the PR's stated aggregate failure output is not sufficient alone.
- [ ] **AC-5** — When plant-set sufficiency fails, Step 7a review guidance
      treats the gap as **blocking**, consistent with existing planted-violation
      proof blocking in `REVIEW.md`.
- [ ] **AC-6** — No new automated plant-verification script or CI job is
      required for this feature; verification remains human/agent review of cited
      evidence (automation deferred).

---

## Coverage Matrix

| Brief objective | Coverage |
| --- | --- |
| Guidance gap (sibling masking) | AC-1, AC-2, AC-3 |
| Extend `REVIEW.md` item 4 | AC-1 |
| Extend Protocol 03 harness checklist | AC-2 |
| Reviewer sufficiency behavior | AC-4, AC-5 |
| PR #61 class failure prevented at Step 7a | Use Cases 1–2; AC-4, AC-5 |

---

## Out of Scope (MVP)

- Automated extraction or CI enforcement that parses test output and proves
  isolating coverage without human review.
- Changing external GitHub reviewer (`local-ai-reviewer` / Ronda) behavior beyond
  what falls out of clearer implementer evidence.
- Retroactive re-proof of merged pull requests.
- Redesign of the full Test Harness Coverage Checklist beyond the planted-violation
  isolating item and necessary cross-references.
- Batch items #64–#66 (orthogonal; no dependency claims).

---

## Open Questions

None — issue #63 and the PR #61 retrospective supply sufficient product scope
for this documentation-and-behavior change.
