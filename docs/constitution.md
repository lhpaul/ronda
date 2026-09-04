# Reviewer constitution

Locked decisions for `lhpaul/reviewer`. Product docs (`docs/project/`) describe
the domain. This file is the **contract**.

Decided with LH on 2026-09-04.

## One sentence

A **GitHub PR reviewer**: comment-only reviews on the pull request, driven by
cheap API models first and a local model later. ADF and Helm *consume* it; they
do not implement it.

## Layers (do not mix)

| Layer | Question it answers | Lives in |
| --- | --- | --- |
| **Reviewer** (this repo) | Who comments on the GitHub PR? | This repository |
| **ADF** | How an item is built; the *loop* that waits for this review | `lhpaul/ai-dev-framework-template` |
| **Helm** | Product workflow; `review.external.provider` points here | `lhpaul/helm` |
| **Fleet** | Where agents run and how LH talks to them | `lhpaul/dev-fleet` |

This is **not** `local-ai-reviewer` (Codex CLI inside the ADF loop). That stays
an in-loop check. This product is the GitHub-facing bot (Bugbot / CodeRabbit /
Codex GitHub class).

This is **not** Fleet. A Fleet node may later *host* inference; the GitHub App
and review contract live here.

## Surface

- Posts **one** GitHub pull-request review per head SHA: inline comments +
  summary + a check run the ADF loop can wait on.
- **Does not push fixes.** The ADF fixer already exists. Mixing review + fix is
  what stalls PRs for a day.
- New commit → new pass. No endless thread on a stale SHA.
- Timeout in minutes, not hours. Silence is a failure, not a hang.

## Ingress: one public URL, movable machine

GitHub talks to **one webhook URL** (GitHub App setting, or a stable hostname
in front of it). That URL is configuration, not product code.

```text
GitHub  →  https://reviewer.example  →  tunnel  →  process on a machine
```

The hostname can point at:

- the MacBook, while developing and testing (machine awake);
- the Mac Mini, for 24/7;
- the MiniPC, when local inference lives there.

Same App, same bot identity. Only the tunnel/backend changes. Secrets stay in
1Password / local env, not in git.

The MacBook is a valid first host. It will miss webhooks if it sleeps or the
lid is closed; that is expected for a spike, not a reason to wait for the Mini.

## Inference (swappable)

v0: API models (GLM, Qwen, or equivalent).  
Later: local model on a capable machine. The HTTP handler and GitHub review
payload do not change.

## How ADF and Helm attach

ADF: a thin platform in `pr-review-loop.sh` / `.ai-dev-workflow.yaml`
(`on_draft.github` / `on_ready.github`).  
Helm: `review.external.provider`.  
This repo does not copy the loop.

## v0 vs later

**v0**

- Webhook (or reusable Action as a temporary stand-in) + review poster
- Dogfood on one LH repo from the MacBook
- API model
- Check run + comment-only review per SHA

**Later**

- GitHub App installed on many repos
- Local model backend
- Hosting the process 24/7 on Mini / MiniPC via the same URL

**Out of v0**

- Fleet leases / Telegram
- Replacing the ADF reviewer-loop
- Marketplace SaaS
- Auto-fixing the PR
