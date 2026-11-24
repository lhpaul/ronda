# DeepSeek review model evaluation via DashScope (#191)

Question: does a DeepSeek model, served through Alibaba Cloud Model Studio (DashScope), get closer to `qwen3.8-max`'s recall on the #143 spec/plan corpus at a better cost, latency or precision than the current default? This study changes **no** default, prompt, config or code. The decision is the maintainer's.

## Scope and setup

- **Provider:** DashScope International (`dashscope-intl.aliyuncs.com`) only, with Ronda's existing credential and OpenAI-compatible client. The native DeepSeek API was **not** used. Only the model id changed between runs.
- **Candidates (fixed by the maintainer):** `deepseek-v4.1-flash-1017` and `deepseek-v4-pro-0813`. Both were listed by the endpoint's `/models` on 2026-11-24, and every successful response echoed the requested dated id. GLM was not run: it was outside the candidates fixed for this run.
- **Protocol:** the #143 / #183 protocol. Same 8 heads, same 29 recorded misses (`spec-plan-experiment-heads-143.md`), the spec/plan prompt (arm C of the committed harness), no PR description, the same judging convention, and the same thresholds: at least 30% recovered and at most 1 clearly false finding per pass.
- **Harness:** the committed core of `npm run quality:spec-plan-experiment` (`runExperiment` in `src/cli/spec-plan-experiment.ts`, arm C), called from a local wrapper that is deliberately not committed, so that no harness or production code changes. The wrapper differs from the CLI only in these ways:
  1. It passed the model id past the CLI's `-YYYY-MM-DD` suffix check. DashScope's dated DeepSeek snapshots end in `-MMDD`, the same form as the `qwen3.8-max-0902` that #143 recorded.
  2. It wrapped the model `fetch` to log each call's token usage (no headers and no body text), so cost is measured from tokens, not estimated from characters.
  3. It enforced the spend cap before every call.

  The no-write GitHub wrapper, the committed-manifest checks and the resume/retry rules are the committed ones. No GitHub write was attempted (count 0 on every run). Because the wrapper is not in the repository, the cap enforcement and the `-MMDD` bypass cannot be re-checked from the repo. The usage ledger is the committed record of every call.
- **Raw evidence:**
  - `review-model-study-191-deepseek-v4.1-flash.jsonl`: 42 calls.
  - `review-model-study-191-deepseek-v4-pro.jsonl`: 10 calls.
  - `review-model-study-191-usage.jsonl`: per-call tokens and spend, including a diagnostic probe and worst-case bookings.
- **Scoring:** `review-model-study-191-deepseek-v4.1-flash-scoring.json` and `review-model-study-191-deepseek-v4-pro-scoring.json`. Each has the match table, a verdict for every unmatched finding, and per-pass counts.

