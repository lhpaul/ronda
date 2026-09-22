import {
  formatContentRefusal,
  validateCaptureFields,
  validateMissField,
  type ContentRefusalReason,
  type SourceScanCorpus,
} from "./miss-content-validator.js";
import {
  isCodexGithubReviewer,
} from "./miss-reviewer-aliases.js";
import {
  automaticIdentityKey,
  buildMissRecordId,
  deriveFindingTitle,
  findMissByIdentity,
  headsMatch,
  isAffectedCategory,
  isIntendedFollowUp,
  isMissVerdict,
  manualIdentityKey,
  MAX_FINDING_TEXT_CHARS,
  MAX_RATIONALE_CHARS,
  MAX_TITLE_CHARS,
  truncateBounded,
  type AffectedCategory,
  type CaptureSource,
  type ExternalReviewMissRecord,
  type IntendedFollowUp,
  type MissVerdict,
} from "./miss-record.js";
import {
  isKnownPullRequestHead,
  resolveRondaResultHead,
  type ExternalFindingCandidate,
  type PullRequestEvidence,
} from "./miss-github-evidence.js";

export type CaptureOutcomeKind =
  | "capture_refused"
  | "nothing_to_capture"
  | "record_written"
  | "record_updated";

export interface CaptureFindingInput {
  externalReviewer: string;
  location: string;
  locationUnresolved?: boolean;
  title?: string | null;
  text: string;
  affectedCategory?: string;
  verdict?: string;
  intendedFollowUp?: string;
  reviewedHeadSha?: string;
  sourceId?: string | null;
}

export interface CaptureGateInput {
  path: "automatic" | "manual";
  evidence: PullRequestEvidence;
  namedReviewer: string;
  /** Automatic path: presence / findings from Codex reader. */
  automatic?: {
    supported: boolean;
    presentOnPullRequest: boolean;
    findingsOnCurrentHead: ExternalFindingCandidate[];
    unparseableOnCurrentHead: boolean;
  };
  /** Manual path: one operator-supplied finding. */
  manualFinding?: CaptureFindingInput;
  /**
   * Automatic path: operator-supplied category (and optional judgements)
   * for a single extracted finding. Category is required (AC46).
   */
  automaticDefaults?: {
    affectedCategory?: string;
    verdict?: string;
    intendedFollowUp?: string;
  };
  /**
   * Automatic path: one entry per extracted finding when multiple findings
   * are present (Use Case 1 step 3). Length must match finding count.
   */
  automaticPerFinding?: Array<{
    affectedCategory?: string;
    verdict?: string;
    intendedFollowUp?: string;
  }>;
  existingRecords: ExternalReviewMissRecord[];
  corpusForHead: (reviewedHeadSha: string) => SourceScanCorpus;
  mergeBaseForHead: (reviewedHeadSha: string) => string;
  now?: Date;
}

export interface CaptureFindingResult {
  outcome: CaptureOutcomeKind;
  reason?: string;
  record?: ExternalReviewMissRecord;
  path?: string;
}

export interface CaptureGateResult {
  /** Whole-capture Stage 1 outcome when the capture aborts early. */
  wholeCapture?: CaptureFindingResult;
  findings: CaptureFindingResult[];
}

function refuse(reason: string): CaptureFindingResult {
  return { outcome: "capture_refused", reason };
}

function formatContentReason(reason: ContentRefusalReason): string {
  return formatContentRefusal(reason);
}

/**
 * Merge judgement fields for an update in place (AC43, AC47, AC51).
 * Defaults (unadjudicated / undecided) never overwrite a non-default value.
 */
export function mergeJudgementFields(input: {
  existing: ExternalReviewMissRecord;
  suppliedVerdict?: MissVerdict;
  suppliedFollowUp?: IntendedFollowUp;
}): Pick<
  ExternalReviewMissRecord,
  "verdict" | "intendedFollowUp" | "rationale" | "rationaleTruncated"
> {
  let verdict = input.existing.verdict;
  let intendedFollowUp = input.existing.intendedFollowUp;
  let rationale = input.existing.rationale;
  let rationaleTruncated = input.existing.rationaleTruncated;
  let cleared = false;

  if (input.suppliedVerdict !== undefined) {
    if (input.suppliedVerdict === "unadjudicated") {
      // Treat as omit when existing is non-default (AC51).
    } else if (input.suppliedVerdict !== input.existing.verdict) {
      verdict = input.suppliedVerdict;
      cleared = true;
    }
  }

  if (input.suppliedFollowUp !== undefined) {
    if (input.suppliedFollowUp === "undecided") {
      // Treat as omit when existing is non-default (AC51).
    } else if (input.suppliedFollowUp !== input.existing.intendedFollowUp) {
      intendedFollowUp = input.suppliedFollowUp;
      cleared = true;
    }
  }

  if (cleared) {
    rationale = undefined;
    rationaleTruncated = undefined;
  }

  return { verdict, intendedFollowUp, rationale, rationaleTruncated };
}

