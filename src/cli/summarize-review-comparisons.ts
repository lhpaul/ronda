import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  summarizeReviewComparison,
  type ComparisonAdjudicationOutcome,
  type ReviewComparisonRecord,
  type ReviewComparisonSummary,
} from "./recall-benchmark.js";

interface QualityComparisonRollup {
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

interface CliOptions {
  files: string[];
  directory: string;
}

const DEFAULT_COMPARISON_DIRECTORY = "docs/testing/ronda/comparisons";

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

export function readComparisonRecords(
  paths: string[],
): ReviewComparisonRecord[] {
  return paths.flatMap((path) => {
    const records = JSON.parse(
      readFileSync(path, "utf8"),
    ) as ReviewComparisonRecord[];
    return records;
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

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    files: [],
    directory: DEFAULT_COMPARISON_DIRECTORY,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dir" && next) {
      options.directory = next;
      index += 1;
    } else if (arg === "--file" && next) {
      options.files.push(next);
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  const files = resolveComparisonFiles(options);
  const records = readComparisonRecords(files);
  const rollup = summarizeComparisonRecords(records);
  console.log(JSON.stringify({ files, ...rollup }, null, 2));
  return 0;
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("summarize-review-comparisons.ts")
) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
