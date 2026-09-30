import { severityLabel } from "../domain/severity.js";
import {
  REVIEW_COMMAND,
  type FailureReason,
  type Finding,
  type RepositoryContextDegradedRecord,
  type RepositoryContextOutcome,
  type RepositoryContextPassRecord,
  type SweepDegradedRecord,
  type SweepPassRecord,
  type TriggerMode,
} from "../domain/review-pass.types.js";
import type { DurabilityModeResolution } from "../review/durability-mode.js";
import type { ExcludedFile } from "../review/path-exclusion.js";

export interface SeverityCounts {
  blocking: number;
  important: number;
  nit: number;
}

export interface ReviewSummaryInput {
  changedFileCount: number;
  additions: number;
  deletions: number;
  findings: Finding[];
  /** Findings not attached to a changed line — listed individually in the summary. */
  unmappedFindings: Finding[];
  modelName: string;
  durationMs: number;
  trigger: TriggerMode;
  malformedCount: number;
  coercedSeverityCount: number;
  duplicateCount: number;
  durabilityMode?: DurabilityModeResolution;
  /**
   * The active category-forced sweep (#105, AC3). The review body states only
   * that the sweep ran and which list version it used — the per-category record
   * and its attribution never reach the published review (AC1), and display
   * labels never appear here.
   */
  sweep?: { listVersion: string };
  /**
   * Read-only repository context (#106, AC3). The review body states only
   * the outcome, in the same one-line form existing mode activations take —
   * no count, identifier, drop reason, or budget figure ever reaches it.
   */
  repositoryContext?: { outcome: RepositoryContextOutcome };
  /**
   * Files excluded from review before prompt construction (#134) —
   * lockfiles, generated/minified output, binary or patchless files, and any
   * repository-configured glob. Always rendered when non-empty, so an
   * exclusion is never silent; when every changed file was excluded, the
   * summary states that explicitly instead of the ordinary "No findings."
   * text a clean review would otherwise show.
   */
  excludedFiles?: ExcludedFile[];
}

/** Bounds the excluded-file list rendered in the summary body (#134). */
const MAX_EXCLUDED_FILES_LISTED = 20;
// Cumulative cap on rendered path characters: a valid Git path can be thousands
// of characters, so the entry count alone does not bound the review body.
const MAX_EXCLUDED_FILES_LISTED_CHARS = 2_000;

/** The spec's display labels for a repository-context outcome (Statuses / Enum Values). */
const REPOSITORY_CONTEXT_OUTCOME_LABELS: Record<RepositoryContextOutcome, string> = {
  used: "Repository context used",
  partial: "Repository context partial",
  unavailable: "Repository context unavailable",
  nothing_to_resolve: "Repository context: nothing to resolve",
};

