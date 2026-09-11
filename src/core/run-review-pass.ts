import { buildCommentableLinesByFile } from "../github/diff-lines.js";
import { GithubClientError } from "../github/github-client.js";
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
  PublishCheckRunInput,
  PullRequestMetadata,
  ReviewPassDeps,
  ReviewPassInput,
  ReviewPassResult,
} from "../domain/review-pass.types.js";
import { buildCheckRunOutput, buildReviewSummary, countBySeverity } from "./summary.js";
import { createPassDeadline } from "./pass-deadline.js";

export class ReviewPublishedCheckRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewPublishedCheckRunError";
  }
}

/**
 * Orchestrates one review pass end to end, implementing the plan's "Pass
 * outcome decision matrix" in order: read the pull request, apply the draft
 * gate, look up any existing check run, arm the deadline, read changed
 * files, build the prompt, call the model, parse the response, map
 * findings, re-read the head SHA, then publish the review followed by the
 * check run. Every failure path is mapped to a `FailureReason` before
 * publication, so a failure is always visible.
 *
 * The deadline is armed before the *first* GitHub call and its signal is
 * threaded through every GitHub read in this function (not only the model
 * call), so GitHub API latency or retries — not just a slow model — can
 * trip the in-process budget. See the plan's "a pass always terminates
 * within its budget" guarantee.
 *
 * A single `try`/`catch` wraps the entire pass, from the first
 * `readPullRequest` call through publication: every GitHub or model failure
 * that happens before the review is public — including one from the very
 * first read, when no head SHA has been read from the API yet — is
 * classified and, when a head SHA is known from any source, reported
 * through a `Review failed` check run. See `finalizeFailure`'s headSha
 * resolution below for what happens when no SHA is known at all.
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

  const deadline = createPassDeadline(deps.config.passTimeoutMs, deps.deadlineClock);
  // Populated once `readPullRequest` succeeds. Read from the shared `catch`
  // below so a failure anywhere in the pass — including the very first read
  // — can still resolve a head SHA to publish a failure check run against.
  let pr: PullRequestMetadata | undefined;
  let existingCheckRunId: number | null = null;
  // Set once the review has been published. The catch block below checks
  // this first: once the review is public, a subsequent check-run write
  // failure must never be reported through `finalizeFailure`, which would
  // publish a contradictory "Review failed" check run for a pass whose
  // review a reader can already see. See the plan's markPublishing
  // guarantee and the constitution's "every pass ends in a definite
  // outcome" rule — that rule is about the check run never being silently
  // left pending, not about manufacturing a false outcome once the truth
  // (the published review) is already public.
  let reviewPublished = false;

  try {
    pr = await deps.github.readPullRequest(
      input.owner,
      input.repo,
      input.pullNumber,
      deadline.signal,
    );

    if (pr.draft) {
      deps.logger.event("pass_skipped", { reason: "draft_pull_request", headSha: pr.headSha });
      return skippedResult("draft_pull_request", startMs, deps);
    }

    try {
      existingCheckRunId = await deps.github.findExistingCheckRun(
        input.owner,
        input.repo,
        pr.headSha,
        deadline.signal,
      );
    } catch (error) {
      if (error instanceof GithubClientError) {
        // Fail fast: this lookup was aborted, which means the pass's entire
        // budget is already gone. Tolerating it and continuing (the
        // behaviour below, for a genuine non-abort lookup failure) would
        // spend more of an already-exhausted deadline on a doomed
        // `readChangedFiles` call or model request. Rethrow so the shared
        // `catch` below classifies this the same way any other abort is
        // classified.
        throw error;
      }
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
      deadline.signal,
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
      deadline.signal,
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

    await deps.github.publishReview(
      {
        owner: input.owner,
        repo: input.repo,
        pullNumber: input.pullNumber,
        headSha: pr.headSha,
        summaryBody,
        inlineComments,
        fallbackSummaryBody,
      },
      deadline.signal,
    );
    // The review is now public. Nothing below this line may route through
    // the shared `catch` into `finalizeFailure`.
    reviewPublished = true;

    const findingCounts = countBySeverity(parsed.findings);
    const durationMs = deps.clock.now() - startMs;
    const checkRunOutput = buildCheckRunOutput({
      outcome: "succeeded",
      findingCounts,
      modelName: deps.model.modelName,
      durationMs,
    });

    const checkRunInput: PublishCheckRunInput = {
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
    };

    const checkRunResult = await publishSuccessCheckRun(deps, input, checkRunInput, deadline.signal);
    if (!checkRunResult.ok) {
      // The review is already public and correct. Do not synthesize a
      // "Review failed" check run for it — that would contradict what a
      // reader can already see. Surface the problem loudly instead (it is
      // already logged by `publishSuccessCheckRun`) by throwing. The
      // `reviewPublished` guard in the `catch` below re-throws this past
      // `finalizeFailure` unchanged, and the caller (the CLI entrypoint)
      // turns it into a non-zero process exit, so the failure is visible in
      // the Actions run rather than silently swallowed.
      throw new ReviewPublishedCheckRunError(
        `Review was published for ${pr.headSha} but the check run could not be ` +
          `published after retrying: ${checkRunResult.message}`,
      );
    }

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
    if (reviewPublished) {
      throw error;
    }
    const reason = mapErrorToFailureReason(error, deadline.expired());
    // Best known head SHA: the one `readPullRequest` returned, if it got
    // that far, else the one carried by the triggering webhook event (only
    // ever present for `pull_request` events — `issue_comment` payloads
    // never carry one). This is what makes a failure of the very first
    // `readPullRequest` call (Gap 1) reportable at all.
    const headSha = pr?.headSha ?? input.headSha;
    if (headSha === undefined) {
      // No head SHA is known from any source, so there is nothing to
      // publish a check run against. Log the classified failure instead of
      // letting the error escape uncaught — silence is the exact failure
      // mode this fix exists to close.
      deps.logger.event("pass_failed", { reason, message: String(error) });
      return {
        outcome: "failed",
        failureReason: reason,
        findings: [],
        malformedCount: 0,
        coercedSeverityCount: 0,
        duplicateCount: 0,
        durationMs: deps.clock.now() - startMs,
      };
    }
    return await finalizeFailure(deps, input, {
      headSha,
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

/**
 * Publishes the terminal "succeeded" check run with one extra attempt
 * beyond `publishCheckRun`'s own internal bounded retry (fixed 2s/5s
 * backoff on HTTP 5xx or a secondary rate limit) — belt-and-suspenders for
 * the exact write that must not be silently dropped once the review it
 * describes is already public. Never throws: every failure is caught and
 * logged here so the caller can decide the terminal behaviour itself
 * without accidentally routing through the pass's generic failure path.
 */
