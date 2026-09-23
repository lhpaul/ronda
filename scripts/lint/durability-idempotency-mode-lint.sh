#!/usr/bin/env bash
# durability-idempotency-mode-lint.sh
#
# Validates docs/workflow/development-workflow/durability-idempotency-review-mode.md:
#   1. All six scenario family headings present
#   2. Size at or below REVIEW_DURABILITY_MODE_MAX_BYTES
#   3. No mechanically detectable incident references in body sections
#
# Usage:
#   ./scripts/lint/durability-idempotency-mode-lint.sh [mode-doc.md]
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed

set -euo pipefail

SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/development-workflow/workflow-lib.sh
source "$SCRIPT_DIR/../development-workflow/workflow-lib.sh"

FILE="${1:-docs/workflow/development-workflow/durability-idempotency-review-mode.md}"

if [ ! -f "$FILE" ]; then
  echo "ERROR: file not found: $FILE" >&2
  exit 1
fi

failures=0

report_fail() {
  echo "$1"
  failures=$((failures + 1))
}

# ---------------------------------------------------------------------------
# Check 1: Size
# ---------------------------------------------------------------------------
file_bytes="$(wc -c <"$FILE" | tr -d '[:space:]')"
if [ "$file_bytes" -gt "$REVIEW_DURABILITY_MODE_MAX_BYTES" ]; then
  report_fail "durability-mode size check FAILED: $file_bytes bytes exceeds bound $REVIEW_DURABILITY_MODE_MAX_BYTES"
else
  echo "durability-mode size check passed: $file_bytes bytes (bound $REVIEW_DURABILITY_MODE_MAX_BYTES)"
fi

# ---------------------------------------------------------------------------
# Check 2: Required scenario family headings (outside fenced code)
# ---------------------------------------------------------------------------
mode_text="$(cat -- "$FILE")"
if ! reviewer_durability_mode_document_is_complete "$mode_text"; then
  report_fail "durability-mode section check FAILED: required scenario family headings missing as Markdown heading lines outside fenced code"
else
  echo "durability-mode section check passed: 6 scenario family headings present"
fi

# ---------------------------------------------------------------------------
# Check 3: Incident references in body (skip preamble title line only)
# ---------------------------------------------------------------------------
line_num=0
while IFS= read -r line || [ -n "$line" ]; do
  line_num=$((line_num + 1))
  # Skip the top-level title; guidance may mention the feature name only.
  if [ "$line_num" -eq 1 ]; then
    continue
  fi
  if printf '%s\n' "$line" | grep -Eq '#[0-9]+'; then
    report_fail "durability-mode incident-reference FAILED: line $line_num contains hash-number reference"
  fi
  if printf '%s\n' "$line" | grep -Eq 'github\.com/[^[:space:]]+'; then
    report_fail "durability-mode incident-reference FAILED: line $line_num contains forge URL"
  fi
  if printf '%s\n' "$line" | grep -Fq 'docs/specs/developments/'; then
    report_fail "durability-mode incident-reference FAILED: line $line_num contains development-folder path"
  fi
done <"$FILE"

if [ "$failures" -eq 0 ]; then
  echo "durability-mode incident-reference passed: body scanned"
fi

if [ "$failures" -gt 0 ]; then
  echo ""
  echo "durability-mode lint FAILED: $failures check(s) failed for $FILE"
  exit 1
fi

echo "durability-mode lint passed: $FILE"
exit 0
