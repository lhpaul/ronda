#!/usr/bin/env bash
# pr-label-readiness-checklist.sh - Protocol 91 Step 8a label readiness checklist.
#
# See docs/workflow/development-workflow/protocols/91-orchestrate-work-protocol.md
# (Step 8a exit-code table).

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
# shellcheck source=scripts/development-workflow/workflow-lib.sh
source "$SCRIPT_DIR/workflow-lib.sh"

usage() {
  cat <<'EOF'
Usage: ./scripts/development-workflow/pr-label-readiness-checklist.sh <pr-number> --branch <name> [options]

Runs Protocol 91 Step 8a checks (Checks 0 through 4). Exit codes 0-12 match the
Step 8a table in protocol 91. Infrastructure dependency scan, human-checkpoint
sync, and Step 8a.1 remain orchestration steps outside this script.

Options:
  --branch <name>           Head branch (e.g. feature/foo, spec/bar) — required
  --repo, --product-repo    Repository selector (same as pr-ci-loop.sh)
  --repo-root <path>        Workflow repository root
  --evidence-file <path>    KEY=value telemetry from Step 7/8 (see protocol 91)
  --evidence-stdin          Read evidence KEY=value lines from stdin after options
  --no-label-mutation       Skip gh pr edit label changes (tests only)
  -h, --help                Show this help

Evidence keys include POST_CLEAN_*, LOCAL_AI_*, CI_EVIDENCE, REVIEWER_LOOP_SKIPPED_NO_PLATFORMS,
RESIDUAL_GATE_*, COMPLEX_GATE_MATRIX_REQUIRED. When no evidence file/stdin is supplied,
existing environment variables are used unchanged.
EOF
}

require_value() {
  local option="$1"
  if [ "$#" -lt 2 ] || [ -z "${2:-}" ] || [ "${2#--}" != "$2" ]; then
    echo "$option requires a value." >&2
    usage >&2
    exit 64
  fi
}

is_positive_int() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    0*) return 1 ;;
    *) return 0 ;;
  esac
}

load_evidence_stream() {
  local line key value
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%%#*}"
    line="$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    [ -z "$line" ] && continue
    case "$line" in
      *=*)
        key="${line%%=*}"
        value="${line#*=}"
        key="$(printf '%s' "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
        [ -z "$key" ] && continue
        export "$key=$value"
        ;;
      *)
        echo "ERROR: evidence line is not KEY=value: $line" >&2
        exit 64
        ;;
    esac
  done
}

load_evidence_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    echo "ERROR: evidence file not found: $file" >&2
    exit 64
  fi
  load_evidence_stream < "$file"
}

workflow_pr_edit() {
  if [ "${NO_LABEL_MUTATION:-0}" = "1" ]; then
    echo "INFO: --no-label-mutation: skipping gh pr edit $*"
    return 0
  fi
  gh pr edit "$@"
}

PR_NUMBER=""
BRANCH=""
repo_selector=""
repo_root="$(workflow_repo_root)"
evidence_file=""
evidence_stdin=0
NO_LABEL_MUTATION=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --branch)
      require_value "$@"
      BRANCH="$2"
      shift 2
      ;;
    --repo|--product-repo)
      require_value "$@"
      repo_selector="$2"
      shift 2
      ;;
    --repo-root)
      require_value "$@"
      repo_root="$2"
      shift 2
      ;;
    --evidence-file)
      require_value "$@"
      evidence_file="$2"
      shift 2
      ;;
    --evidence-stdin)
      evidence_stdin=1
      shift
      ;;
    --no-label-mutation)
      NO_LABEL_MUTATION=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 64
      ;;
    *)
      if [ -n "$PR_NUMBER" ]; then
        echo "Only one PR number may be provided." >&2
        exit 64
      fi
      PR_NUMBER="$1"
      shift
      ;;
  esac
done

if [ -z "$PR_NUMBER" ] || ! is_positive_int "$PR_NUMBER"; then
  echo "A positive integer PR number is required." >&2
  usage >&2
  exit 64
fi
if [ -z "$BRANCH" ]; then
  echo "--branch is required." >&2
  usage >&2
  exit 64
fi

export WORKFLOW_REPO_ROOT="$repo_root"
if [ -n "$repo_selector" ]; then
  export WORKFLOW_REPO_SELECTOR="$repo_selector"
fi

if [ -n "$evidence_file" ]; then
  load_evidence_file "$evidence_file"
fi
if [ "$evidence_stdin" -eq 1 ]; then
  load_evidence_stream
fi

# --- Checklist body (extracted from Protocol 91 Step 8a) ---------------------
TARGET_REPO=$(repo_slug)

