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
# The dedupe lives in workflow-lib.sh (latest_check_runs_for_sha); the script
# must use it rather than carry its own copy.
if grep -q 'latest_check_runs_for_sha "$REPO" "$HEAD_SHA"' "$CHECKLIST" &&
   ! grep -q '__check_key' "$CHECKLIST"; then
  _dedupes_check_runs="yes"
else
  _dedupes_check_runs="no"
fi
run_test "step_8a_dedupes_check_runs_by_key" "yes" "$_dedupes_check_runs"

# Runnable gates derive owner/repo from TARGET_REPO in the extracted script.
_uses_derived_owner="$(grep -c -- '-f owner="\$GRAPHQL_OWNER" -f repo="\$GRAPHQL_REPO"' "$CHECKLIST" || true)"
run_test "checklist_script_passes_derived_owner_repo" "1" "$_uses_derived_owner"
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

# --- 4. Planted-violation proof (REVIEW.md) ---------------------------------
# An extra closing brace in a GraphQL query must fail check 1; the real protocol
# (checked above as graphql_queries_brace_balanced) is the pass direction.
_PLANT_TMP="$(mktemp -d)"
_PLANT_PROTOCOL="$_PLANT_TMP/protocol-91-planted.md"
cp "$PROTOCOL" "$_PLANT_PROTOCOL"
python3 - "$_PLANT_PROTOCOL" <<'PY'
import re
import sys

path = sys.argv[1]
text = open(path, encoding="utf-8").read()
pattern = re.compile(r"(gh api graphql -f query='(?P<query>[^']*)')")
match = pattern.search(text)
if not match:
    raise SystemExit("planted-protocol: no graphql query found")
broken = match.group("query") + "}"
text = text[: match.start("query")] + broken + text[match.end("query") :]
open(path, "w", encoding="utf-8").write(text)
PY

_planted_balance="$(python3 - "$_PLANT_PROTOCOL" <<'PY'
import re
import sys

text = open(sys.argv[1], encoding="utf-8").read()
pattern = re.compile(r"gh api graphql -f query='(?P<query>[^']*)'")
bad = []
count = 0
for match in pattern.finditer(text):
    count += 1
    query = match.group("query")
    depth = 0
    lowest = 0
    for char in query:
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            lowest = min(lowest, depth)
    if depth != 0 or lowest < 0:
        bad.append("unbalanced")
if count == 0:
    print("no-graphql-queries-found")
elif bad:
    print("unbalanced")
else:
    print("balanced")
PY
)"
run_test "planted_graphql_extra_brace_fails" "unbalanced" "$_planted_balance"
rm -rf "$_PLANT_TMP"
unset _PLANT_TMP _PLANT_PROTOCOL _planted_balance

echo ""
# --- 9. Execute the actual Protocol 91 ready-transition preflight ------------
# Execute the shipped fenced block with isolated loop/ownership/GitHub mocks.
# The loop telemetry is authoritative; a checkout config must not replace it.
_ready_transition_report="$(python3 - "$PROTOCOL" <<'PYTEST'
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

protocol = Path(sys.argv[1]).read_text(encoding="utf-8")
section = protocol.split("<!-- protocol-91-ready-transition:start -->", 1)[1].split(
    "<!-- protocol-91-ready-transition:end -->", 1
)[0]
snippet = re.search(r"```bash\n(.*?)\n```", section, re.S).group(1)
snippet = snippet.replace("PR_NUMBER=<pr_number>", "PR_NUMBER=1864").replace(
    "BRANCH=<branch_name>", "BRANCH=fix/1864-draft-ready-preflight"
)
head = "a" * 40
other = "b" * 40
cases = [
    ("clean", True), ("blocked", False), ("missing", False),
    ("duplicate", False), ("malformed", False), ("stale", False),
    ("moved", False), ("missing-mode", False), ("wrong-mode", False),
    ("nonzero", False), ("head-failed", False), ("empty-head", False),
    ("ownership-failed", False), ("skipped-configured", False),
    ("skipped-empty", True), ("skipped-wrong-reason", False),
    ("no-ready", True), ("no-ready-resume", True), ("full-failed", False),
    ("no-ready-unknown-state", False), ("no-ready-blocked", False),
    ("equals-result", False), ("equals-mode", False), ("duplicate-head", False),
    ("missing-ready", False), ("malformed-ready", False), ("duplicate-ready", False),
    ("missing-count", False), ("malformed-count", False), ("duplicate-count", False),
    ("base-ready-checkout-empty", True), ("base-empty-checkout-ready", True),
    ("skipped-empty-no-ready", True), ("no-ready-ownership-changed", False),
    ("hotfix-skip", True), ("release-skip", True), ("fix-release-skip", False),
    ("hotfix-wrong-branch", False), ("hotfix-wrong-pr", False),
    ("hotfix-duplicate-pr", False),
]

