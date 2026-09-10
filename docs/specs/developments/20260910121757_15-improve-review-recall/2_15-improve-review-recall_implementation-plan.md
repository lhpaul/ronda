# Improve Review Recall - Implementation Plan

**Spec**: [`./1_15-improve-review-recall_specs.md`](./1_15-improve-review-recall_specs.md)
**Smoke test runbook**: [`../../../testing/ronda/improve-review-recall.smoke-test.md`](../../../testing/ronda/improve-review-recall.smoke-test.md)

---

## Summary

**Approach**: Add a committed recall benchmark that replays the eight seeded
defects from issue #15 through Ronda's normal prompt, model, parser, mapping,
summary, and check-run path. Implement a small benchmark runner that reports
found, missed, and false-positive counts by seeded-defect category, then tune
the review prompt and response-normalization rules only as far as needed to
meet the spec's recall and precision bar.

**Estimated complexity**: M

**Rationale**: The code change is narrow, but it touches model-facing prompt
behavior, benchmark tooling, unit/integration tests, smoke documentation, and
security-sensitive output expectations. Real recall evidence also depends on a
live model run, which is operationally slower than ordinary deterministic unit
tests.

**Dependencies**: None.

---

## Verification Log

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `32d8e41` |
| Full revision | `git rev-parse HEAD` | `32d8e4179944c6616261ddee3f73eb43037bfa9b` |
| Review prompt and parsing surfaces | `rg -n "SYSTEM_PROMPT|buildReviewPrompt|parseModelResponse|model.complete|review" src tests docs/testing/ronda README.md docs/adoption` | Key implementation paths are `src/inference/review-prompt.ts`, `src/inference/parse-model-response.ts`, `src/core/run-review-pass.ts`, `src/core/summary.ts`, `tests/unit/inference/parse-model-response.test.ts`, `tests/unit/core/run-review-pass.test.ts`, `tests/integration/review-pass.test.ts`, and `docs/testing/ronda/ronda-v0-github-review.smoke-test.md`. |
| Test and script commands | `sed -n '1,220p' package.json` | Existing commands are `npm run typecheck`, `npm run lint`, `npm test`, and `npm run review`; no recall benchmark command exists yet. |
| Repository architecture | `sed -n '1,260p' docs/project/2-repo-architecture.md` | Ronda is `single_repo`; `src/inference/` owns model-vendor interaction, `src/core/` orchestrates one pass, and tests live under `tests/unit`, `tests/integration`, `tests/support`, and `tests/fixtures`. |
| Data model | `sed -n '1,160p' docs/project/4-database-model.md` | No database exists for v0; review jobs are ephemeral. |
| E2E fixture applicability | `find . -path './.git' -prune -o -path './node_modules' -prune -o -path './.claude/worktrees' -prune -o -name '*e2e*' -o -path './e2e/*' -print` | Only the template placeholder E2E tree exists; no committed product E2E fixture suite needs extension. |

---

## Cross-Cutting Operational Assumption Check

**Result**: Not applicable - this plan does not rely on a mutable environment
target, linked cloud project, external base branch, artifact owner, or canonical
configuration value that another same-window PR can invalidate. Model selection
is runtime configuration and is verified by the benchmark run rather than
encoded as a shared operational assumption.

---

## Layer-by-Layer Changes

### Database / Data Layer

Not applicable. Ronda v0 has no database, and this feature records benchmark
evidence in local output, tests, smoke notes, and GitHub review/check surfaces
only.

### Backend / Review Core

- [ ] Update `src/inference/review-prompt.ts` so the model-facing instructions
      explicitly require independently actionable findings, including multiple
      defects in the same hunk, and call out sensitive-value exposure as a
      Blocking category.
- [ ] Preserve `ChangesTooLargeError` behavior: prompt construction still fails
      instead of silently truncating combined patch text.
- [ ] Keep `src/core/run-review-pass.ts` on the existing injected-dependency
      path. The review pass still builds one prompt, calls the configured model,
      parses findings, maps inline comments, and publishes one review plus one
      check run.
