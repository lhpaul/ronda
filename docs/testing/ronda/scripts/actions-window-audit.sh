#!/usr/bin/env bash
# Reproduce the repository-wide Actions audit table in
# docs/testing/ronda/cost-convergence-baseline-2026-09-23.md.
#
# actions-cost-audit.sh has no --until flag, so it cannot bound the window at a
# fixed upper edge; its totals grow every time it runs. This script applies both
# bounds and performs the same grouping, duration aggregation, run counting, and
# share calculation used for the committed table.
#
# Usage:
#   docs/testing/ronda/scripts/actions-window-audit.sh \
#     [repo] [since] [until] [workflows-file]
#
# Defaults reproduce the committed table exactly:
#   repo            lhpaul/ronda
#   since           2026-09-17T00:00:00Z
#   until           2026-09-23T10:36:01Z   (the merge of PR #100)
#   workflows-file  actions-window-audit.workflows, beside this script — the
#                   PINNED roster of workflows active at the cutoff. Reading
#                   current repository state instead would let a later workflow
#                   rename, addition, removal, or disablement change the output
#                   for this fixed historical window. Regenerate it only when
#                   defining a new window; see the file's own header.
#
# Timestamps are ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ) and are compared as
# strings, which is why the trailing Z and zero padding are required.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

repo="${1:-lhpaul/ronda}"
since="${2:-2026-09-17T00:00:00Z}"
until_="${3:-2026-09-23T10:36:01Z}"
workflows_file="${4:-${script_dir}/actions-window-audit.workflows}"

if [ ! -r "$workflows_file" ]; then
  echo "workflow snapshot not readable: ${workflows_file}" >&2
  exit 2
fi

if ! printf '%s' "$repo" | grep -Eq '^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$'; then
  echo "invalid repository '${repo}'; expected <owner>/<name>" >&2
  exit 2
fi

for stamp_name in since until_; do
  stamp_value="${!stamp_name}"
  if ! printf '%s' "$stamp_value" \
      | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'; then
    echo "invalid timestamp '${stamp_value}'; expected ISO-8601 UTC, e.g. 2026-09-17T00:00:00Z" >&2
    exit 2
  fi
done

if [ "$since" \> "$until_" ]; then
  echo "invalid window: since '${since}' is after until '${until_}'" >&2
  exit 2
fi

# The workflow roster is read from a PINNED snapshot, not from current
# repository state, so that a workflow with no runs in the window is reported as
# a zero row ("Ronda review has 0 runs" is a finding, not an absence of data)
# without a later rename, addition, removal, or disablement silently changing
# the output for this fixed historical window.
workflow_names="$(grep -v '^[[:space:]]*#' "$workflows_file" | grep -v '^[[:space:]]*$' || true)"

if [ -z "$workflow_names" ]; then
  echo "refusing to report a result: no workflow names in ${workflows_file}" >&2
  exit 1
fi

# --paginate emits one JSON document per page; jq consumes the stream. Window
# bounds are passed as jq arguments, never interpolated into the program text.
{
  printf '%s\n' "$workflow_names" | sed 's/^/DEFINED\t/'
  gh api "repos/${repo}/actions/runs?per_page=100" --paginate \
  | jq -r --arg since "$since" --arg until "$until_" '
      .workflow_runs[]
      | select(.created_at >= $since and .created_at <= $until)
      | ["RUN", .name, .run_started_at, .updated_at]
      | @tsv
    '
} \
| python3 -c '
import sys, collections, datetime

agg = collections.defaultdict(lambda: [0, 0.0])


def parse(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))


for line in sys.stdin:
    fields = line.rstrip("\n").split("\t")
    if fields[0] == "DEFINED":
        agg[fields[1]]          # materialise a zero row for this workflow
        continue
    _, name, started, updated = fields
    agg[name][0] += 1
    agg[name][1] += (parse(updated) - parse(started)).total_seconds() / 60

total = sum(minutes for _, minutes in agg.values())
runs = sum(count for count, _ in agg.values())

if runs == 0:
    sys.exit("refusing to report a result: no runs matched the window")

print("| Workflow | Runs | Total wall time | Share |")
print("| --- | ---: | ---: | ---: |")
for name, (count, minutes) in sorted(agg.items(), key=lambda kv: (-kv[1][1], kv[0])):
    share = minutes / total * 100 if total else 0.0
    print(f"| {name} | {count} | {minutes:.1f} m | {share:.1f}% |")
print(f"| **Total** | **{runs}** | **{total:.1f} m** | |")
'
