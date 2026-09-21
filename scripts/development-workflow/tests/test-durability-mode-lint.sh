#!/usr/bin/env bash
# Unit tests for durability-idempotency-mode-lint.sh
# covers: scripts/lint/durability-idempotency-mode-lint.sh

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR" && git rev-parse --show-toplevel)"
LINTER="$REPO_ROOT/scripts/lint/durability-idempotency-mode-lint.sh"
SHIPPED="$REPO_ROOT/docs/workflow/development-workflow/durability-idempotency-review-mode.md"
FIXTURES="$(mktemp -d "${TMPDIR:-/tmp}/durability-mode-lint.XXXXXX")"

cleanup() {
  rm -rf "$FIXTURES"
}
trap cleanup EXIT

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
    echo "FAIL: $name - expected '$expected', got '$actual'"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

lint_exit() {
  local file="$1"
  set +e
  bash "$LINTER" "$file" >/dev/null 2>&1
  local status=$?
  set -e
  printf '%s' "$status"
}

# Valid minimal doc
cat >"$FIXTURES/valid.md" <<'EOF'
# Durability and Idempotency Review Mode

Preamble.

### Restart and recovery
text

### Retry semantics
text

### Timeout and watchdog
text

### Duplicate delivery
text

### Partial success
text

### Persistence integrity
text

## When no lifecycle defect is found
ok
EOF

# Missing section
cat >"$FIXTURES/missing-section.md" <<'EOF'
# Durability and Idempotency Review Mode

### Restart and recovery
text

### Retry semantics
text
EOF

# Incident reference: hash-number
cat >"$FIXTURES/incident-ref.md" <<'EOF'
# Durability and Idempotency Review Mode

### Restart and recovery
See #51 for context.

### Retry semantics
text

### Timeout and watchdog
text

### Duplicate delivery
text

### Partial success
text

### Persistence integrity
text
EOF

# Incident reference: forge URL
cat >"$FIXTURES/incident-forge-url.md" <<'EOF'
# Durability and Idempotency Review Mode

### Restart and recovery
See https://github.com/lhpaul/ronda/pull/51 for context.

### Retry semantics
text

### Timeout and watchdog
text

### Duplicate delivery
text

### Partial success
text

### Persistence integrity
text
EOF

# Incident reference: development-folder path
cat >"$FIXTURES/incident-dev-path.md" <<'EOF'
# Durability and Idempotency Review Mode

### Restart and recovery
See docs/specs/developments/20260917082125_54-durability-idempotency-review-mode/ for context.

### Retry semantics
text

### Timeout and watchdog
text

### Duplicate delivery
text

### Partial success
text

### Persistence integrity
text
EOF

# Oversized: pad beyond bound after valid headings
{
  cat "$FIXTURES/valid.md"
  python3 -c 'print("x" * 17000)'
} >"$FIXTURES/oversized.md"

run_test "shipped_catalogue_passes" "0" "$(lint_exit "$SHIPPED")"
run_test "valid_fixture_passes" "0" "$(lint_exit "$FIXTURES/valid.md")"
run_test "missing_section_fails" "1" "$(lint_exit "$FIXTURES/missing-section.md")"
run_test "incident_ref_fails" "1" "$(lint_exit "$FIXTURES/incident-ref.md")"
run_test "incident_forge_url_fails" "1" "$(lint_exit "$FIXTURES/incident-forge-url.md")"
run_test "incident_dev_path_fails" "1" "$(lint_exit "$FIXTURES/incident-dev-path.md")"
run_test "oversized_fails" "1" "$(lint_exit "$FIXTURES/oversized.md")"

echo ""
echo "Passed: $PASS_COUNT  Failed: $FAIL_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
  exit 1
fi
exit 0