- [ ] If implementation discovers that model output needs additional
      normalization, keep it inside `src/inference/parse-model-response.ts` and
      preserve the existing malformed/coerced/duplicate counters in
      `src/core/summary.ts`.

### Benchmark Tooling

- [ ] Add a benchmark fixture set under `tests/fixtures/recall-benchmark/` with
      the eight seeded defects from issue #15. Each seeded defect needs an id,
      category, expected severity, file path, and description.
- [ ] Add a benchmark runner under `src/cli/recall-benchmark.ts` or a similarly
      scoped CLI entrypoint. It should reuse Ronda's existing prompt/model/parser
      path, compare parsed findings to the seeded-defect manifest, and print a
      deterministic JSON summary with:
      - total seeded defects
      - found seeded defects
      - missed seeded defects
      - false positives
      - model identity
      - reviewed target or fixture identity
      - timestamp
- [ ] Add a package script such as `npm run benchmark:recall` that invokes the
      benchmark runner with the repository's existing TypeScript runtime.
- [ ] The benchmark runner may use a manifest of expected category keywords or
      stable defect ids, but it must not mark a sensitive-value exposure as
      found unless the finding body avoids repeating the sensitive value.

### Tests

- [ ] Add focused unit tests for prompt construction in a new
      `tests/unit/inference/review-prompt.test.ts`, covering the must-find
      sensitive category, multiple independent findings, and unchanged
      too-large-patch behavior.
- [ ] Add benchmark-runner unit tests in a new
      `tests/unit/cli/recall-benchmark.test.ts` or equivalent path. Use injected
      fake model output so deterministic tests can assert found/missed/false
      positive classification without a real API call.
- [ ] Extend `tests/integration/review-pass.test.ts` or add a focused
      integration test that verifies multiple parsed findings from one changed
      file are published through the existing one-review contract.
- [ ] Keep real-model recall proof out of `npm test`; it belongs in the smoke
      runbook because it requires credentials and model behavior.

### Documentation

- [ ] Add the smoke test runbook at
      `docs/testing/ronda/improve-review-recall.smoke-test.md`.
- [ ] Update `README.md` with the benchmark command once the command exists.
- [ ] Update `docs/project/3-software-architecture.md` Testing Strategy to name
      the recall benchmark as a model-dependent smoke/benchmark tier.
- [ ] Update `docs/adoption/ronda-review-adoption.md` only if the implementation
      changes operator-facing configuration or review-command usage; otherwise
      state no adoption-doc change is needed in the implementation PR.

### Infrastructure / Configuration

- [ ] Add only non-secret package script wiring for the benchmark command.
- [ ] Do not commit model credentials, hostnames, account identifiers, benchmark
      result artifacts containing operator-specific data, or local config.

---

## Testing Strategy

**Test types**: Unit, integration, smoke/manual benchmark.

**Key scenarios to test**:

1. Benchmark output reports total, found, missed, false positives, model,
   reviewed target, and timestamp - maps to AC 1 and AC 12.
2. The fixture set includes the eight seeded defects from issue #15 - maps to
   AC 2.
3. Fake model output that covers six seeded categories passes the deterministic
   benchmark threshold - maps to AC 3.
4. Fake model output that repeats the sensitive value does not satisfy the
   sensitive exposure criterion - maps to AC 4.
5. Two independent findings from the same changed file remain distinct through
   the review pass - maps to AC 5 and AC 10.
6. Off-by-one cache capacity and empty-word title-casing seeded defects are
   classifiable by the benchmark manifest - maps to AC 6 and AC 7.
7. False positives are counted separately and fail the no-known-false-positive
   evidence path unless human approval is recorded - maps to AC 8.
8. Two real-model benchmark runs on the same target produce the same
   merge-relevant seeded-defect categories - maps to AC 9.
9. Model-stub tests are accepted only for deterministic tool behavior, not as
   the sole recall evidence - maps to AC 11.

**Smoke test runbook**:
`docs/testing/ronda/improve-review-recall.smoke-test.md`

