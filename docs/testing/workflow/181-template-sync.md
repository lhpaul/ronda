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

## Migration note 0.51.0 (local-ai-reviewer Claude backend)

- Ronda never patched `local-ai-reviewer.sh` with a Claude backend or a different default, and had no local `local-claude-review-command.sh`; its local patch is the durability review mode, which is preserved.
- The repository default backend is not changed: `review.local_ai_reviewer.backend` is not set, so the built-in default stays `codex`. The reviewer configuration (`.ai-dev-workflow.yaml` `review:` block and the private local override) is untouched.
- No `doc_branch_default_max_wait` patch or `REVIEW.md` removal step exists locally.

## Discretionary items

- `.ai-dev-workflow.yaml`: the upstream comment-only documentation for `review.local_ai_reviewer.backend` was skipped to keep the `review:` block unchanged. Only `template.last_synced_version` and `template.last_synced_commit` changed.
- `CHANGELOG.md`: project-owned; release notes go through `changelog.d/181.changed.template-sync-v0-51-0.md`.
- Coverage check: `UNCOVERED_COUNT=0`, no `REQUIRED_ADDITION_MISSING`.

## Validation

- `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` (820 tests): pass.
- ShellCheck (`-S warning`) on every changed shell script: no findings.
- Workflow suites: 159 selected by `select-test-suites.sh` (`workflow-lib.sh` triggers the full selection); 157 passed on the first run, and the two suites above pass after the mock adaptation.
