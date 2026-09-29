import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCommentableLinesByFile } from "../github/diff-lines.js";
import { GithubClientError } from "../github/github-client.js";
import { ModelClientError } from "../inference/model-client.js";
import {
  AuthoritativeDocsTooLargeError,
  ChangesTooLargeError,
  buildReviewPrompt,
} from "../inference/review-prompt.js";
import {
  applyAuthoritativeDocBudgets,
  collectChangedPaths,
  selectAuthoritativeDocCandidates,
} from "./select-authoritative-docs.js";
import {
  UnusableModelOutputError,
  parseModelResponse,
} from "../inference/parse-model-response.js";
import { severityLabel } from "../domain/severity.js";
import type { Severity } from "../domain/severity.js";
import type {
  ChangedFile,
  FailureReason,
  Finding,
  InlineComment,
  PublishCheckRunInput,
  PullRequestMetadata,
  RepositoryContextCandidate,
  RepositoryContextDegradedRecord,
  RepositoryContextOutcome,
  RepositoryContextPassRecord,
  ReviewPassDeps,
  ReviewPassInput,
  ReviewPassResult,
  SweepCategoryList,
  SweepDegradedRecord,
  SweepPassRecord,
} from "../domain/review-pass.types.js";
import {
  classifyFindings,
  loadSweepList,
  type SweepClassification,
  type SweepListResult,
} from "../review/sweep-categories.js";
import { buildCheckRunOutput, buildReviewSummary, countBySeverity } from "./summary.js";
import { createPassDeadline } from "./pass-deadline.js";
import {
  DURABILITY_MODE_DOCUMENT_PATH,
  REVIEW_DURABILITY_MODE_MAX_BYTES,
  resolveDurabilityMode,
  type DurabilityModeResolution,
} from "../review/durability-mode.js";
import { RepositoryFileUnusableError } from "../github/repo-content-reader.js";
import {
  applyRepositoryContextBudgets,
  buildRepositoryContextCandidates,
  compareRepositoryContextCandidates,
  resolveRepositoryContextOutcome,
} from "../review/repository-context.js";
import {
  buildSourceFileSet,
  identifyCandidates,
  resolveSymbols,
  RepositoryContextUnusableContentError,
  type InternalRequestedReference,
  type RepositoryContextReadFile,
} from "../review/symbol-resolver.js";

function readLocalDurabilityModeDocument(
  cwd: string = process.cwd(),
): { text: string | null; unreadable: boolean } {
  const localPath = join(cwd, DURABILITY_MODE_DOCUMENT_PATH);
  if (!existsSync(localPath)) {
    return { text: null, unreadable: false };
  }
  try {
    return { text: readFileSync(localPath, "utf8"), unreadable: false };
  } catch {
    return { text: null, unreadable: true };
  }
}

/**
 * The reusable Action checks out lhpaul/ronda and reviews consumer PRs that
 * are not expected to vendor the mode document. Self-review of Ronda must not
 * fall back to the checkout copy when the reviewed head deleted or broke it.
 */
function shouldFallBackToLocalDurabilityModeDocument(
  owner: string,
  repo: string,
): boolean {
  return `${owner}/${repo}`.toLowerCase() !== "lhpaul/ronda";
}

