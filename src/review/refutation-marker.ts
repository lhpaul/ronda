import { createHash } from "node:crypto";
import type { Finding, ReviewThread, ReviewThreadComment } from "../domain/review-pass.types.js";

/**
 * Refutation-marker dedupe (#174). A finding is not re-posted only when a
 * maintainer explicitly refuted the same claim, on the same path, over the
 * same cited code. A thread that was merely resolved (for instance because
 * the finding was fixed) suppresses nothing, and every doubt keeps the
 * finding (fail open).
 */

/** The exact first line of a refutation reply. Case-sensitive. */
export const REFUTATION_COMMAND = "/ronda refuted";

/** Author associations allowed to refute a finding. */
export const MAINTAINER_ASSOCIATIONS: ReadonlySet<string> = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/**
 * Lines on each side of the cited line that make up the cited code. A change
 * anywhere in the window (a removed guard above the cited line, for example)
 * expires the refutation.
 */
export const CITED_CODE_RADIUS = 10;

const MARKER_PATTERN = /<!-- ronda:finding (\S+) claim=([0-9a-f]+) code=([0-9a-f]+) -->/g;
const MARKER_VERSION = "v1";
const HASH_HEX_LENGTH = 64;

export interface FindingMarker {
  claim: string;
  code: string;
}

export interface Refutation {
  path: string;
  claim: string;
  code: string;
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Lowercase, every run of non-alphanumeric characters collapsed to one space,
 * trimmed. Alphanumeric is Unicode-aware, so titles in non-Latin scripts keep
 * their identity instead of all collapsing to the empty claim.
 */
export function normalizeClaim(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function claimHash(title: string): string {
  return sha256Hex(normalizeClaim(title));
}

/**
 * Hash of the cited code: the cited line's offset inside the window plus the
 * window's lines (cited line ± `CITED_CODE_RADIUS`, clipped to the file).
 * Undefined when the line is not inside the file.
 */
export function citedCodeHash(fileText: string, line: number): string | undefined {
  const lines = fileText.split(/\r\n|\n/);
  if (fileText.endsWith("\n")) lines.pop();
  if (!Number.isInteger(line) || line < 1 || line > lines.length) return undefined;
  const index = line - 1;
  const start = Math.max(0, index - CITED_CODE_RADIUS);
  const end = Math.min(lines.length, index + CITED_CODE_RADIUS + 1);
  return sha256Hex(`${index - start}\n${lines.slice(start, end).join("\n")}`);
}

/**
 * Neutralises anything shaped like a Ronda finding marker in model-written
 * text. The model's output is untrusted (it can be steered by pull-request
 * content), so it must never carry a marker of its own: a marker it planted
 * could bind a maintainer's refutation of the visible claim to a different,
 * attacker-chosen claim. Only `renderFindingMarker` may emit one.
 */
export function stripFindingMarkers(text: string): string {
  return text.replace(/<!--\s*ronda:finding[\s\S]*?-->/gi, "").replace(/<!--\s*ronda:finding/gi, "");
}

export function renderFindingMarker(marker: FindingMarker): string {
  return `<!-- ronda:finding ${MARKER_VERSION} claim=${marker.claim} code=${marker.code} -->`;
}

/** Exactly one well-formed v1 marker, or undefined. */
export function parseFindingMarker(body: string): FindingMarker | undefined {
  const matches = [...body.matchAll(MARKER_PATTERN)];
  if (matches.length !== 1) return undefined;
  const [, version, claim, code] = matches[0] as RegExpMatchArray;
  if (version !== MARKER_VERSION) return undefined;
  if (claim.length !== HASH_HEX_LENGTH || code.length !== HASH_HEX_LENGTH) return undefined;
  return { claim, code };
}

/** First line, trimmed, is exactly the command, and the author is a maintainer. */
export function isRefutationReply(comment: ReviewThreadComment): boolean {
  if (!MAINTAINER_ASSOCIATIONS.has(comment.authorAssociation)) return false;
  const firstLine = comment.body.split(/\r\n|\n/, 1)[0] ?? "";
  return firstLine.trim() === REFUTATION_COMMAND;
}

/**
 * One refutation per resolved thread whose first comment is a bot-authored
 * Ronda finding with a valid marker and whose later replies include a
 * maintainer's refutation.
 */
export function collectRefutations(threads: ReviewThread[]): Refutation[] {
  const refutations: Refutation[] = [];
  for (const thread of threads) {
    if (!thread.isResolved || thread.path === "") continue;
    const [root, ...replies] = thread.comments;
    if (root === undefined || !root.authorIsBot) continue;
    const marker = parseFindingMarker(root.body);
    if (marker === undefined) continue;
    if (!replies.some(isRefutationReply)) continue;
    refutations.push({ path: thread.path, claim: marker.claim, code: marker.code });
  }
  return refutations;
}

export interface RefutationFilterResult {
  kept: Finding[];
  refuted: Finding[];
}

/**
 * Drops a finding only when a refutation matches its path, normalized claim,
 * and cited-code hash exactly. `codeHashFor` is consulted only for a finding
 * whose path and claim already match; returning undefined keeps the finding.
 */
export async function filterRefutedFindings(
  findings: Finding[],
  refutations: Refutation[],
  codeHashFor: (path: string, line: number) => Promise<string | undefined>,
): Promise<RefutationFilterResult> {
  const kept: Finding[] = [];
  const refuted: Finding[] = [];
  for (const finding of findings) {
    // An empty normalized claim (a title with no letters or digits) identifies
    // nothing, so it never matches (fail open).
    if (finding.line === null || refutations.length === 0 || normalizeClaim(finding.title) === "") {
      kept.push(finding);
      continue;
    }
    const claim = claimHash(finding.title);
    const candidates = refutations.filter((r) => r.path === finding.path && r.claim === claim);
    if (candidates.length === 0) {
      kept.push(finding);
      continue;
    }
    const code = await codeHashFor(finding.path, finding.line);
    if (code !== undefined && candidates.some((r) => r.code === code)) {
      refuted.push(finding);
    } else {
      kept.push(finding);
    }
  }
  return { kept, refuted };
}
