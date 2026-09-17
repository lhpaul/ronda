# Feed Architecture and Operating Docs into Ronda Reviews — Implementation Plan

**Spec**:
[1_55-feed-architecture-docs-into-reviews_specs.md](./1_55-feed-architecture-docs-into-reviews_specs.md)
**Smoke test runbook**:
[55-feed-architecture-docs-into-reviews.smoke-test.md](../../../testing/ronda/55-feed-architecture-docs-into-reviews.smoke-test.md)

---

## Summary

**Approach**: Add deterministic **pre-model** selection of a bounded set of
authoritative repository documents at the reviewed commit, then extend prompt
construction so the model receives the diff plus labeled **binding** or
**advisory** doc excerpts. Selection is **two-phase**: pure path/surface
relevance against a versioned in-repo catalog (constitution, architecture,
adoption/operator, review contract), then fetch at `headSha` and apply
operator count/char budgets — not keyword overlap alone. GitHub file content
is read through a new REST helper; missing, empty, truncated, or unreadable
catalog entries are skipped with structured log evidence. Operator limits
(`maxAuthoritativeDocCount`, `maxAuthoritativeDocChars`) apply in addition to
the existing `maxPatchChars` diff budget.

**Estimated complexity**: M

**Rationale**: Touches configuration, GitHub reads, pure selection logic, prompt
budget semantics, orchestration in `runReviewPass`, logging, adoption docs, and
focused unit/integration tests — without changing publication or
comment-only boundaries.

**Dependencies**: None blocking. Epic **#52** sibling items (#56 recall
reporting, external capture) remain orthogonal (spec Out of Scope).

---

## Verification Log

| Check | Command / query | Result |
| --- | --- | --- |
| Repo revision | `git rev-parse --short HEAD` | `0496c71` on plan branch from `origin/develop` |
| Spec present | `test -f docs/specs/developments/20260917082046_55-feed-architecture-docs-into-reviews/1_55-feed-architecture-docs-into-reviews_specs.md` | Present |
| Diff-only prompt today | `sed -n '42,65p' src/inference/review-prompt.ts` | Title, body, patches only; `ChangesTooLargeError` on patch budget |
| Pass orchestration | `sed -n '157,169p' src/core/run-review-pass.ts` | `readChangedFiles` → `buildReviewPrompt` → model |
| Config surface | `sed -n '7,12p' src/config/config.types.ts`; `DEFAULT_MAX_PATCH_CHARS` in `load-config.ts` | Only `maxPatchChars`; no doc limits yet |
| GitHub content API | `rg -n 'getContent|repos\.getContent' src` | No repo file reader yet — new surface |
| Catalog doc paths | `test -f docs/constitution.md && test -f docs/project/3-software-architecture.md && test -f docs/adoption/ronda-review-adoption.md && test -f REVIEW.md` | All exist at plan time |
| Webhook / reviewer paths | `ls src/webhook src/github/review-publisher.ts src/github/check-run-publisher.ts` | Governed surfaces present |

---

## Cross-Cutting Operational Assumption Check

### Applicable

| Assumption surface | Recorded value | Authoritative source | Verified at | Bounded cross-check scope | Result |
| --- | --- | --- | --- | --- | --- |
| Approved base branch | `develop` | Handoff `APPROVED_BASE`; batch policy | 2026-09-17, SHA `0496c71` | Batch items **#54–#66** (same window) | `Verified` |
| Authoritative doc paths stable for MVP | Fixed catalog paths at reviewed commit | Spec Assumptions; Verification Log | 2026-09-17 | No open plan PR moves catalog paths | `Verified` |
| Diff budget unchanged | `maxPatchChars` still enforced independently | Spec AC 9; `review-prompt.ts` | 2026-09-17 | **#15** recall prompt work (merged) | **Orthogonal** — recall tuning does not remove patch budget |
| Review publication contract | One review + one check run; comment-only | Constitution; `run-review-pass.ts` | 2026-09-17 | **#64** local-finding summary (workflow shell) | **Orthogonal** — different repo layer (`src/` vs `pr-review-loop.sh`) |

**Overall result**: `Applicable` — **no `Conflict`**.

### Not applicable

No product-repository selector, cloud deployment target, or database layer.

---

## Architecture

### Decision 1 — Catalog and two-phase selection (pure + budget)

Authoritative-doc handling is **two phases** so relevance stays unit-testable
without GitHub, while char budgets use real fetched text (no guessing sizes):

1. **Relevance (pure)** —
   `selectAuthoritativeDocCandidates(changedPaths, catalog) → CandidateResult`
   returns ordered candidates and `skipped[]` with reason `not_relevant` for
   non-matching catalog entries. Deterministic sort: `priority` asc, then
   `path` asc. Dedupe by catalog `id` only (same entry never appears twice;
   there is **no** `duplicate_surface` skip reason).
