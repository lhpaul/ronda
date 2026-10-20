# Deferred workflow adoption evidence (#162)

## Scope and provenance

Source: template tag `v0.48.4`, commit
`493473b11c3f46479aaf5db0c918ed49edb600a3`. Source files were read
with `git show <tag-commit>:<path>`; the template checkout was not changed.
Consumer base: `fc908761fca9a8d8b2a0dd848c447d3a2959e202` (`develop`).

The approved partial scope adopts four workflows and restores six assertions.
LH authorized implementation through a draft PR only. The technical checkpoint
remains reserved for LH review; this evidence does not authorize merge.

| Surface | Adoption |
| --- | --- |
| ShellCheck | Tag-identical workflow: one file per process, two workers, 30-minute job and 20-minute analysis timeout |
| PR-Agent | Tag workflow plus Ronda's unchanged #104 credential guard and model pins |
| Closing-keyword scope | Tag-identical workflow and harness; empty targets produce one keyed JSON output and retain warning annotations |
| Claude Code review | Tag-identical comments describing dispatch run IDs and adoption; no executable or prompt changes |
| Publication runtime | Already tag-identical; no runtime code change |
| Runtime shell harness | Imported byte-for-byte from the tag |
| Runtime Python harness | Imported with a Ronda credential/pin regression test, named-step extraction, and a host-only suite-selection test |

The suite-selection test runs in the host pass. Image mode skips it because
linked-worktree Git metadata is outside the read-only container mount. The
upstream host-only resolver test also remains skipped in image mode. All four
actual producer/publication image tests execute with `--network none` and
synthetic data, without GitHub or model calls.

Verified unchanged against the consumer base: `.pr_agent.toml`,
`.github/workflows/pr-policy.yml`, `.github/workflows/markdown-lint.yml`, and
`scripts/development-workflow/sync-template-merge.py`. Model defaults,
credentials, prompts, the reusable Action and fsync/durability code are unchanged.

## Workflow decision coverage

| Input | Result | Proof |
| --- | --- | --- |
| Missing model key | Fail before PR-Agent executes; error annotation | Synthetic missing/present-key guard test |
| Same-repository PR event or exact `/review` | Fetch actual PR base SHA through API, then check out that immutable SHA | Resolver harness covers all five trigger shapes and ignores stale event/default/head revisions |
| Fork, invalid base SHA, API error | No checkout revision emitted; resolver fails | Imported resolver negative cases |
| Publication runtime | Pinned image; read-only workspace and event; output file writable; environment values forwarded by name | Synthetic Docker capture and offline image smoke |
| Closed PR without targets | Exactly `prs=[]` and sibling-readability output; no validation leg | Three restored empty-target assertions |
| Closed PR, unreadable siblings | Same empty outputs plus warning annotation | Restored executable annotation assertion |

## Verification

All commands below use repository-relative paths and require no model secrets.

| Check | Result |
| --- | --- |
| `npm ci`, `npm run typecheck`, `npm run lint`, `npm test` | Pass; 725 application tests |
| `test-check-sync-manifest-coverage.sh` | 44 passed |
| `test-pr-agent-runtime.sh` | 51 tests; 47 passed, four image-only tests skipped |
| `test-pr-agent-runtime.sh --image-smoke` | 51 tests; 49 passed, two host-only tests skipped |
| `test-pr-review-loop.sh` | 279 passed; includes both restored ShellCheck assertions |
| `test-step7a-surface-consistency.sh` | 24 passed, one existing skip |
| `test-validate-closing-keyword-scope.sh` | 259 passed; includes all four restored assertions |
| `test-workflow-branch-filters.sh` | 35 passed |
| ShellCheck, warning severity, one file per process | 211 files, zero failures |
| Workflow shell guard against `origin/develop` | Pass |
| Workflow shell snippet lint against `origin/develop` | Zero findings |
| GraphQL literal lint | 83 files, 26 queries, zero findings; no query changed |
| Workflow shell guard tests | 85 passed |
| Workflow shell snippet tests | 27 WS007 cases and 109 cross-shell cases passed |

The six workflow suites above are the exact output of
`select-test-suites.sh --changed-files` for the implementation change set.
ShellCheck covers every `.sh` under `scripts/development-workflow` and the
review doctrine linter. The image is pinned by the existing runtime to
`pragent/pr-agent@sha256:31b9aac6ab067bada9a0c1b001d30ebc500ea4487e00a93c18c59b9ef5fa66db`.
No live review, reviewer trigger, review comment or check run was published by
these local tests.

## Isolated planted-violation proofs

Each row was executed against a private copy. The checked-in implementation
was not mutated by the proof run. Every plant below fails its target test;
restoring the original line passes. The first six rows each fail exactly one
assertion in their complete harness, with all sibling assertions passing.

