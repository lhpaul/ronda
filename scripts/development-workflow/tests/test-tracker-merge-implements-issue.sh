#!/usr/bin/env bash
# covers: scripts/development-workflow/tracker-merge-implements-issue.py
# covers: .github/workflows/update-tracker-on-merge.yml
#
# Issue #125: an evidence-only or follow-up PR merged from a feature/<N>-*
# branch must leave item N open and its Status unchanged; the implementing PR
# (description declares a closing keyword for N) still closes it.
#
# Two layers, both offline:
#   1. The decider script against description fixtures.
#   2. A dry run of the workflow's real "Check the PR declares it implements
#      the issue" step, extracted from update-tracker-on-merge.yml and executed
#      with a fake GITHUB_OUTPUT / GITHUB_STEP_SUMMARY, for an evidence-only PR
#      and the implementing PR on the same feature/<N>-* branch.

set -euo pipefail

ROOT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd)"
DECIDER="$ROOT_DIR/scripts/development-workflow/tracker-merge-implements-issue.py"
WORKFLOW="$ROOT_DIR/.github/workflows/update-tracker-on-merge.yml"
TMP_DIR="$(mktemp -d)"
REPO="lhpaul/ronda"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

PASSES=0

# expect <true|false> <issue> <description>
expect() {
  local want="$1" issue="$2" body="$3" out got
  out="$(printf '%s' "$body" | python3 "$DECIDER" --issue "$issue" --repo "$REPO")" \
    || fail "decider exited non-zero for: $body"
  got="$(sed -n 's/^IMPLEMENTS=//p' <<< "$out")"
  [ "$got" = "$want" ] || fail "expected IMPLEMENTS=$want for issue $issue, got '$got' — body: $body"
  PASSES=$((PASSES + 1))
}

# --- Implementing PRs: a closing keyword for the SAME issue -----------------
expect true 125 "Closes #125"
expect true 125 "## Summary
Fixes the tracker workflow.

Closes #125"
expect true 125 "fixes #125"
expect true 125 "RESOLVED: #125"
expect true 125 "Resolves: #125"
expect true 125 "Close #125."
expect true 125 "fixed #125, refs #124"
expect true 125 "Closes lhpaul/ronda#125"
expect true 125 "Closes LHPaul/Ronda#125"
expect true 125 "Resolves https://github.com/lhpaul/ronda/issues/125"
expect true 125 "Refs #124
Closes #125"

# --- Evidence-only / follow-up / ambiguous: leave the item alone ------------
expect false 125 ""
expect false 125 "   "
expect false 125 "Evidence for #125. Refs #125."
expect false 125 "Part of #125 — records the control-pass evidence."
expect false 125 "Closes #124"
expect false 125 "Closes #1250"
expect false 125 "Closes #12"
expect false 125 "Closes other/repo#125"
expect false 125 "Resolves https://github.com/other/repo/issues/125"
expect false 125 "disclosed #125"
expect false 125 "prefixes #125"
expect false 125 "Closes
#125"
# shellcheck disable=SC2016 # literal backticks are the fixture
expect false 125 'Do not write `Closes #125` in an evidence PR.'
expect false 125 '<!-- Closes #125 -->
Evidence only.'
expect false 125 '<!-- Closes #N (template example)
Evidence only, comment never closed: Closes #125'
expect false 125 '```
Closes #125
```
Evidence only.'
expect false 125 '~~~text
Closes #125
~~~'
# A shorter run inside a longer fence is content, not a closer.
expect false 125 '````markdown
```
Closes #125
```
````
Evidence only.'
# A different fence character inside the fence is content too.
expect false 125 '~~~
```
Closes #125
~~~'
# A closer with an info string is not a closer; the fence runs to the end.
expect false 125 '```
x
```js
Closes #125'
# An indented-by-four line is not a fence opener (still prose here).
expect true 125 '    ```
Closes #125'

# Indented code blocks (four spaces or a tab) are code, also inside a quote.
expect false 125 'Example of the convention:

    Closes #125

Evidence only.'
expect false 125 "$(printf 'Example:\n\n\tCloses #125\n')"
expect false 125 '>     Closes #125'
expect true 125 '   Closes #125'
# ... including inside list items (marker + one space + four spaces).
expect false 125 '-     Closes #125'
expect false 125 '1.     Closes #125'
expect false 125 '> -     Closes #125'
expect true 125 '-  Closes #125'
expect true 125 '1. Closes #125'

# Fences behind container prefixes (blockquote, list item) are code too.
expect false 125 '> ```
> Closes #125
> ```'
expect false 125 '- ```
  Closes #125
  ```'
expect false 125 '1. ~~~
   Closes #125
   ~~~'

# --- Prose after properly closed code still counts --------------------------
expect true 125 '- Closes #125'
expect true 125 '> Closes #125'
# CRLF bodies (GitHub web editor) behave like LF bodies.
expect true 125 "$(printf 'Uses a ` stray backtick.\r\n\r\nCloses #125\r\n\r\nAnother ` here.\r\n')"
expect false 125 "$(printf '```\r\nCloses #125\r\n```\r\n')"
expect true 125 "$(printf '```\r\ncode\r\n```\r\nCloses #125\r\n')"
expect true 125 '````
```
not a closer
```
````
Closes #125'
expect true 125 '```
code
`````
Closes #125'
# A stray backtick cannot pair with one paragraphs away and hide the line.
# shellcheck disable=SC2016 # literal backticks are the fixture
expect true 125 'Uses a ` stray backtick.