function parseOptionalVerdict(
  value: string | undefined,
): { ok: true; value?: MissVerdict } | { ok: false; reason: string } {
  if (value === undefined || value === "") {
    return { ok: true };
  }
  if (!isMissVerdict(value)) {
    return {
      ok: false,
      reason: `Capture refused: verdict must be one of: ${[
        "unadjudicated",
        "true_positive",
        "false_positive",
        "out_of_scope",
        "already_found",
      ].join(", ")}.`,
    };
  }
  return { ok: true, value };
}

function parseOptionalFollowUp(
  value: string | undefined,
): { ok: true; value?: IntendedFollowUp } | { ok: false; reason: string } {
  if (value === undefined || value === "") {
    return { ok: true };
  }
  if (!isIntendedFollowUp(value)) {
    return {
      ok: false,
      reason: `Capture refused: intended follow-up must be one of: ${[
        "undecided",
        "eval_record",
        "prompt_change",
        "backlog_item",
        "no_action",
      ].join(", ")}.`,
    };
  }
  return { ok: true, value };
}

/** Stage 1 conditions 1–3 (whole-capture), shared by CLI preflight and gate. */
export function evaluateCaptureStage1ThroughCondition3(input: {
  evidence: PullRequestEvidence;
  namedReviewer: string;
}): CaptureFindingResult | null {
  if (!input.evidence.currentHeadSha) {
    return refuse(
      "Capture refused: the pull request or its current head could not be resolved.",
    );
  }
  if (!input.namedReviewer.trim()) {
    return refuse(
      "Capture refused: a reviewer name is required; manual entry is available.",
    );
  }
  if (input.evidence.rondaResultHeadShas.length === 0) {
    return refuse(
      "Capture refused: there is no Ronda result to compare against on this pull request.",
    );
  }
  return null;
}

function stage1(input: CaptureGateInput): CaptureFindingResult | null {
  const through3 = evaluateCaptureStage1ThroughCondition3({
    evidence: input.evidence,
    namedReviewer: input.namedReviewer,
  });
  if (through3) {
    return through3;
  }

  if (input.path === "automatic") {
    const automatic = input.automatic;
    if (!automatic) {
      return refuse(
        "Capture refused: automatic capture evidence was not available.",
      );
    }

    // Condition 4 — unsupported or no presence
    if (!automatic.supported) {
      return refuse(
        "Capture refused: the named reviewer is not the Codex GitHub reviewer automatic reading supports; use manual entry instead.",
      );
    }
    if (!automatic.presentOnPullRequest) {
      return refuse(
        "Capture refused: the Codex GitHub reviewer has no readable presence on this pull request; use manual entry instead.",
      );
    }

    // Condition 5 — silent on current head (success)
    if (
      automatic.findingsOnCurrentHead.length === 0 &&
      !automatic.unparseableOnCurrentHead
    ) {
      return {
        outcome: "nothing_to_capture",
        reason: `Nothing to capture on the current head ${input.evidence.currentHeadSha}.`,
      };
    }

    // Condition 6 — unparseable
    if (automatic.unparseableOnCurrentHead) {
      return refuse(
        "Capture refused: the reviewer output on the current head could not be interpreted as findings; use manual entry instead.",
      );
    }
  }

  return null;
}

