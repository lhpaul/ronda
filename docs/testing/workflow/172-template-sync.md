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

## Gate consistency and isolating violation proof

The changed or new gates are upstream v0.50.0 code, identical to the pinned template except where noted. Each listed assertion has one isolating source mutation (a planted violation) applied to the working tree, the named suite run, the file restored byte-for-byte and the suite rerun. Mutations were confined to the disposable working tree at runtime commit `0e52d9e`; the proof record is [`172-planted-proof.json`](172-planted-proof.json).

| Gate | Source line | Plant (predicate → mutation) | Planted result | Restored |
| --- | --- | --- | --- | --- |
| hotfix review enforcement | `pr-policy.yml:286` | `[[ "${BRANCH:-}" == hotfix/* ]] && [ "$LATEST_SUMMARY_RESULT` → `[[ "${BRANCH:-}" == nohotfix/*` | `test-reviewer-loop-guard-workflow.sh` exit 1 | exit 0 |
| stage-role denial: no resume after repeated denial | `stage-role-denial-decision.py:46` | `and not event.get('denied_again', False))` → `and True)` | `test-stage-role-permission-denial.sh` exit 1 | exit 0 |
| evidence proof request binding | `review-evidence-context.py:181` | `or proof["request_id"] != request_id` → `or False` | `test-review-evidence-context.sh` exit 1 | exit 0 |
| evidence freshness (snapshot currency) | `review-evidence-context.py:114` | `or current["snapshot_sha256"] != context.get("snapshot_sha25` → `or False):` | `test-review-evidence-context.sh` exit 1 | exit 0 |
| hub worker product repository probe | `hub-worker-preflight.py:181` | `for product in products:
        github_probe(product["repo"` → `pass` | `test-hub-worker-preflight.sh` exit 1 | exit 0 |
| retry attempt identity binding (history) | `reviewer-loop-history.py:68` | `if bindings.setdefault(attempt["id"], binding) != binding:` → `if False:` | `test-reviewer-loop-history.sh` exit 1 | exit 0 |
| hub preflight: canonical run id | `hub-worker-preflight.py:159` | `if str(uuid.UUID(value)) != value:` → `if False:` | `test-hub-worker-preflight.sh` exit 1 | exit 0 |
| hub preflight: timestamp ordering | `hub-worker-preflight.py:209` | `if not start <= selected <= invoked <= checked <= now:` → `if False:` | `test-hub-worker-preflight.sh` exit 1 | exit 0 |
| hub preflight: result bound to run id | `hub-worker-preflight.py:212` | `or evidence["run_id"] != rid` → `or False` | `test-hub-worker-preflight.sh` exit 1 | exit 0 |
| hub preflight: product set binding | `hub-worker-preflight.py:230` | `or sorted(actual) != sorted(expected)` → `or False` | `test-hub-worker-preflight.sh` exit 1 | exit 0 |
| evidence proof: schema | `review-evidence-context.py:177` | `or proof.get("schema") != PROOF_SCHEMA` → `or False` | `test-review-evidence-context.sh` exit 1 | exit 0 |
| evidence proof: status verified | `review-evidence-context.py:179` | `if (proof.get("status") != "verified"` → `if (False` | `test-review-evidence-context.sh` exit 1 | exit 0 |
| evidence proof: snapshot binding | `review-evidence-context.py:182` | `or proof.get("snapshot_sha256") != canonical["snapshot_sha25` → `or False):` | `test-review-evidence-context.sh` exit 1 | exit 0 |
| evidence proof: sources non-empty/unique | `review-evidence-context.py:187` | `or len(set(sources)) != len(sources)):` → `or False):` | `test-review-evidence-context.sh` exit 1 | exit 0 |
| evidence proof: request cannot cite itself | `review-evidence-context.py:194` | `if ident == request_id or not comments.get(ident, "").strip(` → `if not comments.get(ident, "")` | `test-review-evidence-context.sh` exit 1 | exit 0 |
| evidence freshness: repository/PR/head identity | `review-evidence-context.py:116` | `if any(previous.get(k) != current[k] for k in ("repository",` → `if False:` | `test-review-evidence-context.sh` exit 1 | exit 0 |
| hub preflight: hub repository id binding | `hub-worker-preflight.py:229` | `if (evidence["hub_repo_id"] != digest(hub_slug) or` → `if (False or` | `test-hub-worker-preflight.sh` exit 1 | exit 0 |
| hub preflight: hub checkout id binding | `hub-worker-preflight.py:229` | `or evidence["hub_checkout_id"] != digest(str(hub))` → `or False` | `test-hub-worker-preflight.sh` exit 1 | exit 0 |

