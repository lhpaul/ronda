import {
  readComparisonRecords,
  resolveComparisonFiles,
  summarizeComparisonRecords,
} from "../quality/review-quality-report.js";

interface CliOptions {
  files: string[];
  directory: string;
}

const DEFAULT_COMPARISON_DIRECTORY = "docs/testing/ronda/comparisons";

export {
  readComparisonRecords,
  resolveComparisonFiles,
  summarizeComparisonRecords,
};

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
