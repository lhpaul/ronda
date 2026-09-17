# Require Isolating Planted Violations Per New Assertion — Implementation Plan

**Spec**:
[1_63-require-isolating-planted-violation_specs.md](./1_63-require-isolating-planted-violation_specs.md)
**Smoke test runbook**:
[63-require-isolating-planted-violation.smoke-test.md](../../../testing/workflow/63-require-isolating-planted-violation.smoke-test.md)

---

## Summary

**Approach**: Extend the existing planted-violation doctrine in four aligned
surfaces — `REVIEW.md` (Workflow Policy item 4 and the Code Review Pass 2
planted-violation block), Protocol 03's **Test Harness Coverage Checklist**,
`docs/best-practices/3-testing.md`, and the Step 7a code-reviewer agent
instructions (Claude and Cursor mirrors) — so each **new assertion** in a PR
must cite at least one **isolating** plant (fail-with / pass-without for that
assertion), sibling masking in a combined rollback is invalid proof, and
internal reviewers judge **plant-set sufficiency** rather than only reproducing
the author's aggregate failure output.

No scripts, CI jobs, or automated plant verifiers are added (AC-6).

**Estimated complexity**: S

**Rationale**: The work is prose and checklist edits across a bounded file set.
Risk is inconsistency between surfaces, not runtime behavior.

