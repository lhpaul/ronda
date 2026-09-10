# Stack-Specific Best Practices

## Stack Summary

TypeScript on Node 20, run directly via `tsx` — no committed build
artifact. `@octokit/rest` for GitHub, an OpenAI-compatible `fetch` client
for inference, `tsx --test` + `node:assert/strict` for tests, ESLint flat
config for lint. See `docs/project/3-software-architecture.md` → Tech Stack
for the full table.

- `src/core/` must not import from `src/cli/`. The core is entrypoint-
  agnostic so the later long-running webhook process can call
  `runReviewPass` directly, unchanged. Constants both layers need (for
  example `REVIEW_COMMAND`) are declared in `src/domain/` and re-exported
  from the layer the plan names as their primary home.
- Every dependency of `runReviewPass` (`GithubOperations`, `ModelClient`,
  `Clock`, `Logger`, `RondaConfig`) is injected via `ReviewPassDeps`. Do not
  reach for a global, a singleton, or a direct `fetch`/`octokit` call inside
  `src/core/` — add a seam and inject it, the way `src/inference/model-client.ts`
  seams the model vendor.
- Nothing outside `src/inference/` may reference a model vendor by name
  (no `dashscope`, `qwen`, or any other vendor string). Vendor defaults live
  only as named constants in `src/config/load-config.ts`.
- The GitHub review payload and webhook verification (once the webhook
  process exists) stay independent of the model vendor.
- The public URL is operator config (tunnel), not a constant in this repo.
- No LH hostnames in git (`mac-mini`, `lhpaul.cl` in examples only).

## Quick Reference

- **Constitution wins** over "just push a fix from the bot".
- **One SHA, one review.** `findExistingCheckRun` is checked before every
  publish, automatic or manual.
- **Webhook URL is movable.** Tests on the MacBook are valid.
- **Do not implement this inside ADF.** Adapter only.
