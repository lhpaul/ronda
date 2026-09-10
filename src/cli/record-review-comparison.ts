import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  ComparisonAdjudicationOutcome,
  ReviewComparisonRecord,
} from "./recall-benchmark.js";
import type { Finding } from "../domain/review-pass.types.js";

type ReviewResult = ReviewComparisonRecord["ronda"]["result"];

interface CliOptions {
  pr: number;
  repository?: string;
  headSha?: string;
  id?: string;
  out?: string;
  rondaResult: ReviewResult;
  rondaReviewedHeadSha?: string;
  rondaFindingsPath?: string;
  otherReviewer: string;
  otherResult: ReviewResult;
  otherReviewedHeadSha?: string;
  otherFindingsPath?: string;
  adjudication?: ComparisonAdjudicationOutcome;
  notes?: string;
}

interface PullRequestMetadata {
  repository: string;
  headSha: string;
}

const REVIEW_RESULTS = new Set<ReviewResult>([
  "clean",
  "findings",
  "failed",
  "timeout",
]);
const ADJUDICATION_OUTCOMES = new Set<ComparisonAdjudicationOutcome>([
  "ronda_miss",
  "ronda_better",
  "duplicate",
  "clean_agreement",
  "unclear",
]);

export function buildReviewComparisonRecord(input: {
  id: string;
  repository: string;
  pullNumber: number;
  headSha: string;
  rondaResult: ReviewResult;
  rondaReviewedHeadSha?: string;
  rondaFindings?: Finding[];
  otherReviewer: string;
  otherResult: ReviewResult;
  otherReviewedHeadSha?: string;
  otherFindings?: Finding[];
  adjudication?: ComparisonAdjudicationOutcome;
  notes?: string;
}): ReviewComparisonRecord {
  const rondaReviewedHeadSha = input.rondaReviewedHeadSha ?? input.headSha;
  const otherReviewedHeadSha = input.otherReviewedHeadSha ?? input.headSha;
  const outcome =
    input.adjudication ??
    defaultAdjudicationOutcome({
      headSha: input.headSha,
      rondaReviewedHeadSha,
      rondaResult: input.rondaResult,
      otherReviewedHeadSha,
      otherResult: input.otherResult,
    });

  return {
    id: input.id,
    repository: input.repository,
    pullNumber: input.pullNumber,
    headSha: input.headSha,
    ronda: {
      result: input.rondaResult,
      reviewedHeadSha: rondaReviewedHeadSha,
      findings: input.rondaFindings ?? [],
    },
    otherReviewer: {
      name: input.otherReviewer,
      result: input.otherResult,
      reviewedHeadSha: otherReviewedHeadSha,
      findings: input.otherFindings ?? [],
    },
    adjudications: [
      {
        outcome,
        notes: input.notes ?? defaultAdjudicationNotes(outcome),
      },
    ],
  };
}

export function defaultAdjudicationOutcome(input: {
  headSha: string;
  rondaReviewedHeadSha: string;
  rondaResult: ReviewResult;
  otherReviewedHeadSha: string;
  otherResult: ReviewResult;
}): ComparisonAdjudicationOutcome {
  const sameHead =
    input.headSha === input.rondaReviewedHeadSha &&
    input.headSha === input.otherReviewedHeadSha;
  if (
    sameHead &&
    input.rondaResult === "clean" &&
    input.otherResult === "clean"
  ) {
    return "clean_agreement";
  }
  return "unclear";
}

export function defaultComparisonId(input: {
  repository: string;
  pullNumber: number;
  reviewer: string;
  timestamp: Date;
}): string {
  const date = input.timestamp.toISOString().slice(0, 10).replaceAll("-", "");
  return `${slugify(input.repository)}-pr-${input.pullNumber}-${slugify(
    input.reviewer,
  )}-${date}`;
}

