# Ronda

GitHub PR review bot: comment-only, one pass per SHA, cheap API models first,
local model later. ADF and Helm consume it; they do not implement it.

**Contract:** [`docs/constitution.md`](docs/constitution.md)

GitHub calls **one webhook URL**. Point that URL at the MacBook while
testing, later at the Mini or MiniPC. Same App.

## Status

v0 ships as a reusable GitHub Actions workflow: it reads a pull request over
the REST API, asks a configured model for findings, and publishes one
comment-only review plus one check run per head commit. No webhook, no App,
no push to the reviewed branch. See
[Project #11](https://github.com/users/lhpaul/projects/11) for what's next.

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