Closes #125

Another ` here.'

# --- Usage errors ------------------------------------------------------------
usage_exit=0
python3 "$DECIDER" --issue abc --repo "$REPO" < /dev/null > /dev/null 2>&1 || usage_exit=$?
[ "$usage_exit" -eq 2 ] || fail "non-numeric --issue should exit 2, got $usage_exit"
usage_exit=0
python3 "$DECIDER" --issue 1 --repo not-a-repo < /dev/null > /dev/null 2>&1 || usage_exit=$?
[ "$usage_exit" -eq 2 ] || fail "malformed --repo should exit 2, got $usage_exit"
usage_exit=0
python3 "$DECIDER" --issue 1 --repo "$REPO" --body-file "$TMP_DIR/missing" > /dev/null 2>&1 || usage_exit=$?
[ "$usage_exit" -eq 2 ] || fail "unreadable --body-file should exit 2, got $usage_exit"

match_out="$(printf 'Some text.\nCloses   #125\n' | python3 "$DECIDER" --issue 125 --repo "$REPO")"
grep -qx 'REASON=closing_keyword' <<< "$match_out" || fail "implementing PR should report REASON=closing_keyword"
grep -qx 'MATCH=Closes #125' <<< "$match_out" || fail "MATCH should be the normalized matched text"

# --- Dry run of the real workflow step --------------------------------------
[ -f "$WORKFLOW" ] || fail "workflow not found: $WORKFLOW"

# Extract the `run: |` body of the named step, de-indented.
step_script="$TMP_DIR/implements-step.sh"
awk '
  /^[[:space:]]*-[[:space:]]*name:[[:space:]]*Check the PR declares it implements the issue[[:space:]]*$/ { in_step = 1; next }
  in_step && /^[[:space:]]*-[[:space:]]*name:[[:space:]]/ { exit }
  in_step && /^[[:space:]]*run:[[:space:]]*\|[[:space:]]*$/ { in_run = 1; next }
  in_run {
    if ($0 ~ /^[[:space:]]*$/) { print ""; next }
    if (indent == "") { match($0, /^[[:space:]]*/); indent = RLENGTH }
    print substr($0, indent + 1)
  }
' "$WORKFLOW" > "$step_script"
[ -s "$step_script" ] || fail "could not extract the implements-check step script from the workflow"

# The detect step must still classify a feature/<N>-* branch as impl (Merged),
# so the implements-check is what decides — not the branch prefix. The
# canonical mapping check owns that assertion; reuse it instead of re-parsing.
WORKFLOW_FILE_OVERRIDE="$WORKFLOW" bash "$ROOT_DIR/scripts/development-workflow/check-tracker-merge-mapping.sh" > /dev/null \
  || fail "check-tracker-merge-mapping.sh must pass on the real workflow (feature/* → impl/Merged, #125 gates)"

# dry_run <description> -> prints the step's implements output
dry_run() {
  local body="$1" out_file="$TMP_DIR/gh-output" summary_file="$TMP_DIR/gh-summary"
  : > "$out_file"
  : > "$summary_file"
  (
    cd "$ROOT_DIR"
    PR_BODY="$body" ISSUE_NUMBER=125 GH_REPO="$REPO" \
      GITHUB_OUTPUT="$out_file" GITHUB_STEP_SUMMARY="$summary_file" \
      bash "$step_script" > /dev/null
  ) || fail "implements-check step failed during dry run"
  sed -n 's/^implements=//p' "$out_file"
}

# Branch under test: feature/125-evidence-pass (evidence-only) and
# feature/125-implementation (implementing) — both resolve to issue 125.
evidence_result="$(dry_run "Records the #125 control-pass evidence. Refs #125.")"
[ "$evidence_result" = "false" ] \
  || fail "dry run: evidence-only PR from feature/125-* must leave the item alone (got '$evidence_result')"
grep -q 'was \*\*not\*\* closed' "$TMP_DIR/gh-summary" \
  || fail "dry run: evidence-only skip must be logged in the step summary"

implementing_result="$(dry_run "Implements the opt-in.

Closes #125")"
[ "$implementing_result" = "true" ] \
  || fail "dry run: implementing PR from feature/125-* must close the item (got '$implementing_result')"

null_body_result="$(dry_run "")"
[ "$null_body_result" = "false" ] \
  || fail "dry run: a PR with no description must leave the item alone (got '$null_body_result')"

printf 'tracker merge implements-issue tests passed (%s decider cases + workflow dry run)\n' "$PASSES"
