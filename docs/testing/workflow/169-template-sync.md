# Template v0.48.9 sync evidence (#169)

## Scope and provenance

- Incoming template: `lhpaul/ai-dev-framework-template`, commit `a800c2b28d65afe667add4dfaf0ddf4daad8bbd1` (v0.48.9).
- Maintainer-verified bootstrap: `493473b11c3f46479aaf5db0c918ed49edb600a3` (v0.48.4, previous sync PR #161). Existing per-path provenance takes precedence.
- Role: `single_repo`; no manifest entries skipped by role. Project-specific files are excluded from automatic replacement.
- Automatic batch: 713 paths = 137 additions + 83 direct updates + 22 clean merges + 33 local changes retained + 438 unchanged.
- Four additional paths were merged manually, excluded from automatic apply with named `--decline` arguments, and retain their prior per-path provenance. No baseline evidence was fabricated or advanced for them.
- Approved automatic preview digest: `0505effe26a9fd1c105b74a648d74d0afcc543e24a951d58f794c17b38c0b02b`; apply returned `RESULT=applied`.
- `action.yml`, application code, the default prompt/model, the reusable Ronda Action, and fsync issue #162 are outside scope. No release or merge is authorized.

## Local adaptations preserved

- `coderabbit-cli-reviewer.sh`: retain SIGPIPE-safe matching and combine it with upstream safe diagnostic emission.
- `local-ai-reviewer.sh`: retain fail-closed rename metadata handling and combine it with upstream diff-read failure handling.
- `pr-review-loop.sh`: retain the exact StatusContext guard classification, SIGPIPE-safe matching, and local infrastructure outcome evidence; incorporate upstream configured-check matching, redaction, policy dispatch, and retry tracking.
- `run-epic-audit-trail.sh`: chain upstream redaction with Ronda's audit path/token redaction.
- Preserve the repository `review:` configuration and the Agent merge policy in `AGENTS.md`.
- Keep `pr-agent.yml`: upstream would remove Ronda's missing-model-credential failure guard. Trusted-base exclusions remain unchanged.
- Keep `markdown-lint.yml`: upstream would remove Ronda's durability-mode lint.
- Keep `update-tracker-on-merge.yml`: only punctuation differs. No other special-handling files changed.
- Skip optional project-file additions; update only the required template version/commit metadata and add this evidence plus a changelog fragment.

## v0.48.5 migration

Adopt `workflow-tests.yml` and `pr-policy.yml` together with the new loop. The nightly schedule remains present, but select/test/result require template identity or explicit `WORKFLOW_TESTS_NIGHTLY_ENABLED == 'true'`. The variable was absent at preflight; no opt-in was created. Preserve the two-path PR filter. The legacy harness workflow is absent. `develop` has no branch protection requiring the filtered harness check. PR policy uses `workflow_dispatch` for canonical summaries, with no `issue_comment` trigger. Until the migration reaches the default branch, dispatch may fail harmlessly while the existing comment trigger still refreshes policy.

Migration structural checks passed before commit `d3477c7`. Workflow YAML parses successfully. Manifest coverage returned `RESULT=clean`, with zero required additions missing.

## Clean merges

- `docs/workflow/development-workflow/protocols/91-orchestrate-work-protocol.md`
- `scripts/development-workflow/apply-readiness-labels.sh`
- `scripts/development-workflow/claude-code-action-reviewer.sh`
- `scripts/development-workflow/item-completion-self-check.sh`
- `scripts/development-workflow/local-codex-review-command.sh`
- `scripts/development-workflow/local-http-review-command.sh`
- `scripts/development-workflow/post-merge-cleanup.sh`
- `scripts/development-workflow/pr-ci-loop.sh`
- `scripts/development-workflow/pr-ownership-guard.sh`
- `scripts/development-workflow/sync-template-merge.py`
- `scripts/development-workflow/tests/test-consumer-tree-test-gating.sh`
- `scripts/development-workflow/tests/test-local-ai-reviewer.sh`
- `scripts/development-workflow/tests/test-pr-review-loop-cycles-labels.sh`
- `scripts/development-workflow/tests/test-pr-review-loop-staged-gates.sh`
- `scripts/development-workflow/tests/test-pr-review-loop.sh`
- `scripts/development-workflow/tests/test-reviewer-loop-guard-workflow.sh`
- `scripts/development-workflow/tests/test-run-epic-audit-trail.sh`
- `scripts/development-workflow/tests/test_pr_agent_runtime.py`
- `scripts/development-workflow/tests/test_sync_template_merge.py`
- `scripts/development-workflow/workflow-batch-plan.sh`
- `scripts/development-workflow/workflow-lib.sh`
- `scripts/development-workflow/workflow-next-action.sh`

## Validation

- `npm ci`, `npm run typecheck`, `npm run lint`: passed.
- `npm test`: 742 passed, zero failed or skipped.
- ShellCheck: 235 shell files passed, one process per file.
- Shell guard lint: passed. Shell snippet lint: 141 files, 9 fences, 23,644 changed lines, zero findings. GraphQL literal lint: 84 files, 26 queries, zero findings; query-schema changes were not introduced by this sync.
- Two template-owned DSH runbook spec/plan links now target the pinned upstream tree because those project-owned specs are not shipped to consumers.
- The GFM fixture `epic_plus_mixed_indent.md` intentionally contains a space followed by a tab and lacks a final newline; preserve these parser test inputs.
- Workflow harnesses and PR review/CI gates: results recorded in the PR after execution.
- No live Ronda review pass or model-credential run was executed. Normal configured PR automation remains subject to the workflow gates.

## Gate consistency and isolating violation proof

These are executed fixture-only checks. A negative plant makes the **production gate** refuse (nonzero/red/Deferred/Interrupted); the enclosing test passes because it observes that refusal. The clean or restored input then permits the documented outcome. Each listed malformed key, changed head, outage, or ordering violation is injected independently. No real merge, release, tracker write, credential, or model service is used by these tests.

| Changed gate and concrete assertion location | Isolated plant: observed refusal | Clean/restored control: observed acceptance and next action |
| --- | --- | --- |
| CI head identity, `test-pr-ci-loop.sh:332` | `MOCK_CHANGE_HEAD=1`: `RESULT=red`, `REASON=ci_evidence_lookup_failed` | Same unchanged head, control at line 203: `RESULT=green`; continue readiness |
| CI workflow applicability, `test-pr-ci-loop.sh:310` | Each applicable missing workflow remains `expected_checks_missing`; unreadable definitions, PR context failure, and ambiguous trigger syntax refuse independently at lines 332 and 376 | Closed-only definitions and proven literal base exclusions at lines 320 and 360: green; omit only proven inapplicable expectations |
| CI event trust, `test-pr-ci-loop.sh:341` | Divergent PR-head definitions cannot remove a `pull_request_target` expectation; missing target workflow remains red, exit 1 | Proven inapplicable `pull_request` workflow control at line 320: green; other event families remain expected |
| Configured reviewer partition, `test-pr-ci-loop.sh:393` | Independently malformed name/status/typename/workflow shapes do not receive reviewer exemption; ordinary failure/pending and missing workflow still block at lines 440 and 455 | Recognized configured reviewer controls at line 420: green with reviewer count 1; apply the same partition in CI/readiness |
| Staged admission policy, `test_workflow_merge_budget.py:2281` | Each of batch size `0`, `true`, `101`, unknown mode, and unknown key: Deferred; out-of-order backport/publication requests dispatch zero merges | Valid staged policy at line 2226: Admitted; valid ordered continuation at line 2249 reaches Completed |
| Stage capacity and ownership, `test_workflow_merge_budget.py:2220` | Unaffordable pair admits no prefix; oversized tracker batch at line 2293: Deferred, `cannot fit`, zero merges | Affordable 12-item staged set at line 2226: each duty appears once, each stage fits quota plus reserve; advance one frozen stage at a time |
| Recovery quota boundaries, `test_workflow_merge_budget.py:2249` | Set remaining quota to zero after verified production merge: Deferred; preserve completed merge and pending publication | Restore quota to 5000, resume: Completed with exactly two pair merges, two tracker writes and one stamp per issue |
| Partial recovery proofs, `test_workflow_merge_budget.py:61` and `:88` | Independently plant a second-duty read outage or insufficient quota after recovery: Stop/Deferred; retain the completed prefix | Remove outage or restore quota to 5000: recovery/admission succeeds in the same generation, with the completed prefix read only once |
| Uncertain stamp and final barrier, `test_workflow_merge_budget.py:2302` | `stampPostReadOutage='13'`: Interrupted with uncertain stamp; missing independent readback at line 2324 raises `Stop: lack independent verification` | Remove outage, resume: completed with one stamp per issue and no duplicate tracker duty; verified sequence at line 2249 completes |
| Multi-window tracker recovery, `test_workflow_merge_budget.py:2335` | Quota exhaustion after first tracker mutation: Deferred, next stamp/cleanup pending; repeated expensive recovery readbacks at line 2364 defer without replaying prefix | Restore quota/reset window, resume: Completed with exactly two tracker mutations, two merges, and one stamp each; same recovery generation across windows |
| Explicit local source authority, `test_private_source_authority.py:158` | Replace only the selected YAML with malformed input: exit 2, empty functional stdout, safe diagnostic; no unselected source fallback | Valid selected source succeeds; pure redactor reads no private configuration; functional authority remains separate from sanitized diagnostics |
| Diagnostic failure boundary, `test_runner_diagnostic_emitters.py:175` | Substitute a failing sanitizer: the real local-review entry exits 2 with the generic safe error | Valid structured sanitizer at line 187 retains result/count semantics while redacting unsafe fields |
| Consumer nightly jobs, `test-workflow-tests-nightly-gate.sh:432` | Schedule + consumer identity + variable absent/false/yes/1: select/test/result do not run | Change only opt-in to true/True/TRUE: jobs run; template identity and non-schedule controls at lines 505–516 remain enabled |
| Canonical-summary dispatch, `test-reviewer-loop-pr-policy-dispatch.sh:77` | Absent workflow or explicit opt-out skips; dispatch failure emits failed telemetry without changing the enclosing loop result | Available workflow dispatches the selected PR; lines 109–125 preserve the clean enclosing result, reason and exit code |

Test filenames in the table resolve under `scripts/development-workflow/tests/`.
The same gate inputs/outcomes are described in the synced integration/protocol surfaces. CI/readiness share the configured-reviewer partition; staged release admission and recovery are documented in the prepare-release protocol and guardrails; nightly/dispatch policy is mirrored by the v0.48.5 migration note and committed workflows. The readiness matrix split is parity-preserving test scaffolding: it retains membership, order, per-case digest and adjacent assertions. It does not change production acceptance rules, and is not claimed as a new source-mutation proof.

The additional **source-mutation** control in `test_workflow_merge_budget.py:1640` disables exactly the admission predicate at `workflow-merge-budget.py:1217` in a disposable fixture. With remaining quota 1, baseline refuses with zero merge dispatches; disabling that predicate makes the no-merge assertion fail because a forbidden fixture merge appears; restoring it returns to zero dispatches. The committed [proof record](169-planted-admission-proof.json) binds the concrete source line, source digest and reviewed commit. It contains no local checkout identity.

Executed proof results at runtime commit `2bff206214957e5074915a3c519d56d8d1b948b2`:

- `test-pr-ci-loop.sh`: 113 assertions passed, zero failed, including the individually injected head/evidence/trigger/reviewer states above.
- Focused merge-budget run: 9 tests passed, including the explicit source-mutation control and all listed staged-release cases. Two additional partial-prefix recovery controls passed separately.
- `test-workflow-tests-nightly-gate.sh`: 34 assertions passed; `test-reviewer-loop-pr-policy-dispatch.sh`: 11 passed.
- `test_private_source_authority.py -v`: 31 tests passed; diagnostic controls `test_D01_sanitizer_failure_in_real_local_entry` and `test_D03_structured_diagnostic_keys_and_failure` passed in the full diagnostic run.

These proof results cover gate-input rejection and restored acceptance. Only the separately identified admission test is claimed as a source-mutation proof. All mutations were confined to disposable, mocked fixtures.

## Consumer fixture compatibility

The diagnostic suite's `local_entry` GitHub stub originally returned exit 99 for the REST pull-files endpoint. Ronda's retained rename-metadata guard correctly stopped at `rename_metadata_unavailable`, preventing the diagnostic scenarios from reaching their intended sinks. Supply the complete synthetic non-rename metadata for the same `README.md` already named by the diff stub. Production code and every diagnostic assertion remain unchanged. Before the fixture correction, D82 failed with `2 != 0` and `REASON=rename_metadata_unavailable`; after correction, focused D82, D17 and D56 all passed (3 tests). The full diagnostic suite is rerun after this adaptation.

Additional integration controls preserve the retained Ronda contracts: the two other direct local-entry stubs also return complete rename metadata; forced-review fixture controls provide the required synthetic rationale and mock its publication; the renderer asserts the additional `LOCAL_OUTCOME_CLASS=not_attempted` record instead of assuming three lines. D91, D93, D94, D96 and D99 passed together (5 tests). No production force-policy or source-error precedence was relaxed.

The D94 empty-record control additionally exposed Bash 3.2 `nounset` errors in two retained local outcome-record array loops. Use the established `${array[@]+"${array[@]}"}` expansion so empty arrays perform zero iterations while populated records keep their argument boundaries. Before correction the control emitted `platform_result_records[@]: unbound variable`; after correction the focused gate/source/force matrix passed in both installed Bash versions. This portability correction changes no gate decision or product behavior. Earlier in-flight diagnostic processes loaded the pre-correction fixtures and are superseded by the final complete diagnostic rerun.
