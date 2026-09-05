import { buildCommentableLinesByFile } from "../github/diff-lines.js";
import { ModelClientError } from "../inference/model-client.js";
import { ChangesTooLargeError, buildReviewPrompt } from "../inference/review-prompt.js";
import {
  UnusableModelOutputError,
  parseModelResponse,
} from "../inference/parse-model-response.js";
import { severityLabel } from "../domain/severity.js";
import type { Severity } from "../domain/severity.js";
import type {
  FailureReason,
  Finding,
  InlineComment,
  ReviewPassDeps,
  ReviewPassInput,
  ReviewPassResult,
} from "../domain/review-pass.types.js";
import { buildCheckRunOutput, buildReviewSummary, countBySeverity } from "./summary.js";
import { createPassDeadline } from "./pass-deadline.js";

/**
 * Orchestrates one review pass end to end, implementing the plan's "Pass
 * outcome decision matrix" in order: read the pull request, apply the draft
 * gate, look up any existing check run, arm the deadline, read changed
 * files, build the prompt, call the model, parse the response, map
 * findings, re-read the head SHA, then publish the review followed by the
 * check run. Every failure path is mapped to a `FailureReason` before
 * publication, so a failure is always visible.
 */
export async function runReviewPass(
  input: ReviewPassInput,
  deps: ReviewPassDeps,
): Promise<ReviewPassResult> {
  const startMs = deps.clock.now();
  const startedAt = deps.clock.isoNow();

  deps.logger.event("pass_started", {
    owner: input.owner,
    repo: input.repo,
    pullNumber: input.pullNumber,
    trigger: input.trigger,
  });

  const pr = await deps.github.readPullRequest(input.owner, input.repo, input.pullNumber);

  if (pr.draft) {
    deps.logger.event("pass_skipped", { reason: "draft_pull_request", headSha: pr.headSha });
    return skippedResult("draft_pull_request", startMs, deps);
  }

  let existingCheckRunId: number | null = null;
  try {
    existingCheckRunId = await deps.github.findExistingCheckRun(
      input.owner,
      input.repo,
      pr.headSha,
    );
  } catch (error) {
    // Non-fatal: the pass still proceeds. In the rare case this lookup
    // fails, a manual re-trigger may create a second check run rather than
    // updating the existing one — an accepted degradation, not a pass
    // failure, since the review itself can still be published.
    deps.logger.event("check_run_lookup_failed", { message: String(error) });
  }

  if (input.trigger === "automatic" && existingCheckRunId !== null) {
    deps.logger.event("pass_skipped", {
      reason: "already_reviewed_automatically",
      headSha: pr.headSha,
    });
    return skippedResult("already_reviewed_automatically", startMs, deps);
  }

  const deadline = createPassDeadline(deps.config.passTimeoutMs, deps.deadlineClock);
  try {
    if (deps.config.loadError) {
      return await finalizeFailure(deps, input, {
        headSha: pr.headSha,
        existingCheckRunId,
        startedAt,
        startMs,
        reason: "unexpected_error",
        logMessage: deps.config.loadError,
      });
    }

    if (deps.config.model.apiKey.trim() === "") {
      return await finalizeFailure(deps, input, {
        headSha: pr.headSha,
        existingCheckRunId,
        startedAt,
        startMs,
        reason: "credential_missing",
        logMessage: "RONDA_MODEL_API_KEY (or the operator config file's modelApiKey) is not set",
      });
    }

    const changedFiles = await deps.github.readChangedFiles(
      input.owner,
      input.repo,
      input.pullNumber,
    );

    const prompt = buildReviewPrompt({
      title: pr.title,
      body: pr.body,
      changedFiles,
      maxPatchChars: deps.config.maxPatchChars,
    });

    const raw = await deps.model.complete(prompt, deadline.signal);
    const parsed = parseModelResponse(raw, changedFiles);

    const commentableByFile = buildCommentableLinesByFile(changedFiles);
    const inlineComments: InlineComment[] = [];
    const unmappedFindings: Finding[] = [];
    for (const finding of parsed.findings) {
      const commentableLines = commentableByFile.get(finding.path);
      if (finding.line !== null && commentableLines?.has(finding.line)) {
        inlineComments.push({
          path: finding.path,
          line: finding.line,
          body: renderFindingBody(finding),
        });
      } else {
        unmappedFindings.push(finding);
      }
    }

    // Re-read the pull request immediately before publication. A head SHA
    // that moved means this pass is superseded; publish nothing for it.
    const latest = await deps.github.readPullRequest(
      input.owner,
      input.repo,
      input.pullNumber,
    );
    if (latest.headSha !== pr.headSha) {
      deps.logger.event("pass_skipped", {
        reason: "superseded_head_sha",
        headSha: pr.headSha,
        newHeadSha: latest.headSha,
      });
      return skippedResult("superseded_head_sha", startMs, deps);
    }

    const totals = fileTotals(changedFiles);
    const summaryBody = buildReviewSummary({
      changedFileCount: changedFiles.length,
      additions: totals.additions,
      deletions: totals.deletions,
      findings: parsed.findings,
      unmappedFindings,
      modelName: deps.model.modelName,
      durationMs: deps.clock.now() - startMs,
      trigger: input.trigger,
      malformedCount: parsed.malformedCount,
      coercedSeverityCount: parsed.coercedSeverityCount,
      duplicateCount: parsed.duplicateCount,
    });
    const fallbackSummaryBody = buildReviewSummary({
      changedFileCount: changedFiles.length,
      additions: totals.additions,
      deletions: totals.deletions,
      findings: parsed.findings,
      unmappedFindings: parsed.findings,
      modelName: deps.model.modelName,
      durationMs: deps.clock.now() - startMs,
      trigger: input.trigger,
      malformedCount: parsed.malformedCount,
      coercedSeverityCount: parsed.coercedSeverityCount,
      duplicateCount: parsed.duplicateCount,
    });

    deadline.markPublishing();

    await deps.github.publishReview({
      owner: input.owner,
      repo: input.repo,
      pullNumber: input.pullNumber,
      headSha: pr.headSha,
      summaryBody,
      inlineComments,
      fallbackSummaryBody,
    });

    const findingCounts = countBySeverity(parsed.findings);
    const durationMs = deps.clock.now() - startMs;
    const checkRunOutput = buildCheckRunOutput({
      outcome: "succeeded",
      findingCounts,
      modelName: deps.model.modelName,
      durationMs,
    });

    await deps.github.publishCheckRun({
      owner: input.owner,
      repo: input.repo,
      headSha: pr.headSha,
      existingCheckRunId,
      title: checkRunOutput.title,
      summary: checkRunOutput.summary,
      conclusion: "success",
      startedAt,
      completedAt: deps.clock.isoNow(),
      detailsUrl: deps.detailsUrl,
    });

    deps.logger.event("pass_succeeded", {
      headSha: pr.headSha,
      findingCount: parsed.findings.length,
      durationMs,
    });

    return {
      outcome: "succeeded",
      findings: parsed.findings,
      malformedCount: parsed.malformedCount,
      coercedSeverityCount: parsed.coercedSeverityCount,
      duplicateCount: parsed.duplicateCount,
      durationMs,
    };
  } catch (error) {
    const reason = mapErrorToFailureReason(error, deadline.expired());
    return await finalizeFailure(deps, input, {
      headSha: pr.headSha,
      existingCheckRunId,
      startedAt,
      startMs,
      reason,
      logMessage: String(error),
    });
  } finally {
    deadline.dispose();
  }
}

