# Extract Step 8a Readiness Checklist — Spec

---

## Overview

Work Item Runners and standalone reviewer-loop operators need a reliable, repeatable
way to decide when a pull request may receive the human-review readiness label.
Today that gate lives only as a long inline shell block inside the orchestration
protocol, which forces manual copy-paste, placeholder substitution, and hand-export
of reviewer-loop telemetry before every run.

This change defines a dedicated readiness checklist command with the same
outcomes operators already rely on, stable machine-readable results, and an
automated verification suite. Orchestration documentation will invoke that
command instead of inlining the checklist, so the hard gate stays testable and
consistent with other workflow scripts.

## Brief Objective List

1. Replace the inline Step 8a checklist with a dedicated script under the
   workflow scripts directory.
2. Preserve the documented exit-code contract (0 through 12) and meanings.
3. Allow reviewer-loop settle telemetry to be supplied from a file or standard
   input instead of only from the ambient shell environment.
4. Provide an automated test harness for the checklist behavior.
5. Update Protocol 91 so Step 8a invokes the script rather than the inline block.

## Use Cases

### Use Case 1: Runner applies readiness after a clean reviewer loop

**Actor**: Work Item Runner finishing Step 7 and Step 8 for a pull request.
**Preconditions**: Continuous integration is green on the pull request head,
automated reviewer loops have reached a clean or legitimately skipped terminal
state, and any required regression label was applied for implementation pull
requests before the CI loop ran.

**Steps**:

1. The runner completes the automated reviewer loop and CI loop using the
   existing dedicated scripts.
2. The runner captures the reviewer-loop settle and local-reviewer head
   evidence the protocol already emits.
3. The runner invokes the readiness checklist command for the pull request,
   supplying branch context and the captured evidence through the supported
   file or stream input.
4. When every gate passes, the command exits with the success code and the
   runner applies the human-review readiness label through the same path as
   today.
5. When a gate fails, the command exits with the matching failure code and the
   runner follows the documented recovery action without applying the readiness
   label.

**Postconditions**: Readiness is applied only when the checklist succeeds; failed
gates produce the same operator recovery paths as the current inline checklist.

**Information shown**:

- Per-check pass or fail messages, including CI head binding and settle-state
  outcomes when relevant.
- Machine-readable readiness evidence lines for the head commit and CI totals
  when CI passes.
- Explicit error text naming the blocking condition and the next workflow step.

**Actions available**:

- Apply the readiness label when the command succeeds.
- Re-run the reviewer loop, CI loop, or fixer cycle according to the exit code.
- Escalate when repeated settle failures indicate the platform never goes quiet.

**Considerations**:

- A clean reviewer-loop script result alone must not authorize readiness; thread
  resolution and settle telemetry remain mandatory gates.
- Implementation pull requests still require regression label verification in
  the checklist order documented today.

### Use Case 2: Operator resumes readiness from saved loop output

**Actor**: Workflow operator or runner resuming after an interrupted session.
**Preconditions**: A prior reviewer-loop run produced settle and local-reviewer
evidence that was saved to a file or log excerpt.

**Steps**:

1. The operator identifies the pull request number and branch prefix.
2. The operator invokes the readiness checklist command with evidence input from
   the saved file or piped stream rather than re-exporting variables manually.
3. The command validates that telemetry binds to the live pull request head.
4. The operator proceeds or recovers based on the exit code and printed guidance.

**Postconditions**: Readiness decisions do not depend on fragile manual
environment export from log scraping.

**Information shown**:

- Whether supplied telemetry is missing, stale relative to the live head, or
  sufficient for settle and local-reviewer checks.
- The same exit codes and recovery hints as an interactive run.

**Actions available**:

- Re-run the reviewer loop on the current head when telemetry is stale or absent.
- Continue to label application when telemetry matches the live head and all
  gates pass.

**Considerations**:

- Supplying evidence from a file must not weaken head-binding rules; a verdict
  for an older commit must still be refused.

### Use Case 3: Maintainer verifies checklist behavior in CI

**Actor**: Workflow maintainer changing readiness rules or fixing a regression.
**Preconditions**: The repository workflow test suite is available locally or in
continuous integration.

**Steps**:

1. The maintainer runs the focused automated tests for the readiness checklist.
2. Tests exercise representative pass and fail paths across exit codes without
   requiring live GitHub mutation for every scenario.
3. Failures pinpoint which gate or exit code regressed before a protocol change
   merges.

**Postconditions**: Checklist behavior is verifiable without copying the inline
block into a one-off shell session.

**Information shown**:

- Test pass or fail status per scenario.
- Assertion output tying failures to expected exit codes or messages.

**Actions available**:

