# Durability and Idempotency Review Mode — Smoke Test

**Plan**:
[`2_54-durability-idempotency-review-mode_implementation-plan.md`](../../specs/developments/20260917082125_54-durability-idempotency-review-mode/2_54-durability-idempotency-review-mode_implementation-plan.md)

**Spec**:
[`1_54-durability-idempotency-review-mode_specs.md`](../../specs/developments/20260917082125_54-durability-idempotency-review-mode/1_54-durability-idempotency-review-mode_specs.md)

---

## Preconditions

- Repository checkout at the implementation merge commit under test.
- `npm ci` completed at the repository root.
- For live model steps: valid `RONDA_MODEL_API_KEY` (or operator config) and
  `LOCAL_AI_REVIEWER_COMMAND` configured when exercising the workflow path.
- For workflow-path smoke: `gh` authenticated and a disposable implementation
  branch or fixture pull request available.

---

## 1. Deterministic activation and supply (no model)

From the repository root:

```bash
npm test -- --test-name-pattern 'durability'
bash scripts/development-workflow/tests/test-local-ai-reviewer.sh
bash scripts/lint/durability-idempotency-mode-lint.sh
```

**Pass when**:

- Activation tests report `inactive` on a `spec/*` head with only spec paths
  changed (AC-10).
- Activation tests report `active` / `automatic_match` when changed files
  include at least one listed sensitive surface (for example
  `src/webhook/webhook-job.ts`) on a `feature/*` head (AC-1).
- Supply tests report `unavailable` with a specific reason when the mode document
  is missing or over bound (AC-9).
- The linter exits 0 on the shipped mode document.

---

## 2. Regression catalogue (model-dependent)

Run the documented durability regression command (see plan — expected name
`npm run benchmark:durability`):

```bash
npm run benchmark:durability
```

**Pass when**:

- Output lists all six PR #51 seed shape identifiers from the spec.
- Each shape reports `found >= 1` with durability mode forced active
  (AC-14, AC-15).
- No shape is silently omitted from the report.

Record the model name and command output in the implementation PR test plan.

---

## 3. Workflow reviewer-loop visibility (optional live PR)

On an open **implementation-stage** pull request that touches a sensitive
surface, run one draft reviewer-loop round with local AI enabled:

```bash
LOCAL_AI_REVIEWER_DISABLED=0 \
  bash scripts/development-workflow/pr-review-loop.sh <pr-number> --branch develop
```

**Pass when**:

- The round's platform output includes durability mode state and, when active,
  activation reason and in-scope scenario families (AC-16).
- The reviewer-loop summary comment JSON/history includes the same durability
  fields for that round.

---

## 4. GitHub Action path (optional)

When validating the TypeScript review pass on a test repository:

```bash
npm run review
```

Use a pull request whose head branch matches `feature/*` and includes a
sensitive-surface change.

**Pass when**:

- Published review summary lists durability mode metadata (state, activation
  reason when active, in-scope families) without extra inline comments for
  every family when there are zero findings (AC-13).

---

## Failure triage

| Symptom | Likely cause |
| --- | --- |
| Mode always `inactive` on webhook changes | Automatic path rules too narrow or stage not `implementation` |
| Mode `active` but ordinary prompt only | Codex preset or `buildReviewPrompt` not appending mode text |
| Regression misses all shapes | Mode instructions not loaded or benchmark not forcing `active` |
| Loop history missing fields | Ledger builder in `pr-review-loop.sh` not wired |
