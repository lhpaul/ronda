# Durability and Idempotency Review Mode — Implementation Plan

**Spec**:
[1_54-durability-idempotency-review-mode_specs.md](./1_54-durability-idempotency-review-mode_specs.md)
**Smoke test runbook**:
[54-durability-idempotency-review-mode.smoke-test.md](../../../testing/workflow/54-durability-idempotency-review-mode.smoke-test.md)

---

## Summary

**Approach**: Add a **durability and idempotency review mode** that layers
lifecycle instructions onto the existing single review pass — never a second
unbounded model call. The mode document lives in-repo; activation is
deterministic from review stage, changed paths, and operator override/default
settings; every pass records `active`, `inactive`, or `unavailable` with reasons
and in-scope scenario families.

Two delivery surfaces share one contract:

1. **Workflow path** — `local-ai-reviewer.sh` supplies mode text through the
   context bundle and `REVIEW_DURABILITY_*` keys consumed by
   `pr-review-loop.sh` (same pattern as review doctrine #1654 and strict
   registry #1650/#1655).
2. **Ronda product path** — `src/inference/review-prompt.ts` and
   `src/core/summary.ts` append the same instructions and publish the same
   metadata on GitHub reviews triggered by `npm run review` / Actions.

Regression evidence follows the recall-benchmark shape (#15): six generalized PR
#51 seed fixtures plus a CLI runner that reports found / missed / noise per shape
when mode is forced `active`.

**Estimated complexity**: L

**Rationale**: Individual pieces mirror shipped patterns (doctrine supply, stage
resolution #1653, recall benchmark). Size comes from the decision matrix (eight
rows), six scenario families, six seed shapes, dual surfaces, ledger wiring, and
the requirement that **inactive must be explicit** — silent omission is a
defect. False-negative activation on listed sensitive surfaces is also a
defect (AC-1).

**Dependencies**:

- **#1653** (merged) — `reviewer_stage_for_branch` / `review_stage` in
  `local-ai-reviewer.sh`; durability mode applies only when stage is
  `implementation`.
- **#53** (spec merged) — category vocabulary only; no capture tooling in this
  item.
- **Sequencing with #57** — that item's implementation plan also edits
  `local-ai-reviewer.sh` for timeout diagnostics. Re-read merged #57 code at
  implementation start before editing the same regions (see Cross-Cutting
  Operational Assumption Check).

---

## Verification Log

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `e72162d` (after sync with `origin/develop`) |
| Stage resolution exists | `sed -n '743,805p' scripts/development-workflow/local-ai-reviewer.sh` | `reviewer_stage_for_branch` + `reviewer_resolve_review_stage` return `spec` / `plan` / `implementation` / `default` |
| Doctrine supply precedent | `sed -n '829,864p' scripts/development-workflow/local-ai-reviewer.sh` | `reviewer_doctrine_supply` → JSON + `REVIEW_DOCTRINE_*` keys + bundle fields |
| Context bundle build site | `sed -n '1098,1119p' scripts/development-workflow/local-ai-reviewer.sh` | Single `jq -n` object; durability fields extend here |
| Loop forwards platform keys | `sed -n '754,772p' scripts/development-workflow/pr-review-loop.sh` | Non-reserved keys become `PLATFORM_<n>_…` |
| Ledger is fixed-shape | `rg -n 'reviewer_loop_history_build_entry' scripts/development-workflow/pr-review-loop.sh` | Named fields — add `durability_mode` object beside `strict_spec` / `strict_plan` |
| Ronda prompt surface | `sed -n '18,65p' src/inference/review-prompt.ts` | Single `SYSTEM_PROMPT`; no stage or mode yet |
| Ronda config surface | `sed -n '7,98p' src/config/load-config.ts` | Env + `~/.config/ronda/config.json`; no durability keys yet |
| Sensitive product paths | `ls src/webhook src/github/check-run-publisher.ts src/github/review-publisher.ts` | Webhook worker, publishers present — must match automatic rules |
| Recall benchmark precedent | `docs/specs/developments/20260910121757_15-improve-review-recall/2_15-improve-review-recall_implementation-plan.md` | Fixture dir + CLI runner pattern |
| Spec seed shapes | spec table **PR #51 seed shapes** | Six rows — all required in regression catalogue (AC-14) |

**What this log does not establish.** It does not prove the model finds lifecycle
defects on real pulls — only that activation, supply, recording, and regression
harness behave deterministically. Quality measurement over time remains #56.

---

## Cross-Cutting Operational Assumption Check

### Applicable

| Assumption surface | Recorded value | Authoritative source | Verified at | Bounded cross-check scope | Result |
| --- | --- | --- | --- | --- | --- |
| Approved base branch | `develop` | Handoff + item #54 | 2026-09-17, SHA `e72162d` | Batch items 54, 57, 66 | `Verified` |
| Review stage resolution | `implementation` for `feature/*`, `fix/*`, `refactor/*`, `hotfix/*` | `local-ai-reviewer.sh` (#1653) | 2026-09-17, SHA `e72162d` | #54 spec AC-10 | `Verified` |
| Shared edit surface with #57 | `local-ai-reviewer.sh` timeout / result block | #57 implementation plan | 2026-09-17, SHA `e72162d` | Batch item 57 (plan merged on develop) | `Conflict` — see below |

**Conflict record.** Item #57 adds diagnostic keys near the timeout/escalate path
in `local-ai-reviewer.sh`. This item adds activation, supply, bundle fields, and
`REVIEW_DURABILITY_*` emission in the same file.

**Resolution status**: `Resolved` by sequencing — implementation PR for #54
must branch from current `develop` and, if #57's implementation PR merges
first, re-read the merged file before editing. Decision owner: LH. No parallel
implementation PRs for #54 and #57 without an explicit merge plan.

### Not applicable

No linked cloud project, database, or deployment target. Operator model
credentials are runtime configuration, not encoded assumptions.

**Overall result**: `Applicable` — re-verify the three rows at implementation
start (`Still valid` gate).

---

## Layer-by-Layer Changes

### Database / Data Layer

Not applicable.

### Backend / API

Not applicable — no HTTP service in this item.

### Shared Packages / Libraries

- [ ] **Declare the mode instruction size bound in `workflow-lib.sh`.**

      ```bash
      readonly REVIEW_DURABILITY_MODE_MAX_BYTES=16000
      ```

      Same pattern as `REVIEW_DOCTRINE_MAX_BYTES` (#1654): one readonly
      constant read by the linter and `reviewer_durability_mode_supply`. The
      spec defers the exact bound; **16000** leaves headroom for six scenario
      families plus concise-output rules without matching doctrine's 12000
      catalogue shape. Raising the bound is a separately reviewed contract
      change, not part of the MVP implementation PR.

- [ ] **Add the mode document**
      `docs/workflow/development-workflow/durability-idempotency-review-mode.md`.

      Structure:

      - Preamble: mode purpose, relationship to ordinary review and doctrine,
        concise-output rule (AC-12, AC-13).
      - One subsection per **scenario family** from the spec (six), each stating
        what to inspect on changed code — not a checkbox template for comments.
      - Closing section: when zero lifecycle defects are found, report nothing
        extra in inline findings; coverage belongs in metadata only.

      No PR #51 quotes, issue numbers, or thread text (generalized shapes only).

- [ ] **Add `scripts/lint/durability-idempotency-mode-lint.sh`** (bash, 0/1 exit):

      | Check | Rule |
      | --- | --- |
      | Section presence | All six scenario family headings present |
      | Size | `wc -c` ≤ `REVIEW_DURABILITY_MODE_MAX_BYTES` |
      | Incident references | No `#NNN`, forge URLs, or `docs/specs/developments/` paths inside body sections |

      Wire into `.github/workflows/markdown-lint.yml` `paths:` for the new doc
      and linter script (same gap #1654 documented for doctrine).

- [ ] **Activation helpers in `workflow-lib.sh` (or a sourced fragment):**

      - `reviewer_durability_path_is_sensitive <path>` — deterministic rules:

        | Path pattern | Rationale |
        | --- | --- |
        | `src/webhook/*` | Webhook worker / ingress |
        | `src/github/check-run-publisher.ts`, `src/github/review-publisher.ts` | External publication |
        | `src/core/run-review-pass.ts` | Pass orchestration, partial publish |
        | `**/webhook-*.ts`, `**/webhook/*.ts` | Nested webhook modules in consumers |
        | `scripts/development-workflow/pr-review-loop.sh` | Queue/history/reviewer loop |
        | `scripts/development-workflow/local-ai-reviewer.sh` | Review dispatch |
        | Any path matching `*queue*`, `*retry*`, `*idempot*`, `*durable*`, or `*persist*` under `src/` or `scripts/` | Retry / queue / idempotency / durable-store keywords |

        **False negatives on the rows above are defects** (AC-1). Unrelated
        docs-only paths must not activate (AC-2).

      - `reviewer_durability_mode_resolve stage override_default override_force changed_paths_json supply_state` —
        implements the spec **Decision Matrix** rows 1–8, outputting JSON:

        ```json
        {
          "state": "active|inactive|unavailable",
          "activation_reason": "automatic_match|operator_default|operator_override|",
          "unavailable_reason": "missing|unreadable|oversized|",
          "scenario_families_in_scope": ["restart_recovery", "..."],
          "scenario_families_na": [{"family":"...", "reason":"..."}]
        }
        ```

        Operator controls (document in adoption + local-ai-reviewer integration
        doc):

        | Variable | Effect |
        | --- | --- |
        | `RONDA_DURABILITY_MODE=off` | Row 4 force off |
        | `RONDA_DURABILITY_MODE=on` | Rows 2–3 force on |
        | `RONDA_DURABILITY_MODE_DEFAULT=on` | Row 8 operator default |
        | Config file keys `durabilityMode`, `durabilityModeDefault` | Same semantics for Actions path |

- [ ] **`reviewer_durability_mode_supply()` in `local-ai-reviewer.sh`**

      Mirror `reviewer_doctrine_supply`: snapshot once, states
      `supplied|absent|unreadable|oversized`, never truncate text into the
      bundle. When resolve says `inactive`, supply is skipped and state is
      `inactive`. When resolve says `active` but supply fails, state is
      `unavailable` with specific reason (AC-9). When resolve says `active` and
      supply succeeds, attach full text to the context bundle.

- [ ] **Extend the context bundle and `print_kv` output**

      Add fields:

      - Bundle: `durability_mode_state`, `durability_mode_activation_reason`,
        `durability_mode_unavailable_reason`, `durability_mode_text`,
        `durability_mode_families_in_scope`, `durability_mode_families_na`
      - Keys: `REVIEW_DURABILITY_MODE_STATE`, `REVIEW_DURABILITY_ACTIVATION_REASON`,
        `REVIEW_DURABILITY_UNAVAILABLE_REASON`, `REVIEW_DURABILITY_FAMILIES_IN_SCOPE`
        (comma-separated), `REVIEW_DURABILITY_FAMILIES_NA` (compact JSON)

      Export the same values in the env block passed to
      `LOCAL_AI_REVIEWER_COMMAND`.

- [ ] **Update `local-codex-review-command.sh` ordinary prompt**

      When `REVIEW_DURABILITY_MODE_STATE=active`, append: apply the durability
      mode document from the bundle / env; reason about in-scope families; keep
      findings concise (AC-12). Do not add a second Codex invocation (AC-17).

- [ ] **`pr-review-loop.sh` ledger**

      Add capture from platform output → `durability_mode` object on
      `reviewer_loop_history_build_entry` with state, activation_reason,
      unavailable_reason, families in scope, families N/A — matching AC-16.

### Ronda product (`src/`)

- [ ] **`src/review/stage-resolution.ts`** (new) — port branch-prefix rules from
      `reviewer_stage_for_branch` for use in Actions (same prefixes, same
      `implementation` mapping).

- [ ] **`src/review/durability-mode.ts`** (new) — port path sensitivity and
      decision matrix; accept config overrides; read mode document from repo at
      reviewed head via `git show` or checkout (match strict-plan document
      supply pattern: **head SHA**, not cwd).

- [ ] **`src/config/config.types.ts` + `load-config.ts`**

      Optional `durabilityMode?: "on" | "off" | "default"` and
      `durabilityModeDefault?: boolean`; env aliases `RONDA_DURABILITY_MODE`,
      `RONDA_DURABILITY_MODE_DEFAULT`.

- [ ] **`buildReviewPrompt`**

      When mode is `active`, append a bounded section to `systemPrompt` with
      mode text and enumerated in-scope families. When `inactive` or
      `unavailable`, do not append instructions; record metadata separately.

- [ ] **`buildReviewSummary`**

      Add **Durability mode** subsection: state; when active — activation reason
      and in-scope families; when unavailable — reason; when inactive on
      implementation stage — note automatic rules did not match (AC-2, AC-13,
      AC-16).

- [ ] **`run-review-pass.ts`**

      Invoke resolution after changed files are known; pass metadata into summary
      builder; ensure no second model call (AC-17, AC-18).

### Benchmark / regression tooling

- [ ] **`tests/fixtures/durability-regression/`** — six minimal patch/manifest
      entries, one per spec seed shape:

      | Shape id | Planted defect theme |
      | --- | --- |
      | `dual_ingress_arbitration` | Two entrypoints, no mutex |
      | `fatal_queue_drain` | Fatal error still drains work queue |
      | `delivery_replay_manual` | Replay id bypasses dedup |
      | `outer_job_timeout` | No outer watchdog on long job |
      | `partial_publish_recovery` | Recovery republishes same intent |
      | `transient_token_retry` | Auth blip tears down worker |

      Each fixture: short TypeScript or shell snippet + manifest row (`shape`,
      `expectedKeywords[]`, `severity`).

- [ ] **`src/cli/durability-regression.ts` + `npm run benchmark:durability`**

      Reuse recall-benchmark structure: force mode `active`, run prompt + parser
      against fixtures, print JSON summary `{ shapes: [{ id, found, missed }] }`.

### Tests

- [ ] **`scripts/development-workflow/tests/test-local-ai-reviewer.sh`**

      Scenarios: matrix rows 1, 2, 5, 6, 7, 8; force on/off env; unavailable
      when doc missing; families N/A JSON when webhook file absent.

- [ ] **`scripts/development-workflow/tests/test-durability-mode-lint.sh`**

      Fixture docs: valid, missing section, oversized, incident reference.

- [ ] **`scripts/development-workflow/tests/test-pr-review-loop.sh`**

      Ledger contains `durability_mode` when platform keys present.

- [ ] **TypeScript unit tests**

      `tests/unit/review/durability-mode.test.ts` — path rules + matrix;
      `tests/unit/inference/review-prompt.test.ts` — append when active;
      `tests/unit/cli/durability-regression.test.ts` — classification with fake
      model output.

### Infrastructure / Configuration

- [ ] Document operator env and config keys in
      `docs/adoption/ronda-review-adoption.md` and
      `docs/workflow/development-workflow/integrations/local-ai-reviewer.md`.

---

## Testing Strategy

**Test types**: Unit (shell + TS), integration (review-pass with injected model),
smoke/manual (live model regression).

**Key scenarios**:

1. Implementation PR touching `src/webhook/webhook-job.ts` → `active` /
   `automatic_match` (AC-1).
2. Implementation PR touching only `docs/project/` → `inactive` with explicit
   non-match (AC-2).
3. Spec-stage branch → `inactive` regardless of paths (AC-10).
4. Force `RONDA_DURABILITY_MODE=on` on non-sensitive paths → `active` /
   `operator_override` (AC-7).
5. Force off when paths match → `inactive` with override recorded (AC-8).
6. Remove mode doc with activation matched → `unavailable` + ordinary pass
   completes (AC-9).
7. Active mode, zero findings → summary metadata only, no family checklist
   comments (AC-13).
8. Regression CLI → each of six shapes `found >= 1` under forced active (AC-15).
9. Single model invocation counted in existing timeout budget (AC-17) — assert
   no strict-style second command in local-ai-reviewer for durability.

**Smoke test runbook**:
[`docs/testing/workflow/54-durability-idempotency-review-mode.smoke-test.md`](../../../testing/workflow/54-durability-idempotency-review-mode.smoke-test.md)

### Concurrent-event-source addendum

This item **reviews** concurrent-event code; it does not add new concurrent
sources in Ronda. For regression fixtures that simulate queue/webhook defects:

- **Shared mutable state guards**: fixtures are static snippets; no runtime
  shared state in the benchmark runner.
- **Re-entrancy / deduplication / teardown**: covered by planted defect themes,
  not new production handlers.
- **Error propagation**: benchmark runner surfaces model/parser errors in JSON;
  no silent swallow.

Design decisions for production webhook/worker code are out of scope (spec Out
of Scope #5 — #58 owns recovery mechanics).

### Parser-risk note (path activation)

Edge cases for `reviewer_durability_path_is_sensitive`:

| Input path | Expected |
| --- | --- |
| `src/webhook/webhook-job.ts` | sensitive |
| `vendor/foo/webhook-job.ts` | sensitive via `**/webhook*` rule |
| `docs/specs/foo/1_spec.md` | not sensitive |
| `src/webhook-job-backup.ts` | sensitive (idempot/queue keyword rules) |
| `README.md` | not sensitive |
| Empty changed-files list | not sensitive → `inactive` unless override |

Map each row to a unit test in `durability-mode.test.ts`.

---

## Seed Data

| Entity | Values / Scenario | File |
| --- | --- | --- |
| Durability mode document | Six scenario family sections + preamble | `docs/workflow/development-workflow/durability-idempotency-review-mode.md` |
| Regression manifest | Six shape ids from spec | `tests/fixtures/durability-regression/manifest.json` |
| Per-shape patch | Minimal defect snippet | `tests/fixtures/durability-regression/<shape-id>.patch.json` |

---

## Documentation Updates

- [ ] `docs/adoption/ronda-review-adoption.md` — operator overrides and default-on
      configuration for the Actions path.
- [ ] `docs/workflow/development-workflow/integrations/local-ai-reviewer.md` —
      `REVIEW_DURABILITY_*` keys, bundle fields, interaction with doctrine and
      strict passes.
- [ ] `docs/project/3-software-architecture.md` — name durability mode under
      review-pass composition (single pass, metadata in summary).
- [ ] `README.md` — add `npm run benchmark:durability` when the script exists.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Prompt budget overrun when doctrine + strict + durability all apply | Med | Med | Single combined ordinary pass; monitor `LOCAL_AI_REVIEWER_TIMEOUT`; do not shrink timeouts (#57 owns that) |
| False-positive activation on broad `*retry*` globs | Med | Med | Tune rules with unit tests; prefer `src/` and `scripts/` roots |
| #57 / #54 merge conflict in `local-ai-reviewer.sh` | Med | Low | Sequencing rule in this plan; re-read file at implementation start |
| Model regression misses seed shapes | Med | High | Deterministic CLI + smoke gate before merge; tune mode doc, not bypass AC-15 |
| Dual-surface drift (shell vs TS rules) | Med | Med | Shared documented path table; TS tests mirror shell fixtures |

---

## Implementation Order

0. Confirm #1653 stage helpers present; confirm develop includes merged #54 spec.
   If #57 implementation merged, re-read `local-ai-reviewer.sh` before edits.

1. Add `REVIEW_DURABILITY_MODE_MAX_BYTES`, mode document, linter, CI paths; run
   linter in CI.

2. Implement `reviewer_durability_path_is_sensitive` + `reviewer_durability_mode_resolve`
   + `reviewer_durability_mode_supply` in workflow scripts; extend bundle and
   `print_kv` keys.

3. Update `local-codex-review-command.sh` prompt append for active mode.

4. Wire `pr-review-loop.sh` ledger capture and extend `test-local-ai-reviewer.sh`
   + `test-pr-review-loop.sh`.

5. Port activation to `src/review/durability-mode.ts` + stage resolution; extend
   config, prompt, summary, and `run-review-pass.ts`.

6. Add regression fixtures, `durability-regression` CLI, package script, and unit
   tests.

7. Update adoption and integration docs; run smoke runbook steps 1–2.

8. Add changelog fragment:

   `- **Durability and idempotency review mode** (#54): Add implementation-stage review mode with deterministic activation, operator overrides, loop visibility, and PR #51 seed regression fixtures.`

9. Run `npm test`, workflow shell tests, markdown lint, and typecheck.

---

## Files to Modify (implementation PR)

| File | Change |
| --- | --- |
| `scripts/development-workflow/workflow-lib.sh` | Size constant; path + resolve helpers |
| `scripts/development-workflow/local-ai-reviewer.sh` | Supply, bundle, env, keys |
| `scripts/development-workflow/local-codex-review-command.sh` | Prompt append |
| `scripts/development-workflow/pr-review-loop.sh` | Ledger `durability_mode` |
| `scripts/lint/durability-idempotency-mode-lint.sh` | New |
| `docs/workflow/development-workflow/durability-idempotency-review-mode.md` | New |
| `.github/workflows/markdown-lint.yml` | Path filters |
| `src/review/stage-resolution.ts`, `src/review/durability-mode.ts` | New |
| `src/config/config.types.ts`, `src/config/load-config.ts` | Overrides |
| `src/inference/review-prompt.ts`, `src/core/summary.ts`, `src/core/run-review-pass.ts` | Mode + metadata |
| `src/cli/durability-regression.ts`, `package.json` | Benchmark CLI |
| `tests/fixtures/durability-regression/*` | Seed shapes |
| `tests/unit/**`, `scripts/development-workflow/tests/test-*.sh` | Coverage |
| `docs/adoption/ronda-review-adoption.md`, `docs/workflow/development-workflow/integrations/local-ai-reviewer.md`, `docs/project/3-software-architecture.md`, `README.md` | Docs |

**Not in scope for MVP implementation PR**: changing `REVIEW.md` merge gates,
webhook recovery mechanics (#58), or capture/adjudication tooling (#53).
