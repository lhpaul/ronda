# Smoke Test Runbook: Extract Step 8a Readiness Checklist

**Feature**: Extract Step 8a readiness checklist into a tested script
**Spec**: [1_65-extract-step-8a-readiness-checklist_specs.md](../../specs/developments/20260917082042_65-extract-step-8a-readiness-checklist/1_65-extract-step-8a-readiness-checklist_specs.md)
**Plan**: [2_65-extract-step-8a-readiness-checklist_implementation-plan.md](../../specs/developments/20260917082042_65-extract-step-8a-readiness-checklist/2_65-extract-step-8a-readiness-checklist_implementation-plan.md)
**Created in**: Plan Ready stage

---

## Prerequisites

Before running this smoke test:

- [ ] The implementation branch is checked out.
- [ ] `bash` is available (script must not require zsh).
- [ ] For live PR mode (optional): `gh` is authenticated for the repository.
- [ ] `npm ci` has been run at the repository root if executing the full test suite.

---

## Test Data

| Item | Value |
| --- | --- |
| Script under test | `scripts/development-workflow/pr-label-readiness-checklist.sh` |
| Unit harness | `scripts/development-workflow/tests/test-pr-label-readiness-checklist.sh` |
| Protocol regression harness | `scripts/development-workflow/tests/test-protocol-91-readiness-checklist.sh` |
| Sample implementation branch | `feature/smoke-65-example` (disposable) |
| Sample evidence keys | `POST_CLEAN_SETTLED=1`, `POST_CLEAN_HEAD_SHA`, `POST_CLEAN_RECHECK=1`, `LOCAL_AI_CONFIGURED=0` |

---

## Smoke Test Steps

### Step 1: Run Automated Checklist Tests

**Maps to**: Acceptance Criteria 5

1. Run `bash scripts/development-workflow/tests/test-pr-label-readiness-checklist.sh`.
2. Confirm the output reports passing cases for CI-not-green, draft PR, regression
   label recovery path, unsettled verdict, and successful preconditions (fixture mode).

**Expected result**: The harness exits `0` and names the required scenarios.

### Step 2: Run Protocol Regression Harness

**Maps to**: Acceptance Criteria 6

1. Run `bash scripts/development-workflow/tests/test-protocol-91-readiness-checklist.sh`.
2. Confirm GraphQL brace-balance and bash syntax checks target the extracted script
   (or a thin protocol wrapper), not a multi-hundred-line inline fence.

**Expected result**: Harness exits `0`.

### Step 3: Verify Script Help and Exit-Code Documentation

**Maps to**: Acceptance Criteria 1, 3

1. Run `bash scripts/development-workflow/pr-label-readiness-checklist.sh --help`.
2. Open Protocol 91 Step 8a and confirm the exit-code table remains authoritative
   and the protocol instructs runners to invoke the script.

**Expected result**: Help lists PR number, branch, evidence options, and points to
Protocol 91 for exit codes 0–12.

### Step 4: Evidence File Head Binding (Fixture)

**Maps to**: Acceptance Criteria 4

1. Create a temporary evidence file with `POST_CLEAN_HEAD_SHA` set to a SHA that
   does not match the fixture/live PR head.
2. Run the checklist in fixture or dry-run mode with `--evidence-file`.
3. Repeat with a matching head SHA and settled fields.

**Expected result**: Stale SHA exits `12`; matching SHA allows the success path
when other gates pass.

### Step 5: Optional Live PR Dry Run

**Maps to**: Acceptance Criteria 2

1. On a draft documentation-stage or implementation PR that has completed Step 7
   and Step 8, export Step 7 telemetry to a file.
2. Run:
   `bash scripts/development-workflow/pr-label-readiness-checklist.sh <pr> --branch <head-branch> --evidence-file <file>`
3. Do not apply readiness manually if the script exits non-zero.

**Expected result**: Exit code and messages match the pre-extraction inline checklist
behavior for the same PR state.

---

## Pass Criteria

- [ ] Both automated harnesses pass locally.
- [ ] Protocol 91 no longer requires copying the inline checklist block.
- [ ] Evidence file binding refuses stale heads.
- [ ] Optional live PR run matches prior Step 8a outcomes for the same state.