function validateFindingStage2(input: {
  reviewer: string;
  location: string;
  text: string;
  category?: string;
  verdict?: string;
  followUp?: string;
  automaticFindingLabel?: string;
}): CaptureFindingResult | null {
  // Condition 7 — required inputs
  if (!input.reviewer.trim()) {
    return refuse("Capture refused: required input 'externalReviewer' is missing.");
  }
  if (!input.location.trim()) {
    return refuse("Capture refused: required input 'location' is missing.");
  }
  if (!input.text.trim()) {
    return refuse("Capture refused: required input 'text' is missing.");
  }
  if (!input.category || !input.category.trim()) {
    const suffix = input.automaticFindingLabel
      ? ` Supply --categories in extraction order (${input.automaticFindingLabel}).`
      : "";
    return refuse(
      `Capture refused: required input 'affectedCategory' is missing.${suffix}`,
    );
  }

  // Condition 8 — category closed set
  if (!isAffectedCategory(input.category.trim())) {
    return refuse(
      `Capture refused: affected category must be one of: ${[
        "durability",
        "idempotency",
        "retries",
        "timeouts",
        "partial_success",
        "concurrency",
        "security",
        "correctness",
        "configuration",
        "observability",
        "other",
      ].join(", ")}.`,
    );
  }

  // Condition 9 — verdict / follow-up enums
  const verdict = parseOptionalVerdict(input.verdict);
  if (!verdict.ok) {
    return refuse(verdict.reason);
  }
  const followUp = parseOptionalFollowUp(input.followUp);
  if (!followUp.ok) {
    return refuse(followUp.reason);
  }

  return null;
}

