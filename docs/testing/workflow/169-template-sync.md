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
