#!/usr/bin/env bash
# test-protocol-91-readiness-checklist.sh - Step 8a/8a.1 executable-snippet regression coverage.
#
# Step 8a Checks 0-4 live in pr-label-readiness-checklist.sh; protocol 91 keeps
# the invocation, exit-code table, infrastructure scan, and Step 8a.1 re-check.
#
# covers: scripts/development-workflow/pr-label-readiness-checklist.sh
# covers: docs/workflow/development-workflow/protocols/91-orchestrate-work-protocol.md

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
PROTOCOL="$REPO_ROOT/docs/workflow/development-workflow/protocols/91-orchestrate-work-protocol.md"
CHECKLIST="$REPO_ROOT/scripts/development-workflow/pr-label-readiness-checklist.sh"

PASS_COUNT=0
FAIL_COUNT=0

run_test() {
  local name="$1"
  local expected="$2"
  local actual="$3"

  if [ "$expected" = "$actual" ]; then
    echo "PASS: $name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL: $name - expected '$expected', got '$actual'"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

[ -f "$PROTOCOL" ] || { echo "FAIL: protocol 91 not found at $PROTOCOL"; exit 1; }
[ -f "$CHECKLIST" ] || { echo "FAIL: checklist script not found at $CHECKLIST"; exit 1; }

# --- 1. Every embedded GraphQL query is brace-balanced -----------------------
_balance_report="$(python3 - "$PROTOCOL" "$CHECKLIST" <<'PY'
import re
import sys

bad = []
count = 0
pattern = re.compile(r"gh api graphql -f query='(?P<query>[^']*)'")
for path in sys.argv[1:]:
    text = open(path, encoding="utf-8").read()
    for match in pattern.finditer(text):
        count += 1
        query = match.group("query")
        line = text.count("\n", 0, match.start()) + 1
        depth = 0
        lowest = 0
        for char in query:
            if char == "{":
                depth += 1
            elif char == "}":
                depth -= 1
                lowest = min(lowest, depth)
        if depth != 0 or lowest < 0:
            bad.append(f"{path}:{line}: net brace depth {depth}, minimum {lowest}")

if count == 0:
    print("no-graphql-queries-found")
elif bad:
    print("; ".join(bad))
else:
    print(f"balanced:{count}")
PY
)"
run_test "graphql_queries_brace_balanced" "balanced:3" "$_balance_report"

# --- 2. Protocol routes to script; checklist body not duplicated -------------
_invoke_count="$(grep -c 'pr-label-readiness-checklist.sh' "$PROTOCOL" || true)"
run_test "protocol_invokes_checklist_script" "1" "$( [ "$_invoke_count" -ge 1 ] && echo 1 || echo 0 )"

if grep -q 'NORMALIZED_CHECKS_JSON=' "$PROTOCOL"; then
  _inline_ci_dedupe_in_protocol="yes"
else
  _inline_ci_dedupe_in_protocol="no"
fi
run_test "protocol_has_no_inline_ci_dedupe_block" "no" "$_inline_ci_dedupe_in_protocol"

# --- 3. Extracted script normalizes stale duplicate check-runs ---------------
if grep -q 'NORMALIZED_CHECKS_JSON=' "$CHECKLIST" &&
   grep -q 'group_by(.__check_key)' "$CHECKLIST"; then
  _dedupes_check_runs="yes"
else
  _dedupes_check_runs="no"
fi
run_test "step_8a_dedupes_check_runs_by_key" "yes" "$_dedupes_check_runs"

# Runnable gates derive owner/repo from TARGET_REPO in the extracted script.
_uses_derived_owner="$(grep -c -- '-f owner="\$GRAPHQL_OWNER" -f repo="\$GRAPHQL_REPO"' "$CHECKLIST" || true)"
run_test "checklist_script_passes_derived_owner_repo" "3" "$_uses_derived_owner"
_derives_repo="$(grep -c 'GRAPHQL_REPO="${TARGET_REPO#\*/}"' "$CHECKLIST" || true)"
run_test "checklist_script_derives_repo_from_target_repo" "1" "$_derives_repo"

if grep -q 'TARGET_REPO=$(repo_slug)' "$CHECKLIST"; then
  _target_repo_defined="yes"
else
  _target_repo_defined="no"
fi
run_test "target_repo_resolved_in_checklist_script" "yes" "$_target_repo_defined"

# --- 4. The extracted checklist parses as bash --------------------------------
_syntax_error="$(bash -n "$CHECKLIST" 2>&1 || true)"
run_test "step_8a_checklist_parses_as_bash" "" "$_syntax_error"

echo ""
echo "${PASS_COUNT} passed, ${FAIL_COUNT} failed"

if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