# Determine PR type (implementation vs. spec/plan)
case "$BRANCH" in
  feature/*|fix/*|hotfix/*|refactor/*|backport/hotfix/*)
    IS_IMPLEMENTATION_PR=true
    ;;
  spec/*|implementation-plan/*)
    IS_IMPLEMENTATION_PR=false
    ;;
  *)
    IS_IMPLEMENTATION_PR=false
    echo "WARNING: Branch '$BRANCH' does not match a recognized prefix (feature/*, fix/*, refactor/*, hotfix/*, backport/hotfix/*, spec/*, implementation-plan/*). Treating as non-implementation PR. Report this anomaly to the human."
    ;;
esac

# Check 0: CI must be green on the PR's head SHA.
# This is a hard gate — do NOT apply ready-for-human-review when any check is
# failing or still pending. Run Step 8 (pr-ci-loop.sh) first if CI is not green.
HEAD_SHA=$(gh pr view "$PR_NUMBER" --json headRefOid --jq '.headRefOid')
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
# Match Step 8's `pr-ci-loop.sh` key semantics while still reading every page.
# statusCheckRollup carries both GitHub/App check-runs and plain commit statuses,
# and exposes `workflowName` so duplicate historical entries can be normalized by
# the same check key (`workflowName/name` for checks, `context` for statuses).
GRAPHQL_OWNER="${REPO%%/*}"
GRAPHQL_REPO="${REPO#*/}"
CHECKS_JSON="[]"
CHECKS_CURSOR=""
CHECKS_QUERY='query($owner:String!,$repo:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$repo){pullRequest(number:$number){statusCheckRollup{contexts(first:100,after:$cursor){nodes{__typename ... on CheckRun{name checkSuite{workflowRun{workflow{name}}} status conclusion startedAt completedAt} ... on StatusContext{context state createdAt}} pageInfo{hasNextPage endCursor}}}}}}'
while :; do
  if [ -z "$CHECKS_CURSOR" ]; then
    CHECKS_PAGE=$(gh api graphql \
      -f owner="$GRAPHQL_OWNER" -f repo="$GRAPHQL_REPO" -F number="$PR_NUMBER" \
      -F cursor=null \
      -f query="$CHECKS_QUERY") || {
        echo "ERROR: could not read status check rollup for $HEAD_SHA — refusing to label on an incomplete CI read."
        exit 5
      }
  else
    CHECKS_PAGE=$(gh api graphql \
      -f owner="$GRAPHQL_OWNER" -f repo="$GRAPHQL_REPO" -F number="$PR_NUMBER" \
      -f cursor="$CHECKS_CURSOR" \
      -f query="$CHECKS_QUERY") || {
        echo "ERROR: could not read status check rollup for $HEAD_SHA — refusing to label on an incomplete CI read."
        exit 5
      }
  fi
  if ! CHECKS_NODES=$(printf '%s' "$CHECKS_PAGE" | jq -c '.data.repository.pullRequest.statusCheckRollup.contexts.nodes // []'); then
    echo "ERROR: could not parse status check rollup for $HEAD_SHA — refusing to label on an incomplete CI read."
    exit 5
  fi
  if ! CHECKS_JSON=$(jq -cn --argjson existing "$CHECKS_JSON" --argjson nodes "$CHECKS_NODES" '$existing + $nodes'); then
    echo "ERROR: could not aggregate status check rollup for $HEAD_SHA — refusing to label on an incomplete CI read."
    exit 5
  fi
  if ! CHECKS_HAS_NEXT=$(printf '%s' "$CHECKS_PAGE" | jq -er '.data.repository.pullRequest.statusCheckRollup.contexts.pageInfo.hasNextPage // false'); then
    echo "ERROR: could not read status check pagination for $HEAD_SHA — refusing to label on an incomplete CI read."
    exit 5
  fi
  if [ "$CHECKS_HAS_NEXT" != "true" ]; then
    break
  fi
  if ! CHECKS_CURSOR=$(printf '%s' "$CHECKS_PAGE" | jq -er '.data.repository.pullRequest.statusCheckRollup.contexts.pageInfo.endCursor // ""'); then
    echo "ERROR: could not read status check pagination cursor for $HEAD_SHA — refusing to label on an incomplete CI read."
    exit 5
  fi
  if [ -z "$CHECKS_CURSOR" ] || [ "$CHECKS_CURSOR" = "null" ]; then
    echo "ERROR: status check rollup pagination did not provide an end cursor."
    exit 5
  fi
