#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/development-workflow/check-tracker-merge-mapping.sh"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

run_with_workflow() {
  local workflow_file="$1"
  local config_file="${2:-}"
  if [ -n "$config_file" ]; then
    WORKFLOW_FILE_OVERRIDE="$workflow_file" AI_DEV_WORKFLOW_CONFIG_FILE="$config_file" bash "$SCRIPT"
  else
    WORKFLOW_FILE_OVERRIDE="$workflow_file" bash "$SCRIPT"
  fi
}

linear_config="$TMP_DIR/linear.yaml"
cat > "$linear_config" <<'YAML'
schema_version: 2
issue_tracker:
  provider: linear
YAML

missing_output="$(run_with_workflow "$TMP_DIR/missing-update-tracker-on-merge.yml" "$linear_config")" \
  || fail "missing workflow should be skipped successfully for non-GitHub providers"
grep -q '^SKIP: workflow file not found:' <<< "$missing_output" \
  || fail "missing workflow output should explain the skip"
grep -q 'Non-GitHub tracker providers intentionally omit update-tracker-on-merge.yml' <<< "$missing_output" \
  || fail "missing workflow output should identify non-GitHub tracker providers"

github_config="$TMP_DIR/github-projects.yaml"
cat > "$github_config" <<'YAML'
schema_version: 2
issue_tracker:
  provider: github_projects
YAML

github_missing_exit=0
github_missing_output="$(run_with_workflow "$TMP_DIR/missing-update-tracker-on-merge.yml" "$github_config" 2>&1)" \
  || github_missing_exit=$?
[ "$github_missing_exit" -eq 1 ] \
  || fail "missing workflow should fail closed for GitHub-based tracker providers"
grep -q "GitHub-based tracker provider 'github_projects' requires update-tracker-on-merge.yml" <<< "$github_missing_output" \
  || fail "missing GitHub workflow output should explain the required workflow"

github_hyphen_config="$TMP_DIR/github-projects-hyphen.yaml"
cat > "$github_hyphen_config" <<'YAML'
schema_version: 2
issue_tracker:
  provider: github-projects
YAML

github_hyphen_missing_exit=0
github_hyphen_missing_output="$(run_with_workflow "$TMP_DIR/missing-update-tracker-on-merge.yml" "$github_hyphen_config" 2>&1)" \
  || github_hyphen_missing_exit=$?
[ "$github_hyphen_missing_exit" -eq 1 ] \
  || fail "missing workflow should fail closed for hyphenated GitHub tracker providers"
grep -q "GitHub-based tracker provider 'github_projects' requires update-tracker-on-merge.yml" <<< "$github_hyphen_missing_output" \
  || fail "hyphenated GitHub workflow output should identify the normalized provider"

# Issue #125 implements-check wiring, appended to every fixture that should
# otherwise pass (steps are the last list in each fixture's job).
write_implements_steps() {
  # $1 = destination (appended), $2 = "gated" | "close-ungated" |
  #   "status-ungated" | "no-check" | "no-id" | "no-script" | "no-body"
  local dest="$1" variant="${2:-gated}"
  local check_id="        id: implements"
  local check_env="          PR_BODY: \${{ github.event.pull_request.body }}"
  local check_run="        run: python3 scripts/development-workflow/tracker-merge-implements-issue.py --issue 1 --repo o/r"
  [ "$variant" = "no-id" ] && check_id="        id: decide"
  [ "$variant" = "no-body" ] && check_env="          PR_BODY: \${{ github.event.pull_request.title }}"
  [ "$variant" = "no-script" ] && check_run="        run: echo implements=true >> \"\$GITHUB_OUTPUT\""
  local close_if="        if: steps.implements.outputs.implements == 'true'"
  local status_if="$close_if"
  [ "$variant" = "close-ungated" ] && close_if="        if: steps.detect.outputs.branch_type == 'impl'"
  [ "$variant" = "status-ungated" ] && status_if="        if: steps.detect.outputs.branch_type != 'graduation'"
  if [ "$variant" != "no-check" ]; then
    cat >> "$dest" <<YAML
      - name: Check the PR declares it implements the issue
${check_id}
        env:
${check_env}
${check_run}
YAML
  fi
  cat >> "$dest" <<YAML
      - name: Close issue for impl branches
${close_if}
        run: gh issue close 1
      - name: Update GitHub Projects status after close
${status_if}
        run: echo update
YAML
}

