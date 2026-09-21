import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { canonicalizeReviewerForIdentity } from "./miss-reviewer-aliases.js";
import { DEFAULT_MISS_DIRECTORY } from "./review-quality-report.js";

/** GitHub still uses SHA-1 object ids (40 hex chars) for commit heads. */
export const FULL_COMMIT_SHA_LENGTH = 40;
/**
 * Minimum abbreviation length accepted for reviewed-head identity / matching.
 * Shorter hex prefixes (e.g. a single character) are malformed (AC31).
 */
export const MIN_ABBREVIATED_COMMIT_SHA_LENGTH = 7;

export const MISS_VERDICTS = [
  "unadjudicated",
  "true_positive",
  "false_positive",
  "out_of_scope",
  "already_found",
] as const;

export type MissVerdict = (typeof MISS_VERDICTS)[number];

export const INTENDED_FOLLOW_UPS = [
  "undecided",
  "eval_record",
  "prompt_change",
  "backlog_item",
  "no_action",
] as const;

export type IntendedFollowUp = (typeof INTENDED_FOLLOW_UPS)[number];

export const AFFECTED_CATEGORIES = [
  "durability",
  "idempotency",
  "retries",
  "timeouts",
  "partial_success",
  "concurrency",
  "security",
  "correctness",
  "configuration",
  "observability",
  "other",
] as const;

export type AffectedCategory = (typeof AFFECTED_CATEGORIES)[number];

export const CAPTURE_SOURCES = ["automatic", "manual"] as const;

export type CaptureSource = (typeof CAPTURE_SOURCES)[number];

export const MAX_FINDING_TEXT_CHARS = 2000;
export const MAX_TITLE_CHARS = 120;
export const MAX_RATIONALE_CHARS = 2000;

/**
 * Full miss-record schema for durable eval evidence under
 * `docs/testing/ronda/misses/`.
 */
export interface ExternalReviewMissRecord {
  id: string;
  repository: string;
  pullNumber: number;
  reviewedHeadSha: string;
  rondaResultHeadSha: string;
  staleEvidence: boolean;
  externalReviewer: string;
  location: string;
  locationUnresolved: boolean;
  title: string;
  text: string;
  textTruncated: boolean;
  verdict: MissVerdict;
  affectedCategory: AffectedCategory;
  intendedFollowUp: IntendedFollowUp;
  captureSource: CaptureSource;
  /** Immutable source id for automatic records; null for manual. */
  sourceId: string | null;
  /**
   * Full pre-truncation manual identity key (`manual:<digest>`). Stored so
   * truncated title/text cannot collide distinct findings (AC41).
   */
  identityDigest?: string;
  rationale?: string;
  rationaleTruncated?: boolean;
  /** Optional local forensic timestamps; durable audit is git history. */
  capturedAt?: string;
  updatedAt?: string;
  /** Audit-only merge-base used at capture; never reused as a later scan baseline. */
  mergeBaseSha?: string;
}

export function isMissVerdict(value: string): value is MissVerdict {
  return (MISS_VERDICTS as readonly string[]).includes(value);
}

export function isIntendedFollowUp(value: string): value is IntendedFollowUp {
  return (INTENDED_FOLLOW_UPS as readonly string[]).includes(value);
}

export function isAffectedCategory(value: string): value is AffectedCategory {
  return (AFFECTED_CATEGORIES as readonly string[]).includes(value);
}

/** Collapse internal whitespace runs and trim for case-insensitive fields. */
export function canonicalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function canonicalizeCaseInsensitive(value: string): string {
  return canonicalizeWhitespace(value).toLowerCase();
}

/** Location: whitespace-insensitive, case-sensitive (AC30 / AC52). */
export function canonicalizeLocation(value: string): string {
  return canonicalizeWhitespace(value);
}

/**
 * True when value is a well-formed commit SHA or abbreviation: hex only,
 * length in [{@link MIN_ABBREVIATED_COMMIT_SHA_LENGTH}, {@link FULL_COMMIT_SHA_LENGTH}].
 */
export function isWellFormedCommitSha(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (
    normalized.length < MIN_ABBREVIATED_COMMIT_SHA_LENGTH ||
    normalized.length > FULL_COMMIT_SHA_LENGTH
  ) {
    return false;
  }
  return /^[0-9a-f]+$/.test(normalized);
}

/**
 * Normalize a commit SHA for identity comparison. Abbreviated forms match a
 * longer form when both are well-formed and one is a prefix of the other
 * (case-insensitive). Malformed values never match (AC31).
 */
export function headsMatch(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!isWellFormedCommitSha(a) || !isWellFormedCommitSha(b)) {
    return false;
  }
  return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * Resolve a reviewed-head spelling to the longest matching known PR head so
 * full and abbreviated forms share one identity digest (AC30).
 */