async function publishSuccessCheckRun(
  deps: ReviewPassDeps,
  input: ReviewPassInput,
  checkRunInput: PublishCheckRunInput,
  signal: AbortSignal,
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    await deps.github.publishCheckRun(checkRunInput, signal);
    return { ok: true };
  } catch (firstError) {
    deps.logger.event("check_run_publish_failed_after_review", {
      owner: input.owner,
      repo: input.repo,
      headSha: checkRunInput.headSha,
      message: String(firstError),
    });
  }

  try {
    await deps.github.publishCheckRun(checkRunInput, signal);
    return { ok: true };
  } catch (secondError) {
    const message = String(secondError);
    deps.logger.event("check_run_publish_failed_after_review_retry", {
      owner: input.owner,
      repo: input.repo,
      headSha: checkRunInput.headSha,
      message,
    });
    return { ok: false, message };
  }
}

function mapErrorToFailureReason(error: unknown, deadlineExpired: boolean): FailureReason {
  if (error instanceof ModelClientError) {
    return error.reason;
  }
  if (error instanceof GithubClientError) {
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

  // Deliberately no `signal` here: a `timed_out` failure reaches this
  // function precisely because the deadline's `AbortSignal` already fired.
  // Passing that same (already-aborted) signal into this write would make
  // the failure check run's own publish attempt abort immediately —
  // reintroducing exactly the "no check run at all" silence this fix
  // exists to prevent. This call must run to completion unconditionally.
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
