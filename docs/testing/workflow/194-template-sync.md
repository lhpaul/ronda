# Template v0.52.0 sync evidence (#194)

## Scope and provenance

- Incoming template: `lhpaul/ai-dev-framework-template`, tag `v0.52.0`, commit `92d58fa31597e7abd34d4a99a1eae2ebcffcdf94`.
- Previous sync: v0.51.0 (`bada6da17b6cf0edb6f1629e314607fefdd73a20`, PR #182). Existing per-path provenance in `.ai-dev-workflow.sync-state.json` takes precedence. The previous sync commit was supplied as the verified base (`--base-source template`) only for the 13 new upstream files that had no ledger entry.
- Role: `single_repo`; 760 selected always-sync paths. No migration note applies when syncing from v0.51.0.
- Automatic batch (745 paths, preview digest `62f50bcd98cb42c09d2d1a97b8f1daf0378887040df40313f4ddfe049017a86c`, apply returned success): 13 additions, 40 direct updates, 21 clean merges, 37 local changes retained and 634 unchanged.
- Fifteen paths had three-way conflicts against their ledger base. They were merged by hand, excluded from the automatic apply with named `--decline` arguments, and keep their previous per-path provenance. No baseline evidence was fabricated or advanced for them.
- `action.yml`, application code, the default prompt and model, the reusable Ronda Action, GitHub App permissions and model credentials are unchanged. No release or merge is performed by the agent.

## Manual merges

As in #182, several declined paths still carry an older ledger base although their content already contains the previous hand merge. Each was merged with `git merge-file` using the v0.51.0 upstream copy as the effective base (Ronda = v0.51.0 + local safeguards). The Ronda delta column counts the lines that differ from upstream before (Ronda vs v0.51.0) and after (merged vs v0.52.0).

| Path | Upstream v0.51.0 → v0.52.0 | Result | Ronda delta before → after |
| --- | --- | --- | --- |
| `REVIEW.md` | unchanged | content unchanged | 13 → 13 |
| `docs/best-practices/3-testing.md` | unchanged | content unchanged | 23 → 23 |
| `scripts/development-workflow/local-codex-review-command.sh` | unchanged | content unchanged | 6 → 6 |
| `scripts/development-workflow/local-http-review-command.sh` | unchanged | content unchanged | 6 → 6 |
| `scripts/development-workflow/run-epic-audit-trail.sh` | unchanged | content unchanged | 41 → 41 |
| `scripts/development-workflow/tests/test-pr-review-loop-failure-paths-4.sh` | unchanged | content unchanged | 21 → 21 |
| `scripts/development-workflow/coderabbit-cli-reviewer.sh` | process-group TERM grace (#2172/#2198) | clean merge | 8 → 8 |
| `scripts/development-workflow/local-ai-reviewer.sh` | process-group TERM grace (#2172/#2198) | clean merge | 335 → 335 |
| `scripts/development-workflow/workflow-lib.sh` | `print_kv_escaped` chunking (#1539), stale `In Development` correction (#1811), `workflow_branch_is_implementation` (#2183) | clean merge | 407 → 407 |
| `scripts/development-workflow/tests/test-local-ai-reviewer.sh` | watchdog cases | clean merge | 186 → 186 |
| `scripts/development-workflow/tests/test_runner_diagnostic_emitters.py` | emitter cases | clean merge | 18 → 18 |
| `docs/workflow/development-workflow/protocols/93-automated-reviewer-loop-protocol.md` | #1817 `config_error`, #1853 re-review | one hunk: adopt the #1817 paragraph and keep Ronda's `local_infrastructure_failure` / `local_infrastructure_repeated` text | 65 → 65 |
| `docs/workflow/development-workflow/protocols/91-orchestrate-work-protocol.md` | #1811, `feat/*` / `backport/*` wording, inline Step 8a classifier (#2183) | one hunk: keep Ronda's Step 8a call to `pr-label-readiness-checklist.sh` instead of the inline checklist | wording hunks adopted |
| `scripts/development-workflow/pr-review-loop.sh` | #1817, #1853, #1578, #1764, #2183 | four hunks, described below | resolved hunks only |
| `scripts/development-workflow/tests/test-pr-review-loop-staged-gates.sh` | #1853 cases | two hunks: keep Ronda's blocker-confirmation state and stub, add the `needs_fixes_evidence` stub and the new record variables | resolved hunks only |

`pr-review-loop.sh` hunks:

1. Usage text: keep Ronda's `PR_REVIEW_LOOP_EXPENSIVE_OVERRIDE_JUSTIFICATION` entry and add the upstream "(including local_reviewer_not_configured)" wording.
2. Second local pass failed-head record (#1853): upstream replaced the single `local_second_pass_failed_head_record=` assignment with `reviewer_loop_record_local_failed_head`. Ronda records the failed head at three sites inside its local blocker confirmation. Each site now calls the upstream recorder with the same conditions: unconfirmed and confirmed blockers record `needs_fixes` with the review's evidence fingerprint (still skipped when the head moved during the run), and the escalation branch records `infrastructure`.
3. History record arguments: keep Ronda's local infrastructure and blocking-findings arguments and add `localSecondPassFailedKind` / `localSecondPassFailedEvidence`.
4. Global state: keep Ronda's blocker-confirmation variables and add the two new record variables.

## Ronda-local adaptation

Ronda's Step 8a runs `scripts/development-workflow/pr-label-readiness-checklist.sh` (project-owned) instead of the inline protocol block. Upstream #2183 changed that inline block to classify branches with `workflow_branch_is_implementation`. The same classifier now drives the script, so `feat/*` and `backport/*` PRs need `ready-for-regression` like other implementation PRs. `test-pr-label-readiness-checklist.sh` adds `missing_regression_label_feat_exit_2` and `missing_regression_label_backport_exit_2`.

Isolating proof: restoring the pre-#2183 `case` classifier (`feature/*|fix/*|hotfix/*|refactor/*|backport/hotfix/*`) at `pr-label-readiness-checklist.sh:198` makes exactly those two cases fail (17 passed, 2 failed). With the file restored byte-for-byte (sha256 checked), the suite passes 19/19.

## Workflows and special handling

- `.github/workflows/pr-policy.yml` (#1838): clean three-way merge. On `pull_request_target`, a missing reviewer-loop summary, or a clean summary for an older head, now posts the guard status `pending` and leaves the job green, instead of `failure`. The `workflow_dispatch` run that `pr-review-loop.sh` triggers after posting its summary flips the status to success or failure. Dispatch runs, non-clean summaries, skipped hotfix summaries and fetch failures still fail. Ronda's local `missing_summary_is_expected_for_event` exit is kept; with the pending window it only applies to the remaining failure cases. The workflow runs from the base branch on `pull_request_target`, so the change takes effect after merge.
- `.claude/settings.json` (#2190): not changed in this PR (see below).
- No other special-handling path changed upstream.

## #2190 (shared local workflow config)

Upstream v0.52.0 lets agents read `.ai-dev-workflow.local.yaml` and drops its `Read` deny from `.claude/settings.json`, on the condition that the file holds no secret values. The agent could not verify that condition: the current Read deny keeps the file closed to it, by design. The settings and `AGENTS.md` safety wording are therefore left as they are, pending the maintainer's decision. The rest of v0.52.0 does not depend on it; `test_runner_secret_prevention.py` checks those controls only in the template repository.

## Reviewer configuration and #1817

- The committed `review:` block in `.ai-dev-workflow.yaml` and the private local override are unchanged. The effective configuration, resolved through `workflow-lib.sh` (the same path `pr-review-loop.sh` uses), is: `on_draft.runner` = `claude`, `on_draft.github` = `local-ai-reviewer`, `on_ready.github` = `local-ai-reviewer`. No Bugbot.
- #1817 escalates with `config_error` only when an expensive reviewer (`codex-github`) is configured and `local-ai-reviewer` is in neither GitHub phase. With the local override, no expensive reviewer is configured, so the gate is not evaluated. Without the override, the committed config has `codex-github` on ready and `local-ai-reviewer` on draft, so the gate still sees a local reviewer and does not escalate. Both setups are compatible.

## Discretionary items

- `AGENTS.md`: adds the `/review-backlog` row and alias (additive). Ronda's Agent merge policy and Safety Rules are unchanged.
- `.ai-dev-workflow.yaml`: only `template.last_synced_version` and `template.last_synced_commit` changed.
- `CHANGELOG.md`: project-owned; release notes go through `changelog.d/194.changed.template-sync-v0-52-0.md`.
- Coverage check: `RESULT=clean`, `REQUIRED_ADDITION_MISSING_COUNT=0`.

## Ronda adaptation of a new upstream test

`test-expensive-gate-config-error.sh` (#1817) forces the expensive reviewer with `PR_REVIEW_LOOP_FORCE_EXPENSIVE_REVIEWERS=1` but sets no justification. Ronda keeps its local rule that a forced expensive review needs `PR_REVIEW_LOOP_EXPENSIVE_OVERRIDE_JUSTIFICATION`, so the two force cases deferred with `expensive_override_missing_justification` (5 assertions failed). The test now exports a synthetic justification for those two cases, as Ronda's `test-expensive-reviewer-gate.sh` already does; no production code or assertion changed. Result: 40/40.

## Validation

- `npm ci`, `npm run typecheck`, `npm run lint` and `npm test` (874) pass.
- Workflow suites: `select-test-suites.sh` selected all 165 suites (full run triggered by `workflow-lib.sh`). In a 6-way parallel run, 158 passed. The other seven:
  - `test-expensive-gate-config-error.sh`: fixed by the adaptation above (40/40).
  - `test-config-error-diagnostics.sh`: lock contention with another suite's fixture PR in the parallel run; 100/100 when run alone.
  - `test-local-ai-reviewer.sh`, `test-workflow-merge-budget-part-4.sh`, `test-workflow-merge-budget-part-5.sh`, `test-runner-diagnostic-emitters.sh`: timing-sensitive under load; all pass when rerun serially.
  - `test-local-codex-review-command.sh`: `1843_reviewer_open_stdin_prompt` and `1843_reviewer_fallback_open_stdin_prompt` (under-5-second timing bounds) fail on this workstation both on this branch and on unchanged `develop`. Pre-existing and environment-specific; neither the script nor the test changes in this sync. CI is authoritative.
- ShellCheck (`--severity=warning`, as CI) on the 48 changed shell scripts: clean. All workflow YAML files parse. Markdown lint: 0 errors. Coverage check: `RESULT=clean`.
