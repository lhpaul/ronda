# Smoke Test Runbook: Feed Architecture Docs into Ronda Reviews

**Feature**: Bounded authoritative documentation in Ronda review passes
**Spec**:
[`../../specs/developments/20260917082046_55-feed-architecture-docs-into-reviews/1_55-feed-architecture-docs-into-reviews_specs.md`](../../specs/developments/20260917082046_55-feed-architecture-docs-into-reviews/1_55-feed-architecture-docs-into-reviews_specs.md)
**Implementation plan**:
[`../../specs/developments/20260917082046_55-feed-architecture-docs-into-reviews/2_55-feed-architecture-docs-into-reviews_implementation-plan.md`](../../specs/developments/20260917082046_55-feed-architecture-docs-into-reviews/2_55-feed-architecture-docs-into-reviews_implementation-plan.md)
**Created in**: Plan Ready stage

> **No design assets.** Workflow/backend feature only.

---

## Prerequisites

- [ ] Implementation branch checked out; `npm ci` at repository root.
- [ ] `npm test` passes (selection and prompt tests cover AC without live model).
- [ ] For optional live pass verification: `RONDA_MODEL_API_KEY` and
      `GITHUB_TOKEN` with `contents: read` and PR write on the target repo.
- [ ] `gh` authenticated.

---

## Scenario A — Governed change selects docs (AC 1, 3, 4, 6)

**Goal**: A PR touching webhook ingress causes authoritative docs to be selected
within configured limits, with binding/advisory labels in the model prompt (verified
via tests or debug logging).

1. Run unit selection tests:

   ```bash
   npm test -- tests/unit/core/select-authoritative-docs.test.ts
   ```

2. Confirm output includes a case where `src/webhook/webhook-server.ts` (or
   equivalent) yields constitution first among candidates and the other three
   catalog docs as candidates before budget trimming.

3. Run prompt test:

   ```bash
   npm test -- tests/unit/inference/review-prompt.test.ts
   ```

4. Confirm prompt output contains distinct **binding** and **advisory** section
   headers when fixture docs are supplied.

5. Run the same selection unit test twice in one invocation; confirm identical
   selected id ordering (determinism).

**Pass**: Tests green; binding/advisory sections present in prompt fixtures.

---

## Scenario B — Diff-only pass (AC 2)

1. Run selection tests and locate the case for non-governed paths only (e.g.
   a single test fixture file change).

2. Confirm selected doc count is zero.

**Pass**: No authoritative doc sections required in prompt for that fixture.

---

## Scenario C — Budget caps (AC 3, 5)

1. Run selection tests that set `maxAuthoritativeDocCount` or
   `maxAuthoritativeDocChars` below the candidate set size (phase-2 helper).

2. Confirm skipped entries include documented reasons (`over_doc_count` or
   `over_doc_chars`) and higher-priority docs remain selected.

**Pass**: Skip reasons and priority behavior match plan Decision 1 phase 2 /
Decision 3.

---

## Scenario D — Missing or empty catalog file (AC 7)

1. Run unit tests for `repo-content-reader` and run-review-pass with
   `readFileAtRef` returning `undefined` for one catalog path, and a fixture
   with empty string content for another.

2. Confirm pass outcome is still success (or normal review failure unrelated to
   docs) and logs reference skip reasons `unreadable` and/or `empty`.

**Pass**: No throw solely due to missing or empty doc content.

---

## Scenario E — Optional live review (operator)

Skip when credentials are unavailable.

1. Open or use a sandbox PR that modifies a file under `src/webhook/`.

2. Run:

   ```bash
   npm run review
   ```

   with standard GitHub event env vars for that PR (see
   `docs/adoption/ronda-review-adoption.md`).

3. Inspect structured logs for `authoritative_docs_selection` and confirm
   `selectedIds` is non-empty for the webhook change.

4. Confirm a GitHub review and check run still publish (comment-only contract;
   AC 9 publication half).

**Pass**: Log shows selected docs; review/check run complete.

---

## Scenario F — Secrets not quoted from docs (AC 10)

1. Use test fixtures where fake doc text contains a placeholder token string.

2. Confirm system prompt still instructs the model not to repeat sensitive values
   (existing `review-prompt.ts` rule unchanged).

3. If running Scenario E, spot-check the published review body does not paste
   catalog doc credentials.

**Pass**: No doc-sourced secrets in published review text.

---

## Scenario G — Diff budget still independent (AC 9)

1. Run existing or extended `review-prompt` unit tests confirming oversized
   **patch** text still throws `ChangesTooLargeError` even when authoritative
   docs are absent or within budget.

**Pass**: Doc budgets do not relax or replace `maxPatchChars`.

---

## Sign-off

| Scenario | Result (Pass/Fail/Skip) | Notes |
| --- | --- | --- |
| A | | |
| B | | |
| C | | |
| D | | |
| E | | |
| F | | |
| G | | |
