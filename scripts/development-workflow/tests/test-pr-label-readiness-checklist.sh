#!/usr/bin/env bash
# test-pr-label-readiness-checklist.sh - Fixture tests for Step 8a checklist script.
#
# covers: scripts/development-workflow/pr-label-readiness-checklist.sh

set -uo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(CDPATH='' cd -- "$SCRIPT_DIR/../../.." && pwd)"
HELPER="$REPO_ROOT/scripts/development-workflow/pr-label-readiness-checklist.sh"

TMP_ROOT="$(mktemp -d)"
MOCK_BIN="$TMP_ROOT/bin"
mkdir -p "$MOCK_BIN"
trap 'rm -rf "$TMP_ROOT"' EXIT

PASS_COUNT=0
FAIL_COUNT=0
LAST_RUN_OUTPUT=""

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

run_expect_status() {
  local name="$1"
  local expected_status="$2"
  shift 2
  local output status=0
  set +e
  output="$(PATH="$MOCK_BIN:$PATH" "$@" 2>&1)"
  status=$?
  if [ "$status" -ne "$expected_status" ]; then
    echo "FAIL: $name - expected status ${expected_status}, got ${status}" >&2
    printf '%s\n' "$output" | sed 's/^/  /' >&2
    FAIL_COUNT=$((FAIL_COUNT + 1))
    LAST_RUN_OUTPUT="$output"
    printf '%s\n' "$output"
    return
  fi
  echo "PASS: $name" >&2
  PASS_COUNT=$((PASS_COUNT + 1))
  LAST_RUN_OUTPUT="$output"
  printf '%s\n' "$output"
}

# The internal-review-gate freshness guard (Check 3.8) resolves the gate and
# head SHAs as real commits, so the fixture head is this checkout's HEAD.
HEAD_SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"
# REST check-run pages, the shape latest_check_runs_for_sha reads.
GREEN_CHECKS_PAGE='[{"total_count":1,"check_runs":[{"id":1,"name":"ShellCheck","status":"completed","conclusion":"success","started_at":"2026-01-01T00:00:00Z","check_suite":{"id":1}}]}]'
FAILING_CHECKS_PAGE='[{"total_count":1,"check_runs":[{"id":1,"name":"ShellCheck","status":"completed","conclusion":"failure","started_at":"2026-01-01T00:00:00Z","check_suite":{"id":1}}]}]'
EMPTY_CHECKS_PAGE='[{"total_count":0,"check_runs":[]}]'
CLEAN_COMMENTS='{"comments":[{"body":"Automated Reviewer Loop Summary\nResult: clean","createdAt":"2026-01-01T00:00:00Z"}]}'

make_gh() {
  cat > "$MOCK_BIN/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail
jq_filter=""
prev=""
for arg in "$@"; do
  [ "$prev" = "--jq" ] && jq_filter="$arg"
  prev="$arg"
done
emit_jq() {
  local payload="$1"
  if [ -n "$jq_filter" ]; then
    printf '%s\n' "$payload" | jq -r "$jq_filter"
  else
    printf '%s\n' "$payload"
  fi
}
case "$*" in
  *"auth status"*) exit 0 ;;
  *"repo view"*"nameWithOwner"*)
    emit_jq '{"nameWithOwner":"owner/repo"}'
    exit 0
    ;;
  *"pr view"*"headRefOid"*)
    emit_jq "{\"headRefOid\":\"${MOCK_HEAD_SHA:?MOCK_HEAD_SHA is not set}\"}"
    exit 0
    ;;
  *"pr view"*"isDraft"*)
    emit_jq "{\"isDraft\":${MOCK_IS_DRAFT:-false}}"
    exit 0
    ;;
  *"pr view"*"comments"*)
    # The live --jq filter returns the latest summary body string, not JSON.
    if [[ "$jq_filter" == *"Step 7a Internal Review Gate Summary"* ]]; then
      # Check 3.8 reads the latest Step 7a gate summary body.
      printf '%s\n' "### Step 7a Internal Review Gate Summary

