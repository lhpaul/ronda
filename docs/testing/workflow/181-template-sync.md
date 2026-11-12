# Template v0.51.0 sync evidence (#181)

## Scope and provenance

- Incoming template: `lhpaul/ai-dev-framework-template`, tag `v0.51.0`, commit `bada6da17b6cf0edb6f1629e314607fefdd73a20`.
- Previous sync: v0.50.0 (`50d99e4738704533105b6e404f4468e69d6e3f42`, PR #175). Existing per-path provenance in `.ai-dev-workflow.sync-state.json` takes precedence; the previous sync commit was supplied as the verified base (`--base-source template`) only for the ten new upstream files that had no ledger entry.
- Role: `single_repo`; 747 selected always-sync paths.
- Automatic batch (735 paths, preview digest `13d427012d7c53ff45e7789f09c8b8561e455793c54a60002b136fa4831d896b`, apply returned success): 10 additions + 19 direct updates + 16 clean merges + 36 local changes retained + 654 unchanged.
- Twelve paths had three-way conflicts against their ledger base. They were merged by hand, excluded from the automatic apply with named `--decline` arguments, and keep their previous per-path provenance. No baseline evidence was fabricated or advanced for them.
- No special-handling path and no `.github/` file changed upstream between v0.50.0 and v0.51.0, so this PR changes no workflow file. Project-specific files were not replaced.
- `action.yml`, application code, the default prompt/model, the reusable Ronda Action, GitHub App permissions and model credentials are unchanged. No release or merge is performed by the agent.

## Manual merges

Several declined paths still carried a pre-v0.50.0 ledger base, although their content already contained the v0.50.0 hand merge from #175. Merging against that stale base produced spurious conflicts, so each file was merged with `git merge-file` using the v0.50.0 upstream copy as the effective base (Ronda = v0.50.0 + local safeguards). The Ronda-specific delta (lines that differ from upstream) was compared before (Ronda vs v0.50.0) and after (merged vs v0.51.0):

| Path | Upstream v0.50.0 → v0.51.0 | Result | Ronda delta |
| --- | --- | --- | --- |
| `scripts/development-workflow/coderabbit-cli-reviewer.sh` | unchanged | content unchanged | identical |
| `scripts/development-workflow/local-codex-review-command.sh` | unchanged | content unchanged | identical |
| `scripts/development-workflow/local-http-review-command.sh` | unchanged | content unchanged | identical |
| `scripts/development-workflow/run-epic-audit-trail.sh` | unchanged | content unchanged | identical |
| `scripts/development-workflow/workflow-lib.sh` | `feat/`, `backport/*` branch classes | clean merge | identical |
| `scripts/development-workflow/tests/test-local-ai-reviewer.sh` | neutral workflow config for default-backend resolution | clean merge | identical |
| `scripts/development-workflow/tests/test-pr-review-loop-failure-paths-4.sh` | suite cross-reference comment | clean merge | identical |
| `scripts/development-workflow/tests/test_runner_diagnostic_emitters.py` | Claude companion emitter case | clean merge | identical |
| `scripts/development-workflow/local-ai-reviewer.sh` | claude backend, round-bounded retries | one hunk: keep the durability-mode environment and use the upstream per-attempt timeout | identical |
| `scripts/development-workflow/pr-review-loop.sh` | human override, PR-Agent verification escalation | three hunks: keep local blocker confirmation and local infrastructure sections, add the human-override section and its output contract | resolved hunks only |
| `REVIEW.md` | trigger- or gate-only proof variant | two hunks: keep plant-set sufficiency and isolating-plant rules, add the trigger/gate-only variant | resolved hunks only |
| `docs/best-practices/3-testing.md` | trigger- or gate-only proof variant | one hunk: keep "Isolating plants per new assertion", add the trigger/gate-only paragraph after it | resolved hunks only |

## Ronda adaptations of new upstream tests

Two new upstream suites mock `gh` without the REST pull-files endpoint. Ronda's `local-ai-reviewer.sh` fails closed when it cannot read rename metadata (a local safeguard kept from earlier syncs), so the cases escalated with `rename_metadata_unavailable` instead of reaching the backend under test. Each mock now answers that endpoint with empty rename metadata, the same approach as Ronda's `test-local-ai-reviewer.sh`; no production code or assertion changed.

- `scripts/development-workflow/tests/test-local-ai-reviewer-pr-review-loop-dispatch.sh`: `1957_T-L1_*` (3 cases) failed before, 19/19 pass after.
- `scripts/development-workflow/tests/test-local-ai-reviewer-backend.sh`: `T-B11_copy_not_created_reason` failed before, 186/186 pass after.
- `scripts/development-workflow/tests/test-apply-readiness-labels.sh`: adds the `stale_ledger` case described under the isolating proof below (test-only).

## Migration note 0.51.0 (local-ai-reviewer Claude backend)

- Ronda never patched `local-ai-reviewer.sh` with a Claude backend or a different default, and had no local `local-claude-review-command.sh`; its local patch is the durability review mode, which is preserved.
- The repository default backend is not changed: `review.local_ai_reviewer.backend` is not set, so the built-in default stays `codex`. The reviewer configuration (`.ai-dev-workflow.yaml` `review:` block and the private local override) is untouched.
- No `doc_branch_default_max_wait` patch or `REVIEW.md` removal step exists locally.

## Discretionary items

- `.ai-dev-workflow.yaml`: the upstream comment-only documentation for `review.local_ai_reviewer.backend` was skipped to keep the `review:` block unchanged. Only `template.last_synced_version` and `template.last_synced_commit` changed.
- `CHANGELOG.md`: project-owned; release notes go through `changelog.d/181.changed.template-sync-v0-51-0.md`.
- Coverage check: `UNCOVERED_COUNT=0`, no `REQUIRED_ADDITION_MISSING`.

## Isolating violation proof for the new v0.51.0 gates

The gate predicates are identical to upstream v0.51.0; the files carry Ronda deltas outside the gates. Line numbers are Ronda file lines (upstream is lower in `workflow-lib.sh` and `local-ai-reviewer.sh`). Each listed assertion has one isolating source mutation (a planted violation) applied to the working tree. The named suite is run with the plant, the file is restored byte-for-byte (sha256 checked) and the suite is rerun. Mutations were confined to the disposable working tree at runtime commits `47838aa` (first twelve rows) and `d770c04` (later rows; scripts unchanged between them except the Ronda test case below); the full record (predicate, mutation, first failing case) is [`181-planted-proof.json`](181-planted-proof.json).

| Gate | Source line | Plant (predicate → mutation) | Planted result | Restored |
| --- | --- | --- | --- | --- |
| deferred follow-up must remain open | `item-completion-self-check.sh:1087` | `elif [ "$followup_state" != "OPEN" ]; then` → `elif false; then` | `test-item-completion-followups.sh` exit 1 (`deferred_closed_issue_blocks`) | exit 0 |
| deferred follow-up not closed by PR text | `item-completion-self-check.sh:1089` | `elif [ "$followup_closing" = "present" ]; then` → `elif false; then` | `test-item-completion-followups.sh` exit 1 (`deferred_closed_by_pr_body_blocks`) | exit 0 |
| `--followup` argument validation | `item-completion-self-check.sh:162` | `if ! [[ "$2" =~ ^[1-9][0-9]*=(fixed\|deferred)$ ]]; then` → `if false; then` | `test-item-completion-followups.sh` exit 1 (`malformed_rejected`) | exit 0 |
| self-check revalidates the live human override | `item-completion-self-check.sh:889` | override lookup → lookup `\|\| printf '{"by":"maintainer"}'` (accept without a live marker) | `test-item-completion-self-check.sh` exit 1 (`2116_human_override_old_head_exit_one`) | exit 0 |
| readiness revalidates the live human override | `apply-readiness-labels.sh:1291` | drop `&& workflow_reviewer_human_override_json …` (ledger record alone accepted) | `test-apply-readiness-labels.sh` exit 1 (`2116_readiness_override_old_head_refuses`) | exit 0 |
| override marker names the current head | `workflow-lib.sh:4993` | `select(($o.platform // "") == $platform and ($o.head // "") == $head)` → `select(($o.platform // "") == $platform)` | `test-pr-review-loop-human-override.sh` exit 1 (`2116a_older_head_has_no_effect`) | exit 0 |
| override author is a User, not a Bot | `workflow-lib.sh:4995` | `select(($c.user.type // "") == "User" and` → `select(true and` | `test-pr-review-loop-human-override.sh` exit 1 (`2116a_bot_author_has_no_effect`) | exit 0 |
| override author has write, maintain or admin | `workflow-lib.sh:5008` | `admin\|maintain\|write)` → `*)` | `test-pr-review-loop-human-override.sh` exit 1 (`2116a_read_only_author_has_no_effect`) | exit 0 |
| Claude review copy unchanged after review | `local-claude-review-command.sh:384` | `if ! after="$(fingerprint_copy)" \|\| [ "$after" != "$baseline" ]; then` → `if ! after="$(fingerprint_copy)"; then` | `test-local-claude-review-command.sh` exit 1 (`T-C7_1_exit`) | exit 0 |
| capacity retries stay inside the round budget | `local-ai-reviewer.sh:1777` | `if [ "$capacity_remaining" -le "$capacity_attempt" ]; then` → `if false; then` | `test-local-ai-reviewer-backend.sh` exit 1 (`T-B12b_capacity_budget_no_room_result`) | exit 0 |
| `feat/*` classified as feature | `workflow-lib.sh:587` | `feature/*\|feat/*)` → `feature/*)` | `test-workflow-lib-branch-prefix.sh` exit 1 (`feat alias`) | exit 0 |
| `backport/*` is its own implementation class | `workflow-lib.sh:595` | `backport/?*)` → `backport/planted-never)` | `test-workflow-lib-branch-prefix.sh` exit 1 (`backport`) | exit 0 |
| override marker names local-ai-reviewer | `workflow-lib.sh:4993` | `select(($o.platform // "") == $platform and ($o.head // "") == $head)` → `select(($o.head // "") == $head)` | `test-pr-review-loop-human-override.sh` exit 1 (`2116a_other_platform_has_no_effect`) | exit 0 |
| override marker carries a non-empty reason | `workflow-lib.sh:4994` | reason predicate → `select(true)` | `test-pr-review-loop-human-override.sh` exit 1 (`2116a_blank_reason_has_no_effect`) | exit 0 |
| optional marker `by` matches the comment author | `workflow-lib.sh:4996` | `select((($o.by // $c.user.login) \| tostring) == $c.user.login)` → `select(true)` | `test-pr-review-loop-human-override.sh` exit 1 (`2116a_by_mismatch_has_no_effect`) | exit 0 |
| PR-Agent verification escalates when local-ai-reviewer is not configured | `pr-review-loop.sh:6753` | `if ! grep -Fxq local-ai-reviewer <<<"$configured_local"; then` → `if false; then` | `test-pr-review-loop-pr-agent-coderabbit.sh` exit 1 (`2116_verification_not_configured_escalates`) | exit 0 |
| PR-Agent verification escalates after a failed local review on the head without retry | `pr-review-loop.sh:6765` | `if [ "${local_review_retry_head_record:-}" != "$head_sha" ]; then` → `if false; then` | `test-pr-review-loop-pr-agent-coderabbit.sh` exit 1 (`2116_verification_failed_on_head_escalates`) | exit 0 |
| PR-Agent verification escalates when the local pass is skipped | `pr-review-loop.sh:6776` | `if [ "$raw_local" = skipped ]; then` → `if false; then` | `test-pr-review-loop-pr-agent-coderabbit.sh` exit 1 (`2116_verification_disabled_distinct_reason`) | exit 0 |

The upstream suite alone did not isolate the ledger-head comparison `[ "$verdict_head" = "$head_sha" ]` at `apply-readiness-labels.sh:1291`: its plant (`true &&`) survived. Ronda adds one case to the upstream 2116 loop in `test-apply-readiness-labels.sh`, `stale_ledger`: the ledger records the override for an older head while a valid live marker names the current head. With the guard it refuses (`reviewer-evidence-unreadable`, no label); with the plant it passes the gate (`2116_readiness_override_stale_ledger_refuses` fails, suite exit 1); restored, the suite exits 0. Recorded as `readiness_override_ledger_head` in the proof file.

## Validation

- `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` (820 tests): pass.
- ShellCheck (`-S warning`) on every changed shell script: no findings.
- Workflow suites: 159 selected by `select-test-suites.sh` (`workflow-lib.sh` triggers the full selection); 157 passed on the first run, and the two suites above pass after the mock adaptation.