- Fix the script or tests before merging protocol or implementation changes.
- Extend scenarios when new gates receive new exit codes per the contract table.

## Business Rules

- The readiness checklist remains a hard gate: no path may apply the
  human-review readiness label without a successful checklist run for the
  current pull request state.
- Exit codes 0 through 12 keep the meanings documented in Protocol 91 Step 8a;
  new gates must take the next unused code without collision.
- Required labels for readiness still derive from branch prefix, not from pull
  request content; the extracted command must preserve that rule.
- Reviewer-loop settle telemetry and local-reviewer head evidence remain
  mandatory when automated review platforms are configured; skipped-loop cases
  stay exempt under the same conditions as today.
- Supplying telemetry through file or stream input is optional convenience; when
  omitted, behavior matches environment-based input for the same values.
- Infrastructure dependency scanning, human-checkpoint label sync, and
  documentation-stage alignment checks that surround Step 8a in the protocol may
  remain orchestration steps before or after the script invocation unless a
  later plan explicitly folds them into the command scope.
- The inline checklist block in Protocol 91 is replaced by a script invocation
  plus a pointer to the script’s usage and exit-code table; operators must not
  need to copy fenced shell from the protocol to run the gate.

## Operational Visibility

- **Command output**: Each check emits human-readable pass or fail lines; failures
  include the recovery action (re-run CI, re-run reviewer loop, resolve threads,
  and so on).
- **Machine-readable evidence**: Successful CI verification continues to expose
  head commit and check-count evidence lines operators paste into runner summaries.
- **Exit code**: The process exit code is the primary automation signal for
  orchestrators and CI wrappers.
- **Protocol deviation logging**: When an implementation pull request missing the
  regression label is corrected inside the checklist, the same warning and
  re-run-CI requirement applies as in the current inline gate.

## Acceptance Criteria

- [ ] A dedicated readiness checklist command exists under the workflow scripts
      directory and accepts a pull request identifier plus branch context.
- [ ] Invoking the command performs the same ordered gates as Protocol 91 Step 8a
      today, including CI green verification, reviewer-loop summary cleanliness,
      settle-state and local-reviewer head binding, draft status, regression
      label rules for implementation branches, residual and complex-gate evidence
      when flagged by the caller, documentation-stage alignment for spec and
      plan branches, pre-label regression and thread verification, and final
      readiness label application on success.
- [ ] Exit codes 0 through 12 match the Step 8a contract table meanings in
      Protocol 91 at the time of implementation.
- [ ] The command accepts reviewer-loop settle and local-reviewer telemetry from
      a named evidence file or from standard input in a documented format, and
      refuses readiness when that telemetry does not bind to the live pull
      request head.
- [ ] An automated test harness covers representative success and failure
      scenarios, including at least one case each for CI-not-green, draft pull
      request, missing regression label recovery path, unsettled clean verdict,
      and successful readiness application preconditions where tests can run
      without live repository mutation.
- [ ] Protocol 91 Step 8a instructs runners to invoke the script (with
      parameters and evidence forwarding) instead of the inline bash block.
- [ ] Standalone reviewer-loop protocol references remain consistent with the
      script-based Step 8a entry point.

## Coverage Matrix

| Brief objective | Coverage |
| --- | --- |
| 1. Dedicated script under workflow scripts | Overview, Use Case 1, AC1 |
| 2. Preserve exit codes 0–12 | Business Rules, Use Case 1, AC3 |
| 3. Evidence from file or stdin | Use Case 2, Business Rules, AC4 |
| 4. Automated test harness | Use Case 3, AC5 |
| 5. Protocol 91 calls script | Business Rules, AC6, AC7 |

## Out of Scope (MVP)

- Changing which gates exist, their order, or the human-review readiness label
  semantics beyond extracting the current inline behavior into a command.
  **Deferral Note**: gate additions remain separate workflow items that extend
  the exit-code table per existing protocol rules.
- Merging infrastructure dependency scanning or human-checkpoint label sync
  into the same script in this iteration. **Deferral Note**: those subsections
  stay orchestration responsibilities unless a follow-up item consolidates them.
- Replacing Step 8c independent verification or Step 8b tracker updates.
  **Deferral Note**: this item targets only the Step 8a label readiness
  checklist extraction described in the tracker brief.
- Supporting non-GitHub pull request hosts. **Deferral Note**: the workflow
  remains GitHub-facing per product constitution.

## PR-Visible Deferral Notes

- **Gate behavior changes**: Deferred; extraction must preserve current outcomes.
- **Surrounding Step 8a subsections**: Deferred from script scope; protocol may
  still run them adjacent to the invocation.
- **Step 8b / 8c**: Deferred; unchanged by this spec.