2. **Fetch + budget (orchestration / thin helper)** —
   After fetching candidate texts at `headSha`, call
   `applyAuthoritativeDocBudgets(candidatesWithText, limits) → SelectionResult`
   which walks candidates in that stable order, keeps docs while
   `selected.length < maxAuthoritativeDocCount` and
   `runningChars + text.length <= maxAuthoritativeDocChars`, and records
   skips with `over_doc_count`, `over_doc_chars`, `unreadable` (fetch returned
   `undefined`), or `empty` (decoded text length `0`). Never partial-truncate
   a doc body; a single doc larger than the char budget alone is skipped with
   `over_doc_chars` and evidence (spec Business Rules).

Both helpers live in **`src/core/select-authoritative-docs.ts`**.
`runReviewPass` must not apply char limits before fetch.

- **`src/domain/authoritative-doc-catalog.ts`**: Exported catalog entries:
  `id`, `path`, `role: "binding" | "advisory"`, `priority` (lower = higher
  precedence), and `surfaces: AuthoritativeDocSurface[]`.

**Surface match rules** (testable, no NLP) — a *changed path* activates a
surface when:

| Surface id | Material when any changed path… |
| --- | --- |
| `webhook_ingress` | equals or starts with `src/webhook/` |
| `review_publication` | is under `src/github/` and basename is `review-publisher.ts`, `check-run-publisher.ts`, or `pull-request-reader.ts`; or equals `src/core/run-review-pass.ts` |
| `review_inference` | equals or starts with `src/inference/` |
| `operator_config` | equals or starts with `src/config/` |
| `workflow_review_contract` | equals `REVIEW.md` or starts with `docs/workflow/` and path contains `review` |

**Default catalog → surfaces** (MVP — all four share the full governed gate so
any material surface selects the minimum catalog set, then priority + budgets
trim):

| Catalog path | `role` | `priority` | `surfaces` |
| --- | --- | --- | --- |
| `docs/constitution.md` | binding | `10` | all five surfaces above |
| `REVIEW.md` | binding | `20` | all five surfaces above |
| `docs/project/3-software-architecture.md` | advisory | `30` | all five surfaces above |
| `docs/adoption/ronda-review-adoption.md` | advisory | `40` | all five surfaces above |

A catalog entry is a **candidate** when any of its `surfaces` is activated by
the change set. **No candidate** → diff-only pass (Use Case 3). Narrower
per-doc surface lists are out of scope for MVP; changing the table above is a
follow-up catalog maintenance change.

### Decision 2 — Fetch doc bytes at `headSha`, not from PR files API

Add `readRepositoryFileAtRef(octokit, owner, repo, path, ref, signal)` in
`src/github/repo-content-reader.ts` using `repos.getContent` (base64 decode of
a **file** payload). Wire through **`GithubOperations`** as `readFileAtRef`
(used via `ReviewPassDeps.github`). Behavior:

- HTTP 404 / missing → `undefined` (skip `unreadable`).
- Unexpected payload shape (directory array, non-file, missing `content`) →
  `undefined` (skip `unreadable`); do not throw.
- GitHub “truncated” large-file responses → treat as `unreadable` (skip with
  evidence); do not silently use partial content as if complete.
- Respect abort signal via existing `withAbortMapping` (same pattern as
  `pull-request-reader.ts`).
- Pass continues when content is missing (AC 7).

### Decision 3 — Budget semantics

- **`maxPatchChars`**: unchanged — combined **patch** text only.
- **`maxAuthoritativeDocCount`** (default `4`) and **`maxAuthoritativeDocChars`**
  (default `120_000`): apply only in **phase 2** to **decoded doc text**
  included in the user prompt (after fetch).
- Enforcement mechanism for “never exceed caps”: `applyAuthoritativeDocBudgets`
  rejects candidates that would breach count or running char total (guard
  clauses above); `buildReviewPrompt` double-checks and throws
  `AuthoritativeDocsTooLargeError` only if a caller bypasses that helper.
- Optional env/file config keys mirror `maxPatchChars` naming:
  `RONDA_MAX_AUTHORITATIVE_DOC_COUNT`, `RONDA_MAX_AUTHORITATIVE_DOC_CHARS`, and
  operator file fields `maxAuthoritativeDocCount`, `maxAuthoritativeDocChars`.
- Update **load-failure fallback** objects in `src/cli/review-pr.ts` and
  `src/webhook/webhook-job.ts` (today hardcode only `maxPatchChars`) to include
  the same doc-limit defaults so `RondaConfig` stays complete when
  `loadConfig` fails.

### Decision 4 — Prompt shape

Extend `buildReviewPrompt` input with optional `authoritativeDocs: { id, path, role, text }[]`.
User message sections after the diff:

