#!/usr/bin/env bash
# test-workflow-lib-repo-root-sourcing.sh — repo-root resolution when sourcing workflow-lib.
#
# Covers issue #66: workflow_repo_root must fail closed when sourced from zsh
# (BASH_SOURCE unavailable) instead of resolving to the filesystem root.
#
# Usage: bash scripts/development-workflow/tests/test-workflow-lib-repo-root-sourcing.sh
# covers: scripts/development-workflow/workflow-lib.sh

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../../.." && pwd)"
LIB_PATH="$REPO_ROOT/scripts/development-workflow/workflow-lib.sh"

PASS_COUNT=0
FAIL_COUNT=0

run_test() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [ "$actual" = "$expected" ]; then
    echo "PASS: $name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL: $name - expected '${expected}', got '${actual}'"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

run_exit() {
  local name="$1"
  local expected="$2"
  shift 2
  local status=0
  set +e
  "$@" >/dev/null 2>&1
  status=$?
  set -e
  if [ "$status" -eq "$expected" ]; then
    echo "PASS: $name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL: $name - expected exit ${expected}, got ${status}"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

run_stdout_empty_on_failure() {
  local name="$1"
  shift
  local stdout=""
  local stderr=""
  local status=0
  set +e
  stdout="$("$@" 2>/dev/null)"
  status=$?
  set -e
  if [ "$status" -ne 0 ] && [ -z "$stdout" ]; then
    echo "PASS: $name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL: $name - expected non-zero exit and empty stdout"
    printf 'Status: %s\nStdout: %q\n' "$status" "$stdout"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

run_stderr_contains() {
  local name="$1"
  local needle="$2"
  shift 2
  local stderr=""
  local status=0
  set +e
  stderr="$("$@" 2>&1 >/dev/null)"
  status=$?
  set -e
  if grep -Fq -- "$needle" <<< "$stderr"; then
    echo "PASS: $name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL: $name - stderr missing '${needle}'"
    printf 'Status: %s\nStderr:\n%s\n' "$status" "$stderr"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

if [ ! -f "$REPO_ROOT/.ai-dev-workflow.yaml" ]; then
  echo "FAIL: expected workflow manifest at $REPO_ROOT/.ai-dev-workflow.yaml"
  exit 1
fi

if ! command -v zsh >/dev/null 2>&1; then
  echo "SKIP: zsh not available — repo-root sourcing tests require zsh"
  exit 0
fi

zsh_repo_root() {
  zsh -c "source '$LIB_PATH'; workflow_repo_root"
}

zsh_config_exists() {
  zsh -c "source '$LIB_PATH'; workflow_config_exists"
}

bash_repo_root() {
  bash -c "source '$LIB_PATH'; workflow_repo_root"
}

run_stderr_contains \
  "zsh sourcing surfaces BASH_SOURCE guidance" \
  "BASH_SOURCE[0] is unset" \
  zsh_repo_root

run_stdout_empty_on_failure \
  "zsh workflow_repo_root fails closed without printing a path" \
  zsh_repo_root

run_test \
  "zsh workflow_repo_root must not return filesystem root" \
  "not-slash" \
  "$(
    set +e
    out="$(zsh_repo_root 2>/dev/null)"
    set -e
    if [ "$out" = "/" ]; then printf '%s' "slash"; else printf '%s' "not-slash"; fi
  )"

run_exit \
  "zsh workflow_config_exists is false when root resolution failed" \
  1 \
  zsh_config_exists

resolved="$(bash_repo_root)"
run_test \
  "bash workaround resolves repo root to checkout" \
  "$(CDPATH='' cd -- "$REPO_ROOT" && pwd -P)" \
  "$resolved"

# shellcheck source=scripts/development-workflow/workflow-lib.sh
source "$LIB_PATH"
run_test \
  "bash script sourcing resolves repo root to checkout" \
  "$(CDPATH='' cd -- "$REPO_ROOT" && pwd -P)" \
  "$(workflow_repo_root)"

echo ""
echo "Results: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
