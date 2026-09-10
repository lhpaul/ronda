# Review Quality Benchmark Suite - Implementation Plan

**Spec**: [`./1_24-review-quality-benchmark-suite_specs.md`](./1_24-review-quality-benchmark-suite_specs.md)
**Smoke test runbook**: [`../../../testing/ronda/review-quality-benchmark-suite.smoke-test.md`](../../../testing/ronda/review-quality-benchmark-suite.smoke-test.md)

---

## Summary

**Approach**: Extend the existing recall benchmark into a broader quality
evidence harness instead of creating a second benchmark path. Keep the current
prompt/model/parser flow as the source of findings, add fixture metadata for
quality categories and clean precision cases, and add a structured comparison
surface for human-adjudicated second-reviewer evidence and false-clean
candidates.

**Estimated complexity**: L

**Rationale**: The implementation builds on existing benchmark code, but it
adds new fixture categories, precision behavior, comparison/adjudication
records, smoke evidence, documentation, and sensitive-value redaction checks.
Real quality proof also depends on external reviewer timing and real-model
behavior, so the verification path is broader than ordinary unit tests.

**Dependencies**: None. Issue #25 is orthogonal: local execution can make
future quality runs cheaper, but this plan must work with the released
GitHub Actions and local CLI paths.

---

## Verification Log

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `f754f5b` |
| Full revision | `git rev-parse HEAD` | `f754f5bf9ba7bd80c06d9d1d3b5258fcf40b04aa` |
| Verification time | `date -u +%Y-%m-%dT%H:%M:%SZ` | `2026-09-10T17:51:03Z` |
| Existing benchmark command | `sed -n '1,80p' package.json` | `benchmark:recall` already runs `tsx src/cli/recall-benchmark.ts`. |
| Existing benchmark runner | `sed -n '1,280p' src/cli/recall-benchmark.ts` | `runRecallBenchmark` reuses `buildReviewPrompt`, `ModelClient`, and `parseModelResponse`; `classifyFindings` reports found, missed, false positives, model, target, and timestamp. |
| Existing benchmark tests | `sed -n '1,260p' tests/unit/cli/recall-benchmark.test.ts` | Unit tests already cover found/missed/false-positive classification and sensitive-value matching safety. |
| Existing benchmark manifest | `sed -n '1,260p' tests/fixtures/recall-benchmark/manifest.json` | Manifest currently contains 8 seeded defects under `issue-15-recall-benchmark`. |
| Existing smoke runbook | `sed -n '1,220p' docs/testing/ronda/improve-review-recall.smoke-test.md` | Existing smoke covers real-model recall and same-head variance, but not precision fixtures or second-reviewer false-clean evidence. |
| Architecture docs | `sed -n '1,240p' docs/project/2-repo-architecture.md` and `sed -n '1,240p' docs/project/3-software-architecture.md` | Ronda is `single_repo`; review core and benchmark tooling are TypeScript/Node 20; no browser UI or committed product E2E suite applies. |
| Data model | `sed -n '1,180p' docs/project/4-database-model.md` | No database exists for v0; evidence should stay in local output, docs, tests, PR comments, or GitHub surfaces. |
| Related work | `./scripts/development-workflow/spec-dispatch-context.sh --selected 24 --items 24,25 --json` | Issue #25 was classified `Orthogonal`; shared words do not create a dependency. |

---

## Cross-Cutting Operational Assumption Check

**Result**: Not applicable - this plan does not rely on a mutable environment
target, linked cloud project, external base branch, selected product
repository, or canonical configuration value that a same-window PR can
invalidate. External reviewer availability is runtime smoke evidence, not a
plan-time operational assumption.

---

## Layer-by-Layer Changes

### Database / Data Layer

Not applicable. Ronda v0 has no product database, and this feature should not
add one. Quality evidence remains local command output, committed fixtures,
tests, smoke notes, and PR comments.

### Benchmark Tooling

- [ ] Extend `src/cli/recall-benchmark.ts` rather than adding a parallel
      benchmark runner.
- [ ] Introduce a broader quality benchmark summary that can report seeded
      recall, missed categories, false positives, model identity, reviewed
      target, timestamp, same-head run grouping, precision fixture results, and
      second-reviewer comparison counts.
- [ ] Keep the existing `benchmark:recall` command working for backward
      compatibility. If a broader command name is added, make it share the same
      core functions instead of duplicating model/prompt/parser behavior.
- [ ] Add structured comparison support for same-repository, same-PR, same-head
      evidence. A comparison record must identify Ronda output, other-reviewer
      output, reviewer name, and human adjudication outcome.
- [ ] Represent mismatch outcomes with the spec's display states:
      `Ronda miss`, `Ronda better signal`, `Duplicate finding`,
      `Clean agreement`, and `Unclear`.
