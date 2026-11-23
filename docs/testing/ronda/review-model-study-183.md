# Review model comparison and recommendation (#183)

Question: should Ronda keep `qwen-plus` (pinned `qwen-plus-2025-12-01`) as the default review model, or move to another one? This study changes **no** default, prompt, config or code. The decision is the maintainer's.

## What was measured, and what was not

The only recorded corpus with a known answer key is the #143 spec/plan miss experiment: 8 committed heads, 29 recorded misses (`spec-plan-experiment-heads-143.md`), 3 runs per head. All three models below were run on the same heads, the same spec/plan prompt and the same inputs, so recall is comparable.

- `qwen-plus-2025-12-01` and `qwen3.8-max` (reported `qwen3.8-max-0902`): **reused** from `spec-plan-experiment-results-143.md` (arms B and C). No new spend.
- `qwen3.7-plus-2026-05-26`: **new run** for this item (24 passes, one retried after a timeout). Raw findings: `review-model-study-183-qwen3.7-plus.jsonl`; scoring: `review-model-study-183-qwen3.7-plus-scoring.json`.
- Not measured: the code-review campaigns (#105/#106 sweeps and repository-context recall files). They were not re-run on other models, so **code-review recall is unknown for every candidate except the default**. No model from another OpenAI-compatible provider was run: it would need a separate credential and an equal-prompt campaign, and the evidence above already shows the model-size lever is not the limiting factor. This is a gap, not a finding.

Scoring caveat: a single judge (a reviewer agent) read each finding against the document at its head; a match needs the same defect. The real/plausible/false split on unmatched findings is the softest part. The qwen3.7-plus run used the same convention as #143: no PR description was supplied, which inflates "clearly false" findings that ask for a PR-description log.

## Comparison

| | `qwen-plus-2025-12-01` (default) | `qwen3.7-plus-2026-05-26` | `qwen3.8-max` (`-0902`) |
| --- | --- | --- | --- |
| Run on | arm B (#143) | arm C-style, this item | arm C (#143) |
| Misses recovered, any run (of 29) | 3 (10%) | 2 (7%) | 15 (52%) |
| Clearly false per pass (mean / max) | 4.1 / 6 | 1.17 / 3 (0.21 / 2 excluding the PR-description artifact) | 3.8 / 10 (2.7 excluding it) |
| Findings per pass | 3-6 | 0-4 (mean 2.25) | 10-25 |
| Latency per pass | ~10 s | ~100-170 s | ~11 min |
| Estimated cost per review (see below) | ~USD 0.02 | ~USD 0.03-0.05 | ~USD 0.2 |
| List price (Singapore, per M tokens in/out) | 0.4 / 1.2 (non-thinking), 4 (thinking) | 0.4 / 1.6 | 2 / 6 |
| Pinnable dated snapshot | yes (`qwen-plus-2025-12-01`) | yes (`qwen3.7-plus-2026-05-26`, endpoint echoes it) | yes (`qwen3.8-max-0902`; the endpoint echoes the short form) |

Notes on the numbers:

- The production prompt (arm A) on `qwen-plus` recovered 0 of 29, with 0 findings in 24 of 24 passes. Those heads are mostly spec/plan documents, so this corpus says little about the code reviews Ronda mostly does.
- `qwen3.7-plus` only recovered `1317057ec63b` (run 1 on `a691d010`) and `25cd1570c897` (runs 1 and 2 on `90a694ea`). It never named 27 of 29. Its low false-finding count mostly reflects that it says little (0-4 findings), not higher precision.
- Pricing comes from the public Alibaba Cloud Model Studio pricing pages, Singapore tab. Only the `qwen3.7-plus` and Max rows were read verbatim; the `qwen-plus` row comes from a page summary. Check the live page before relying on these.
- **Cost is an estimate.** The harness records prompt and response size in characters, not token usage (`src/cli/spec-plan-experiment.ts`). The estimate uses a mean prompt of about 167k characters (~42k tokens at 4 chars/token) plus an assumed hidden reasoning output; the output side is the uncertain part for the two reasoning-capable models.
- Spend for this item: the new run was estimated at USD 1.2 before launch (cap: USD 5 total). Estimated total including the timed-out call and the retry: **at most about USD 1.6**, i.e. well under the cap. This is an estimate from list prices, not a billing figure; the provider console is the source of truth.

## Recommendation

1. **Keep `qwen-plus-2025-12-01` as the default review model.** The mid-tier alternative (`qwen3.7-plus`) shows no recall gain on this corpus (7% vs 10%) at a similar or slightly higher cost, so there is no evidence to justify a change.
2. **`qwen3.8-max` is the only candidate that moves recall** (52%, 3 to 15 recovered), but at about 10x the cost, ~11 minutes per pass and ~4 clearly false findings per pass. It does not suit a default for every PR. It is the right candidate for the opt-in stronger-model spec/plan mode tracked in #157, ideally with a precision filter or findings cap.
3. **Before any default change, close the measurement gap**: re-run the recorded code-review campaigns (the #105/#106 sweep files and repository-context recall files) against the candidate models, and add token usage to the replay harness so cost stops being an estimate. That needs maintainer authorization for further spend and is a separate item.
4. Pin the dated snapshot for any model used in recorded evidence (#121), as these runs did.

Default model, prompt and production code are unchanged by this item.
