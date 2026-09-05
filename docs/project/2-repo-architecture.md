# Repository Architecture

## Overview

Single-repo ADF consumer (`single_repo`). Owns tracker, specs, plans, and the
Ronda service. Bootstrap ships constitution and domain docs; the HTTP
server lands in later items.

## Directory Structure

```
ronda/
├── docs/
│   ├── constitution.md
│   ├── project/
│   ├── best-practices/
│   └── workflow/                 # ADF (template-owned)
├── scripts/                      # ADF + future install/tunnel helpers
├── .ai-dev-workflow.yaml         # GitHub Project #11
├── CHANGELOG.md
├── AGENTS.md
└── README.md
```

Local, never committed:

```
~/.config/ronda/              # webhook secret, model API keys, bind port
```

## Applications / Services

| Name | Purpose | Stack | Entry point |
| --- | --- | --- | --- |
| Webhook server | Receive GitHub events, run a review job | TBD in v0 spec | future |
| Inference client | Call API or local model | TBD | behind the server |
| GitHub poster | Submit review + check run | GitHub API | future |

v0 may start as a GitHub Action that calls the same poster, then move the
listener to a long-running process behind a tunnel. The review contract stays.

## Common Commands

```bash
npm test
npm run lint
```

Product commands (planned):

```bash
# Run the server on this machine (MacBook or Mini)
ronda serve --port 8787

# Tunnel is operator-owned (cloudflared, etc.), not this binary
```

## Environment Setup

1. Clone `lhpaul/ronda` (default branch `develop`).
2. Point a public HTTPS URL at `localhost:<port>` when testing on the MacBook.
3. Put GitHub App webhook secret and model keys in local config / 1Password.