export function countBySeverity(findings: Finding[]): SeverityCounts {
  const counts: SeverityCounts = { blocking: 0, important: 0, nit: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

export const RONDA_REVIEW_HEADING = "## Ronda review";

/** Renders the review body: what was reviewed, severity counts, model, duration, findings list. */
export function buildReviewSummary(input: ReviewSummaryInput): string {
  const counts = countBySeverity(input.findings);
  const lines: string[] = [];

  lines.push(RONDA_REVIEW_HEADING);
  lines.push("");
  lines.push(
    `Reviewed ${input.changedFileCount} changed file(s) (+${input.additions}/-${input.deletions}).`,
  );
  lines.push(`Model: ${input.modelName}`);
  lines.push(`Duration: ${formatDuration(input.durationMs)}`);
  lines.push(
    `Trigger: ${
      input.trigger === "manual"
        ? `Manually requested with \`${REVIEW_COMMAND}\``
        : "Automatic"
    }`,
  );
  lines.push("");

  if (input.durabilityMode) {
    lines.push(...renderDurabilityModeSection(input.durabilityMode));
    lines.push("");
  }

  if (input.sweep) {
    lines.push("### Category-forced sweep");
    lines.push("");
    lines.push(`Sweep active. Category list version: \`${input.sweep.listVersion}\``);
    lines.push("");
  }

  if (input.repositoryContext) {
    lines.push(`Repository context: ${REPOSITORY_CONTEXT_OUTCOME_LABELS[input.repositoryContext.outcome]}.`);
    lines.push("");
  }

  const excludedFiles = input.excludedFiles ?? [];
  if (excludedFiles.length > 0) {
    lines.push(...renderExcludedFilesSection(excludedFiles));
    lines.push("");
  }

  // #134: a PR whose every file was excluded must say so explicitly rather
  // than fall into the ordinary "No findings." text a genuinely clean review
  // would show — no changed-file content was sent to the model for this pass
  // (PR metadata and guidance may still be present).
  const allFilesExcluded = input.changedFileCount === 0 && excludedFiles.length > 0;
  if (allFilesExcluded) {
    lines.push(
      "Every changed file was excluded from review — no changed-file content was sent to the model for this pass.",
    );
  } else if (input.findings.length === 0) {
    lines.push("No findings.");
  } else {
    lines.push("### Findings by severity");
    lines.push("");
    lines.push("| Severity | Count |");
    lines.push("| --- | --- |");
    lines.push(`| ${severityLabel("blocking")} | ${counts.blocking} |`);
    lines.push(`| ${severityLabel("important")} | ${counts.important} |`);
    lines.push(`| ${severityLabel("nit")} | ${counts.nit} |`);
  }

  if (input.unmappedFindings.length > 0) {
    lines.push("");
    lines.push("### Findings not attached to a changed line");
    lines.push("");
    for (const finding of input.unmappedFindings) {
      lines.push(
        `- **${severityLabel(finding.severity)}** — \`${finding.path}\`: ${finding.title} — ${finding.body}`,
      );
    }
  }

  if (
    input.malformedCount > 0 ||
    input.coercedSeverityCount > 0 ||
    input.duplicateCount > 0
  ) {
    lines.push("");
    lines.push("### Parsing notes");
    if (input.malformedCount > 0) {
      lines.push(
        `- ${input.malformedCount} finding(s) from the model were malformed and dropped.`,
      );
    }
    if (input.coercedSeverityCount > 0) {
      lines.push(
        `- ${input.coercedSeverityCount} finding(s) had an unrecognised severity coerced to ${severityLabel("nit")}.`,
      );
    }
    if (input.duplicateCount > 0) {
      lines.push(`- ${input.duplicateCount} duplicate finding(s) were removed.`);
    }
  }

  return lines.join("\n");
}

/**
 * Renders `text` as a CommonMark inline code span that is safe for arbitrary
 * input (including text that itself contains backticks). Code spans cannot
 * escape backticks with a backslash, so the delimiter run must be longer
 * than the longest backtick run in `text`, per the CommonMark spec. A
 * leading/trailing space is added as padding when `text` starts or ends with
 * a backtick (or space) so the delimiter doesn't visually merge with it.
 */