export function writeComparisonRecord(
  path: string,
  record: ReviewComparisonRecord,
): void {
  const records = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as ReviewComparisonRecord[])
    : [];
  records.push(record);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(records, null, 2)}\n`);
}

function defaultAdjudicationNotes(
  outcome: ComparisonAdjudicationOutcome,
): string {
  if (outcome === "clean_agreement") {
    return "Both reviewers reported clean on the same head.";
  }
  return "Needs human adjudication before this comparison counts as quality evidence.";
}

function defaultOutputPath(id: string): string {
  return `docs/testing/ronda/comparisons/${id}.json`;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseArgs(argv: string[]): CliOptions {
  const options: Partial<CliOptions> = {
    rondaResult: "clean",
    otherReviewer: "Cursor Bugbot",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--pr" && next) {
      options.pr = parsePositiveInt(next, "--pr");
      index += 1;
    } else if (arg === "--repository" && next) {
      options.repository = next;
      index += 1;
    } else if (arg === "--head-sha" && next) {
      options.headSha = next;
      index += 1;
    } else if (arg === "--id" && next) {
      options.id = next;
      index += 1;
    } else if (arg === "--out" && next) {
      options.out = next;
      index += 1;
    } else if (arg === "--ronda-result" && next) {
      options.rondaResult = parseReviewResult(next, "--ronda-result");
      index += 1;
    } else if (arg === "--ronda-head-sha" && next) {
      options.rondaReviewedHeadSha = next;
      index += 1;
    } else if (arg === "--ronda-findings-file" && next) {
      options.rondaFindingsPath = next;
      index += 1;
    } else if (arg === "--other-reviewer" && next) {
      options.otherReviewer = next;
      index += 1;
    } else if (arg === "--other-result" && next) {
      options.otherResult = parseReviewResult(next, "--other-result");
      index += 1;
    } else if (arg === "--other-head-sha" && next) {
      options.otherReviewedHeadSha = next;
      index += 1;
    } else if (arg === "--other-findings-file" && next) {
      options.otherFindingsPath = next;
      index += 1;
    } else if (arg === "--adjudication" && next) {
      options.adjudication = parseAdjudicationOutcome(next);
      index += 1;
    } else if (arg === "--notes" && next) {
      options.notes = next;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  if (!options.pr) {
    throw new Error("--pr is required");
  }
  if (!options.otherResult) {
    throw new Error("--other-result is required");
  }

  return options as CliOptions;
}

function parsePositiveInt(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseReviewResult(value: string, name: string): ReviewResult {
  if (!REVIEW_RESULTS.has(value as ReviewResult)) {
    throw new Error(
      `${name} must be one of: ${Array.from(REVIEW_RESULTS).join(", ")}`,
    );
  }
  return value as ReviewResult;
}

function parseAdjudicationOutcome(
  value: string,
): ComparisonAdjudicationOutcome {
  if (!ADJUDICATION_OUTCOMES.has(value as ComparisonAdjudicationOutcome)) {
    throw new Error(
      `--adjudication must be one of: ${Array.from(ADJUDICATION_OUTCOMES).join(", ")}`,
    );
  }
  return value as ComparisonAdjudicationOutcome;
}

function readFindings(path: string | undefined): Finding[] {
  if (!path) {
    return [];
  }
  return JSON.parse(readFileSync(path, "utf8")) as Finding[];
}

function readPullRequestMetadata(options: CliOptions): PullRequestMetadata {
  const repository =
    options.repository ??
    execFileSync(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"],
      {
        encoding: "utf8",
      },
    ).trim();
  const headSha =
    options.headSha ??
    execFileSync(
      "gh",
      [
        "pr",
        "view",
        String(options.pr),
        "--json",
        "headRefOid",
        "--jq",
        ".headRefOid",
      ],
      {
        encoding: "utf8",
      },
    ).trim();

  if (!repository) {
    throw new Error("Could not resolve repository; pass --repository");
  }
  if (!headSha) {
    throw new Error("Could not resolve PR head SHA; pass --head-sha");
  }

  return { repository, headSha };
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const options = parseArgs(argv);
  const metadata = readPullRequestMetadata(options);
  const id =
    options.id ??
    defaultComparisonId({
      repository: metadata.repository,
      pullNumber: options.pr,
      reviewer: options.otherReviewer,
      timestamp: new Date(),
    });
  const record = buildReviewComparisonRecord({
    id,
    repository: metadata.repository,
    pullNumber: options.pr,
    headSha: metadata.headSha,
    rondaResult: options.rondaResult,
    rondaReviewedHeadSha: options.rondaReviewedHeadSha,
    rondaFindings: readFindings(options.rondaFindingsPath),
    otherReviewer: options.otherReviewer,
    otherResult: options.otherResult,
    otherReviewedHeadSha: options.otherReviewedHeadSha,
    otherFindings: readFindings(options.otherFindingsPath),
    adjudication: options.adjudication,
    notes: options.notes,
  });
  const outputPath = options.out ?? defaultOutputPath(id);
  writeComparisonRecord(outputPath, record);
  console.log(`WROTE_COMPARISON=${outputPath}`);
  console.log(JSON.stringify(record, null, 2));
  return 0;
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("record-review-comparison.ts")
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
