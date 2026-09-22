import {
  adjudicateMissRecord,
  canDeleteMissRecord,
  evaluateCaptureStage1ThroughCondition3,
  runCaptureDecisionGate,
  type CaptureGateResult,
} from "../quality/miss-capture-gate.js";
import {
  deleteMissRecordFile,
  loadAllMissRecords,
  missRecordPath,
  readMissRecordFile,
  writeMissRecord,
  type ExternalReviewMissRecord,
} from "../quality/miss-record.js";
import {
  defaultGhRunner,
  isResolvableRondaHead,
  readCodexGithubFindings,
  type CodexPresence,
  readPullRequestEvidence,
  rondaReviewBodyForHead,
  readSourceScanCorpus,
  resolveFreshMergeBase,
  type GhRunner,
  type PullRequestEvidence,
} from "../quality/miss-github-evidence.js";
import { DEFAULT_MISS_DIRECTORY } from "../quality/review-quality-report.js";
import type { SourceScanCorpus } from "../quality/miss-content-validator.js";
import { isAbsolute, normalize, relative, resolve, sep } from "node:path";

type Command =
  | "capture-automatic"
  | "capture-manual"
  | "read"
  | "adjudicate"
  | "delete"
  | "help";

interface CommonOptions {
  pr?: number;
  repository?: string;
  reviewer?: string;
  dir: string;
  runGh: GhRunner;
}

interface AutomaticOptions extends CommonOptions {
  command: "capture-automatic";
  category?: string;
  categories?: string[];
  verdict?: string;
  verdicts?: string[];
  followUp?: string;
  followUps?: string[];
}

interface ManualOptions extends CommonOptions {
  command: "capture-manual";
  location?: string;
  title?: string;
  text?: string;
  category?: string;
  verdict?: string;
  followUp?: string;
  reviewedHead?: string;
  locationUnresolved?: boolean;
}

interface ReadOptions extends CommonOptions {
  command: "read";
  id?: string;
}

interface AdjudicateOptions extends CommonOptions {
  command: "adjudicate";
  id: string;
  verdict?: string;
  followUp?: string;
  rationale?: string;
}

interface DeleteOptions extends CommonOptions {
  command: "delete";
  id: string;
}

interface HelpOptions {
  command: "help";
  runGh: GhRunner;
  dir: string;
}

type CliOptions =
  | AutomaticOptions
  | ManualOptions
  | ReadOptions
  | AdjudicateOptions
  | DeleteOptions
  | HelpOptions;

export const CAPTURE_HELP = `Capture external-review misses as Ronda eval records (GitHub read-only).

Usage:
  npm run quality:misses -- capture --pr <n> --reviewer <name> --category <cat> [options]
  npm run quality:misses -- capture ... --categories <cat1,cat2,...> [--verdicts v1,v2] [--follow-ups f1,f2]
  npm run quality:misses -- capture-manual --pr <n> --reviewer <name> --location <loc> --text <text> --category <cat> [options]
  npm run quality:misses -- read [--id <id>] [--dir <path>]
  npm run quality:misses -- adjudicate --id <id> --rationale <text> [--verdict <v>] [--follow-up <f>]
  npm run quality:misses -- delete --id <id>
  npm run quality:misses -- help

Capture Decision Gate (four stages; first deciding stage wins):
  Stage 1 — Input resolution (whole capture):
    Pull request / current head resolve; reviewer named; Ronda result exists
    on some PR head. Automatic only: Codex GitHub reviewer supported and
    present; current-head silence is success ("nothing to capture");
    unparseable current-head output is refused.
  Stage 2 — Input validation (per finding):
    Required inputs present (reviewer, location, text, category); category
    in the closed set; supplied verdict / follow-up are documented values.
  Stage 3 — Credential refusal and reviewed-head validation (per finding):
    Credential-shaped content (unless a published placeholder); diff markers
    or >5 consecutive matching source/diff lines after quote/indent
    normalization; manually supplied reviewed head must be a real PR head.
    Fresh merge-base of reviewed head and base-branch tip is resolved at
    this capture (never reused from a prior capture).
  Stage 4 — Record decision (per finding):
    No existing identity → record written; matching identity → record updated.

Observable outcomes: capture_refused | nothing_to_capture | record_written | record_updated
Stale evidence is a record attribute (reviewed head ≠ Ronda result head), not an outcome.
Stage 1 refuses the whole capture; Stages 2–3 refuse only the affected finding.

Records are committed evidence under docs/testing/ronda/misses/. Capture never
posts comments, reviews, labels, or state changes to GitHub.
Adjudication and deletion rules are enforced by this tooling only.
`;