- [ ] Add a false-clean candidate result when Ronda reported clean and a
      human-adjudicated second opinion found an external-only actionable issue.
- [ ] Preserve sensitive-value safety: no evidence output may include fixture
      `forbiddenValue` strings or real credential/token values.

### Fixtures / Seed Data

- [ ] Extend `tests/fixtures/recall-benchmark/manifest.json` or split it into
      compatible quality fixture manifests that include the spec-required
      categories: security, authorization, data-loss, async or race,
      configuration, stale-SHA, sorting, text-normalization, and multi-finding
      review scenarios.
- [ ] Add at least one precision fixture where the expected Ronda outcome is
      clean.
- [ ] Add deterministic fixture response files under
      `tests/fixtures/recall-benchmark/model-responses/` for:
      - broad quality pass
      - missed seeded category
      - false-positive/noisy finding
      - clean precision result
      - noisy precision result
      - same-head variance comparison
      - second-reviewer clean agreement
      - false-clean candidate
- [ ] Use fake values that are visibly synthetic for any sensitive fixture
      material. Do not use real credentials or operator-specific identifiers.

### Review Core

- [ ] Keep `src/core/run-review-pass.ts` behavior unchanged unless tests reveal
      an existing output-contract bug. Ronda still publishes one pull-request
      review and one terminal check run per pass.
- [ ] Keep prompt construction in `src/inference/review-prompt.ts` and response
      parsing in `src/inference/parse-model-response.ts` as the only
      model-facing path used by the benchmark.
- [ ] If new quality fixture categories expose prompt or parser gaps, update the
      prompt/parser with focused tests and preserve existing summary counters.

### Tests

- [ ] Extend `tests/unit/cli/recall-benchmark.test.ts` or add
      `tests/unit/cli/review-quality-benchmark.test.ts` for the broader
      quality summary.
- [ ] Add tests that prove seeded category reporting, precision clean results,
      false positives, redaction of forbidden values, same-head variance
      recording, second-reviewer clean agreement, and false-clean candidate
      classification.
- [ ] Add or extend integration coverage only if the implementation changes the
      existing review pass or GitHub output contract. Otherwise cite existing
      `tests/integration/review-pass.test.ts` coverage in the implementation PR.
- [ ] Keep real-model and real second-reviewer checks out of `npm test`; they
      belong in the smoke runbook because they require credentials and external
      services.

### Documentation

- [ ] Update `README.md` with the quality benchmark or comparison command once
      the command surface exists.
- [ ] Update `docs/project/3-software-architecture.md` Testing Strategy to
      describe review quality evidence as recall, precision, comparison, and
      false-clean measurement.
- [ ] Add or update the Ronda smoke runbook at
      `docs/testing/ronda/review-quality-benchmark-suite.smoke-test.md`.
- [ ] Update `docs/adoption/ronda-review-adoption.md` only if implementation
      changes operator-facing adoption workflow or configuration.

### Infrastructure / Configuration

- [ ] Add only non-secret package-script wiring if a new command is introduced.
- [ ] Do not commit API keys, local config, reviewer account IDs, tunnel URLs,
      hostnames, or raw external-review artifacts containing operator-specific
      data.

---

## Testing Strategy

**Test types**: Unit, integration-if-needed, smoke/manual real-model and
second-reviewer evidence.

**Key scenarios to test**:

1. Broad seeded benchmark reports category coverage, found seeded defects,
   missed seeded defects, false positives, model identity, reviewed target, and
   timestamp - maps to AC1 and AC2.
2. Precision fixture returns clean and noisy precision fixture reports a
   false-positive candidate - maps to AC3.
3. Sensitive fixture output is redacted and any finding that repeats a
   forbidden value fails the sensitive evidence path - maps to AC4.
4. Same-head repeated runs record variance evidence for the same model and
   configuration - maps to AC5.
5. Second-reviewer comparison stores same repository, pull request, and head
   identity for Ronda and the comparison reviewer - maps to AC6.
6. Mismatch adjudication supports Ronda miss, Ronda better signal, duplicate
   finding, clean agreement, and unclear - maps to AC7.
7. Ronda-clean plus external-only actionable issue produces a false-clean
   candidate - maps to AC8.
8. Confirmed Ronda misses preserve enough source comparison evidence to become
   future seeded fixtures - maps to AC9.
9. Existing Ronda review/check-run/draft-skip/manual-trigger/no-mutation
   behavior remains unchanged - maps to AC10.

**Smoke test runbook**:
`docs/testing/ronda/review-quality-benchmark-suite.smoke-test.md`

**Regression suite**: Not applicable. This repository has only the template
placeholder E2E suite, so implementation should use unit/integration coverage
plus Ronda smoke evidence.

