# Repository Architecture

## Overview

Single-repo ADF consumer (`single_repo`). Owns tracker, specs, plans, and the
Ronda service. v0 ships the review core as a TypeScript project run directly
via `tsx` (no committed build artifact), exposed through a reusable GitHub
Actions workflow. The long-running HTTP server is a later item; the review
contract this v0 workflow produces does not change when that ingress arrives.

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
│   └── cli/                      # Action entrypoint (review-pr.ts), trigger resolution
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

v0 starts as a reusable GitHub Action that calls the same review core; a
later item moves the listener to a long-running process behind a tunnel.
`src/core/` never imports from `src/cli/`, so that move reuses the core
unchanged.

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

## Environment Setup

1. Clone `lhpaul/ronda` (default branch `develop`) and run `npm ci`.
2. To run a pass locally against a real pull request, export `GITHUB_TOKEN`
   and either `RONDA_MODEL_API_KEY` or a
   `~/.config/ronda/config.json` copied from `ronda.config.example.json`.
3. To adopt Ronda in another repository, follow
   [`docs/adoption/ronda-review-adoption.md`](../adoption/ronda-review-adoption.md).
