# Running Ronda From a Local Webhook

Ronda can run the same review pass from a local HTTP webhook service instead of
a caller GitHub Actions job. GitHub still sees the same public contract: a
comment-only review and one `Ronda review` check run per head SHA.

## When to Use This Path

Use the local webhook path when you want review computation to run on an
operator-owned machine, such as a MacBook during dogfooding and later a Mini or
MiniPC. During migration, keep the reusable Action path available as a rollback
option, but do not enable both ingresses for the same repository triggers unless
one path is filtered off. Without that arbitration, a manual `/ronda review`
comment can start both the Action and webhook paths and produce duplicate
reviews for the same head SHA.

## GitHub App Requirements

Create or update a GitHub App with:

- Webhook events: `pull_request` and `issue_comment`.
- Repository permissions: `Contents: read`, `Pull requests: read and write`,
  `Checks: read and write`, `Issues: read`, `Metadata: read`.
- Webhook secret: a random secret stored only on the local machine.
- Private key: stored outside the repository.

Install the App on every repository Ronda should review. The webhook payload's
`installation.id` is used to mint an installation token for that repository, so
one App webhook URL can route reviews across installations without storing
repository-specific personal tokens.

## Local Configuration

Set these environment variables on the machine that will receive webhooks:

```bash
export RONDA_WEBHOOK_SECRET="<github-app-webhook-secret>"
export RONDA_GITHUB_APP_ID="<github-app-id>"
export RONDA_GITHUB_PRIVATE_KEY_FILE="$HOME/.config/ronda/github-app-private-key.pem"
export RONDA_MODEL_API_KEY="<model-vendor-key>"
```

Optional settings:

```bash
export RONDA_WEBHOOK_HOST="127.0.0.1"
export RONDA_WEBHOOK_PORT="3000"
export RONDA_GITHUB_APP_TOKEN_TIMEOUT_MS="60000"
export RONDA_WEBHOOK_JOB_TIMEOUT_MS="900000"
export RONDA_WEBHOOK_JOB_SETTLEMENT_TIMEOUT_MS="30000"
export RONDA_WEBHOOK_QUEUE_PATH="$HOME/.config/ronda/webhook-queue.json"
export RONDA_DETAILS_URL="https://example.test/ronda"
```

`RONDA_GITHUB_PRIVATE_KEY` can be used instead of
`RONDA_GITHUB_PRIVATE_KEY_FILE`; escaped `\n` sequences are accepted. Model
configuration follows the same precedence as the Action path:
`RONDA_MODEL_API_KEY`, `RONDA_MODEL_BASE_URL`, `RONDA_MODEL_NAME`,
`RONDA_PASS_TIMEOUT_MS`, and `RONDA_MAX_PATCH_CHARS` override the local operator
config file. `RONDA_GITHUB_APP_TOKEN_TIMEOUT_MS` bounds the pre-pass GitHub App
installation-token request, `RONDA_WEBHOOK_JOB_TIMEOUT_MS` bounds each full
accepted job, and `RONDA_WEBHOOK_JOB_SETTLEMENT_TIMEOUT_MS` bounds how long the
worker waits for a timed-out job to settle after abort before it stops the local
server for supervisor recovery. `RONDA_WEBHOOK_QUEUE_PATH` stores accepted jobs
until they complete, so queued work can be recovered by the supervisor-started
process after a fail-stop restart.

## MacBook and Tunnel Dogfood

Start the service locally:

```bash
npm run webhook
```

Expose `http://127.0.0.1:3000/webhook` through a stable tunnel URL, then set the
GitHub App webhook URL to:

```text
https://<tunnel-host>/webhook
```

Keep the terminal visible during early dogfooding. GitHub receives a quick `202`
for accepted review jobs. The service runs one active review at a time and keeps
a bounded in-process FIFO queue for additional runnable deliveries, which avoids
depending on manual GitHub redelivery while the local worker is busy. If the
queue is full, or if the tunnel or machine is offline, GitHub deliveries fail at
the webhook layer; switch the repository back to the reusable Action workflow
when you need the migration fallback. Accepted local review jobs are wrapped in
an outer timeout; after an abort, the FIFO does not advance until the active job
settles. If a job ignores abort past the settlement timeout, the worker stops
instead of starting another job concurrently. Terminal check-run writes receive
their own short timeout so stalled GitHub calls do not leave the process alive
indefinitely.

## Mini or MiniPC Hosting Path

After the MacBook dogfood path is reliable, move the same environment variables,
private key file, and repository checkout to the always-on machine. Run the
service under the host's process supervisor, bind it to localhost, and expose it
through the same tunnel or reverse proxy URL. Keep the GitHub App unchanged;
only the endpoint behind its webhook URL moves.

## Supported Events

The local webhook path handles the same triggers as the Action entrypoint:

- `pull_request`: `opened`, `reopened`, `ready_for_review`, `synchronize`
- `issue_comment`: a newly created PR comment whose first meaningful unquoted
  line is `/ronda review`

Draft skip, new-head supersession, manual re-runs, one check run per head SHA,
and no branch mutation are preserved by reusing Ronda's existing review core.
