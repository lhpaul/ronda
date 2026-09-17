# Extract Step 8a Readiness Checklist — Implementation Plan

**Spec**: [1_65-extract-step-8a-readiness-checklist_specs.md](1_65-extract-step-8a-readiness-checklist_specs.md)
**Smoke test runbook**: [65-extract-step-8a-readiness-checklist.smoke-test.md](../../../testing/workflow/65-extract-step-8a-readiness-checklist.smoke-test.md)

---

## Summary

**Approach**: Move the embedded Step 8a "Label Readiness Checklist" bash block from
Protocol 91 into a dedicated workflow script (`pr-label-readiness-checklist.sh`) with
the same gate order, exit codes (0–12), label side effects, and machine-readable
evidence lines. Runners invoke the script with PR number and branch context; reviewer-loop
and CI telemetry can be supplied via environment variables (unchanged) or via a documented
evidence file / stdin stream. Replace the inline fenced block with a script invocation
plus a pointer to `--help` and the exit-code table. Retain infrastructure dependency
scan, human-checkpoint label sync, and Step 8a.1 as orchestration steps adjacent to
the script call (per spec out of scope).

**Estimated complexity**: M

**Rationale**: The checklist is long, GraphQL-heavy, and already guarded by
`test-protocol-91-readiness-checklist.sh`, but that harness only validates the
protocol fence. Extraction touches one large script, protocol and runner docs, and a
new fixture-based test harness with mock `gh` — similar scope to
`check-documentation-stage-alignment.sh`.

**Dependencies**: None.

---

## Verification Log

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `7e6bb3c` |
| Template-fit check | Read `.ai-dev-workflow.yaml` and spec | `template.is_template: false`; workflow tooling extraction, not product code |
| Inline checklist location | `rg -n 'PR_NUMBER=<pr_number>' docs/workflow/development-workflow/protocols/91-orchestrate-work-protocol.md` | Single embedded checklist opens ~2584; ends ~3055 |
| Existing regression harness | `test -f scripts/development-workflow/tests/test-protocol-91-readiness-checklist.sh && echo yes` | `yes` — must be repointed after extraction |
| Script test harness count | `find scripts/development-workflow/tests -maxdepth 1 -name 'test-*.sh' \| wc -l` | `80` |
| Step 8a runner references | `rg -l 'Step 8a' .cursor/agents/ .codex/skills/ docs/workflow/development-workflow/protocols/91-orchestrate-work-protocol.md docs/workflow/development-workflow/protocols/93-automated-reviewer-loop-protocol.md` | Protocol 91 (canonical), 93, item-orchestrator, developer, tech-lead, automated-reviewer-loop, Codex runner skills |
| Parallel loop scripts | `ls scripts/development-workflow/pr-ci-loop.sh scripts/development-workflow/pr-review-loop.sh` | Present — follow same `workflow-lib.sh` sourcing and `--repo-root` patterns |

---

## Cross-Cutting Operational Assumption Check

| Assumption surface | Recorded value | Authoritative source | Verified at | Bounded cross-check scope | Result |
| --- | --- | --- | --- | --- | --- |
| Approved integration base | `develop` | Handoff + `validate-branch-reuse.sh` | 2026-09-17, SHA `7e6bb3c` | Batch items 58, 63, 64, 65, 66, 54, 55, 56, 57 (orthogonal); same-surface open PR scan | `Verified` for base branch; open-PR scan deferred at plan-write time due to GitHub API rate limit (parent batch already isolated worktrees per item) |

No conflicting operational assumption affects plan content: item #65 does not change
which repository hosts artifacts, which product repo is selected, or canonical config
values shared with other batch items.

---

## Layer-by-Layer Changes

### Workflow Scripts

- [ ] Add `scripts/development-workflow/pr-label-readiness-checklist.sh` as the
      extracted Step 8a checklist. Source `workflow-lib.sh` with Bash only
      (`#!/usr/bin/env bash`; no zsh-only parameter expansion).
- [ ] CLI surface (minimum):
      - Positional or required: `<pr-number>`
      - Required: `--branch <name>` (head branch prefix context, e.g. `feature/foo`)
      - Optional: `--repo`, `--product-repo`, `--repo-root` (match `pr-ci-loop.sh`)
      - Optional: `--evidence-file <path>` and/or read evidence from stdin when
        `--evidence-stdin` is set; documented key=value format for `POST_CLEAN_*`,
        `LOCAL_AI_*`, `CI_EVIDENCE`, `REVIEWER_LOOP_SKIPPED_NO_PLATFORMS`,
        `RESIDUAL_GATE_*`, `COMPLEX_GATE_MATRIX_REQUIRED`
      - Optional: `--dry-run` or `--no-label-mutation` for tests only (apply labels
        only when not in fixture/test mode)
      - `--help` printing usage and pointing to Protocol 91 exit-code table