function parseArgs(argv: string[]): CliOptions {
  if (argv.length === 0 || argv[0] === "help" || argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help", runGh: defaultGhRunner, dir: DEFAULT_MISS_DIRECTORY };
  }

  const commandToken = argv[0];
  let command: Command;
  if (commandToken === "capture" || commandToken === "capture-automatic") {
    command = "capture-automatic";
  } else if (commandToken === "capture-manual") {
    command = "capture-manual";
  } else if (commandToken === "read") {
    command = "read";
  } else if (commandToken === "adjudicate") {
    command = "adjudicate";
  } else if (commandToken === "delete") {
    command = "delete";
  } else {
    throw new Error(`Unknown command: ${commandToken}`);
  }

  const options: Record<string, string | string[] | boolean | undefined> = {
    dir: DEFAULT_MISS_DIRECTORY,
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--pr" && next) {
      options.pr = next;
      index += 1;
    } else if (arg === "--repository" && next) {
      options.repository = next;
      index += 1;
    } else if (arg === "--reviewer" && next) {
      options.reviewer = next;
      index += 1;
    } else if (arg === "--category" && next) {
      options.category = next;
      index += 1;
    } else if (arg === "--categories" && next) {
      options.categories = next.split(",").map((value) => value.trim());
      index += 1;
    } else if (arg === "--verdict" && next) {
      options.verdict = next;
      index += 1;
    } else if (arg === "--verdicts" && next) {
      options.verdicts = next.split(",").map((value) => value.trim());
      index += 1;
    } else if ((arg === "--follow-up" || arg === "--intended-follow-up") && next) {
      options.followUp = next;
      index += 1;
    } else if (arg === "--follow-ups" && next) {
      options.followUps = next.split(",").map((value) => value.trim());
      index += 1;
    } else if (arg === "--location" && next) {
      options.location = next;
      index += 1;
    } else if (arg === "--title" && next) {
      options.title = next;
      index += 1;
    } else if (arg === "--text" && next) {
      options.text = next;
      index += 1;
    } else if (arg === "--reviewed-head" && next) {
      options.reviewedHead = next;
      index += 1;
    } else if (arg === "--location-unresolved") {
      options.locationUnresolved = true;
    } else if (arg === "--id" && next) {
      options.id = next;
      index += 1;
    } else if (arg === "--rationale" && next) {
      options.rationale = next;
      index += 1;
    } else if (arg === "--dir" && next) {
      options.dir = next;
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  const runGh = defaultGhRunner;
  const dir = String(options.dir ?? DEFAULT_MISS_DIRECTORY);
  const pr = parseOptionalPositiveInt(options.pr, "--pr");

  if (command === "capture-automatic") {
    return {
      command,
      pr,
      repository: options.repository as string | undefined,
      reviewer: options.reviewer as string | undefined,
      category: options.category as string | undefined,
      categories: options.categories as string[] | undefined,
      verdict: options.verdict as string | undefined,
      verdicts: options.verdicts as string[] | undefined,
      followUp: options.followUp as string | undefined,
      followUps: options.followUps as string[] | undefined,
      dir,
      runGh,
    };
  }
  if (command === "capture-manual") {
    return {
      command,
      pr,
      repository: options.repository as string | undefined,
      reviewer: options.reviewer as string | undefined,
      location: options.location as string | undefined,
      title: options.title as string | undefined,
      text: options.text as string | undefined,
      category: options.category as string | undefined,
      verdict: options.verdict as string | undefined,
      followUp: options.followUp as string | undefined,
      reviewedHead: options.reviewedHead as string | undefined,
      locationUnresolved: options.locationUnresolved === true,
      dir,
      runGh,
    };
  }
  if (command === "read") {
    return {
      command,
      pr,
      repository: options.repository as string | undefined,
      reviewer: options.reviewer as string | undefined,
      id: options.id as string | undefined,
      dir,
      runGh,
    };
  }
  if (command === "adjudicate") {
    if (!options.id) {
      throw new Error("--id is required for adjudicate");
    }
    return {
      command,
      id: String(options.id),
      verdict: options.verdict as string | undefined,
      followUp: options.followUp as string | undefined,
      rationale: options.rationale as string | undefined,
      dir,
      runGh,
    };
  }
  if (!options.id) {
    throw new Error("--id is required for delete");
  }
  return {
    command: "delete",
    id: String(options.id),
    dir,
    runGh,
  };
}

/**
 * Parse an optional CLI integer that must be the entire argument
 * (`98` ok, `98oops` refused). Avoid Number.parseInt's trailing-junk accept.
 */
function parseOptionalPositiveInt(
  raw: unknown,
  flag: string,
): number | undefined {
  if (raw === undefined || raw === null || raw === "") {
    return undefined;
  }
  const text = String(raw);
  if (!/^[1-9]\d*$/.test(text)) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return Number(text);
}

function requirePr(pr: number | undefined): number {
  if (pr === undefined || !Number.isInteger(pr) || pr <= 0) {
    throw new Error("--pr is required and must be a positive integer");
  }
  return pr;
}

function buildAutomaticPerFinding(options: AutomaticOptions): Array<{
  affectedCategory?: string;
  verdict?: string;
  intendedFollowUp?: string;
}> | undefined {
  if (options.categories && options.categories.length > 0) {
    const count = options.categories.length;
    if (options.verdicts && options.verdicts.length !== count) {
      throw new Error("--verdicts must list the same number of values as --categories");
    }
    if (options.followUps && options.followUps.length !== count) {
      throw new Error("--follow-ups must list the same number of values as --categories");
    }
    return options.categories.map((category, index) => ({
      affectedCategory: category,
      verdict: options.verdicts?.[index],
      intendedFollowUp: options.followUps?.[index],
    }));
  }
  if (options.category) {
    return [{ affectedCategory: options.category, verdict: options.verdict, intendedFollowUp: options.followUp }];
  }
  return undefined;
}

function corpusCache(
  evidence: PullRequestEvidence,
  runGh: GhRunner,
): {
  corpusForHead: (reviewedHeadSha: string) => SourceScanCorpus;
  mergeBaseForHead: (reviewedHeadSha: string) => string;
} {
  const mergeBases = new Map<string, string>();
  const corpora = new Map<string, SourceScanCorpus>();

  const mergeBaseForHead = (reviewedHeadSha: string): string => {
    const cached = mergeBases.get(reviewedHeadSha);
    if (cached) {
      return cached;
    }
    const fresh = resolveFreshMergeBase({
      repository: evidence.repository,
      reviewedHeadSha,
      baseRef: evidence.baseRef,
      runGh,
    });
    mergeBases.set(reviewedHeadSha, fresh);
    return fresh;
  };

  const corpusForHead = (reviewedHeadSha: string): SourceScanCorpus => {
    const cached = corpora.get(reviewedHeadSha);
    if (cached) {
      return cached;
    }
    const mergeBaseSha = mergeBaseForHead(reviewedHeadSha);
    const corpus = readSourceScanCorpus({
      repository: evidence.repository,
      pullNumber: evidence.pullNumber,
      reviewedHeadSha,
      mergeBaseSha,
      runGh,
    });
    corpora.set(reviewedHeadSha, corpus);
    return corpus;
  };

  return { corpusForHead, mergeBaseForHead };
}

function persistResult(
  result: CaptureGateResult,
  directory: string,
): void {
  for (const finding of result.findings) {
    if (
      (finding.outcome === "record_written" ||
        finding.outcome === "record_updated") &&
      finding.record
    ) {
      const path = missRecordPath(finding.record, directory);
      writeMissRecord(path, finding.record);
      finding.path = path;
    }
  }
}

function printCaptureResult(
  evidence: PullRequestEvidence,
  result: CaptureGateResult,
): void {
  if (result.wholeCapture) {
    const whole = result.wholeCapture;
    console.log(`OUTCOME=${whole.outcome}`);
    if (whole.reason) {
      console.log(`REASON=${whole.reason}`);
    }
    console.log(`REPOSITORY=${evidence.repository}`);
    console.log(`PULL_NUMBER=${evidence.pullNumber}`);
    console.log(`CURRENT_HEAD=${evidence.currentHeadSha}`);
    return;
  }

  let written = 0;
  let updated = 0;
  let refused = 0;
  for (const finding of result.findings) {
    console.log(`OUTCOME=${finding.outcome}`);
    if (finding.reason) {
      console.log(`REASON=${finding.reason}`);
    }
    if (finding.record) {
      console.log(`RECORD_ID=${finding.record.id}`);
      console.log(`REVIEWED_HEAD=${finding.record.reviewedHeadSha}`);
      console.log(`RONDA_RESULT_HEAD=${finding.record.rondaResultHeadSha}`);
      console.log(`STALE_EVIDENCE=${finding.record.staleEvidence}`);
      console.log(`EXTERNAL_REVIEWER=${finding.record.externalReviewer}`);
      if (finding.path) {
        console.log(`RECORD_PATH=${finding.path}`);
      }
      if (finding.outcome === "record_written") {
        written += 1;
      } else if (finding.outcome === "record_updated") {
        updated += 1;
      }
    }
    if (finding.outcome === "capture_refused") {
      refused += 1;
    }
  }
  console.log(`REPOSITORY=${evidence.repository}`);
  console.log(`PULL_NUMBER=${evidence.pullNumber}`);
  console.log(`CURRENT_HEAD=${evidence.currentHeadSha}`);
  console.log(`RECORDS_WRITTEN=${written}`);
  console.log(`RECORDS_UPDATED=${updated}`);
  console.log(`FINDINGS_REFUSED=${refused}`);
}

function isPathInsideDirectory(candidatePath: string, directory: string): boolean {
  const resolvedDir = resolve(directory);
  const resolvedPath = resolve(candidatePath);
  const rel = relative(resolvedDir, resolvedPath);
  return rel !== "" && !rel.startsWith(`..${sep}`) && !rel.startsWith("..") && !isAbsolute(rel);
}

function findRecordById(
  directory: string,
  id: string,
): { record: ExternalReviewMissRecord; path: string } | null {
  for (const record of loadAllMissRecords(directory)) {
    if (record.id === id) {
      return { record, path: missRecordPath(record, directory) };
    }
  }
  // Path-as-id is allowed only when the path resolves inside the configured
  // miss directory — never operate on arbitrary filesystem paths.
  const normalizedId = normalize(id);
  if (
    (normalizedId.includes(sep) || normalizedId.endsWith(".json")) &&
    isPathInsideDirectory(normalizedId, directory)
  ) {
    try {
      const record = readMissRecordFile(resolve(normalizedId));
      return { record, path: resolve(normalizedId) };
    } catch {
      return null;
    }
  }
  return null;
}

export async function main(
  argv = process.argv.slice(2),
  deps: { runGh?: GhRunner } = {},
): Promise<number> {
  const options = parseArgs(argv);
  if (deps.runGh) {
    (options as { runGh: GhRunner }).runGh = deps.runGh;
  }

  if (options.command === "help") {
    console.log(CAPTURE_HELP);
    return 0;
  }

  if (options.command === "read") {
    const records = loadAllMissRecords(options.dir).filter((record) => {
      if (options.id && record.id !== options.id) {
        return false;
      }
      if (options.pr && record.pullNumber !== options.pr) {
        return false;
      }
      if (options.repository && record.repository !== options.repository) {
        return false;
      }
      if (
        options.reviewer &&
        record.externalReviewer.toLowerCase() !== options.reviewer.toLowerCase()
      ) {
        return false;
      }
      return true;
    });

    // Fresh resolvability when evidence can be loaded for a PR
    const enriched = records.map((record) => {
      let unresolvableEvidence: boolean;
      try {
        const evidence = readPullRequestEvidence({
          pullNumber: record.pullNumber,
          repository: record.repository,
          runGh: options.runGh,
        });
        unresolvableEvidence = !isResolvableRondaHead({
          rondaResultHeadSha: record.rondaResultHeadSha,
          rondaResultHeadShas: evidence.rondaResultHeadShas,
        });
        const rondaReviewBody =
          rondaReviewBodyForHead({
            headSha: record.rondaResultHeadSha,
            rondaReviewBodyByHeadSha: evidence.rondaReviewBodyByHeadSha,
          }) ?? null;
        return {
          ...record,
          unresolvableEvidence,
          displayRondaResultHead: {
            reviewedHeadSha: record.reviewedHeadSha,
            rondaResultHeadSha: record.rondaResultHeadSha,
            staleEvidence: record.staleEvidence,
            rondaReviewBody,
          },
        };
      } catch {
        unresolvableEvidence = true;
      }
      return {
        ...record,
        unresolvableEvidence,
        displayRondaResultHead: {
          reviewedHeadSha: record.reviewedHeadSha,
          rondaResultHeadSha: record.rondaResultHeadSha,
          staleEvidence: record.staleEvidence,
          rondaReviewBody: null,
        },
      };
    });

    console.log(JSON.stringify(enriched, null, 2));
    return 0;
  }

  if (options.command === "adjudicate") {
    const found = findRecordById(options.dir, options.id);
    if (!found) {
      console.error(`No miss record found for id ${options.id}`);
      return 1;
    }
    let corpus: SourceScanCorpus;
    try {
      const evidence = readPullRequestEvidence({
        pullNumber: found.record.pullNumber,
        repository: found.record.repository,
        runGh: options.runGh,
      });
      const { corpusForHead } = corpusCache(evidence, options.runGh);
      corpus = corpusForHead(found.record.reviewedHeadSha);
    } catch (error: unknown) {
      console.log(`OUTCOME=adjudication_refused`);
      console.log(
        `REASON=Adjudication refused: source corpus could not be loaded (${
          error instanceof Error ? error.message : String(error)
        }).`,
      );
      return 1;
    }

    const result = adjudicateMissRecord({
      record: found.record,
      verdict: options.verdict,
      intendedFollowUp: options.followUp,
      rationale: options.rationale,
      corpus,
    });
    if (!result.ok) {
      console.log(`OUTCOME=adjudication_refused`);
      console.log(`REASON=${result.reason}`);
      return 1;
    }
    writeMissRecord(found.path, result.record);
    console.log(`OUTCOME=adjudicated`);
    console.log(`RECORD_PATH=${found.path}`);
    console.log(JSON.stringify(result.record, null, 2));
    return 0;
  }

  if (options.command === "delete") {
    const found = findRecordById(options.dir, options.id);
    if (!found) {
      console.error(`No miss record found for id ${options.id}`);
      return 1;
    }
    const gate = canDeleteMissRecord(found.record);
    if (!gate.allowed) {
      console.log(`OUTCOME=deletion_refused`);
      console.log(`REASON=${gate.reason}`);
      return 1;
    }
    deleteMissRecordFile(found.path);
    console.log(`OUTCOME=deleted`);
    console.log(`RECORD_PATH=${found.path}`);
    return 0;
  }

  const pr = requirePr(options.pr);
  let evidence: PullRequestEvidence;
  try {
    evidence = readPullRequestEvidence({
      pullNumber: pr,
      repository: options.repository,
      runGh: options.runGh,
    });
  } catch (error: unknown) {
    console.log(`OUTCOME=capture_refused`);
    console.log(
      `REASON=Capture refused: the pull request or its current head could not be resolved (${
        error instanceof Error ? error.message : String(error)
      }).`,
    );
    return 1;
  }

  const existingRecords = loadAllMissRecords(options.dir);
  const { corpusForHead, mergeBaseForHead } = corpusCache(
    evidence,
    options.runGh,
  );

  if (options.command === "capture-automatic") {
    const reviewer = options.reviewer ?? "";
    const stage1Through3 = evaluateCaptureStage1ThroughCondition3({
      evidence,
      namedReviewer: reviewer,
    });
    if (stage1Through3) {
      const refused = { wholeCapture: stage1Through3, findings: [] };
      persistResult(refused, options.dir);
      printCaptureResult(evidence, refused);
      return 1;
    }

    let codex: CodexPresence;
    try {
      codex = readCodexGithubFindings({
        repository: evidence.repository,
        pullNumber: evidence.pullNumber,
        currentHeadSha: evidence.currentHeadSha,
        namedReviewer: reviewer,
        runGh: options.runGh,
      });
    } catch {
      codex = {
        supported: true,
        presentOnPullRequest: false,
        findingsOnCurrentHead: [],
        unparseableOnCurrentHead: false,
      };
    }
    const perFinding = buildAutomaticPerFinding(options);
    const result = runCaptureDecisionGate({
      path: "automatic",
      evidence,
      namedReviewer: reviewer,
      automatic: codex,
      automaticDefaults:
        perFinding?.length === 1
          ? {
              affectedCategory: perFinding[0]?.affectedCategory,
              verdict: perFinding[0]?.verdict,
              intendedFollowUp: perFinding[0]?.intendedFollowUp,
            }
          : undefined,
      automaticPerFinding:
        perFinding && perFinding.length > 1 ? perFinding : undefined,
      existingRecords,
      corpusForHead,
      mergeBaseForHead,
    });
    persistResult(result, options.dir);
    printCaptureResult(evidence, result);
    if (result.wholeCapture?.outcome === "nothing_to_capture") {
      return 0;
    }
    if (result.wholeCapture?.outcome === "capture_refused") {
      return 1;
    }
    const anySuccess = result.findings.some(
      (finding) =>
        finding.outcome === "record_written" ||
        finding.outcome === "record_updated",
    );
    return anySuccess ? 0 : 1;
  }

  // capture-manual
  const result = runCaptureDecisionGate({
    path: "manual",
    evidence,
    namedReviewer: options.reviewer ?? "",
    manualFinding: {
      externalReviewer: options.reviewer ?? "",
      location: options.location ?? "",
      locationUnresolved: options.locationUnresolved,
      title: options.title,
      text: options.text ?? "",
      affectedCategory: options.category,
      verdict: options.verdict,
      intendedFollowUp: options.followUp,
      reviewedHeadSha: options.reviewedHead,
      sourceId: null,
    },
    existingRecords,
    corpusForHead,
    mergeBaseForHead,
  });
  persistResult(result, options.dir);
  printCaptureResult(evidence, result);
  if (result.wholeCapture?.outcome === "capture_refused") {
    return 1;
  }
  const anySuccess = result.findings.some(
    (finding) =>
      finding.outcome === "record_written" ||
      finding.outcome === "record_updated",
  );
  return anySuccess ? 0 : 1;
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("capture-external-review-misses.ts")
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
