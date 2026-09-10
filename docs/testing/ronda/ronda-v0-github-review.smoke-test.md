# Smoke Test Runbook: Ronda v0 — GitHub Review Bot

**Feature**: Ronda v0 comment-only GitHub review
**Spec**: [`../../specs/developments/20260905120949_ronda-v0-github-review/1_ronda-v0-github-review_specs.md`](../../specs/developments/20260905120949_ronda-v0-github-review/1_ronda-v0-github-review_specs.md)
**Implementation plan**: [`../../specs/developments/20260905120949_ronda-v0-github-review/2_ronda-v0-github-review_implementation-plan.md`](../../specs/developments/20260905120949_ronda-v0-github-review/2_ronda-v0-github-review_implementation-plan.md)
**Created in**: Plan Ready stage
**Updated in**: In Development stage

> **No design assets.** Issue #2 has no `## Design assets` section, the
> development folder has no `assets/` directory, and Ronda has no user
> interface. There is deliberately no expected-versus-actual fidelity step in
> this runbook.

---

## Prerequisites

Before running this smoke test:

- [ ] The implementation branch is checked out and `npm ci` has been run at the
      repository root.
- [ ] `npm test` passes locally.
- [ ] A model API credential is exported as `RONDA_MODEL_API_KEY` in the shell
      used for the local steps. It is never written to a file inside the
      repository.
- [ ] A GitHub token with `pull-requests: write` and `contents: read` on
      `lhpaul/ronda` is exported as `GITHUB_TOKEN` for the local steps. A
      classic or fine-grained personal access token (PAT) works for this —
      see the App-token requirement below for what it cannot do.
- [ ] **App-token requirement for check runs (read before running steps 6,
      7, and 9)**: `POST /repos/{owner}/{repo}/check-runs` requires a GitHub
      App installation token. A personal access token — regardless of its
      `checks:` scope — is rejected with exactly `403 You must authenticate
      via a GitHub App`. Locally, with `GITHUB_TOKEN` set to a PAT, `npm run
      review` publishes its review successfully and then fails to publish
      the check run with that 403. This is the expected, documented outcome
      of the local path, not a defect: steps 6, 7, and 9 assert on Ronda's
      structured log output instead of the check run for this reason. The
      check run itself is published only through the Actions path (steps 1,
      4, and 5), which runs with the reusable workflow's own
      Actions-issued `GITHUB_TOKEN`, not a PAT.
- [ ] The same model credential is stored as the repository secret
      `RONDA_MODEL_API_KEY` on `lhpaul/ai-dev-framework-template` for the
      dogfood steps.
- [ ] `gh` is authenticated for both repositories.
- [ ] The dogfood caller workflow committed on
      `lhpaul/ai-dev-framework-template` for this run points at the
      **implementation branch under test**, not the documented `main` default:
      both `uses: lhpaul/ronda/.github/workflows/ronda-review.yml@<implementation-branch>`
      and the `ronda_ref: <implementation-branch>` input must be overridden.
      `lhpaul/ronda`'s `main` branch is still the unmodified template bootstrap
      at this point in the workflow (this feature has not been released yet),
      so it has neither `ronda-review.yml` nor any `src/` to check out; using
      the documented `@main` / default `ronda_ref` here would fail to resolve
      the workflow rather than exercise it. Revert both to `main` once the
      feature has actually been released.

Two environments are used:

- **Local**: `npm run review` invoked from a shell, driving a sandbox pull
  request on `lhpaul/ronda`. Used for the zero-findings, credential, timeout,
  alternate-vendor, and supersede cases; several of these are impractical to
  stage inside a hosted runner, and all of them run against a personal
  access token, which can publish a review but cannot create a check run
  (see the App-token requirement in Prerequisites).
- **Actions**: the reusable workflow called from
  `lhpaul/ai-dev-framework-template`. Used for the trigger, dogfood, and
  consumption cases.

---

## Test Data

| Item | Value |
| --- | --- |
| Sandbox repository | `lhpaul/ronda` |
| Sandbox branch | `smoke/ronda-v0` — contains at least three changed files with a deliberate defect on a changed line |
| Dogfood repository | `lhpaul/ai-dev-framework-template` |
| Dogfood branch | `smoke/ronda-dogfood` — one changed file with a deliberate defect on a changed line |
| Review command | `/ronda review` |
| Check-run name | `Ronda review` |
| Model secret name | `RONDA_MODEL_API_KEY` |
| Mock model server | `tests/support/mock-model-server.ts` |

