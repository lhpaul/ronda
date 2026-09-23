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
#   docs/testing/ronda/scripts/actions-window-audit.sh [repo] [since] [until]
#
# Defaults reproduce the committed table exactly:
#   repo  lhpaul/ronda
#   since 2026-09-17T00:00:00Z
#   until 2026-09-23T10:36:01Z   (the merge of PR #100, the last PR in scope)
#
# Timestamps are ISO-8601 UTC (YYYY-MM-DDTHH:MM:SSZ) and are compared as
# strings, which is why the trailing Z and zero padding are required.
set -euo pipefail

repo="${1:-lhpaul/ronda}"
since="${2:-2026-09-17T00:00:00Z}"
until_="${3:-2026-09-23T10:36:01Z}"

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

# --paginate emits one JSON document per page; jq consumes the stream. Window
# bounds are passed as jq arguments, never interpolated into the program text.
gh api "repos/${repo}/actions/runs?per_page=100" --paginate \
| jq -r --arg since "$since" --arg until "$until_" '
    .workflow_runs[]
    | select(.created_at >= $since and .created_at <= $until)
    | [.name, .run_started_at, .updated_at]
    | @tsv
  ' \
| python3 -c '
import sys, collections, datetime

agg = collections.defaultdict(lambda: [0, 0.0])


def parse(value):
    return datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))


for line in sys.stdin:
    name, started, updated = line.rstrip("\n").split("\t")
    agg[name][0] += 1
    agg[name][1] += (parse(updated) - parse(started)).total_seconds() / 60

if not agg:
    sys.exit("refusing to report a result: no runs matched the window")

total = sum(minutes for _, minutes in agg.values())
runs = sum(count for count, _ in agg.values())

print("| Workflow | Runs | Total wall time | Share |")
print("| --- | ---: | ---: | ---: |")
for name, (count, minutes) in sorted(agg.items(), key=lambda kv: -kv[1][1]):
    print(f"| {name} | {count} | {minutes:.1f} m | {minutes / total * 100:.1f}% |")
print(f"| **Total** | **{runs}** | **{total:.1f} m** | |")
'