function mapErrorToFailureReason(error: unknown, deadlineExpired: boolean): FailureReason {
  if (error instanceof ModelClientError) {
    return error.reason;
  }
  if (error instanceof ChangesTooLargeError) {
    return "changes_too_large";
  }
  if (error instanceof UnusableModelOutputError) {
    return "unusable_output";
  }
  if (deadlineExpired) {
    return "timed_out";
  }
  return "unexpected_error";
}

function renderFindingBody(finding: Finding): string {
  return `**${severityLabel(finding.severity)}** — ${finding.title}\n\n${finding.body}`;
}

function fileTotals(files: Array<{ additions: number; deletions: number }>): {
  additions: number;
  deletions: number;
} {
  return files.reduce(
    (totals, file) => ({
      additions: totals.additions + file.additions,
      deletions: totals.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );
}

function skippedResult(
  skipReason: ReviewPassResult["skipReason"],
  startMs: number,
  deps: ReviewPassDeps,
): ReviewPassResult {
  return {
    outcome: "skipped",
    skipReason,
    findings: [],
    malformedCount: 0,
    coercedSeverityCount: 0,
    duplicateCount: 0,
    durationMs: deps.clock.now() - startMs,
  };
}

interface FinalizeFailureInput {
  headSha: string;
  existingCheckRunId: number | null;
  startedAt: string;
  startMs: number;
  reason: FailureReason;
  logMessage: string;
}

const EMPTY_SEVERITY_COUNTS: Record<Severity, number> = {
  blocking: 0,
  important: 0,
  nit: 0,
};

async function finalizeFailure(
  deps: ReviewPassDeps,
  input: ReviewPassInput,
  failure: FinalizeFailureInput,
): Promise<ReviewPassResult> {
  const durationMs = deps.clock.now() - failure.startMs;
  deps.logger.event("pass_failed", { reason: failure.reason, message: failure.logMessage });

  const checkRunOutput = buildCheckRunOutput({
    outcome: "failed",
    findingCounts: EMPTY_SEVERITY_COUNTS,
    modelName: deps.model.modelName,
    durationMs,
    failureReason: failure.reason,
  });

  await deps.github.publishCheckRun({
    owner: input.owner,
    repo: input.repo,
    headSha: failure.headSha,
    existingCheckRunId: failure.existingCheckRunId,
    title: checkRunOutput.title,
    summary: checkRunOutput.summary,
    conclusion: "failure",
    startedAt: failure.startedAt,
    completedAt: deps.clock.isoNow(),
    detailsUrl: deps.detailsUrl,
  });

  return {
    outcome: "failed",
    failureReason: failure.reason,
    findings: [],
    malformedCount: 0,
    coercedSeverityCount: 0,
    duplicateCount: 0,
    durationMs,
  };
}
