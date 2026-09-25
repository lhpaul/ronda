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
jobs:
  ronda:
    # Do NOT add `name: Ronda review` (or rename this job id to it). See
    # "The caller job must not be named `Ronda review`".
    permissions:
      contents: read
      pull-requests: write
      checks: write
    # Cheap caller-side pre-filter. Not load-bearing for correctness: Ronda
    # re-checks the draft state, the exact comment text and the author
    # association itself, so this only saves CI minutes and keeps the secret
    # away from runs that cannot be a review request. Keep it no stricter than
    # Ronda: an expression cannot find the first unquoted line, so use
    # `contains`, not `startsWith`.
    if: |
      (github.event_name == 'pull_request' && github.event.pull_request.draft != true) ||
      (github.event_name == 'issue_comment' &&
       github.event.issue.pull_request != null &&
       contains(github.event.comment.body, '/ronda review') &&
       contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), github.event.comment.author_association))
    # Job-level, not workflow-level. See "Why the concurrency group is job-level".
    concurrency:
      group: >-
        ${{ github.event_name == 'pull_request'
        && format('ronda-review-{0}', github.event.pull_request.number)
        || format('ronda-review-{0}', github.event.issue.number) }}
      # Only a push, which introduces a new head SHA, may cancel an in-flight pass.
      cancel-in-progress: ${{ github.event_name == 'pull_request' && github.event.action == 'synchronize' }}
    uses: lhpaul/ronda/.github/workflows/ronda-review.yml@main
    secrets:
      model_api_key: ${{ secrets.RONDA_MODEL_API_KEY }}
