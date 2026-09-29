import { severityLabel } from "../domain/severity.js";
import {
  REVIEW_COMMAND,
  type FailureReason,
  type Finding,
  type SweepDegradedRecord,
  type SweepPassRecord,
  type TriggerMode,
} from "../domain/review-pass.types.js";
import type { DurabilityModeResolution } from "../review/durability-mode.js";

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
}

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
