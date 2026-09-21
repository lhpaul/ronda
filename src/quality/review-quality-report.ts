import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  summarizeReviewComparison,
  type ComparisonAdjudicationOutcome,
  type ReviewComparisonRecord,
  type ReviewComparisonSummary,
} from "../cli/recall-benchmark.js";

export const DEFAULT_COMPARISON_DIRECTORY = "docs/testing/ronda/comparisons";
export const DEFAULT_MISS_DIRECTORY = "docs/testing/ronda/misses";
export const UNCategorized_CATEGORY = "uncategorized";

export type PrimaryOutcome =
  | "true_positive"
  | "false_positive"
  | "false_clean"
  | "stale_head"
  | "unadjudicated";

export type MissVerdict =
  | "unadjudicated"
  | "true_positive"
  | "false_positive"
  | "out_of_scope"
  | "already_found";

export type IntendedFollowUp =
  | "undecided"
  | "eval_record"
  | "prompt_change"
  | "backlog_item"
  | "no_action";

export interface ComparisonRecordWithMeta extends ReviewComparisonRecord {
  capturedAt?: string;
}

/**
 * Miss evidence row used by the quality report. Compatible with the fuller
 * `ExternalReviewMissRecord` schema written by `quality:misses`.
 */
export interface CapturedMissRecord {
  id: string;
  repository: string;
  pullNumber: number;
  reviewedHeadSha: string;
  rondaResultHeadSha: string;
  staleEvidence?: boolean;
  externalReviewer: string;
  location?: string;
  locationUnresolved?: boolean;
  title?: string;
  text?: string;
  textTruncated?: boolean;
  affectedCategory?: string;
  verdict: MissVerdict;
  intendedFollowUp?: IntendedFollowUp;
  captureSource?: "automatic" | "manual";
  sourceId?: string | null;
  rationale?: string;
  capturedAt?: string;
  updatedAt?: string;
  mergeBaseSha?: string;
}

export interface EvidenceReference {
  id: string;
  source: "comparison" | "miss";
  repository: string;
  pullNumber: number;
  reviewer: string;
  category: string;
}

export interface ClassifiedEvidenceRow extends EvidenceReference {
  primaryOutcome: PrimaryOutcome;
  falseCleanCandidate: boolean;
  cleanAgreement: boolean;
  duplicateOrOutOfScope: boolean;
  /** Fresh read-time flag; never persisted on the miss record (AC48). */
  unresolvableEvidence?: boolean;
  timestamp?: string;
}

export interface ReportFilters {
  repository?: string;
  reviewer?: string;
  category?: string;
  since?: string;
  until?: string;
}

export interface SkippedFile {
  path: string;
  reason: string;
}

/** Prefix-aware SHA match (abbreviated vs full); malformed prefixes never match. */
function missHeadsMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  const wellFormed = (value: string): boolean =>
    value.length >= 7 && value.length <= 40 && /^[0-9a-f]+$/.test(value);
  if (!wellFormed(a) || !wellFormed(b)) {
    return false;
  }
  return a === b || a.startsWith(b) || b.startsWith(a);
}

export interface QualityComparisonRollup {
  totalComparisons: number;
  sameHeadComparisons: number;
  staleHeadComparisons: number;
  totalRondaFindings: number;
  totalOtherReviewerFindings: number;
  falseCleanCandidateCount: number;
  adjudicationCounts: Record<ComparisonAdjudicationOutcome, number>;
  reviewers: Record<string, number>;
  unclearComparisons: Array<{
    id: string;
    repository: string;
    pullNumber: number;
    reviewer: string;
  }>;
  falseCleanCandidates: Array<{
    id: string;
    repository: string;
    pullNumber: number;
    reviewer: string;
  }>;
}

export interface OutcomeBucket {
  count: number;
  drillDown: EvidenceReference[];
}