done
if ! NORMALIZED_CHECKS_JSON="$(
  printf '%s\n' "$CHECKS_JSON" | jq '
  .
  | map(
      . + {
        __check_key: (
          if (.context // "") != "" then
            "status:" + .context
          elif (.checkSuite.workflowRun.workflow.name // "") != "" and (.name // "") != "" then
            "check:" + .checkSuite.workflowRun.workflow.name + "/" + .name
          elif (.name // "") != "" then
            "check:" + .name
          else
            "unknown"
          end
        ),
        __check_ts: (.startedAt // .completedAt // .createdAt // "")
      }
    )
  | sort_by(.__check_key, .__check_ts)
  | group_by(.__check_key)
  | map(last | del(.__check_key, .__check_ts))
'
)"; then
  echo "ERROR: could not normalize status check rollup for $HEAD_SHA — refusing to label on an incomplete CI read."
  exit 5
fi
CI_FAILING=$(printf '%s' "$NORMALIZED_CHECKS_JSON" | jq '[.[] | select((.conclusion == "FAILURE") or (.conclusion == "CANCELLED") or (.conclusion == "TIMED_OUT") or (.conclusion == "ACTION_REQUIRED") or (.conclusion == "STARTUP_FAILURE") or (.state == "FAILURE") or (.state == "ERROR"))] | length')
CI_PENDING=$(printf '%s' "$NORMALIZED_CHECKS_JSON" | jq '[.[] | select(((.status // "") != "" and (.status != "COMPLETED")) or (.state == "EXPECTED") or (.state == "PENDING") or (.state == "IN_PROGRESS") or (.state == "QUEUED"))] | length')
CI_TOTAL=$(printf '%s' "$NORMALIZED_CHECKS_JSON" | jq '[.[]] | length')
if [ "$CI_FAILING" -gt 0 ] || [ "$CI_PENDING" -gt 0 ]; then
  echo "ERROR: CI is not green — ${CI_FAILING} failing and ${CI_PENDING} pending check(s) on $HEAD_SHA."
  echo "Run Step 8 (pr-ci-loop.sh) and resolve all failures before applying ready-for-human-review."
  exit 5  # Exit code 5 = "CI not green at readiness gate"
fi
# "Nothing failed" is not "CI passed" (#1514, #1580). A head can carry zero
# checks — GitHub builds no merge ref for a CONFLICTING PR, so its
# `pull_request` workflows never start — and the counts above are then both
# zero. Refuse that instead of labelling on absence. Step 8's
# CI_EVIDENCE=none / REASON=expected_checks_missing report the same condition.
# Step 8 reports CI_EVIDENCE=unknown when it could not resolve the head or
# read its workflow runs. That is not a green signal — refuse it here rather
# than labelling on a verdict whose subject is unidentified.
if [ "${CI_EVIDENCE:-}" = "unknown" ]; then
  echo "ERROR: Step 8 reported CI_EVIDENCE=unknown — the head or its workflow runs could not be read."
  echo "Re-run Step 8 (pr-ci-loop.sh) and export its output before re-entering Step 8a."
  exit 5  # Exit code 5 = "CI not green at readiness gate"
fi
if [ "$CI_TOTAL" -eq 0 ]; then
  echo "ERROR: no checks ran on $HEAD_SHA — 'green' here would mean 'nothing failed', not 'CI passed'."
  echo "If the PR is CONFLICTING, resolve the conflict so pull_request workflows can run; then re-run Step 8."
  echo "For a repository with no CI configured, record that explicitly (issue_tracker/ci policy) rather than labelling on an empty check set."
  exit 5  # Exit code 5 = "CI not green at readiness gate"
fi
echo "✅ CI is green on $HEAD_SHA (${CI_TOTAL} check(s))."
# Machine-readable readiness evidence — the runner's terminal report must carry
# the head the CI verdict belongs to, not just the verdict (#1514 AC-4).
echo "READINESS_HEAD_SHA=$HEAD_SHA"
echo "READINESS_CI_TOTAL=$CI_TOTAL"
echo "READINESS_CI_CONCLUSION=success"

# Check 0.5: latest automated reviewer-loop summary must be clean or skipped.
# A non-clean terminal result such as RESULT=escalate, needs_fixes,
# waiting_on_reviewer, timeout, or pending_timeout must never advance to
# ready-for-human-review, even if CI is green.
if ! LOOP_SUMMARY_BODY=$(gh pr view "$PR_NUMBER" --json comments --jq '
  [.comments[]
   | select(.body | test("Automated Reviewer Loop Summary|Reviewer Loop Summary|No blocking PR feedback"))]
  | sort_by(.createdAt)
  | last
  | .body // ""'); then
  echo "ERROR: Cannot verify automated reviewer-loop result — gh pr view failed."
  echo "Retry the GitHub query or resolve the CLI/API failure before applying ready-for-human-review."
  exit 7  # Exit code 7 = "reviewer-loop summary missing or non-clean"
fi
if [ -z "$LOOP_SUMMARY_BODY" ]; then
  if [ "${REVIEWER_LOOP_SKIPPED_NO_PLATFORMS:-false}" = "true" ]; then
    echo "✅ Automated reviewer-loop summary check skipped: Step 7 was skipped because no review platforms are configured."
  else
    echo "ERROR: Cannot verify automated reviewer-loop result — no reviewer-loop summary comment found."
    echo "Run Step 7 (pr-review-loop.sh) before applying ready-for-human-review."
    exit 7  # Exit code 7 = "reviewer-loop summary missing or non-clean"
  fi
fi
if [ -n "$LOOP_SUMMARY_BODY" ] && echo "$LOOP_SUMMARY_BODY" | grep -Eiq '(^|[ *[:space:]])Result:([ *[:space:]])*(clean|skipped)([ [:space:]—.,;:)]|$)|No blocking PR feedback'; then
  echo "✅ Automated reviewer-loop summary result is clean/skipped."
elif [ -n "$LOOP_SUMMARY_BODY" ]; then
  echo "ERROR: Latest automated reviewer-loop summary is not clean/skipped."
  echo "RESULT=escalate or any non-clean terminal reviewer-loop result MUST NOT apply ready-for-human-review."
  echo "Escalate to the human or return to the reviewer loop according to Step 7."
  exit 7  # Exit code 7 = "reviewer-loop summary missing or non-clean"
fi

# Check 0.6: a clean verdict must be a SETTLED one (issues #1556 / #1574).
# Every clean verdict is about one head — the one the loop read before it
# dispatched any reviewer and emitted as POST_CLEAN_HEAD_SHA. Anything pushed
# after Step 7 — a fixer, another automation, a sibling-merge conflict
# resolution — leaves the fields describing a commit the PR has moved past.
settle_head_ok() {
  LIVE_HEAD_SHA=$(gh pr view "$PR_NUMBER" --repo "$TARGET_REPO" --json headRefOid --jq '.headRefOid')
  if [ -z "${POST_CLEAN_HEAD_SHA:-}" ]; then
    echo "ERROR: Reviewer-loop telemetry is not bound to a head (POST_CLEAN_HEAD_SHA is not set)."
    echo "Re-run Step 7 with the current pr-review-loop.sh and export its POST_CLEAN_* fields before re-entering Step 8a."
    return 1
  fi
  if [ "$POST_CLEAN_HEAD_SHA" != "$LIVE_HEAD_SHA" ]; then
    echo "ERROR: The reviewer-loop verdict is for head ${POST_CLEAN_HEAD_SHA}, but the PR head is now ${LIVE_HEAD_SHA:-unknown}."
    echo "Something was pushed after Step 7. Re-run Step 7 for the current HEAD, export its POST_CLEAN_* fields, and re-enter Step 8a."
    return 1
  fi
  return 0
}
# The loop's POST_CLEAN_* fields are exported from the latest Step 7 output
# ("Carry the settle verdict forward"). CodeRabbit posts findings minutes after
# it first goes quiet — 2, 3, 5, 1, 3 and 8 late findings on PRs #1532, #1541,
# #1555, #1568, #1569 and #1570, every one real — so a clean verdict that was
# never settled, or whose platform never submitted a review for this HEAD, is
# refused here rather than re-checked with a wait of this script's own.
SETTLE_APPLIES=1
if [ "${REVIEWER_LOOP_SKIPPED_NO_PLATFORMS:-false}" = "true" ]   || { [ -n "$LOOP_SUMMARY_BODY" ] && echo "$LOOP_SUMMARY_BODY" | grep -Eiq '(^|[ *[:space:]])Result:([ *[:space:]])*skipped([ [:space:]—.,;:)]|$)'; }; then
  SETTLE_APPLIES=0
  echo "✅ Settle-state check not applicable: Step 7 was skipped."
elif [ -z "${POST_CLEAN_RECHECK:-}" ]; then
  echo "ERROR: Settle state unknown — POST_CLEAN_RECHECK is not set in this environment."
  echo "Re-run Step 7 (pr-review-loop.sh) for the current HEAD and export its POST_CLEAN_* fields before re-entering Step 8a."
  exit 12  # Exit code 12 = "reviewer-loop verdict not settled"
elif [ "$POST_CLEAN_RECHECK" = "0" ]; then
  if [ "${POST_CLEAN_RECHECK_SKIP_REASON:-}" = "no_thread_posting_platforms" ]; then
    settle_head_ok || exit 12  # Exit code 12 = "reviewer-loop verdict not settled"
    echo "✅ Settle-state check: no configured platform posts review threads; nothing can arrive late (verdict for head ${POST_CLEAN_HEAD_SHA})."
  else
    echo "ERROR: The reviewer loop did not settle its clean verdict (POST_CLEAN_RECHECK_SKIP_REASON=${POST_CLEAN_RECHECK_SKIP_REASON:-unknown})."
    echo "Re-run Step 7 without SKIP_POST_CLEAN_RECHECK / --compare so the loop settles, then re-enter Step 8a."
    exit 12  # Exit code 12 = "reviewer-loop verdict not settled"
  fi
elif [ "${POST_CLEAN_SETTLED:-0}" = "1" ]; then
  settle_head_ok || exit 12  # Exit code 12 = "reviewer-loop verdict not settled"
  echo "✅ Settle-state check: verdict settled at ${POST_CLEAN_SETTLED_AT:-<unknown>} for head ${POST_CLEAN_HEAD_SHA}."
elif [ "${POST_CLEAN_NO_SUBMITTED_REVIEW:-0}" = "1" ]; then
  echo "ERROR: The reviewer loop reported clean, but the platform never submitted a review for this HEAD (POST_CLEAN_NO_SUBMITTED_REVIEW=1)."
  echo "Its walkthrough comment is not its review. Re-run Step 7 so the loop waits for the submitted review; do not apply ready-for-human-review on this state."
  exit 12  # Exit code 12 = "reviewer-loop verdict not settled"
else
  # POST_CLEAN_SETTLE_TIMEOUT=1: the platform was still active when the window
  # ran out. Elapsed time is not quiet time — only the loop's activity-aware
  # settle can tell the two apart — so this is refused like the other unsettled
  # states, not re-checked after a sleep of this script's own.
  echo "ERROR: The reviewer loop reported clean but UNSETTLED: the settle window ran out while the platform was still active (POST_CLEAN_SETTLE_TIMEOUT=1)."
  echo "Re-run Step 7 so the loop settles again for this HEAD. If that run also reports POST_CLEAN_SETTLE_TIMEOUT=1, escalate to the human with reason settle_never_quiet instead of re-running a third time."
  exit 12  # Exit code 12 = "reviewer-loop verdict not settled"
fi

# Check 0.6b: local-ai-reviewer current-head evidence (issue #1648).
if [ "${REVIEWER_LOOP_SKIPPED_NO_PLATFORMS:-false}" = "true" ]; then
  echo "✅ Local-reviewer head check not applicable: Step 7 was skipped (no review platforms)."
elif [ -z "${LOCAL_AI_CONFIGURED:-}" ]; then
  echo "ERROR: Reviewer-loop telemetry was not carried forward (LOCAL_AI_CONFIGURED is not set)."
  echo "Re-run Step 7 and export its POST_CLEAN_* and LOCAL_AI_* fields before re-entering Step 8a."
  exit 12  # Exit code 12 = "reviewer-loop verdict not settled"
elif [ "$LOCAL_AI_CONFIGURED" = "0" ]; then
  echo "✅ Local-reviewer head check not applicable: local-ai-reviewer is not configured."
elif [ "${LOCAL_AI_HEAD_CURRENT:-__unset__}" != "1" ]; then
  echo "ERROR: local-ai-reviewer head evidence is not current (LOCAL_AI_HEAD_CURRENT=${LOCAL_AI_HEAD_CURRENT:-<empty>})."
  echo "Re-run Step 7 on the live HEAD and export its POST_CLEAN_* and LOCAL_AI_* fields before applying ready-for-human-review."
  exit 12  # Exit code 12 = "reviewer-loop verdict not settled"
else
  echo "✅ Local-reviewer head check: LOCAL_AI_HEAD_CURRENT=1 for head ${LOCAL_AI_REVIEWED_HEAD:-<unknown>}."
fi

# Check 1: PR is non-draft
DRAFT=$(gh pr view "$PR_NUMBER" --json isDraft --jq '.isDraft')
if [ "$DRAFT" = "true" ]; then
  echo "ERROR: PR is still a draft. Run 'gh pr ready $PR_NUMBER' first."
  exit 1
fi

# Check 2: ready-for-regression label applied (implementation PRs only)
# IMPORTANT: This label MUST have been applied in Step 7b before Step 8 ran.
# If it is missing here, apply it now, log the deviation, and RE-RUN Step 8
# (pr-ci-loop.sh) before continuing — the label triggers e2e/regression CI and
# that workflow MUST be waited upon. Do NOT skip directly to Check 3/4.
if [ "$IS_IMPLEMENTATION_PR" = "true" ]; then
  HAS_REGRESSION_LABEL=$(gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' | grep -c "^ready-for-regression$" || true) # workflow-shell-guard: allow SH001 - grep exits 1 when label absent; count must be 0
  if [ "$HAS_REGRESSION_LABEL" -eq 0 ]; then
    echo "WARNING: Implementation PR is missing 'ready-for-regression' label — Step 7b was not completed before Step 8."
    echo "Applying 'ready-for-regression' label now and logging as protocol deviation."
    workflow_pr_edit "$PR_NUMBER" --add-label "ready-for-regression"
    echo "PROTOCOL_DEVIATION: ready-for-regression was missing on PR #${PR_NUMBER} at Step 8a — applied by agent. Step 7b must be run before Step 8 in future cycles."
    echo "Re-running Step 8 CI loop to wait for the e2e/regression workflow triggered by the label..."
    # EXIT this checklist script and re-run Step 8 before returning here.
    # The caller (orchestrator or agent) MUST run pr-ci-loop.sh again and only
    # re-enter Step 8a once CI is green.
    exit 2  # Exit code 2 = "label applied, re-run Step 8 required"
  fi
fi

# Check 3: record needs-fixes label state.
# Do not remove it yet. Later gates in this checklist, including residual and
# documentation-stage alignment, can still prove that needs-fixes is current.
HAS_NEEDS_FIXES=$(gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' | grep -c "^needs-fixes$" || true) # workflow-shell-guard: allow SH001 - grep exits 1 when label absent; count must be 0
if [ "$HAS_NEEDS_FIXES" -gt 0 ]; then
  echo "INFO: needs-fixes is present; it will be removed only after all Step 8a gates pass."
fi

# Check 3.5: residual gate for broad-scope work.
# When item title/body/spec/plan indicates sweep, batch, helper extraction,
# numeric target counts, or pattern-based completeness, the runner must execute
# scripts/development-workflow/scope-residual-gate.sh verify before Check 4 and
# expose the latest verify result here. A classify-only
# RESULT=requires_verification does not satisfy readiness.
if [ "${RESIDUAL_GATE_REQUIRED:-false}" = "true" ]; then
  case "${RESIDUAL_GATE_RESULT:-}" in
    pass)
      echo "✅ Residual gate verified: RESULT=${RESIDUAL_GATE_RESULT}."
      ;;
    not_applicable)
      echo "ERROR: Residual gate was required for this item, but the latest verification returned not_applicable."
      echo "Re-run scripts/development-workflow/scope-residual-gate.sh verify with the item title/body/spec/plan scope that made the gate required."
      workflow_pr_edit "$PR_NUMBER" --add-label "needs-fixes"
      exit 9
      ;;
    block)
      echo "ERROR: Residual gate blocked readiness."
      workflow_pr_edit "$PR_NUMBER" --add-label "needs-fixes"
      echo "Finish residual work, link follow-up issues, or mark residuals out of scope before applying ready-for-human-review."
      exit 9
      ;;
    escalate)
      echo "ERROR: Residual gate escalated for a human decision."
      echo "Do not apply ready-for-human-review until the residual scope decision is resolved."
      exit 9
      ;;
    requires_verification)
      echo "ERROR: Residual gate was only classified; evidence verification has not run."
      echo "Run scripts/development-workflow/scope-residual-gate.sh verify and re-enter Step 8a."
      workflow_pr_edit "$PR_NUMBER" --add-label "needs-fixes"
      exit 9
      ;;
    *)
      echo "ERROR: Residual gate is required for this broad-scope item but no pass/not_applicable result is recorded."
      echo "Run scripts/development-workflow/scope-residual-gate.sh verify and re-enter Step 8a."
      workflow_pr_edit "$PR_NUMBER" --add-label "needs-fixes"
      exit 9
      ;;
  esac
