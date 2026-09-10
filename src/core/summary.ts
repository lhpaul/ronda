import { severityLabel } from "../domain/severity.js";
import {
  REVIEW_COMMAND,
  type FailureReason,
  type Finding,
  type TriggerMode,
} from "../domain/review-pass.types.js";

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
}

export function countBySeverity(findings: Finding[]): SeverityCounts {
  const counts: SeverityCounts = { blocking: 0, important: 0, nit: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }
  return counts;
}

/** Renders the review body: what was reviewed, severity counts, model, duration, findings list. */
export function buildReviewSummary(input: ReviewSummaryInput): string {
  const counts = countBySeverity(input.findings);
  const lines: string[] = [];

  lines.push("## Ronda review");
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

  if (input.findings.length === 0) {
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

export interface CheckRunOutputInput {
  outcome: "succeeded" | "failed";
  findingCounts: SeverityCounts;
  modelName: string;
  durationMs: number;
  failureReason?: FailureReason;
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
