# Software Architecture

## Tech Stack

| Layer | Choice | Notes |
| --- | --- | --- |
| Language / runtime | TypeScript on Node 20 | Run directly via `tsx`; no committed build artifact (`dist/` is gitignored) |
| GitHub API client | `@octokit/rest` | Bounded retry (at most twice, 2s then 5s backoff) on HTTP 5xx / secondary rate limit only |
| Inference | OpenAI-compatible HTTP API behind `ModelClient` | v0 default: Qwen/DashScope; vendor is configuration, never hardcoded outside `src/inference/` |
| Ingress (v0) | Reusable GitHub Actions workflow (`ronda-review.yml`, `workflow_call`) | Webhook/App is a later item; the review contract does not change when it arrives |
| Host | GitHub-hosted Actions runner (v0) | MacBook/Mini/MiniPC hosting arrives with the webhook process |
| GitHub output | Pull Request Review + check run (`Ronda review`) | So ADF `pr-review-loop.sh` can wait |
| Test runner | Node's built-in test runner via `tsx --test`, `node:assert/strict` | No mocking framework — every `runReviewPass` dependency is injected |
| Lint | ESLint flat config (`eslint.config.js`), `typescript-eslint` recommended | Scoped to `src/` and `tests/` only |
| CI | GitHub Actions (`node-ci.yml`): typecheck, lint, test on PRs to `develop`/`main` | Path-scoped to the TypeScript project files |

## Testing Strategy

**Two-tier model**: a committed automated suite (preferred) plus a manual
smoke runbook as the second tier — see
[`docs/best-practices/3-testing.md`](../best-practices/3-testing.md).

- **Unit** (primary): `tests/unit/**/*.test.ts`, run via
  `tsx --test "tests/**/*.test.ts"`. Every dependency of `runReviewPass`
  (`GithubOperations`, `ModelClient`, `Clock`, `Logger`, `RondaConfig`) is
  injected, so tests run with fakes and no network.
- **Integration** (one path, real HTTP to a local stub): `tests/integration/review-pass.test.ts`
  runs a full pass against `tests/support/mock-model-server.ts` (a local
  OpenAI-compatible stub) with only the GitHub layer faked, asserting the
  exact review and check-run payloads.
- **Smoke** (manual, against real GitHub): `docs/testing/ronda/ronda-v0-github-review.smoke-test.md`,
  covering the dogfood run against `lhpaul/ai-dev-framework-template` and
  cases impractical to stage in CI (missing credential, timeout, supersede).
- **E2E/regression**: the repository's only committed suite is the `e2e/`
  Playwright placeholder, which exercises no product behavior and has no
  fixture data. Ronda has no browser surface, so that suite is not extended
  by this feature — `tests/integration/review-pass.test.ts` is the
  regression coverage instead. The E2E Fixture Contract in
  `docs/best-practices/3-testing.md` is recorded **not applicable** for this
  reason.

Run commands:

```bash
npm run typecheck
npm run lint
npm test
```

## Key Architectural Decisions

### URL is not the machine

- **Context**: Tests can start on the MacBook; 24/7 and local models live elsewhere.
- **Decision**: GitHub sees a hostname. A tunnel maps it to the current process.
- **Consequences**: Change tunnel target without rotating the GitHub App.

### Comment-only, one pass per SHA

- **Context**: CodeRabbit rate-limits; Codex/Copilot stall after the first finding.
- **Decision**: Publish every finding in one review; never push fixes.
- **Consequences**: ADF loop owns fix cycles; this bot stays a reviewer.

### Thin ADF/Helm adapters, fat product here

- **Context**: The template already has a platform list for GitHub reviewers.
- **Decision**: Add one provider name; do not implement the bot inside ADF.
- **Consequences**: Follow-ups of the bot stay in Project #11.

### Action is an allowed v0 stand-in

- **Context**: A GitHub App takes registration; an Action can dogfood the poster.
- **Decision**: v0 spec may ship a reusable workflow first, then the App.
- **Consequences**: The poster API is the stable core either way.

### The check run is created only at terminal time

- **Context**: Creating an `in_progress` check run at pass start would leave
  it permanently pending whenever the Actions run is cancelled — exactly
  what happens on the supersede path (a newer commit lands mid-pass).
- **Decision**: `publishCheckRun` is called exactly once per pass, at the
  end, with `status: completed` already set. There is no earlier "pass
  started" check-run write.
- **Consequences**: A waiting consumer sees "no check run yet" while a pass
  is in flight, never a stuck `in_progress` run. This makes acceptance
  criterion 16 ("never left pending with no explanation") true by
  construction rather than by a cleanup step. The adoption guide's
  consumption contract states this explicitly so a waiting loop treats
  absence as "not finished yet".

### Diffs are read over the REST API; the reviewed repository is never checked out

- **Context**: v0's only ingress is a reusable workflow another repository
  calls; checking out that repository's code would require broader
  permissions and a second git identity to reason about.
- **Decision**: `readChangedFiles` reads `GET .../pulls/{number}/files` (the
  `patch` field) instead of cloning the pull request's branch. The reusable
  workflow's only checkout is of `lhpaul/ronda` itself.
- **Consequences**: Ronda never runs the reviewed repository's code, which
  keeps the manual `/ronda review` comment trigger low-risk even on a fork
  pull request's comment thread — there is no "pwn request" surface because
  nothing untrusted is executed. The tradeoff is `src/github/diff-lines.ts`
  must tolerate every unified-diff edge case GitHub's API can return (see
  the implementation plan's parser-risk addendum) since there is no local
  git history to fall back on.

## Security

- Ronda never pushes to, merges, or otherwise mutates the pull request
  branch or its state — see `docs/constitution.md`.
- v0: the model API credential is a GitHub Actions repository/organization
  secret (`RONDA_MODEL_API_KEY`) on the reusable-workflow path, or a local
  `~/.config/ronda/config.json` (never committed — see `.gitignore`) on the
  local-CLI path. `src/core/logger.ts` redacts both the resolved model key
  and any `authorization`-named field before writing a log line.
- No credential value, credential name, account identifier, hostname, or
  personal filesystem path belonging to a specific operator is committed to
  this repository — verified by the residual-verification grep commands in
  the implementation plan before every feature PR that touches
  configuration or secrets handling.
- **Later (post-v0)**: once the webhook process replaces the reusable
  workflow, its request signature is verified on every inbound call, and
  installation tokens come from the GitHub App rather than a long-lived PAT.
  v0's Action path has no webhook signature to verify.