fi

# Check 3.6: complex workflow decision-gate matrix evidence.
# This is a manual evidence gate, not a detector. When the PR changes workflow
# documentation or protocols whose behavior depends on multiple inputs,
# outcomes, next-action branches, labels, exit states, examples, or mirrored
# workflow surfaces, verify that the PR description contains either:
# - a consistency matrix or pointer identifying gate inputs, allowed outcomes,
#   required next actions, mirror surfaces, and examples when examples are part
#   of the changed surface; or
# - a short not-applicable rationale when the PR evidence format asks for this
#   check but the change does not alter decision-gate behavior.
# The caller sets COMPLEX_GATE_MATRIX_REQUIRED=true after classifying the PR as
# an applicable complex workflow decision-gate change. The body check below is a
# minimum evidence check; reviewers still verify that the matrix content is not
# contradictory across mirror surfaces.
if [ "${COMPLEX_GATE_MATRIX_REQUIRED:-false}" = "true" ]; then
  if ! PR_BODY=$(gh pr view "$PR_NUMBER" --json body --jq '.body // ""'); then
    echo "ERROR: Cannot verify complex workflow decision-gate matrix evidence - gh pr view failed."
    exit 11
  fi
  if ! printf '%s\n' "$PR_BODY" |
    grep -Eiq 'consistency matrix|gate inputs|allowed outcomes|required next actions|mirror surfaces'; then
    echo "ERROR: Complex workflow decision-gate matrix evidence is missing from the PR body."
    workflow_pr_edit "$PR_NUMBER" --add-label "needs-fixes"
    exit 11
  fi
  if printf '%s\n' "$PR_BODY" | grep -Eiq 'complex workflow decision-gate matrix:[ [:space:]]*not applicable|complex gate matrix[ [:space:]-]+not applicable'; then
    echo "ERROR: Complex workflow decision-gate matrix was required, but the PR body says not applicable."
    workflow_pr_edit "$PR_NUMBER" --add-label "needs-fixes"
    exit 11
  fi
  echo "OK: Complex workflow decision-gate matrix evidence is present in the PR body."
