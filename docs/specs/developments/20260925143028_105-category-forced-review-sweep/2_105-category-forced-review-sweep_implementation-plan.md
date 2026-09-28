# Category-Forced Review Sweep — Implementation Plan

**Spec**: [`1_105-category-forced-review-sweep_specs.md`](1_105-category-forced-review-sweep_specs.md)
**Smoke test runbook**: [`../../../testing/ronda/105-category-forced-review-sweep.smoke-test.md`](../../../testing/ronda/105-category-forced-review-sweep.smoke-test.md)

---

## Summary

**Approach**: Ship the recorded category list as a committed JSON artifact (`docs/testing/ronda/sweep-categories.json`, version `sweep-categories-v1`) read by the pass. Sweep enablement rides the existing operator-configuration precedence as a new `RONDA_SWEEP_MODE` key (same on/off/1/0/true/false vocabulary as durability mode, plus an explicit `default` alias for `off`). When enabled and the list is valid, `run-review-pass` appends a category sweep section to the review prompt, records per-category outcomes on the check-run output and logs, and stamps the review summary with the activation and list version; every degraded path (off, unrecognized value, unreadable/empty/malformed list) degrades to the existing non-sweep review with the spec-mandated record and no failure. The benchmark fixture gains five seeds (four unseeded real themes plus one harder credential-pattern case), and a committed evidence document under `docs/testing/ronda/` records the sweep-off/sweep-on recall, variance, precision, and cost comparison.

**Estimated complexity**: L

