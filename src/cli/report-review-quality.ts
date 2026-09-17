import { writeFileSync } from "node:fs";
import {
  buildReviewQualityReport,
  DEFAULT_COMPARISON_DIRECTORY,
  DEFAULT_MISS_DIRECTORY,
  formatMarkdownSummary,
  loadEvidenceFiles,
  resolveComparisonFiles,
  resolveMissFiles,
  type ReportFilters,
} from "../quality/review-quality-report.js";

type OutputFormat = "json" | "markdown" | "both";

interface CliOptions {
  comparisonDirectory: string;
  missDirectory: string;
  comparisonFiles: string[];
  missFiles: string[];
  filters: ReportFilters;
  format: OutputFormat;
  out?: string;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    comparisonDirectory: DEFAULT_COMPARISON_DIRECTORY,
    missDirectory: DEFAULT_MISS_DIRECTORY,
    comparisonFiles: [],
    missFiles: [],
    filters: {},
    format: "both",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dir" && next) {
      options.comparisonDirectory = next;
      index += 1;
    } else if (arg === "--miss-dir" && next) {
      options.missDirectory = next;
      index += 1;
    } else if (arg === "--file" && next) {
      options.comparisonFiles.push(next);
      index += 1;
    } else if (arg === "--miss-file" && next) {
      options.missFiles.push(next);
      index += 1;
    } else if (arg === "--repository" && next) {
      options.filters.repository = next;
      index += 1;
    } else if (arg === "--reviewer" && next) {
      options.filters.reviewer = next;
      index += 1;
    } else if (arg === "--category" && next) {
      options.filters.category = next;
      index += 1;
    } else if (arg === "--since" && next) {
      options.filters.since = next;
      index += 1;
    } else if (arg === "--until" && next) {
      options.filters.until = next;
      index += 1;
    } else if (arg === "--format" && next) {
      if (next !== "json" && next !== "markdown" && next !== "both") {
        throw new Error(`Unsupported format: ${next}`);
      }
      options.format = next;
      index += 1;
    } else if (arg === "--out" && next) {
      options.out = next;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  const comparisonFiles = resolveComparisonFiles({
    files: options.comparisonFiles,
    directory: options.comparisonDirectory,
  });
  const missFiles = resolveMissFiles({
    files: options.missFiles,
    directory: options.missDirectory,
  });
  const loaded = loadEvidenceFiles({
    comparisonFiles,
    missFiles,
    comparisonDirectory: options.comparisonDirectory,
    missDirectory: options.missDirectory,
  });

  const parsedFileCount =
    comparisonFiles.length +
    missFiles.length -
    loaded.skippedFiles.length;
  if (parsedFileCount === 0 && loaded.skippedFiles.length > 0) {
    console.error(
      `quality:report: all ${loaded.skippedFiles.length} evidence file(s) failed to parse`,
    );
    for (const skipped of loaded.skippedFiles) {
      console.error(`  skipped ${skipped.path}: ${skipped.reason}`);
    }
    return 1;
  }

  console.error(
    `quality:report scope: comparisons=${loaded.comparisonRecords.length} missRecords=${loaded.missRecords.length} files=${comparisonFiles.length + missFiles.length} skipped=${loaded.skippedFiles.length}`,
  );

  const report = buildReviewQualityReport({
    comparisonRecords: loaded.comparisonRecords,
    missRecords: loaded.missRecords,
    comparisonFiles,
    missFiles,
    comparisonDirectory: options.comparisonDirectory,
    missDirectory: options.missDirectory,
    skippedFiles: loaded.skippedFiles,
    filters: options.filters,
  });

  const jsonBody = `${JSON.stringify(report, null, 2)}\n`;
  const markdownBody = formatMarkdownSummary(report);
  const stdoutParts: string[] = [];

  if (options.format === "json" || options.format === "both") {
    stdoutParts.push(jsonBody);
  }
  if (options.format === "markdown" || options.format === "both") {
    stdoutParts.push(markdownBody);
  }

  const output = stdoutParts.join("\n");
  if (options.out) {
    writeFileSync(options.out, output, "utf8");
  } else {
    process.stdout.write(output);
  }

  return loaded.skippedFiles.length > 0 ? 1 : 0;
}

if (process.argv[1] && process.argv[1].endsWith("report-review-quality.ts")) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
