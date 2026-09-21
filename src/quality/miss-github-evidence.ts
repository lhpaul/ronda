import { execFileSync } from "node:child_process";
import { RONDA_REVIEW_HEADING } from "../core/summary.js";
import { isCodexGithubReviewer } from "./miss-reviewer-aliases.js";
import { headsMatch, isWellFormedCommitSha } from "./miss-record.js";

export interface PullRequestEvidence {
  repository: string;
  pullNumber: number;
  currentHeadSha: string;
  baseRef: string;
  baseSha: string;
  /** Push-order head SHAs for this PR (oldest first; last is most recently pushed). */
  pushOrderedHeadShas: string[];
  /** Head SHAs for which a Ronda review result is resolvable. */
  rondaResultHeadShas: string[];
}

export interface ExternalFindingCandidate {
  sourceId: string;
  externalReviewer: string;
  reviewedHeadSha: string;
  location: string;
  locationUnresolved: boolean;
  title: string | null;
  text: string;
}

export interface CodexPresence {
  supported: boolean;
  presentOnPullRequest: boolean;
  findingsOnCurrentHead: ExternalFindingCandidate[];
  /** True when reviewer output on the current head exists but could not be parsed. */
  unparseableOnCurrentHead: boolean;
}

export type GhRunner = (args: string[]) => string;

export function defaultGhRunner(args: string[]): string {
  return execFileSync("gh", args, { encoding: "utf8" }).trim();
}

/**
 * Parse `gh api --paginate` output. Paginate emits one JSON array document per
 * page concatenated together; a single `JSON.parse` only works for one page.
 */
export function parseGhPaginatedJsonArray<T>(raw: string): T[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed as T[];
    }
    return [parsed as T];
  } catch {
    // Concatenated page arrays: `[{...}][{...}]` → one flat array.
    const merged = `[${trimmed
      .replace(/^\s*\[/, "")
      .replace(/\]\s*$/, "")
      .replace(/\]\s*\[/g, ",")}]`;
    const parsed = JSON.parse(merged) as unknown;
    if (!Array.isArray(parsed)) {
      throw new Error(
        "Expected gh api --paginate output to be one or more JSON arrays",
      );
    }
    return parsed as T[];
  }
}