**Dependencies**: Spec PR [#77](https://github.com/lhpaul/ronda/pull/77) merged
to `develop`. No other tracker item blocks this plan.

**Design assets**: None. Documentation-only item.

---

## Verification Log

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `cc05ba9` — plan branch synced to `origin/develop` after spec merge |
| Spec merged | `gh pr view 77 --json mergedAt,headRefName` | Merged 2026-09-17; branch `spec/63-require-isolating-planted-violation` |
| Open plan PR | `gh pr list --head implementation-plan/63-require-isolating-planted-violation --state open` | None at plan-write time |
| Workflow Policy item 4 today | `sed -n '399,402p' REVIEW.md` | Covers earlier-rule masking only; no sibling / per-assertion isolating rule |
| Core Rules planted bullet | `rg -n 'Planted-violation proof' REVIEW.md \| head -1` | Line 48 — per-check proof; no multi-assertion isolating requirement |
| Pass 2 planted block | `rg -n 'Planted-violation proof presence' REVIEW.md` | Line 325 — per check; no sufficiency / isolating plant-set rule |
| Protocol 03 harness checklist start | `rg -n '^## Test Harness Coverage Checklist' docs/workflow/development-workflow/protocols/03-implement-development-protocol.md` | Line 428; no isolating-per-assertion item |
| Implementer doctrine | `rg -n '^## Planted-Violation Proofs' docs/best-practices/3-testing.md` | Line 72; three-step proof only |
| Step 7a agent surfaces | `wc -l .cursor/agents/code-reviewer.md .claude/agents/code-reviewer.md` | 34 and 35 lines; no plant-set sufficiency instruction |
| Codex reviewer entrypoint | `rg -n 'workflow-code-reviewer' .agents/skills/code-review/SKILL.md` | Delegates to `.codex/skills/workflow-code-reviewer/SKILL.md` (protocol + `REVIEW.md`; agent file mirrors not duplicated) |
| No new automation in scope | Spec AC-6 | Confirmed — implementation must not add plant-verification scripts or CI |

---

## Cross-Cutting Operational Assumption Check

### Applicable

| Assumption surface | Recorded value | Authoritative source | Verified at | Bounded cross-check scope | Result |
| --- | --- | --- | --- | --- | --- |
| Approved base branch | `develop` | Parent batch handoff; `origin/develop` tip `cc05ba9` | 2026-09-17, repo `cc05ba9` | Item #63 only | `Verified` |
| Spec availability | Merged spec PR #77 on `develop` | `gh pr view 77` | 2026-09-17 | #63 development folder | `Verified` |
| Batch peer orthogonality | #64–#66 and #54–#57 do not block #63 | Spec spec-dispatch note; parent handoff | 2026-09-17 | Named batch peers only | `Verified` |

---

## Layer-by-Layer Changes

### Database / Data Layer

Not applicable.

### Backend / API

Not applicable.

### Scripts / Shell

Not applicable — AC-6 defers automated plant verification.

### Documentation / Workflow Policy

- [ ] **`REVIEW.md` — AC-1, AC-5 (reviewer severity)**  
      Extend **Workflow Policy Review Checklist** item 4 so that when a PR adds
      or materially modifies **multiple** checks or assertions, **each** must have
      at least one **isolating** planted violation in the cited proof set; a plant
      masked by an **earlier rule in the pipeline** or by **sibling assertions /
      fields changed in the same combined edit** is not proof for the assertions it
      did not isolate. Preserve existing earlier-rule masking language.

      Extend **Code Review Checklist → Pass 2 → "PRs that add or modify an
      automated check…"** with a matching **blocking** item: Step 7a / internal
      reviewers must verify **plant-set sufficiency** (one isolating plant per new
      assertion with both directions recorded). State explicitly that reproducing
      the PR's stated aggregate failure output is **necessary but not sufficient**.

- [ ] **`docs/workflow/development-workflow/protocols/03-implement-development-protocol.md` — AC-2**  
      Add one explicit bullet to **Test Harness Coverage Checklist** (after the
      existing negative-assertions item or as a dedicated planted-violation item):
      for each **new assertion** the PR introduces, require at least one
      **isolating** plant at a concrete file and line with fail-with-plant and
      pass-without (or non-targeting plant) runs recorded; one combined rollback
      that flips several assertions does **not** satisfy several new assertions
      unless isolating pairings exist for each assertion that stayed green under
      the combined edit.

- [ ] **`docs/best-practices/3-testing.md` — AC-3**  
      Under **Planted-Violation Proofs**, add a subsection (or bullets) for
      **isolating plants per new assertion**: define isolating vs sibling-masked
      plants, require one isolating plant per new assertion in multi-assertion PRs,
      and cross-reference `REVIEW.md` Workflow Policy item 4 and Protocol 03's
      harness checklist. Do **not** weaken earlier-rule masking language.

### Agent / Skill Instructions (Step 7a)

- [ ] **`.cursor/agents/code-reviewer.md` — AC-4, AC-5**  
      Add a short **Planted-violation plant-set sufficiency** block: when the PR
      adds or materially modifies checks/assertions, list new assertions, verify
      each has an isolating cited plant, treat gaps as **blocking** (same severity
      as other planted-violation proof gaps), and note that reproducing the
      author's command output alone is insufficient.

- [ ] **`.claude/agents/code-reviewer.md` — AC-4, AC-5**  
      Keep byte-aligned with the Cursor mirror (same sufficiency block).

- [ ] **`.codex/skills/workflow-code-reviewer/SKILL.md` (optional parity)**  
      Only if the plan reviewer requires explicit Codex wording: add one bullet
      pointing Step 7a reviewers to the new agent blocks and Pass 2 / Workflow
      Policy entries. Default: Codex already loads Protocol 03 + `REVIEW.md`; skip
      duplicate prose unless review finds a gap.

---

## Testing Strategy

**Test types**: Manual / documentation verification (no new automated harness — AC-6).

**Key scenarios to test**:

1. Workflow Policy item 4 mentions isolating plants, sibling masking, and
   multi-assertion PRs — maps to AC-1.
2. Protocol 03 harness checklist includes per-new-assertion isolating requirement —
   maps to AC-2.
3. `3-testing.md` aligns with AC-1/AC-2 without contradicting earlier-rule masking —
   maps to AC-3.
4. Claude and Cursor code-reviewer agents require sufficiency verification and
   blocking severity — maps to AC-4, AC-5.
5. No new plant-verification script or CI job in the diff — maps to AC-6.

**Smoke test runbook**: `docs/testing/workflow/63-require-isolating-planted-violation.smoke-test.md`

**Regression suite**: Not applicable — no committed workflow-doc regression harness.

**Planted-violation proofs for this implementation PR**: Not applicable. This item
adds documentation and agent guidance only; it does not add or materially modify an
automated check (AC-6). Record that exemption in the implementation PR self-review
log per `REVIEW.md` Verification Discipline.

---

## Seed Data

Not applicable.

---

## Documentation Updates

The implementation PR **is** the documentation update. No additional
post-implementation doc pass beyond the files listed in **Layer-by-Layer Changes**.

`AGENTS.md`, `docs/project/*`, and runtime source under `src/` are unaffected.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Wording drift between `REVIEW.md`, Protocol 03, and `3-testing.md` | Med | Med | Single author pass; smoke runbook grep checklist; plan reviewer gate |
| Step 7a agents diverge (Claude vs Cursor) | Low | Med | Copy identical sufficiency block to both agent files |
| Over-broad wording triggers false blocking on doc-only PRs | Low | Med | Scope edits to "new assertion" and harness/check contexts; keep AC-6 explicit |

---

## Code Samples

No code samples — documentation-only implementation.

---

## Implementation Order

1. **Update `REVIEW.md` (AC-1, AC-5)**  
   Edit Workflow Policy item 4 and the Pass 2 planted-violation block as described
   above.  
   **Verify**: `rg -n 'isolating|sibling' REVIEW.md` shows the new phrases in both
   sections; item 4 still mentions earlier-rule masking.

2. **Update Protocol 03 Test Harness Coverage Checklist (AC-2)**  
   Add the isolating-per-new-assertion checklist item with fail-with / pass-with
   pairing language.  
   **Verify**: read the new bullet under `## Test Harness Coverage Checklist` and
   confirm it names combined rollback / sibling masking.

3. **Update `docs/best-practices/3-testing.md` (AC-3)**  
   Extend Planted-Violation Proofs; cross-link `REVIEW.md` and Protocol 03.  
   **Verify**: no sentence removes or contradicts earlier-rule masking; isolating
   requirement is present.

4. **Update Step 7a code-reviewer agents (AC-4, AC-5)**  
   Apply the same sufficiency block to `.cursor/agents/code-reviewer.md` and
   `.claude/agents/code-reviewer.md`.  
   **Verify**: `diff -u .cursor/agents/code-reviewer.md .claude/agents/code-reviewer.md`
   shows no unintended drift beyond shared headers.

5. **Add smoke runbook**  
   Create `docs/testing/workflow/63-require-isolating-planted-violation.smoke-test.md`
   mapping each AC to a manual check (see runbook).

6. **Pre-submission self-review (Protocol 03)**  
   Run `git diff develop...HEAD` and confirm every spec AC has a matching file
   hunk. Add the self-review log to the implementation PR description stating
   planted-violation proof exemption (AC-6).

7. **Changelog fragment (implementation PR only)**  
   Add `changelog.d/63.added.require-isolating-planted-violation-per-assertion.md`
   with body:
   `- **Require isolating planted violations per assertion** (#63): Align REVIEW.md, Protocol 03, testing doctrine, and Step 7a reviewers on per-assertion isolating plants and plant-set sufficiency checks.`

8. **Verification commands**  
   - `npx markdownlint-cli2 "docs/specs/developments/**/*.md" "docs/testing/workflow/**/*.md" "REVIEW.md" "docs/best-practices/3-testing.md" "docs/workflow/development-workflow/protocols/03-implement-development-protocol.md" ".cursor/agents/code-reviewer.md" ".claude/agents/code-reviewer.md"`  
   - `find docs/specs/developments docs/testing/workflow -name "*.md" -print0 | xargs -0 python3 scripts/lint/markdown-heuristic-lint.py CHANGELOG.md`  
   - Execute the smoke runbook checks.

---

## Acceptance Criteria Traceability

| Spec AC | Plan coverage |
| --- | --- |
| AC-1 | Step 1 — `REVIEW.md` Workflow Policy item 4 |
| AC-2 | Step 2 — Protocol 03 harness checklist |
| AC-3 | Step 3 — `docs/best-practices/3-testing.md` |
| AC-4 | Step 4 — code-reviewer agent sufficiency behavior |
| AC-5 | Steps 1 and 4 — blocking severity in `REVIEW.md` and agents |
| AC-6 | No script/CI steps; exemption documented in Step 6 |