export class ReviewPublishedCheckRunError extends Error {
  constructor(
    message: string,
    readonly reviewedHeadSha?: string,
    readonly checkRunInput?: PublishCheckRunInput,
  ) {
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
  // Populated once the sweep is enabled and its list loads, before
  // `readChangedFiles`; read by the prompt, the classifier, and the record
  // builders. Undefined when the sweep is off, unrecognized, or the list
  // failed to load (AC18, AC19).
  let sweepList: SweepCategoryList | undefined;
  // The enablement/load decision, computed before the changed-files read but
  // deliberately not emitted there (AC1): the sweep record belongs to a pass
  // that reaches review execution, and AC1 draws that line at the review
  // request the pass issued. A pass that dies between the read and the model
  // call reached nothing and owes no record at all, degraded included.
  let sweepDegraded: SweepDegradedRecord | undefined;
  // Set the moment `classifyFindings` returns for the parsed response —
  // independently of any GitHub call, so it stays set even if the pass then
  // fails (AC1: a pass that issued its request and then failed has reached
  // every category its request carried).
  let classified = false;
  let classification: SweepClassification | undefined;
  // Set the instant before `deps.model.complete` is called. A pass that never
  // got that far reached none of its categories and owes no sweep metadata at
  // all — not even a degraded record — while a pass that did has reached
  // every category its request carried (AC1).
  let requestIssued = false;
  // Guards the one-time release of the held degraded record, so the shared
  // `catch` does not log it a second time after the success path logged it.
  let sweepDegradedReleased = false;
  // Read-only repository context (#106). Computed before the model call, but
  // — like `sweepDegraded` — held and released only once the review request
  // is issued (AC3, AC10, AC19), so a pass that dies before then stays
  // indistinguishable from a pass without the feature. `record` and
  // `degraded` are mutually exclusive.
  let repositoryContextRecord: RepositoryContextPassRecord | undefined;
  let repositoryContextDegraded: RepositoryContextDegradedRecord | undefined;
  let repositoryContextCandidates: RepositoryContextCandidate[];
  let repositoryContextReleased = false;

  try {
    pr = await deps.github.readPullRequest(
      input.owner,
      input.repo,
      input.pullNumber,
      deadline.signal,
    );

    if (pr.draft) {
      deps.logger.event("pass_skipped", { reason: "draft_pull_request", headSha: pr.headSha });
      return skippedResult("draft_pull_request", startMs, deps, pr.headSha);
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
      return skippedResult("already_reviewed_automatically", startMs, deps, pr.headSha);
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

    // Sweep enablement resolution (#105, AC18). Resolved here — after the
    // credential gate, before the changed-files read — but nothing is emitted
    // from this point: AC1 ties the record to review execution, so both the
    // unrecognized-enablement and invalid-list records are held in
    // `sweepDegraded` and released only once the pass issues its review
    // request. A pass that dies in between (an authoritative-document fetch,
    // any other GitHub error) is indistinguishable from the same failure
    // without the sweep and owes no sweep record at all.
    if (deps.config.sweepMode === "on") {
      // AC19: a list that cannot be loaded never fails the pass, whatever the
      // loader does. The bundled loader returns a result rather than throwing,
      // but the seam is injectable, so a throw is degraded to `unreadable` here
      // instead of escaping to the shared failure path. The detail is fixed
      // text: a thrown error's own message is not carried into the record.
      let listResult: SweepListResult;
      try {
        listResult = await (deps.loadSweepList ?? loadSweepList)();
      } catch {
        listResult = {
          ok: false,
          reason: "unreadable",
          detail: "the list loader threw before returning a result",
        };
      }
      if (listResult.ok) {
        sweepList = listResult.list;
      } else {
        // AC19: no list version is reported as used — the pass used none, and
        // stating one it never loaded is the false claim this record avoids.
        sweepDegraded = {
          kind: "sweep-did-not-run",
          reason: listResult.reason,
          detail: listResult.detail,
        };
      }
    } else if (deps.config.sweepModeRaw !== undefined) {
      // AC18: a non-empty enablement value was unrecognized. The raw value is
      // carried on `deps.config` for this fact alone and never reaches the
      // record, the logs, or the review (see `config.types.ts`).
      sweepDegraded = { kind: "sweep_enablement_unrecognized" };
    }

    const changedFiles = await deps.github.readChangedFiles(
      input.owner,
      input.repo,
      input.pullNumber,
      deadline.signal,
    );

    const changedPaths = collectChangedPaths(changedFiles);
    const preResolve = resolveDurabilityMode({
      headBranch: pr.headBranch,
      changedPaths,
      durabilityMode: deps.config.durabilityMode,
      durabilityModeDefault: deps.config.durabilityModeDefault,
      modeDocumentText: "placeholder",
    });

    let durabilityMode: DurabilityModeResolution;
    if (preResolve.state === "inactive") {
      durabilityMode = {
        ...preResolve,
        modeText: "",
      };
    } else {
      let modeDocumentText: string | null = null;
      let modeDocumentUnreadable = false;
      try {
        const loaded = await deps.github.readFileAtRef(
          input.owner,
          input.repo,
          DURABILITY_MODE_DOCUMENT_PATH,
          pr.headSha,
          deadline.signal,
          { failOnUnusable: true, oversizedMaxBytes: REVIEW_DURABILITY_MODE_MAX_BYTES },
        );
        // Prefer the reviewed-head copy when present (self-review of mode-doc
        // edits). When a consumer PR head has no copy — the common reusable-
        // Action case — fall back to the deployed Ronda checkout document.
        // Do not fall back when reviewing Ronda itself: a missing/broken head
        // copy must surface as unavailable. Unusable head content (truncated,
        // empty) is unavailable — never substituted with local guidance.
        modeDocumentText =
          loaded ??
          (() => {
            if (
              !shouldFallBackToLocalDurabilityModeDocument(
                input.owner,
                input.repo,
              )
            ) {
              return null;
            }
            const local = readLocalDurabilityModeDocument();
            if (local.unreadable) {
              modeDocumentUnreadable = true;
              return null;
            }
            return local.text;
          })();
      } catch (error) {
        if (error instanceof RepositoryFileUnusableError) {
          // Empty files are present but incomplete (match shell supply). Files
          // whose reported size exceeds the mode bound are oversized. Truncated
          // or non-file content remains unreadable.
          if (error.reason === "empty") {
            modeDocumentText = "";
          } else if (error.reason === "oversized") {
            modeDocumentText = "x".repeat(REVIEW_DURABILITY_MODE_MAX_BYTES + 1);
          } else {
            modeDocumentUnreadable = true;
            deps.logger.event("durability_mode_document_unreadable", {
              message: error.message,
              reason: error.reason,
            });
          }
        } else {
          const message = String(error);
          if (/404|Not Found|does not exist/i.test(message)) {
            if (
              shouldFallBackToLocalDurabilityModeDocument(input.owner, input.repo)
            ) {
              const local = readLocalDurabilityModeDocument();
              if (local.unreadable) {
                modeDocumentUnreadable = true;
                modeDocumentText = null;
              } else {
                modeDocumentText = local.text;
              }
            } else {
              modeDocumentText = null;
            }
          } else {
            modeDocumentUnreadable = true;
            deps.logger.event("durability_mode_document_unreadable", { message });
          }
        }
      }
      durabilityMode = resolveDurabilityMode({
        headBranch: pr.headBranch,
        changedPaths,
        durabilityMode: deps.config.durabilityMode,
        durabilityModeDefault: deps.config.durabilityModeDefault,
        modeDocumentText,
        modeDocumentUnreadable,
      });
    }
    deps.logger.event("durability_mode_resolved", {
      state: durabilityMode.state,
      activationReason: durabilityMode.activationReason,
      unavailableReason: durabilityMode.unavailableReason,
      familiesInScope: durabilityMode.scenarioFamiliesInScope,
    });

    const phase1 = selectAuthoritativeDocCandidates(changedPaths);
    const candidatesWithText = [];
    for (const candidate of phase1.candidates) {
      const text = await deps.github.readFileAtRef(
        input.owner,
        input.repo,
        candidate.path,
        pr.headSha,
        deadline.signal,
      );
      candidatesWithText.push({
        id: candidate.id,
        path: candidate.path,
        role: candidate.role,
        priority: candidate.priority,
        text,
      });
    }
    const phase2 = applyAuthoritativeDocBudgets(candidatesWithText, {
      maxAuthoritativeDocCount: deps.config.maxAuthoritativeDocCount,
      maxAuthoritativeDocChars: deps.config.maxAuthoritativeDocChars,
    });
    const allSkipped = [...phase1.skipped, ...phase2.skipped];
    if (phase2.selected.length > 0 || allSkipped.length > 0) {
      deps.logger.event("authoritative_docs_selection", {
        selectedIds: phase2.selected.map((doc) => doc.id),
        skippedCount: allSkipped.length,
        docCharTotal: phase2.selected.reduce((sum, doc) => sum + doc.text.length, 0),
      });
      for (const skip of allSkipped) {
        deps.logger.event("authoritative_doc_skipped", {
          id: skip.id,
          path: skip.path,
          reason: skip.reason,
        });
      }
    }

    const repositoryContextPhase = await runRepositoryContextPhase(
      input,
      pr,
      changedFiles,
      deps,
      deadline.signal,
      startMs,
    );
    repositoryContextRecord = repositoryContextPhase.repositoryContext?.record;
    repositoryContextDegraded = repositoryContextPhase.repositoryContext?.degraded;
    repositoryContextCandidates = repositoryContextPhase.candidatesForPrompt;

    const prompt = buildReviewPrompt({
      title: pr.title,
      body: pr.body,
      changedFiles,
      maxPatchChars: deps.config.maxPatchChars,
      authoritativeDocs: phase2.selected,
      maxAuthoritativeDocCount: deps.config.maxAuthoritativeDocCount,
      maxAuthoritativeDocChars: deps.config.maxAuthoritativeDocChars,
      durabilityMode,
      ...(sweepList ? { sweepCategories: sweepList.categories } : {}),
      ...(repositoryContextCandidates.length > 0 ? { repositoryContext: repositoryContextCandidates } : {}),
    });

    // Set before the call, not after: a request that is issued and then
    // fails still reached every category it carried (AC1), and the model
    // call's own failure modes (timeout, unavailable) are exactly that case.
    requestIssued = true;
    const completion = await deps.model.complete(prompt, deadline.signal);
    // The review request has now been issued, so the sweep record for this
    // pass — classified or degraded — is owed from here on. Release the held
    // degraded record as its own log event now, so a later failure in this
    // pass does not report it as though the request had never gone out.
    if (sweepDegraded) {
      logSweepDegraded(deps, sweepDegraded);
      sweepDegradedReleased = true;
    }
    // Same discipline for read-only repository context (#106): the record or
    // degraded state was computed before the model call but is only logged
    // — and therefore only "owed" — once the pass has issued its review
    // request (AC3, AC10, AC19).
    if (repositoryContextRecord || repositoryContextDegraded) {
      logRepositoryContext(deps, repositoryContextRecord, repositoryContextDegraded);
      repositoryContextReleased = true;
    }
    const parsed = parseModelResponse(completion.content, changedFiles);
    if (sweepList) {
      // Set the moment this returns, independently of any GitHub call below.
      classification = classifyFindings(parsed.findings, sweepList);
      classified = true;
    }

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
      // This pass issued its review request, so it owes its per-category
      // record — but it publishes nothing, so the record is logs-only (AC1).
      const sweep = sweepMetadata(classification, sweepList, sweepDegraded, deps, pr.headSha);
      const repositoryContext =
        repositoryContextRecord || repositoryContextDegraded
          ? { record: repositoryContextRecord, degraded: repositoryContextDegraded }
          : undefined;
      return skippedResult("superseded_head_sha", startMs, deps, pr.headSha, sweep, repositoryContext);
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
      durabilityMode,
      // AC3: the body states only that the sweep ran and which list version it
      // used. A degraded pass states nothing — it classified nothing, and the
      // record belongs to the surfaces AC1 assigns it (AC18, AC19).
      ...(sweepList ? { sweep: { listVersion: sweepList.version } } : {}),
      // AC3: the body states only the outcome, one line, and nothing further.
      // A degraded (unrecognized switch value) pass resolved to off, so it
      // states nothing here either — exactly like a validly disabled pass.
      ...(repositoryContextRecord ? { repositoryContext: { outcome: repositoryContextRecord.outcome } } : {}),
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
      durabilityMode,
      ...(sweepList ? { sweep: { listVersion: sweepList.version } } : {}),
      ...(repositoryContextRecord ? { repositoryContext: { outcome: repositoryContextRecord.outcome } } : {}),
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
    // The record and the degraded record are never both: a degraded pass
    // classified nothing, so it has no per-category record to carry.
    const sweep = sweepMetadata(classification, sweepList, sweepDegraded, deps, pr.headSha);
    const checkRunOutput = buildCheckRunOutput({
      outcome: "succeeded",
      findingCounts,
      modelName: deps.model.modelName,
      durationMs,
      ...(sweep.record ? { sweep: sweep.record } : {}),
      ...(sweep.degraded ? { sweepDegraded: sweep.degraded } : {}),
      ...(repositoryContextRecord ? { repositoryContext: repositoryContextRecord } : {}),
      ...(repositoryContextDegraded ? { repositoryContextDegraded } : {}),
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
    try {
      await deps.onReviewPublished?.(checkRunInput);
    } catch {
      throw new ReviewPublishedCheckRunError(
        `Review was published for ${pr.headSha} but the check run recovery state ` +
          "could not be persisted",
        pr.headSha,
        checkRunInput,
      );
    }

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
        pr.headSha,
        checkRunInput,
      );
    }

    deps.logger.event("pass_succeeded", {
      headSha: pr.headSha,
      findingCount: parsed.findings.length,
      durationMs,
    });

    return {
      outcome: "succeeded",
      reviewedHeadSha: pr.headSha,
      terminalCheckRunPublished: true,
      findings: parsed.findings,
      malformedCount: parsed.malformedCount,
      coercedSeverityCount: parsed.coercedSeverityCount,
      duplicateCount: parsed.duplicateCount,
      durationMs,
      ...(sweep.record || sweep.degraded ? { sweep } : {}),
      ...(repositoryContextRecord || repositoryContextDegraded
        ? { repositoryContext: { record: repositoryContextRecord, degraded: repositoryContextDegraded } }
        : {}),
    };
  } catch (error) {
    if (reviewPublished) {
      throw error;
    }
    const reason = mapErrorToFailureReason(error, deadline.expired());
    // AC1: the sweep metadata this pass owes is decided here, by whether it
    // issued its review request — not by how far it got past that. A pass
    // that never issued one logs nothing sweep-related; the failure check run
    // below is `finalizeFailure`'s and deliberately carries no sweep fields,
    // so this record is logs-only.
    if (requestIssued) {
      if (classified && classification && sweepList) {
        logSweepPassRecord(deps, classification, sweepList.version);
      } else if (sweepList) {
        // The request went out carrying the list, but the response never
        // classified, so nothing about these categories was established.
        logSweepPassRecord(deps, notDetermined(sweepList), sweepList.version);
      } else if (sweepDegraded && !sweepDegradedReleased) {
        logSweepDegraded(deps, sweepDegraded);
      }
      if (!repositoryContextReleased && (repositoryContextRecord || repositoryContextDegraded)) {
        logRepositoryContext(deps, repositoryContextRecord, repositoryContextDegraded);
      }
    }
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
        terminalCheckRunPublished: false,
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
  if (error instanceof ChangesTooLargeError || error instanceof AuthoritativeDocsTooLargeError) {
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

/**
 * The sweep metadata a pass owes (AC1). Classified and degraded are mutually
 * exclusive: a degraded pass never loaded a list, so it has no per-category
 * record; a classified pass loads one, so it has no degraded record.
 */
function sweepMetadata(
  classification: SweepClassification | undefined,
  sweepList: SweepCategoryList | undefined,
  degraded: SweepDegradedRecord | undefined,
  deps: ReviewPassDeps,
  headSha: string,
): {
  record?: SweepPassRecord;
  degraded?: SweepDegradedRecord;
} {
  if (classification && sweepList) {
    const record = passRecord(classification, sweepList.version);
    logSweepPassRecord(deps, classification, sweepList.version, headSha);
    return { record };
  }
  return degraded ? { degraded } : {};
}

/** The `not_determined` record for a pass whose request carried the list but never classified. */
function notDetermined(list: SweepCategoryList): SweepClassification {
  return {
    categories: list.categories.map((category) => ({
      identifier: category.identifier,
      outcome: "not_determined" as const,
    })),
    findings: [],
    uncategorizedFindingCount: 0,
  };
}

function passRecord(classification: SweepClassification, listVersion: string): SweepPassRecord {
  return {
    listVersion,
    categories: classification.categories,
    findings: classification.findings,
    uncategorizedFindingCount: classification.uncategorizedFindingCount,
  };
}

/**
 * Logs the per-category record through `sweep_pass_record`. Carries counts and
 * category identifiers only — never a finding's title or body, which is
 * model-generated text the parser's limited redaction may not cover (AC20).
 */
function logSweepPassRecord(
  deps: ReviewPassDeps,
  classification: SweepClassification,
  listVersion: string,
  headSha?: string,
): void {
  deps.logger.event("sweep_pass_record", {
    listVersion,
    ...(headSha !== undefined ? { headSha } : {}),
    categories: classification.categories,
    findings: classification.findings,
    uncategorizedFindingCount: classification.uncategorizedFindingCount,
  });
}

function logSweepDegraded(deps: ReviewPassDeps, degraded: SweepDegradedRecord): void {
  if (degraded.kind === "sweep_enablement_unrecognized") {
    // The unrecognized value itself is deliberately absent (AC18) — it is
    // operator input, and only the fact of the unrecognized value is recorded.
    deps.logger.event("sweep_enablement_unrecognized", { unrecognized: true });
    return;
  }
  deps.logger.event("sweep-did-not-run", {
    reason: degraded.reason,
    detail: degraded.detail,
  });
}

interface RepositoryContextPhaseResult {
  repositoryContext?: {
    record?: RepositoryContextPassRecord;
    degraded?: RepositoryContextDegradedRecord;
  };
  candidatesForPrompt: RepositoryContextCandidate[];
}

const NO_REPOSITORY_CONTEXT: RepositoryContextPhaseResult = { candidatesForPrompt: [] };

/** AC10, D6: same-repository heads only, compared case-insensitively. An absent, empty, or unreadable head repository is fork-originated. */
function isSameRepositoryHead(headRepoFullName: string, owner: string, repo: string): boolean {
  return headRepoFullName.toLowerCase() === `${owner}/${repo}`.toLowerCase();
}

/** Same pattern as `src/webhook/webhook-job.ts`'s private helper of the same name: the earlier of two deadlines aborts the combined signal. */
function combineAbortSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  return AbortSignal.any([first, second]);
}

/**
 * Read-only repository context (#106). Applies the spec's outcome tests in
 * their recorded order — pre-review-execution passes never reach this
 * function at all, so it starts at the fork test — and never throws: any
 * error is caught inside and degrades to `unavailable` with `read_failed`
 * drops for every reference already requested, never reaching the shared
 * failure path (AC11).
 */
async function runRepositoryContextPhase(
  input: ReviewPassInput,
  pr: PullRequestMetadata,
  changedFiles: ChangedFile[],
  deps: ReviewPassDeps,
  deadlineSignal: AbortSignal,
  passStartMs: number,
): Promise<RepositoryContextPhaseResult> {
  // AC10: the fork exclusion precedes the switch and is fixed, not configurable.
  if (!isSameRepositoryHead(pr.headRepoFullName, input.owner, input.repo)) {
    return NO_REPOSITORY_CONTEXT;
  }

  if (deps.config.repositoryContextMode !== "on") {
    if (deps.config.repositoryContextModeRaw !== undefined) {
      return {
        repositoryContext: { degraded: { kind: "repository_context_switch_unrecognized" } },
        candidatesForPrompt: [],
      };
    }
    return NO_REPOSITORY_CONTEXT; // validly disabled — no record (AC19)
  }

  const maxCandidates = deps.config.maxRepositoryContextCandidates;
  const maxChars = deps.config.maxRepositoryContextChars;

  // Translates the GitHub contents seam's own unusable-content error into the
  // resolver's error type at this one boundary, so `symbol-resolver.ts` stays
  // free of a `src/github/` import while still distinguishing a real-but-
  // refused path (a symlink, a submodule, a directory) from a plain miss.
  const readFileWithSignal = (signal: AbortSignal): RepositoryContextReadFile => {
    return async (path, options) => {
      try {
        return await deps.github.readFileAtRef(input.owner, input.repo, path, pr.headSha, signal, options);
      } catch (error) {
        if (error instanceof RepositoryFileUnusableError) {
          throw new RepositoryContextUnusableContentError(error.path, error.reason);
        }
        throw error;
      }
    };
  };

  let requested: InternalRequestedReference[] = [];
  // Declared here so the `finally` below can safely dispose it whether or
  // not identification (which runs first, and can itself throw) ever let
  // control reach the point where this gets created.
  let contextDeadline: ReturnType<typeof createPassDeadline> | undefined;
  // Recorded fallback for the catch block below, which reaches it whenever
  // identification itself throws — before the pass-remaining-time-adjusted
  // figure a few lines down is ever computed.
  let timeBudgetMs = deps.config.repositoryContextTimeBudgetMs;

  try {
    // Candidate identification (step a) is bounded by the pass deadline
    // alone (D5) — never the tighter context budget. `timeBudgetMs` and
    // `contextDeadline` are deliberately not computed or armed until
    // identification has returned, so a slow changed-file read can never
    // consume the context budget before resolution — the phase this budget
    // is meant to bound — ever starts.
    const identified = await identifyCandidates(
      changedFiles.map((file) => file.path),
      buildCommentableLinesByFile(changedFiles),
      readFileWithSignal(deadlineSignal),
    );
    requested = identified.requested;

    // Computed *after* identification, so it reflects the pass budget
    // actually remaining once identification's own (potentially slow) reads
    // are done, never a stale figure captured before them.
    const remainingPassMs = Math.max(0, passStartMs + deps.config.passTimeoutMs - deps.clock.now());
    timeBudgetMs = Math.min(deps.config.repositoryContextTimeBudgetMs, remainingPassMs);

    if (identified.requested.length === 0) {
      const outcome: RepositoryContextOutcome =
        identified.unreadableChangedFilePaths.length > 0 ? "unavailable" : "nothing_to_resolve";
      return {
        repositoryContext: {
          record: {
            outcome,
            candidatesRequested: 0,
            candidatesResolved: 0,
            drops: [],
            unreadableChangedFilePaths: identified.unreadableChangedFilePaths,
            contentRequestCount: identified.contentRequestCount,
            charsUsed: 0,
            maxCandidates,
            maxChars,
            timeBudgetMs,
            timeUsedMs: 0,
            budgetFallbacks: deps.config.repositoryContextBudgetFallbacks,
          },
        },
        candidatesForPrompt: [],
      };
    }

    // Candidate resolution (steps b/c) is bounded by the *lesser* of the
    // context time budget and the pass deadline. A wall-clock check between
    // awaits (inside `buildSourceFileSet`) cannot stop a single read call
    // that itself stalls — only an abort signal threaded into that specific
    // call can. Arming a dedicated deadline here, only once identification
    // has already returned, and combining its signal with the pass deadline
    // is what makes a stalled contents request abort at the tighter
    // boundary instead of silently riding the pass's own (much larger)
    // budget.
    contextDeadline = createPassDeadline(timeBudgetMs, deps.deadlineClock);
    const resolveReadFile = readFileWithSignal(combineAbortSignals(deadlineSignal, contextDeadline.signal));

    const resolutionPhaseStartMs = deps.clock.now();
    const closure = await buildSourceFileSet(identified.changedSourceTexts, resolveReadFile, timeBudgetMs);
    const resolutions = resolveSymbols(closure.fileSet, identified.requested, closure);
    const resolutionPhaseElapsedMs = deps.clock.now() - resolutionPhaseStartMs;

    // `resolveSymbols` is synchronous and cannot itself be interrupted by any
    // `AbortSignal` — JS is single-threaded, so `contextDeadline`'s timer
    // cannot fire until synchronous execution yields back to the event
    // loop. `isResolutionFileSetOversized`'s size caps are what bound how
    // long that synchronous work can run; this check cannot make it
    // shorter. What it does guarantee is that the *record* is never
    // dishonestly optimistic about work that only finished after the
    // pass's own configured budget: if the deadline had already fired by
    // the time the (uninterruptible) compile returns, every candidate is
    // downgraded to `time_budget` rather than reported as resolved.
    const effectiveResolutions = contextDeadline.expired()
      ? identified.requested.map((ref) => ({ id: ref.id, reason: "time_budget" as const }))
      : resolutions;

    const built = buildRepositoryContextCandidates(identified.requested, effectiveResolutions);
    const ordered = [...built.candidates].sort(compareRepositoryContextCandidates);
    const budgeted = applyRepositoryContextBudgets(ordered, { maxCandidates, maxChars });
    const outcome = resolveRepositoryContextOutcome({
      candidatesRequested: identified.requested.length,
      candidatesResolved: budgeted.selected.length,
    });
    const charsUsed = budgeted.selected.reduce((sum, candidate) => sum + candidate.text.length, 0);

    return {
      repositoryContext: {
        record: {
          outcome,
          candidatesRequested: identified.requested.length,
          candidatesResolved: budgeted.selected.length,
          drops: [...built.drops, ...budgeted.drops],
          unreadableChangedFilePaths: identified.unreadableChangedFilePaths,
          contentRequestCount: identified.contentRequestCount + closure.contentRequestCount,
          charsUsed,
          maxCandidates,
          maxChars,
          timeBudgetMs,
          // The larger of the two measurements: buildSourceFileSet's own
          // internal figure (fetch time alone) and this phase's total wall
          // clock (fetch plus the synchronous compile) — never understating
          // real elapsed time spent for this budget.
          timeUsedMs: Math.max(closure.timeUsedMs, resolutionPhaseElapsedMs),
          budgetFallbacks: deps.config.repositoryContextBudgetFallbacks,
        },
      },
      candidatesForPrompt: budgeted.selected,
    };
  } catch (error) {
    deps.logger.event("repository_context_phase_failed", { message: String(error) });
    return {
      repositoryContext: {
        record: {
          outcome: "unavailable",
          candidatesRequested: requested.length,
          candidatesResolved: 0,
          drops: requested.map((ref) => ({
            kind: ref.kind,
            symbolName: ref.symbolName,
            path: ref.changedPath,
            line: ref.changedLine,
            reason: "read_failed" as const,
          })),
          unreadableChangedFilePaths: [],
          contentRequestCount: 0,
          charsUsed: 0,
          maxCandidates,
          maxChars,
          timeBudgetMs,
          timeUsedMs: 0,
          budgetFallbacks: deps.config.repositoryContextBudgetFallbacks,
        },
      },
      candidatesForPrompt: [],
    };
  } finally {
    contextDeadline?.dispose();
  }
}

/**
 * Logs the repository-context record or degraded state (Operational
 * Visibility → Logs). Carries counts, identifiers, and budget figures only
 * — never an excerpt body. Mutually exclusive, like the sweep's equivalent.
 */
function logRepositoryContext(
  deps: ReviewPassDeps,
  record: RepositoryContextPassRecord | undefined,
  degraded: RepositoryContextDegradedRecord | undefined,
): void {
  if (record) {
    deps.logger.event("repository_context_pass_record", { ...record });
    return;
  }
  if (degraded) {
    // The unrecognized value itself is deliberately absent (AC21) — only the
    // fact of the unrecognized value is recorded.
    deps.logger.event("repository_context_switch_unrecognized", { unrecognized: true });
  }
}

function skippedResult(
  skipReason: ReviewPassResult["skipReason"],
  startMs: number,
  deps: ReviewPassDeps,
  reviewedHeadSha?: string,
  sweep?: ReviewPassResult["sweep"],
  repositoryContext?: ReviewPassResult["repositoryContext"],
): ReviewPassResult {
  return {
    outcome: "skipped",
    skipReason,
    ...(reviewedHeadSha !== undefined ? { reviewedHeadSha } : {}),
    ...(sweep ? { sweep } : {}),
    ...(repositoryContext ? { repositoryContext } : {}),
    terminalCheckRunPublished: false,
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
    reviewedHeadSha: failure.headSha,
    terminalCheckRunPublished: true,
    findings: [],
    malformedCount: 0,
    coercedSeverityCount: 0,
    duplicateCount: 0,
    durationMs,
  };
}
