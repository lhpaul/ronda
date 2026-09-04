# Database Model

## Overview

v0 does **not** need a product database. A review job is ephemeral: event →
inference → GitHub review. Optional local logs on the host filesystem.

If job history is needed later (cost, latency, SHA), add a small table then.
Do not copy Fleet’s node registry.

## Schema Overview

None required for v0.

Optional later:

```
review_jobs (repo, pr, head_sha, status, model, cost_usd, started_at, finished_at)
```

GitHub remains the source of truth for the review comments themselves.

## Access Control

The process authenticates to GitHub as the App installation. Operators do not
get a multi-tenant table in v0.

## Migrations

None until a spec introduces persistence.