valid_workflow="$TMP_DIR/update-tracker-on-merge.yml"
touch "$valid_workflow"
cat > "$valid_workflow" <<'YAML'
name: Update tracker on merge

on:
  pull_request:
    types: [closed]

permissions:
  contents: read
  pull-requests: read
  issues: write

jobs:
  update-tracker:
    runs-on: ubuntu-latest
    steps:
      - name: Detect branch type
        run: |
          if [[ "$BRANCH" == spec/* ]]; then
            TARGET_STATUS="Spec Ready"
          elif [[ "$BRANCH" == implementation-plan/* ]]; then
            TARGET_STATUS="Plan Ready"
          elif [[ "$BRANCH" == feature/* || "$BRANCH" == fix/* || "$BRANCH" == refactor/* || "$BRANCH" == hotfix/* ]]; then
            TARGET_STATUS="Merged"
          elif [[ "$BRANCH" == develop-* ]]; then
            BRANCH_TYPE="graduation"
          fi
      - name: Checkout repository for graduation closeout
        uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd  # v5
      - name: Run graduation closeout fallback
        run: ./scripts/development-workflow/graduation-closeout-from-merged-pr.sh --graduation-pr 1
YAML
write_implements_steps "$valid_workflow"

valid_output="$(run_with_workflow "$valid_workflow")" \
  || fail "valid workflow mappings should pass"
grep -q 'All 6 mappings correct (+ graduation closeout fallback)\.' <<< "$valid_output" \
  || fail "valid workflow output should confirm all mappings and graduation fallback"
grep -q "OK: branch 'develop-\*' → graduation closeout fallback" <<< "$valid_output" \
  || fail "valid workflow output should acknowledge graduation closeout fallback"
grep -q 'OK: actions/checkout present with contents: read' <<< "$valid_output" \
  || fail "valid workflow output should confirm contents: read for checkout"
grep -q "OK: step 'Close issue for impl branches' is gated on the #125 implements-check" <<< "$valid_output" \
  || fail "valid workflow output should confirm the close step is gated (#125)"
for ok_line in "OK: implements-check step has id: implements" \
  "OK: implements-check step runs tracker-merge-implements-issue.py" \
  "OK: implements-check step reads github.event.pull_request.body" \
  "OK: step 'Update GitHub Projects status after close' is gated on the #125 implements-check"; do
  grep -qF "$ok_line" <<< "$valid_output" || fail "valid workflow output should include: ${ok_line}"
done

# Issue #125 planted violations: each must fail and name what is missing.
for variant in close-ungated status-ungated no-check no-id no-script no-body; do
  planted="$TMP_DIR/update-tracker-125-${variant}.yml"
  sed '/- name: Check the PR declares it implements the issue/,$d' "$valid_workflow" > "$planted"
  write_implements_steps "$planted" "$variant"
  planted_exit=0
  planted_output="$(run_with_workflow "$planted" 2>&1)" || planted_exit=$?
  [ "$planted_exit" -eq 1 ] || fail "#125 variant '${variant}' should fail the mapping check"
  case "$variant" in
    close-ungated) expected="step 'Close issue for impl branches' is not gated" ;;
    status-ungated) expected="step 'Update GitHub Projects status after close' is not gated" ;;
    no-check) expected="missing 'Check the PR declares it implements the issue' step" ;;
    no-id) expected="implements-check step lacks 'id: implements'" ;;
    no-script) expected="implements-check step does not run tracker-merge-implements-issue.py" ;;
    no-body) expected="implements-check step does not read github.event.pull_request.body" ;;
  esac
  grep -qF "$expected" <<< "$planted_output" \
    || fail "#125 variant '${variant}' should report: ${expected}"
  planted_125_errors="$(grep -c '^ERROR: .*(#125)' <<< "$planted_output" || true)"
  [ "$planted_125_errors" -eq 1 ] \
    || fail "#125 variant '${variant}' should report exactly one #125 error, got ${planted_125_errors}"
done

missing_contents_workflow="$TMP_DIR/update-tracker-missing-contents.yml"
cat > "$missing_contents_workflow" <<'YAML'
name: Update tracker on merge

on:
  pull_request:
    types: [closed]

permissions:
  pull-requests: read
  issues: write

jobs:
  update-tracker:
    runs-on: ubuntu-latest
    steps:
      - name: Detect branch type
        run: |
          if [[ "$BRANCH" == spec/* ]]; then
            TARGET_STATUS="Spec Ready"
          elif [[ "$BRANCH" == implementation-plan/* ]]; then
            TARGET_STATUS="Plan Ready"
          elif [[ "$BRANCH" == feature/* || "$BRANCH" == fix/* || "$BRANCH" == refactor/* || "$BRANCH" == hotfix/* ]]; then
            TARGET_STATUS="Merged"
          elif [[ "$BRANCH" == develop-* ]]; then
            BRANCH_TYPE="graduation"
          fi
      - name: Checkout repository for graduation closeout
        uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd  # v5
      - name: Run graduation closeout fallback
        run: ./scripts/development-workflow/graduation-closeout-from-merged-pr.sh --graduation-pr 1
YAML

missing_contents_exit=0
missing_contents_output="$(run_with_workflow "$missing_contents_workflow" 2>&1)" \
  || missing_contents_exit=$?
[ "$missing_contents_exit" -eq 1 ] \
  || fail "workflow with checkout but no contents: read should fail"
grep -q 'permissions lack contents: read' <<< "$missing_contents_output" \
  || fail "missing contents: read should explain the checkout permission requirement"

missing_graduation_workflow="$TMP_DIR/update-tracker-missing-graduation.yml"
cat > "$missing_graduation_workflow" <<'YAML'
name: Update tracker on merge

on:
  pull_request:
    types: [closed]

jobs:
  update-tracker:
    runs-on: ubuntu-latest
    steps:
      - name: Detect branch type
        run: |
          if [[ "$BRANCH" == spec/* ]]; then
            TARGET_STATUS="Spec Ready"
          elif [[ "$BRANCH" == implementation-plan/* ]]; then
            TARGET_STATUS="Plan Ready"
          elif [[ "$BRANCH" == feature/* || "$BRANCH" == fix/* || "$BRANCH" == refactor/* || "$BRANCH" == hotfix/* ]]; then
            TARGET_STATUS="Merged"
          fi
YAML

missing_graduation_exit=0
missing_graduation_output="$(run_with_workflow "$missing_graduation_workflow" 2>&1)" \
  || missing_graduation_exit=$?
[ "$missing_graduation_exit" -eq 1 ] \
  || fail "workflow without graduation fallback should fail"
grep -q 'expected graduation closeout fallback wiring' <<< "$missing_graduation_output" \
  || fail "missing graduation fallback should explain the required wiring"

# ---------------------------------------------------------------------------
# Tracker-configuration gate (issue #1715)
#
# Planted-violation proof, both directions: the check must FAIL when a step
# consuming secrets.GH_PROJECT_TOKEN is not gated on the configuration step,
# and PASS once the gate is restored.
# ---------------------------------------------------------------------------
write_gate_workflow() {
  # $1 = destination, $2 = "gated" | "ungated" | "no-gate-step" | "no-token"
  local dest="$1" variant="$2"
  local gate_if="" gate_step="" token_env="          GH_TOKEN: \${{ secrets.GH_PROJECT_TOKEN }}"

  [ "$variant" = "ungated" ] || gate_if="          steps.config.outputs.configured == 'true' &&"
  [ "$variant" = "no-token" ] && token_env="          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}"

  if [ "$variant" != "no-gate-step" ]; then
    gate_step="      - name: Check tracker configuration
        id: config
        env:
          PROJECT_TOKEN: \${{ secrets.GH_PROJECT_TOKEN }}
        run: |
          if [ -n \"\${PROJECT_TOKEN:-}\" ]; then
            echo \"configured=true\" >> \"\$GITHUB_OUTPUT\"
          else
            echo \"configured=false\" >> \"\$GITHUB_OUTPUT\"
          fi"
    [ "$variant" = "no-token" ] && gate_step="${gate_step//secrets.GH_PROJECT_TOKEN/secrets.GITHUB_TOKEN}"
  fi

  cat > "$dest" <<YAML
name: Update tracker on merge

on:
  pull_request:
    types: [closed]

permissions:
  contents: read
  pull-requests: read
  issues: write

jobs:
  update-tracker:
    runs-on: ubuntu-latest
    steps:
      - name: Detect branch type
        run: |
          if [[ "\$BRANCH" == spec/* ]]; then
            TARGET_STATUS="Spec Ready"
          elif [[ "\$BRANCH" == implementation-plan/* ]]; then
            TARGET_STATUS="Plan Ready"
          elif [[ "\$BRANCH" == feature/* || "\$BRANCH" == fix/* || "\$BRANCH" == refactor/* || "\$BRANCH" == hotfix/* ]]; then
            TARGET_STATUS="Merged"
          elif [[ "\$BRANCH" == develop-* ]]; then
            BRANCH_TYPE="graduation"
          fi
${gate_step}
      - name: Checkout repository for graduation closeout
        uses: actions/checkout@93cb6efe18208431cddfb8368fd83d5badbf9bfd  # v5
      - name: Run graduation closeout fallback
        if: >
${gate_if}
          true
        env:
${token_env}
        run: ./scripts/development-workflow/graduation-closeout-from-merged-pr.sh --graduation-pr 1
YAML
  write_implements_steps "$dest"
}

# Direction 1 — gate present: the check passes.
gated_workflow="$TMP_DIR/update-tracker-gated.yml"
write_gate_workflow "$gated_workflow" gated
gated_output="$(run_with_workflow "$gated_workflow")" \
  || fail "workflow with the configuration gate wired should pass"
grep -q 'OK: tracker-configuration gate step is present' <<< "$gated_output" \
  || fail "gated workflow output should confirm the gate step"
grep -q 'OK: every step consuming GH_PROJECT_TOKEN is gated on the configuration check' <<< "$gated_output" \
  || fail "gated workflow output should confirm every token consumer is gated"

# Direction 2 — plant the violation by removing the gate from the consuming
# step: the check must fail, and must name the offending step.
ungated_workflow="$TMP_DIR/update-tracker-ungated.yml"
write_gate_workflow "$ungated_workflow" ungated
ungated_exit=0
ungated_output="$(run_with_workflow "$ungated_workflow" 2>&1)" || ungated_exit=$?
[ "$ungated_exit" -eq 1 ] \
  || fail "workflow with an ungated GH_PROJECT_TOKEN consumer should fail"
grep -q "step 'Run graduation closeout fallback' consumes secrets.GH_PROJECT_TOKEN without gating" <<< "$ungated_output" \
  || fail "ungated workflow output should name the offending step"

# Direction 2b — plant the violation by deleting the gate step entirely while
# leaving the `if:` conditions in place.
no_gate_workflow="$TMP_DIR/update-tracker-no-gate-step.yml"
write_gate_workflow "$no_gate_workflow" no-gate-step
no_gate_exit=0
no_gate_output="$(run_with_workflow "$no_gate_workflow" 2>&1)" || no_gate_exit=$?
[ "$no_gate_exit" -eq 1 ] \
  || fail "workflow using GH_PROJECT_TOKEN without a gate step should fail"
grep -q "no 'id: config' gate step emitting configured=true/false" <<< "$no_gate_output" \
  || fail "missing gate step should explain the required gate"

# Fail-closed check: a workflow that never references the secret reports the
# gate as not applicable EXPLICITLY, rather than passing silently.
no_token_workflow="$TMP_DIR/update-tracker-no-token.yml"
write_gate_workflow "$no_token_workflow" no-token
no_token_output="$(run_with_workflow "$no_token_workflow")" \
  || fail "workflow without GH_PROJECT_TOKEN should still pass"
grep -q 'configuration gate not applicable' <<< "$no_token_output" \
  || fail "workflow without GH_PROJECT_TOKEN should say the gate is not applicable"

printf 'check tracker merge mapping tests passed\n'
