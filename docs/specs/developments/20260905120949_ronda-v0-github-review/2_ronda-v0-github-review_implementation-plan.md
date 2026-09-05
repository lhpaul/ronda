# Ronda v0 — GitHub Review Bot — Implementation Plan

**Spec**: [`1_ronda-v0-github-review_specs.md`](1_ronda-v0-github-review_specs.md)
**Smoke test runbook**: [`../../../testing/ronda/ronda-v0-github-review.smoke-test.md`](../../../testing/ronda/ronda-v0-github-review.smoke-test.md)
**Work item**: issue #2 (GitHub Project #11, Work type `Feature`)
**Constitution**: [`../../../constitution.md`](../../../constitution.md)

---

## Summary

**Approach**: Add a TypeScript-on-Node review core under `src/` that is entirely
independent of its entrypoint, and expose it in v0 through a single reusable
GitHub Actions workflow (`.github/workflows/ronda-review.yml`, `on: workflow_call`).
The core reads the pull request through the GitHub REST API (no checkout of the
reviewed repository), asks a model through a `ModelClient` interface implemented
by an OpenAI-compatible client pointed at Qwen/DashScope by configuration, and
publishes exactly one pull-request review plus one terminal check run per pass.
The Action entrypoint (`src/cli/review-pr.ts`) only translates GitHub Actions
environment variables into a call to `runReviewPass`, so the later long-running
webhook process can reuse the same core unchanged.

**Estimated complexity**: L

<!-- S: < 1 day | M: 1-3 days | L: 3+ days -->

**Rationale**: This is greenfield. The repository has no product source, no
TypeScript project at the root, no test runner, and no lint setup — all of that
is created here alongside the feature. The feature itself spans configuration
resolution, GitHub REST reads, unified-diff hunk parsing, model invocation,
tolerant model-output parsing, review and check-run publication, deadline and
supersede handling, a reusable workflow, adoption documentation, and a live
dogfood run against a second repository. Any one of those is small; together
they exceed three days.

