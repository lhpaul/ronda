# Adopting Ronda's review workflow

Ronda reviews a pull request by calling a reusable GitHub Actions workflow
from your own repository. A local webhook service is also available for
dogfooding one GitHub App webhook URL on operator-owned hardware; see
[`ronda-local-webhook.md`](ronda-local-webhook.md).

## 1. Add the caller workflow

Commit this file to your repository's default branch, for example
`.github/workflows/ronda-review.yml`:

```yaml
name: Ronda review
on:
  pull_request:
    types: [opened, reopened, ready_for_review, synchronize]
  issue_comment:
    types: [created]
concurrency:
  group: ronda-review-${{ github.event.pull_request.number || github.event.issue.number }}
  cancel-in-progress: true
jobs:
  ronda:
    permissions:
      contents: read
      pull-requests: write
      checks: write
    # Cheap caller-side pre-filter. Not load-bearing for correctness — Ronda
    # re-checks the draft state and the exact comment text itself, so this
    # only saves CI minutes on requests Ronda would immediately skip anyway.
    if: |
      (github.event_name == 'pull_request' && github.event.pull_request.draft != true) ||
      (github.event_name == 'issue_comment' && github.event.issue.pull_request != null)
    uses: lhpaul/ronda/.github/workflows/ronda-review.yml@main
    secrets:
      model_api_key: ${{ secrets.RONDA_MODEL_API_KEY }}
```

The `permissions:` block on the caller job above is **required, not
optional**. A called reusable workflow can only **narrow** the caller's
`GITHUB_TOKEN`, never widen it — `lhpaul/ronda/.github/workflows/ronda-review.yml`
declaring its own `permissions: { contents: read, pull-requests: write,
checks: write }` does not grant those scopes to a caller that does not also
request them. GitHub's default for new repositories is
`default_workflow_permissions: "read"`, so without the block above the
reusable workflow's request for `pull-requests: write` and `checks: write`
is unreachable and the run fails at **startup with zero jobs, no logs, and
no annotations reachable from the REST API** — the real error is visible
only in the Actions web UI, as `error parsing called workflow` or a
permissions rejection. This was reproduced on `lhpaul/helm-playground`
(`{"default_workflow_permissions":"read"}`): four consecutive runs failed
with zero jobs until the caller-side `permissions:` block above was added.

As an alternative, you can raise the repository-wide default under
**Settings → Actions → General → Workflow permissions**. The per-job block
above is recommended instead: it is narrower (it grants only what this job
needs) and works regardless of the repository's default setting.

### Prerequisite: reusable-workflow access (private repositories only)

`lhpaul/ronda` is public today, so this does not block adoption right now.
If you run a private fork or your own instance of Ronda, GitHub separately
requires the repository that **hosts** the reusable workflow to explicitly
allow the **calling** repository to use it — independent of the
`permissions:` block above. Without this, the caller run fails with the
same zero-jobs, no-logs startup failure described above, for a different
reason: while `lhpaul/ronda` was private during development, `gh api
repos/lhpaul/ronda/actions/permissions/access` returned
`{"access_level":"none"}`, meaning no other repository could call its
reusable workflow at all.

Configure this under **Settings → Actions → General → Access** on the
repository that hosts the reusable workflow, and verify with:

```bash
gh api repos/<owner>/<reusable-workflow-repo>/actions/permissions/access
```

An `"access_level"` of `"none"` means no other repository can call the
reusable workflow yet.

The reusable Action path uses only `pull_request`, never
`pull_request_target`. Fork pull requests therefore receive GitHub's normal
read-only `GITHUB_TOKEN` on the automatic Action path, so a fork-originated PR
will not receive an automatic Action review in v0 — see **Known limitations**
below. The local GitHub App webhook path publishes with the base repository's
installation token instead.

### Optional inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `model_base_url` | Ronda's built-in DashScope endpoint | Point at a different OpenAI-compatible vendor |
| `model_name` | `qwen-plus` | Model name to request |
| `pass_timeout_minutes` | `10` | In-process pass budget; the job's own `timeout-minutes` is this value plus two |
| `ronda_ref` | `main` | Ref of `lhpaul/ronda` to check out and run |