**Regression suite**: Not applicable. This repository has only the template
placeholder E2E suite, so the implementation PR should extend unit/integration
coverage and the Ronda smoke runbook instead of E2E fixtures.

### Parser-Risk Addendum

This plan is not classified as parser-risk. It does not require regex-heavy
scanning or a new structured-text parser. The benchmark runner compares Ronda's
already-parsed `Finding` objects to a committed manifest and should use
ordinary structured data comparisons. If implementation introduces regex-heavy
matching instead, it must add a parser-risk section before opening the
implementation PR.

### Concurrent-Event-Source Addendum

This plan is not classified as concurrent-event-source. The benchmark runner is
a single foreground command with no new listeners, timers, sockets, queues, or
shared mutable state across execution contexts.

---

## Seed Data

| Entity | Values / Scenario | File |
| --- | --- | --- |
| Recall benchmark manifest | Eight seeded defects from issue #15: expired-session inversion, token/log exposure, cache-capacity off-by-one, SQL interpolation, invalid range parsing, lexicographic numeric sort, lower-element median, and empty-word title casing | `tests/fixtures/recall-benchmark/manifest.json` |
| Recall benchmark patches | Minimal TypeScript changed-file patches that carry the seeded defects and can be passed through `buildReviewPrompt` and `parseModelResponse` tests | `tests/fixtures/recall-benchmark/patches.json` |
| Fake model outputs | Passing, failing, false-positive, and sensitive-value-leaking benchmark responses for deterministic tests | `tests/fixtures/recall-benchmark/model-responses/*.json` |

---

## Documentation Updates

- [ ] `README.md` - document the recall benchmark command and clarify that real
      recall evidence requires a live model credential.
- [ ] `docs/project/3-software-architecture.md` - add the recall benchmark to
      the Testing Strategy as the model-dependent quality tier.
- [ ] `docs/adoption/ronda-review-adoption.md` - update only if implementation
      changes operator-facing command/config behavior; otherwise leave unchanged
      and note why in the implementation PR.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Prompt tuning improves benchmark recall by overfitting to fixture wording | Medium | Medium | Keep seeded defects category-based and require a real-model smoke run, not only fixture assertions. |
| Recall gains increase false positives | Medium | High | Count false positives in benchmark output and require zero known false positives or explicit human approval. |
| Sensitive-value detection repeats the sensitive value in the finding body | Medium | High | Add deterministic tests that fail when the sensitive value appears in the reported finding. |
| Real-model variance makes the smoke result flaky | Medium | Medium | Require two same-head benchmark runs and compare merge-relevant categories rather than exact prose. |
| Benchmark runner drifts from normal review behavior | Low | High | Reuse `buildReviewPrompt`, configured `ModelClient`, `parseModelResponse`, and `Finding` objects instead of creating a separate review path. |

---

## Implementation Order

1. Add the recall benchmark manifest, changed-file patch fixtures, and fake
   model response fixtures under `tests/fixtures/recall-benchmark/`.
2. Add the benchmark runner and package script. Keep it as a local foreground
   command and ensure it prints deterministic JSON summary fields.
3. Add deterministic benchmark-runner tests for found, missed, false-positive,
   sensitive-value-safe, and sensitive-value-leaking cases.
4. Update `src/inference/review-prompt.ts` and prompt-focused tests so Ronda asks
   for multiple independent findings and treats sensitive-value exposure as
   Blocking.
5. Add or extend integration coverage proving multiple findings from one
   changed file remain distinct in the one-review GitHub output contract.
6. Update the listed project docs and keep adoption docs unchanged unless the
   implementation changes operator-facing behavior.
7. Run local verification:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run benchmark:recall` with fake-model fixtures, if the runner supports
     a fixture mode
8. Run the smoke test runbook with a real model credential and record the two
   same-head benchmark results in the implementation PR.
9. Add a changelog fragment under `changelog.d/` using this literal format:
   `- **Improve review recall** (#15): Add a recall benchmark and tune Ronda to catch more seeded defects while preserving the comment-only review contract.`
