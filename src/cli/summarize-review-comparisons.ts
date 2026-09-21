import {
  readComparisonRecords,
  readMissRecords,
  resolveComparisonFiles,
  resolveMissFiles,
  summarizeComparisonRecords,
  DEFAULT_COMPARISON_DIRECTORY,
  DEFAULT_MISS_DIRECTORY,
  type CapturedMissRecord,
} from "../quality/review-quality-report.js";
import {
  isResolvableRondaHead,
  type PullRequestEvidence,
} from "../quality/miss-github-evidence.js";
import type { AffectedCategory, MissVerdict } from "../quality/miss-record.js";

interface CliOptions {
  files: string[];
  directory: string;
  missFiles: string[];
  missDirectory: string;
  /** Optional injectable resolvability map: record id → resolvable. */
  resolvableById?: Record<string, boolean>;
}

export {
  readComparisonRecords,
  resolveComparisonFiles,
  summarizeComparisonRecords,
};

export interface MissQualityRollup {
  totalMissRecords: number;
  confirmedMisses: number;
  reviewerNoise: number;
  outOfScope: number;
  duplicates: number;
  unadjudicated: number;
  staleEvidence: number;
  unresolvableEvidence: number;
  categoryBreakdown: Record<string, number>;
  /** Non-stale, resolvable records counted under verdict outcomes. */
  verdictOutcomeCounts: {
    ronda_miss: number;
    ronda_better: number;
    duplicate: number;
    unclear: number;
    out_of_scope: number;
  };
}

export function summarizeMissRecords(
  records: CapturedMissRecord[],
  options: {
    isResolvable?: (record: CapturedMissRecord) => boolean;
  } = {},
): MissQualityRollup {
  const categoryBreakdown: Record<string, number> = {};
  const verdictOutcomeCounts = {
    ronda_miss: 0,
    ronda_better: 0,
    duplicate: 0,
    unclear: 0,
    out_of_scope: 0,
  };

  let confirmedMisses = 0;
  let reviewerNoise = 0;
  let outOfScope = 0;
  let duplicates = 0;
  let unadjudicated = 0;
  let staleEvidence = 0;
  let unresolvableEvidence = 0;

  for (const record of records) {
    const stale =
      record.staleEvidence === true ||
      record.reviewedHeadSha !== record.rondaResultHeadSha;
    const resolvable = options.isResolvable
      ? options.isResolvable(record)
      : true;
    const category = record.affectedCategory?.trim() || "uncategorized";
    categoryBreakdown[category] = (categoryBreakdown[category] ?? 0) + 1;

    if (stale) {
      staleEvidence += 1;
    }
    if (!resolvable) {
      unresolvableEvidence += 1;
    }

    // Stale or unresolvable records are excluded from verdict outcomes (AC6–AC8).
    if (stale || !resolvable) {
      continue;
    }

    const verdict = record.verdict as MissVerdict;
    switch (verdict) {
      case "true_positive":
        confirmedMisses += 1;
        verdictOutcomeCounts.ronda_miss += 1;
        break;
      case "false_positive":
        reviewerNoise += 1;
        verdictOutcomeCounts.ronda_better += 1;
        break;
      case "out_of_scope":
        outOfScope += 1;
        verdictOutcomeCounts.out_of_scope += 1;
        break;
      case "already_found":
        duplicates += 1;
        verdictOutcomeCounts.duplicate += 1;
        break;
      case "unadjudicated":
      default:
        unadjudicated += 1;
        verdictOutcomeCounts.unclear += 1;
        break;
    }
  }

  return {
    totalMissRecords: records.length,
    confirmedMisses,
    reviewerNoise,
    outOfScope,
    duplicates,
    unadjudicated,
    staleEvidence,
    unresolvableEvidence,
    categoryBreakdown,
    verdictOutcomeCounts,
  };
}

/**
 * Build a resolvability checker from freshly loaded PR evidence keyed by
 * repository#pullNumber. When evidence is missing, the record is unresolvable.
 */
export function buildResolvabilityChecker(
  evidenceByPull: Map<string, Pick<PullRequestEvidence, "rondaResultHeadShas">>,
): (record: CapturedMissRecord) => boolean {
  return (record) => {
    const key = `${record.repository}#${record.pullNumber}`;
    const evidence = evidenceByPull.get(key);
    if (!evidence) {
      return false;
    }
    return isResolvableRondaHead({
      rondaResultHeadSha: record.rondaResultHeadSha,
      rondaResultHeadShas: evidence.rondaResultHeadShas,
    });
  };
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    files: [],
    directory: DEFAULT_COMPARISON_DIRECTORY,
    missFiles: [],
    missDirectory: DEFAULT_MISS_DIRECTORY,
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
    } else if (arg === "--miss-dir" && next) {
      options.missDirectory = next;
      index += 1;
    } else if (arg === "--miss-file" && next) {
      options.missFiles.push(next);
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

  const missFiles = resolveMissFiles({
    files: options.missFiles,
    directory: options.missDirectory,
  });
  const missRecords = readMissRecords(missFiles);
  // Summary-time resolvability defaults to resolvable when no live evidence is
  // injected; operators use `quality:misses read` / `quality:report` for fresh
  // checks. Unit tests inject via summarizeMissRecords directly.
  const missRollup = summarizeMissRecords(missRecords, {
    isResolvable: () => true,
  });

  console.log(
    JSON.stringify(
      {
        files,
        ...rollup,
        missFiles,
        misses: missRollup,
        // Preserve legacy top-level comparison counts unchanged.
        cleanAgreementUnchanged: true,
      },
      null,
      2,
    ),
  );
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

// Re-export category type for callers that want closed-set checking.
export type { AffectedCategory };
