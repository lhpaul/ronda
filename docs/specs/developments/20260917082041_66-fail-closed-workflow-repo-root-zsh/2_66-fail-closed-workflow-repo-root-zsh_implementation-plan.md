# Fail Closed When Workflow Library Is Sourced From zsh — Implementation Plan

**Spec**: [1_66-fail-closed-workflow-repo-root-zsh_specs.md](1_66-fail-closed-workflow-repo-root-zsh_specs.md)
**Smoke test runbook**: [docs/testing/workflow/66-fail-closed-workflow-repo-root-zsh.smoke-test.md](../../../../docs/testing/workflow/66-fail-closed-workflow-repo-root-zsh.smoke-test.md)

---

## Summary

**Approach**: `workflow_script_dir` already detects unsupported sourcing (empty
`BASH_SOURCE[0]`) and prints the documented Bash workaround, but
`workflow_repo_root` ignores that failure and runs `cd` against an empty path
segment, which resolves to the filesystem root. The fix makes
`workflow_repo_root` (and `cd_workflow_repo_root`) propagate
`workflow_script_dir` failure without printing a root path, then adds a focused
shell unit harness that reproduces zsh sourcing and the documented Bash
workaround. No change to the supported Bash-sourcing contract from closed issue
#792.

**Estimated complexity**: S

**Rationale**: One small function change plus a new test file; no schema,
protocol, or cross-repo wiring.

**Dependencies**: None — spec PR #73 is merged on `develop`.

---

## Verification Log

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `941a2de` |
| zsh wrong-root reproduction | `cd <repo> && zsh -c 'source scripts/development-workflow/workflow-lib.sh; workflow_repo_root; echo exit:$?'` | Prints documented `BASH_SOURCE` error on stderr, stdout `/`, exit `0` (bug) |
| Root resolver definition | `rg -n 'workflow_repo_root\(\)|workflow_script_dir\(\)' scripts/development-workflow/workflow-lib.sh` | `workflow_script_dir` at line 24; `workflow_repo_root` at line 32 |
| Existing lib unit harness | `ls scripts/development-workflow/tests/test-workflow-lib-github-projects.sh` | Present — pattern for new repo-root sourcing tests |
| Smoke runbook slot | `ls docs/testing/workflow \| rg '^66-'` | Absent — to be created |

---

## Cross-Cutting Operational Assumption Check

**Result**: `Not applicable` — the plan changes only shell library path resolution
and regression tests in this repository. It does not depend on linked cloud
projects, product-repo routing, or a canonical config value that concurrent batch
items #54–#58, #63–#65 are changing. Batch handoff classified peer items as
orthogonal (shared keywords alone are not dependency evidence).

---

## Layer-by-Layer Changes

### Backend / API (shell library)

- [ ] **`scripts/development-workflow/workflow-lib.sh` — `workflow_repo_root`**: Resolve `workflow_script_dir` into a local variable with `if ! script_dir="$(workflow_script_dir)"; then return 1; fi` before `cd`. Do not print a path when script-dir detection failed. Maps to AC1, AC3.
- [ ] **`scripts/development-workflow/workflow-lib.sh` — `cd_workflow_repo_root`**: Propagate `workflow_repo_root` failure (`return 1` when root resolution fails) instead of `cd` to `/`. Maps to AC1.
- [ ] **`scripts/development-workflow/workflow-lib.sh` — caller sanity (minimal)**: Confirm `workflow_config_file` / `workflow_config_exists` no longer treat `/.ai-dev-workflow.yaml` as a meaningful default when zsh sourcing failed (fail-closed root should make `[ -f "$(workflow_config_file)" ]` false). No broad refactor of every helper that uses default `$(workflow_repo_root)` unless a test proves a misleading tracker warning still appears; spec defers full-session hard-stop for all helpers.

### Shared Packages / Libraries

No separate packages — changes stay in `workflow-lib.sh`.

### Infrastructure / Configuration

None.

### Documentation

None at implementation time — behavior is already documented in the existing
`BASH_SOURCE` error text; this plan fixes the silent fallback after that message.

---

## Testing Strategy

**Test types**: Unit (shell harness), Smoke (manual runbook)

**Key scenarios to test**:

1. **zsh direct source — fail closed**: From repo root, `zsh -c 'source scripts/development-workflow/workflow-lib.sh; workflow_repo_root'` must exit non-zero and must not print `/` or any path on stdout. Stderr must still include the documented Bash sourcing guidance. Maps to AC1, AC3, AC5.
2. **zsh — config helper after failed root**: After zsh sourcing, invoking `workflow_config_exists` (or a thin wrapper used in the test) must not report success for a manifest that exists only in the real repo checkout. Maps to AC2.
3. **Bash workaround — success**: `bash -c 'source scripts/development-workflow/workflow-lib.sh; workflow_repo_root'` from repo root resolves to the actual checkout (ends with `ronda` or matches `pwd -P` of repo root). Maps to AC4, AC6.
4. **Bash script source — regression**: Existing pattern `bash scripts/development-workflow/tests/test-workflow-lib-github-projects.sh` (or targeted subset) still passes unchanged. Maps to AC7.

**New unit file**: `scripts/development-workflow/tests/test-workflow-lib-repo-root-sourcing.sh`

**Smoke test runbook**: `docs/testing/workflow/66-fail-closed-workflow-repo-root-zsh.smoke-test.md`

**Regression suite**: No automated regression suite beyond shell unit tests in this repository.

---

## Seed Data

Not applicable — tests use the live checkout and `zsh`/`bash` invocations only.

---

## Documentation Updates

- None — the supported sourcing contract and operator workaround already exist;
  this change removes incorrect post-error behavior only.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Callers assumed `workflow_repo_root` always prints a path | Low | Med | Grep for bare `$(workflow_repo_root)` in scripts; unit test covers primary operator path; existing Bash scripts source from Bash |
| zsh availability in CI | Low | Low | Test skips or documents requirement when `command -v zsh` fails; local smoke runbook covers macOS zsh |

---

## Code Samples

Illustrative only — adapt during implementation:

```bash
# Illustrative — adapt during implementation
workflow_repo_root() {
  local script_dir=""
  if ! script_dir="$(workflow_script_dir)"; then
    return 1
  fi
  CDPATH='' cd -- "$script_dir/../.." && pwd
}
```

---

## Implementation Order

1. Add `scripts/development-workflow/tests/test-workflow-lib-repo-root-sourcing.sh` with failing assertions for the current zsh behavior (red).
2. Update `workflow_repo_root` and `cd_workflow_repo_root` in `workflow-lib.sh` to propagate `workflow_script_dir` failure (green).
3. Run `bash scripts/development-workflow/tests/test-workflow-lib-repo-root-sourcing.sh` and confirm pass.
4. Run `bash scripts/development-workflow/tests/test-workflow-lib-github-projects.sh` (or repo `npm test` if it includes workflow-lib tests) for regression.
5. Execute smoke runbook steps in `docs/testing/workflow/66-fail-closed-workflow-repo-root-zsh.smoke-test.md`.
6. Add `changelog.d/66.fix.fail-closed-workflow-repo-root-zsh.md` with body:

   ```markdown
   - **Fail closed workflow repo root under zsh sourcing** (#66): Stop `workflow_repo_root` from resolving to the filesystem root when `BASH_SOURCE` is unavailable; add regression tests for zsh sourcing and the Bash workaround.
   ```
