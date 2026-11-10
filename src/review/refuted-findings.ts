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

/**
 * Splits a line into code outside string literals (literal contents replaced
 * by `""`) and the literal contents. Undefined when the line cannot be split
 * safely (interpolation, unterminated literal).
 */
function splitStringLiterals(line: string): { code: string; literals: string[] } | undefined {
  let code = "";
  const literals: string[] = [];
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
      literals.push(line.slice(i + 1, j));
      code += `${quote}${quote}`;
      i = j + 1;
    } else {
      code += ch;
      i += 1;
    }
  }
  return { code, literals };
}

/**
 * The only code shapes recognised as harmless: an error constructor, throw, or
 * log/print call whose single argument is one fixed string literal. Anything
 * else (extra arguments, variables, calls, operators) is ambiguous and kept.
 */
const HARMLESS_CODE =
  /^\s*(?:(?:return|throw|raise)\s+)?(?:new\s+)?(?:(?:[A-Za-z_]\w*)?Error|Exception|(?:console|logger|log|logging)\.(?:log|info|warn|warning|error|debug)|print|println)\s*\(\s*(["'`])\1\s*\)\s*[;,)}]*\s*$/;

const CREDENTIAL_VOCAB = new Set([
  "credential", "credentials", "secret", "secrets", "token", "tokens", "password", "passwords",
  "passphrase", "passphrases", "key", "keys", "api", "auth", "authentication", "authorization",
  "apikey",
]);
const META_VOCAB = new Set([
  "missing", "not", "no", "set", "unset", "required", "invalid", "expired", "configured", "empty",
  "failed", "failure", "rejected", "unavailable", "found", "provided", "supplied", "defined",
  "specified", "present", "valid", "model", "see", "please", "set", "check", "your", "add", "use",
  "the", "is", "are", "was", "be", "a", "an", "for", "in", "to", "from", "of", "on", "or", "and",
  "with", "this", "that", "it", "has", "have", "been", "must", "cannot", "can", "need", "needed",
  "error", "access", "login", "bearer", "env", "environment", "variable", "config", "configuration",
  "value", "when", "if", "before", "after", "run",
]);
/** An environment-variable name that itself names a credential, e.g. RONDA_MODEL_API_KEY. */
const CREDENTIAL_ENV_NAME = /^[A-Z]+(?:_[A-Z]+)*_(?:API_KEY|KEY|TOKEN|SECRET|PASSWORD|CREDENTIALS?)$/;
/** A letters-only relative document path, e.g. docs/adoption/ronda-review-adoption.md. */
const DOC_PATH = /^[a-z][a-z/-]*[a-z]\.(?:md|json|ya?ml)$/;
const MAX_MESSAGE_LENGTH = 120;

/**
 * Positive recognition: the literal is prose whose every word comes from a
 * closed vocabulary of credential-meta and neutral function words (plus a
 * credential env-var name or a letters-only doc path), has no digits, no `=`,
 * and only spaces and light punctuation, and names a credential at least once.
 * Anything else (an unknown word such as a candidate value) is ambiguous.
 */
function literalIsCredentialNameOnlyMessage(literal: string): boolean {
  if (literal.length === 0 || literal.length > MAX_MESSAGE_LENGTH) return false;
  if (!/^[A-Za-z_/. ;:,!-]+$/.test(literal)) return false;
  let namesCredential = false;
  for (const raw of literal.split(/\s+/).filter((t) => t.length > 0)) {
    const token = raw.replace(/[.,;:!]+$/, "");
    if (token.length === 0) return false;
    if (CREDENTIAL_ENV_NAME.test(token)) {
      namesCredential = true;
      continue;
    }
    if (DOC_PATH.test(token)) continue;
    const word = token.toLowerCase();
    if (CREDENTIAL_VOCAB.has(word)) {
      namesCredential = true;
    } else if (!META_VOCAB.has(word)) {
      return false;
    }
  }
  return namesCredential;
}

/**
 * True when the cited source line is positively recognised as a harmless
 * message: one fixed string literal that is a credential-name-only message
 * (closed vocabulary, see above), passed as the sole argument of an error
 * constructor or log call. Every other expression is retained (fail closed).
 */
export function lineNamesCredentialWithoutValue(line: string): boolean {
  const split = splitStringLiterals(line);
  if (split === undefined || split.literals.length !== 1) return false;
  if (!HARMLESS_CODE.test(split.code)) return false;
  return literalIsCredentialNameOnlyMessage(split.literals[0] as string);
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