| Workflow location | Isolated plant | Target assertion/test | Planted / restored |
| --- | --- | --- | --- |
| `.github/workflows/shellcheck.yml:70` | Change `-n 1` to `-n 2` | `1876_shellcheck_lints_one_file_per_process` | FAIL / PASS |
| `.github/workflows/shellcheck.yml:39` | Remove job timeout | `1876_shellcheck_job_has_timeout` | FAIL / PASS |
| `.github/workflows/closing-keyword-scope.yml:135` | Prepend an unkeyed `[]` output only for a closed `fix/97-slug` with readable empty siblings | `closed PR without siblings emits exactly two keyed output lines` | FAIL / PASS |
| `.github/workflows/closing-keyword-scope.yml:135` | Same extra line only for closed `spec/97-slug` | `closed non-implementation PR emits exactly two keyed output lines` | FAIL / PASS |
| `.github/workflows/closing-keyword-scope.yml:135` | Same extra line only for a closed PR with unreadable siblings | `closed PR with unreadable listing emits exactly two keyed output lines` | FAIL / PASS |
| `.github/workflows/closing-keyword-scope.yml:155` | Change warning `echo` to `:`; retain the warning text so the structural assertion stays green | `unreadable closed listing retains warning annotation` | FAIL / PASS |
| `.github/workflows/pr-agent.yml:60` | Use `github.sha` instead of resolved trusted-base SHA | `test_workflow_trusted_revision_contract` | FAIL / PASS |
| `.github/workflows/pr-agent.yml:54` | Emit `pr.head.sha` instead of `pr.base.sha` | `test_workflow_resolves_actual_pr_base_for_every_trigger` | FAIL / PASS |
| `.github/workflows/pr-agent.yml:36` | Replace `exit 1` with `:` | `test_ronda_model_credential_guard` (missing key fails) | FAIL / PASS |
| `.github/workflows/pr-agent.yml:32` | Replace secret binding with `wrong-binding` | `test_ronda_model_credential_guard` (credential binding) | FAIL / PASS |
| `.github/workflows/pr-agent.yml:30` | Move guard after publication step | `test_ronda_model_credential_guard` (ordering) | FAIL / PASS |
| `.github/workflows/pr-agent.yml:35` | Replace error annotation with ordinary warning text | `test_ronda_model_credential_guard` (annotation) | FAIL / PASS |
| `.github/workflows/pr-agent.yml:34` | Change missing-key condition to `if true` | `test_ronda_model_credential_guard` (present key allowed) | FAIL / PASS |
| `.github/workflows/pr-agent.yml:37` | Add `echo "$DEEPSEEK_API_KEY"` after guard | `test_ronda_model_credential_guard` (synthetic key not disclosed) | FAIL / PASS |
| `.github/workflows/pr-agent.yml:71` | Replace primary model with `other/model` | `test_ronda_model_credential_guard` (primary pin) | FAIL / PASS |
| `.github/workflows/pr-agent.yml:72` | Replace fallback model with `other/model` | `test_ronda_model_credential_guard` (fallback pin) | FAIL / PASS |
| `.github/workflows/pr-agent.yml:78` | Replace weak model with `other/model` | `test_ronda_model_credential_guard` (weak pin) | FAIL / PASS |
| `.github/workflows/pr-agent.yml:107` | Remove `--env DEEPSEEK_API_KEY` | `test_workflow_context_and_secret_forwarding` | FAIL / PASS |

The three output-line plants model the original extra-unkeyed-line regression
separately for each restored case, preserving JSON validity and the other
cases. The annotation plant deliberately preserves the source text inspected
by the older structural assertion, so it proves execution rather than merely
the presence of a warning string. The imported resolver test additionally
rejects fork PRs, malformed SHAs and API errors without emitting a revision.

## Deferred debt

The seven SH006 and 26 WS007 findings from the sync remain deferred under
#116 / #162. Fixing them would expand the approved workflow-adoption change
into other framework scripts; upstream correction and a later sync are preferred.
They are not new findings introduced by this PR.

Reproduction: run the two workflow shell linters with `--base-ref fc90876^1`
to include the sync delta. The current PR delta against `origin/develop` passes.
A whole-repository `--all` snippet scan has broader historical debt and is not
the scope of the 26-finding sync inventory.

| Rule | Repository-relative file under `scripts/development-workflow/` | Lines | Findings |
| --- | --- | --- | --- |
| SH006 | `tests/test-pr-review-loop-cycles-labels.sh` | 1616 | 1 |
| SH006 | `tests/test-pr-review-loop-staged-gates.sh` | 2017, 2018, 2021, 2022, 2035, 2076 | 6 |
| WS007 | `tests/test-claude-code-action-reviewer.sh` | 294, 306, 310, 314, 323, 330, 333, 338, 344, 349, 353, 356 | 12 |
| WS007 | `tests/test-framework-mode-type-routing.sh` | 782, 790 | 2 |
| WS007 | `tests/test-pr-review-loop-no-verdict-yet.sh` | 461, 462, 636, 788, 790, 949, 965, 2113, 2769 | 9 |
| WS007 | `workflow-batch-plan.sh` | 556 (two array expansions) | 2 |
| WS007 | `workflow-next-action.sh` | 109 | 1 |

The worktree-root issue in `test-workflow-hub-skeletons.sh`, unrelated imported
whitespace and the upstream fsync/durability port remain outside this partial
PR. Issue #162 must remain open; the PR uses `Refs #162`.
