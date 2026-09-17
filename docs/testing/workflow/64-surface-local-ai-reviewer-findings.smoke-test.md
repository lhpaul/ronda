# Smoke Test: Surface Local Reviewer Findings (#64)

**Item**: #64 — Surface local-ai-reviewer finding text in reviewer-loop summary /
history with redaction  
**Stage**: Run on the **implementation PR** after Step 6 (not this plan PR).

---

## Preconditions

- Implementation branch merged or under test on a PR targeting `develop`.
- `gh` authenticated; repository checkout matches the PR head.
- Local reviewer configured in `.ai-dev-workflow.yaml` for draft phase unless
  explicitly testing the disabled path.
- Prefer exercising the loop against the **implementation PR itself** using
  `--branch` so head SHA matches the checkout under test.

---

## Environment

| Variable | When |
| --- | --- |
| `LOCAL_AI_REVIEWER_DISABLED=1` | Only if local reviewer runtime fails (Codex/model unavailable). Skips local findings surfacing; document skip in PR comment. Do **not** use for the primary happy-path pass. |

---

## Steps

1. **Pin branch for loop**

   ```bash
   pr=<implementation-pr-number>
   branch="$(gh pr view "$pr" --json headRefName -q .headRefName)"
   bash scripts/development-workflow/pr-review-loop.sh "$pr" --branch "$branch"
   ```

2. **Trigger blocking local findings** (if the implementation PR is intentionally
   clean, use a throwaway commit or fixture PR from harness docs — otherwise
   inject a small spec violation the local reviewer flags, then re-run step 1).

3. **Summary comment (GitHub)**  
   Open the PR → find **Automated Reviewer Loop Summary**:
   - [ ] Section **Local reviewer blocking findings** (or equivalent label) appears.
   - [ ] Each listed item shows file/path, line when available, and readable message.
   - [ ] No hosted reviewer comment duplication.

4. **History JSON**  
   Expand reviewer-loop history on the same comment:
   - [ ] Latest entry includes `local_blocking_findings` with entries matching the
         summary (modulo summary truncation).
   - [ ] Clean re-run (zero local blocking) omits the field and empty list section.

5. **Redaction spot-check**  
   If the finding text could contain token-like strings, confirm published text
   shows redacted placeholders, not raw secrets.

6. **Regression — gates unchanged**  
   - [ ] Readiness labels and loop exit semantics unchanged vs pre-feature PRs
         (no new merge authority; hosted reviewers still behave as before).

---

## Pass criteria

All checked boxes in steps 3–6 hold on the implementation PR head, or documented
skip with `LOCAL_AI_REVIEWER_DISABLED=1` and follow-up issue when local runtime
was unavailable.

---

## Fail / escalate

- Summary shows counts but no local finding details when local reviewer returned
  `needs_fixes` with blocking KV → **fail**, reopen implementation.
- Raw token or home-directory path visible in comment → **fail**, security fix
  required before merge.
- Summary and history disagree on finding count or text → **fail**.
