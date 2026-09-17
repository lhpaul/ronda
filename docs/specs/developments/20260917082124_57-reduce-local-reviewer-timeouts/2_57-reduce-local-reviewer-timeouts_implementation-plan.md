# Reduce Local Reviewer Timeouts in Expensive-Review Gates — Implementation Plan

**Spec**:
[1_57-reduce-local-reviewer-timeouts_specs.md](./1_57-reduce-local-reviewer-timeouts_specs.md)
**Smoke test runbook**:
[57-reduce-local-reviewer-timeouts.smoke-test.md](../../../testing/workflow/57-reduce-local-reviewer-timeouts.smoke-test.md)

---

## Summary

**Approach**: Today, when `local-ai-reviewer.sh` times out or otherwise exits
without a completed verdict, `run_local_ai_reviewer_review` surfaces
`RESULT=escalate` with a concrete `REASON` (`timeout`, `malformed_output`,
`missing_model_access`, …) but often leaves `REVIEWED_HEAD` empty and does not
record a `platform_reviewed_heads` entry for the current head. The expensive gate
then sees an empty `expensive_gate_local_ai_head_current` derivation and defers
with `local_evidence_missing` — the same reason used when no attempt occurred.
That mis-labeling hides infrastructure context, repeats deferrals without
actionable diagnostics, and blocks Codex GitHub even though the operator never
received a clean local verdict.

This plan adds an explicit **local outcome class** for the current head (spec
enum: `code_clean`, `code_findings`, `infrastructure`, `not_configured`,
`not_attempted`), threads it through the expensive gate, reviewer-loop summary,
and history, and introduces dedicated gate reasons
(`local_infrastructure_failure`, optional `local_infrastructure_repeated`) so
row 3 of the spec decision matrix is honest on the default path. Infrastructure
still withholds expensive dispatch unless `PR_REVIEW_LOOP_FORCE_EXPENSIVE_REVIEWERS=1`
and a visible PR justification are present; forced runs continue to emit
`EXPENSIVE_GATE_RESULT=forced` with the would-have-deferred reason preserved.

Three decisions carry the plan:

1. **Classify from the latest local platform result on the current head**, not
   from aggregate loop `RESULT`. Timeout and other infrastructure `REASON`
   values on an `escalate` local result map to `infrastructure`; completed
   `clean` / `needs_fixes` map to `code_clean` / `code_findings`; absence of
   any local result for this head in the current pass maps to `not_attempted`.
2. **Extend the gate before the `local_evidence_missing` branch**, using the
   classifier output when `expensive_gate_local_ai_configured=1` and head is
   current or attempted-on-head but non-verdict. Never synthesize
   `code_clean` from infrastructure.
3. **Record diagnostics once at the producer** (`local-ai-reviewer.sh` timeout
   and selected escalate paths, plus `pr-review-loop.sh` summary/history fields)
   so #1657 readers can count infrastructure separately without inferring from
   blocking counts alone.

**Estimated complexity**: M

**Rationale**: The behavior change is localized to the local reviewer dispatch
path, expensive gate condition 1, and summary/history writers, but every mistake
is silent: wrong gate reason, false `local_evidence_missing`, or an accidental
clean implication. The harness surface in `test-pr-review-loop.sh` and
`test-expensive-reviewer-gate.sh` is large and must gain targeted fixtures for
each spec row.

**Dependencies**: **#1648, #1649, and #1656 must be merged to `develop` before
the implementation PR opens.** This item consumes `platform_reviewed_heads`,
`reviewer_loop_local_latest_verdict`, `expensive_reviewer_gate`, and the second
local pass hook; those land through the dependency chain already on `develop` at
plan time (see Verification Log). #1651 missed-finding telemetry is orthogonal;
this plan may extend history fields but does not require new missed-finding
semantics.

---