```

### Why the concurrency group is job-level

Put `concurrency` on the job, not on the workflow. GitHub evaluates a
workflow-level `concurrency` group for the whole run **before** any job `if:`,
so every pull-request comment enters the group. That makes two hazards, and
neither is fixed by the `cancel-in-progress` setting:

- With `cancel-in-progress: true`, an unrelated comment cancels an in-flight
  pass, then the job `if:` skips the comment run: no check run is published for
  that head SHA.
- With `cancel-in-progress: false`, the comment run queues instead and replaces
  any run already pending in the group — "any existing `pending` job or workflow
  in the same concurrency group will be canceled and the new queued job or
  workflow will take its place" — so it can displace a queued `reopened` or
  `ready_for_review` pass, and then skip. That pass is lost too.

A job-level `concurrency` group is acquired only **after** the job's `if:`
passes, so a comment the `if:` rejects never enters a group at all and cannot
cancel or displace anything.

One group per pull request:

- **`pull_request` passes** share the PR's group, and only a `synchronize` push,
  which brings a new head SHA, cancels.
- **A comment the job runs** — on a PR, containing the command, from an
  `OWNER`, `MEMBER` or `COLLABORATOR` — joins the same group and never
  cancels. It waits behind an in-flight pass, so a manual and an automatic pass
  never run together on one head SHA: two passes that run together can both
  find no check run and publish one each, and section 4 promises one per head
  SHA.

The `cancel-in-progress` expression is deliberately narrow: only a push may
cancel. `reopened` and `ready_for_review` keep the same head SHA, and a run
cancelled after the review is published but before the terminal check run is
created would let its replacement publish a second review for that SHA — the
Actions path has no review-level dedup, only the check-run lookup. Those events
queue behind the running pass instead and then skip on its check run.

#### The pre-filter is wider than Ronda's parser, deliberately

The job `if:` above tests `contains(comment.body, '/ronda review')` — the whole
body, not the first meaningful line. It therefore admits a comment that only
mentions the phrase, such as `/ronda review later`, which Ronda itself rejects
(`matchesReviewCommand`, in `src/cli/resolve-trigger.ts`) and runs no pass for.
Such a comment joins the PR's group and — since a newly queued run replaces an
existing `pending` one — can displace a queued run of **either** arm before it
exits and Ronda rejects the comment. If the displaced run was a `synchronize`
pass queued for a new head SHA, that head has no published review until a later
comment or push; if it was a manual re-request, the request is lost and one more
comment restores it. An in-flight pass is never affected: the comment arm does
not cancel in progress.

This cannot be closed, and the wider predicate is the safer side of it:

- **No expression can match Ronda's rule.** GitHub expressions have no regex and
  cannot select the first non-quoted line, so no predicate accepts exactly the
  forms Ronda accepts. An exact test (`body == '/ronda review'`) or a prefix
  test (`startsWith`) drops accepted forms: a command after leading whitespace is
  valid to Ronda and would then join no group, so a manual and an automatic pass
  could run at once and publish two check runs for one head SHA.
- **The `queue` property does not help.** `queue: max` stops a queued run from
  replacing a pending one, which is exactly the displacement above, but it cannot
  be combined with `cancel-in-progress: true` — the combination is a workflow
  validation error — and the pinned actionlint in this repository's
  `.github/workflows/actionlint.yml` rejects `queue` as an unexpected key.

A displaced run costs one more comment or push — recoverable, and the displaced
form is the one Ronda would have rejected anyway. Two check runs for one head SHA
break the contract in section 4 and no later pass repairs them. Keep the
pre-filter no stricter than Ronda.

### The caller job must not be named `Ronda review`

`Ronda review` is the constant name of the check run Ronda publishes (see
section 4). An automatic pass looks up existing check runs on the head SHA **by
name only** and skips itself as `already_reviewed_automatically` when it finds
one. A caller job named `Ronda review` produces a check run with that exact
name, including the `skipped` one GitHub records when the job `if:` is false (a
draft pull request), so the pass finds its own caller and skips itself while the
run stays green and nothing is posted. Observed live on `lhpaul/ronda` run
36037017660.

Leave the job unnamed under an id such as `ronda`, as above, or give it any
other name. The workflow's own `name:` is unaffected: it is not a check run.

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
| `durability_mode` | _(empty)_ | Force durability mode `on` or `off` for the run; leave empty for automatic path rules |
| `durability_mode_default` | _(empty)_ | Set to `on` to activate durability mode for every implementation-stage review |
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
comment. Manual review comments are accepted only from GitHub users whose
comment `author_association` is `OWNER`, `MEMBER`, or `COLLABORATOR`;
other users are ignored. Draft pull requests ignore the command entirely,
same as the automatic path.

## 4. Consumption contract

A consuming workflow — the ADF reviewer-loop, a Helm workflow, or your own
CI — can wait on Ronda's check run instead of parsing the review body:

- **Check-run name**: `Ronda review` (constant, never localized or renamed).
- **One per head SHA**: automatic and manual passes on the same commit
  update the same check run in place rather than creating a second one when
  they are using the same publishing identity. During webhook migration,
  automatic webhook deliveries suppress duplicate work when any same-name
  `Ronda review` check already exists on the head SHA. Manual webhook reruns
  update only a check run owned by the configured Ronda GitHub App; if the only
  existing check is Action-owned, GitHub requires the webhook path to create an
  App-owned check run it can update.
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
`RONDA_PASS_TIMEOUT_MS`, `RONDA_MAX_PATCH_CHARS`,
`RONDA_MAX_AUTHORITATIVE_DOC_COUNT`, `RONDA_MAX_AUTHORITATIVE_DOC_CHARS`,
`RONDA_DURABILITY_MODE`, `RONDA_DURABILITY_MODE_DEFAULT`) take
precedence over the config file, which takes precedence over Ronda's built-in
defaults.

`RONDA_DURABILITY_MODE=on|off` forces the durability and idempotency review
mode for a run (or set `durabilityMode` in the config file).
`RONDA_DURABILITY_MODE_DEFAULT=on` (or `durabilityModeDefault: true`) enables
the mode for every implementation-stage review even when automatic path rules
do not match. When unset, activation follows changed-path rules for webhook,
publisher, queue/retry, and related surfaces. Mode state (`active` /
`inactive` / `unavailable`) appears in the published review summary.

When a pull request touches governed surfaces (webhook ingress, review
publication, inference, operator config, or workflow review contract paths),
Ronda may attach a bounded set of authoritative repository documents fetched
at the reviewed head SHA. Selection is deterministic from changed paths and
the in-repo catalog — not keyword overlap alone. Each included excerpt is
labeled **binding** (product/review constraints) or **advisory** (operating
context). `maxAuthoritativeDocCount` (default `4`) and
`maxAuthoritativeDocChars` (default `120000`) cap doc attachments
independently of the diff (`maxPatchChars`) budget. Missing or unreadable
catalog files are skipped with structured log events; the pass still completes.

## 7. Review quality reporting (operator checkout)

After comparison JSON is committed under `docs/testing/ronda/comparisons/` (and
miss JSON under `docs/testing/ronda/misses/` when capture is available), generate
a structured rollup without calling GitHub:

```bash
npm run quality:report
npm run quality:report -- --repository lhpaul/ronda --format both --out /tmp/ronda-quality-report.json
```

Commit the JSON or markdown snapshot when you want a trend baseline for
retrospectives. `quality:summary` remains a legacy comparison-only rollup.

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
