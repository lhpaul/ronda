# Template v0.50.0 sync evidence (#172)

## Scope and provenance

- Incoming template: `lhpaul/ai-dev-framework-template`, commit `50d99e4738704533105b6e404f4468e69d6e3f42` (v0.50.0).
- Previous sync: v0.48.9 (`a800c2b28d65afe667add4dfaf0ddf4daad8bbd1`, PR #170). Existing per-path provenance in `.ai-dev-workflow.sync-state.json` takes precedence; the previous sync commit was supplied as the verified base only for paths without a ledger entry (new upstream files).
- Role: `single_repo`; 737 selected always-sync paths. Project-specific files were not replaced.
- Automatic batch (725 paths, preview digest `b314f2c05643df78b265bea14a2f4d835d1792b088a67d979df01c1d0002a486`, apply returned success): 20 additions + 69 direct updates + 27 clean merges + 32 local changes retained + 577 unchanged.
- Twelve paths had three-way conflicts against Ronda's local safeguards. They were merged by hand, excluded from the automatic apply with named `--decline` arguments, and keep their previous per-path provenance. No baseline evidence was fabricated or advanced for them.
- `action.yml`, application code, the default prompt/model, the reusable Ronda Action, GitHub App permissions and model credentials are unchanged. No release or merge is performed by the agent.

## Local adaptations preserved (manual merges)

- `coderabbit-cli-reviewer.sh`: keep the SIGPIPE-safe here-string match.
- `local-ai-reviewer.sh`: keep fail-closed rename metadata and pass the durability-mode environment into the new bounded capacity-retry loop.
- `local-codex-review-command.sh`, `local-http-review-command.sh`: adopt the upstream evidence-aware prompt and keep the durability sentence.
- `pr-review-loop.sh`: keep the exact StatusContext completion-guard match, SIGPIPE-safe matching and local infrastructure outcome evidence; adopt upstream evidence verification, reviewer-loop history publication, retry attempt accounting and hotfix wording.
- `run-epic-audit-trail.sh`: keep Ronda's shared audit redaction helper (covers the same local-path rules).
- `workflow-lib.sh`: adopt upstream issue-number parsing; keep Ronda's audit redaction helper.
- `docs/workflow/development-workflow/README.md`: adopt the upstream reviewer defaults text.
- Tests: `test-local-ai-reviewer.sh` (both mock sets plus Ronda durability tests), `test_runner_diagnostic_emitters.py` (REST rename metadata mock), `test-pr-review-loop-failure-paths-4.sh` and `test-reviewer-preflight.sh` (upstream).
- `.claude/settings.json`: adopt the upstream secret-file deny list.
- `pr-policy.yml`: adopt only the hotfix rule (skipped reviewer summaries are refused for `hotfix/*`); keep Ronda's early-lifecycle behavior.
- `pr-agent.yml` (model-credential guard) and `markdown-lint.yml` (durability-mode lint) are kept: upstream would remove Ronda's additions.
- `.ai-dev-workflow.yaml`: version/commit metadata and the required `stage_role_tool_or_path_denied` stop condition. The `review:` block and Agent merge policy are untouched.

## #162 reconciliation

Upstream #2005 (durable atomic writes and recovery fsync) is included in v0.50.0. `sync-template-merge.py` is now byte-identical to upstream, so Ronda's local fsync correction is superseded, and `test_sync_template_merge.py` and the new durability suites pass. This resolves the recovery-durability blocker tracked in #162.

## Validation

- `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`: pass.
- Workflow suites: 149 selected; every suite passed after fixes to two merged test files and reruns (see PR for details). Fixture-based suites read tracked files, so they were rerun after the sync commit.
- Shell, snippet, GraphQL, durability and doctrine lints and the changelog fragment checks pass; workflow YAML parses.
