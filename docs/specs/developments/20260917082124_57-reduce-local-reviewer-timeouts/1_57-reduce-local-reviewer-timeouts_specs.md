# Reduce Local Reviewer Timeouts in Expensive-Review Gates — Spec

**Depends on**: 1648-reviewer-loop-current-head-evidence, 1649-expensive-reviewers-after-local-clean, 1656-second-local-pass

---

## Overview

The automated reviewer loop runs a cheap local reviewer before it invokes slow, expensive external reviewers such as the Codex GitHub reviewer. That ordering is deliberate: local findings should surface early, and expensive capacity should not run blindly on every push.

When the local reviewer command is slow or the host kills it for time, the loop today often treats the failure like a missing or inconclusive review. The expensive-review gate then withholds the external reviewer, the loop defers and re-runs, and operators watch the same timeout repeat until the deferral budget escalates — even though no one ever claimed the pull request was clean. PR #51 exposed this pattern: local Codex preflight timed out repeatedly before Codex GitHub could run as the ready-phase expensive reviewer, turning infrastructure flakiness into progress blockage.

This feature makes expensive-review gates resilient to **local reviewer infrastructure failures** — timeouts, unavailable runtimes, and similar non-verdict outcomes — without weakening the safety rule that expensive reviewers must not substitute for missing evidence that the current head was actually examined locally. Code findings from a completed local review still block expensive dispatch the same way they do today; only infrastructure-class failures gain a controlled, auditable path forward.

---

## Issue-Objective Traceability

Every objective stated in issue #57 maps to acceptance criteria and use cases here, or to an explicit entry under **Out of Scope (MVP)** with a deferral note.

| # | Objective (from #57) | Where it is satisfied |
| --- | --- | --- |
| 1 | *Problem* — local reviewer timeouts in expensive gates block PR progress | Overview; Use Cases 1–2; Business Rules on infrastructure vs code outcomes |
| 2 | *Outcome* — resilient expensive gate when local review is slow or unavailable | Use Cases 2–4; AC-1 through AC-6 |
| 3 | *Safety* — expensive reviewers are not blind substitutes for missing local evidence | Use Cases 3–4; Business Rules; AC-3, AC-7, AC-8 |
| 4 | *Acceptance* — distinguish code findings from infrastructure timeouts | Statuses / Enum Values; Use Case 1; AC-1, AC-2, AC-9 |
| 5 | *Acceptance* — explicit, audited way to run Codex GitHub when local review is unavailable | Use Case 4; AC-4, AC-5, AC-10 |
| 6 | *Acceptance* — timeout diagnostics (command, head, partial output) | Use Case 1; Operational Visibility; AC-11, AC-12 |
| 7 | *Acceptance* — default path prevents false-clean merges | Use Cases 3, 5; AC-7, AC-8, AC-13 |

---

## Use Cases

### Use Case 1: An operator diagnoses a local reviewer infrastructure timeout

**Actor**: A maintainer or item-orchestrator agent advancing a pull request through Step 7.
**Preconditions**: The local reviewer is configured for the repository. A loop pass attempted to run it against the current head. The command exceeded its time budget or otherwise failed without producing a review verdict on that head.

**Steps**:

1. The loop completes or stops the local reviewer attempt.
2. The loop records the outcome as an **infrastructure failure**, not as clean and not as code findings.
3. The operator opens the reviewer-loop summary or history for that pass.
4. The operator sees which command ran (or would have run), the head commit the attempt targeted, whether any partial output existed, and how long the attempt ran before the infrastructure outcome was declared.

**Postconditions**: The operator can tell infrastructure flakiness apart from “the local reviewer found blocking issues” without re-running the command blindly.

**Information shown**:

- Outcome class: infrastructure failure (timeout or equivalent unavailable runtime outcome).
- Head commit identifier for the attempt.
- Command identity at the product level (for example, “bundled local Codex preset” vs “operator-supplied local reviewer command”) — not a shell invocation secret.
- Whether partial reviewer output was captured before the failure, and a bounded excerpt or pointer when it was.
- Elapsed time or budget consumed, when measurable.

**Considerations**:

- A timeout with **no** partial output is still an infrastructure failure, not evidence of cleanliness.
- Partial output that parses as blocking findings escalates as code findings, not as infrastructure — the distinction follows what was successfully produced, not what was intended.

