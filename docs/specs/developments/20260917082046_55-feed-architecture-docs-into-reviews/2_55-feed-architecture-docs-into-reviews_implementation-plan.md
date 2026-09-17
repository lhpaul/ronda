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
**advisory** doc excerpts. Selection keys off changed paths and a versioned
in-repo catalog (constitution, architecture, adoption/operator, review contract)
— not keyword overlap alone. GitHub file content is read at `headSha` through
the existing REST client; missing or unreadable catalog entries are skipped with
structured log evidence. Operator limits (`maxAuthoritativeDocCount`,
`maxAuthoritativeDocChars`) apply in addition to the existing
`maxPatchChars` diff budget.

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

### Decision 1 — Catalog and selection stay pure and testable

- **`src/domain/authoritative-doc-catalog.ts`**: Exported catalog entries:
  `id`, `path`, `role: "binding" | "advisory"`, `priority` (lower = higher
  precedence), and `surfaces: AuthoritativeDocSurface[]`.
- **`src/core/select-authoritative-docs.ts`**: Pure function
  `selectAuthoritativeDocs(changedPaths, catalog, limits) → SelectionResult`
  with stable ordering, explicit `selected[]` and `skipped[]` reasons
  (`not_relevant`, `over_doc_count`, `over_doc_chars`, `duplicate_surface`).

**Surface match rules** (testable, no NLP):

| Surface id | Material when any changed path… |
| --- | --- |
| `webhook_ingress` | equals or starts with `src/webhook/` |
| `review_publication` | is under `src/github/` and basename is `review-publisher.ts`, `check-run-publisher.ts`, or `pull-request-reader.ts`; or equals `src/core/run-review-pass.ts` |
| `review_inference` | equals or starts with `src/inference/` |
| `operator_config` | equals or starts with `src/config/` |
| `workflow_review_contract` | equals `REVIEW.md` or starts with `docs/workflow/` and path contains `review` |

A catalog entry is a **candidate** when any of its `surfaces` matches. Multiple
entries may match; dedupe by `id`. **No candidate** → diff-only pass (Use Case 3).

Constitution (`docs/constitution.md`) attaches when **any** governed surface
matches (surfaces list includes all of the above). Architecture and adoption
docs attach on the same gate but lower priority than constitution and
`REVIEW.md`.

### Decision 2 — Fetch doc bytes at `headSha`, not from PR files API

Add `readRepositoryFileAtRef(octokit, owner, repo, path, ref, signal)` in
`src/github/repo-content-reader.ts` using `repos.getContent` (base64 decode).
Wire through `ReviewPassDeps.github` as `readFileAtRef`. Failures return
`undefined` content; selection records `skipped` with reason `unreadable` and
the pass continues (AC 7).

### Decision 3 — Budget semantics

- **`maxPatchChars`**: unchanged — combined **patch** text only.
- **`maxAuthoritativeDocCount`** (default `4`) and **`maxAuthoritativeDocChars`**
  (default `120_000`): apply to **decoded doc text** included in the user prompt.
- When doc text would exceed `maxAuthoritativeDocChars`, drop lowest-priority
  candidates (never silently truncate binding docs mid-body without a skip
  record). If a single binding doc exceeds the char budget alone, skip it with
  reason `over_doc_chars` and log — do not partial-truncate without evidence (spec
  Business Rules).
- Optional env/file config keys mirror `maxPatchChars` naming:
  `RONDA_MAX_AUTHORITATIVE_DOC_COUNT`, `RONDA_MAX_AUTHORITATIVE_DOC_CHARS`, and
  operator file fields `maxAuthoritativeDocCount`, `maxAuthoritativeDocChars`.

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

Selection logic and prompt builder share the same `role` labels (AC 4).

### Decision 5 — Logging and operator visibility

`deps.logger.event` entries (no secrets, no full doc bodies):

- `authoritative_docs_selection` — `selectedIds`, `skipped` summary, char total
- Per skipped file: `authoritative_doc_skipped` — `id`, `path`, `reason`

---

## Layer-by-Layer Changes

### Database / Data Layer

Not applicable.

### Backend / Review Core

- [ ] **`src/domain/authoritative-doc-catalog.ts`**: Default catalog covering
      minimum spec set:
      - `docs/constitution.md` — binding, priority `10`
      - `REVIEW.md` — binding, priority `20`
      - `docs/project/3-software-architecture.md` — advisory, priority `30`
      - `docs/adoption/ronda-review-adoption.md` — advisory, priority `40`