## 2. Add the required secret

Add a repository or organization secret named `RONDA_MODEL_API_KEY`
containing your model vendor's API key. Ronda never writes this value to a
file inside your repository, and never logs it — see the redaction rule in
`src/core/logger.ts` in this repository.

## 3. The review command

Post this exact phrase as a pull-request comment to request another pass on
the current head commit, even if it already has one:

```text
/ronda review
```

The match is case-insensitive and ignores surrounding whitespace and quoted
reply lines, but the phrase must be the first meaningful line of the
comment. Draft pull requests ignore the command entirely, same as the
automatic path.

## 4. Consumption contract

A consuming workflow — the ADF reviewer-loop, a Helm workflow, or your own
CI — can wait on Ronda's check run instead of parsing the review body:

- **Check-run name**: `Ronda review` (constant, never localized or renamed).
- **One per head SHA**: automatic and manual passes on the same commit
  update the same check run in place rather than creating a second one. During
  webhook migration, App-backed webhook runs first reuse any existing
  same-name `Ronda review` check on the head SHA, including one created by the
  reusable Action path, before falling back to an App-owned lookup.
- **Conclusion**: `success` (the pass worked, with or without findings) or
  `failure` (the pass could not complete; the check run's title and summary
  name the reason — timed out, model unavailable, credential missing or
  invalid, changes too large, unusable model output, or an unexpected
  error).
- **Absent while in flight**: the check run does not exist in an
  `in_progress` state. It is created only once, at pass-terminal time. A
  waiting consumer should treat "no check run yet" as "not finished yet",
  not as a stalled pass — poll rather than assume presence means pending.
- **Draft and superseded passes publish nothing**: no check run and no
  review for a draft pull request, and none for a head SHA that was
  superseded by a newer push before publication finished.

Example poll:

```bash
gh api repos/OWNER/REPO/commits/SHA/check-runs \
  --jq '.check_runs[] | select(.name == "Ronda review") | {status, conclusion}'
```

## 5. How ADF and Helm attach

Naming Ronda is a configuration change in the **consuming** project, not a
change to Ronda itself:

- **ADF** (`ai-dev-framework-template`): add a platform entry for Ronda in
  `pr-review-loop.sh` / `.ai-dev-workflow.yaml` (`review.on_draft.github` or
  `review.on_ready.github`), the same way other external GitHub reviewers
  (CodeRabbit, Bugbot, Devin) are named. `pr-review-loop.sh` waits on the
  `Ronda review` check run exactly as it waits on any other named platform.
- **Helm**: set `review.external.provider` to Ronda.

Neither project copies the review loop into this repository, and this
repository does not implement either project's fix cycle — Ronda only
posts the review and the check run.

## 6. Local operator config (for running the CLI outside Actions)

`ronda.config.example.json` in this repository is a committed, non-secret
template for the operator config file. Copy it to
`~/.config/ronda/config.json` (or point `RONDA_CONFIG_FILE` at another
path) and fill in `modelApiKey` there when you want to run `npm run review`
from your own machine instead of through the reusable workflow. That real
file is never committed — see `.gitignore`. Environment variables
(`RONDA_MODEL_API_KEY`, `RONDA_MODEL_BASE_URL`, `RONDA_MODEL_NAME`,
`RONDA_PASS_TIMEOUT_MS`, `RONDA_MAX_PATCH_CHARS`) take precedence over the
config file, which takes precedence over Ronda's built-in defaults.

## Known limitations (v0)

- **Fork pull requests on the reusable Action path** are not reviewed
  automatically. `pull_request` (not `pull_request_target`) gives
  fork-originated pull requests a read-only token, so the automatic Action path
  cannot publish for them. The local GitHub App webhook path is the supported
  fork-friendly ingress in v0.
- **Local webhook availability is operator-owned.** When using the local
  webhook path, GitHub delivery depends on the tunnel or machine being online.
  The reusable Action path remains available during migration.
- **No carried state between passes.** Each pass reads the pull request
  fresh; there is no deduplication against an earlier review's findings.
- **One dogfood repository.** v0 adopts `lhpaul/ai-dev-framework-template`
  only; installing Ronda across many repositories is out of scope.