---

### Use Case 2: The expensive gate responds to local infrastructure failure without an infinite defer loop

**Actor**: The automated reviewer loop (Step 7).
**Preconditions**: An expensive reviewer (today: Codex GitHub) is configured for the ready phase. The expensive-review gate would normally require current-head **clean** local evidence before dispatch. The most recent local reviewer attempt for this head ended in an infrastructure failure, not clean and not needs-fixes from a completed review.

**Steps**:

1. The gate evaluates local evidence for the current head.
2. It classifies the local outcome as infrastructure failure rather than missing clean evidence or stale clean evidence from an ancestor.
3. Instead of deferring with “local evidence missing” on every pass until the deferral cap, the loop follows the **infrastructure path** defined in Business Rules: withhold readiness, surface actionable diagnostics, and offer the audited expensive override path when policy allows — without recording a false clean local verdict.

**Postconditions**: The pull request does not stall solely because the local command timed out; the loop either recovers on retry, reaches a human escalation with clear infrastructure context, or proceeds under an explicit audited override — never by inventing local clean evidence.

**Information shown**:

- Gate reason names infrastructure failure distinctly from `local_evidence_missing`, `local_evidence_stale`, and peer-not-clean reasons.
- Deferral counter and cap behavior remain head-scoped as in #1649; infrastructure failures do not silently reset the counter in ways that hide repeated outages.

**Considerations**:

- Infrastructure failure is **not** permission to dispatch expensive reviewers by default; it is permission to stop mis-classifying the failure as “no local review yet” and to use the audited override when the operator accepts the safety trade.

---

### Use Case 3: A completed local review with blocking findings still blocks expensive dispatch