---

## Smoke Test Steps

### Step 1: Ready pull request produces one review and one check run

**Maps to**: Acceptance criteria 1 and 4

1. On `lhpaul/ai-dev-framework-template`, push `smoke/ronda-dogfood` and open a
   pull request as a **draft**.
2. Confirm the caller workflow file from `docs/adoption/ronda-review-adoption.md`
   is committed on that repository's default branch, with the `uses:` ref and
   `ronda_ref` input overridden per the Prerequisites section above.
3. Mark the pull request ready for review.
4. Wait for the `Ronda review` workflow run to finish.
5. Record the head SHA:
   `gh pr view <pr> --repo lhpaul/ai-dev-framework-template --json headRefOid`.
6. List reviews: `gh api repos/lhpaul/ai-dev-framework-template/pulls/<pr>/reviews`.
7. List check runs:
   `gh api repos/lhpaul/ai-dev-framework-template/commits/<sha>/check-runs`.

**Expected result**: Exactly one Ronda review and exactly one check run named
`Ronda review` exist for that head SHA. Every finding the run produced is inside
that single review — there is no second review. The branch has no new commit
authored by the run.

### Step 2: Findings placement and counts

**Maps to**: Acceptance criteria 5 and 6

1. Open the review from step 1.
2. For each finding attached inline, confirm the file and line it sits on appear
   in the pull request's Files changed tab.
3. Read the review summary's severity table and its list of findings not
   attached to a changed line.

**Expected result**: Every inline comment sits on a line the pull request
changed. Every finding that could not be attached to a changed line appears in
the summary list. The summary's total equals the number of inline comments plus
the number of summary-listed findings. Each finding is labelled `Blocking`,
`Important`, or `Nit`, and the summary's per-label counts match the labels
actually shown.

### Step 3: Draft pull request is ignored

**Maps to**: Acceptance criteria 3 and 11

1. Open a new **draft** pull request on `lhpaul/ai-dev-framework-template`.
2. Push one more commit to that draft branch.
3. Post the comment `/ronda review` on the draft pull request.
4. Wait two minutes, then list reviews and check runs for the draft's head SHA
   with the same commands as step 1.

**Expected result**: No Ronda review and no `Ronda review` check run exist for
any head SHA of the draft pull request, for any of the three actions above.

### Step 4: New commit produces a new pass

**Maps to**: Acceptance criterion 2

1. Return to the ready pull request from step 1.
2. Push one additional commit to `smoke/ronda-dogfood`.
3. Wait for the new workflow run to finish.
4. List reviews for the pull request and check runs for both the old and the new
   head SHA.

**Expected result**: A new review and a new `Ronda review` check run exist for
the new head SHA. The review from step 1 is still present and unedited. The old
head SHA still has its original check run.

### Step 5: Manual re-trigger on an already-reviewed commit

**Maps to**: Acceptance criterion 10

1. Record the check run `id` for the head SHA from step 1's check-run list.
2. Without pushing anything, post the comment `/ronda review` on the ready pull
   request.
3. Wait for the workflow run to finish.
4. List reviews and read the newest one.
5. List check runs for the head SHA again and compare the `id` to the one
   recorded in step 1.

**Expected result**: A newer Ronda review exists for the same head SHA, and its
summary states that the pass was manually requested. Exactly one `Ronda review`
check run still exists for that head SHA, its `id` is unchanged from step 1, and
its status/conclusion reflect the newest pass — the manual re-trigger updates
the existing check run rather than adding a second one.

### Step 6: Zero findings

**Maps to**: Acceptance criterion 7

1. Create a pull request on `lhpaul/ronda` whose only change is a trivial
   comment or whitespace edit in one file.
2. Locally, run `npm run review` against that pull request.
3. Read the published review: `gh api repos/lhpaul/ronda/pulls/<pr>/reviews`.

**Expected result**: A review is published that says no findings were
produced. This is locally verifiable from the review body. **Not locally
verifiable**: the check run reporting `Review posted` — a personal access
token cannot create a check run (see the App-token requirement in
Prerequisites). The `Review posted` check-run outcome for a clean pass is
confirmed live by steps 1, 4, and 5, which run through the Actions path.

### Step 7: Missing credential

**Maps to**: Acceptance criterion 8