export interface ReviewQualityReport {
  generatedAt: string;
  scope: {
    comparisonDirectory: string;
    missDirectory: string;
    comparisonFiles: string[];
    missFiles: string[];
    filters: ReportFilters;
    comparisonRecordCount: number;
    missRecordCount: number;
    missRecordsInScope: number;
  };
  skippedFiles: SkippedFile[];
  primaryOutcomes: Record<PrimaryOutcome, OutcomeBucket>;
  falseCleanCandidates: EvidenceReference[];
  cleanAgreement: OutcomeBucket;
  supplementary: {
    duplicate: number;
    outOfScope: number;
    /** Additive AC48 count; independent of stale_head / verdict outcomes. */
    unresolvableEvidence: number;
  };
  breakdowns: {
    byCategory: Record<string, Record<PrimaryOutcome, number>>;
    byRepository: Record<string, Record<PrimaryOutcome, number>>;
    byReviewer: Record<string, Record<PrimaryOutcome, number>>;
  };
  improvement: {
    topMissedCategories: Array<{ category: string; confirmedMissCount: number }>;
    topUnclearFalseCleanCategories: Array<{
      category: string;
      unclearFalseCleanCount: number;
    }>;
    followUpCounts: Record<IntendedFollowUp, number>;
    suggestedActions: Array<{ action: string; recordIds: string[] }>;
  };
  comparisonRollup: QualityComparisonRollup;
}

export interface BuildReportInput {
  comparisonRecords: ComparisonRecordWithMeta[];
  missRecords: CapturedMissRecord[];
  comparisonFiles: string[];
  missFiles: string[];
  comparisonDirectory: string;
  missDirectory: string;
  skippedFiles: SkippedFile[];
  filters: ReportFilters;
  /**
   * Fresh Ronda-evidence resolvability (AC48). When omitted, miss records are
   * treated as resolvable — callers that claim a spec-complete report must
   * supply a checker built from live evidence.
   */
  isResolvable?: (record: CapturedMissRecord) => boolean;
}

export function readComparisonRecords(
  paths: string[],
): ComparisonRecordWithMeta[] {
  return paths.flatMap((path) => {
    const records = JSON.parse(
      readFileSync(path, "utf8"),
    ) as ComparisonRecordWithMeta[];
    return records;
  });
}

export function readMissRecords(paths: string[]): CapturedMissRecord[] {
  return paths.flatMap((path) => {
    const records = JSON.parse(readFileSync(path, "utf8")) as
      | CapturedMissRecord
      | CapturedMissRecord[];
    return Array.isArray(records) ? records : [records];
  });
}

export function resolveComparisonFiles(options: {
  files: string[];
  directory: string;
}): string[] {
  if (options.files.length > 0) {
    return options.files;
  }
  if (!existsSync(options.directory)) {
    return [];
  }
  return readdirSync(options.directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(options.directory, name));
}

export function resolveMissFiles(options: {
  files: string[];
  directory: string;
}): string[] {
  if (options.files.length > 0) {
    return options.files;
  }
  if (!existsSync(options.directory)) {
    return [];
  }
  return readdirSync(options.directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(options.directory, name));
}

