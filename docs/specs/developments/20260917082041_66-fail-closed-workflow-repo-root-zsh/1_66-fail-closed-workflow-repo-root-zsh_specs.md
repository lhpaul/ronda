# Fail Closed When Workflow Library Is Sourced From zsh — Spec

---

## Overview

Operators and AI agents sometimes load the repository workflow library from an
interactive zsh session instead of Bash. When that happens, path resolution for
the repository root can fail silently and fall back to the filesystem root,
which makes later configuration lookups report that settings are missing even
when they are present in the project.

This feature requires repository-root resolution to stop immediately with the
existing documented guidance when script-path detection fails, so operators see
the real cause instead of misleading configuration warnings. Focused regression
coverage prevents the silent fallback from returning.

## Brief Objective List

Derived from issue #66:

1. Stop repository-root resolution from continuing when script-path detection
   fails because the library was sourced from a non-Bash shell.
2. Ensure downstream configuration and tracker helpers do not run against a
   wrong repository root after that failure.
3. Preserve the documented workaround of sourcing the library through an
   explicit Bash invocation.
4. Add regression coverage that reproduces the zsh sourcing case and proves no
   fallback to the filesystem root occurs.

## Use Cases

### Use Case 1: Operator sources the workflow library from zsh

**Actor**: Workflow operator or AI agent.
**Preconditions**: The operator uses zsh as the interactive shell and sources the
workflow library directly instead of through Bash.

**Steps**:

1. The operator sources the workflow library from zsh.
2. The library detects that Bash script-path metadata is unavailable.
3. The operator receives the existing actionable error that explains sourcing
   through Bash.
4. Any call that depends on repository-root resolution stops without attempting
   configuration lookup from a wrong root.

**Postconditions**: No tracker or configuration helper reports a false
"missing configuration" diagnosis when the real problem is incorrect shell
usage.

**Information shown**:

- The documented error explaining that the library must be sourced from Bash
  or via an explicit Bash one-liner.
- No secondary warning that implies project configuration is absent when it is
  actually configured in the repository.

**Actions available**:

- Re-run the command using the documented Bash sourcing workaround.
- Continue other work that does not depend on the workflow library in zsh.

**Considerations**:

- Tracker status updates are best-effort today; the improvement is truthful
  diagnostics and preventing silent wrong-root behavior, not making every
  helper hard-fail the entire shell session.

### Use Case 2: Operator uses the documented Bash workaround

**Actor**: Workflow operator or AI agent.
**Preconditions**: The operator follows the documented pattern to source the
library through Bash.

**Steps**:

1. The operator runs the documented Bash one-liner to source the library.
2. Repository-root resolution succeeds.
3. Configuration lookup finds the project workflow manifest.
4. Tracker helpers behave as they do when the library is sourced from a Bash
   script.

**Postconditions**: Behavior matches the supported Bash sourcing path with no
regression for existing automation.

**Information shown**:

- Normal success paths for configuration-backed helpers when credentials and
  tracker settings are present.

**Actions available**:

- Run tracker updates and other supported helpers after successful sourcing.

**Considerations**:

- The workaround must remain sufficient for macOS zsh users without requiring
  them to change their default shell.

### Use Case 3: Maintainer verifies regression coverage before release

**Actor**: Template maintainer or reviewer.
**Preconditions**: A change touches repository-root resolution or library
loading behavior.

**Steps**:

1. The maintainer runs focused regression tests for the unsupported sourcing
   case.
2. Tests assert that repository-root resolution does not return the filesystem
   root when script-path detection fails.
3. Tests assert that the primary error message remains the documented Bash
   sourcing guidance.
4. The maintainer confirms the Bash workaround path still passes.

**Postconditions**: The silent wrong-root failure mode cannot reappear without
failing automated checks.

**Information shown**:

- Pass or fail for zsh-style sourcing and Bash workaround scenarios.
- Clear assertion messages when fallback to the filesystem root is detected.

**Actions available**:

- Accept changes when regression coverage passes.
- Block release when fallback behavior reappears.

**Considerations**:

- Coverage should target the reported production failure mode rather than every
  possible mis-sourcing pattern.

## Business Rules

- When script-path detection fails during library load, repository-root
  resolution must not substitute an empty path and must not resolve to the
  filesystem root.
- Callers that depend on repository-root resolution must propagate the failure
  so the documented Bash sourcing error remains visible.
- Configuration and tracker helpers must not emit "configuration missing"
  diagnostics that contradict a correctly configured repository when the actual
  failure is unsupported shell sourcing.
- The documented Bash one-liner workaround remains the supported operator path
  for zsh users.
- Regression coverage must fail if repository-root resolution returns the
  filesystem root when script-path detection has failed.
- Existing Bash-script and explicit-Bash sourcing paths must remain supported
  without behavior regression.

## Operational Visibility

- **Primary error**: Operators see the existing message that Bash sourcing is
  required, not a misleading project-configuration warning.
- **Regression evidence**: The implementation records automated test results for
  zsh-style sourcing and the Bash workaround.
- **Agent guidance**: Workflow runners that source the library continue to use
  Bash explicitly, consistent with batch orchestration requirements.

## Acceptance Criteria

- [ ] Sourcing the workflow library from zsh surfaces the documented Bash
      sourcing error and does not resolve the repository root to the filesystem
      root.
- [ ] After zsh sourcing, a helper that reads project configuration does not
      report that tracker project settings are missing when those settings exist
      in the repository manifest.
- [ ] Repository-root resolution returns a failure (non-success) when
      script-path detection fails, rather than continuing with an empty path
      segment.
- [ ] The documented Bash one-liner sourcing workaround resolves the
      repository root to the actual project checkout.
- [ ] Focused automated regression coverage reproduces the zsh sourcing case
      and fails if filesystem-root fallback reappears.
- [ ] Focused automated regression coverage confirms the Bash workaround path
      still succeeds.
- [ ] Existing workflow automation that sources the library from Bash scripts
      continues to pass existing tests without behavior change.

## Coverage Matrix

| Brief objective | Coverage |
| --- | --- |
| 1. Fail closed when script-path detection fails | Use Case 1, Business Rules, AC1, AC3 |
| 2. Avoid misleading configuration diagnostics | Use Case 1, Business Rules, AC2 |
| 3. Preserve Bash workaround | Use Case 2, Business Rules, AC4, AC6 |
| 4. Add zsh regression coverage | Use Case 3, Operational Visibility, AC5, AC6 |

## Out of Scope (MVP)

- Making every workflow helper function exit the entire shell session on
  unsupported sourcing. **Deferral Note**: issue #66 targets truthful
  repository-root behavior and diagnostics; broader hard-stop semantics for
  all helpers can be evaluated separately, and no human confirmation is
  requested.
- Supporting full interactive zsh as a first-class sourcing environment without
  the Bash workaround. **Deferral Note**: the closed template issue #792
  already established Bash sourcing as the supported contract; this item fixes
  the cascade after that message, and no human confirmation is requested.
- Changing unrelated configuration resolver behavior in Python helpers.
  **Deferral Note**: the defect is in shell library path resolution when
  sourced from zsh; resolver logic is unchanged unless required to honor the
  new fail-closed contract, and no human confirmation is requested.