- [ ] **`src/core/select-authoritative-docs.ts`**: Selection + skip reasons;
      deterministic sort: priority asc, then `path` asc.
- [ ] **`src/github/repo-content-reader.ts`**: Base64 decode; map 404 to
      `undefined`; respect abort signal via existing `withAbortMapping`.
- [ ] **`src/domain/review-pass.types.ts`**: Extend `ReviewPassDeps.github`
      with `readFileAtRef(...) => Promise<string | undefined>`.
- [ ] **`src/cli/review-pr.ts`** (and webhook job wiring if separate): Implement
      `readFileAtRef` on the concrete GitHub deps object.
- [ ] **`src/core/run-review-pass.ts`**: After `readChangedFiles`, compute
      changed path list (include `previousPath` when present), run selection,
      fetch selected paths at `pr.headSha`, build prompt with docs, log skips.
- [ ] **`src/inference/review-prompt.ts`**: Extend `BuildReviewPromptInput`;
      enforce doc char budget in builder (throw `AuthoritativeDocsTooLargeError`
      only if caller passes docs that already exceed budget — selection layer
      should prevent this; builder double-checks).
- [ ] **`src/config/config.types.ts`** + **`load-config.ts`**: New limits with
      defaults; document in operator file schema comment.

### Tests

- [ ] **`tests/unit/core/select-authoritative-docs.test.ts`**: Webhook path change
      selects constitution + architecture; utility-only change selects none;
      over-count and over-char drops with stable skip reasons; repeatability
      (two calls → identical output).
- [ ] **`tests/unit/inference/review-prompt.test.ts`**: Binding/advisory sections
      appear with labels; patch-only budget unchanged when docs empty.
- [ ] **`tests/unit/github/repo-content-reader.test.ts`**: Decode success; 404 →
      undefined (mock octokit).
- [ ] **`tests/unit/core/run-review-pass.test.ts`**: Inject fake
      `readFileAtRef`; assert logger events and prompt receives docs for webhook
      fixture changed files; assert diff-only when paths irrelevant.
- [ ] **`tests/integration/review-pass.test.ts`**: Extend fake GitHub deps with
      catalog file contents; no live model for selection assertions.

### Documentation Updates (post-implementation — listed for developer)

- [ ] `docs/adoption/ronda-review-adoption.md` — document new config keys and
      selection behavior for operators.
- [ ] `docs/project/3-software-architecture.md` — module layout for catalog,
      selection, and repo content reader.
- [ ] `AGENTS.md` — troubleshooting row if doc fetch fails frequently (optional
      one-liner under existing Ronda troubleshooting table).

---

## Testing Strategy

**Test types**: Unit (selection, prompt, reader), integration (orchestration with
injected deps), smoke (operator-visible selection on a real PR).

**Key scenarios**:

1. Webhook file change → constitution + relevant catalog docs in prompt (AC 1, 8).
2. Test-only utility change → no doc sections (AC 2, 8).
3. Config caps → skipped docs with reasons when exceeding count/chars (AC 3, 5).
4. Binding vs advisory labels in prompt text (AC 4).
5. Missing file at ref → pass completes; skip logged (AC 7).
6. Same head + config → identical selection (AC 6).

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

1. Add catalog types and default catalog module.
2. Implement pure `selectAuthoritativeDocs` with unit tests (no GitHub).
3. Add config fields and load-config tests.
4. Implement `repo-content-reader` with unit tests.
5. Extend `ReviewPassDeps` and wire `readFileAtRef` in CLI (and webhook deps).
6. Extend `buildReviewPrompt` + unit tests.
7. Integrate into `runReviewPass` with logging; extend run-review-pass unit tests.
8. Extend integration test fake GitHub layer.
9. Update adoption + architecture docs per **Documentation Updates**.
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
| `src/domain/review-pass.types.ts` | Extend github deps |
| `src/core/run-review-pass.ts` | Selection + fetch + prompt |
| `src/inference/review-prompt.ts` | Doc sections + types |
| `src/config/config.types.ts` | Doc limit fields |
| `src/config/load-config.ts` | Load doc limits |
| `src/cli/review-pr.ts` | Wire `readFileAtRef` |
| `src/webhook/webhook-job.ts` | Wire `readFileAtRef` if deps built separately |
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