export function resolveCanonicalHeadSha(
  candidate: string,
  knownHeadShas: readonly string[],
): string | null {
  const trimmed = candidate.trim().toLowerCase();
  if (!isWellFormedCommitSha(trimmed)) {
    return null;
  }
  let best: string | null = null;
  for (const known of knownHeadShas) {
    const normalized = known.trim().toLowerCase();
    if (!isWellFormedCommitSha(normalized)) {
      continue;
    }
    if (
      normalized === trimmed ||
      normalized.startsWith(trimmed) ||
      trimmed.startsWith(normalized)
    ) {
      if (best === null || normalized.length > best.length) {
        best = normalized;
      }
    }
  }
  return best;
}

/**
 * First nonblank finding-text line, trimmed. Caller must scan the full
 * candidate before truncating to {@link MAX_TITLE_CHARS} for storage.
 */
export function deriveFindingTitle(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return null;
}

export function truncateBounded(
  value: string,
  maxChars: number,
): { value: string; truncated: boolean } {
  if (value.length <= maxChars) {
    return { value, truncated: false };
  }
  return { value: value.slice(0, maxChars), truncated: true };
}

export function buildAutomaticSourceId(input: {
  reviewOrCommentId: string | number;
  findingIndex: number;
}): string {
  return `${input.reviewOrCommentId}:${input.findingIndex}`;
}

export function automaticIdentityKey(input: {
  repository: string;
  pullNumber: number;
  sourceId: string;
}): string {
  return `auto:${input.repository}#${input.pullNumber}:${input.sourceId}`;
}

export function manualIdentityKey(input: {
  repository: string;
  pullNumber: number;
  externalReviewer: string;
  reviewedHeadSha: string;
  location: string;
  title: string;
  text: string;
  /** When provided, abbreviated heads resolve to the longest matching known SHA (AC30). */
  knownHeadShas?: readonly string[];
}): string {
  const headForIdentity =
    (input.knownHeadShas
      ? resolveCanonicalHeadSha(input.reviewedHeadSha, input.knownHeadShas)
      : null) ?? input.reviewedHeadSha.trim().toLowerCase();
  const payload = [
    input.repository.toLowerCase(),
    String(input.pullNumber),
    canonicalizeReviewerForIdentity(input.externalReviewer),
    headForIdentity,
    canonicalizeLocation(input.location),
    canonicalizeCaseInsensitive(input.title),
    canonicalizeCaseInsensitive(input.text),
  ].join("\u0000");
  const digest = createHash("sha256").update(payload).digest("hex").slice(0, 24);
  return `manual:${digest}`;
}

export function recordIdentityKey(record: ExternalReviewMissRecord): string {
  if (record.captureSource === "automatic") {
    if (!record.sourceId) {
      throw new Error("Automatic miss record is missing sourceId");
    }
    return automaticIdentityKey({
      repository: record.repository,
      pullNumber: record.pullNumber,
      sourceId: record.sourceId,
    });
  }
  // Prefer the persisted full-text digest when present so truncated storage
  // fields cannot rematch a different finding's identity.
  if (record.identityDigest && record.identityDigest.startsWith("manual:")) {
    return record.identityDigest;
  }
  return manualIdentityKey({
    repository: record.repository,
    pullNumber: record.pullNumber,
    externalReviewer: record.externalReviewer,
    reviewedHeadSha: record.reviewedHeadSha,
    location: record.location,
    title: record.title,
    text: record.text,
  });
}

export function defaultMissFilename(record: ExternalReviewMissRecord): string {
  const slug = record.id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "miss"}.json`;
}

export function missRecordPath(
  record: ExternalReviewMissRecord,
  directory = DEFAULT_MISS_DIRECTORY,
): string {
  return join(directory, defaultMissFilename(record));
}

export function writeMissRecord(
  path: string,
  record: ExternalReviewMissRecord,
): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);
}

export function readMissRecordFile(path: string): ExternalReviewMissRecord {
  return JSON.parse(readFileSync(path, "utf8")) as ExternalReviewMissRecord;
}

export function deleteMissRecordFile(path: string): void {
  unlinkSync(path);
}

export function listMissRecordFiles(
  directory = DEFAULT_MISS_DIRECTORY,
): string[] {
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => join(directory, name));
}

export function loadAllMissRecords(
  directory = DEFAULT_MISS_DIRECTORY,
): ExternalReviewMissRecord[] {
  return listMissRecordFiles(directory).map(readMissRecordFile);
}

export function findMissByIdentity(
  records: ExternalReviewMissRecord[],
  identityKey: string,
): ExternalReviewMissRecord | undefined {
  return records.find((record) => recordIdentityKey(record) === identityKey);
}

export function buildMissRecordId(input: {
  repository: string;
  pullNumber: number;
  captureSource: CaptureSource;
  identityKey: string;
}): string {
  const repo = input.repository.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const kind = input.captureSource === "automatic" ? "auto" : "manual";
  const suffix = createHash("sha256")
    .update(input.identityKey)
    .digest("hex")
    .slice(0, 12);
  return `${repo}-pr-${input.pullNumber}-${kind}-${suffix}`;
}
