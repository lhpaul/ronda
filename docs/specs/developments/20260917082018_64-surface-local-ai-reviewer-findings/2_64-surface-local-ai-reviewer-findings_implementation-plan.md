# Surface Local Reviewer Findings on the Pull Request — Implementation Plan

**Spec**:
[1_64-surface-local-ai-reviewer-findings_specs.md](./1_64-surface-local-ai-reviewer-findings_specs.md)
**Smoke test runbook**:
[64-surface-local-ai-reviewer-findings.smoke-test.md](../../../testing/workflow/64-surface-local-ai-reviewer-findings.smoke-test.md)

---

## Summary

**Approach**: `local-ai-reviewer.sh` already maps model JSON into the standard
companion contract (`BLOCKING_COUNT`, `BLOCKING_n_PATH`, `BLOCKING_n_LINE`,
`BLOCKING_n_BODY`, …). `pr-review-loop.sh` already aggregates those into
`aggregate_blocking_findings[]` via `reviewer_loop_blocking_findings_from_output`
for small-findings analysis (#1652), but the GitHub-visible **Automated Reviewer
Loop Summary** still shows only aggregate blocking counts — not per-finding
location and message for the local reviewer. This plan threads redacted local
blocking finding details into (1) a labeled summary subsection when
`local-ai-reviewer` reports `needs_fixes`, and (2) an optional additive field on
each `reviewer_loop_history.v1` ledger entry for the same pass, keeping summary
and history consistent (AC1–AC2, AC6).

Three decisions carry the plan:

1. **Scope findings to the local reviewer only.** Filter
   `aggregate_blocking_findings` (or equivalent per-round extraction from
   `platform_blocking_outputs`) where `platform == "local-ai-reviewer"`. Do not
   duplicate hosted review comments (AC5, Business Rules).
2. **Redact before any GitHub write.** Reuse the same token/path redaction
   policy as workflow audit comments (`run-epic-audit-trail.sh` `redact_text`
   rules per `guardrails-enforcement.md` §6). Prefer extracting a shared
   `workflow_audit_redact_text` helper in `workflow-lib.sh` over copying sed
   rules into `pr-review-loop.sh` (AC3).
3. **History uses optional additive fields, not a schema bump.** Add e.g.
   `local_blocking_findings: [{path, line?, message}]` on entries when the local
   reviewer contributed blocking findings; omit the key on clean passes, zero
   blocking, or when local is not configured (AC4, AC5). Long messages may be
   truncated in the summary with full redacted text retained in history JSON
   (Use Case 1 considerations).

**Estimated complexity**: M

**Rationale**: Producers and aggregation already exist; the work is rendering,
redaction, history serialization, harness fixtures, and documentation — all on
surfaces where a mistake silently leaks secrets or mis-labels hosted findings.

**Dependencies**: **#1648** (reviewed heads / head evidence — merged).
**#1652** (blocking finding JSON shape in loop — merged). Implementation should
rebase on `develop` after **#57** merges if that item lands first; field names
must not collide with #57's planned `local_outcome_class` / infrastructure
diagnostics (see Cross-Cutting check).

---

## Verification Log

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `cc05ba9` — spec merged on `develop` |
| Spec on base | `test -f docs/specs/developments/20260917082018_64-surface-local-ai-reviewer-findings/1_64-surface-local-ai-reviewer-findings_specs.md` | Present |
| Local reviewer emits blocking KV | `grep -n 'BLOCKING_.*_LINE' scripts/development-workflow/local-ai-reviewer.sh` | Parsed in jq output block ~1255–1264 |
| Loop aggregates findings JSON | `sed -n '8137,8154p' scripts/development-workflow/pr-review-loop.sh` | `reviewer_loop_blocking_findings_from_output` — path/platform/body; **no `line` yet** |
| Summary omits finding list | `sed -n '12857,12867p' scripts/development-workflow/pr-review-loop.sh` | Counts only; no local-finding subsection |
| History entry builder | `sed -n '10327,10382p' scripts/development-workflow/pr-review-loop.sh` | No `local_blocking_findings` field |
| Audit redaction reference | `sed -n '81,87p' scripts/development-workflow/run-epic-audit-trail.sh` | `redact_text` sed rules for tokens/paths |
| Peer plan #57 merged | `gh pr view 83 --json state` | MERGED — orthogonal scope (see below) |

---

## Cross-Cutting Operational Assumption Check

### Applicable

| Assumption surface | Recorded value | Authoritative source | Verified at | Bounded cross-check scope | Result |
| --- | --- | --- | --- | --- | --- |
| Approved base branch | `develop` | Handoff `APPROVED_BASE`; batch `mayMerge=true` | 2026-09-17, SHA `cc05ba9` | Items **#64**, **#57** | `Verified` |
| Shared mutation surface | `pr-review-loop.sh` summary + history writers | Both specs | 2026-09-17 | **#57** plan § Scripts — `pr-review-loop.sh` | **Orthogonal** — see evidence |
| Local reviewer disable for smoke | `LOCAL_AI_REVIEWER_DISABLED=1` when Codex/runtime fails | Handoff operator note | 2026-09-17 | Plan-stage smoke only | `Verified` — implementation PR uses `--branch` on review loop |
| Review loop branch pin | `pr-review-loop.sh <pr> --branch <head>` | Usage line 579; handoff | 2026-09-17 | Smoke runbook | `Verified` |

**Orthogonal vs #57 (evidence, not keyword overlap alone):**

| Dimension | **#57** (timeout / expensive gate) | **#64** (this item) |
| --- | --- | --- |
| Primary outcome | Classify local **infrastructure** vs missing clean evidence; new gate reasons (`local_infrastructure_failure`, …) | Publish **blocking finding path/line/message** for local reviewer |
| Summary focus | Infrastructure diagnostics, outcome class, defer/force gate narrative | Labeled list of redacted local blocking findings |
| History fields | `local_outcome_class`, infrastructure diagnostics, optional gate payload extensions | `local_blocking_findings[]` (or equivalent) with redacted messages |
| Overlap risk | Both edit `_post_review_summary` and `reviewer_loop_history_build_entry` | Mitigate by **distinct optional keys** and separate render helpers; merge #57 implementation first when both are in flight |

**Overall result**: `Applicable` — **no `Conflict`**. Coordinate field names at implementation rebase if #57 implementation PR is open.

### Not applicable

No product repository selector, cloud deployment, or database layer.

---

## Layer-by-Layer Changes

### Database / Data Layer

Not applicable.

### Backend / API

Not applicable — workflow shell tooling only.

### Shared Packages / Libraries

- [ ] **`workflow-lib.sh`**: Add `workflow_audit_redact_text()` (or sourceable
      function) by moving or mirroring `run-epic-audit-trail.sh` `redact_text`
      sed rules so PR summary/history and epic audit share one policy. Update
      `run-epic-audit-trail.sh` to call the shared helper (minimal wrapper) to
      avoid drift.

### Scripts — `pr-review-loop.sh`

- [ ] **`reviewer_loop_blocking_findings_from_output`**: Include optional `line`
      from `BLOCKING_n_LINE` when numeric/non-empty (backward compatible for
      platforms that omit line).
- [ ] **New helpers** (names illustrative):
  - `reviewer_loop_local_blocking_findings_for_round` — read from
    `platform_blocking_outputs` / `aggregate_blocking_findings` for platform
    `local-ai-reviewer` only.
  - `reviewer_loop_redact_finding_message` — pipe message through shared
    redaction; fail closed (mask entire message) if redaction pipeline errors.
  - `reviewer_loop_local_blocking_findings_summary_section` — markdown subsection
    `**Local reviewer blocking findings:**` with bullet per finding (`path:line`
    + message); omit section when count is zero; cap display length with pointer
    to history JSON for full text (spec Use Case 1).
- [ ] **`_post_review_summary`**: Append local findings section after findings
      counts (or after head-evidence block) when local blocking count > 0 and
      local blocker confirmation did not clear findings (`reviewer_loop_clear_unconfirmed_local_blocker` path must not show stale findings — reuse post-confirmation aggregate state).
- [ ] **`reviewer_loop_history_build_entry`**: Add optional
      `local_blocking_findings` array (redacted messages, path, line as string or
      null) when the current pass recorded local blocking findings; omit key
      otherwise. Do not bump `reviewer_loop_history.v1` schema version.
- [ ] **Contract / comments**: Document new history field in the header comment
      block near `REVIEWER_LOOP_HISTORY_SCHEMA` (~6720).

### Scripts — `local-ai-reviewer.sh`

No behavioral change required for MVP — output contract already sufficient.
Optional: document that bodies are redacted at publish time, not in the local
script.

### Tests

- [ ] **`scripts/development-workflow/tests/test-pr-review-loop.sh`**: New area
      (e.g. `Area 64`) — mock `platform_blocking_outputs` with local blocking KV
      including path, line, body with fake token (`ghp_FAKE`); assert summary
      section contains redacted token and path; assert history JSON includes
      matching `local_blocking_findings`; assert zero-blocking pass omits section
      and field; assert unconfirmed local blocker path clears displayed findings.
- [ ] **`test-run-epic-audit-trail.sh` or new unit** — if redaction moves to
      `workflow-lib.sh`, assert shared helper redacts same fixtures as epic audit.
- [ ] Reuse existing `_post_review_summary` harness patterns (~2086, 17346).

### Documentation

- [ ] `docs/workflow/development-workflow/integrations/local-ai-reviewer.md` —
      describe GitHub-visible finding list + history field; redaction policy pointer.
- [ ] `docs/workflow/development-workflow/protocols/93-automated-reviewer-loop-protocol.md` —
      one paragraph on local finding visibility (comment-only; no new gates).
- [ ] `AGENTS.md` troubleshooting — optional row only if operators ask where local
      finding text lives (defer unless needed during implementation).

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Secret leakage in finding body | Med | High | Shared `redact_text`; harness asserts no raw token; omit body on redaction failure |
| Summary/history mismatch | Med | Med | Single builder for redacted finding array consumed by both surfaces |
| Collision with #57 history fields | Med | Med | Distinct keys; rebase on #57 implementation before merge |
| Stale findings after LBC clear | Low | Med | Build section from post-confirmation aggregates only; extend #1656 tests |
| Comment size limits | Low | Med | Truncate summary lines; full text in history JSON |

---

## Code Samples

Illustrative redaction + render only — adapt during implementation:

```bash
# Illustrative — adapt during implementation
local_findings_json="$(
  reviewer_loop_local_blocking_findings_for_round \
    | jq -c --argjson items '[...]' '... redacted map ...'
)"
if [ "$(jq 'length' <<<"$local_findings_json")" -gt 0 ]; then
  local_findings_section="$(reviewer_loop_local_blocking_findings_summary_section "$local_findings_json")"
fi
```

History append (additive field):

```bash
# Inside reviewer_loop_history_build_entry jq pipeline — illustrative
| if ($localFindings | length) > 0 then
    . + {local_blocking_findings: $localFindings}
  else .
  end
```

---

## Implementation Order

0. Confirm `origin/develop` contains spec #64 and #1648/#1652 helpers; rebase if
   #57 implementation merged.
1. Extract shared `workflow_audit_redact_text` to `workflow-lib.sh`; wire epic audit
   trail to use it (**AC3**).
2. Extend `reviewer_loop_blocking_findings_from_output` with `line` (**AC1**).
3. Implement local-only extraction + redaction + summary section; wire
   `_post_review_summary` (**AC1, AC4, AC5**).
4. Extend `reviewer_loop_history_build_entry` with optional
   `local_blocking_findings` (**AC2, AC6**).
5. Add harness Area 64 + run targeted tests:
   `bash scripts/development-workflow/tests/test-pr-review-loop.sh` (filtered).
6. Update integration doc + Protocol 93.
7. Walk smoke test runbook on implementation PR using
   `pr-review-loop.sh <pr> --branch <head>`; set
   `LOCAL_AI_REVIEWER_DISABLED=1` only when local reviewer runtime is unavailable
   (Codex/model failure), not for happy-path verification.
8. Add changelog fragment `changelog.d/64.feature.surface-local-ai-reviewer-findings.md`:

   ```markdown
   - **Surface local reviewer findings on PRs** (#64): Show redacted local reviewer blocking finding locations and messages in the automated reviewer-loop summary and durable history.
   ```

---

## Acceptance Criteria Mapping

| AC | Verification |
| --- | --- |
| AC1 | Summary subsection lists each local blocking finding with path, line when present, message |
| AC2 | History entry for same pass contains matching `local_blocking_findings` |
| AC3 | Harness with embedded token asserts `[REDACTED_TOKEN]` (or policy equivalent) in summary and history |
| AC4 | Clean local pass — no empty findings section; no new history field |
| AC5 | Pass without local configured — unchanged summary/history |
| AC6 | History-only read reproduces findings without local logs |
| AC7 | No change to readiness labels, merge gates, or hosted reviewer dispatch |

---

## Out of Scope (MVP)

- Suggestion / non-blocking local output (spec deferral).
- Changing local reviewer models, invocation, or hosted reviewer surfaces.
- New tracker fields or dashboards.