### Parser-Risk Addendum

This plan is not classified as parser-risk. The implementation should compare
already-parsed `Finding` objects and structured fixture/comparison records, not
add regex-heavy scanning or a custom parser. If the implementation introduces
regex-heavy parsing of reviewer prose, the implementer must add parser-risk
edge-case enumeration and unit-test mapping before opening the implementation
PR.

### Concurrent-Event-Source Addendum

This plan is not classified as concurrent-event-source. The benchmark and
comparison flows are foreground commands over structured inputs and do not add
listeners, socket callbacks, timers, queues, or shared mutable state across
execution contexts.

---

## Seed Data

| Entity | Values / Scenario | File |
| --- | --- | --- |
| Quality benchmark manifest | Seeded defects for security, authorization, data-loss, async/race, configuration, stale-SHA, sorting, text-normalization, and multi-finding review cases | `tests/fixtures/recall-benchmark/manifest.json` or compatible quality manifest files under `tests/fixtures/recall-benchmark/` |
| Precision fixture | A changed-file fixture that should produce no Ronda findings | `tests/fixtures/recall-benchmark/patches.json` or a dedicated precision fixture file |
| Fake model outputs | Passing, missed-category, false-positive, precision-clean, precision-noisy, variance, clean-agreement, and false-clean fixture responses | `tests/fixtures/recall-benchmark/model-responses/*.json` |
| Comparison records | Same-head Ronda and second-reviewer examples for all mismatch statuses | `tests/fixtures/recall-benchmark/comparisons/*.json` or an equivalent structured fixture directory |

---

## Documentation Updates

- [ ] `README.md` - document the quality benchmark/comparison command and state
      which evidence requires a real model or external reviewer.
- [ ] `docs/project/3-software-architecture.md` - update Testing Strategy to
      include recall, precision, second-reviewer comparison, and false-clean
      measurement.
- [ ] `docs/testing/ronda/review-quality-benchmark-suite.smoke-test.md` -
      implement the smoke runbook from this plan.
- [ ] `docs/adoption/ronda-review-adoption.md` - update only if operator-facing
      setup or adoption commands change.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| The benchmark overfits to the current fixture wording. | Medium | Medium | Keep categories and comparison outcomes explicit, then promote real confirmed misses into future fixtures. |
| Second-reviewer output is treated as truth when it is noisy. | Medium | High | Require human adjudication before external-only findings count as Ronda misses. |
| Quality evidence leaks synthetic or real sensitive values. | Low | High | Preserve `forbiddenValue` checks and add tests that fail when forbidden values appear in evidence output. |
| External reviewer timing makes smoke tests flaky. | Medium | Medium | Smoke runbook records trigger time, head SHA, timeout behavior, and accepts operator-recorded reviewer output when direct trigger is unavailable. |
| The broader benchmark drifts away from normal Ronda review behavior. | Low | High | Reuse `buildReviewPrompt`, configured `ModelClient`, `parseModelResponse`, and `Finding` objects as the shared path. |
| Adding quality commands accidentally changes GitHub review output. | Low | High | Keep review core unchanged by default and rerun existing v0 smoke or cite current review-pass integration evidence. |

---

## Implementation Order

1. Extend the benchmark data model in `src/cli/recall-benchmark.ts` with
   structured quality evidence fields, while preserving the current recall
   summary shape or providing a backward-compatible path for `benchmark:recall`.
2. Add or update fixture manifests, patch fixtures, precision cases, fake model
   responses, and comparison records under `tests/fixtures/recall-benchmark/`.
3. Add deterministic unit tests for seeded category reporting, precision clean
   and noisy cases, redaction, same-head variance evidence, comparison
   classifications, and false-clean candidate detection.
4. Add command wiring in `package.json` only if a new operator command is needed;
   keep `npm run benchmark:recall` working.
5. Update prompt/parser behavior only if the new fixtures expose a specific
   review-quality gap; keep those changes covered by focused unit tests.
6. Update `README.md` and `docs/project/3-software-architecture.md`; update
   `docs/adoption/ronda-review-adoption.md` only if setup behavior changes.
7. Run local verification:
   - `npm run typecheck`
   - `npm run lint`
   - `npm test`
   - `npm run benchmark:recall -- --response-file tests/fixtures/recall-benchmark/model-responses/passing.json`
8. Run the smoke test runbook with a real model credential and at least one
   same-head second-reviewer comparison. Record the commands, model, reviewed
   target, head SHA, reviewer result, and adjudication outcome in the
   implementation PR.
9. Add a changelog fragment under `changelog.d/` using this literal format:
   `- **Improve review quality benchmark suite** (#24): Extend Ronda quality evidence with precision fixtures, second-reviewer comparison, and false-clean tracking.`