fi

# Check 3.7: documentation-stage alignment for spec and plan PRs.
# Run on every pass through Step 8a, including resumed PRs with an existing
# ready-for-human-review label. Invoke the checker for every PR; it reads the
# live PR head branch and returns not_applicable for non-documentation branches,
# so a stale or wrong local BRANCH value cannot bypass the gate.
set +e
ALIGNMENT_OUTPUT=$("$SCRIPT_DIR/check-documentation-stage-alignment.sh" --pr "$PR_NUMBER" --json 2>&1)
ALIGNMENT_STATUS=$?
set -e
if [ "$ALIGNMENT_STATUS" -eq 8 ]; then
  echo "$ALIGNMENT_OUTPUT"
  echo "ERROR: Documentation-stage alignment mismatch blocks ready-for-human-review."
  HAS_HUMAN_REVIEW_LABEL=$(gh pr view "$PR_NUMBER" --repo "$TARGET_REPO" --json labels --jq '.labels[].name' | grep -c "^ready-for-human-review$" || true) # workflow-shell-guard: allow SH001 - grep exits 1 when label absent; count must be 0
  if [ "$HAS_HUMAN_REVIEW_LABEL" -gt 0 ]; then
    workflow_pr_edit "$PR_NUMBER" --repo "$TARGET_REPO" --remove-label "ready-for-human-review" ||
      echo "WARNING: failed to remove stale ready-for-human-review; mismatch still exits 8 and remains blocked."
  fi
  workflow_pr_edit "$PR_NUMBER" --repo "$TARGET_REPO" --add-label "needs-fixes" ||
    echo "WARNING: failed to add needs-fixes; mismatch still exits 8 and remains blocked."
  echo "Correct the PR diff so it contains only expected documentation-stage artifacts, or escalate for a human workflow-stage decision."
  exit 8