**Dependencies**: None. The spec (PR #3) is merged to `develop`. No other work
item must merge first. External runtime dependencies: a GitHub Actions runner,
a model API credential supplied at run time, and the dogfood repository
`lhpaul/ai-dev-framework-template`.

---

## Verification Log

> Reproducible plan-time verification. Repo revision for every row below:
> `6eb3405` on `develop`.

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `6eb3405` |
| No product TypeScript source exists | `find . -name "*.ts" -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./e2e/node_modules/*"` | 12 files: 2 under `e2e/` (Playwright placeholder), 10 under `hooks/` (Haystack hooks). No `src/`, no product code. |
| No root TypeScript project | `find . -name "tsconfig*.json" -not -path "*/node_modules/*"` | 2 files, both under `hooks/`. No root `tsconfig.json`. |
| No ESLint configuration exists | `ls -a \| grep -i eslint` | No matches. |
| `tsx` already used in this repository | `cat hooks/package.json` | `tsx` 4.21.0 is a dependency of the Haystack hooks package — precedent for running TypeScript without a build artifact. |
| Node version used by existing CI | `grep -n "node-version" .github/workflows/*.yml` | `'20'` in `e2e-regression.yml` and `markdown-lint.yml`. |
| Existing workflow files | `ls .github/workflows/` | 10 files. Neither `ronda-review.yml` nor `node-ci.yml` exists. |
| Existing smoke-test sections | `ls docs/testing/` | `README.md` and `workflow/`. No `ronda/` section yet. |
| Pending changelog fragments | `ls changelog.d/` | `README.md` only — no pending fragments. |
| Root package manifest | `cat package.json` | Name is still `ai-dev-framework-template` (template leftover); only script is `format`. No `test`, `lint`, or `typecheck` script exists despite `docs/project/2-repo-architecture.md` documenting `npm test` and `npm run lint`. |
| Open pull requests at plan time | `gh pr list --state open --limit 20` | Zero open pull requests. |
| Markdown lint configuration | `cat .markdownlint-cli2.jsonc` | MD009 and MD047 enabled; `relative-links` disabled in the cli2 config. |

---

## Cross-Cutting Operational Assumption Check

### Applicable

| Assumption surface | Recorded value | Authoritative source | Verified at | Bounded cross-check scope | Result |
| --- | --- | --- | --- | --- | --- |
| Artifact owner / repository mode | This repository (`lhpaul/ronda`) owns the plan | `.ai-dev-workflow.yaml` has no `mode` key, so `single_repo` applies; `docs/project/2-repo-architecture.md` states "Single-repo ADF consumer (`single_repo`)" | 2026-09-05, repo SHA `6eb3405` | Current invocation covers issue #2 only. `gh pr list --state open --limit 20` returned zero open pull requests, so no same-surface artifact-ownership evidence competes. | `Verified` |
| Approved artifact base branch | `develop` | `AGENTS.md` ("Default branch: `develop`"); parent handoff for this item; `git rev-parse origin/develop` resolves | 2026-09-05, repo SHA `6eb3405` | Same bounded scope as above; no open pull request changes the base-branch surface. | `Verified` |
| Issue tracker binding | GitHub Project #11, classification field `Work type` | `.ai-dev-workflow.yaml` → `issue_tracker.project_number: 11`, `custom_fields.type_field: Work type` | 2026-09-05, repo SHA `6eb3405` | Same bounded scope; no open pull request changes tracker configuration. | `Verified` |
| Dogfood target repository | `lhpaul/ai-dev-framework-template` | Spec acceptance criterion 13; issue #2 "Alignment decisions (confirmed with LH, 2026-09-05)" | 2026-09-05, repo SHA `6eb3405` | Same bounded scope; no competing dogfood target recorded anywhere in the current invocation. | `Verified` |
| Credential surface for a pass | GitHub Actions repository/organization secrets on the Actions path; `~/.config/ronda/config.json` on the local operator path | Spec business rule on secrets; `docs/project/2-repo-architecture.md` ("Local, never committed: `~/.config/ronda/`") | 2026-09-05, repo SHA `6eb3405` | Same bounded scope; no open pull request changes the secret-storage surface. | `Verified` |

No conflicts were found. No repository-wide scan of unrelated pull requests was
performed, and none was warranted: the bounded scope is this single invocation
plus same-surface open pull requests, of which there are none.

---

## Architecture

### Module layout

All product source lives under `src/` at the repository root, matching the flat
structure already documented in `docs/project/2-repo-architecture.md`. The
directory boundary that matters is **`src/core/` must not import from
`src/cli/`** — the core is entrypoint-agnostic so the later webhook process can
call it directly.

| Path | Responsibility |
| --- | --- |
| `src/config/config.types.ts` | `RondaConfig`, `ModelConfig` type declarations |
| `src/config/load-config.ts` | `loadConfig` — resolve configuration from environment, operator config file, and defaults |
| `src/domain/review-pass.types.ts` | `PassOutcome`, `FailureReason`, `SkipReason`, `TriggerMode`, `Finding`, `ChangedFile`, `ReviewPassInput`, `ReviewPassDeps`, `ReviewPassResult` |
| `src/domain/severity.ts` | `Severity` type plus `severityLabel` (code value to display label) |
| `src/github/github-client.ts` | Thin authenticated REST wrapper built on `@octokit/rest` |
| `src/github/pull-request-reader.ts` | Read pull-request metadata and changed files; re-read head SHA for the supersede check |
| `src/github/diff-lines.ts` | `parseCommentableLines` — unified-diff hunk parser |
| `src/github/review-publisher.ts` | `publishReview` — one review with inline comments and summary, with the oversize/invalid-line fallback |
| `src/github/check-run-publisher.ts` | `publishCheckRun` — one terminal check run |
| `src/inference/model-client.ts` | `ModelClient` interface and request/response types — the vendor seam |
| `src/inference/openai-compatible-client.ts` | `createOpenAiCompatibleClient` — Qwen/DashScope and any other OpenAI-compatible endpoint |
| `src/inference/review-prompt.ts` | `buildReviewPrompt` — prompt and output-contract construction |
| `src/inference/parse-model-response.ts` | `parseModelResponse` — tolerant model-output parsing into findings |
| `src/core/run-review-pass.ts` | `runReviewPass` — orchestrates one pass end to end |
| `src/core/pass-deadline.ts` | `createPassDeadline` — deadline timer, abort signal, and publication guard |
| `src/core/summary.ts` | `buildReviewSummary`, `buildCheckRunOutput` |
| `src/core/logger.ts` | `createLogger` — single-line JSON logging with credential redaction |
| `src/cli/resolve-trigger.ts` | `resolveTrigger` — GitHub Actions event payload to trigger decision |
| `src/cli/review-pr.ts` | Action entrypoint — environment to `runReviewPass`, process exit code |

### Core signature

`src/core/run-review-pass.ts` exposes one function, used identically by the
Action entrypoint today and by the webhook process later:

```ts
// Illustrative — adapt during implementation.
export async function runReviewPass(
  input: ReviewPassInput,
  deps: ReviewPassDeps,
): Promise<ReviewPassResult>;
```

`ReviewPassInput` carries `{ owner, repo, pullNumber, trigger }`.
`ReviewPassDeps` carries `{ github, model, config, clock, logger }`. Every
dependency is injected, so unit and integration tests run with no network.

### Named constants

Declared once and imported everywhere they are used.

| Constant | Value | Declared in |
| --- | --- | --- |
| `CHECK_RUN_NAME` | `Ronda review` | `src/domain/review-pass.types.ts` |
| `REVIEW_COMMAND` | `/ronda review` | `src/cli/resolve-trigger.ts` |
| `DEFAULT_PASS_TIMEOUT_MS` | `600_000` (ten minutes) | `src/config/load-config.ts` |
| `DEFAULT_MODEL_BASE_URL` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` | `src/config/load-config.ts` |
| `DEFAULT_MODEL_NAME` | `qwen-plus` | `src/config/load-config.ts` |
| `DEFAULT_MAX_PATCH_CHARS` | `400_000` | `src/config/load-config.ts` |
| `MAX_FINDING_BODY_CHARS` | `8_000` | `src/inference/parse-model-response.ts` |

`DEFAULT_MODEL_BASE_URL` and `DEFAULT_MODEL_NAME` are vendor-published values,
not operator-specific ones, so committing them does not violate the spec's
secrets rule. The DashScope China-region endpoint
(`https://dashscope.aliyuncs.com/compatible-mode/v1`) is documented in
`ronda.config.example.json` as the alternative; selecting it is a configuration
change.

### Pass outcome decision matrix

This is the product's outcome routing. It is the single source of truth for
what a pass publishes; every other section of this plan defers to it.

| Trigger | Pull request state | Prior `Ronda review` check run on head SHA | Outcome | Published |
| --- | --- | --- | --- | --- |
| `pull_request` (`opened`, `reopened`, `ready_for_review`, `synchronize`) | draft | any | `skipped` (`draft_pull_request`) | Nothing |
| `pull_request` | ready | present | `skipped` (`already_reviewed_automatically`) | Nothing |
| `pull_request` | ready | absent | `running`, then terminal | Review + check run |
| `issue_comment` matching `REVIEW_COMMAND` | draft | any | `skipped` (`draft_pull_request`) | Nothing |
| `issue_comment` matching `REVIEW_COMMAND` | ready | any | `running`, then terminal | Review + check run |
| `issue_comment` not matching `REVIEW_COMMAND` | any | any | No pass starts | Nothing |
| Any | ready, head SHA changed before publication | any | `skipped` (`superseded_head_sha`) | Nothing |
| Any | ready, pass reached a failure | n/a | `failed` (reason named) | Check run only |

**Reconciliation with the spec.** The spec's Operational Visibility section says
"every attempted pass on a non-draft pull request produces a check run", while
acceptance criteria 3 and 16 require that draft and superseded passes publish no
check run at all. This plan reads "attempted" as "reached the `running` state":
a pass that resolves to `skipped` before or during a pass publishes nothing;
every pass that reaches `running` ends with exactly one check run, success or
failure. The `queued` and `running` states are therefore in-process states that
appear in logs, not published check-run states.

### Why the check run is created only at terminal time

A single `POST .../check-runs` with `status: completed` is issued at the end of
a pass. Creating an `in_progress` check run at pass start would leave a
permanently pending check run whenever the Actions run is cancelled — which is
exactly what happens on the supersede path — and would directly contradict
acceptance criterion 16. Terminal-only creation makes "never pending with no
explanation" true by construction. The consequence for consumers is that the
check run is absent rather than pending while a pass is in flight; the adoption
documentation states this explicitly so a waiting loop treats absence as
"not finished yet".

### Behavioural guarantees and their mechanisms

| Guarantee | Enforcing mechanism |
| --- | --- |
| At most one automatic review per head SHA | `pull-request-reader.ts` queries `GET /repos/{owner}/{repo}/commits/{sha}/check-runs?check_name=Ronda review` before an automatic pass; any hit yields `skipped`. Manual passes deliberately bypass this query. |
| A superseded pass publishes nothing | `run-review-pass.ts` re-reads `GET /repos/{owner}/{repo}/pulls/{number}` immediately before publication and compares `head.sha`; a mismatch yields `skipped`. The recommended caller-side `concurrency` block with `cancel-in-progress: true` is an optimisation on top of this, not the guarantee. |
| Every finding reaches the reader | Findings whose line maps into the diff become inline comments; all others go into the review summary list. Nothing is filtered on severity or count. |
| Exactly one review per pass | A single `POST .../pulls/{number}/reviews` call carries the summary and all inline comments atomically. |
| Bounded retries | `github-client.ts` retries at most twice, with fixed 2s then 5s backoff, and only on HTTP 5xx or a secondary-rate-limit response. `publishReview` additionally makes at most one fallback attempt after a 422. No other call is retried. |
| A pass always terminates within its budget | `createPassDeadline` arms a `setTimeout` for the configured budget whose callback aborts the shared `AbortController`; the reusable workflow job sets `timeout-minutes` to the budget plus two minutes as an outer backstop. |
| No credential is logged | `createLogger` redacts any value equal to the resolved API key and any `authorization` field before serialising. |

---

## Layer-by-Layer Changes

### Database / Data Layer

Not applicable. `docs/project/4-database-model.md` states v0 needs no product
database, and the spec's business rule "Ronda keeps no record of a pass between
passes" makes persistence unnecessary. No migration, no schema, no seed table.

### Backend / API (the review core)

- [ ] `src/domain/review-pass.types.ts` — declare `PassOutcome`
      (`queued` / `running` / `succeeded` / `failed` / `skipped`),
      `FailureReason` (`timed_out`, `model_unavailable`, `credential_missing`,
      `credential_invalid`, `unusable_output`, `changes_too_large`,
      `unexpected_error`), `SkipReason` (`draft_pull_request`,
      `superseded_head_sha`, `already_reviewed_automatically`), `TriggerMode`
      (`automatic` / `manual`), `Finding`, `ChangedFile`, `ReviewPassInput`,
      `ReviewPassDeps`, `ReviewPassResult`, and `CHECK_RUN_NAME`.
      *(Spec: Statuses / Enum Values; ACs 6, 8, 9.)*
- [ ] `src/domain/severity.ts` — `Severity` (`blocking` / `important` / `nit`)
      and `severityLabel` returning `Blocking`, `Important`, `Nit`.
      *(Spec: Finding severity table; AC 6.)*
- [ ] `src/config/config.types.ts` and `src/config/load-config.ts` — `loadConfig`
      resolves, in descending precedence: process environment
      (`RONDA_MODEL_API_KEY`, `RONDA_MODEL_BASE_URL`, `RONDA_MODEL_NAME`,
      `RONDA_PASS_TIMEOUT_MS`, `RONDA_MAX_PATCH_CHARS`), then the operator
      config file at `RONDA_CONFIG_FILE` or `~/.config/ronda/config.json`, then
      the built-in defaults. Secrets have no default; a missing or blank API key
      produces `credential_missing`. A missing config file is not an error; an
      unreadable or malformed one produces `unexpected_error` naming the path
      but never the contents. *(Spec: secrets business rule; ACs 8, 15.)*
- [ ] `src/github/github-client.ts` — authenticated `@octokit/rest` instance
      honouring `GITHUB_API_URL`, with the bounded retry policy described above.
- [ ] `src/github/pull-request-reader.ts` — `readPullRequest` (metadata: title,
      body, `draft`, `head.sha`), `readChangedFiles` (paginated
      `GET .../pulls/{number}/files`, mapped to `ChangedFile`), and
      `findExistingCheckRun` for the automatic-duplicate guard.
      *(Spec: Use Cases 1-3; ACs 1, 2, 3.)*
- [ ] `src/github/diff-lines.ts` — `parseCommentableLines(patch)` returns the set
      of right-side line numbers a comment may attach to. See the parser-risk
      addendum for the full edge-case list. *(Spec: inline-versus-summary
      business rule; AC 5.)*
- [ ] `src/github/review-publisher.ts` — `publishReview` issues one
      `POST .../pulls/{number}/reviews` with `event: COMMENT`, `commit_id` set
      to the pass head SHA, the summary body, and one entry per mapped finding
      (`path`, `line`, `side: RIGHT`, `body`). On HTTP 422 it makes exactly one
      fallback attempt with no inline comments and every finding rendered into
      the summary, so no finding is lost to a rejected payload.
      *(Spec: all findings in one review; ACs 4, 5.)*
- [ ] `src/github/check-run-publisher.ts` — `publishCheckRun` issues one
      `POST .../check-runs` with `status: completed`, `head_sha`, `started_at`,
      `completed_at`, `details_url` pointing at the Actions run, `conclusion`
      `success` for `succeeded` and `failure` for `failed`, and the output built
      by `buildCheckRunOutput`. *(Spec: Operational Visibility; ACs 1, 7, 8, 9.)*
- [ ] `src/inference/model-client.ts` — the vendor seam:
      `interface ModelClient { readonly modelName: string; complete(request: ModelRequest, signal: AbortSignal): Promise<string>; }`.
      Nothing outside `src/inference/` may reference a vendor by name.
      *(Spec: model vendor is configuration; AC 12.)*
- [ ] `src/inference/openai-compatible-client.ts` —
      `createOpenAiCompatibleClient(config: ModelConfig): ModelClient` posting to
      `{baseUrl}/chat/completions` with `Authorization: Bearer <key>` using the
      global `fetch`. It maps HTTP 401 and 403 to `credential_invalid`, network
      errors and HTTP 5xx to `model_unavailable`, and an aborted signal to
      `timed_out`. *(Spec: ACs 8, 9, 12.)*
- [ ] `src/inference/review-prompt.ts` — `buildReviewPrompt` composes the system
      instruction (comment-only reviewer, the three severity codes, the required
      JSON output contract) and the user message (pull-request title, body, and
      each changed file's path, status, and patch). It enforces
      `DEFAULT_MAX_PATCH_CHARS`: when the combined patch text exceeds the limit,
      the pass fails with `changes_too_large` rather than silently truncating.
      *(Spec: Use Case 4 failure reasons.)*
- [ ] `src/inference/parse-model-response.ts` — `parseModelResponse(raw, changedFiles)`
      returns `{ findings, malformedCount, coercedSeverityCount, duplicateCount }`.
      See the parser-risk addendum. *(Spec: unusable output failure; ACs 4, 5, 6.)*
- [ ] `src/core/pass-deadline.ts` — `createPassDeadline(budgetMs, clock)` returns
      `{ signal, markPublishing, dispose, expired }`. The timer is `unref`-ed,
      cleared in `dispose`, and neutralised by `markPublishing` so a deadline
      that fires during publication cannot produce a second, contradictory
      outcome. *(Spec: ten-minute budget; AC 9.)*
- [ ] `src/core/summary.ts` — `buildReviewSummary` renders what was reviewed
      (file count and added/removed line counts), a severity count table using
      the display labels, the model name, the pass duration, whether the pass was
      automatic or manually requested, the list of findings not attached to a
      changed line, and an explicit "no findings" line when the count is zero.
      `buildCheckRunOutput` renders the check-run title
      (`Review posted — …` or `Review failed — …`) and detail text repeating the
      counts, model, and duration, plus the failure reason and the
      `REVIEW_COMMAND` re-run hint on failure.
      *(Spec: Operational Visibility; ACs 5, 6, 7, 10, 12.)*
- [ ] `src/core/logger.ts` — `createLogger(redactValues)` emits one JSON line per
      event (`pass_started`, `pass_skipped`, `pass_failed`, `pass_succeeded`)
      carrying repository, pull-request number, head SHA, outcome, model, and
      duration, with redaction applied to every serialised value.
      *(Spec: Operational Visibility logs rule.)*
- [ ] `src/core/run-review-pass.ts` — `runReviewPass` implements the pass outcome
      decision matrix in order: read the pull request, apply the draft gate,
      apply the automatic-duplicate gate, arm the deadline, read changed files,
      build the prompt, call the model, parse the response, map findings to
      inline or summary placement, re-read the head SHA, then publish the review
      followed by the check run. Every failure path is caught and mapped to a
      `FailureReason` before publication so a failure is always visible.
      *(Spec: Use Cases 1-4; ACs 1-12, 16.)*

### CLI / Action entrypoint

- [ ] `src/cli/resolve-trigger.ts` — `resolveTrigger(eventName, payload)` returns
      the pull-request number and `TriggerMode`, or a decision not to run.
      `pull_request` events resolve to `automatic`; `issue_comment` events
      resolve to `manual` only when the payload is a pull-request comment and the
      first non-empty, non-quoted line of the body equals `REVIEW_COMMAND` after
      trimming, compared case-insensitively. *(Spec: review command business
      rule; ACs 10, 11.)*
- [ ] `src/cli/review-pr.ts` — reads `GITHUB_TOKEN`, `GITHUB_REPOSITORY`,
      `GITHUB_EVENT_NAME`, `GITHUB_EVENT_PATH`, `GITHUB_RUN_ID`,
      `GITHUB_SERVER_URL`, and `GITHUB_API_URL`; calls `loadConfig`,
      `resolveTrigger`, and `runReviewPass`; registers `unhandledRejection` and
      `uncaughtException` handlers; exits `0` for `succeeded` and `skipped` and
      `1` for `failed`. It contains no review logic.

### Shared Packages / Libraries

No workspace packages. New runtime dependency: `@octokit/rest`. New development
dependencies: `typescript`, `tsx`, `@types/node`, `eslint`,
`typescript-eslint`. `prettier` and `markdownlint-cli2` already exist.

- [ ] `package.json` — set `name` to `ronda` and update `description`; leave
      `version` untouched because `auto-tag-release.yml` and the template sync
      tooling read it. Add scripts: `test`
      (`tsx --test "tests/**/*.test.ts"`), `typecheck` (`tsc --noEmit`), `lint`
      (`eslint src tests`), and `review` (`tsx src/cli/review-pr.ts`). Add the
      dependencies above and commit the updated `package-lock.json`.
- [ ] `tsconfig.json` — root project covering `src` and `tests`, mirroring the
      settings already used by `hooks/agent-context/tsconfig.json`: target
      `ES2022`, module and resolution `Node16`, `strict: true`,
      `esModuleInterop: true`, `types: ["node"]`, `resolveJsonModule: true`,
      `noEmit: true`, `skipLibCheck: true`.
- [ ] `eslint.config.js` — flat config applying the ESLint and typescript-eslint
      recommended sets to `src` and `tests` only, with `node_modules`, `hooks`,
      `e2e`, `template`, and `docs` ignored so the pre-existing template-owned
      TypeScript is untouched.

### Frontend / UI

Not applicable. Ronda has no user interface; its entire output surface is the
GitHub pull-request review and check run.

### Infrastructure / Configuration

- [ ] `.github/workflows/ronda-review.yml` — the reusable workflow
      (`on: workflow_call`). Inputs: `model_base_url` (string, optional),
      `model_name` (string, optional), `pass_timeout_minutes` (number, optional,
      default `10`), and `ronda_ref` (string, optional, default `main`) naming
      the ref of `lhpaul/ronda` to check out. Secret: `model_api_key`
      (`required: true`). The single job checks out `lhpaul/ronda` at
      `ronda_ref` with `persist-credentials: false`, sets up Node 20, runs
      `npm ci`, then runs `npm run review` with `GITHUB_TOKEN` and the
      `RONDA_*` variables set from the inputs and secret. `timeout-minutes` is
      `pass_timeout_minutes` plus two, as the outer backstop behind the
      in-process deadline. The workflow declares
      `permissions: { contents: read, pull-requests: write, checks: write }`.
      Note that the reviewed repository is never checked out — the pass reads it
      through the REST API only. *(Spec: Use Cases 1-3; ACs 1, 2, 13.)*
- [ ] `.github/workflows/node-ci.yml` — pull-request and `develop` push CI
      running `npm ci`, `npm run typecheck`, `npm run lint`, and `npm test` on
      Node 20, scoped by `paths` to `src/`, `tests/`, `package.json`,
      `package-lock.json`, `tsconfig.json`, `eslint.config.js`, and the workflow
      file itself.
- [ ] `ronda.config.example.json` — committed example of the operator config
      file with non-secret keys (`modelBaseUrl`, `modelName`,
      `passTimeoutMs`, `maxPatchChars`) filled in and `modelApiKey` present as an
      empty placeholder, plus a comment-free `README` pointer explaining that the
      real file belongs at `~/.config/ronda/config.json` and is never committed.
      *(Spec: secrets business rule; AC 15.)*
- [ ] `docs/adoption/ronda-review-adoption.md` — new adoption guide containing:
      the caller workflow snippet (events, draft and command guards, `permissions`,
      the recommended `concurrency` block with `cancel-in-progress: true`, and the
      `uses:` reference with `secrets: model_api_key`); the required repository or
      organisation secret; the documented literal review command `/ronda review`;
      the stable consumption contract (check-run name `Ronda review`, conclusion
      `success` or `failure`, absent while a pass is in flight, one per head SHA);
      and a section on how ADF and Helm attach by naming Ronda as an external
      review provider in their own configuration. *(Spec: Use Case 5; ACs 10, 11,
      13, 14.)*
- [ ] `.gitignore` — add `dist/` and `ronda.config.json` so a local operator copy
      of the config can never be committed from the repository root.

---

## Testing Strategy

**Test types**: Unit (primary), Integration (one end-to-end pass against
in-process fakes), Smoke (manual, against real GitHub).

**Runner**: Node's built-in test runner executed through `tsx`
(`tsx --test "tests/**/*.test.ts"`), asserting with `node:assert/strict`. No
mocking framework: every dependency of `runReviewPass` is injected, so tests
pass fakes directly. This choice keeps the dependency surface minimal and reuses
the `tsx` precedent already present in `hooks/`.

**Key scenarios to test**:

1. A ready pull request with findings produces one review and one successful
   check run, and issues no write other than those two calls — maps to
   acceptance criteria 1 and 4.
2. Findings that map to a changed line become inline comments; findings that do
   not become summary entries; the summary total equals inline plus summary
   counts — maps to acceptance criterion 5.
3. Each severity code renders its display label, and the summary counts per
   label are correct — maps to acceptance criterion 6.
4. A pass with zero findings publishes a "no findings" review and a
   `Review posted` check run — maps to acceptance criterion 7.
5. A draft pull request publishes nothing on both the `pull_request` and the
   `issue_comment` path — maps to acceptance criteria 3 and 11.
6. A blank or absent API key produces a `Review failed` check run naming the
   missing-credential reason and posts no inline comments — maps to acceptance
   criterion 8.
7. An expired deadline produces a `Review failed` check run naming the timeout
   reason — maps to acceptance criterion 9.
8. A manual `/ronda review` pass on a head SHA that already has a check run runs
   anyway and its summary says the pass was manually requested — maps to
   acceptance criterion 10.
9. A head SHA that differs at the pre-publication re-read publishes neither a
   review nor a check run — maps to acceptance criterion 16.
10. `runReviewPass` composed with a different `ModelClient` (different model
    name, different base URL) produces the same summary structure with the new
    model named — maps to acceptance criterion 12.
11. A second automatic event on a head SHA that already has a `Ronda review`
    check run publishes nothing — maps to acceptance criteria 1 and 2.

**Test files**:

| File | Covers |
| --- | --- |
| `tests/unit/github/diff-lines.test.ts` | Every case in the hunk-parser edge-case table |
| `tests/unit/inference/parse-model-response.test.ts` | Every case in the model-output edge-case table |
| `tests/unit/cli/resolve-trigger.test.ts` | Every case in the trigger edge-case table |
| `tests/unit/config/load-config.test.ts` | Precedence between environment, file, and defaults; missing key; missing file; malformed file; the default constant values including the ten-minute budget |
| `tests/unit/core/summary.test.ts` | Summary and check-run output rendering, severity counts, manual-request note, zero-findings text |
| `tests/unit/core/pass-deadline.test.ts` | Timer fires and aborts; `markPublishing` neutralises a late timer; `dispose` clears the timer |
| `tests/unit/core/run-review-pass.test.ts` | Scenarios 1 through 11 above, using injected fakes |
| `tests/integration/review-pass.test.ts` | Scenario 1 end to end against `tests/support/mock-model-server.ts` and a fake GitHub client, asserting the exact review and check-run payloads |
| `tests/support/mock-model-server.ts` | A local OpenAI-compatible HTTP stub used by the integration test and by smoke test step 8 |

**Smoke test runbook**:
`docs/testing/ronda/ronda-v0-github-review.smoke-test.md`

**Regression suite**: The repository's only committed end-to-end suite is the
`e2e/` Playwright placeholder (`e2e/tests/baseline.spec.ts`), which exercises no
product behaviour and has no fixture data. Per the E2E Fixture Contract in
`docs/best-practices/3-testing.md`, the fixture obligation is recorded as **not
applicable**: no committed non-placeholder E2E suite exists to extend. Ronda has
no browser surface, so the Playwright suite is not the right home for this
feature's regression coverage; `tests/integration/review-pass.test.ts` is.

**Planted-violation proof**: `.github/workflows/node-ci.yml` is a new CI job, so
per `docs/best-practices/3-testing.md` the implementation must prove it catches
what it targets — introduce a deliberate type error and a deliberate lint error,
show the job fails and cites the file and line, remove them, and show it passes.
Record both directions in the pull-request description.

### Parser-risk addendum

This plan is parser-risk: `src/github/diff-lines.ts` parses unified-diff hunk
headers with a regular expression, `src/inference/parse-model-response.ts`
extracts structured text from free-form model output, and
`src/cli/resolve-trigger.ts` matches a command phrase inside human prose.

#### Edge cases — `parseCommentableLines` (`src/github/diff-lines.ts`)

| # | Input | Expected |
| --- | --- | --- |
| P1 | `@@ -1,5 +1,6 @@` with mixed context, addition, and deletion lines | Right-side numbers advance on context and addition lines only |
| P2 | `@@ -1 +1 @@` (omitted counts) | Counts default to 1; the single right-side line is commentable |
| P3 | `@@ -0,0 +1,12 @@` (new file) | Lines 1 through 12 are all commentable |
| P4 | `@@ -1,4 +0,0 @@` (file emptied) | Empty set |
| P5 | `@@ -10,3 +10,4 @@ export function foo() {` | Trailing section text is ignored, not parsed as a diff line |
| P6 | Two hunks in one patch | The right-side counter resets from each hunk header rather than accumulating |
| P7 | A deletion line (`-`) | Does not advance the right-side counter |
| P8 | `\ No newline at end of file` | Ignored; does not advance the counter |
| P9 | A content line whose text begins with `@@`, appearing as `+@@ -1 +1 @@` | Treated as content, not as a hunk header (the header pattern is anchored to the start of the line) |
| P10 | `patch` is `undefined` (binary file, or a diff GitHub declines to return) | Empty set; findings on that path fall through to the summary |
| P11 | `patch` is the empty string | Empty set |
| P12 | `patch` uses CRLF line endings | Parsed identically to LF |
| P13 | A renamed file with a patch | Lines are keyed to the new `filename`, never `previous_filename` |
| P14 | Malformed header such as `@@ -x,y +z,w @@` | That hunk is skipped, no exception is thrown, and any well-formed hunks in the same patch still parse |
| P15 | Combined-diff header `@@@ -1,2 -1,2 +1,2 @@@` | Not recognised as a hunk header; the file yields an empty set rather than wrong line numbers |
| P16 | Lines appearing before the first hunk header | Ignored, so file headers such as `--- a/x` and `+++ b/x` are never counted as diff lines |

#### Edge cases — `parseModelResponse` (`src/inference/parse-model-response.ts`)

| # | Input | Expected |
| --- | --- | --- |
| M1 | A bare JSON object | Parsed |
| M2 | JSON inside a fence tagged `json` | Parsed |
| M3 | JSON inside an untagged fence | Parsed |
| M4 | Prose before and after the fence | Parsed; the prose is discarded |
| M5 | Two fenced blocks | The first block that parses to an object with a `findings` array wins |
| M6 | Closing fence longer than the opening fence (permitted by CommonMark) | Parsed |
| M7 | Empty or whitespace-only response | `unusable_output` |
| M8 | Valid JSON that is not an object (array, string, number) | `unusable_output` |
| M9 | An object with no `findings` key | `unusable_output` |
| M10 | `"findings": []` | Zero findings; the pass succeeds |
| M11 | A finding missing `path` or `body` | That entry is rejected and counted in `malformedCount`, which the summary reports; the pass still succeeds |
| M12 | `severity` of `BLOCKING`, `Nit`, or `major` | The first two match case-insensitively; an unrecognised value is coerced to `nit` and counted in `coercedSeverityCount`, which the summary reports |
| M13 | `line` given as the string `"42"` | Parsed with radix 10 to the number 42 |
| M14 | `line` that is `null`, absent, `0`, or negative | Treated as unmapped; the finding goes to the summary |
| M15 | `path` with a leading `./`, `a/`, or `/` | Normalised, then matched against the changed-file paths |
| M16 | `path` that matches no changed file | Unmapped; the finding goes to the summary |
| M17 | Invalid JSON such as a trailing comma or single-quoted keys | `unusable_output` — v0 attempts no lenient repair |
| M18 | Two identical findings (same path, line, and body) | Deduplicated to one, counted in `duplicateCount`, which the summary reports |
| M19 | A `body` longer than `MAX_FINDING_BODY_CHARS` | Truncated at the limit with a visible truncation marker |

#### Edge cases — `resolveTrigger` (`src/cli/resolve-trigger.ts`)

| # | Input | Expected |
| --- | --- | --- |
| T1 | `issue_comment` whose body is exactly `/ronda review` | `manual` |
| T2 | Body `  /ronda review  ` (surrounding whitespace) | `manual` |
| T3 | Body `/Ronda Review` | `manual` (matched case-insensitively) |
| T4 | Body `please run /ronda review when you can` | No pass — the phrase is not the first non-empty line |
| T5 | Body `> /ronda review` (quoted reply) | No pass — quoted lines are skipped, and no unquoted command line follows |
| T6 | Body `/ronda review` on the second line, after a blank first line | `manual` — leading blank lines are skipped |
| T7 | `issue_comment` on an issue that is not a pull request | No pass |
| T8 | `pull_request` event with `draft: true` | `automatic`, and `runReviewPass` then applies the draft gate |
| T9 | `pull_request` event of a type outside the four handled types | No pass |
| T10 | An event payload missing the pull-request number | No pass, with a logged reason rather than a thrown error |

#### Unit test mapping

`tests/unit/github/diff-lines.test.ts` contains one named test per row P1
through P16. `tests/unit/inference/parse-model-response.test.ts` contains one
named test per row M1 through M19.
`tests/unit/cli/resolve-trigger.test.ts` contains one named test per row T1
through T10. Every test name begins with its row identifier so a reviewer can
map coverage to this table at a glance.

#### Suppression semantics

Not applicable. Ronda v0 recognises no inline suppression directives — there is
no way to annotate source under review to silence a finding, and none is in
scope. The only directive-like input Ronda recognises is the review command
`/ronda review`, whose matching rules are specified in the trigger edge-case
table above.

### Concurrent-event-source addendum

This plan is concurrent-event-source: a deadline timer runs concurrently with an
in-flight model request and with publication, sharing the pass's mutable outcome
state. This is the first asynchronous product code in the repository, so no
existing pattern constrains the design.

- **Shared mutable state guards**: the process runs a single pass. One
  `PassState` object is owned by `runReviewPass`, and the only other execution
  context — the deadline timer callback — never mutates it. That callback reads
  and sets the two booleans owned by `createPassDeadline` (`expired`,
  `publishing`) and calls `AbortController.abort()`. Every outcome transition
  happens on the main path.
- **Re-entrancy / in-flight tracking**: `runReviewPass` is called exactly once
  per process, by `src/cli/review-pr.ts`. Cross-process re-entrancy — two
  Actions runs for the same head SHA — is handled by the automatic-duplicate
  check-run query and, in the caller workflow, by the recommended `concurrency`
  block. The residual window where two automatic runs both observe no check run
  before either publishes is accepted and documented; the recommended
  `cancel-in-progress: true` closes it in practice.
- **Event deduplication**: `ready_for_review` and `synchronize` can both fire for
  a single head SHA. `findExistingCheckRun` deduplicates automatic passes on that
  SHA. Manual `/ronda review` passes intentionally bypass deduplication, because
  the spec makes a second pass on an unchanged commit the documented recovery
  path.
- **Listener and resource cleanup**: `createPassDeadline` returns `dispose`,
  called from a `finally` block, which clears the `setTimeout` and aborts the
  `AbortController` so no `fetch` is left in flight. The timer is `unref`-ed so
  it can never hold the process open. Nothing else registers a listener.
- **Race conditions at initialisation**: the deadline is armed only after
  configuration loads and after the draft and duplicate gates pass, and before
  the first model call. A failure during configuration loading therefore resolves
  before any timer exists, and the timer can never fire before the pass start
  time is recorded.
- **Race conditions at teardown**: `markPublishing` is called immediately before
  the review is posted. After that point a firing deadline is logged and
  discarded, and it cannot change the outcome. This is the guard that prevents
  the only genuinely damaging race in the design: publishing both a review and a
  contradictory "timed out" check run for the same pass. A deadline that fires
  before `markPublishing` aborts the model request, and the pass fails with
  `timed_out`.
- **Error propagation across async boundaries**: the timer callback contains no
  `await` and cannot throw. Every awaited call in `runReviewPass` sits inside a
  `try`/`catch` that maps the error to a `FailureReason`, so failures are always
  published rather than swallowed. `src/cli/review-pr.ts` additionally registers
  `process.on('unhandledRejection')` and `process.on('uncaughtException')`
  handlers that log the error and exit non-zero, so no asynchronous failure can
  end the run silently.

---

## Seed Data

No database and therefore no database seed data. The deterministic fixtures the
tests require are:

| Entity | Values / Scenario | File |
| --- | --- | --- |
| Changed-file list | Three entries: a modified file with two hunks, an added file, and a binary file with no `patch` field | `tests/fixtures/pull-request-files.json` |
| Pull-request metadata | Ready pull request with title, body, and head SHA `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`; a draft variant; a variant whose head SHA differs on re-read | `tests/fixtures/pull-requests.json` |
| Model response — happy path | One blocking finding on a changed line, one nit on an unchanged path, wrapped in a fence tagged `json` | `tests/fixtures/model-response-fenced.txt` |
| Model response — bare JSON | The same payload with no fence | `tests/fixtures/model-response-bare.json` |
| Model response — unusable | Prose with no JSON object | `tests/fixtures/model-response-unusable.txt` |
| Model response — empty findings | An object whose `findings` array is empty | `tests/fixtures/model-response-empty.json` |
| Diff patches | One patch per row of the hunk-parser edge-case table, keyed by row identifier | `tests/fixtures/patches.json` |
| Dogfood pull request | A throwaway branch on `lhpaul/ai-dev-framework-template` containing one deliberate defect on a changed line, so the run produces at least one inline finding | Created during the smoke test, not committed here |

---

## Documentation Updates

> Listed for the developer to execute after implementation. Not performed during
> Plan Ready.

- [ ] `docs/project/2-repo-architecture.md` — add `src/` and `tests/` to the
      directory structure; replace the "TBD in v0 spec" entries in the
      Applications / Services table with the real entry points; record that the
      reusable workflow is the v0 ingress; keep `~/.config/ronda/` in the
      never-committed list and add `ronda.config.example.json` as the committed
      example; confirm `npm test` and `npm run lint` now exist.
- [ ] `docs/project/3-software-architecture.md` — fill in the Tech Stack table
      (TypeScript on Node 20, `@octokit/rest`, `tsx` plus the Node test runner,
      ESLint); add the Testing Strategy section that `docs/best-practices/3-testing.md`
      points at; record the decisions that terminal-only check runs and REST-only
      diff reads are deliberate.
- [ ] `docs/best-practices/STACK-SPECIFIC.md` — replace "v0 stack is chosen in
      the spec" with the actual TypeScript conventions, including the rule that
      `src/core/` must not import from `src/cli/`.
- [ ] `docs/best-practices/3-testing.md` — fill in the "Running Tests" commands.
- [ ] `docs/testing/README.md` — add the committed-spec path convention for this
      repository and the run commands, replacing the placeholder text.
- [ ] `AGENTS.md` — fill in the "Common Commands" placeholders with the real
      build, test, and lint commands, and add a Troubleshooting entry for a pass
      that fails with a credential reason.
- [ ] `README.md` — state what Ronda is and link to
      `docs/adoption/ronda-review-adoption.md`.
- [ ] `docs/project/1-business-domain.md` — note that in v0 the "Ronda process"
      actor is the reusable workflow run rather than a long-running server.
- [ ] `docs/project/4-database-model.md` — no change required; v0 introduces no
      persistence, which is what that document already states.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| The review API rejects the whole payload because one finding's line is not part of the diff | Med | High | Pre-validate every line against `parseCommentableLines`, and fall back once on HTTP 422 to a summary-only review so no finding is lost |
| The model returns prose instead of the JSON contract | High | Med | Tolerant extraction covering fenced and bare JSON, a hard `unusable_output` failure when nothing parses, and a check run that names the reason so the operator can re-run |
| Fork pull requests get a read-only `GITHUB_TOKEN` and cannot receive a review | Med | Med | v0 scopes the caller workflow to `pull_request`, which covers the same-repository dogfood target. Fork support via `pull_request_target` is named in the adoption guide as a documented limitation and a follow-up, not attempted here |
| Two automatic events for one head SHA both start before either publishes | Low | Med | The check-run duplicate query plus the recommended caller-side `concurrency` block with `cancel-in-progress: true` |
| The chosen default model name is unavailable on the operator's DashScope account | Med | Low | Model name and base URL are inputs on the reusable workflow and keys in the operator config file; changing either is configuration, and a wrong value surfaces as a named `model_unavailable` failure |
| Very large diffs exhaust the model context or the time budget | Med | Med | `DEFAULT_MAX_PATCH_CHARS` fails the pass with `changes_too_large` before the model is called, which is the failure reason the spec already names |
| Adding a root TypeScript project disturbs the template-owned `hooks/` and `e2e/` trees | Low | Med | The root `tsconfig.json` includes only `src` and `tests`, and `eslint.config.js` ignores `hooks`, `e2e`, `template`, and `docs` |
| The check run is absent rather than pending while a pass runs, confusing a waiting consumer | Med | Low | Documented explicitly in the adoption guide's consumption contract, and asserted by smoke test step 9 |

---

## Code Samples

All code in this plan is illustrative and must be adapted during
implementation. Only two shapes are load-bearing, because consumers depend on
them.

The caller workflow that an adopting repository commits — the shape documented
in `docs/adoption/ronda-review-adoption.md`:

```yaml
# Illustrative — adapt during implementation.
name: Ronda review
on:
  pull_request:
    types: [opened, reopened, ready_for_review, synchronize]
  issue_comment:
    types: [created]
concurrency:
  group: ronda-review-${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: true
permissions:
  contents: read
  pull-requests: write
  checks: write
jobs:
  ronda:
    uses: lhpaul/ronda/.github/workflows/ronda-review.yml@main
    secrets:
      model_api_key: ${{ secrets.RONDA_MODEL_API_KEY }}
```

The model output contract embedded in the prompt and enforced by
`parseModelResponse`:

```json
{
  "findings": [
    {
      "path": "src/example.ts",
      "line": 42,
      "severity": "blocking",
      "title": "Short imperative title",
      "body": "Why this matters and what to do about it."
    }
  ]
}
```

---

## Implementation Order

1. Create the TypeScript project foundation: `tsconfig.json`,
   `eslint.config.js`, the `package.json` name, description, script, and
   dependency changes, the refreshed `package-lock.json`, and the `.gitignore`
   additions. Verify by running `npm run typecheck` and `npm run lint` on an
   empty `src/` and confirming both commands run and report no errors.
2. Add `.github/workflows/node-ci.yml`. Verify with the planted-violation proof:
   introduce a deliberate type error and a deliberate lint error, run
   `npm run typecheck` and `npm run lint` locally, confirm each reports the
   planted file and line, then remove both and confirm the commands pass.
3. Implement the domain and configuration layers: `src/domain/review-pass.types.ts`,
   `src/domain/severity.ts`, `src/config/config.types.ts`,
   `src/config/load-config.ts`, plus `tests/unit/config/load-config.test.ts` and
   `ronda.config.example.json`. Verify with `npm test`.
4. Implement `src/github/diff-lines.ts` and
   `tests/unit/github/diff-lines.test.ts` covering rows P1 through P16, with the
   patches in `tests/fixtures/patches.json`. Verify with `npm test` and confirm
   the output lists one passing test per row identifier.
5. Implement `src/inference/model-client.ts`,
   `src/inference/openai-compatible-client.ts`, and
   `src/inference/review-prompt.ts`. No vendor name appears outside this
   directory — verify with `git grep -in "dashscope\|qwen" -- src` and confirm
   the only hits are the default constants in `src/config/load-config.ts` and
   documentation strings.
6. Implement `src/inference/parse-model-response.ts` and
   `tests/unit/inference/parse-model-response.test.ts` covering rows M1 through
   M19, with the fixtures listed in the Seed Data section. Verify with
   `npm test`.
7. Implement `src/core/pass-deadline.ts`, `src/core/summary.ts`,
   `src/core/logger.ts`, and their unit tests. Verify with `npm test`.
8. Implement `src/github/github-client.ts`,
   `src/github/pull-request-reader.ts`, `src/github/review-publisher.ts`, and
   `src/github/check-run-publisher.ts`. Verify with `npm run typecheck`.
9. Implement `src/core/run-review-pass.ts` and
   `tests/unit/core/run-review-pass.test.ts` covering testing scenarios 1
   through 11. Verify with `npm test`.
10. Implement `tests/support/mock-model-server.ts` and
    `tests/integration/review-pass.test.ts`. Verify with `npm test` and confirm
    the integration test asserts the exact review and check-run payloads.
11. Implement `src/cli/resolve-trigger.ts`,
    `tests/unit/cli/resolve-trigger.test.ts` covering rows T1 through T10, and
    `src/cli/review-pr.ts`. Verify with `npm test`.
12. Add `.github/workflows/ronda-review.yml` and
    `docs/adoption/ronda-review-adoption.md`. Verify by running
    `npm run review` locally against a real pull request in this repository with
    `RONDA_MODEL_API_KEY` exported, and confirm a review and a check run appear.
13. Run the residual verification described in the next section and record the
    output in the pull-request description.
14. Execute
    `docs/testing/ronda/ronda-v0-github-review.smoke-test.md`
    end to end, including the dogfood run against
    `lhpaul/ai-dev-framework-template`, and record the result.
15. Update the project documentation listed under **Documentation Updates**.
16. Add `changelog.d/2.added.ronda-v0-github-review.md` with exactly this body:

    ```markdown
    - **Ronda v0 GitHub review** (#2): a reusable GitHub Actions workflow posts
      one comment-only review and one check run per head SHA on ready pull
      requests, with findings from a configurable OpenAI-compatible model vendor.
    ```

---

## Residual Verification Strategy

Acceptance criterion 15 is a completeness claim about the whole repository, so
it needs evidence rather than assertion. Before the implementation pull request
is marked ready for human review, the developer runs both commands below and
pastes the output into the pull-request description.

```bash
git grep -nI -e "/Users/" -e "sk-" -e "Bearer " -- src tests .github ronda.config.example.json docs/adoption
git grep -nI "RONDA_MODEL_API_KEY" -- src tests .github docs ronda.config.example.json
```

Read the first command's output and confirm it is empty, or that every hit is an
obvious documentation placeholder rather than a real value. Read the second
command's output and confirm every hit references the variable by name only —
never a value, never an operator-specific secret name such as a personal or
account-scoped identifier. The spec's phrase "credential name … belonging to a
specific operator" is read here as prohibiting operator-scoped names, not the
generic `RONDA_MODEL_API_KEY` variable that the code must reference to work.

**Evidence source**: the two command outputs above, plus the smoke test's
assertions checklist. That is the whole evidence set; there is no follow-up
residual expected.