- [ ] Lift the checklist body from Protocol 91 Step 8a (Checks 0 through 4) into
      the script without reordering gates or changing exit semantics:
      CI green + head binding, reviewer-loop summary clean/skipped, settle checks
      (0.6 / 0.6b), draft check, regression label (Check 2 / pre-Check-4),
      needs-fixes handling, residual gate, complex gate matrix, documentation-stage
      alignment via existing `check-documentation-stage-alignment.sh`, GraphQL
      reviewThreads pre-Check-4, stale needs-fixes removal, final
      `ready-for-human-review` application.
- [ ] Preserve machine-readable lines: `READINESS_HEAD_SHA`, `READINESS_CI_TOTAL`,
      `READINESS_CI_CONCLUSION=success`, and `PROTOCOL_DEVIATION:` on Check 2 recovery.
- [ ] Map checker infrastructure failures from alignment script to exit `10` when
      the embedded block would have propagated non-8 exits; keep exit `8` for mismatch.
- [ ] Document evidence-file format: one `KEY=value` per line, `#` comments allowed,
      blank lines ignored; refuse readiness when parsed `POST_CLEAN_HEAD_SHA` or
      `LOCAL_AI_*` evidence does not bind to live PR head (AC4).
- [ ] When evidence file/stdin is omitted, behavior matches current environment
      variable input (spec business rule).

### Work Item Runner / Readiness Protocols

- [ ] Update `docs/workflow/development-workflow/protocols/91-orchestrate-work-protocol.md`
      Step 8a: keep exit-code table, label derivation table, infrastructure scan,
      human-checkpoint sync, and Step 8a.1 sections; replace the fenced inline
      checklist with an invocation such as:
      `bash ./scripts/development-workflow/pr-label-readiness-checklist.sh "$PR_NUMBER" --branch "$BRANCH" [--evidence-file ...]`
      plus instructions to forward Step 7 / Step 8 exports or saved evidence.
- [ ] Update `docs/workflow/development-workflow/protocols/93-automated-reviewer-loop-protocol.md`
      so standalone readiness users are routed to the script-based Step 8a entry
      point (AC7).
- [ ] Update `docs/workflow/development-workflow/protocols/92-pr-readiness-signal-protocol.md`
      only if it still tells operators to copy the inline block; otherwise add a
      one-line pointer to the script.

### Review Contracts and Agent Guidance

- [ ] Update `REVIEW.md` plan/code review sections that reference copying the Step 8a
      inline block — point to the script instead.
- [ ] Update runner surfaces that mention Step 8a inline execution:
      `.cursor/agents/item-orchestrator.md`, `.cursor/agents/automated-reviewer-loop.md`,
      `.cursor/agents/developer.md`, `.codex/skills/workflow-reviewer-loop/SKILL.md`,
      `.codex/skills/workflow-item-orchestrator/SKILL.md`, `.codex/skills/workflow-implementer/SKILL.md`,
      `.codex/skills/workflow-orchestrator/SKILL.md`, and Claude Code mirrors under
      `.claude/agents/` when they reference the inline checklist.
- [ ] Implementation PR: include **Complex workflow decision-gate matrix** evidence
      in the PR body (exit-code table + mirror surfaces) per Protocol 91 Check 3.6 —
      the feature changes decision-gate behavior documentation.

### Tests

- [ ] Add `scripts/development-workflow/tests/test-pr-label-readiness-checklist.sh`
      using the mock-`gh` fixture pattern from
      `test-check-documentation-stage-alignment.sh`.
- [ ] Cover at minimum (AC5):
      - Success path preconditions where label mutation is stubbed (exit 0 semantics
        without live GitHub when `--input` fixture mode is used)
      - CI not green (exit 5)
      - Draft PR (exit 1)
      - Missing regression label on implementation branch (exit 2 or 3 per gate)
      - Unsettled clean verdict / missing `POST_CLEAN_RECHECK` (exit 12)
      - Documentation-stage alignment mismatch invoked via mocked alignment checker
        (exit 8) when feasible in fixture mode
- [ ] Repoint `scripts/development-workflow/tests/test-protocol-91-readiness-checklist.sh`:
      assert the protocol no longer contains the full runnable checklist fence (or
      contains only a thin wrapper), and that GraphQL brace-balance / owner-repo
      derivation tests apply to `pr-label-readiness-checklist.sh` instead.
- [ ] Register the new harness in `package.json` / CI paths if other workflow tests
      are listed there (match existing `test-*.sh` discovery).

---

## Testing Strategy

**Test types**: Shell unit/fixture tests (primary); manual smoke runbook; no browser.

**Key scenarios to test**:

1. Fixture success — all gates pass with mocked green CI and settled telemetry (AC1, AC3).
2. CI failing/pending — exit 5 (AC5).
3. Draft PR — exit 1 (AC5).
4. Implementation PR missing regression label — exit 2 with deviation log (AC5).
5. Missing settle telemetry — exit 12 (AC5).
6. Evidence file with stale head SHA — exit 12 (AC4).
7. Protocol 91 references script, not inline block (AC6).
8. `bash -n` / GraphQL brace balance on extracted script (regression).

**Smoke test runbook**: `docs/testing/workflow/65-extract-step-8a-readiness-checklist.smoke-test.md`