function renderInlineCode(text: string): string {
  const backtickRuns = text.match(/`+/g) ?? [];
  const longestRun = backtickRuns.reduce((max, run) => Math.max(max, run.length), 0);
  const fence = "`".repeat(longestRun + 1);
  const needsPadding =
    text.startsWith("`") || text.endsWith("`") || text.startsWith(" ") || text.endsWith(" ");
  const body = needsPadding ? ` ${text} ` : text;
  return `${fence}${body}${fence}`;
}

/**
 * Renders the excluded-files section (#134): a count plus a bounded list, so
 * an exclusion is always visible rather than silently dropping the file from
 * the "Reviewed N changed file(s)" line above with no further explanation.
 */
function renderExcludedFilesSection(excludedFiles: ExcludedFile[]): string[] {
  const lines = ["### Excluded from review", ""];
  lines.push(`${excludedFiles.length} file(s) excluded before review:`);
  let listedCount = 0;
  let renderedChars = 0;
  for (const file of excludedFiles.slice(0, MAX_EXCLUDED_FILES_LISTED)) {
    const entry = `- ${renderInlineCode(file.path)}`;
    if (listedCount > 0 && renderedChars + entry.length > MAX_EXCLUDED_FILES_LISTED_CHARS) {
      break;
    }
    lines.push(entry);
    listedCount += 1;
    renderedChars += entry.length;
  }
  const remaining = excludedFiles.length - listedCount;
  if (remaining > 0) {
    lines.push(`- (+${remaining} more)`);
  }
  return lines;
}

function renderDurabilityModeSection(mode: DurabilityModeResolution): string[] {
  const lines: string[] = ["### Durability mode", ""];
  lines.push(`State: \`${mode.state}\``);
  if (mode.state === "active") {
    lines.push(`Activation reason: \`${mode.activationReason}\``);
    const families = mode.scenarioFamiliesInScope.join(", ") || "(none)";
    lines.push(`Scenario families in scope: ${families}`);
    if (mode.scenarioFamiliesNa.length > 0) {
      for (const entry of mode.scenarioFamiliesNa) {
        lines.push(`- N/A \`${entry.family}\`: ${entry.reason}`);
      }
    }
  } else if (mode.state === "unavailable") {
    lines.push(`Unavailable reason: \`${mode.unavailableReason}\``);
  } else if (mode.inactiveReason === "non_implementation_stage") {
    lines.push("Inactive because the pull request is not at the implementation review stage.");
  } else if (mode.inactiveReason === "automatic_rules_did_not_match") {
    lines.push("Automatic activation rules did not match changed surfaces.");
  } else if (mode.inactiveReason === "operator_override") {
    lines.push("Operator override disabled the mode for this run.");
  }
  return lines;
}

export interface CheckRunOutputInput {
  outcome: "succeeded" | "failed";
  findingCounts: SeverityCounts;
  modelName: string;
  durationMs: number;
  failureReason?: FailureReason;
  /**
   * The per-category record (#105, AC1). Only a check run whose outcome is a
   * review carries it; the failure path never receives sweep fields, so a
   * failure check-run output is byte-identical to a pre-feature one.
   */
  sweep?: SweepPassRecord;
  /** The degraded states (AC18, AC19) — never both with `sweep`, since a degraded pass classified nothing. */
  sweepDegraded?: SweepDegradedRecord;
  /**
   * The per-pass repository-context record (#106, AC3). Only a check run
   * whose outcome is a review carries it; the failure path never receives
   * this field, so a failure check-run output is byte-identical to a
   * pre-feature one. Never carries an excerpt body — only identifiers,
   * counts, and budget figures.
   */
  repositoryContext?: RepositoryContextPassRecord;
  /** AC21: an unrecognized switch value — never both with `repositoryContext`. */
  repositoryContextDegraded?: RepositoryContextDegradedRecord;
}

export interface CheckRunOutput {
  title: string;
  summary: string;
}

/** Renders the check-run title and detail text. See Operational Visibility in the spec. */
export function buildCheckRunOutput(input: CheckRunOutputInput): CheckRunOutput {
  if (input.outcome === "succeeded") {
    const total =
      input.findingCounts.blocking +
      input.findingCounts.important +
      input.findingCounts.nit;
    const title =
      total === 0 ? "Review posted — no findings" : `Review posted — ${total} finding(s)`;
    const summary = [
      `Model: ${input.modelName}`,
      `Duration: ${formatDuration(input.durationMs)}`,
      `${severityLabel("blocking")}: ${input.findingCounts.blocking}, ${severityLabel("important")}: ${input.findingCounts.important}, ${severityLabel("nit")}: ${input.findingCounts.nit}`,
      ...renderSweepCheckRunLines(input),
      ...renderRepositoryContextCheckRunLines(input),
    ].join("\n");
    return { title, summary };
  }

  const reasonText = describeFailureReason(input.failureReason);
  const title = `Review failed — ${reasonText}`;
  const summary = [
    `Model: ${input.modelName}`,
    `Duration: ${formatDuration(input.durationMs)}`,
    `Reason: ${reasonText}`,
    `Ask for another pass with \`${REVIEW_COMMAND}\`.`,
  ].join("\n");
  return { title, summary };
}

/**
 * The sweep lines the successful check-run output carries (#105, AC1, AC18,
 * AC19). Exactly one of `sweep` / `sweepDegraded` is rendered, because a
 * degraded pass classified nothing. Neither variant states a finding's text:
 * the record deliberately carries no finding title or body, so nothing here
 * can echo model-generated content onto a log-adjacent surface.
 */
function renderSweepCheckRunLines(input: CheckRunOutputInput): string[] {
  if (input.sweep) {
    const lines = ["Category-forced sweep:"];
    for (const category of input.sweep.categories) {
      lines.push(`- ${category.identifier}: ${category.outcome}`);
    }
    for (const finding of input.sweep.findings) {
      const categories =
        finding.categories.length > 0 ? finding.categories.join(", ") : "uncategorized";
      lines.push(`- finding ${finding.publicationIndex}: ${categories}`);
    }
    lines.push(`Uncategorized findings: ${input.sweep.uncategorizedFindingCount}`);
    return lines;
  }

  if (!input.sweepDegraded) {
    return [];
  }

  if (input.sweepDegraded.kind === "sweep-did-not-run") {
    // No list version: the pass used none, and stating one it never loaded
    // would be the false claim AC19's degraded record exists to avoid.
    return [
      "Category-forced sweep: sweep-did-not-run",
      `Reason: ${input.sweepDegraded.reason}`,
    ];
  }

  // The unrecognized enablement value itself is deliberately absent (AC18):
  // it is operator input and the check-run output is user-facing.
  return [
    "Category-forced sweep: an unrecognized enablement value was supplied; no sweep ran.",
  ];
}

/**
 * The repository-context check-run lines (#106, AC3, AC19, AC21). Carries
 * the outcome, the counts, every drop as `kind symbolName path:line —
 * reason`, the budget utilisation, the content-request count, and any
 * budget fallback — never an excerpt body and never the raw unrecognized
 * switch value.
 */
function renderRepositoryContextCheckRunLines(input: CheckRunOutputInput): string[] {
  if (input.repositoryContext) {
    const record = input.repositoryContext;
    const lines = [
      `Repository context: ${REPOSITORY_CONTEXT_OUTCOME_LABELS[record.outcome]}`,
      `Candidates requested: ${record.candidatesRequested}, resolved: ${record.candidatesResolved}`,
      `Budget: ${record.maxCandidates} candidates / ${record.maxChars} chars / ${record.timeBudgetMs}ms — used ${record.charsUsed} chars, ${record.timeUsedMs}ms`,
      `Content requests: ${record.contentRequestCount}`,
    ];
    for (const drop of record.drops) {
      lines.push(`- drop: ${drop.kind} ${drop.symbolName} ${drop.path}:${drop.line} — ${drop.reason}`);
    }
    for (const path of record.unreadableChangedFilePaths) {
      lines.push(`- unreadable changed file: ${path}`);
    }
    for (const fallback of record.budgetFallbacks) {
      lines.push(`- budget fallback: ${fallback}`);
    }
    return lines;
  }

  if (!input.repositoryContextDegraded) {
    return [];
  }

  return ["Repository context: an unrecognized enablement value was supplied; repository context did not run."];
}

function describeFailureReason(reason?: FailureReason): string {
  switch (reason) {
    case "timed_out":
      return "timed out";
    case "model_unavailable":
      return "model unavailable";
    case "credential_missing":
      return "model credential missing";
    case "credential_invalid":
      return "model credential invalid";
    case "unusable_output":
      return "model returned unusable output";
    case "changes_too_large":
      return "changes too large";
    case "unexpected_error":
      return "unexpected error";
    default:
      return "unknown error";
  }
}

function formatDuration(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${seconds}s`;
}
