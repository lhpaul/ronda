# Smoke Test Runbook: Reduce Local Reviewer Timeouts in Expensive-Review Gates

**Feature**: Infrastructure-aware expensive-review gate and local timeout diagnostics
**Spec**:
[1_57-reduce-local-reviewer-timeouts_specs.md](../../specs/developments/20260917082124_57-reduce-local-reviewer-timeouts/1_57-reduce-local-reviewer-timeouts_specs.md)
**Implementation plan**:
[2_57-reduce-local-reviewer-timeouts_implementation-plan.md](../../specs/developments/20260917082124_57-reduce-local-reviewer-timeouts/2_57-reduce-local-reviewer-timeouts_implementation-plan.md)
**Created in**: Plan Ready stage

---

## Prerequisites

- [ ] You are reviewing the implementation PR for #57 (not this plan-only PR).
- [ ] The PR targets `develop`.
- [ ] Dependencies #1648, #1649, and #1656 are merged into `develop`.
- [ ] `bash`, `jq`, and `git` are available.
- [ ] Harness runs use `HARNESS_MODE=1`; live Codex GitHub is not required when
      fixtures mock platform dispatch.

---

## Test Data

| Item | Value |
| --- | --- |
| Reviewer loop | `scripts/development-workflow/pr-review-loop.sh` |
| Local reviewer | `scripts/development-workflow/local-ai-reviewer.sh` |
| Expensive gate suite | `scripts/development-workflow/tests/test-expensive-reviewer-gate.sh` |
| Loop harness | `scripts/development-workflow/tests/test-pr-review-loop.sh` |
| Local reviewer tests | `scripts/development-workflow/tests/test-local-ai-reviewer.sh` |
| Override flags | `PR_REVIEW_LOOP_FORCE_EXPENSIVE_REVIEWERS`, `PR_REVIEW_LOOP_EXPENSIVE_OVERRIDE_JUSTIFICATION` |
| Protocol | `docs/workflow/development-workflow/protocols/93-automated-reviewer-loop-protocol.md` |

---

## Smoke Test Steps

### Step 1: Infrastructure timeout is not `local_evidence_missing`

**Maps to**: AC-1, AC-2, AC-3.

1. Source the loop in harness mode and drive the expensive gate with
   `local-ai-reviewer` configured, `platform_reviewed_heads` set from an
   infrastructure attempt on `loop_head_sha`, and classifier output
   `infrastructure`.

**Expected result**: `EXPENSIVE_GATE_REASON=local_infrastructure_failure` (not
`local_evidence_missing`); `EXPENSIVE_GATE_RESULT=deferred` without override;
`run_platform_review` is not called for `codex-github`.

### Step 2: Diagnostics appear in summary and history

**Maps to**: AC-11, AC-12.

1. Run a harness cycle that records a local timeout with diagnostic keys.
2. Inspect the composed summary markdown and latest history entry JSON.

**Expected result**: Outcome class `infrastructure`, command id label, head SHA,
partial-output flag, and elapsed/budget field present; no synthetic local clean
verdict.

### Step 3: Code findings still block expensive dispatch

**Maps to**: AC-7.

1. Drive gate with latest local result `needs_fixes` on current head.

**Expected result**: Expensive dispatch withheld with existing not-clean/stale
semantics; infrastructure override path not taken.

### Step 4: Forced expensive run requires justification

**Maps to**: AC-4, AC-5, AC-10.

1. Set `PR_REVIEW_LOOP_FORCE_EXPENSIVE_REVIEWERS=1` without justification env.
2. Repeat with non-empty `PR_REVIEW_LOOP_EXPENSIVE_OVERRIDE_JUSTIFICATION`.

**Expected result**: (1) defer or named missing-justification reason — no
silent Codex dispatch. (2) `EXPENSIVE_GATE_RESULT=forced`, expensive reviewer
runs, PR contains visible override comment text.

### Step 5: Default path never implies clean readiness on infrastructure alone

**Maps to**: AC-8, AC-13.

1. Complete a loop pass with infrastructure failure and no override.

**Expected result**: Aggregate readiness withheld; `ready-for-human-review` not
applied; history does not record a local clean verdict for the head.

### Step 6: Automated suites

**Maps to**: regression guard.

<!-- workflow-shell-contract: bash -->

```bash
bash scripts/development-workflow/tests/test-expensive-reviewer-gate.sh
bash scripts/development-workflow/tests/test-local-ai-reviewer.sh
# Run the loop harness Area added for #57 when present:
bash scripts/development-workflow/tests/test-pr-review-loop.sh
```

**Expected result**: All suites exit 0; new infrastructure scenarios fail before
implementation and pass after.