**Verdict**: APPROVED
**Gate-approved commit**: \`${MOCK_GATE_SHA:-$MOCK_HEAD_SHA}\`"
    elif [ -n "$jq_filter" ]; then
      printf '%s\n' "Automated Reviewer Loop Summary
Result: clean"
    else
      emit_jq "${MOCK_COMMENTS_JSON:-{\"comments\":[]}}"
    fi
    exit 0
    ;;
  *"pr view"*"labels"*)
    if [ -n "${MOCK_LABELS+set}" ]; then
      printf '%s\n' "$MOCK_LABELS"
    else
      printf '%s\n' "ready-for-regression"
    fi
    exit 0
    ;;
  *"pr view"*"body"*)
    emit_jq '{"body":"Implementation PR body"}'
    exit 0
    ;;
  *"pr view"*"headRefName"*)
    # Also answers pr-ownership-guard.sh (head branch + head repository).
    emit_jq "{\"number\":42,\"headRefName\":\"${MOCK_HEAD_BRANCH:-feature/test}\",\"baseRefName\":\"develop\",\"title\":\"test\",\"headRepositoryOwner\":{\"login\":\"owner\"},\"headRepository\":{\"name\":\"repo\"},\"isCrossRepository\":false}"
    exit 0
    ;;
  *"pr diff"*)
    printf 'src/example.ts\n'
    exit 0
    ;;
  *"issues/"*"/comments"*)
    emit_jq '[]'
    exit 0
    ;;
  *graphql*)
    if [[ "$*" == *reviewThreads* ]]; then
      payload="${MOCK_THREADS_GRAPHQL:-{\"data\":{\"repository\":{\"pullRequest\":{\"reviewThreads\":{\"nodes\":[]}}}}}}"
      if [ -n "$jq_filter" ]; then
        emit_jq "$payload"
      else
        printf '%s\n' "$payload"
      fi
      exit 0
    fi
    echo "unexpected graphql query" >&2
    exit 1
    ;;
  *"/check-runs"*)
    if [ -z "${MOCK_CHECK_RUN_PAGES:-}" ]; then
      echo "MOCK_CHECK_RUN_PAGES is not set" >&2
      exit 1
    fi
    printf '%s\n' "$MOCK_CHECK_RUN_PAGES"
    exit 0
    ;;
  *"/actions/runs"*)
    printf '%s\n' '[{"workflow_runs":[]}]'
    exit 0
    ;;
  *"/status"*)
    printf '%s\n' '[{"state":"success","statuses":[]}]'
    exit 0
    ;;
  *"pr edit"*) exit 0 ;;
  *"pr comment"*) exit 0 ;;
  *"api -X PATCH"*) exit 0 ;;
esac
printf 'unexpected gh: %s\n' "$*" >&2
exit 1
GH
  chmod +x "$MOCK_BIN/gh"
}

make_gh

SUCCESS_EVIDENCE="$TMP_ROOT/success.env"
cat > "$SUCCESS_EVIDENCE" <<EOF
POST_CLEAN_RECHECK=1
POST_CLEAN_SETTLED=1
POST_CLEAN_HEAD_SHA=$HEAD_SHA
LOCAL_AI_CONFIGURED=0
REVIEWER_LOOP_SKIPPED_NO_PLATFORMS=false
EOF

STALE_EVIDENCE="$TMP_ROOT/stale.env"
cat > "$STALE_EVIDENCE" <<EOF
POST_CLEAN_RECHECK=1
POST_CLEAN_SETTLED=1
POST_CLEAN_HEAD_SHA=bbbb2220000000000000000000000000000000b
LOCAL_AI_CONFIGURED=0
EOF

echo ""
echo "=== pr-label-readiness-checklist.sh ==="

run_expect_status "success_path_exit_0" 0 \
  env MOCK_HEAD_SHA="$HEAD_SHA" MOCK_CHECK_RUN_PAGES="$GREEN_CHECKS_PAGE" MOCK_COMMENTS_JSON="$CLEAN_COMMENTS" MOCK_LABELS="ready-for-regression" \
  bash "$HELPER" 42 --branch feature/test --repo owner/repo --evidence-file "$SUCCESS_EVIDENCE" --no-label-mutation --repo-root "$REPO_ROOT" >/dev/null
run_test "success_emits_readiness_head_sha" "READINESS_HEAD_SHA=$HEAD_SHA" "$(grep '^READINESS_HEAD_SHA=' <<<"$LAST_RUN_OUTPUT" || true)"

run_expect_status "draft_pr_exit_1" 1 \
  env MOCK_HEAD_SHA="$HEAD_SHA" MOCK_IS_DRAFT=true MOCK_CHECK_RUN_PAGES="$GREEN_CHECKS_PAGE" MOCK_COMMENTS_JSON="$CLEAN_COMMENTS" MOCK_LABELS="ready-for-regression" \
  bash "$HELPER" 42 --branch feature/test --repo owner/repo --evidence-file "$SUCCESS_EVIDENCE" --no-label-mutation --repo-root "$REPO_ROOT" >/dev/null

run_expect_status "ci_failing_exit_5" 5 \
  env MOCK_HEAD_SHA="$HEAD_SHA" MOCK_CHECK_RUN_PAGES="$FAILING_CHECKS_PAGE" MOCK_COMMENTS_JSON="$CLEAN_COMMENTS" MOCK_LABELS="ready-for-regression" \
  bash "$HELPER" 42 --branch feature/test --repo owner/repo --evidence-file "$SUCCESS_EVIDENCE" --no-label-mutation --repo-root "$REPO_ROOT" >/dev/null

run_expect_status "no_checks_exit_5" 5 \
  env MOCK_HEAD_SHA="$HEAD_SHA" MOCK_CHECK_RUN_PAGES="$EMPTY_CHECKS_PAGE" MOCK_COMMENTS_JSON="$CLEAN_COMMENTS" MOCK_LABELS="ready-for-regression" \
  bash "$HELPER" 42 --branch feature/test --repo owner/repo --evidence-file "$SUCCESS_EVIDENCE" --no-label-mutation --repo-root "$REPO_ROOT" >/dev/null

run_expect_status "missing_regression_label_exit_2" 2 \
  env MOCK_HEAD_SHA="$HEAD_SHA" MOCK_CHECK_RUN_PAGES="$GREEN_CHECKS_PAGE" MOCK_COMMENTS_JSON="$CLEAN_COMMENTS" MOCK_LABELS="" \
  bash "$HELPER" 42 --branch feature/test --repo owner/repo --evidence-file "$SUCCESS_EVIDENCE" --no-label-mutation --repo-root "$REPO_ROOT" >/dev/null

run_expect_status "unsettled_verdict_exit_12" 12 \
  env MOCK_HEAD_SHA="$HEAD_SHA" MOCK_CHECK_RUN_PAGES="$GREEN_CHECKS_PAGE" MOCK_COMMENTS_JSON="$CLEAN_COMMENTS" MOCK_LABELS="ready-for-regression" \
  bash "$HELPER" 42 --branch feature/test --repo owner/repo --no-label-mutation --repo-root "$REPO_ROOT" >/dev/null

run_expect_status "stale_post_clean_head_exit_12" 12 \
  env MOCK_HEAD_SHA="$HEAD_SHA" MOCK_CHECK_RUN_PAGES="$GREEN_CHECKS_PAGE" MOCK_COMMENTS_JSON="$CLEAN_COMMENTS" MOCK_LABELS="ready-for-regression" \
  bash "$HELPER" 42 --branch feature/test --repo owner/repo --evidence-file "$STALE_EVIDENCE" --no-label-mutation --repo-root "$REPO_ROOT" >/dev/null

# The PR number belongs to another branch: nothing may be changed (#1444).
run_expect_status "pr_not_owned_exit_14" 14 \
  env MOCK_HEAD_SHA="$HEAD_SHA" MOCK_HEAD_BRANCH="feature/other" MOCK_CHECK_RUN_PAGES="$GREEN_CHECKS_PAGE" MOCK_COMMENTS_JSON="$CLEAN_COMMENTS" MOCK_LABELS="ready-for-regression" \
  bash "$HELPER" 42 --branch feature/test --repo owner/repo --evidence-file "$SUCCESS_EVIDENCE" --no-label-mutation --repo-root "$REPO_ROOT" >/dev/null

run_fails_contains() {
  local name="$1"
  local expected="$2"
  shift 2
  local output status=0
  set +e
  output="$(PATH="$MOCK_BIN:$PATH" "$@" 2>&1)"
  status=$?
  set -e
  if [ "$status" -ne 0 ] && grep -Fq -- "$expected" <<< "$output"; then
    echo "PASS: $name"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "FAIL: $name - expected failure containing '${expected}' (status=${status})"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

run_fails_contains "requires_branch_flag" "--branch is required" \
  bash "$HELPER" 42 --repo owner/repo --repo-root "$REPO_ROOT"

echo ""
echo "${PASS_COUNT} passed, ${FAIL_COUNT} failed"
if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