Scoring caveat (as in #183): one judge per group of heads (reviewer agents) read each finding against the document at its head, and a match needs the same defect. The real/plausible/false split on unmatched findings is the softest part. No PR description was supplied, so every pass carries about one "clearly false" finding that only asks for a PR-description log. Figures are shown with and without those findings.

## Comparison

`qwen-plus` and `qwen3.8-max` figures are reused from #143 (arms B and C), and `qwen3.7-plus` from #183. No new spend went into those columns.

| | `qwen-plus-2025-12-01` (default) | `qwen3.8-max` (`-0902`) | `deepseek-v4.1-flash-1017` | `deepseek-v4-pro-0813` |
| --- | --- | --- | --- | --- |
| Usable passes (of 24) | 24 | 24 | **22** (42 calls: 20 returned no content) | **1** (10 calls; not measurable, see below) |
| Misses recovered, any run (of 29) | 3 (10%) | 15 (52%) | **11 (38%)** | 0 of 4 on its one head |
| Recovered per run (runs 1 / 2 / 3) | n/a | 8 / 14 / 12 | 7 / 7 / 7 (run 2 is missing on 2 heads) | n/a |
| Clearly false per pass, mean / max | 4.1 / 6 | 3.8 / 10 | **1.5 / 4** | 1 / 1 |
| ... excluding the PR-description artifact | not recorded | 2.7 | **0.5 / 3** (3 of 22 passes above 1) | 0 |
| Findings per pass | 3-6 | 10-25 | 9-18 (mean 13.3) | 7 |
| Latency per usable pass | ~10 s | ~11 min | 144-360 s (mean ~224 s) | 760 s |
| Measured tokens per call (mean in / out) | not recorded | not recorded | 35.5k / 56.8k (mostly reasoning) | 57k / 29.8k |
| Cost per call, list price | ~USD 0.02 (est.) | ~USD 0.2 (est.) | ~USD 0.08 (measured tokens) | ~USD 0.28 (one measured call) |
| Cost and model time per usable pass, retries included | ~USD 0.02, ~10 s | ~USD 0.2 (est.), ~11 min | **~USD 0.15, ~8 min** (42 calls for 22 passes) | n/a |
| List price, International, per M tokens in / out | 0.4 / 1.2 | 2 / 6 | 0.30 / 1.20 (peak) | 2.40 / 4.80 |

Overlap with `qwen3.8-max`: flash recovers 9 of `qwen3.8-max`'s 15 and adds 2 it never named (`15abc9766ee4` on `8c28ba8c`, where `qwen3.8-max` recovered 0 of 3, and `562f60cc7912` on `a244cabd`). Together the two models cover 17 of 29.

### `deepseek-v4.1-flash-1017`

- **Recall:** 11 of 29 (38%). That is above the 30% bar and between the default (10%) and `qwen3.8-max` (52%). Each run recovers 7, so it is steadier than `qwen3.8-max` (8, 14 and 12) but lower than its better runs.
- **Precision:** the mean is 1.5 clearly false findings per pass, or 0.5 without the PR-description artifact. That is the lowest of any candidate measured so far. Excluding the artifact, 19 of 22 passes have at most 1. The exceptions are `194f66e5` runs 2 and 3 (2 and 3) and `a244cabd` run 3 (2). Of the 11 clearly false findings that are not the artifact, 4 ask for CLI flags that already exist and 3 ask about the existing `matchTerms` field. Of the 271 unmatched findings, 67 were judged real, 171 plausible and 33 clearly false.
- **Reliability is the blocker.** 20 of 42 calls (48%) returned HTTP 200 with no review content. In all 20, `completion_tokens` was exactly 65,536 and nearly all of them were reasoning tokens: the model spent its whole output budget thinking and never answered. The harness records these as `unusable_output`.
  - Retries were allowed: each unusable attempt is re-run and the later record supersedes it. After four attempts each, two passes never succeeded (`90a694ea` run 2 and `8c28ba8c` run 2), so those heads have two runs instead of three.
  - Ronda's client sets neither an output limit nor a thinking budget, and this study did not change it. Whether a thinking budget or a non-thinking mode fixes this, and what it does to recall, is untested.
- **Latency:** 2.5 to 6 minutes per usable pass, against about 10 s for the default.

### `deepseek-v4-pro-0813`: not measurable in free-tier-only mode

- Head `194f66e5` (3 calls):
  - Run 1 hit the harness's 1,200 s client timeout.
  - Run 2 succeeded in **760 s** with 7 findings: 0 of the head's 4 misses, 1 clearly false (the PR-description artifact), 3 real, 3 plausible.
  - Run 3 got **HTTP 500** after 599 s.
- The maintainer then chose a reduced run (one pass per remaining head). All 7 calls got **HTTP 403 `insufficient_quota`**: the account is in Model Studio's "use free tier only" mode and the free quota for this model was used up. One diagnostic call (a one-word prompt with `max_tokens` 1) confirmed the error code. The raw rows carry the harness's generic label "Model API rejected the credential (HTTP 403)"; the quota cause comes from the probe.
- Per the maintainer's decision (option B), pro is closed as **not measurable in free-tier-only mode** and was not called again. One pass is not evidence about recall.
- Operationally, before the quota ran out, 2 of 3 calls failed and the one success took almost 13 minutes, already slower than `qwen3.8-max`.

## Spend

The cap was USD 10 total. Before every call, the wrapper checked that cumulative spend plus a worst-case pass stayed under the cap, lowered to USD 9 after the maintainer's option A.

| Model | Calls logged | Spend booked, list price |
| --- | --- | --- |
| `deepseek-v4.1-flash-1017` | 42 | USD 3.31 |
| `deepseek-v4-pro-0813` | 11 calls in 12 usage rows (3 + 7 + 1 diagnostic probe; the HTTP 500 has a raw zero row and a worst-case row) | USD 1.18 |
| **Total** | | **USD 4.49** |

- Booked at **list price**, International (Singapore), peak rates: flash 0.30 / 1.20 and pro 2.40 / 4.80 USD per M tokens.
- The booking ignores the implicit-cache input discount (most repeated prompts were reported as cached) and off-peak rates, so it overstates spend.
- The two failed pro calls that returned no usage (the 1,200 s timeout and the HTTP 500) are each booked at a worst case of USD 0.45, in case the provider billed them.
- Some of the calls were probably served from the free quota, so the amount actually billed may be lower, possibly USD 0 for pro. **This is not a billing figure: confirm the real cost in the Model Studio console.**
- Prices come from the public Alibaba Cloud Model Studio pricing pages (<https://www.alibabacloud.com/help/en/model-studio/model-pricing>, <https://www.alibabacloud.com/help/en/model-studio/deepseek-v4-pro>), read on 2026-11-24. Check the live page before relying on them.

## Recommendation

1. **Keep `qwen-plus-2025-12-01` as the default.** Nothing here justifies a change. Flash's 2.5-6 minute latency and 48% empty-response rate rule it out as a default for every PR as configured today.
2. **`deepseek-v4.1-flash-1017` is the most promising candidate measured for the opt-in spec/plan mode (#157).**
   - It clears the 30% recall bar (38%). It meets the precision bar only on the mean and only once the PR-description artifact is excluded: 0.5 per pass, with 3 of 22 passes still above 1. As run, it is 1.5 per pass and fails the bar. #143 judged `qwen3.8-max` on its as-run figure (3.8), so neither model clears the bar under that reading.
   - Other caveats on this comparison: a different set of judge agents scored flash, and two heads have only two runs each.
   - Per usable pass, retries included, it costs about USD 0.15 against an estimated USD 0.2 for `qwen3.8-max` (~0.75x), and it takes about 8 minutes of model time against ~11 (~1.4x faster).
   - It is not usable until the empty-response problem is solved. The next step is a separate, maintainer-authorized item: measure flash with a thinking budget or a raised output limit. That needs a client or config change, which this item does not make.
3. **`deepseek-v4-pro-0813` is not evaluated.** Re-measuring it needs paid access enabled in the Model Studio console, which is a billing decision for the maintainer, and a new cap. Given its observed latency (about 13 minutes) and failures, it is a low-priority candidate.
4. **GLM (`glm-5.3`) was not run.** If it is wanted, it is a separate run with its own cap.
5. Code-review recall (the #105/#106 campaigns) remains unmeasured for every non-default model, as #183 noted.
6. Pin dated snapshots in any recorded evidence (#121). Both ids here are dated, and every successful response echoed them.

Default model, prompt, config and production code are unchanged by this item.