export function loadEvidenceFiles(input: {
  comparisonFiles: string[];
  missFiles: string[];
  comparisonDirectory: string;
  missDirectory: string;
}): {
  comparisonRecords: ComparisonRecordWithMeta[];
  missRecords: CapturedMissRecord[];
  skippedFiles: SkippedFile[];
} {
  const skippedFiles: SkippedFile[] = [];
  const comparisonRecords: ComparisonRecordWithMeta[] = [];
  const missRecords: CapturedMissRecord[] = [];

  for (const path of input.comparisonFiles) {
    try {
      comparisonRecords.push(...readComparisonRecords([path]));
    } catch (error: unknown) {
      skippedFiles.push({
        path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const path of input.missFiles) {
    try {
      missRecords.push(...readMissRecords([path]));
    } catch (error: unknown) {
      skippedFiles.push({
        path,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { comparisonRecords, missRecords, skippedFiles };
}

export function summarizeComparisonRecords(
  records: ReviewComparisonRecord[],
): QualityComparisonRollup {
  const summaries = records.map(summarizeReviewComparison);
  return {
    totalComparisons: summaries.length,
    sameHeadComparisons: summaries.filter((summary) => summary.sameHead).length,
    staleHeadComparisons: summaries.filter((summary) => !summary.sameHead)
      .length,
    totalRondaFindings: sumBy(
      summaries,
      (summary) => summary.rondaFindingCount,
    ),
    totalOtherReviewerFindings: sumBy(
      summaries,
      (summary) => summary.otherReviewerFindingCount,
    ),
    falseCleanCandidateCount: summaries.filter(
      (summary) => summary.falseCleanCandidate,
    ).length,
    adjudicationCounts: summaries.reduce(
      (counts, summary) => addAdjudicationCounts(counts, summary),
      emptyAdjudicationCounts(),
    ),
    reviewers: summaries.reduce<Record<string, number>>(
      (reviewers, summary) => {
        reviewers[summary.reviewer] = (reviewers[summary.reviewer] ?? 0) + 1;
        return reviewers;
      },
      {},
    ),
    unclearComparisons: summaries
      .filter((summary) => summary.adjudicationCounts.unclear > 0)
      .map(toComparisonReference),
    falseCleanCandidates: summaries
      .filter((summary) => summary.falseCleanCandidate)
      .map(toComparisonReference),
  };
}

export function classifyEvidenceRow(row: {
  adjudicationOutcome?: ComparisonAdjudicationOutcome;
  missVerdict?: MissVerdict;
  sameHead?: boolean;
  staleEvidence?: boolean;
  falseCleanCandidate?: boolean;
}): PrimaryOutcome {
  if (row.staleEvidence === true || row.sameHead === false) {
    return "stale_head";
  }

  if (row.missVerdict === "unadjudicated" || row.adjudicationOutcome === "unclear") {
    return "unadjudicated";
  }

  if (
    row.missVerdict === "true_positive" ||
    row.adjudicationOutcome === "ronda_miss"
  ) {
    return "true_positive";
  }

  if (
    row.missVerdict === "false_positive" ||
    row.adjudicationOutcome === "ronda_better"
  ) {
    return "false_positive";
  }

  if (row.falseCleanCandidate) {
    return "false_clean";
  }

  if (row.adjudicationOutcome === "clean_agreement") {
    return "unadjudicated";
  }

  return "unadjudicated";
}

function comparisonRows(record: ComparisonRecordWithMeta): ClassifiedEvidenceRow[] {
  const summary = summarizeReviewComparison(record);
  const timestamp = record.capturedAt;
  const category = UNCategorized_CATEGORY;

  if (!summary.sameHead) {
    return [
      {
        id: record.id,
        source: "comparison",
        repository: record.repository,
        pullNumber: record.pullNumber,
        reviewer: summary.reviewer,
        category,
        timestamp,
        primaryOutcome: "stale_head",
        falseCleanCandidate: false,
        cleanAgreement: false,
        duplicateOrOutOfScope: false,
      },
    ];
  }

  if (record.adjudications.length === 0) {
    const falseCleanCandidate = summary.falseCleanCandidate;
    return [
      {
        id: record.id,
        source: "comparison",
        repository: record.repository,
        pullNumber: record.pullNumber,
        reviewer: summary.reviewer,
        category,
        timestamp,
        primaryOutcome: classifyEvidenceRow({
          sameHead: true,
          falseCleanCandidate,
        }),
        falseCleanCandidate,
        cleanAgreement: false,
        duplicateOrOutOfScope: false,
      },
    ];
  }

  return record.adjudications.map((adjudication, index) => {
    const falseCleanCandidate =
      summary.falseCleanCandidate &&
      (adjudication.outcome === "unclear" || adjudication.outcome === "ronda_miss");
    const cleanAgreement = adjudication.outcome === "clean_agreement";
    const duplicateOrOutOfScope = adjudication.outcome === "duplicate";
    const primaryOutcome = cleanAgreement
      ? "unadjudicated"
      : classifyEvidenceRow({
          adjudicationOutcome: adjudication.outcome,
          sameHead: true,
          falseCleanCandidate,
        });

    return {
      id: record.adjudications.length === 1 ? record.id : `${record.id}:${index}`,
      source: "comparison" as const,
      repository: record.repository,
      pullNumber: record.pullNumber,
      reviewer: summary.reviewer,
      category,
      timestamp,
      primaryOutcome: cleanAgreement ? "unadjudicated" : primaryOutcome,
      falseCleanCandidate,
      cleanAgreement,
      duplicateOrOutOfScope,
    };
  });
}

function missRows(
  record: CapturedMissRecord,
  isResolvable?: (record: CapturedMissRecord) => boolean,
): ClassifiedEvidenceRow[] {
  const sameHead = missHeadsMatch(
    record.reviewedHeadSha,
    record.rondaResultHeadSha,
  );
  const stale = record.staleEvidence === true || !sameHead;
  const resolvable = isResolvable ? isResolvable(record) : true;
  const category = record.affectedCategory?.trim() || UNCategorized_CATEGORY;
  const falseCleanCandidate =
    !stale && resolvable && record.verdict === "unadjudicated" && sameHead;

  const primaryOutcome = stale
    ? "stale_head"
    : classifyEvidenceRow({
        missVerdict: record.verdict,
        sameHead: !stale,
        staleEvidence: stale,
        falseCleanCandidate,
      });

  return [
    {
      id: record.id,
      source: "miss",
      repository: record.repository,
      pullNumber: record.pullNumber,
      reviewer: record.externalReviewer,
      category,
      timestamp: record.capturedAt,
      primaryOutcome,
      falseCleanCandidate,
      cleanAgreement: false,
      duplicateOrOutOfScope:
        record.verdict === "already_found" || record.verdict === "out_of_scope",
      unresolvableEvidence: !resolvable,
    },
  ];
}

function passesFilters(row: ClassifiedEvidenceRow, filters: ReportFilters): boolean {
  if (filters.repository && row.repository !== filters.repository) {
    return false;
  }
  if (filters.reviewer && row.reviewer !== filters.reviewer) {
    return false;
  }
  if (filters.category && row.category !== filters.category) {
    return false;
  }
  if (row.timestamp) {
    const instant = Date.parse(row.timestamp);
    if (Number.isNaN(instant)) {
      return true;
    }
    if (filters.since) {
      const since = Date.parse(filters.since);
      if (!Number.isNaN(since) && instant < since) {
        return false;
      }
    }
    if (filters.until) {
      const until = Date.parse(filters.until);
      if (!Number.isNaN(until) && instant > until) {
        return false;
      }
    }
  }
  return true;
}

function emptyPrimaryCounts(): Record<PrimaryOutcome, number> {
  return {
    true_positive: 0,
    false_positive: 0,
    false_clean: 0,
    stale_head: 0,
    unadjudicated: 0,
  };
}

function incrementBreakdown(
  target: Record<string, Record<PrimaryOutcome, number>>,
  key: string,
  outcome: PrimaryOutcome,
): void {
  target[key] ??= emptyPrimaryCounts();
  target[key][outcome] += 1;
}

export function buildReviewQualityReport(input: BuildReportInput): ReviewQualityReport {
  const comparisonRowsFlat = input.comparisonRecords.flatMap(comparisonRows);
  const missRowsFlat = input.missRecords.flatMap((record) =>
    missRows(record, input.isResolvable),
  );
  const allRows = [...comparisonRowsFlat, ...missRowsFlat].filter((row) =>
    passesFilters(row, input.filters),
  );

  const primaryOutcomes = {
    true_positive: { count: 0, drillDown: [] as EvidenceReference[] },
    false_positive: { count: 0, drillDown: [] as EvidenceReference[] },
    false_clean: { count: 0, drillDown: [] as EvidenceReference[] },
    stale_head: { count: 0, drillDown: [] as EvidenceReference[] },
    unadjudicated: { count: 0, drillDown: [] as EvidenceReference[] },
  } satisfies Record<PrimaryOutcome, OutcomeBucket>;

  const cleanAgreement: OutcomeBucket = { count: 0, drillDown: [] };
  const falseCleanCandidates: EvidenceReference[] = [];
  const supplementary = { duplicate: 0, outOfScope: 0, unresolvableEvidence: 0 };
  const breakdowns = {
    byCategory: {} as Record<string, Record<PrimaryOutcome, number>>,
    byRepository: {} as Record<string, Record<PrimaryOutcome, number>>,
    byReviewer: {} as Record<string, Record<PrimaryOutcome, number>>,
  };

  for (const row of allRows) {
    if (row.unresolvableEvidence) {
      supplementary.unresolvableEvidence += 1;
      // Stale + unresolvable both count independently (AC48); verdict outcomes
      // remain excluded while unresolvable.
      if (row.primaryOutcome === "stale_head") {
        primaryOutcomes.stale_head.count += 1;
        primaryOutcomes.stale_head.drillDown.push(toReference(row));
      }
      continue;
    }

    if (row.cleanAgreement) {
      cleanAgreement.count += 1;
      cleanAgreement.drillDown.push(toReference(row));
      continue;
    }
    if (row.duplicateOrOutOfScope) {
      if (row.source === "miss") {
        const miss = input.missRecords.find((record) => record.id === row.id);
        if (miss?.verdict === "out_of_scope") {
          supplementary.outOfScope += 1;
        } else {
          supplementary.duplicate += 1;
        }
      } else {
        supplementary.duplicate += 1;
      }
      continue;
    }

    const outcome =
      row.falseCleanCandidate && row.primaryOutcome === "unadjudicated"
        ? "unadjudicated"
        : row.primaryOutcome;

    primaryOutcomes[outcome].count += 1;
    primaryOutcomes[outcome].drillDown.push(toReference(row));
    incrementBreakdown(breakdowns.byCategory, row.category, outcome);
    incrementBreakdown(breakdowns.byRepository, row.repository, outcome);
    incrementBreakdown(breakdowns.byReviewer, row.reviewer, outcome);

    if (row.falseCleanCandidate) {
      falseCleanCandidates.push(toReference(row));
    }
  }

  const confirmedMissesByCategory = new Map<string, number>();
  const unclearFalseCleanByCategory = new Map<string, number>();
  for (const row of allRows) {
    if (row.unresolvableEvidence) {
      continue;
    }
    if (row.primaryOutcome === "true_positive") {
      confirmedMissesByCategory.set(
        row.category,
        (confirmedMissesByCategory.get(row.category) ?? 0) + 1,
      );
    }
    if (row.falseCleanCandidate && row.primaryOutcome === "unadjudicated") {
      unclearFalseCleanByCategory.set(
        row.category,
        (unclearFalseCleanByCategory.get(row.category) ?? 0) + 1,
      );
    }
  }

  const followUpCounts: Record<IntendedFollowUp, number> = {
    undecided: 0,
    eval_record: 0,
    prompt_change: 0,
    backlog_item: 0,
    no_action: 0,
  };
  for (const record of input.missRecords) {
    const followUp = record.intendedFollowUp ?? "undecided";
    followUpCounts[followUp] += 1;
  }

  const suggestedActions: Array<{ action: string; recordIds: string[] }> = [];
  for (const [category, count] of confirmedMissesByCategory.entries()) {
    if (count > 0) {
      const ids = allRows
        .filter(
          (row) => row.category === category && row.primaryOutcome === "true_positive",
        )
        .map((row) => row.id);
      suggestedActions.push({
        action: `Seed eval or prompt work for category ${category} (${count} confirmed miss${count === 1 ? "" : "es"})`,
        recordIds: ids,
      });
    }
  }
  for (const row of falseCleanCandidates.filter(
    (candidate) =>
      allRows.find((entry) => entry.id === candidate.id)?.primaryOutcome ===
      "unadjudicated",
  )) {
    suggestedActions.push({
      action: `Review unclear false-clean candidate on PR ${row.pullNumber} (${row.id})`,
      recordIds: [row.id],
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      comparisonDirectory: input.comparisonDirectory,
      missDirectory: input.missDirectory,
      comparisonFiles: input.comparisonFiles,
      missFiles: input.missFiles,
      filters: input.filters,
      comparisonRecordCount: input.comparisonRecords.length,
      missRecordCount: input.missRecords.length,
      missRecordsInScope: missRowsFlat.filter((row) =>
        passesFilters(row, input.filters),
      ).length,
    },
    skippedFiles: input.skippedFiles,
    primaryOutcomes,
    falseCleanCandidates,
    cleanAgreement,
    supplementary,
    breakdowns,
    improvement: {
      topMissedCategories: [...confirmedMissesByCategory.entries()]
        .map(([category, confirmedMissCount]) => ({ category, confirmedMissCount }))
        .sort((left, right) => right.confirmedMissCount - left.confirmedMissCount),
      topUnclearFalseCleanCategories: [...unclearFalseCleanByCategory.entries()]
        .map(([category, unclearFalseCleanCount]) => ({
          category,
          unclearFalseCleanCount,
        }))
        .sort(
          (left, right) =>
            right.unclearFalseCleanCount - left.unclearFalseCleanCount,
        ),
      followUpCounts,
      suggestedActions,
    },
    comparisonRollup: summarizeComparisonRecords(input.comparisonRecords),
  };
}

export function formatMarkdownSummary(report: ReviewQualityReport): string {
  const lines = [
    "# Ronda review quality report",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    "## Scope",
    `- Comparisons: ${report.scope.comparisonRecordCount} record(s) from ${report.scope.comparisonFiles.length} file(s)`,
    `- Miss records: ${report.scope.missRecordCount} record(s) from ${report.scope.missFiles.length} file(s); ${report.scope.missRecordsInScope} in scope after filters`,
  ];

  if (Object.values(report.scope.filters).some(Boolean)) {
    lines.push(`- Filters: ${JSON.stringify(report.scope.filters)}`);
  }
  if (report.skippedFiles.length > 0) {
    lines.push(`- Skipped files: ${report.skippedFiles.length}`);
  }

  lines.push("", "## Primary outcomes");
  for (const outcome of [
    "true_positive",
    "false_positive",
    "false_clean",
    "stale_head",
    "unadjudicated",
  ] as const) {
    const bucket = report.primaryOutcomes[outcome];
    lines.push(`- ${outcome}: ${bucket.count}`);
    for (const ref of bucket.drillDown.slice(0, 10)) {
      lines.push(
        `  - ${ref.id} (${ref.repository}#${ref.pullNumber}, ${ref.reviewer}, ${ref.category})`,
      );
    }
  }

  lines.push("", "## Clean agreement", `- count: ${report.cleanAgreement.count}`);
  lines.push("", "## False-clean candidates", `- count: ${report.falseCleanCandidates.length}`);
  lines.push(
    "",
    "## Supplementary",
    `- duplicate: ${report.supplementary.duplicate}`,
    `- out_of_scope: ${report.supplementary.outOfScope}`,
    `- unresolvable_evidence: ${report.supplementary.unresolvableEvidence}`,
  );

  lines.push("", "## Improvement");
  for (const entry of report.improvement.topMissedCategories.slice(0, 5)) {
    lines.push(
      `- Top missed category: ${entry.category} (${entry.confirmedMissCount})`,
    );
  }
  for (const action of report.improvement.suggestedActions.slice(0, 5)) {
    lines.push(`- ${action.action} [${action.recordIds.join(", ")}]`);
  }

  return `${lines.join("\n")}\n`;
}

function toReference(row: ClassifiedEvidenceRow): EvidenceReference {
  return {
    id: row.id,
    source: row.source,
    repository: row.repository,
    pullNumber: row.pullNumber,
    reviewer: row.reviewer,
    category: row.category,
  };
}

function sumBy<T>(values: T[], select: (value: T) => number): number {
  return values.reduce((total, value) => total + select(value), 0);
}

function emptyAdjudicationCounts(): Record<
  ComparisonAdjudicationOutcome,
  number
> {
  return {
    ronda_miss: 0,
    ronda_better: 0,
    duplicate: 0,
    clean_agreement: 0,
    unclear: 0,
  };
}

function addAdjudicationCounts(
  counts: Record<ComparisonAdjudicationOutcome, number>,
  summary: ReviewComparisonSummary,
): Record<ComparisonAdjudicationOutcome, number> {
  for (const [outcome, count] of Object.entries(summary.adjudicationCounts)) {
    counts[outcome as ComparisonAdjudicationOutcome] += count;
  }
  return counts;
}

function toComparisonReference(summary: ReviewComparisonSummary): {
  id: string;
  repository: string;
  pullNumber: number;
  reviewer: string;
} {
  return {
    id: summary.id,
    repository: summary.repository,
    pullNumber: summary.pullNumber,
    reviewer: summary.reviewer,
  };
}
