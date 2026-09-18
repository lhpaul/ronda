/** Review stage codes used by durability mode and checklist selection. */
export type ReviewStage = "spec" | "plan" | "implementation" | "default";

/**
 * Port of `reviewer_stage_for_branch` from local-ai-reviewer.sh (#1653).
 * Literal prefixes only — `specification/foo` must not match `spec/*`.
 */
export function reviewStageForBranch(headBranch: string): ReviewStage {
  if (headBranch.startsWith("spec/")) {
    return "spec";
  }
  if (headBranch.startsWith("implementation-plan/")) {
    return "plan";
  }
  if (
    headBranch.startsWith("feature/") ||
    headBranch.startsWith("refactor/") ||
    headBranch.startsWith("fix/") ||
    headBranch.startsWith("hotfix/")
  ) {
    return "implementation";
  }
  return "default";
}