function processOneFinding(input: {
  gate: CaptureGateInput;
  finding: CaptureFindingInput;
  captureSource: CaptureSource;
  findingIndex?: number;
  findingCount?: number;
}): CaptureFindingResult {
  const stage2 = validateFindingStage2({
    reviewer: input.finding.externalReviewer,
    location: input.finding.location,
    text: input.finding.text,
    category: input.finding.affectedCategory,
    verdict: input.finding.verdict,
    followUp: input.finding.intendedFollowUp,
    automaticFindingLabel:
      input.captureSource === "automatic" &&
      input.findingCount !== undefined &&
      input.findingCount > 1 &&
      input.findingIndex !== undefined
        ? `finding ${input.findingIndex + 1} of ${input.findingCount} at ${input.finding.location.trim() || "(no location)"}`
        : undefined,
  });
  if (stage2) {
    return stage2;
  }

  const reviewedHeadSha =
    input.finding.reviewedHeadSha?.trim() ||
    input.gate.evidence.currentHeadSha;

  // Stage 3 — reviewed head must be a real PR head when supplied
  if (input.finding.reviewedHeadSha?.trim()) {
    if (
      !isKnownPullRequestHead({
        headSha: reviewedHeadSha,
        pushOrderedHeadShas: input.gate.evidence.pushOrderedHeadShas,
        currentHeadSha: input.gate.evidence.currentHeadSha,
        rondaResultHeadShas: input.gate.evidence.rondaResultHeadShas,
      })
    ) {
      return refuse(
        "Capture refused: supplied reviewed head is malformed or was never a head of this pull request.",
      );
    }
  }

  // Preserve explicit titles as supplied (AC30 storage); identity canonicalizes.
  const derivedTitle = deriveFindingTitle(input.finding.text);
  const storedTitle =
    input.finding.title !== undefined &&
    input.finding.title !== null &&
    input.finding.title.trim().length > 0
      ? input.finding.title
      : derivedTitle;
  if (!storedTitle || storedTitle.trim().length === 0) {
    return refuse("Capture refused: required input 'text' is missing.");
  }

  const scanFields = {
    externalReviewer: input.finding.externalReviewer,
    reviewedHeadSha: input.finding.reviewedHeadSha?.trim()
      ? input.finding.reviewedHeadSha
      : undefined,
    location: input.finding.location,
    title: storedTitle,
    text: input.finding.text,
  };

  // Credential scan before corpus resolution (refusal precedence over baseline).
  const credentialRefusal = validateCaptureFields({
    fields: scanFields,
    scanSourceExcerpts: false,
  });
  if (credentialRefusal) {
    return refuse(formatContentReason(credentialRefusal));
  }

  let corpus: SourceScanCorpus;
  let mergeBaseSha: string;
  try {
    mergeBaseSha = input.gate.mergeBaseForHead(reviewedHeadSha);
    corpus = input.gate.corpusForHead(reviewedHeadSha);
  } catch (error: unknown) {
    return refuse(
      `Capture refused: could not resolve source/diff baseline (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
  }

  // Stage 3 — diff / source scan before truncation (full title + text)
  const contentRefusal = validateCaptureFields({
    fields: scanFields,
    corpus,
    scanSourceExcerpts: true,
  });
  if (contentRefusal) {
    return refuse(formatContentReason(contentRefusal));
  }

  // Truncate only after scans pass.
  const truncatedText = truncateBounded(
    input.finding.text,
    MAX_FINDING_TEXT_CHARS,
  );
  const truncatedTitle = truncateBounded(storedTitle, MAX_TITLE_CHARS);

  const rondaResultHeadSha = resolveRondaResultHead({
    reviewedHeadSha,
    pushOrderedHeadShas: input.gate.evidence.pushOrderedHeadShas,
    rondaResultHeadShas: input.gate.evidence.rondaResultHeadShas,
    commitOrderShas: input.gate.evidence.commitOrderShas,
  });
  if (!rondaResultHeadSha) {
    return refuse(
      "Capture refused: there is no Ronda result to compare against on this pull request.",
    );
  }

  const staleEvidence = !headsMatch(reviewedHeadSha, rondaResultHeadSha);
  const category = input.finding.affectedCategory!.trim() as AffectedCategory;
  const verdictParse = parseOptionalVerdict(input.finding.verdict);
  const followUpParse = parseOptionalFollowUp(input.finding.intendedFollowUp);
  if (!verdictParse.ok) {
    return refuse(verdictParse.reason);
  }
  if (!followUpParse.ok) {
    return refuse(followUpParse.reason);
  }

  const now = (input.gate.now ?? new Date()).toISOString();
  const locationUnresolved =
    input.finding.locationUnresolved === true ||
    input.finding.location.trim().toLowerCase() === "unresolved";

  if (input.captureSource === "automatic") {
    const sourceId = input.finding.sourceId;
    if (!sourceId) {
      return refuse(
        "Capture refused: automatic capture is missing a source identifier.",
      );
    }
    const identityKey = automaticIdentityKey({
      repository: input.gate.evidence.repository,
      pullNumber: input.gate.evidence.pullNumber,
      sourceId,
    });
    const existing = findMissByIdentity(input.gate.existingRecords, identityKey);
    if (!existing) {
      const id = buildMissRecordId({
        repository: input.gate.evidence.repository,
        pullNumber: input.gate.evidence.pullNumber,
        captureSource: "automatic",
        identityKey,
      });
      const record: ExternalReviewMissRecord = {
        id,
        repository: input.gate.evidence.repository,
        pullNumber: input.gate.evidence.pullNumber,
        reviewedHeadSha,
        rondaResultHeadSha,
        staleEvidence,
        externalReviewer: input.finding.externalReviewer,
        location: input.finding.location,
        locationUnresolved,
        title: truncatedTitle.value,
        text: truncatedText.value,
        textTruncated: truncatedText.truncated,
        verdict: verdictParse.value ?? "unadjudicated",
        affectedCategory: category,
        intendedFollowUp: followUpParse.value ?? "undecided",
        captureSource: "automatic",
        sourceId,
        capturedAt: now,
        updatedAt: now,
        mergeBaseSha,
      };
      return { outcome: "record_written", record };
    }

    const merged = mergeJudgementFields({
      existing,
      suppliedVerdict: verdictParse.value,
      suppliedFollowUp: followUpParse.value,
    });
    const record: ExternalReviewMissRecord = {
      ...existing,
      reviewedHeadSha,
      rondaResultHeadSha,
      staleEvidence,
      externalReviewer: input.finding.externalReviewer,
      location: input.finding.location,
      locationUnresolved,
      title: truncatedTitle.value,
      text: truncatedText.value,
      textTruncated: truncatedText.truncated,
      affectedCategory: category,
      verdict: merged.verdict,
      intendedFollowUp: merged.intendedFollowUp,
      rationale: merged.rationale,
      rationaleTruncated: merged.rationaleTruncated,
      updatedAt: now,
      mergeBaseSha,
      // Preserve identity fields
      captureSource: "automatic",
      sourceId: existing.sourceId,
      id: existing.id,
      capturedAt: existing.capturedAt ?? now,
    };
    return { outcome: "record_updated", record };
  }

  // Manual identity always uses full pre-truncation title/text (AC41).
  // Pass known heads so abbreviated vs full SHA share one digest (AC30) and
  // Codex aliases collapse via canonicalizeReviewerForIdentity (AC39).
  const knownHeadShas = [
    ...input.gate.evidence.pushOrderedHeadShas,
    ...input.gate.evidence.rondaResultHeadShas,
    input.gate.evidence.currentHeadSha,
  ];
  const identityKey = manualIdentityKey({
    repository: input.gate.evidence.repository,
    pullNumber: input.gate.evidence.pullNumber,
    externalReviewer: input.finding.externalReviewer,
    reviewedHeadSha,
    location: input.finding.location,
    title: storedTitle,
    text: input.finding.text,
    knownHeadShas,
  });

  const existing = findMissByIdentity(input.gate.existingRecords, identityKey);

  if (!existing) {
    const id = buildMissRecordId({
      repository: input.gate.evidence.repository,
      pullNumber: input.gate.evidence.pullNumber,
      captureSource: "manual",
      identityKey,
    });
    const record: ExternalReviewMissRecord = {
      id,
      repository: input.gate.evidence.repository,
      pullNumber: input.gate.evidence.pullNumber,
      reviewedHeadSha,
      rondaResultHeadSha,
      staleEvidence,
      externalReviewer: input.finding.externalReviewer,
      location: input.finding.location,
      locationUnresolved,
      title: truncatedTitle.value,
      text: truncatedText.value,
      textTruncated: truncatedText.truncated,
      verdict: verdictParse.value ?? "unadjudicated",
      affectedCategory: category,
      intendedFollowUp: followUpParse.value ?? "undecided",
      captureSource: "manual",
      sourceId: null,
      identityDigest: identityKey,
      capturedAt: now,
      updatedAt: now,
      mergeBaseSha,
    };
    return { outcome: "record_written", record };
  }

  const merged = mergeJudgementFields({
    existing,
    suppliedVerdict: verdictParse.value,
    suppliedFollowUp: followUpParse.value,
  });
  const record: ExternalReviewMissRecord = {
    ...existing,
    reviewedHeadSha,
    rondaResultHeadSha,
    staleEvidence,
    externalReviewer: input.finding.externalReviewer,
    location: input.finding.location,
    locationUnresolved,
    title: truncatedTitle.value,
    text: truncatedText.value,
    textTruncated: truncatedText.truncated,
    affectedCategory: category,
    verdict: merged.verdict,
    intendedFollowUp: merged.intendedFollowUp,
    rationale: merged.rationale,
    rationaleTruncated: merged.rationaleTruncated,
    updatedAt: now,
    mergeBaseSha,
    captureSource: "manual",
    sourceId: null,
    identityDigest: identityKey,
    id: existing.id,
    capturedAt: existing.capturedAt ?? now,
  };
  return { outcome: "record_updated", record };
}

type AutomaticFindingJudgement = {
  affectedCategory?: string;
  verdict?: string;
  intendedFollowUp?: string;
};

function resolveAutomaticFindingJudgements(input: {
  count: number;
  defaults?: AutomaticFindingJudgement;
  perFinding?: AutomaticFindingJudgement[];
}): AutomaticFindingJudgement[] {
  if (input.count === 0) {
    return [];
  }
  if (input.count === 1) {
    const single = input.perFinding?.[0] ?? input.defaults ?? {};
    return [single];
  }
  // Multi-finding: Stage 2 is per finding (AC35). Pad missing slots with empty
  // judgements so siblings with valid categories still write; missing/invalid
  // categories refuse only that finding.
  const judgements: AutomaticFindingJudgement[] = [];
  for (let index = 0; index < input.count; index += 1) {
    judgements.push(input.perFinding?.[index] ?? {});
  }
  return judgements;
}

/**
 * Four-stage Capture Decision Gate. Stage 1 is whole-capture; Stages 2–4 are
 * per finding.
 */
export function runCaptureDecisionGate(
  input: CaptureGateInput,
): CaptureGateResult {
  const stage1Result = stage1(input);
  if (stage1Result) {
    if (stage1Result.outcome === "nothing_to_capture") {
      return { wholeCapture: stage1Result, findings: [] };
    }
    return { wholeCapture: stage1Result, findings: [] };
  }

  if (input.path === "automatic") {
    const candidates = input.automatic?.findingsOnCurrentHead ?? [];
    const judgements = resolveAutomaticFindingJudgements({
      count: candidates.length,
      defaults: input.automaticDefaults,
      perFinding: input.automaticPerFinding,
    });
    const findings = candidates.map((candidate, index) =>
      processOneFinding({
        gate: input,
        captureSource: "automatic",
        findingIndex: index,
        findingCount: candidates.length,
        finding: {
          externalReviewer: candidate.externalReviewer || input.namedReviewer,
          location: candidate.location,
          locationUnresolved: candidate.locationUnresolved,
          title: candidate.title,
          text: candidate.text,
          affectedCategory: judgements[index]?.affectedCategory,
          verdict: judgements[index]?.verdict,
          intendedFollowUp: judgements[index]?.intendedFollowUp,
          reviewedHeadSha: candidate.reviewedHeadSha || input.evidence.currentHeadSha,
          sourceId: candidate.sourceId,
        },
      }),
    );
    return { findings };
  }

  if (!input.manualFinding) {
    return {
      wholeCapture: refuse(
        "Capture refused: manual capture requires finding details.",
      ),
      findings: [],
    };
  }

  return {
    findings: [
      processOneFinding({
        gate: input,
        captureSource: "manual",
        finding: {
          ...input.manualFinding,
          externalReviewer:
            input.manualFinding.externalReviewer || input.namedReviewer,
        },
      }),
    ],
  };
}

export interface AdjudicateInput {
  record: ExternalReviewMissRecord;
  verdict?: string;
  intendedFollowUp?: string;
  rationale?: string;
  corpus?: SourceScanCorpus;
  now?: Date;
}

export function adjudicateMissRecord(
  input: AdjudicateInput,
):
  | { ok: true; record: ExternalReviewMissRecord }
  | { ok: false; reason: string } {
  const hasVerdict = input.verdict !== undefined && input.verdict !== "";
  const hasFollowUp =
    input.intendedFollowUp !== undefined && input.intendedFollowUp !== "";

  if (!hasVerdict && !hasFollowUp) {
    return {
      ok: false,
      reason:
        "Adjudication refused: supply a verdict, an intended follow-up, or both.",
    };
  }

  // Precedence: missing rationale, invalid enum, credential, source/diff
  if (!input.rationale || !input.rationale.trim()) {
    return {
      ok: false,
      reason: "Adjudication refused: a rationale is required.",
    };
  }

  let nextVerdict = input.record.verdict;
  let nextFollowUp = input.record.intendedFollowUp;

  if (hasVerdict) {
    if (!isMissVerdict(input.verdict!)) {
      return {
        ok: false,
        reason: `Adjudication refused: verdict must be one of: ${[
          "unadjudicated",
          "true_positive",
          "false_positive",
          "out_of_scope",
          "already_found",
        ].join(", ")}.`,
      };
    }
    if (input.verdict === "unadjudicated") {
      return {
        ok: false,
        reason:
          "Adjudication refused: verdict cannot be set back to unadjudicated.",
      };
    }
    nextVerdict = input.verdict;
  }

  if (hasFollowUp) {
    if (!isIntendedFollowUp(input.intendedFollowUp!)) {
      return {
        ok: false,
        reason: `Adjudication refused: intended follow-up must be one of: ${[
          "undecided",
          "eval_record",
          "prompt_change",
          "backlog_item",
          "no_action",
        ].join(", ")}.`,
      };
    }
    if (input.intendedFollowUp === "undecided") {
      return {
        ok: false,
        reason:
          "Adjudication refused: intended follow-up cannot be set back to undecided.",
      };
    }
    nextFollowUp = input.intendedFollowUp;
  }

  if (!input.corpus) {
    return {
      ok: false,
      reason:
        "Adjudication refused: source corpus could not be loaded for sensitive-content scanning.",
    };
  }

  const rationaleRefusal = validateMissField({
    field: "rationale",
    value: input.rationale,
    corpus: input.corpus,
    scanSourceExcerpts: true,
  });
  if (rationaleRefusal) {
    if (rationaleRefusal.kind === "credential") {
      return {
        ok: false,
        reason: `Adjudication refused: rationale matched credential form '${rationaleRefusal.form}'.`,
      };
    }
    return {
      ok: false,
      reason:
        "Adjudication refused: rationale carried source or diff content.",
    };
  }

  const truncated = truncateBounded(input.rationale, MAX_RATIONALE_CHARS);
  const now = (input.now ?? new Date()).toISOString();

  return {
    ok: true,
    record: {
      ...input.record,
      verdict: nextVerdict,
      intendedFollowUp: nextFollowUp,
      rationale: truncated.value,
      rationaleTruncated: truncated.truncated,
      updatedAt: now,
    },
  };
}

export function canDeleteMissRecord(record: ExternalReviewMissRecord): {
  allowed: boolean;
  reason?: string;
} {
  if (
    record.verdict === "unadjudicated" &&
    record.intendedFollowUp === "undecided"
  ) {
    return { allowed: true };
  }
  return {
    allowed: false,
    reason:
      "Deletion refused: the record carries a verdict or intended follow-up a human has already set; use adjudication instead of deletion.",
  };
}

export function isAutomaticReviewerSupported(reviewer: string): boolean {
  return isCodexGithubReviewer(reviewer);
}