1. Locally, against the sandbox pull request on `lhpaul/ronda`, run
   `npm run review` with `RONDA_MODEL_API_KEY` unset (and with no
   `~/.config/ronda/config.json` supplying it).
2. Read the structured log line the process emits.

**Expected result**: The process emits a `pass_failed` event naming the
missing-credential reason in plain language, not a generic error. The real
log line also carries a `timestamp` field (`src/core/logger.ts` adds one to
every event); the JSON below shows only the fields this runbook checks:

```json
{"event":"pass_failed","reason":"credential_missing","message":"RONDA_MODEL_API_KEY (or the operator config file's modelApiKey) is not set"}
```

No inline findings were published by that pass. Repeat with a deliberately
wrong key and confirm a `credential_invalid` event instead:

```json
{"event":"pass_failed","reason":"credential_invalid","message":"ModelClientError: Model API rejected the credential (HTTP 401)"}
```

**Not locally verifiable**: the corresponding `Review failed` check run for
either case — a personal access token cannot create a check run (see the
App-token requirement in Prerequisites). Confirming the published check run
for a credential failure requires the Actions path, which this runbook does
not stage separately for this failure mode.

### Step 8: Alternate model vendor, same review shape

**Maps to**: Acceptance criterion 12

1. Start the mock model server: it serves an OpenAI-compatible
   `/chat/completions` endpoint on `127.0.0.1` and reports a distinct model name.
2. Run `npm run review` against the sandbox pull request with
   `RONDA_MODEL_BASE_URL` pointing at the mock server and `RONDA_MODEL_NAME` set
   to the mock model's name, changing no code.
3. Compare the resulting review with the one from step 1.

**Expected result**: The summary has the same structure, the same severity
labels, and the same check-run outcome vocabulary as step 1, and it names the
different model. If a second real vendor account is available, repeat with that
vendor's base URL and model name and confirm the same outcome.

### Step 9: Pass exceeds its time budget

**Maps to**: Acceptance criterion 9