**Rationale**: The sweep itself is small (config key, one prompt section, two summary renderers, per-category record in `run-review-pass` with terminal-failure bookkeeping — AC1's surfaced rule), but the item's bulk is evidence: five fixture seeds with recorded rule metadata (AC12, AC13), a ≥5-sample × 2-configuration benchmark campaign including an original-fixture control (AC8), paired precision runs (AC9), paired cost metrics (AC11), and the adjudication-outcome, terminal-miss-record, and evidence-tier bookkeeping model (AC15). One review pipeline change plus a multi-day measurement campaign and several new committed evidence artifacts.

**Dependencies**: None blocking. The spec names #24 (seeded benchmark suite — merged, fixture exists) and #53 (capture-external-review-misses — merged, comparison records exist) as evidence lineage, not as merge-order dependencies; both surfaces are already on `develop`.

---

## Verification Log

> Recorded at plan-write time on branch `implementation-plan/105-category-forced-review-sweep`, repo revision `def04bd` (= `origin/develop` after `git pull origin develop`).

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `def04bd` (matches `git rev-parse origin/develop`) |
| No pre-existing sweep surface | `grep -rn "sweep" src/ \| wc -l` | `0` — no sweep code exists yet; all listed files are new edits |
| Sweep artifact absent | `ls docs/testing/ronda/sweep-categories.json` | does not exist — the artifact is new |
| Seeded defect count (original fixture) | `python3 -c "import json; print(len(json.load(open('tests/fixtures/recall-benchmark/manifest.json'))['seededDefects']))"` | 13 seeded defects; 1 precision fixture (`harmless-session-refactor`) |
| 2026-09-10 baseline sample count and model | `sed -n '1,6p' docs/testing/ronda/review-quality-baseline-2026-09-10.md` | Sample count: 5; Model: `qwen-plus` (mutable alias — AC8's non-comparable label); 6–8/13 spread; four kinds never found |
| Operator config precedence surface | `src/config/load-config.ts` (env → file → default) and `.github/workflows/ronda-review.yml` L134–145 | Actions ingress maps inputs to `RONDA_*` env; no per-PR env indirection to add — one `RONDA_SWEEP_MODE` env line plus one workflow input |
| Existing on/off vocabulary | `parseBooleanFlag` / `parseDurabilityMode` in `src/config/load-config.ts` | `on/1/true` → on, `off/0/false` → off, `default` recognized (durability only) — the sweep uses the same case-insensitive vocabulary in a sweep-specific parser: `parseBooleanFlag` alone cannot recognize `default` as off or carry an unrecognized raw string, and the bare `parseX(env) ?? parseX(file)` precedence pattern must not be reused because an unrecognized value must not defer to a lower-precedence source |
| Review summary / check-run renderers | `src/core/summary.ts` (`buildReviewSummary`, `buildCheckRunOutput`) | `buildReviewSummary` takes optional `durabilityMode` today; `buildCheckRunOutput` takes no mode field — both gain sweep fields as optional props so sweep-off rendering is unchanged |
| Benchmark runner surface | `src/cli/recall-benchmark.ts` | `runRecallBenchmark` / `runPrecisionFixture` build prompts via `buildReviewPrompt` and print one JSON summary; `npm run benchmark:quality` wired in `package.json` |
| Per-PR cost baseline exists | `docs/testing/ronda/cost-convergence-baseline-2026-09-23.md` | 8-row per-PR convergence table — the comparison target AC11/AC15(d) name |
| Pre-create nested-artifact guard | `run-nested-artifact-guard.sh --mode pre-create --issue 105 --expected-branch implementation-plan/105-category-forced-review-sweep --approved-base develop` | `RESULT=clean` (0 unexpected artifacts) |

---

## Cross-Cutting Operational Assumption Check

### Applicable

| Assumption surface | Recorded value | Authoritative source | Verified at | Bounded cross-check scope | Result |
| --- | --- | --- | --- | --- | --- |
| Plan artifact base branch | `develop` | Parent handoff (`--base develop`); `git rev-parse HEAD == origin/develop == def04bd` | 2026-09-27, `def04bd` | Current invocation item (#105 only); `gh pr list --state open` returned `[]` — no open PR touches the same artifact-branch surface | `Verified` |
| Sweep enablement resolution surface | Existing operator-config precedence: env over config file over built-in default (same surface as the durability-mode switch) | Spec AC18; `src/config/load-config.ts`; `.github/workflows/ronda-review.yml` | 2026-09-27, `def04bd` | Same-surface open PRs: none (empty open-PR list) | `Verified` |
| Benchmark sample-count floor | 5 runs per configuration (the 2026-09-10 baseline's count) | Spec AC8; `docs/testing/ronda/review-quality-baseline-2026-09-10.md` | 2026-09-27, `def04bd` | No open PR | `Verified` |

---

## Layer-by-Layer Changes

### Database / Data Layer

Not applicable — no database in this repository.

### Recorded artifacts (data layer equivalent)

- [ ] New `docs/testing/ronda/sweep-categories.json` — the current recorded sweep category list, machine-readable, carrying: `version` (`"sweep-categories-v1"`), `activatedOn` (`"2026-09-27"`), the five swept categories (AC4, AC6: `pr-head-push-order`, `credential-pattern-gap`, `external-output-parsing`, `record-identity`, `guard-fails-open` — each with `identifier`, `displayLabel`, `description`, `failureShape`, `evidenceSource`, `findingInstanceCount` from the spec's Statuses table, plus `matchTerms`: a non-empty array of lowercase literal substrings drawn from the category's `failureShape` wording, which the deterministic classifier (see `run-review-pass.ts` rule 3) matches against finding text), the excluded candidates with rationales, the sub-themes below the candidate boundary, and `revisionHistory` (one initial entry, dated 2026-09-27). Also states `countingUnit: "finding instances, not distinct defects"` (AC5). Loaded from the repository root at pass time — never fetched from the reviewed head, and never from the operator config path. **AC4, AC5, AC6, AC7**
- [ ] New `docs/testing/ronda/sweep-effect-evidence.md` — the committed benchmark evidence document (AC8, AC9, AC11) recording both configurations' recall, spread, precision, and cost figures with the non-comparable label on the historical baseline. **AC8, AC9, AC11**
- [ ] New `docs/testing/ronda/sweep-real-pr-evidence.md` — the evidence-tier record for Use Case 6: current tier label (`fixture_only` at ship time), counted-pull-request total (0), own-repository caveat, and the adjudication-outcome code values' application record. The cohort mechanics, terminal-miss record, and tier transitions are recorded here; no automated process counts or promotes the tier (AC15's count is an operator-read record, not product code — recorded plan-time decision, restated in the Decision-gate matrix and Residual verification strategy below). **AC15, AC16**

### Backend / API (src/)

- [ ] `src/config/config.types.ts` — add `sweepMode` and `sweepModeRaw` to `RondaConfig`: `sweepMode: "on" | "off"` (post-resolution effective state) and `sweepModeRaw: string | undefined` (the non-empty unrecognized value, carried for the unrecognized-enablement record; never logged or published). **AC18**
- [ ] `src/config/load-config.ts` — resolve `RONDA_SWEEP_MODE` / `sweepMode` file key through the existing precedence. Parsing follows AC18 exactly: `on/1/true` (case-insensitive) → on; `off/0/false/default` → off, recognized; absent, empty, or whitespace-only → off, not supplied (one case, no record); any other non-empty value → off with the value recorded as unrecognized — and it is the effective value: an unrecognized non-empty value at a higher-precedence source is not replaced by a recognized value at a lower-precedence source (empty/absent at a higher source defers, unrecognized does not). A sweep-specific `parseSweepMode` helper follows the same case-insensitive vocabulary `parseBooleanFlag`/`parseDurabilityMode` use (`nonBlank`, lowercase compare), but is its own function: it must also recognize `default` as off and carry the unrecognized raw value, neither of which `parseBooleanFlag` does, and it must not use the bare `??`-chained env-then-file pattern the other keys use — that pattern silently defers an unrecognized value to the lower-precedence source, which AC18 forbids. Default: off for every adopting repository. **AC18**
- [ ] New `src/review/sweep-categories.ts` — loader + validator for `docs/testing/ronda/sweep-categories.json`, and the deterministic `classifyFindings` used by the pass. Loads by absolute path from the Ronda checkout. Signature `loadSweepList(options?: { path?: string })`: production (`run-review-pass.ts` rule 2's load step) calls it with no argument and gets the repository artifact `docs/testing/ronda/sweep-categories.json`; the optional `path` exists only as the test seam, and no operator-configurable list path is added anywhere (AC19's degrade branch needs no live reconfiguration — a malformed artifact is fixed by editing the artifact). Validation per AC19: file readable; parses as JSON; has a list version (non-blank scalar string, exact-string-equality identity); has at least one category; every category has identifier, display label, description, failure shape, evidence source (each a non-empty, non-blank string), finding-instance count (positive integer, zero not allowed), and `matchTerms` (non-empty array of non-blank strings); no duplicate identifiers. Returns a discriminated result: `{ ok: true, list }` or `{ ok: false, reason }`. `classifyFindings(findings, list)` returns the per-category outcomes and the uncategorized count per the rules in `run-review-pass.ts` rule 3 — pure, no I/O. Pure stdlib (`node:fs`, `node:path`) — no new dependency. **AC19, AC20**
- [ ] `src/domain/review-pass.types.ts` — add sweep types: `SweepCategory` (identifier, display label, description, failure shape, evidence source, count, version, `matchTerms: string[]`), `SweepCategoryList` (version + categories), `SweepCategoryPassOutcome = "produced_findings" | "produced_none" | "not_determined"`, `SweepPassRecord` (categories array + `uncategorizedFindingCount`), and extend `ReviewPassResult` with optional `sweep` metadata (list version, per-category record, or a `sweepDidNotRun` / unrecognized-enablement flag) for benchmark and caller surfaces. **AC1, AC20**
- [ ] `src/inference/review-prompt.ts` — `BuildReviewPromptInput` gains an optional `sweepCategories?: SweepCategory[]`. When present, `buildReviewPrompt` appends one system-prompt section "## Category-forced sweep" that instructs the model: consider each listed category (identifier, display label, description, failure shape) against the changed content; producing no finding for a category is a normal expected result and must never be forced; findings that fit no swept category are still reported; ordinary severity rules and the JSON output contract are unchanged. Categories join the existing single request — the sweep never creates a second model call per category (AC1's "the sweep composes that one request from the recorded list"). The section is appended after durability instructions so one pass carries both modes without splitting. **AC1, AC10, AC20**
- [ ] `src/core/summary.ts` —
  - `ReviewSummaryInput` gains optional `sweep?: { listVersion: string }`. When present, `buildReviewSummary` emits a "### Category-forced sweep" line stating the sweep was active and the list version used — and nothing else (display labels never appear in the review body). **AC3**
  - `CheckRunOutputInput` gains optional `sweep?: SweepPassRecord`. When present, `buildCheckRunOutput` appends the per-category record — one line per category with its outcome, plus the uncategorized finding count — to the check-run summary. The failure path never receives sweep fields: AC1's rule is that the check-run output carries the record only where the pass's own check-run write produced a check run whose outcome is a review, and the existing failure check run's outcome is a failure. **AC1, AC20**
- [ ] `src/core/run-review-pass.ts` — the pass orchestration change, after the draft and existing-check-run skip gates (so pre-review skips never read the list, never emit sweep metadata — AC1) and after the config/credential failure gates:
  1. Resolve enablement from `deps.config.sweepMode`/`sweepModeRaw`. If off and the raw value was non-empty unrecognized, log an `sweep_enablement_unrecognized` event (no raw value in the message — fields carry `true` only) — but only for a pass that reaches review execution, so it is emitted after the changed-files read, not at gate time.
  2. If on, load and validate the category list. Invalid (unreadable, empty, malformed per AC19): proceed as an ordinary non-sweep review, log `sweep-did-not-run` with the reason, report no list version — the pass never fails and never loses publication eligibility. **AC19, AC2**
   The record name is the spec's (`sweep-did-not-run`, hyphenated) and this plan uses it verbatim; it is the one event name in this change that is hyphenated rather than the repo's snake_case convention, so do not "correct" it to `sweep_did_not_run`.
  3. If on and valid: pass `sweepCategories` into `buildReviewPrompt`; mark every category in the request as "reached" (AC1's rule — reached = carried by the one request the pass issued); after the model response is parsed, classify with a new pure function `classifyFindings` (in `src/review/sweep-categories.ts`) that is a function of the parsed findings and the recorded list alone — no regex, no stemming, no model call. Rule: normalize each finding to lowercase `title + "\n" + body`; a finding matches a category when the normalized text contains any of that category's recorded `matchTerms` as a literal substring. A finding matching one or more categories is recorded against every category it matches (AC20's "one or more"); a finding matching none increments `uncategorizedFindingCount`. Each category with at least one match is `produced_findings`; each with none is `produced_none`. Replaying the same parsed findings against the same list version yields the same record. **AC1, AC20, AC4**
  4. Terminal failure after review execution (the shared `catch`/`finalizeFailure` path with a head SHA): record categories the pass reached as `not_determined` on the logs only (its check run is the failure check run, outcome not a review) — where the failure precedes the review becoming public; where the review is already public (`reviewPublished` guard / post-publication check-run write failures), record the ordinary `produced_findings`/`produced_none` values on the logs plus whatever per-category surface the pass's own check-run write produced. **AC1**
  5. On the success path, thread `sweep` into `buildReviewSummary` (activation + list version, AC3) and `buildCheckRunOutput` (per-category record, AC1) and log a `sweep_pass_record` event (per-category record on the logs — always, both surfaces, since AC1 assigns the record to the check-run output and the logs for a completing pass that publishes).
  Superseded-before-publication passes (the `superseded_head_sha` skip return) log their per-category record before returning. **AC1**
- [ ] `src/cli/recall-benchmark.ts` — `runRecallBenchmark` and `runPrecisionFixture` accept an optional `sweep?: { listVersion: string; categories: SweepCategory[] }` input: when present, prompts are built with `sweepCategories`, and the returned summary carries the per-category pass record as `sweepPerCategory` — typed by the step-3 `SweepPassRecord`, not a parallel shape — plus model-call count and elapsed time per pass (cost figures — AC11). The record is present only for a sweep-on run; a sweep-off run's summary has no `sweepPerCategory` (the control arm, AC18). A small driver extension (CLI flags `--sweep-mode <off|on>`, `--runs <n>`, and `--output-file <path>`, specified in Implementation Order step 10) runs the paired sweep-off/sweep-on campaign, the original-fixture control, and the paired precision runs (real model via `--quality`, never `--precision-response-file`); the JSON summary — printed to stdout, or written to `--output-file` — is the benchmark output surface AC1 assigns to benchmark runs. **AC8, AC9, AC11, AC1 (benchmark output surface)**
- [ ] `tests/fixtures/recall-benchmark/manifest.json` + `patches.json` — five new seeds (see Seed Data). **AC12, AC13**
- [ ] `src/cli/review-pr.ts`, `src/webhook/webhook-job.ts`, `tests/unit/core/run-review-pass.test.ts`, `tests/integration/review-pass.test.ts` — the config-object construction sites the two new required `RondaConfig` fields reach. `loadConfig` already carries the fields to real runs (no plumbing change in the CLI or webhook entrypoints), but every full `RondaConfig` literal must gain `sweepMode` / `sweepModeRaw` or `npm run typecheck` fails. Verified sites: the two `loadConfig` catch-block fallback literals (`src/cli/review-pr.ts` L81–90, `src/webhook/webhook-job.ts` L224–233) and the test config literals (`tests/unit/core/run-review-pass.test.ts` `createConfig`, `tests/integration/review-pass.test.ts` L84/L223/L304). The fallback literals take the degraded values (`sweepMode: "off"`, `sweepModeRaw: undefined`) — a failed config load is not a sweep pass. No behavioral change beyond satisfying the type. **AC18**

### Frontend / UI

Not applicable — no UI; GitHub review body and check-run output are the only operator-visible surfaces, covered above.

### Infrastructure / Configuration

- [ ] `.github/workflows/ronda-review.yml` — one new optional string input `sweep_mode` (default empty = off), mapped to `RONDA_SWEEP_MODE` in the review-pass step env, exactly as `durability_mode` is today. This is the per-repository Actions ingress (AC18). **AC18**
- [ ] `ronda.config.example.json` — add `"sweepMode": ""` placeholder with empty default (off). **AC18**
- [ ] No new secret, no new environment requirement, no CI job addition (benchmark campaign is operator-run, its results committed as evidence).

---

## Testing Strategy

**Test types**: Unit (deterministic, no network — existing `node --test`-style suites in `tests/unit/`) + Smoke (runbook, operator-run real-model campaign).

**Key scenarios to test**:

1. Enablement resolution matrix — on/off/1/0/true/false/default, absent, empty, whitespace-only, unrecognized non-empty; precedence (env over file), empty-at-higher-source defers, unrecognized-at-higher-source does not get replaced — maps to AC18 (unit: `tests/unit/config/load-config.test.ts`).
2. Category list validation — every malformed shape AC19 names: unreadable file, unparseable JSON, missing/blank list version, non-scalar version, zero categories, missing/blank identifier (or any other required field), missing/empty/non-string `matchTerms`, non-positive or non-integer count, duplicate identifiers — maps to AC19 (unit: new `tests/unit/review/sweep-categories.test.ts`). Same file also unit-tests `classifyFindings`: a finding matching one category, a finding matching two categories (recorded against both), a finding matching none (uncategorized count increments), case-insensitive substring matching, and same-input-same-output determinism — maps to AC20.
3. Prompt composition — sweep section present when categories given, absent otherwise; category list rendered once into the single request; JSON contract and durability instructions unchanged — maps to AC1 (unit: `tests/unit/inference/review-prompt.test.ts` extension).
4. Summary renderers — review summary states activation + list version only (no display labels, no per-category list); check-run summary carries the per-category record with the three outcome values; failure check-run output carries no sweep fields — maps to AC1, AC3 (unit: `tests/unit/core/summary.test.ts` extension).
5. Pass integration — enabled + valid list + model findings: record on both surfaces, uncategorized counting, one published review; enabled + malformed list: non-sweep review, `sweep-did-not-run` record, publication preserved; enabled + unrecognized value: non-sweep review with the unrecognized record and no raw value anywhere; terminal failure after review execution: `not_determined` on logs only; pre-review skips (draft, already-reviewed): zero sweep metadata — maps to AC1, AC2, AC10, AC19, AC20 (unit: `tests/unit/core/run-review-pass.test.ts` extension).
6. Benchmark classification — per-category record present in a sweep-on run's summary and **absent** from a sweep-off run's (asserted, not merely unset), cost fields on both arms, `--runs 2` producing two per-run records — maps to AC8, AC9, AC11, AC18 (unit: `tests/unit/cli/recall-benchmark.test.ts` extension).
7. New seeds — each seeded defect is matched by a representative finding fixture and unmatched by the clean precision fixture — maps to AC12, AC13 (unit: same recall-benchmark test file, fixture-response mode).

**Smoke test runbook**: `docs/testing/ronda/105-category-forced-review-sweep.smoke-test.md`

**Regression suite**: The repository's committed unit suite is the regression suite; the new/extended unit tests above are the regression coverage for the runbook's deterministic steps. The ≥5-run real-model campaign is operator-run and its results are committed evidence, not CI.

### Parser-risk addendum

Not applicable — the plan adds no lint/parser/scanner module and no regex-driven structured-text scanning. The category-list validator is field validation over a committed JSON file the repository itself authors, and finding-to-category classification is model-adjacent record-keeping, not text scanning. The existing `src/inference/parse-model-response.ts` is not modified.

### Concurrent-event-source addendum

Not applicable — the sweep adds no listener, timer, or async queue. It is a synchronous step inside the existing single-pass orchestration, whose deadline/teardown machinery is unchanged.

---

## Decision-gate matrix (plan-time classification)

This item adds review-pass behavior gated on multiple inputs and outcomes, so the plan carries the matrix rows the spec fixes. The implementation's renderers and records must reproduce these rows exactly; mirror surfaces are `src/config/load-config.ts` (sweep parsing), `src/review/sweep-categories.ts` (readability), `src/core/run-review-pass.ts` (surface assignment), `src/core/summary.ts` (check-run/review rendering), and `docs/testing/ronda/sweep-real-pr-evidence.md` (tier/claim bookkeeping).

| Gate | Inputs | Allowed outcomes | Required next action | Mirror surfaces | Example |
| --- | --- | --- | --- | --- | --- |
| Sweep enablement resolution | Effective operator-config value for the run (highest-precedence non-empty source) | Off — absent/empty/whitespace (no record); Off — recognized off value (no record); Off — non-empty unrecognized (record unrecognized, without the raw value); On — recognized on value | Off: ordinary non-sweep review, no per-category pass result, no list read. On: run the sweep | `load-config.ts` parse; AC18; Use Case 1 | Unrecognized at higher-precedence source stays the effective value; is not replaced by a recognized lower-precedence value |
| Category list readability | List state at pass start (reaches review execution) | Readable and well-formed: sweep runs over the list. Unreadable/empty/malformed: `sweep-did-not-run`, no list version reported | Degrade to non-sweep review; never fail the pass; never suppress publication | `sweep-categories.ts` validator; AC19 | Two categories sharing an identifier → malformed → degrade |
| Pass-outcome surface assignment | Where the pass reached; whether it published; whether its check-run write produced a check run whose outcome is a review | Pre-review skip or pre-review terminal failure: no sweep metadata. Completion + review check run: record on check-run output and logs. Completion without such a check run (superseded, benchmark): record on logs plus own surface (benchmark output). Terminal failure after review execution: record on logs, plus check-run output only where that write produced a review-outcome check run | Record categories the pass reached; never fabricate a record for an unreached category; never publish a second review | `run-review-pass.ts` record placement; AC1 (sole owner) | Model-credential-rejected-after-read: failure check run, outcome not a review → logs only |
| Evidence-tier transition | Any sweep-enabled real-PR review recorded; counted pull requests under current list version; list revised | `fixture_only` → `real_pr_provisional` on first sweep-enabled real-PR review; → `real_pr_measured` at ten counted; `real_pr_measured` → `real_pr_provisional` when count falls below ten (revision or reopened adjudication); all other combinations unchanged | Label the tier on the evidence record; claims admissible only as tier + claim-admissibility gate allow | `docs/testing/ronda/sweep-real-pr-evidence.md`; AC15, AC16 | Ten `unclear`-only PRs do not promote the tier |
| Claim admissibility | Evidence tier; closed, terminally adjudicated cohort; per-claim evidence (matched control covering the whole cohort, run set fixed in advance; equal run counts; named metrics — population-stddev variance, mean-of-per-run-recalls recall, paired per-head cost; non-zero confirmed-defect denominator; paired precision evidence) | Descriptive claim: permitted at `real_pr_measured` alone. Comparative claim: only with every required control, metric, and evidence present. Missing anything: the claim is omitted (not recorded not-applicable). Zero denominator: recall and variance figures reported not applicable | Admit only when tier and the claim's own evidence both hold; otherwise omit | `docs/testing/ronda/sweep-real-pr-evidence.md`; AC15(d) | Asymmetric run counts (one config repeated) carry no comparative claim |

---

## Seed Data

| Entity | Values / Scenario | File |
| --- | --- | --- |
| Sweep category list | The five categories, excluded candidates, boundary sub-themes, version `sweep-categories-v1`, activation date 2026-09-27, one revision-history entry, counting-unit statement — values exactly as the spec's Statuses / Enum Values table fixes them | `docs/testing/ronda/sweep-categories.json` |
| Seeded defect: state reconstruction from API evidence | New seed `api-evidence-state-reconstruction` (path `src/benchmark/git-history.ts` or similar): a branch-head conclusion drawn from a list endpoint that does not establish it; matchTerms over "head", "api", "evidence"/"inference" — counts as a real-theme seed for `pr-head-push-order` | `tests/fixtures/recall-benchmark/manifest.json` + `patches.json` |
| Seeded defect: external output parsing | New seed `external-output-parsing-lossy` (path `src/benchmark/output.ts` or similar): items lost/merged when splitting or classifying another system's output | same |
| Seeded defect: guard fails open | New seed `guard-fails-open` (path `src/benchmark/guard.ts` or similar): a check that continues when its input cannot be loaded | same |
| Seeded defect: record identity | New seed `record-identity-drift` (path `src/benchmark/records.ts` or similar): position-derived identifier or alias spelling that collides or drifts | same |
| Seeded defect: harder credential pattern | New seed `credential-pattern-gap-camel` (path `src/benchmark/credentials.ts` or similar): a qualified or camelCase credential name the canonical guard form does not match, alongside a `harderThan` metadata field recording which of AC13's four ways it differs by and the canonical baseline form it is compared against. No real credential value — non-functional credential-shaped data only (AC14) | same |
| Precision fixture | The existing `harmless-session-refactor` fixture stays the clean target for the paired precision runs; the new credential seed's clean counterpart may be added if the developer judges it needed — not required by AC9 | `tests/fixtures/recall-benchmark/manifest.json` |
| Original-thirteen fixture snapshot (AC8 control) | The pre-extension `manifest.json` + `patches.json` copied verbatim (13 seeds, no new seeds) before step 9 mutates the live fixture — byte-identical control inputs, so the extended-vs-original comparison is reproducible instead of operator-invented | `tests/fixtures/recall-benchmark/original-thirteen/manifest.json` + `patches.json` |

---

## Documentation Updates

Listed for the developer to execute after implementation (not done in Plan Ready):

- [ ] `docs/adoption/ronda-review-adoption.md` — add `sweep_mode` to the optional-inputs table (section 1) and document `RONDA_SWEEP_MODE` in section 6's environment-variable list with the recognized on/off vocabulary and the degraded behavior (AC18).
- [ ] `docs/testing/README.md` — index the new runbook and evidence artifacts if that file's conventions require it.
- [ ] `AGENTS.md` — no change expected (no new npm script the agent table must mirror unless the developer adds a `benchmark:sweep` script — then list it under Common Commands).
- [ ] `docs/project/1-business-domain.md` and `docs/project/3-software-architecture.md` — add the sweep mode to the domain glossary / operator-configuration surface only if those docs enumerate every review mode; verify against their current content during implementation.
- [ ] AC17's documentation statement (seeded benchmark is not a regression gate until the AC12/AC13 seeds exist; what a restored gate rejects is a deferred decision) belongs in `docs/testing/ronda/sweep-effect-evidence.md` — written by the implementation as part of the evidence artifact, listed here so the reviewer checks it.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Sweep degrades review precision — model manufactures a finding per category (the spec's named failure mode) | Medium | High | Prompt section explicitly forbids per-category forcing; paired precision runs with the strict no-tolerance regression test are mandatory evidence before any default-enablement talk (AC9, AC10); sweep ships off (AC18) |
| Per-category record placement misses an AC1 surface case (terminal failure, superseded, benchmark, post-publication failure) | Medium | Medium | Unit tests enumerate every AC1 path (scenario 5); the record is computed once at record time from the request, so placement is the only variable |
| Category list shipped malformed → sweep silently never runs | Low | Medium | Validator unit tests cover every malformed shape; `sweep-did-not-run` is logged, so the degraded state is visible |
| Recognition of unrecognized enablement value leaks the raw value into logs or a check run | Low | High | `sweepModeRaw` is carried but never rendered; unit test asserts absence from every output surface; secret-redaction discipline already enforced by existing logger tests |
| Benchmark campaign sample cost (5+ runs × 2 configs × 2 fixture versions + precision pairs) runs long or hits rate limits | Medium | Low | Staged campaign: unit-fixture verification first, real-model runs batched; run timestamps recorded; pass budget already bounded by `passTimeoutMs` |
| Adjudication / tier bookkeeping misimplemented as automated counting | Medium | Medium | Recorded plan-time decision: cohort counting, terminal-miss records, and tier transitions are recorded evidence documents the operator maintains; no product code counts or promotes the tier |
| Secrets in new fixture seeds | Low | High | AC14 rule: non-functional credential-shaped data only; forbidden-value redaction path already exists in the benchmark classifier |
| Deployed sweep behavior must be withdrawn (precision regression, runaway cost, or a bad category list reaching production) | Low | Medium | The primary reversal lever is the config surface, not a code revert: the sweep ships off (AC18), so setting `RONDA_SWEEP_MODE=off` (or removing the `sweep_mode` workflow input) restores the exact pre-feature pass — same prompt, same summary, same check run — with no deploy and no archaeology. A code revert is the fallback if the flag path itself is implicated: revert the `run-review-pass.ts` / `sweep-categories.ts` / `summary.ts` / `review-prompt.ts` changes, and also remove the committed artifact `docs/testing/ronda/sweep-categories.json`, the five new seeds in `tests/fixtures/recall-benchmark/manifest.json` and `patches.json`, and the `changelog.d/105.*` fragment — the artifact and seeds are inert without the loader, but leaving them would strand unreferenced evidence files. Neither lever touches the published review or check run: the sweep writes only metadata, so a withdrawn sweep leaves no residue on any pull request |

---

## Code Samples

```ts
// Illustrative — adapt during implementation.
// src/review/sweep-categories.ts — shape of the discriminated load result.
export type SweepListResult =
  | { ok: true; list: SweepCategoryList }
  | { ok: false; reason: "unreadable" | "malformed"; detail: string };

// src/core/run-review-pass.ts — AC1's record is read off the request.
const sweep = deps.config.sweepMode === "on"
  ? loadSweepList()          // ok:false → log sweep-did-not-run, run non-sweep pass (AC19)
  : undefined;
const prompt = buildReviewPrompt({ ..., sweepCategories: sweep?.ok ? sweep.list.categories : undefined });
// "Reached" = carried by this one request; on terminal failure after review
// execution, every category in it records not_determined (logs only).
```

---

## Implementation Order

1. **Config surface**: add `sweepMode`/`sweepModeRaw` to `RondaConfig`; resolve in `loadConfig` per AC18's vocabulary and precedence rules; extend `tests/unit/config/load-config.test.ts` with the full enablement matrix (scenario 1). Verify: `npx tsx --test tests/unit/config/load-config.test.ts` passes and covers every AC18 row. **AC18**
2. **Recorded artifact**: write `docs/testing/ronda/sweep-categories.json` with the five categories, excluded candidates, boundary sub-themes, version `sweep-categories-v1`, activation date 2026-09-27, and the single initial revision-history entry, values exactly as the spec's Statuses / Enum Values fixes them. Verify: the file parses as JSON and states the counting unit. **AC4, AC5, AC6, AC7**
3. **Domain types**: extend `src/domain/review-pass.types.ts` with `SweepCategory` (incl. `matchTerms`), `SweepCategoryList`, `SweepCategoryPassOutcome`, `SweepPassRecord`, and the optional `ReviewPassResult.sweep` metadata. Verify: `npm run typecheck` clean. **AC1, AC20**
4. **Loader/validator + classifier**: implement `src/review/sweep-categories.ts` (`loadSweepList(options?: { path?: string })` and the pure `classifyFindings`) against the step-3 types; add `tests/unit/review/sweep-categories.test.ts` covering every malformed shape AC19 names and the `classifyFindings` cases (scenario 2). Verify: the test file passes with both the valid committed list and each malformed variant injected through the `{ path }` test seam. **AC19, AC20**
5. **Prompt section**: extend `src/inference/review-prompt.ts` with optional `sweepCategories`; append the category-forced sweep system section (one request, no-forcing language, unchanged JSON contract); extend `tests/unit/inference/review-prompt.test.ts` (scenario 3). Verify: with no `sweepCategories`, prompts are byte-identical to today's. **AC1, AC10, AC20**
6. **Summary renderers**: extend `src/core/summary.ts` (`ReviewSummaryInput.sweep`, `CheckRunOutputInput.sweep`); extend `tests/unit/core/summary.test.ts` (scenario 4). Verify: sweep-off rendering is unchanged; failure check-run output carries no sweep fields. **AC1, AC3**
7. **Pass orchestration**: implement the `run-review-pass.ts` changes (enablement record, list load + degrade, request-carried reached set, per-category classification, terminal-failure `not_determined` handling, surface placement per AC1); extend `tests/unit/core/run-review-pass.test.ts` (scenario 5). Verify: every AC1 path — skip, pre-execution failure, post-execution failure, superseded, success, benchmark-style — has a test that asserts exactly which surfaces carry the record. **AC1, AC2, AC10, AC19, AC20**
8. **Workflow + example config**: add the `sweep_mode` input and `RONDA_SWEEP_MODE` env line to `.github/workflows/ronda-review.yml`; add the `sweepMode` placeholder to `ronda.config.example.json`. Verify: `yaml` syntax of the workflow is valid (the existing CI workflow lints or a careful read). **AC18**
9. **Fixture seeds**: first snapshot the pre-extension fixture — copy the untouched `tests/fixtures/recall-benchmark/manifest.json` and `patches.json` to `tests/fixtures/recall-benchmark/original-thirteen/manifest.json` and `tests/fixtures/recall-benchmark/original-thirteen/patches.json` (the committed 13-seed control, byte-identical to the pre-extension files), so the step-10 original-fixture control has real paths — **then** add the five seeds to the live `tests/fixtures/recall-benchmark/manifest.json` and `patches.json`, including each harder credential case's `harderThan` metadata (which of AC13's four ways, and the canonical baseline form); extend `tests/unit/cli/recall-benchmark.test.ts` (scenario 7). Verify: the snapshot under `tests/fixtures/recall-benchmark/original-thirteen/` is byte-identical to the pre-extension fixture (13 seeds, legacy `matchTermGroups` shape included) and parses as the same manifest and patch shapes; the extended-fixture benchmark in fixture-response mode classifies every new seed; the clean precision fixture stays clean. No real credential value anywhere (AC14). **AC12, AC13, AC14**
10. **Benchmark driver**: extend `src/cli/recall-benchmark.ts` with the sweep input, per-category summary record, and per-pass model-call count and elapsed time. Add three flags in the existing `parseArgs` style (value-taking, `Unknown or incomplete argument` on anything else), so the campaign is scriptable and each configuration is one command:
    - `--sweep-mode <off|on>` — the configuration under test; absent means `off`. It sets the same enablement the pass resolves (`sweepMode`) and drives list loading through the step-4 loader. The pass's own env/config resolution is unchanged, so this flag is the benchmark's only sweep switch.
    - `--runs <n>` — repeat the benchmark `n` times (≥5 for the campaign), emitting one record per run so per-run recall, spread, and per-run cost are all present. Default 1 keeps today's single-run output identical.
    - `--output-file <path>` — write the JSON summary to `path` instead of stdout, so a campaign writes one file per configuration/run without shell redirection. Absent keeps the current `console.log(JSON.stringify(output, null, 2))` behavior.
    - The three campaign legs are then: **extended fixture, both configurations** — `--sweep-mode off` and `--sweep-mode on` with `--runs 5 --output-file docs/testing/ronda/sweep-{off,on}-extended.json` (the runbook's Step 8 spells both commands out); **original-fixture control** — the same pair with `--manifest tests/fixtures/recall-benchmark/original-thirteen/manifest.json --patches tests/fixtures/recall-benchmark/original-thirteen/patches.json` (the step-9 snapshot, so the control runs against the same 13-seed inputs the extended fixture started from) and their own output files; **paired precision runs** — the same pair with `--quality` and **no `--precision-response-file`**, run the same number of times under the same effective review configuration, written to their own output files. `--precision-response-file` is fixture-only: it sends a canned response straight to `classifyPrecisionFixture` and cannot measure precision under the recorded model, so the real-model precision campaign must run inference (`--quality` alone, with the model credential the campaign already requires). The evidence doc (step 11) is assembled from those files; no run is hand-transcribed.
    - Output shape: each run's record carries the existing recall/found/missed/precision fields plus, **for a sweep-on run only**, the per-category pass record (every category with `produced_findings`/`produced_none` plus the uncategorized count, reuse of the step-3 `SweepPassRecord` type, not a parallel shape), the model call count, and elapsed time for that pass. A sweep-off run is the control arm and carries **no** per-category record — never a fabricated `produced_none` set and no classification (AC1 assigns the record to an enabled sweep; AC18 requires an ordinary disabled run to have none); the cost fields are still present for both arms, since AC11 compares them. `--quality` composition is otherwise unchanged. A benchmark pass publishes no check run, so a sweep-on run's per-category record is in this output and the logs (AC1).
    Verify: fixture-response-mode end-to-end run produces the sweep-on summary with the per-category record and **both** configurations' cost fields; the sweep-off summary carries the cost fields with **no** per-category record (a test asserts its absence, so the control arm can never be mistaken for a run that classified); and `--runs 2` yields two per-run records in one file. **AC8, AC9, AC11, AC1 (benchmark surface)**
11. **Evidence campaign (operator, real model)**: run the ≥5-run-per-configuration sweep-off/sweep-on recall campaign on the extended fixture, the original-fixture control, and the paired precision runs; record everything in `docs/testing/ronda/sweep-effect-evidence.md` — per-run recall, lowest/highest, population-standard-deviation of per-run recall, per-defect found/missed counts, sample count, immutable model version, reviewed target, timestamps, fixture version, the original-thirteen subset, the non-comparable label on the 2026-09-10 baseline, the precision regression result under the strict no-tolerance test, model calls and elapsed time per pass compared against `docs/testing/ronda/cost-convergence-baseline-2026-09-23.md`, and the no-recall-target/no-variance-ceiling/no-cost-ceiling statements. Verify: a reader can tell whether recall, variance, precision, and cost changed, and that every figure cites its run set. **AC8, AC9, AC10, AC11, AC17**
12. **Real-PR evidence record**: create `docs/testing/ronda/sweep-real-pr-evidence.md` at `fixture_only` tier, zero counted pull requests, with the independence caveat, own-repository label, the adjudication-outcome application record (`ronda_only`, `ronda_rejected`), the terminal-miss-record code values, and the tier-transition table — as recorded evidence the operator maintains, not automated counting. **AC15, AC16**
13. **Update project docs** per the Documentation Updates section above (adoption doc, testing README, AC17 statement location).
14. **Add changelog fragment**: `changelog.d/105.added.category-forced-review-sweep.md` with body:

   ```markdown
   - **Category-forced review sweep** (#105): Ronda can now sweep every review pass across a recorded, evidence-justified category list (`sweep-categories-v1`, off by default, enabled via `RONDA_SWEEP_MODE` / the `sweep_mode` workflow input). Per-category pass records appear on the check-run output and logs, the review summary states the sweep activation and list version, and a degraded or unrecognized enablement value never fails a pass. The benchmark fixture gains four real-theme seeds plus a harder credential-pattern case, and committed evidence records the sweep-off/sweep-on recall, variance, precision, and cost comparison.
   ```
15. **Run the smoke test runbook**: `docs/testing/ronda/105-category-forced-review-sweep.smoke-test.md`, recording results per its assertions checklist.
16. **Full gate**: `npm run typecheck`, `npm run lint`, `npm test`, and the markdown lint commands from `AGENTS.md` on every changed `.md` file — all clean before PR readiness.

---

## Residual verification strategy

This is sweep + evidence work, so residual verification names its evidence sources before `ready-for-human-review`:

- **Code surfaces**: occurrence-level residual verification is the unit suite (scenarios 1–7) plus the smoke runbook's deterministic steps; evidence source is `npm test` output and the runbook's recorded results.
- **Fixture seeds (AC12/AC13)**: pattern-completeness is the manifest itself — a committed list of the five new seed IDs with their `harderThan` metadata; evidence source is `tests/fixtures/recall-benchmark/manifest.json` read at review time, checked against the smoke runbook's seed-presence step.
- **Evidence documents (AC8/AC9/AC11)**: residuals are missing rows, not missing code — evidence source is `docs/testing/ronda/sweep-effect-evidence.md` itself; the runbook's evidence-completeness step checks every required field is present and every figure cites its run set. Any figure that cannot be produced (model outage mid-campaign) is recorded as not-run with its reason rather than silently omitted.
- **Real-PR tier (AC15)**: no implementation can complete it by construction — the ten-PR count needs time to accumulate; the residual is a follow-up tracker item (or a note on #105) recording that tier promotion and any comparative claim are deferred until the count exists. Out-of-scope rationale: the spec explicitly gates measurement claims, not building and shipping.
- **Helper outputs**: no shared helper extraction in this plan.