export function splitOwnerRepo(repository: string): {
  owner: string;
  repo: string;
} {
  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repository '${repository}'; expected owner/repo`);
  }
  return { owner, repo };
}

interface GhPullView {
  headRefOid?: string;
  baseRefName?: string;
  baseRefOid?: string;
  url?: string;
}

interface GhReview {
  id?: number | string;
  node_id?: string;
  user?: { login?: string } | null;
  body?: string | null;
  commit_id?: string | null;
  submitted_at?: string | null;
  state?: string | null;
}

interface GhReviewComment {
  id?: number | string;
  user?: { login?: string } | null;
  body?: string | null;
  path?: string | null;
  line?: number | null;
  original_line?: number | null;
  commit_id?: string | null;
  original_commit_id?: string | null;
  pull_request_review_id?: number | null;
}

interface GhCommit {
  sha?: string;
}

interface GhTimelineEvent {
  event?: string;
  before?: string;
  after?: string;
}

/**
 * Build push-ordered PR head tips (oldest first). Prefer timeline
 * `head_ref_force_pushed` before/after tips so force-pushed-away heads remain
 * ordered; then append commits still reachable on the PR. Never use review
 * publish order (AC37).
 */
export function buildPushOrderedHeadShas(input: {
  currentHeadSha: string;
  commits: Array<{ sha?: string }>;
  timelineEvents?: GhTimelineEvent[];
}): string[] {
  const ordered: string[] = [];
  const pushUnique = (sha: string | undefined): void => {
    const trimmed = sha?.trim() ?? "";
    if (!trimmed) {
      return;
    }
    if (ordered.some((existing) => headsMatch(existing, trimmed))) {
      return;
    }
    ordered.push(trimmed);
  };

  for (const event of input.timelineEvents ?? []) {
    if (event.event !== "head_ref_force_pushed") {
      continue;
    }
    pushUnique(event.before);
    pushUnique(event.after);
  }

  // The PR commits endpoint lists every reachable commit, not each branch tip.
  // Historical PR heads come from timeline force-push tips only (AC37).

  const withoutCurrent = ordered.filter(
    (sha) => !headsMatch(sha, input.currentHeadSha),
  );
  return [...withoutCurrent, input.currentHeadSha];
}

/**
 * Read pull-request metadata and Ronda/Codex evidence via `gh` (read-only).
 * Injectable runner keeps unit tests off the network.
 */
export function readPullRequestEvidence(input: {
  pullNumber: number;
  repository?: string;
  runGh?: GhRunner;
}): PullRequestEvidence {
  const runGh = input.runGh ?? defaultGhRunner;
  const repository =
    input.repository ??
    runGh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
  if (!repository) {
    throw new Error("Could not resolve repository; pass --repository");
  }

  const viewRaw = runGh([
    "pr",
    "view",
    String(input.pullNumber),
    "--json",
    "headRefOid,baseRefName,baseRefOid,url",
    "--repo",
    repository,
  ]);
  const view = JSON.parse(viewRaw) as GhPullView;
  const currentHeadSha = view.headRefOid?.trim() ?? "";
  if (!currentHeadSha) {
    throw new Error("Could not resolve PR head SHA");
  }

  const { owner, repo } = splitOwnerRepo(repository);
  const commitsRaw = runGh([
    "api",
    `repos/${owner}/${repo}/pulls/${input.pullNumber}/commits`,
    "--paginate",
  ]);
  const commits = parseGhPaginatedJsonArray<GhCommit>(commitsRaw || "[]");

  let timelineEvents: GhTimelineEvent[] = [];
  try {
    const timelineRaw = runGh([
      "api",
      `repos/${owner}/${repo}/issues/${input.pullNumber}/timeline`,
      "--paginate",
    ]);
    timelineEvents = parseGhPaginatedJsonArray<GhTimelineEvent>(
      timelineRaw || "[]",
    );
  } catch {
    // Timeline enrichment is best-effort; commits + fail-closed resolve remain.
  }

  const pushOrderedHeadShas = buildPushOrderedHeadShas({
    currentHeadSha,
    commits,
    timelineEvents,
  });

  const reviewsRaw = runGh([
    "api",
    `repos/${owner}/${repo}/pulls/${input.pullNumber}/reviews`,
    "--paginate",
  ]);
  const reviews = parseGhPaginatedJsonArray<GhReview>(reviewsRaw || "[]");
  const rondaResultHeadShas: string[] = [];
  for (const review of reviews) {
    const body = review.body ?? "";
    const commitId = review.commit_id?.trim() ?? "";
    if (!commitId || !body.includes(RONDA_REVIEW_HEADING)) {
      continue;
    }
    if (!rondaResultHeadShas.some((sha) => headsMatch(sha, commitId))) {
      rondaResultHeadShas.push(commitId);
    }
  }

  return {
    repository,
    pullNumber: input.pullNumber,
    currentHeadSha,
    baseRef: view.baseRefName ?? "",
    baseSha: view.baseRefOid ?? "",
    pushOrderedHeadShas,
    rondaResultHeadShas,
  };
}

/**
 * Resolve the Ronda result head for a reviewed head using push-order only
 * (AC37): same-head first, otherwise the most recently pushed PR head that
 * has a Ronda result.
 */
export function resolveRondaResultHead(input: {
  reviewedHeadSha: string;
  pushOrderedHeadShas: string[];
  rondaResultHeadShas: string[];
}): string | null {
  if (input.rondaResultHeadShas.length === 0) {
    return null;
  }

  const sameHead = input.rondaResultHeadShas.find((sha) =>
    headsMatch(sha, input.reviewedHeadSha),
  );
  if (sameHead) {
    return sameHead;
  }

  // Walk push order from newest to oldest; first Ronda-bearing head wins.
  for (let index = input.pushOrderedHeadShas.length - 1; index >= 0; index -= 1) {
    const head = input.pushOrderedHeadShas[index] ?? "";
    const match = input.rondaResultHeadShas.find((sha) => headsMatch(sha, head));
    if (match) {
      return match;
    }
  }

  // Fail closed (AC37): never fall back to reviews-endpoint / publish order.
  // When no Ronda-bearing head appears in push order, there is no push-order
  // resolution — callers refuse capture rather than guessing.
  return null;
}

export function isResolvableRondaHead(input: {
  rondaResultHeadSha: string;
  rondaResultHeadShas: string[];
}): boolean {
  return input.rondaResultHeadShas.some((sha) =>
    headsMatch(sha, input.rondaResultHeadSha),
  );
}

/**
 * Build a resolvability checker from freshly loaded PR evidence keyed by
 * repository#pullNumber. When evidence is missing, the record is unresolvable.
 */
export function buildResolvabilityChecker(
  evidenceByPull: Map<string, Pick<PullRequestEvidence, "rondaResultHeadShas">>,
): (record: {
  repository: string;
  pullNumber: number;
  rondaResultHeadSha: string;
}) => boolean {
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

/**
 * Load fresh Ronda result-head evidence per repository#pullNumber. Missing or
 * failed lookups leave the key absent so {@link buildResolvabilityChecker}
 * treats those records as unresolvable (AC48).
 */
export function loadFreshMissEvidenceByPull(input: {
  records: Array<{ repository: string; pullNumber: number }>;
  runGh?: GhRunner;
}): Map<string, Pick<PullRequestEvidence, "rondaResultHeadShas">> {
  const evidenceByPull = new Map<
    string,
    Pick<PullRequestEvidence, "rondaResultHeadShas">
  >();
  const runGh = input.runGh ?? defaultGhRunner;
  for (const record of input.records) {
    const key = `${record.repository}#${record.pullNumber}`;
    if (evidenceByPull.has(key)) {
      continue;
    }
    try {
      const evidence = readPullRequestEvidence({
        pullNumber: record.pullNumber,
        repository: record.repository,
        runGh,
      });
      evidenceByPull.set(key, {
        rondaResultHeadShas: evidence.rondaResultHeadShas,
      });
    } catch {
      // Absent key → unresolvable at summary/report time (fail closed for AC48).
    }
  }
  return evidenceByPull;
}

