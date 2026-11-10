import { parseDiffNewSideLines } from "./refuted-findings-diff.js";
import type { ChangedFile, Finding } from "../domain/review-pass.types.js";

/**
 * Deterministic post-filters for findings a maintainer would only refute by
 * hand (#158). Neither filter changes the prompt or the model: both run on
 * parsed findings after the model call, and both fail open (an unreadable
 * line, an unrecognised shape, or an unavailable thread read keeps the
 * finding).
 */

/** A prior Ronda inline comment in a review thread a maintainer resolved. */
export interface ResolvedRondaThread {
  path: string;
  /** Body of the thread's first comment, in Ronda's `**Label** — title` shape. */
  body: string;
}

export type SuppressionReason = "names_credential_without_value" | "resolved_thread";

export interface SuppressedFinding {
  finding: Finding;
  reason: SuppressionReason;
}

export interface FilterResult {
  kept: Finding[];
  suppressed: SuppressedFinding[];
}

const CREDENTIAL_WORDS = /\b(credentials?|api[ _-]?keys?|secrets?|tokens?|passwords?|passphrases?)\b|_API_KEY\b/i;
const EXPOSURE_WORDS =
  /\b(expos\w*|leak\w*|disclos\w*|reveal\w*|print\w*|logg?(?:ed|ing)?|includ\w*|interpolat\w*|echo\w*|surfac\w*|contain\w*)\b/i;
const MESSAGE_WORDS = /\b(error|errors|exception|message|messages|output|log|logs|stack ?trace|response)\b/i;

/** True when a finding claims a credential is exposed through a message/log/output. */
export function isCredentialInMessageClaim(finding: Finding): boolean {
  const text = `${finding.title}\n${finding.body}`;
  return CREDENTIAL_WORDS.test(text) && EXPOSURE_WORDS.test(text) && MESSAGE_WORDS.test(text);
}

/** Code outside any string literal; literal contents are replaced by `""`. */
function stripStringLiterals(line: string): string | undefined {
  let out = "";
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let j = i + 1;
      while (j < line.length && line[j] !== quote) {
        if (line[j] === "\\") j += 1;
        if (quote === "`" && line[j] === "$" && line[j + 1] === "{") return undefined; // interpolation
        j += 1;
      }
      if (j >= line.length) return undefined; // unterminated: do not guess
      out += `${quote}${quote}`;
      i = j + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

const VALUE_IDENTIFIER = /(api[_-]?key|apikey|token|secret|password|passphrase|credential|authorization|bearer)/i;

/**
 * True when the cited source line only *names* a credential in a fixed string
 * literal: it has a string literal, no interpolation, no concatenation, no
 * format placeholder, and no credential-looking identifier outside the literal.
 */
export function lineNamesCredentialWithoutValue(line: string): boolean {
  const code = stripStringLiterals(line);
  if (code === undefined) return false;
  if (!/(["'`])\1/.test(code)) return false; // needs a literal
  if (code.includes("+")) return false; // concatenation or arithmetic: do not guess
  if (/\.format\s*\(|\.concat\s*\(|\.join\s*\(|%[sdvq]|\{\}|\bf["']/.test(line)) return false;
  if (VALUE_IDENTIFIER.test(code)) return false;
  return true;
}

/**
 * Drops "credential exposed in a message" findings whose cited added/context
 * line is a fixed string that only names a credential variable or config key.
 * Findings with no line, an unreadable patch, or any interpolation stay.
 */
export function filterNamedCredentialFindings(
  findings: Finding[],
  changedFiles: ChangedFile[],
): FilterResult {
  const linesByPath = new Map<string, Map<number, string>>();
  const kept: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];
  for (const finding of findings) {
    if (finding.line === null || !isCredentialInMessageClaim(finding)) {
      kept.push(finding);
      continue;
    }
    let lines = linesByPath.get(finding.path);
    if (!lines) {
      const file = changedFiles.find((f) => f.path === finding.path);
      lines = parseDiffNewSideLines(file?.patch);
      linesByPath.set(finding.path, lines);
    }
    const text = lines.get(finding.line);
    if (text !== undefined && lineNamesCredentialWithoutValue(text)) {
      suppressed.push({ finding, reason: "names_credential_without_value" });
    } else {
      kept.push(finding);
    }
  }
  return { kept, suppressed };
}

const TITLE_FROM_BODY = /^\*\*[^*\n]+\*\*\s+—\s+([^\n]+)/;

export function normalizeClaim(title: string): string {
  return title
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^a-z0-9_ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter((t) => t.length > 2));
}

const SIMILARITY_THRESHOLD = 0.8;

function sameClaim(a: string, b: string): boolean {
  if (a === b) return a.length > 0;
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return false;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared) >= SIMILARITY_THRESHOLD;
}

/** The claim title of a Ronda-rendered comment body, or undefined for any other shape. */
export function rondaCommentTitle(body: string): string | undefined {
  return TITLE_FROM_BODY.exec(body.trim())?.[1];
}

/**
 * Drops a finding that repeats, on the same path, a claim a maintainer already
 * resolved. Line numbers are ignored on purpose: they shift on every push.
 */
export function filterResolvedThreadFindings(
  findings: Finding[],
  resolved: ResolvedRondaThread[],
): FilterResult {
  const claimsByPath = new Map<string, string[]>();
  for (const thread of resolved) {
    const title = rondaCommentTitle(thread.body);
    if (title === undefined) continue;
    const list = claimsByPath.get(thread.path) ?? [];
    list.push(normalizeClaim(title));
    claimsByPath.set(thread.path, list);
  }
  const kept: Finding[] = [];
  const suppressed: SuppressedFinding[] = [];
  for (const finding of findings) {
    const claim = normalizeClaim(finding.title);
    const prior = claimsByPath.get(finding.path);
    if (prior?.some((p) => sameClaim(p, claim))) {
      suppressed.push({ finding, reason: "resolved_thread" });
    } else {
      kept.push(finding);
    }
  }
  return { kept, suppressed };
}
