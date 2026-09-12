# Repository Architecture

## Overview

Single-repo ADF consumer (`single_repo`). Owns tracker, specs, plans, and the
Ronda service. v0 ships the review core as a TypeScript project run directly
via `tsx` (no committed build artifact), exposed through a reusable GitHub
Actions workflow and a local GitHub App webhook service. The two ingress paths
share the same review core and produce the same GitHub review/check-run
contract.

## Directory Structure

```
ronda/
├── docs/
│   ├── constitution.md
│   ├── project/
│   ├── best-practices/
│   ├── adoption/                 # ronda-review-adoption.md
│   └── workflow/                 # ADF (template-owned)
├── src/
│   ├── domain/                   # PassOutcome, Finding, Severity, ports
│   ├── config/                   # RondaConfig, loadConfig
│   ├── github/                   # Octokit wrapper, PR reader, diff parser, publishers
│   ├── inference/                # ModelClient seam, OpenAI-compatible client, prompt, parser
│   ├── core/                     # runReviewPass orchestration, deadline, summary, logger
│   ├── cli/                      # Action entrypoint (review-pr.ts), trigger resolution
│   └── webhook/                  # Local GitHub App webhook service
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── support/                  # mock-model-server.ts
│   └── fixtures/
├── scripts/                      # ADF + future install/tunnel helpers
├── .github/workflows/
│   ├── ronda-review.yml          # reusable workflow — the v0 ingress
│   └── node-ci.yml               # typecheck + lint + test on PRs to develop/main
├── ronda.config.example.json     # committed, non-secret operator config template
├── .ai-dev-workflow.yaml         # GitHub Project #11
├── CHANGELOG.md
├── AGENTS.md
└── README.md
```

Local, never committed:

```
~/.config/ronda/config.json   # model API key, base URL, model name, budgets
                               # (see ronda.config.example.json for the shape)
```

## Applications / Services

| Name | Purpose | Stack | Entry point |
| --- | --- | --- | --- |
| Review core | Orchestrate one pass: read PR, call model, publish review + check run | TypeScript on Node 20 | `src/core/run-review-pass.ts` (`runReviewPass`) |
| Inference client | Call an OpenAI-compatible model API | TypeScript, `fetch` | `src/inference/openai-compatible-client.ts` |
| GitHub poster | Submit review + check run | `@octokit/rest` | `src/github/review-publisher.ts`, `src/github/check-run-publisher.ts` |
| Action entrypoint | Translate GitHub Actions env vars into one `runReviewPass` call | TypeScript via `tsx` | `src/cli/review-pr.ts` |
| Local webhook service | Verify GitHub App webhooks, mint installation tokens, run one in-flight `runReviewPass` job | TypeScript on Node `http` | `src/webhook/webhook-server.ts` |

The reusable Action and local webhook paths are alternate ingresses. A
repository should not enable both for the same trigger without an external
filter or future shared arbitration, because manual review commands would reach
both paths. `src/core/` imports from neither `src/cli/` nor `src/webhook/`, so
both entrypoints reuse the core unchanged.

## Common Commands

```bash
npm ci
npm run typecheck
npm run lint
npm test
```

Product command (the Action entrypoint, also runnable locally):

```bash
# Requires GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_NAME, and
# GITHUB_EVENT_PATH in the environment, plus a model credential (see
# docs/adoption/ronda-review-adoption.md).
npm run review
```

Local webhook service:

```bash
# Requires GitHub App webhook secret, app id, private key, installation access,
# and a model credential; see docs/adoption/ronda-local-webhook.md.
npm run webhook
```

## Environment Setup

1. Clone `lhpaul/ronda` (default branch `develop`) and run `npm ci`.
2. To run a pass locally against a real pull request, export `GITHUB_TOKEN`
   and either `RONDA_MODEL_API_KEY` or a
   `~/.config/ronda/config.json` copied from `ronda.config.example.json`.
3. To adopt Ronda in another repository, follow
   [`docs/adoption/ronda-review-adoption.md`](../adoption/ronda-review-adoption.md).
4. To dogfood the GitHub App webhook path locally, follow
   [`docs/adoption/ronda-local-webhook.md`](../adoption/ronda-local-webhook.md).