export function isKnownPullRequestHead(input: {
  headSha: string;
  pushOrderedHeadShas: string[];
  currentHeadSha: string;
}): boolean {
  // Malformed abbreviations (too short / non-hex) never count as known (AC31).
  if (!isWellFormedCommitSha(input.headSha)) {
    return false;
  }
  if (headsMatch(input.headSha, input.currentHeadSha)) {
    return true;
  }
  return input.pushOrderedHeadShas.some((sha) => headsMatch(sha, input.headSha));
}

/**
 * Split one review comment body into distinct finding texts when the reviewer
 * published multiple bullet/numbered items in a single comment.
 */
export function splitCommentFindingTexts(body: string): string[] {
  const trimmed = body.trim();
  if (!trimmed) {
    return [];
  }
  const lines = trimmed.split(/\r?\n/);
  const segments: string[] = [];
  let current: string[] = [];
  const isItemStart = (line: string): boolean =>
    /^(\*\s+|-\s+|\d+\.\s+)/.test(line.trim());

  for (const line of lines) {
    if (isItemStart(line) && current.length > 0) {
      segments.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    segments.push(current.join("\n").trim());
  }

  const nonEmpty = segments.filter((segment) => segment.length > 0);
  if (nonEmpty.length <= 1) {
    return [trimmed];
  }
  return nonEmpty.map((segment) =>
    segment.replace(/^(\*\s+|-\s+|\d+\.\s+)/, "").trim(),
  );
}

function parseFindingFromComment(input: {
  comment: GhReviewComment;
  reviewOrCommentId: string;
  findingIndex: number;
  reviewerLogin: string;
  textOverride?: string;
}): ExternalFindingCandidate {
  const text = (input.textOverride ?? input.comment.body ?? "").trim();
  const path = input.comment.path?.trim() ?? "";
  const line = input.comment.line ?? input.comment.original_line;
  let location: string;
  let locationUnresolved: boolean;
  if (path && typeof line === "number" && line > 0) {
    location = `${path}:${line}`;
    locationUnresolved = false;
  } else if (path) {
    location = path;
    locationUnresolved = true;
  } else {
    location = "unresolved";
    locationUnresolved = true;
  }

  const firstLine = text.split(/\r?\n/).find((lineText) => lineText.trim())?.trim();
  // Pass the full first-line title candidate; the capture gate scans before
  // truncating to 120 characters for storage.
  const title = firstLine ?? null;

  return {
    sourceId: `${input.reviewOrCommentId}:${input.findingIndex}`,
    externalReviewer: input.reviewerLogin,
    reviewedHeadSha:
      input.comment.commit_id?.trim() ||
      input.comment.original_commit_id?.trim() ||
      "",
    location,
    locationUnresolved,
    title,
    text,
  };
}

/**
 * Read Codex GitHub reviewer presence and current-head findings.
 */
export function readCodexGithubFindings(input: {
  repository: string;
  pullNumber: number;
  currentHeadSha: string;
  namedReviewer: string;
  runGh?: GhRunner;
}): CodexPresence {
  const runGh = input.runGh ?? defaultGhRunner;

  if (!isCodexGithubReviewer(input.namedReviewer)) {
    return {
      supported: false,
      presentOnPullRequest: false,
      findingsOnCurrentHead: [],
      unparseableOnCurrentHead: false,
    };
  }

  const { owner, repo } = splitOwnerRepo(input.repository);
  const reviewsRaw = runGh([
    "api",
    `repos/${owner}/${repo}/pulls/${input.pullNumber}/reviews`,
    "--paginate",
  ]);
  const commentsRaw = runGh([
    "api",
    `repos/${owner}/${repo}/pulls/${input.pullNumber}/comments`,
    "--paginate",
  ]);
  const reviews = parseGhPaginatedJsonArray<GhReview>(reviewsRaw || "[]");
  const comments = parseGhPaginatedJsonArray<GhReviewComment>(
    commentsRaw || "[]",
  );

  const codexReviews = reviews.filter((review) =>
    isCodexGithubReviewer(review.user?.login ?? ""),
  );
  const codexComments = comments.filter((comment) =>
    isCodexGithubReviewer(comment.user?.login ?? ""),
  );

  const presentOnPullRequest =
    codexReviews.length > 0 || codexComments.length > 0;

  const findings: ExternalFindingCandidate[] = [];
  let sawCurrentHeadBody = false;
  const reviewIdsWithInlineComments = new Set<string>();

  for (const comment of codexComments) {
    const head =
      comment.commit_id?.trim() || comment.original_commit_id?.trim() || "";
    if (!headsMatch(head, input.currentHeadSha)) {
      continue;
    }
    if (comment.pull_request_review_id != null) {
      reviewIdsWithInlineComments.add(String(comment.pull_request_review_id));
    }
    sawCurrentHeadBody = true;
    const body = (comment.body ?? "").trim();
    if (!body) {
      continue;
    }
    const commentId = String(
      comment.id ?? comment.pull_request_review_id ?? "comment",
    );
    const findingTexts = splitCommentFindingTexts(body);
    findingTexts.forEach((findingText, findingIndex) => {
      findings.push(
        parseFindingFromComment({
          comment,
          reviewOrCommentId: commentId,
          findingIndex,
          reviewerLogin: comment.user?.login ?? input.namedReviewer,
          textOverride: findingText,
        }),
      );
    });
  }

  // Review-level bodies without inline comments: treat as a single finding when
  // on the current head and body is non-empty.
  for (const review of codexReviews) {
    const head = review.commit_id?.trim() ?? "";
    if (!headsMatch(head, input.currentHeadSha)) {
      continue;
    }
    const body = (review.body ?? "").trim();
    if (!body) {
      continue;
    }
    sawCurrentHeadBody = true;
    // Skip when inline comments on this review were already captured.
    if (
      review.id != null &&
      reviewIdsWithInlineComments.has(String(review.id))
    ) {
      continue;
    }
    findings.push({
      sourceId: `${review.id ?? review.node_id ?? "review"}:0`,
      externalReviewer: review.user?.login ?? input.namedReviewer,
      reviewedHeadSha: head,
      location: "unresolved",
      locationUnresolved: true,
      title:
        body.split(/\r?\n/).find((line) => line.trim())?.trim() ?? null,
      text: body,
    });
  }

  const unparseableOnCurrentHead =
    sawCurrentHeadBody === false &&
    presentOnPullRequest &&
    codexReviews.some((review) =>
      headsMatch(review.commit_id?.trim() ?? "", input.currentHeadSha),
    ) &&
    findings.length === 0;

  // Stronger unparseable signal: body present on current head but empty of
  // extractable finding text after we already saw a current-head review with
  // only whitespace — treat as unparseable when presence is current-head-only
  // and findings stayed empty while a non-empty marker was expected.
  const currentHeadReviews = codexReviews.filter((review) =>
    headsMatch(review.commit_id?.trim() ?? "", input.currentHeadSha),
  );
  const currentHeadComments = codexComments.filter((comment) =>
    headsMatch(
      comment.commit_id?.trim() || comment.original_commit_id?.trim() || "",
      input.currentHeadSha,
    ),
  );
  const hasCurrentHeadPresence =
    currentHeadReviews.length > 0 || currentHeadComments.length > 0;

  return {
    supported: true,
    presentOnPullRequest,
    findingsOnCurrentHead: findings,
    unparseableOnCurrentHead:
      unparseableOnCurrentHead ||
      (hasCurrentHeadPresence &&
        findings.length === 0 &&
        currentHeadComments.some((comment) => (comment.body ?? "").length > 0) === false &&
        currentHeadReviews.some(
          (review) => (review.body ?? "").trim().length > 0 && !(review.body ?? "").includes("\n"),
        )),
  };
}

/**
 * Resolve a fresh merge-base of reviewed head and base-branch tip at capture
 * time (AC54). Never reuse a prior capture's merge-base.
 */
export function resolveFreshMergeBase(input: {
  repository: string;
  reviewedHeadSha: string;
  baseRef: string;
  runGh?: GhRunner;
}): string {
  const runGh = input.runGh ?? defaultGhRunner;
  const { owner, repo } = splitOwnerRepo(input.repository);

  // Resolve base branch tip at capture time.
  const baseTip = runGh([
    "api",
    `repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(input.baseRef)}`,
    "--jq",
    ".object.sha",
  ]).trim();
  if (!baseTip) {
    throw new Error(`Could not resolve base branch tip for ${input.baseRef}`);
  }

  const mergeBase = runGh([
    "api",
    `repos/${owner}/${repo}/compare/${baseTip}...${input.reviewedHeadSha}`,
    "--jq",
    ".merge_base_commit.sha",
  ]).trim();
  if (!mergeBase) {
    throw new Error(
      `Could not resolve merge-base for ${input.reviewedHeadSha} and ${input.baseRef}`,
    );
  }
  return mergeBase;
}

export function readSourceScanCorpus(input: {
  repository: string;
  pullNumber: number;
  reviewedHeadSha: string;
  mergeBaseSha: string;
  runGh?: GhRunner;
}): { changedFileContents: string[]; diffText: string } {
  const runGh = input.runGh ?? defaultGhRunner;
  const { owner, repo } = splitOwnerRepo(input.repository);

  const compareRaw = runGh([
    "api",
    `repos/${owner}/${repo}/compare/${input.mergeBaseSha}...${input.reviewedHeadSha}`,
  ]);
  const compare = JSON.parse(compareRaw || "{}") as {
    files?: Array<{ filename?: string; patch?: string; status?: string }>;
  };

  if ((compare.files?.length ?? 0) >= 300) {
    throw new Error(
      "Incomplete diff evidence: compare response reached GitHub's 300-file limit; capture refused.",
    );
  }

  const diffParts: string[] = [];
  const changedFileContents: string[] = [];

  for (const file of compare.files ?? []) {
    const filename = file.filename ?? "";
    // Fail closed for AC10/AC38: a missing patch leaves diff-marker / copied-
    // hunk scanning incomplete (removed files have no head-blob fallback).
    if (!file.patch) {
      throw new Error(
        `Incomplete diff evidence: compare entry for '${
          filename || "(unnamed)"
        }' has no patch; capture refused.`,
      );
    }
    diffParts.push(`diff --git a/${filename} b/${filename}`);
    diffParts.push(file.patch);
    if (!filename || file.status === "removed") {
      continue;
    }
    // Fail closed (sensitive-content scan): every non-removed changed file must
    // contribute readable content, or the corpus is incomplete and capture must
    // refuse rather than under-scan.
    const encoded = filename
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    let contentRaw: string;
    try {
      contentRaw = runGh([
        "api",
        `repos/${owner}/${repo}/contents/${encoded}?ref=${input.reviewedHeadSha}`,
      ]);
    } catch (error: unknown) {
      throw new Error(
        `Blob lookup failed for changed file '${filename}' at ${input.reviewedHeadSha}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { cause: error },
      );
    }
    const content = JSON.parse(contentRaw || "{}") as {
      content?: string;
      encoding?: string;
    };
    if (content.encoding !== "base64" || !content.content) {
      throw new Error(
        `Blob lookup returned unreadable content for changed file '${filename}' at ${input.reviewedHeadSha}`,
      );
    }
    changedFileContents.push(
      Buffer.from(content.content.replace(/\n/g, ""), "base64").toString("utf8"),
    );
  }

  return {
    changedFileContents,
    diffText: diffParts.join("\n"),
  };
}