```markdown
## Authoritative repository documentation (binding)
Each excerpt is a product or review constraint. Do not recommend changes that violate these rules.

### [binding] docs/constitution.md
...

## Authoritative repository documentation (advisory)
Use for context; prefer explicit diff evidence when they disagree.

### [advisory] docs/project/3-software-architecture.md
...
```

Selection logic and prompt builder share the same `role` labels (AC 4). Omit
both section headers entirely when `authoritativeDocs` is empty or absent
(Use Case 3 / AC 2 — no empty scaffolding).

### Decision 5 — Logging and operator visibility

`deps.logger.event` entries (no secrets, no full doc bodies):

- `authoritative_docs_selection` — `selectedIds`, `skipped` summary, char total
- Per skipped file: `authoritative_doc_skipped` — `id`, `path`, `reason`
  (`not_relevant` | `over_doc_count` | `over_doc_chars` | `unreadable` | `empty`)
---

## Layer-by-Layer Changes

### Database / Data Layer

Not applicable.

### Backend / Review Core

- [ ] **`src/domain/authoritative-doc-catalog.ts`**: Default catalog per Decision 1
      table (all four entries; each lists all five surfaces; priorities 10/20/30/40).
- [ ] **`src/core/select-authoritative-docs.ts`**:
      `selectAuthoritativeDocCandidates` + `applyAuthoritativeDocBudgets`;
      skip reasons `not_relevant` | `over_doc_count` | `over_doc_chars` |
      `unreadable` | `empty`; deterministic sort: priority asc, then `path` asc.
- [ ] **`src/github/repo-content-reader.ts`**: Base64 decode file payloads; map
      404, non-file/directory array, and truncated responses to `undefined`;
      respect abort signal via existing `withAbortMapping`.
- [ ] **`src/domain/review-pass.types.ts`**: Extend **`GithubOperations`** with
      `readFileAtRef(owner, repo, path, ref, signal?) => Promise<string | undefined>`
      (consumed via `ReviewPassDeps.github`).
- [ ] **`src/cli/review-pr.ts`** and **`src/webhook/webhook-job.ts`**: Wire
      `readFileAtRef` on the concrete `GithubOperations` object; extend
      load-failure fallback `RondaConfig` literals with doc-limit defaults.
- [ ] **`src/core/run-review-pass.ts`**: After `readChangedFiles`, build changed
      path list from `path` and `previousPath` when present → phase-1 candidates
      → fetch each candidate at `pr.headSha` via `readFileAtRef` → phase-2
      budgets → `buildReviewPrompt` with selected docs → log selection/skips.
- [ ] **`src/inference/review-prompt.ts`**: Extend `BuildReviewPromptInput`;
      omit doc section headers when no docs; throw
      `AuthoritativeDocsTooLargeError` only if caller passes docs that already
      exceed budget (phase-2 should prevent this; builder double-checks).
- [ ] **`src/config/config.types.ts`** + **`load-config.ts`**: New limits with
      defaults; document in operator file schema comment.

### Tests

- [ ] **`tests/unit/core/select-authoritative-docs.test.ts`**: Webhook path change
      yields all four catalog candidates (constitution highest priority);
      utility-only change yields none; phase-2 over-count and over-char drops
      with stable skip reasons; empty/`undefined` text → `empty`/`unreadable`;
      repeatability (two phase-1 calls → identical candidate ids/order).
- [ ] **`tests/unit/inference/review-prompt.test.ts`**: Binding/advisory sections
      appear with labels; no doc headers when docs empty; patch-only budget
      unchanged when docs empty.
- [ ] **`tests/unit/github/repo-content-reader.test.ts`**: Decode success; 404 →
      undefined; directory/array payload → undefined (mock octokit).
- [ ] **`tests/unit/core/run-review-pass.test.ts`**: Inject fake
      `readFileAtRef`; assert logger events and prompt receives docs for webhook
      fixture changed files; assert diff-only when paths irrelevant; assert
      pass continues when one catalog path returns `undefined`.
- [ ] **`tests/integration/review-pass.test.ts`**: Extend fake GitHub deps with
      catalog file contents; no live model for selection assertions.

### Documentation Updates (post-implementation — listed for developer)

- [ ] `docs/adoption/ronda-review-adoption.md` — document new config keys and
      selection behavior for operators.
- [ ] `docs/project/3-software-architecture.md` — module layout for catalog,
      selection, and repo content reader.
- [ ] `AGENTS.md` — optional one-liner under the existing Ronda troubleshooting
      table if operators hit frequent doc-fetch skips; omit from the
      implementation PR when no new failure mode needs documenting.

---

## Testing Strategy

**Test types**: Unit (selection, prompt, reader), integration (orchestration with
injected deps), smoke (operator-visible selection on a real PR).

**Key scenarios**:

1. Webhook file change → phase-1 candidates include constitution + other catalog
   docs; after budgets, prompt includes binding constitution (AC 1, 8).