def run_case(root, name, code=snippet):
    if name.startswith("hotfix-"):
        code = code.replace("BRANCH=fix/1864-draft-ready-preflight", "BRANCH=hotfix/1864-draft-ready-preflight")
    elif name == "release-skip":
        code = code.replace("BRANCH=fix/1864-draft-ready-preflight", "BRANCH=release/v1.0.0")
    trace = root / "trace"
    trace.write_text("")
    # Deliberately conflicting checkout policy: the loop has already resolved
    # the PR-base policy and is the only source for ready ownership.
    (root / ".ai-dev-workflow.yaml").write_text(
        "review:\n  on_ready:\n    github: " + (
            "[local-ai-reviewer]\n" if name == "base-empty-checkout-ready" else "[]\n"
        )
    )
    env = dict(os.environ, PATH=f"{root / 'bin'}:{os.environ['PATH']}",
               TEST_TRACE=str(trace), TEST_CASE=name)
    result = subprocess.run(["bash", "-c", code], cwd=root, env=env,
                            text=True, capture_output=True)
    return result.returncode, trace.read_text().splitlines(), result.stdout

with tempfile.TemporaryDirectory(prefix="protocol91-ready-") as directory:
    root = Path(directory)
    scripts = root / "scripts/development-workflow"
    scripts.mkdir(parents=True)
    (root / "bin").mkdir()
    files = {
        scripts / "pr-ownership-guard.sh": '''#!/usr/bin/env bash
[[ "$TEST_CASE" != ownership-failed ]] || exit 1
if [[ "$TEST_CASE" == no-ready-ownership-changed ]] && grep -q '^draft$' "$TEST_TRACE"; then exit 1; fi
''',
        root / "bin/gh": f'''#!/usr/bin/env bash
if [[ "$1 $2" == "pr ready" ]]; then
  echo manual-ready >> "$TEST_TRACE"
  exit 0
fi
if [[ " $* " == *" --json isDraft "* ]]; then
  case "$TEST_CASE" in
    no-ready-resume) echo false ;;
    no-ready-unknown-state) echo null ;;
    *) echo true ;;
  esac
  exit 0
fi
if [[ "$TEST_CASE" == head-failed ]]; then exit 1; fi
if [[ "$TEST_CASE" == empty-head ]]; then echo ""; exit 0; fi
if [[ "$TEST_CASE" == moved ]] && grep -q '^draft$' "$TEST_TRACE"; then
  echo {other}
else
  echo {head}
fi
''',
        scripts / "pr-review-loop.sh": f'''#!/usr/bin/env bash
if [[ " $* " != *" --draft-github-only "* ]]; then
  echo full >> "$TEST_TRACE"
  [[ "$TEST_CASE" != full-failed ]]
  exit $?
fi
echo draft >> "$TEST_TRACE"
case "$TEST_CASE" in
  hotfix-*|release-skip|fix-release-skip)
    printf 'RESULT=skipped\\nREASON=release_pr\\n'
    case "$TEST_CASE" in
      hotfix-wrong-pr) echo PR_NUMBER=999 ;;
      hotfix-duplicate-pr) printf 'PR_NUMBER=999\\nPR_NUMBER=1864\\n' ;;
      *) echo PR_NUMBER=1864 ;;
    esac
    if [[ "$TEST_CASE" == hotfix-wrong-branch ]]; then
      echo BRANCH=hotfix/other
    else
      echo "BRANCH=$3"
    fi
    exit 0
    ;;
esac
if [[ "$TEST_CASE" == nonzero ]]; then
  printf 'RESULT=escalate\\nREASON=rate_limited\\nRATE_LIMIT_RESET=1791640778\\n'
  exit 2
fi
case "$TEST_CASE" in
  missing-mode) ;;
  wrong-mode) echo DRAFT_GITHUB_ONLY=0 ;;
  equals-mode) echo DRAFT_GITHUB_ONLY=1=invalid ;;
  *) echo DRAFT_GITHUB_ONLY=1 ;;
esac
case "$TEST_CASE" in
  missing-ready) ;;
  malformed-ready) echo READY_PHASE_ENABLED=1=invalid ;;
  duplicate-ready) printf 'READY_PHASE_ENABLED=0\\nREADY_PHASE_ENABLED=1\\n' ;;
  no-ready*|base-empty-checkout-ready|skipped-empty-no-ready) echo READY_PHASE_ENABLED=0 ;;
  *) echo READY_PHASE_ENABLED=1 ;;
esac
case "$TEST_CASE" in
  missing-count) ;;
  malformed-count) echo PLATFORM_COUNT=one ;;
  duplicate-count) printf 'PLATFORM_COUNT=1\\nPLATFORM_COUNT=1\\n' ;;
  skipped-empty*) echo PLATFORM_COUNT=0 ;;
  *) echo PLATFORM_COUNT=1 ;;
esac
case "$TEST_CASE" in
  blocked|no-ready-blocked) echo RESULT=needs_fixes ;;
  missing) ;;
  duplicate) printf 'RESULT=clean\\nRESULT=clean\\n' ;;
  malformed) echo RESULT=clean-extra ;;
  equals-result) echo RESULT=clean=invalid ;;
  skipped-wrong-reason) printf 'RESULT=skipped\\nREASON=unavailable\\n' ;;
  skipped-*) printf 'RESULT=skipped\\nREASON=not_configured\\n' ;;
  *) echo RESULT=clean ;;
esac
if [[ "$TEST_CASE" == stale ]]; then
  echo POST_CLEAN_HEAD_SHA={other}
else
  [[ "$TEST_CASE" != duplicate-head ]] || echo POST_CLEAN_HEAD_SHA={other}
  echo POST_CLEAN_HEAD_SHA={head}
fi
''',
    }
    for path, content in files.items():
        path.write_text(content)
        path.chmod(0o755)
    for name, allowed in cases:
        rc, trace, output = run_case(root, name)
        if name in {"no-ready", "base-empty-checkout-ready", "skipped-empty-no-ready", "hotfix-skip", "release-skip"}:
            expected = ["draft", "manual-ready", "full"]
        elif allowed or name == "full-failed":
            expected = ["draft", "full"]
        elif name in {"ownership-failed", "head-failed", "empty-head"}:
            expected = []
        else:
            expected = ["draft"]
        assert (rc == 0) == allowed, (name, rc, trace, output)
        assert trace == expected, (name, expected, trace)
        if name == "nonzero":
            assert "REASON=rate_limited" in output and "RATE_LIMIT_RESET=1791640778" in output
        print(f"PASS: ready_transition_{name}", file=sys.stderr)
    # Plant premature conversion at the exact draft-loop invocation line.
    plant = snippet.replace('DRAFT_GATE_OUTPUT=$(', 'gh pr ready "$PR_NUMBER"\nDRAFT_GATE_OUTPUT=$(', 1)
    assert plant != snippet
    rc, trace, _ = run_case(root, "clean", plant)
    assert rc == 0 and trace != ["draft", "full"] and "manual-ready" in trace
    print("PASS: ready_transition_premature_conversion_plant_rejected", file=sys.stderr)
    rc, trace, _ = run_case(root, "clean")
    assert rc == 0 and trace == ["draft", "full"]
    print("PASS: ready_transition_plant_removed_passes", file=sys.stderr)
print(f"verified:{len(cases) + 2}")
PYTEST
)"
run_test "ready_transition_executable_matrix_and_plant" "verified:42" "$_ready_transition_report"


echo "${PASS_COUNT} passed, ${FAIL_COUNT} failed"

if [ "$FAIL_COUNT" -ne 0 ]; then
  exit 1
fi