**Actor**: The automated reviewer loop.
**Preconditions**: The local reviewer finished and reported blocking findings on the current head (or a not-current head per #1648 classification).

**Steps**:

1. The expensive gate runs before Codex GitHub (or another expensive reviewer).
2. The gate sees completed local evidence that is not clean.
3. The gate defers or withholds expensive dispatch using the existing peer-not-clean / stale-evidence semantics.

**Postconditions**: Expensive reviewers do not run as a workaround for local code findings. Infrastructure resilience does not bypass finding resolution.

**Considerations**:

- Mixed outcomes on the same head (for example, infrastructure on a first pass and needs-fixes on a retry) use the **most recent completed verdict** for gate decisions, consistent with #1648 head-evidence rules.

---

### Use Case 4: An operator authorizes Codex GitHub for the current head when local review is unavailable

**Actor**: A maintainer with permission to run the reviewer loop for the repository.
**Preconditions**: Local reviewer infrastructure failure (or repeated infrastructure failure approaching cap) on the current head. Codex GitHub is configured. The operator accepts that expensive review will run without local clean evidence for this head.

**Steps**:

1. The operator enables the one-run expensive override documented for the loop (environment flag or equivalent product control — exact mechanism deferred to the implementation plan).
2. The operator re-runs Step 7 (or resumes the loop) and records justification in the pull request (comment or loop summary field).
3. The expensive gate logs the override as **forced** with the reason it would have deferred, including infrastructure context.
4. Codex GitHub runs for the current head under the existing one-review-per-head contract.

**Postconditions**: External review proceeds; history shows the override was explicit, not an implicit clean local pass.

**Information shown**:

- Summary and history name `forced` (or equivalent product label) and the deferred reason that was overridden.
- Justification text supplied by the operator is visible on the pull request.

**Considerations**:

- Override must not apply silently on the default path; it requires deliberate operator action each time unless a future item defines durable policy (out of scope here).

---

### Use Case 5: Default path never marks ready without real review evidence on the current head

**Actor**: The automated reviewer loop and item-orchestrator agents.
**Preconditions**: Local reviewer infrastructure failed; no expensive override was used; no external reviewer produced current-head evidence.

**Steps**:

1. The loop completes its configured platforms for the pass.
2. Aggregate readiness remains withheld (`needs_fixes` or escalate — exact aggregate mapping deferred to plan, but must not become `clean`).
3. Labels such as ready-for-human-review are not applied.

**Postconditions**: No false-clean merge path: infrastructure failure alone never satisfies the expensive gate’s “local examined this head” requirement.

---

## Business Rules

- **Infrastructure vs code**: A local reviewer outcome is **infrastructure** when the command did not complete a parseable review verdict for the targeted head — including timeout, unavailable runtime, unreadable head at dispatch, and second-pass unavailable outcomes that are not head-moved-during-run. It is **code** when a completed verdict is `needs_fixes` or `clean` for a classified head (#1648).
- **No synthetic clean**: Infrastructure failure must never be written into reviewer-loop history as a clean local verdict on the current head.
- **Expensive gate honesty**: When the latest local attempt on the current head is infrastructure failure, the expensive gate must not report `local_evidence_missing` as if no attempt occurred; it must use a dedicated infrastructure reason family distinguishable in summary and history.
- **Override is audited**: Bypassing the expensive gate for infrastructure (or any other defer reason) requires explicit operator action, emits forced-gate evidence (#1649), and preserves the would-have-deferred reason.
- **Second local pass**: When #1656 requires a second local pass before ready phase, infrastructure failure on that pass follows the same infrastructure-vs-code distinction; `failed_for_head` escalation remains for repeated infrastructure on the same head only when the implementation plan defines retry limits — this spec requires distinct recording, not necessarily automatic expensive dispatch.
- **Peer evidence unchanged**: Infrastructure resilience for the expensive gate does not relax condition 2 peer-evidence rules from #1649; a peer that timed out remains not clean unless already allow-listed for skip reasons unrelated to this item.
- **Orthogonal batch peers**: Items #54–#56 and #63–#66 in the same epic do not change local timeout semantics; this item only adjusts classification, diagnostics, and gate/defer behavior around infrastructure failures.

---

## Statuses / Enum Values

Local reviewer **outcome class** (product-facing grouping for gates, summaries, and history — not necessarily a new persisted field name):

| Code value | Display label | Description |
| --- | --- | --- |
| `code_clean` | Local clean | Completed local review; no blocking findings on the classified head. |
| `code_findings` | Local findings | Completed local review with blocking findings. |
| `infrastructure` | Local infrastructure failure | No completed verdict — timeout, unavailable runtime, or equivalent. |
| `not_configured` | Local not configured | Repository does not configure a local reviewer. |
| `not_attempted` | Local not attempted | Configured but no qualifying attempt recorded for this head in the current pass context. |

**Valid transitions** (within one loop pass, simplified):

- `not_attempted` → `infrastructure` when an attempt fails without verdict.
- `not_attempted` → `code_clean` or `code_findings` when an attempt completes.
- `infrastructure` → `code_clean` or `code_findings` on a successful retry on the same head.
- No transition from `infrastructure` to `code_clean` without a completed successful review.

Expensive gate **infrastructure reason** (must be distinguishable from missing/stale clean evidence in operator-facing output):

| Code value | Display label | Description |
| --- | --- | --- |
| `local_infrastructure_failure` | Local infrastructure failure | Latest local attempt on this head failed without a completed verdict. |
| `local_infrastructure_repeated` | Local infrastructure repeated | Optional escalation label when retry policy (plan) marks the head as failed-for-infrastructure. |

---

## Decision Matrix

Rows are evaluated in order for a single loop pass at the moment the expensive-review gate runs for the current head. The first match decides expensive dispatch on the **default** path (no operator override).

| # | Latest local outcome on current head | Operator expensive override | Expensive dispatch (default) | Readiness aggregate | Required next action |
| --- | --- | --- | --- | --- | --- |
| 1 | `code_clean` | — | Allowed when #1649 peer/thread/check conditions also pass | May proceed toward ready when other gates pass | Continue platform loop |
| 2 | `code_findings` | — | Withheld | `needs_fixes` (or equivalent withhold) | Fix findings; re-run loop |
| 3 | `infrastructure` | No | Withheld | Withheld — not clean | Surface infrastructure diagnostics; retry local or use audited override (row 4) |
| 4 | `infrastructure` | Yes (audited) | Forced allowed (#1649 forced semantics) | May proceed when other gates pass | Record justification; continue — must not write synthetic local clean |
| 5 | `not_configured` | — | Per #1649 (defer / cap / override) | Per #1649 | Per #1649 operator docs |
| 6 | `not_attempted` | — | Withheld | Withheld | Run or retry local reviewer before expensive dispatch |

**Mirror surfaces** (must agree on the row outcome):

| Surface | Row 3 example (infrastructure, no override) |
| --- | --- |
| Expensive gate reason | Names infrastructure — not `local_evidence_missing` as if no attempt ran |
| Reviewer-loop summary | Local outcome class `infrastructure` with diagnostics |
| Reviewer-loop history | Same class and head; no clean verdict |
| Operator logs | Timeout or unavailable reason with command identity and partial-output flag |

---

## Operational Visibility

- **Logs**: Each local infrastructure failure logs outcome class, head commit, budget or elapsed time, and whether partial output was captured (size or yes/no — not unbounded dumps in CI logs).
- **Reviewer-loop summary**: Step 7 summary comment includes a dedicated line or table row for local infrastructure failures with command identity, head, partial-output indicator, and gate reason when expensive dispatch was withheld.
- **History**: Round entries retain enough structured fields that #1657 effectiveness reporting can count infrastructure failures separately from clean passes and from code findings, without inferring from aggregate blocking counts alone.
- **Audit trail**: Forced expensive overrides record operator justification text and the deferred reason overridden, visible on the pull request.

---

## Acceptance Criteria

- [ ] **AC-1.** When the local reviewer command exceeds its time budget without a completed verdict, the loop classifies the outcome as **infrastructure**, not as clean and not as code findings.
- [ ] **AC-2.** Operator-facing summary and history distinguish **infrastructure** outcomes from **code findings** and from **not attempted** / **missing clean evidence** wording.
- [ ] **AC-3.** With infrastructure failure on the current head and no override, the expensive-review gate does **not** dispatch Codex GitHub (or other expensive reviewers) as if local clean evidence existed.
- [ ] **AC-4.** An operator can run Codex GitHub for the current head under the existing explicit expensive override mechanism, and the loop records that the gate was **forced** together with the reason it would have deferred.
- [ ] **AC-5.** Forced overrides require deliberate operator action for that run; the default automated path does not enable them.
- [ ] **AC-6.** When local infrastructure fails, the loop does not enter an unbounded defer-only cycle that never surfaces infrastructure context — either diagnostics and distinct gate reasons appear, or the deferral cap escalates with infrastructure classified in the escalation payload.
- [ ] **AC-7.** When local review completes with blocking findings on the current head, expensive dispatch remains deferred or blocked per #1649; infrastructure rules do not bypass it.
- [ ] **AC-8.** Infrastructure failure alone never yields aggregate **clean** readiness or applies ready-for-human-review labels.
- [ ] **AC-9.** When partial local output exists before timeout, behavior follows Business Rules: parsed blocking findings count as code; unparseable partial output remains infrastructure with partial-output indicated in diagnostics.
- [ ] **AC-10.** Override runs include operator-supplied justification visible on the pull request (comment or summary field defined in the plan).
- [ ] **AC-11.** Infrastructure diagnostics name the head commit the attempt targeted.
- [ ] **AC-12.** Infrastructure diagnostics name the local reviewer command identity at product level and state whether partial output was captured.
- [ ] **AC-13.** With local infrastructure failure, no current-head expensive reviewer evidence is implied; readiness stays withheld until override, successful local completion, or acceptable external evidence per existing contracts — never by inferring local clean.

---

## Out of Scope (MVP)

- Changing Codex GitHub’s own timeout, trigger, or verdict-parsing behavior (owned by codex-github integration docs).
- Increasing default local reviewer time budgets globally; operators may still tune budgets via existing configuration — this item addresses mis-classification and gate friction, not model speed.
- Automatic expensive dispatch on infrastructure failure without operator override (fail-closed default preserved).
- New reviewer modes for durability/idempotency (#54), doc-fed prompts (#55), or recall/precision reporting (#56).
- Capturing external misses (#53) or effectiveness aggregates (#1657) — those readers consume history this item may extend, but do not define it.
- Replacing the local reviewer command or removing the bundled Codex preset.

---

## Open Questions

1. Should a single infrastructure failure on the second local pass (#1656) automatically count toward `failed_for_head` escalation, or only after N infrastructure outcomes on the same head? (Default recommendation: plan chooses N≥2 with diagnostics either way.)
2. Should operator justification for forced expensive runs be a required PR comment template vs a summary-only field? (Default recommendation: require visible PR comment for auditability.)