2. Test-only utility change → no doc sections (AC 2, 8).
3. Config caps → phase-2 skipped docs with `over_doc_count` / `over_doc_chars`
   (AC 3, 5).
4. Binding vs advisory labels in prompt text (AC 4).
5. Missing/empty file at ref → pass completes; skip `unreadable`/`empty` (AC 7).
6. Same paths + catalog + limits → identical selection across two runs (AC 6).
7. Patch over `maxPatchChars` still throws `ChangesTooLargeError`; publication
   remains comment-only (AC 9).

**Smoke test runbook**:
`docs/testing/ronda/55-feed-architecture-docs-into-reviews.smoke-test.md`

**Regression suite**: Not applicable — no Playwright product regression suite for
Ronda core.

---

## Seed Data

| Entity | Values / Scenario | File |
| --- | --- | --- |
| Changed files (webhook) | `src/webhook/webhook-server.ts` modified | Unit test fixtures inline |
| Changed files (diff-only) | `tests/fixtures/...` or `src/domain/severity.ts` only | Unit test fixtures inline |
| Fake catalog content | Short markdown strings without secrets | `tests/support/fake-authoritative-docs.ts` (new) |

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Prompt size spikes on large architecture doc | Med | Med | Char budget + priority drops; defaults conservative |
| False-positive doc attachment from broad paths | Low | Med | Prefix/surface rules; tests for negative cases |
| GitHub API rate/latency for extra reads | Med | Low | Fetch only selected paths; share deadline signal |
| Secrets echoed from docs into findings | Low | High | Existing model instructions + smoke check; no doc bodies in GitHub summary |

---

## Implementation Order

1. Add catalog types and default catalog module (Decision 1 table).
2. Implement pure `selectAuthoritativeDocCandidates` +
   `applyAuthoritativeDocBudgets` with unit tests (no GitHub for phase 1;
   in-memory strings for phase 2).
3. Add config fields and load-config tests (including defaults).
4. Implement `repo-content-reader` with unit tests (404 / non-file / success).
5. Extend `GithubOperations` and wire `readFileAtRef` in CLI + webhook job;
   update load-failure fallback configs with doc limits.
6. Extend `buildReviewPrompt` + unit tests (labels; empty → no headers).
7. Integrate two-phase flow into `runReviewPass` with logging; extend
   run-review-pass unit tests.
8. Extend integration test fake GitHub layer.
9. Update adoption + architecture docs per **Documentation Updates**
   (`AGENTS.md` only if needed).
10. Execute smoke runbook (may use `LOCAL_AI_REVIEWER_DISABLED=1` on workflow PR
    loop; core feature verified via unit tests + log inspection on `npm run review`
    when credentials available).
11. Add `changelog.d/55.feature.feed-architecture-docs-into-reviews.md` fragment:

    ```markdown
    - **Feed authoritative docs into review passes** (#55): Ronda selectively attaches bounded constitution, architecture, adoption, and review-contract excerpts to governed changes with binding versus advisory labels and operator doc budgets.
    ```

---

## Files to Modify (implementation PR)

| Path | Change |
| --- | --- |
| `src/domain/authoritative-doc-catalog.ts` | New |
| `src/core/select-authoritative-docs.ts` | New |
| `src/github/repo-content-reader.ts` | New |
| `src/domain/review-pass.types.ts` | Extend `GithubOperations` with `readFileAtRef` |
| `src/core/run-review-pass.ts` | Phase-1 → fetch → phase-2 → prompt + logs |
| `src/inference/review-prompt.ts` | Doc sections + types |
| `src/config/config.types.ts` | Doc limit fields |
| `src/config/load-config.ts` | Load doc limits |
| `src/cli/review-pr.ts` | Wire `readFileAtRef`; fallback config defaults |
| `src/webhook/webhook-job.ts` | Wire `readFileAtRef`; fallback config defaults |
| `tests/unit/core/select-authoritative-docs.test.ts` | New |
| `tests/unit/github/repo-content-reader.test.ts` | New |
| `tests/support/fake-authoritative-docs.ts` | New |
| `tests/unit/inference/review-prompt.test.ts` | Extend |
| `tests/unit/core/run-review-pass.test.ts` | Extend |
| `tests/integration/review-pass.test.ts` | Extend |
| `docs/adoption/ronda-review-adoption.md` | Operator docs |
| `docs/project/3-software-architecture.md` | Module list |
| `changelog.d/55.feature.feed-architecture-docs-into-reviews.md` | Fragment |

Plan and smoke runbook only in this PR:

- `docs/specs/developments/20260917082046_55-feed-architecture-docs-into-reviews/2_55-feed-architecture-docs-into-reviews_implementation-plan.md`
- `docs/testing/ronda/55-feed-architecture-docs-into-reviews.smoke-test.md`