## Verification Log

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `941a2de` — includes merged spec PR #76 |
| Spec merged path | `test -f docs/specs/developments/20260917082124_57-reduce-local-reviewer-timeouts/1_57-reduce-local-reviewer-timeouts_specs.md` | Present on branch |
| Timeout maps to escalate | `grep -n 'print_result escalate.*timeout' scripts/development-workflow/local-ai-reviewer.sh` | Line 1183 — exit 2 / `REASON=timeout` |
| Loop maps exit 2 to escalate | `sed -n '4110,4130p' scripts/development-workflow/pr-review-loop.sh` | `run_local_ai_reviewer_review` case `2` → `RESULT=escalate` |
| Gate treats empty head as missing evidence | `sed -n '1584,1597p' scripts/development-workflow/pr-review-loop.sh` | When `head_current` is empty after configured=1 → `local_evidence_missing` |
| Forced expensive override exists | `grep -n PR_REVIEW_LOOP_FORCE_EXPENSIVE scripts/development-workflow/pr-review-loop.sh` | Documented at line 874; gate branch at 1646–1651 |
| History already stores expensive gate | `sed -n '10404,10407p' scripts/development-workflow/pr-review-loop.sh` | `expensive_gate: {platform, result, reason, head}` on entries when set |
| Local verdict selector | `sed -n '8297,8343p' scripts/development-workflow/pr-review-loop.sh` | `reviewer_loop_local_latest_verdict` — maps platform `result` to outcome |
| Integration docs mention override | `grep -n FORCE_EXPENSIVE docs/workflow/development-workflow/integrations/codex-github.md` | Line 79 — justify in PR |
| Epic peers orthogonal | Spec § Business Rules / Out of Scope | #54–#56, #63–#66 explicitly out of scope |

---

## Cross-Cutting Operational Assumption Check

### Applicable

