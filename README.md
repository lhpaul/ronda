# Ronda

GitHub PR review bot: comment-only, one pass per SHA, cheap API models first,
local model later. ADF and Helm consume it; they do not implement it.

**Contract:** [`docs/constitution.md`](docs/constitution.md)

GitHub calls **one webhook URL**. Point that URL at the MacBook while
testing, later at the Mini or MiniPC. Same App.

## Status

v0 ships as a reusable GitHub Actions workflow: it reads a pull request over
the REST API, asks a configured model for findings, and publishes one
comment-only review plus one check run per head commit. A local webhook
entrypoint is also available for dogfooding the same review contract from a
MacBook, Mini, or MiniPC without spending caller GitHub Actions minutes. See
[`docs/adoption/ronda-local-webhook.md`](docs/adoption/ronda-local-webhook.md).

**Adopting Ronda in another repository**: see
[`docs/adoption/ronda-review-adoption.md`](docs/adoption/ronda-review-adoption.md).

## Development

ADF `single_repo`. Default branch `develop`. Tracker: GitHub Project #11,
classification field **Work type**.

```text
/run-item <ISSUE>
```

Run the recall benchmark with deterministic fixtures:

```bash
npm run benchmark:recall -- --response-file tests/fixtures/recall-benchmark/model-responses/passing.json
```

Run the durability / idempotency regression fixtures (forces mode `active`):

```bash
npm run benchmark:durability
```

Run the broader quality benchmark, including precision and second-reviewer
comparison fixtures:

```bash
npm run benchmark:quality -- \
  --response-file tests/fixtures/recall-benchmark/model-responses/passing.json \
  --precision-response-file tests/fixtures/recall-benchmark/model-responses/precision-clean.json \
  --comparison-file tests/fixtures/recall-benchmark/comparisons/clean-agreement.json
```

Omit `--response-file` to run against the configured real model. Real-model
benchmark evidence requires `RONDA_MODEL_API_KEY` or the local operator config.
Second-reviewer evidence requires a same-head review from the comparison
platform and human adjudication before external-only findings count as Ronda
misses.

Roll up committed comparison and miss JSON into outcome buckets, filters, and
improvement candidates:

```bash
npm run quality:report
npm run quality:report -- --repository lhpaul/ronda --format both --out /tmp/ronda-quality-report.json
```

`quality:summary` remains a legacy comparison rollup (now also includes miss
counts when `docs/testing/ronda/misses/` has records); prefer
`quality:report` for spec-complete reporting.

### Capture external-review misses

Turn an external reviewer's finding that Ronda stayed quiet about into a
durable, privacy-bounded eval record under `docs/testing/ronda/misses/`.
Capture is **read-only toward GitHub** — it never posts comments, reviews,
labels, or state changes.

```bash
# Automatic Codex GitHub capture (category required)
npm run quality:misses -- capture --pr <n> --reviewer codex --category timeouts

# Manual entry when automatic reading cannot return the finding
npm run quality:misses -- capture-manual --pr <n> --reviewer <name> \
  --location 'src/file.ts:12' --text 'Finding text' --category correctness

# Read, adjudicate, or guarded-delete records
npm run quality:misses -- read
npm run quality:misses -- adjudicate --id <id> --verdict true_positive \
  --verdict-provenance human --follow-up eval_record --rationale 'Confirmed miss'
npm run quality:misses -- delete --id <id>

npm run quality:misses -- help
```

Operator smoke runbook:
[`docs/testing/ronda/capture-external-review-misses.smoke-test.md`](docs/testing/ronda/capture-external-review-misses.smoke-test.md).
Adjudication and deletion rules are enforced by `quality:misses` only;
committed JSON under `docs/testing/ronda/misses/` can still be edited outside
the tooling.

### Miss verdict provenance

Every newly submitted terminal miss verdict requires `--verdict-provenance`
with `human` (individual human review) or
`assistant_drafted_owner_accepted` (assistant draft accepted in batch by the
owner). This option applies to capture, capture-manual and adjudicate, including
all terminal judgments in a multi-finding capture. Missing or invalid selections
refuse the affected write. A legacy record lacking the property is interpreted
as human; loading it does not rewrite the file. Explicit malformed values are
errors, including on stale or unadjudicated evidence.

Reports and summaries keep human-confirmed figures separate from accepted
assistant drafts. Draft recommendations identify their provenance and record
IDs; draft evidence cannot satisfy human-required evidence-tier conditions.
Summary JSON uses `acceptedAssistantDrafts.acceptedDraftMisses` for draft
true positives. Existing outer counters remain human-only; global stale and
unresolvable diagnostics include both groups.

To individually confirm a terminal draft, adjudicate with
`--verdict-provenance human` and a rationale; the existing verdict and follow-up
remain. Follow-up-only adjudication and recapture without a terminal judgment
preserve provenance. Commit accepted-draft evidence before individual promotion,
then commit the confirmation separately: ordinary git history preserves the
prior verdict and provenance. An uncommitted sequence is not durable audit.
