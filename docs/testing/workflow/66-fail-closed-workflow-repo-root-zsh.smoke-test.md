# Smoke Test Runbook: Fail Closed Workflow Repo Root (zsh Sourcing)

**Feature**: Fail closed in `workflow_repo_root` when workflow-lib is sourced from zsh (#66)
**Spec**:
[1_66-fail-closed-workflow-repo-root-zsh_specs.md](../../specs/developments/20260917082041_66-fail-closed-workflow-repo-root-zsh/1_66-fail-closed-workflow-repo-root-zsh_specs.md)
**Implementation plan**:
[2_66-fail-closed-workflow-repo-root-zsh_implementation-plan.md](../../specs/developments/20260917082041_66-fail-closed-workflow-repo-root-zsh/2_66-fail-closed-workflow-repo-root-zsh_implementation-plan.md)
**Created in**: Plan Ready stage

---

## Prerequisites

Before running this smoke test:

- [ ] Implementation branch for #66 is checked out.
- [ ] `bash` and `zsh` are available (`command -v zsh`).
- [ ] Repository root contains `.ai-dev-workflow.yaml`.

---

## Test Data

| Item | Value |
| --- | --- |
| Library | `scripts/development-workflow/workflow-lib.sh` |
| Unit harness | `scripts/development-workflow/tests/test-workflow-lib-repo-root-sourcing.sh` |
| Documented workaround | `bash -c "source scripts/development-workflow/workflow-lib.sh"` |

---

## Smoke Test Steps

### Step 1: Run repo-root sourcing unit tests

**Maps to**: AC1, AC2, AC3, AC4, AC5, AC6, AC7

```bash
bash scripts/development-workflow/tests/test-workflow-lib-repo-root-sourcing.sh
```

**Expected result**: Exit code `0`. Tests cover zsh fail-closed behavior, no `/`
stdout, Bash workaround success, and no regression signal from the harness.

### Step 2: Manual zsh reproduction (optional sanity)

**Maps to**: AC1

From repository root:

```bash
zsh -c 'source scripts/development-workflow/workflow-lib.sh; workflow_repo_root; echo exit:$?'
```

**Expected result**: Non-zero exit; stderr shows Bash sourcing guidance; stdout
is not `/`.

### Step 3: Manual Bash workaround (optional sanity)

**Maps to**: AC4

```bash
bash -c 'source scripts/development-workflow/workflow-lib.sh; workflow_repo_root'
```

**Expected result**: Prints the absolute path to this repository checkout.

---

## Sign-off

| Role | Name | Date | Result |
| --- | --- | --- | --- |
| Tester | | | Pass / Fail |