Two independent phases can exceed the pass deadline and are both classified
as `timed_out`: a slow model response (model phase), and a slow or aborted
GitHub API call (GitHub phase, added by #11). Exercise both.

#### 9a. Model-phase timeout

1. Configure the mock model server to delay its response well beyond the budget.
2. Run `npm run review` against the sandbox pull request with
   `RONDA_PASS_TIMEOUT_MS` set to a short value such as `5000`.
3. Read the structured log line the process emits.

**Expected result**:

```json
{"event":"pass_failed","reason":"timed_out","message":"ModelClientError: Model request was aborted before it completed"}
```

#### 9b. GitHub-phase timeout

1. Run `npm run review` against the sandbox pull request with
   `RONDA_PASS_TIMEOUT_MS` set low enough (for example, `1`) that the pass
   deadline is already expired before or during the very first GitHub API
   call (`readPullRequest`), before any model call happens.
2. Read the structured log line the process emits.

**Expected result**:

```json
{"event":"pass_failed","reason":"timed_out","message":"GithubClientError: GitHub request was aborted before it completed"}
```

This path is classified once, in `withAbortMapping` in
`src/github/github-client.ts`, and is unit-tested in
`tests/unit/github/pull-request-reader.test.ts`. Before #11 merged, a
GitHub-phase abort was not classified as `timed_out` and could crash the
process instead — confirm the current behaviour matches the JSON above, not
that older behaviour.

**Both cases**: the pass never ends silently pending — a `pass_failed` event
is always emitted before the process exits. **Not locally verifiable**: the
corresponding `Review failed` check run for either phase — a personal access
token cannot create a check run (see the App-token requirement in
Prerequisites); confirm the check-run outcome via the Actions path instead.
Confirm separately that `tests/unit/config/load-config.test.ts` asserts the
default budget is ten minutes, since this runbook exercises the mechanism
rather than waiting ten real minutes.

### Step 10: Superseded head SHA publishes nothing

**Maps to**: Acceptance criterion 16

1. Configure the mock model server to delay its response by roughly sixty
   seconds.
2. Start `npm run review` against the sandbox pull request and note the head SHA
   it reports in its first log line.
3. While that pass is still running, push a new commit to the sandbox branch.
4. Let the pass finish, then read its structured log line, and list reviews
   and check runs for the old head SHA.
5. Run `npm run review` again against the sandbox pull request — now pointing
   at the new head SHA — and read the published review.

**Expected result**: The first pass logs a `pass_skipped` event with
`"reason":"superseded_head_sha"` and publishes no review and no check run for
the old head SHA. This negative result is verifiable locally with a personal
access token, because it asserts the *absence* of a publication rather than
the presence of a check run. The second invocation (step 5) publishes its own
fresh review for the new head SHA. **Not locally verifiable**: whether that
second pass's check run is created — a personal access token cannot create a
check run (see the App-token requirement in Prerequisites). Confirm the full
supersede-then-fresh-pass sequence, including the new head SHA's check run,
via the Actions path (steps 1 and 4) instead, where pushing a commit to an
already-reviewed pull request already exercises exactly this: the old head
SHA keeps its review and check run, and the new head SHA gets its own.

### Step 11: A consuming project can wait on the check run

**Maps to**: Acceptance criterion 14

1. Read the consumption contract section of `docs/adoption/ronda-review-adoption.md`.
2. Against the ready pull request from step 4, poll
   `gh api repos/lhpaul/ai-dev-framework-template/commits/<sha>/check-runs --jq '.check_runs[] | select(.name == "Ronda review") | {status, conclusion}'`
   until it returns a result.

**Expected result**: The poll reaches a definite outcome — `completed` with
either `success` or `failure` — for the current head SHA, using nothing but the
documented check-run name. Confirm that the documented behaviour of an absent
check run while a pass is in flight matches what the poll showed before the run
finished.

### Step 12: No operator-specific values in the repository

**Maps to**: Acceptance criterion 15

1. From the repository root, run the two commands in the Residual Verification
   Strategy section of the implementation plan.
2. Read both outputs.

**Expected result**: The first command produces no hits, or only obvious
documentation placeholders. Every hit from the second command references
`RONDA_MODEL_API_KEY` by name only — no value, no account identifier, no
hostname belonging to a specific operator, and no personal filesystem path.

### Step 13: Dogfood run is complete

**Maps to**: Acceptance criterion 13

1. Re-read the pull request from step 4 on `lhpaul/ai-dev-framework-template`.
2. Confirm the review has a summary, at least one inline finding on a changed
   line, and a check run reporting `Review posted`.
3. Run `git log` on the pull request branch and confirm no commit was authored by
   the workflow run.

**Expected result**: A real pull request on the dogfood repository carries a
complete Ronda review, and Ronda pushed nothing to its branch.

### Last Step: Validate and clean up

- Verify every assertion in the checklist below is met.
- Stop the mock model server.
- Close the smoke pull requests and delete the smoke branches on both
  repositories.
- Unset `RONDA_MODEL_API_KEY` and `GITHUB_TOKEN` from the shell.

---

## Assertions Checklist

- [ ] Marking a non-draft pull request ready in an adopting repository produces
      one Ronda review and one check run on that head SHA, and pushes no commit
      (step 1, step 13).
- [ ] Pushing a new commit produces a new review and a new check run for the new
      head SHA, leaving the earlier review in place (step 4).
- [ ] Opening or updating a draft pull request produces no review and no check
      run (step 3).
- [ ] A pass with several findings publishes all of them in one review
      (step 1, step 2).
- [ ] Findings on changed lines are inline, findings that do not map are in the
      summary, and the summary total matches what was published (step 2).
- [ ] Every finding shows `Blocking`, `Important`, or `Nit`, and the summary
      reports counts per label (step 2).
- [ ] A pass with no findings publishes a review saying so (step 6); the
      corresponding `Review posted` check run is confirmed via the Actions
      path (steps 1, 4, 5).
- [ ] A missing or invalid credential emits a `pass_failed` event naming that
      specific reason, with no inline findings; the corresponding
      `Review failed` check run requires the Actions path (step 7).
- [ ] A pass that exceeds its budget — in the model phase or the GitHub
      phase — emits a `pass_failed` event naming the timeout reason, never
      pending with no explanation; the corresponding `Review failed` check
      run is confirmed via the Actions path (step 9).
- [ ] `/ronda review` on a ready pull request whose head SHA already has a
      review produces a newer review whose summary says the pass was manually
      requested, and updates the existing `Ronda review` check run in place
      rather than creating a second one (step 5).
- [ ] `/ronda review` on a draft pull request produces no review and no check
      run (step 3).
- [ ] Pointing Ronda at a different model produces the same review shape with the
      different model named (step 8).
- [ ] A pull request on `lhpaul/ai-dev-framework-template` receives a summary, at
      least one inline finding, and a `Review posted` check run, with no commit
      pushed by Ronda (step 13).
- [ ] A consuming project can wait on the check run for the current head SHA and
      reach a definite outcome (step 11).
- [ ] Searching the repository finds no operator-specific credential value,
      credential name, account identifier, hostname, or filesystem path
      (step 12).
- [ ] A pass whose head SHA is superseded publishes no review and no check run
      for the superseded commit (step 10).

---

## Seed Data Reference

No database is involved. The data this runbook needs is created by hand:

| Entity | Scenario | How to load |
| --- | --- | --- |
| Sandbox pull request | Three changed files, one deliberate defect on a changed line | Push `smoke/ronda-v0` to `lhpaul/ronda` and open a pull request |
| Dogfood pull request | One changed file with a deliberate defect on a changed line | Push `smoke/ronda-dogfood` to `lhpaul/ai-dev-framework-template` and open a pull request |
| Trivial-change pull request | One whitespace or comment edit, expected to yield no findings | Push a one-line branch to `lhpaul/ronda` |
| Mock model responses | Fenced JSON, delayed response, distinct model name | `tests/support/mock-model-server.ts` |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No workflow run starts at all | The caller workflow is not on the adopting repository's default branch, or its event or draft guard excluded the event | Compare the committed caller workflow with the snippet in `docs/adoption/ronda-review-adoption.md` |
| The run fails at startup with **zero jobs, no logs, and no annotations reachable from the REST API** — the real error is visible only in the Actions web UI, as `error parsing called workflow` or a permissions rejection | The caller job does not declare its own `permissions:` block. A called reusable workflow can only narrow the caller's `GITHUB_TOKEN`, never widen it, and GitHub's default for new repositories (`default_workflow_permissions: "read"`) makes the reusable workflow's request for `pull-requests: write` and `checks: write` unreachable | Add the `permissions:` block from the adoption snippet to the caller job; alternatively raise the repository-wide default under Settings → Actions → General, though the per-job block is preferred |
| The same zero-jobs, no-logs startup failure as above, even though the caller-side `permissions:` block is already correct | The repository hosting the reusable workflow is private and has not granted Actions access to the calling repository | Grant access under Settings → Actions → General → Access on the repository hosting the reusable workflow (see the adoption guide's prerequisite); confirm with `gh api repos/<owner>/<repo>/actions/permissions/access` |
| The check run appears but the review does not | The review call was rejected and the fallback also failed | Read the Actions run log for the response status; confirm the head SHA had not moved |
| Inline comments are missing but the same findings appear in the summary | The model returned lines outside the diff, or the fallback path was taken after a rejected payload | Expected behaviour, not a defect — confirm the summary total still matches |
| The pass fails with an invalid-credential reason on the Actions path | The repository secret is absent or was not passed through the `secrets:` block | Re-check the secret name and the caller workflow's `secrets:` mapping |
| A local `npm run review` run (steps 6, 7, 9) publishes its review but then fails with `403 You must authenticate via a GitHub App` | `POST /repos/{owner}/{repo}/check-runs` requires a GitHub App installation token; a personal access token is rejected regardless of its scopes | Expected for the local path — the review publishing is the assertion that matters locally; confirm the check-run outcome via the Actions path (steps 1, 4, 5) instead |
| A fork pull request produces nothing | Fork pull requests receive a read-only token in v0 | Known limitation, documented in the adoption guide; use a same-repository branch |

---

## Known Limitations

- Step 9 exercises the deadline mechanism with a shortened budget rather than
  waiting ten real minutes; the ten-minute default is asserted by a unit test.
- Steps 6 through 10 run the review core locally rather than through the
  reusable workflow, because staging a missing credential, a hung model, or a
  mid-pass push inside a hosted runner is not reliably reproducible. All of
  them run against a personal access token, which can publish a review but
  cannot create a check run (`POST .../check-runs` requires a GitHub App
  installation token — see the App-token requirement in Prerequisites).
  Steps 6, 7, and 9 therefore assert on Ronda's structured log output
  instead of the check run; the `Review posted` / `Review failed` check-run
  outcomes those events correspond to are covered live by steps 1, 4, and 5,
  which run through the Actions path with an App-issued token. Step 10
  asserts on the *absence* of a review or check run for the superseded head
  SHA, which a personal access token can verify like any other read; the
  new head SHA's check run is confirmed live by the same Actions steps.
- Fork pull requests are out of scope for v0 and are not exercised here.