Not isolated by the upstream suites: the `config_id` binding (`hub-worker-preflight.py:230`) survives its mutation, so that one assertion has no isolating proof here. It is an upstream coverage gap in unmodified upstream code, reported rather than hidden. The remaining upstream assertions are byte-identical to the pinned template and are exercised by the upstream suites, which passed in full; this sync adds no Ronda change to them.

### Decision-gate consistency matrix

| Gate | Inputs | Allowed outcomes | Next action | Mirrored surfaces | Executed example |
| --- | --- | --- | --- | --- | --- |
| Evidence verification and freshness | PR-Agent summary, published evidence snapshot hash, verification request id, proof schema and sources | `verified`/refused (`proof_missing`, `proof_mismatch`); context `changed`, `unchanged`, `context_unavailable`, `identity_mismatch`, `manifest_inconsistent` | Verified current proof → reviewer `clean`; unverified → `needs_fixes`; evidence changed while reviewing → `needs_rerun`; context unavailable → `escalate`; never cleared by the request itself or workflow bookkeeping | `review-evidence-context.py`, `local-ai-reviewer.sh`, `workflow_pr_agent_evidence_verdict` in `workflow-lib.sh`, `_pr_agent_classify` in `pr-review-loop.sh`, `apply-readiness-labels.sh --inspect-pr-agent` | `test-local-ai-reviewer.sh` 2061 cases (verified, missing, unverified, stale, code, bookkeeping source, drift, API failure); `test-review-evidence-context.sh` |
| Reviewer retry accounting | Retry attempt id, reviewed/live head, run id, prior history entries | History `available`/`unavailable` | Each explicit retry reserves a unique attempt and spends one slot on both cycle axes; conflicting attempt bindings make history unavailable, which blocks the retry | `reviewer-loop-history.py`, `pr-review-loop.sh` (`reviewer_loop_local_retry_allowed`, `local_review_retry_attempt`), Protocol 93 | `test-reviewer-loop-history.sh`, `test-pr-review-loop*.sh` |
| Stage-role denial | cause (`tool_path`, `credential`, `mixed`, `unknown`, `unreachable`, `generic`), read-only/handoff stops, correction, uncertainty, reconciliation, repeated denial, mode | `existing_error`, `blocked` with named stop, `resume_same_role` | Blocked → operator handoff and held dependents; `resume_same_role` only after correction without repeated denial; a fresh review gate when the review changed | `stage-role-denial-decision.py`, Protocol 91, guardrails stop `stage_role_tool_or_path_denied` (added to `.ai-dev-workflow.yaml`) | `test-stage-role-permission-denial.sh` |
| Hub worker preflight | hub/worker checkouts, product repositories, GitHub auth | `pass` or a named failing check with guidance (`configuration`, `github_auth`, `github_access`) | Pass → orchestration may write; any failure stops before Remote Control writes | `hub-worker-preflight.py`, `cursor-my-machines.md` | `test-hub-worker-preflight.sh`, `test_hub_worker_preflight.py` |
| Hotfix reviewer enforcement | head branch, latest summary result and head match | `failure` for a skipped hotfix summary; `success` for clean current-head review; release PRs keep the skip exemption | Hotfix needs completed reviewer evidence before readiness | `pr-policy.yml` (hotfix rule only), `reviewer-loop-guard` suite, `pr-review-loop.sh` wording | `test-reviewer-loop-guard-workflow.sh` (`hotfix_skipped_release_summary_fails`) |

Capacity retry (bounded backoff, `needs_rerun` on exhaustion) and durable atomic writes (#2005) are covered by the upstream suites `test-local-ai-reviewer.sh`, `test-workflow-durability.sh`, `test_workflow_durability.py` and `test_sync_template_merge.py`; no Ronda change alters them.

## Validation

- `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`: pass.
- Workflow suites: 149 selected; every suite passed after fixes to two merged test files and reruns (see PR for details). Fixture-based suites read tracked files, so they were rerun after the sync commit.
- Shell, snippet, GraphQL, durability and doctrine lints and the changelog fragment checks pass; workflow YAML parses.