elif [ "$ALIGNMENT_STATUS" -ne 0 ]; then
  echo "$ALIGNMENT_OUTPUT"
  echo "ERROR: Documentation-stage alignment checker failed. Retry the checker or resolve the GitHub/diff read failure before applying ready-for-human-review."
  exit "$ALIGNMENT_STATUS"
fi
echo "✅ Documentation-stage alignment verified."

# ⛔ STOP — Mandatory pre-Check-4 verification (implementation PRs only)
# Do NOT proceed to Check 4 until you have explicitly verified ready-for-regression is present.
# This verification is REQUIRED even if you believe Step 7b was completed — agents under token
# pressure have skipped Step 7b in past batches, causing PRs to be labeled ready-for-human-review
# without the regression label and bypassing e2e/regression CI.
if [ "$IS_IMPLEMENTATION_PR" = "true" ]; then
  echo "⛔ STOP: Verifying ready-for-regression label before applying ready-for-human-review..."
  REGRESSION_PRESENT=$(gh pr view "$PR_NUMBER" --json labels --jq '.labels[].name' | grep -c "^ready-for-regression$" || true) # workflow-shell-guard: allow SH001 - grep exits 1 when label absent; count must be 0
  if [ "$REGRESSION_PRESENT" -eq 0 ]; then
    echo "ERROR: Cannot proceed to Check 4 — ready-for-regression label is NOT present."
    echo "You MUST apply ready-for-regression (Step 7b) and re-run pr-ci-loop.sh (Step 8) before continuing."
    exit 3  # Exit code 3 = "ready-for-regression missing at pre-Check-4 gate"
  fi
  echo "✅ ready-for-regression verified present."
