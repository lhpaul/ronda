# Require Isolating Planted Violations — Smoke Test

## Scope

Issue #63 implementation aligns planted-violation doctrine and Step 7a reviewer
behavior. This runbook validates documentation and agent instruction changes
only (no runtime service).

## Preconditions

- Implementation PR targets `develop` from `feature/63-require-isolating-planted-violation`
  (or equivalent implementation branch).
- `git diff develop...HEAD` is limited to the files listed in the implementation
  plan.

## Checks

1. **REVIEW.md Workflow Policy item 4**

   ```bash
   awk '/^## Workflow Policy Review Checklist/,/^## /' REVIEW.md | rg -n 'isolating|sibling|multiple'
   ```

   Expected: item 4 (or equivalent numbered entry in that section) requires an
   isolating plant per new assertion when multiple checks/assertions change, and
   names sibling / combined-edit masking in addition to earlier-rule masking.

2. **REVIEW.md Pass 2 planted-violation sufficiency**

   ```bash
   awk '/Planted-violation proof presence/,/^Additional checks/' REVIEW.md | head -20
   ```

   Expected: blocking guidance that internal review verifies plant-set
   sufficiency and that aggregate output reproduction alone is insufficient.

3. **Protocol 03 harness checklist**

   ```bash
   awk '/^## Test Harness Coverage Checklist/,/^## /' docs/workflow/development-workflow/protocols/03-implement-development-protocol.md | rg 'isolating|new assertion|combined'
   ```

   Expected: at least one checklist bullet matches the spec's per-assertion
   isolating requirement.

4. **Testing best practices**

   ```bash
   awk '/^## Planted-Violation Proofs/,/^## /' docs/best-practices/3-testing.md
   ```

   Expected: isolating-per-assertion language present; earlier-rule masking
   language still present and not contradicted.

5. **Step 7a agent mirrors**

   ```bash
   rg -n 'plant-set sufficiency|isolating plant' .cursor/agents/code-reviewer.md .claude/agents/code-reviewer.md
   diff -u .cursor/agents/code-reviewer.md .claude/agents/code-reviewer.md
   ```

   Expected: both agents mention sufficiency; diff shows no unintended divergence
   beyond front-matter / tool-specific headers.

6. **No new automation (AC-6)**

   ```bash
   git diff develop...HEAD --name-only | rg -v '^(REVIEW\.md|docs/|\.cursor/agents/code-reviewer\.md|\.claude/agents/code-reviewer\.md|changelog\.d/)' || true
   ```

   Expected: no unexpected paths under `scripts/`, `.github/workflows/`, or `src/`.

## Acceptance Mapping

| Acceptance criterion | Evidence |
| --- | --- |
| AC-1 | Check 1 |
| AC-2 | Check 3 |
| AC-3 | Check 4 |
| AC-4 | Check 5 |
| AC-5 | Checks 1, 2, and 5 |
| AC-6 | Check 6 |