**Regression suite**: Add harness to the existing workflow script test suite executed
in CI with other `scripts/development-workflow/tests/test-*.sh` jobs.

---

## Seed Data

| Entity | Values / Scenario | File |
| --- | --- | --- |
| Mock PR fixture | Non-draft implementation PR, green checks rollup JSON | Created inside test harness temp dir |
| Mock telemetry | `POST_CLEAN_SETTLED=1`, matching `POST_CLEAN_HEAD_SHA` | Evidence file fixtures in test harness |
| Stale telemetry | `POST_CLEAN_HEAD_SHA` ≠ live head in fixture | Evidence file fixtures in test harness |

---

## Documentation Updates

- [ ] `docs/workflow/development-workflow/protocols/91-orchestrate-work-protocol.md` — script invocation (implementation PR).
- [ ] `docs/workflow/development-workflow/protocols/93-automated-reviewer-loop-protocol.md` — script entry point (implementation PR).
- [ ] `REVIEW.md` — replace inline-block guidance (implementation PR).
- [ ] Runner agent/skill files listed above (implementation PR).
- [ ] `AGENTS.md` — only if Common Commands should mention the new script; otherwise **None** beyond protocol docs.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Subtle behavior drift during extraction | Med | High | Copy checklist verbatim first; fixture tests for each exit code; keep `test-protocol-91-readiness-checklist.sh` assertions on script |
| Live `gh` dependency makes tests flaky | Med | Med | Fixture/`--input` mode with mock `PATH` like other workflow tests |
| Runners still copy old inline block from cached docs | Low | Med | Update all grep-visible Step 8a references; protocol points to `--help` |
| Evidence file parser accepts malformed input | Med | Med | Strict key=value parser tests; refuse partial binding |

---

## Implementation Order

1. Create `pr-label-readiness-checklist.sh` by lifting the Protocol 91 checklist body
   with no intentional logic changes; add `--help` and repo-root flags.
2. Add evidence-file/stdin ingestion that exports variables before Check 0.6 runs.
3. Add `test-pr-label-readiness-checklist.sh` fixtures and required failure scenarios.
4. Repoint `test-protocol-91-readiness-checklist.sh` to the script; run both harnesses locally.
5. Replace Protocol 91 inline block with script invocation; update Protocol 93 / 92 pointers.
6. Update runner agents, skills, and `REVIEW.md`.
7. Run `npm test`, `npm run lint`, and workflow shell snippet linter on changed docs.
8. Verify smoke runbook steps against fixture mode.
9. Add changelog fragment:

   ```markdown
   - **Extract Step 8a readiness checklist script** (#65): Move Protocol 91 label readiness gates into `pr-label-readiness-checklist.sh` with fixture tests and evidence-file input.
   ```

---

## Files to Modify

| File | Change |
| --- | --- |
| `scripts/development-workflow/pr-label-readiness-checklist.sh` | **New** — extracted checklist |
| `scripts/development-workflow/tests/test-pr-label-readiness-checklist.sh` | **New** — fixture tests |
| `scripts/development-workflow/tests/test-protocol-91-readiness-checklist.sh` | Repoint assertions to script |
| `docs/workflow/development-workflow/protocols/91-orchestrate-work-protocol.md` | Script invocation replaces inline block |
| `docs/workflow/development-workflow/protocols/93-automated-reviewer-loop-protocol.md` | Script entry point |
| `docs/workflow/development-workflow/protocols/92-pr-readiness-signal-protocol.md` | Pointer if needed |
| `REVIEW.md` | Script-based Step 8a guidance |
| `.cursor/agents/item-orchestrator.md` | Script invocation note |
| `.cursor/agents/automated-reviewer-loop.md` | Script invocation note |
| `.cursor/agents/developer.md` | Script invocation note |
| `.claude/agents/developer.md` | Mirror if present |
| `.claude/agents/automated-reviewer-loop.md` | Mirror if present |
| `.codex/skills/workflow-reviewer-loop/SKILL.md` | Script invocation note |
| `.codex/skills/workflow-item-orchestrator/SKILL.md` | Script invocation note |
| `.codex/skills/workflow-implementer/SKILL.md` | Script invocation note |
| `.codex/skills/workflow-orchestrator/SKILL.md` | Script invocation note |
| `docs/testing/workflow/65-extract-step-8a-readiness-checklist.smoke-test.md` | **New** — created in this plan PR |

---

## Acceptance Criteria Mapping

| Spec AC | Plan coverage |
| --- | --- |
| AC1 Dedicated command | Workflow Scripts — new script + CLI |
| AC2 Same ordered gates | Lift verbatim checklist section |
| AC3 Exit codes 0–12 | Preserve table; script exits match |
| AC4 Evidence file/stdin | Evidence ingestion + tests |
| AC5 Test harness | `test-pr-label-readiness-checklist.sh` scenarios |
| AC6 Protocol 91 invokes script | Protocol updates |
| AC7 Protocol 93 consistency | Protocol 93 update |