fi

# ⛔ STOP — Mandatory GraphQL reviewThreads verification (all PRs with configured review platforms)
# Do NOT proceed to Check 4 until you have explicitly verified all review threads are resolved.
# This verification is REQUIRED even if you believe your internal tracking shows all threads resolved —
# agents have bypassed this check in past batches by asserting reviews were "clean" based on self-
# tracking rather than querying the API, causing PRs to be labeled ready-for-human-review with
# unresolved blocking findings.
#
# NOTE: Skip this check ONLY when Step 7 was 'skipped' because no review platforms are configured.
if [ "${REVIEWER_LOOP_SKIPPED_NO_PLATFORMS:-false}" = "true" ]; then
  echo "✅ GraphQL reviewThreads check skipped: Step 7 was skipped because no review platforms are configured."
else
  echo "⛔ STOP: Verifying all review threads are resolved via GraphQL before applying ready-for-human-review..."
  CODEX_BOT_LOGIN="${CODEX_GITHUB_BOT_LOGIN:-chatgpt-codex-connector[bot]}"
  # GraphQL author.login omits the "[bot]" suffix present in REST API logins; strip it.
  CODEX_BOT_LOGIN="${CODEX_BOT_LOGIN%\[bot\]}"
  JQ_FILTER="[.data.repository.pullRequest.reviewThreads.nodes[]
          | select(.isResolved == false)
          | select((.isOutdated // false) == false)
          | select(.comments.nodes[0].author.login as \$a | [\"coderabbitai\",\"devin-ai-integration\",\"greptile-apps\",\"$CODEX_BOT_LOGIN\"] | index(\$a) != null)
          | select((.comments.nodes[0].body // \"\") | test(\"✅ Addressed\") | not)] | length"
  # Split the owner and name out of TARGET_REPO (resolved at the top of this
  # checklist). Do not leave <owner>/<repo> placeholders here — gh passes them
  # through literally and the gate silently queries a repository that does not
  # exist.
  GRAPHQL_OWNER="${TARGET_REPO%%/*}"
  GRAPHQL_REPO="${TARGET_REPO#*/}"
  UNRESOLVED_COUNT=$(gh api graphql -f query='
    query($owner:String!, $repo:String!, $number:Int!) {
      repository(owner:$owner, name:$repo) {
        pullRequest(number:$number) {
          reviewThreads(first: 100) {
            nodes { isResolved isOutdated comments(first: 1) { nodes { author { login } body } } }
          }
        }
      }
    }' -f owner="$GRAPHQL_OWNER" -f repo="$GRAPHQL_REPO" -F number="$PR_NUMBER" \
    --jq "$JQ_FILTER")
  UNRESOLVED_COUNT="${UNRESOLVED_COUNT:-0}"

  if [ "$UNRESOLVED_COUNT" -gt 0 ]; then
    echo "ERROR: Cannot proceed to Check 4 — $UNRESOLVED_COUNT unresolved review thread(s) found."
    echo "You MUST resolve all bot-authored review threads before applying ready-for-human-review."
    echo "Run the GraphQL query from Step 8c to identify unresolved threads, address them, push fixes,"
    echo "and re-run this checklist from the beginning."
    exit 4  # Exit code 4 = "unresolved review threads at pre-Check-4 gate"
  fi
  echo "✅ GraphQL verification: all review threads resolved. Proceeding to Check 4."
fi

# Check 3.7: remove stale needs-fixes only after every pre-readiness gate that
# can keep it current has passed.
if [ "$HAS_NEEDS_FIXES" -gt 0 ]; then
  echo "INFO: Removing stale 'needs-fixes' label after all pre-readiness gates passed."
  workflow_pr_edit "$PR_NUMBER" --repo "$TARGET_REPO" --remove-label "needs-fixes"
fi

# Check 4: ready-for-human-review label NOT yet applied (we are about to apply it)
HAS_HUMAN_REVIEW_LABEL=$(gh pr view "$PR_NUMBER" --repo "$TARGET_REPO" --json labels --jq '.labels[].name' | grep -c "^ready-for-human-review$" || true) # workflow-shell-guard: allow SH001 - grep exits 1 when label absent; count must be 0
# Last look before the label (issue #1574): several API-backed gates ran since
# Check 0.6, and a push during any of them leaves the settled verdict
# describing a head the PR has left. The label stays on — or goes on — the
# commit that was reviewed, or not at all; a label already present for a head
# that has since moved is pulled back.
if [ "${SETTLE_APPLIES:-1}" -eq 1 ] && ! settle_head_ok; then
  if [ "$HAS_HUMAN_REVIEW_LABEL" -gt 0 ]; then
    echo "Removing 'ready-for-human-review': it covers a head that is no longer the PR head."
    workflow_pr_edit "$PR_NUMBER" --repo "$TARGET_REPO" --remove-label "ready-for-human-review"
  fi
  exit 12  # Exit code 12 = "reviewer-loop verdict not settled"
fi
if [ "$HAS_HUMAN_REVIEW_LABEL" -gt 0 ]; then
  echo "INFO: PR already has 'ready-for-human-review' label. Skipping re-application."
else
  echo "Applying 'ready-for-human-review' label..."
  workflow_pr_edit "$PR_NUMBER" --repo "$TARGET_REPO" --add-label "ready-for-human-review"
fi

echo "✅ Label readiness checklist passed. PR is ready for human review."
