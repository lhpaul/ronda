# Business Domain

## Overview

Ronda is a GitHub-facing code-review bot. It reads a pull request diff,
produces findings, and publishes them as a GitHub review (inline comments +
summary + check run). Humans and the ADF reviewer-loop consume that review.
It does not implement product features and does not merge.

## Actors

| Actor | Description |
| --- | --- |
| GitHub | Sends pull-request events to the webhook URL. |
| Ronda process | Either one reusable GitHub Actions workflow run (`src/cli/review-pr.ts` → `runReviewPass`) or the local webhook service (`src/webhook/webhook-server.ts` → `runReviewPass`) for a repository that has migrated to the App path. |
| Inference backend | API (GLM/Qwen/…) or a local model. Swappable. |
| ADF reviewer-loop | Waits on the check/review and drives fix cycles. |
| Operator | Installs the App, points the webhook URL at a machine, reads findings. |

## Core Entities

### Review job

- **Description**: One pass over one head SHA of one PR.
- **Key attributes**: repo, PR number, head SHA, status, started_at, finished_at.
- **Relationships**: produces one GitHub review for that SHA.

### Finding

- **Description**: A single issue in the diff.
- **Key attributes**: path, line, severity, body.
- **Relationships**: belongs to a review job; posted as an inline comment.

### Webhook endpoint

- **Description**: The public URL GitHub calls. Not a machine identity.
- **Key attributes**: HTTPS URL, App or secret.
- **Relationships**: tunneled to whichever host is awake.

## Business Rules

- Comment-only: never push to the PR branch.
- One GitHub review per head SHA.
- All findings in that one review (do not stop at the first issue).
- The webhook URL is operator config; moving host does not change the App.
- A repository should use one active Ronda ingress for a trigger at a time
  until shared Action/webhook arbitration exists.
- Secrets and model API keys are not in git.
- ADF/Helm remain the orchestrators of “is this PR ready?”.

## Glossary

| Term | Definition |
| --- | --- |
| Ronda | This product (GitHub bot + backend). |
| Reviewer-loop | ADF script that waits on GitHub reviews. |
| `local-ai-reviewer` | In-loop Codex check; not this product. |
| Webhook URL | Public HTTPS target in GitHub App settings. |
| Tunnel | cloudflared / Tailscale / equivalent from URL → localhost. |

## Out of Scope

- Fleet Telegram, leases, daemons.
- Implementing or merging the change under review.
- Cerebro Console.
- A general LLM chat product.