| Assumption surface | Recorded value | Authoritative source | Verified at | Bounded cross-check scope | Result |
| --- | --- | --- | --- | --- | --- |
| Approved base branch | `develop` | Handoff `APPROVED_BASE`; `.ai-dev-workflow.yaml` default integration branch | 2026-09-17, SHA `941a2de` | Batch items #54–#57, #63–#66 | `Verified` |
| Dependency items on base | #1648, #1649, #1656 merged | Spec **Depends on**; `expensive_reviewer_gate` and local evidence helpers present in tree | 2026-09-17, SHA `941a2de` | Same scripts on `develop` tip | `Verified` |
| Batch peer plans (#58, #63–#66) | No shared gate edits claimed | Spec § Business Rules — orthogonal batch peers | 2026-09-17 | Handoff `BATCH_ITEMS` | `Verified` — no `Conflict`; concurrent plan PRs must not re-use the same gate reason strings for different semantics |

**Overall result**: `Applicable` — no unresolved `Conflict` rows.

---

## Layer-by-Layer Changes

### Database / Data Layer

Not applicable.

### Backend / API

Not applicable — workflow shell tooling only.

### Shared Packages / Libraries

- [ ] **`workflow-lib.sh` (optional constants only)**: If infrastructure
      `REASON` tokens are shared between `local-ai-reviewer.sh` and
      `pr-review-loop.sh`, add a single exported list
      `LOCAL_REVIEWER_INFRASTRUCTURE_REASONS` (newline or comma separated) to
      avoid drift. If the loop alone classifies, keep constants in
      `pr-review-loop.sh` and document the list in Protocol 93 instead — pick
      one location in implementation, not both.

### Scripts — `local-ai-reviewer.sh`

- [ ] **AC-11, AC-12**: On infrastructure exits (`timeout`, and other
      non-verdict escalate paths that spec § Business Rules treats as
      infrastructure — at minimum `timeout`, `missing_model_access`,
      `missing_credentials`, `malformed_output` when no parseable verdict was
      produced), emit bounded diagnostic keys on stdout before exit:
      - `LOCAL_REVIEWER_COMMAND_ID` — product label (`bundled_codex_preset`,
        `operator_command`, or `disabled`) — never a secret invocation string.
      - `LOCAL_REVIEWER_ATTEMPT_HEAD` — head SHA the attempt targeted (existing
        `REVIEWED_HEAD` when set).
      - `LOCAL_REVIEWER_PARTIAL_OUTPUT=0|1` — whether any machine-readable
        output was captured before failure.
      - `LOCAL_REVIEWER_ELAPSED_SECONDS` — when measurable (timeout path already
        knows budget).
- [ ] **AC-9**: When timeout occurs after partial JSON that parses to blocking
      findings, follow existing parse path → `needs_fixes` (code), not
      infrastructure. Add/extend unit tests in
      `tests/test-local-ai-reviewer.sh` for partial-output vs no-output timeout.

### Scripts — `pr-review-loop.sh`

- [ ] **Classifier** — add `reviewer_loop_local_outcome_class_for_head
      <loop_head_sha>` reading, in order:
      1. Current-pass `platform_result_records` entry for `local-ai-reviewer`
         when `reviewed_heads` or record head matches `loop_head_sha` (or
         classification rules from #1648 when head is ancestor/descendant —
         infrastructure must remain infrastructure, never promoted to clean).
      2. Else composed history via `reviewer_loop_local_latest_verdict` for
         same-head context when the current pass has not run local yet.
      Map to spec enum; expose as `LOCAL_OUTCOME_CLASS` in loop stdout when
      local is configured.
- [ ] **Gate** — extend `expensive_reviewer_gate` condition-1 block
      (**AC-1–AC-3, AC-6–AC-8**):
      - When classifier is `infrastructure` on current head →
        `EXPENSIVE_GATE_REASON=local_infrastructure_failure` (not
        `local_evidence_missing`).
      - When deferral count for this head on infrastructure ≥ N (plan default
        **N=2**, matching spec open question recommendation) → use
        `local_infrastructure_repeated` in summary/history; deferral cap
        escalation payload must include infrastructure class (**AC-6**).
      - When classifier is `code_findings` → unchanged peer-not-clean / defer
        semantics (**AC-7**).
      - When classifier is `infrastructure` and override unset → defer/withhold;
        aggregate must not become clean (**AC-8**).
- [ ] **`run_local_ai_reviewer_review`** — forward diagnostic keys from
      `local-ai-reviewer.sh`; when infrastructure escalate occurs, still record
      `platform_reviewed_heads+=("local-ai-reviewer:$head")` when
      `LOCAL_REVIEWER_ATTEMPT_HEAD` or `loop_head_sha` is known so the gate
      distinguishes **attempted infrastructure** from **not_attempted**
      (**AC-2**).
- [ ] **Summary comment** (**AC-2, AC-11, AC-12**) — add a table row or bullet
      block under `### Automated Reviewer Loop Summary` listing local outcome
      class, gate reason when expensive dispatch withheld, command id, partial
      output flag, elapsed seconds.
- [ ] **History schema** — extend `reviewer_loop_history_build_entry` JSON with
      optional `local_outcome_class` and `local_infrastructure` object
      `{command_id, partial_output, elapsed_seconds, gate_reason}`; bump
      `REVIEWER_LOOP_HISTORY_SCHEMA` minor version only if readers require it,
      otherwise document optional fields (prefer optional fields for #1657
      backward compatibility).
- [ ] **Override justification** (**AC-4, AC-5, AC-10**) — when
      `PR_REVIEW_LOOP_FORCE_EXPENSIVE_REVIEWERS=1`, require non-empty
      `PR_REVIEW_LOOP_EXPENSIVE_OVERRIDE_JUSTIFICATION` (env) **or** fail closed
      with a named defer reason `expensive_override_missing_justification`. Post
      the justification text into the PR as a single labeled comment block
      (`<!-- expensive-review-override -->` …) idempotently (update if present).
      Default path must not set the env var.

### Infrastructure / Configuration

- [ ] Document new env vars in `docs/workflow/development-workflow/integrations/local-ai-reviewer.md`,
      `integrations/codex-github.md`, and Protocol 93:
      - `PR_REVIEW_LOOP_EXPENSIVE_OVERRIDE_JUSTIFICATION` (required with force flag)
      - Existing `PR_REVIEW_LOOP_FORCE_EXPENSIVE_REVIEWERS=1` cross-linked

---

## Testing Strategy

**Test types**: Unit (bash harness), smoke runbook (human on plan/impl PR).

**Key scenarios** (map to acceptance criteria):

1. Local timeout with no partial output → `LOCAL_OUTCOME_CLASS=infrastructure`,
   gate `local_infrastructure_failure`, no Codex dispatch (**AC-1, AC-3**).
2. Summary + history contain infrastructure diagnostics, not
   `local_evidence_missing` wording (**AC-2**).
3. Completed local `needs_fixes` on head → expensive gate still deferred;
   infrastructure rules do not bypass (**AC-7**).
4. Infrastructure + `PR_REVIEW_LOOP_FORCE_EXPENSIVE_REVIEWERS=1` + justification →
   `EXPENSIVE_GATE_RESULT=forced`, Codex dispatch allowed, no synthetic local clean
   (**AC-4, AC-13**).
5. Force flag without justification → defer/escalate; no silent dispatch (**AC-5**).
6. Repeated infrastructure deferrals reach cap with infrastructure named in
   escalation (**AC-6**).
7. Partial output timeout with parseable blockers → `code_findings` (**AC-9**).
8. Override comment visible on PR (**AC-10**).

**Harness locations**:

- Extend `scripts/development-workflow/tests/test-expensive-reviewer-gate.sh`
  with infrastructure rows (stub classifier inputs via mocked
  `platform_result_records` / `platform_reviewed_heads`).
- Extend `scripts/development-workflow/tests/test-pr-review-loop.sh` Area 1649
  or new `Area 57` for summary/history field presence.
- Reuse `tests/test-local-ai-reviewer.sh` for diagnostic keys and partial-output
  timeout cases.

**Smoke test runbook**: `docs/testing/workflow/57-reduce-local-reviewer-timeouts.smoke-test.md`

**Regression suite**: Add Area 57 (or extend 1649) in
`select-test-suites.sh` if a new file is split out — keep `test-pr-review-loop.sh`
selection unchanged unless runtime requires it.

---

## Seed Data

| Entity | Values / Scenario | File |
| --- | --- | --- |
| Harness local timeout | Mock `local-ai-reviewer.sh` returning exit 2 / `REASON=timeout` with diagnostic keys | Inline in `test-expensive-reviewer-gate.sh` fixtures |
| History fixture | One entry with `local_outcome_class: infrastructure` and `expensive_gate.reason: local_infrastructure_failure` | New snippet under `scripts/development-workflow/tests/fixtures/` if needed |
| Partial JSON timeout | stdout with truncated JSON + blocking finding before timeout | `tests/test-local-ai-reviewer.sh` mock command |

---

## Documentation Updates

- [ ] `docs/workflow/development-workflow/protocols/93-automated-reviewer-loop-protocol.md` — normative infrastructure vs missing-evidence gate reasons, override justification, decision matrix rows 3–4.
- [ ] `docs/workflow/development-workflow/integrations/local-ai-reviewer.md` — diagnostic keys, infrastructure outcome class, timeout behavior vs expensive gate.
- [ ] `docs/workflow/development-workflow/integrations/codex-github.md` — link infrastructure defer reason and justification requirement.
- [ ] `AGENTS.md` — only if troubleshooting table needs a row for infrastructure defer vs missing evidence (optional; add only when operator-facing).

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Classifier treats stale clean as infrastructure | Med | High | Reuse #1648 ancestry rules; unit tests for same-head vs ancestor |
| Accidental clean aggregate on infrastructure | Low | High | Gate tests assert aggregate ≠ clean; no history `result: clean` from infra alone |
| Schema drift breaks #1657 report | Med | Med | Optional history fields; report uses `not_recorded` when absent |
| Override env without PR comment | Med | Med | Fail closed + idempotent PR comment write |

---

## Code Samples

Illustrative gate branch only — adapt during implementation:

```bash
# Illustrative — adapt during implementation
local_class="$(reviewer_loop_local_outcome_class_for_head "$head_sha")"
case "$local_class" in
  infrastructure)
    reason="local_infrastructure_failure"
    # optional: upgrade to local_infrastructure_repeated when deferrals >= N
    ;;
  code_findings)
    head_current="0"  # existing stale/not-clean path
    ;;
esac
```

---

## Implementation Order

0. Confirm `origin/develop` contains #1648/#1649/#1656 implementations; stop if
   `expensive_reviewer_gate` or `reviewer_loop_local_latest_verdict` is absent.
1. Add infrastructure diagnostic keys in `local-ai-reviewer.sh` + unit tests
   (**AC-9, AC-11, AC-12**).
2. Implement `reviewer_loop_local_outcome_class_for_head` and wire
   `run_local_ai_reviewer_review` to populate `platform_reviewed_heads` on
   infrastructure attempts.
3. Extend `expensive_reviewer_gate` reason selection + deferral-cap payload
   (**AC-1–AC-8, AC-13**).
4. Implement override justification env + PR comment (**AC-4, AC-5, AC-10**).
5. Extend summary comment and history entry fields (**AC-2, AC-6**).
6. Add/extend harness tests (`test-expensive-reviewer-gate.sh`,
   `test-pr-review-loop.sh`, `test-local-ai-reviewer.sh`); run
   `bash scripts/development-workflow/tests/test-expensive-reviewer-gate.sh` and
   targeted loop tests.
7. Update documentation listed above.
8. Walk smoke test runbook on the implementation PR.
9. Add changelog fragment `changelog.d/57.feature.reduce-local-reviewer-timeouts.md`:

   ```markdown
   - **Reduce local reviewer timeout gate friction** (#57): Classify local infrastructure failures separately from missing clean evidence in the expensive-review gate, surface timeout diagnostics, and require explicit justification for forced Codex GitHub runs.
   ```
