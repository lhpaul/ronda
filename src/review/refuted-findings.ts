import { parseDiffNewSideLines } from "./refuted-findings-diff.js";
import type { ChangedFile, Finding } from "../domain/review-pass.types.js";

/**
 * Deterministic post-filter for a finding a maintainer would only refute by
 * hand (#158). It does not change the prompt or the model: it runs on parsed
 * findings after the model call and fails open (an unreadable line or an
 * unrecognised shape keeps the finding).
 */

export type SuppressionReason = "names_credential_without_value";

export interface SuppressedFinding {
  finding: Finding;
  reason: SuppressionReason;
}

export interface FilterResult {
  kept: Finding[];
  suppressed: SuppressedFinding[];
}

const EXPOSURE_VERB =
  "(?:expos\\w*|leak\\w*|disclos\\w*|reveal\\w*|print\\w*|logs|logged|logging|includ\\w*|interpolat\\w*|echo\\w*)";
const CREDENTIAL_PATTERN =
  "(?:credentials?|api[ _-]?keys?|secrets?|tokens?|passwords?|passphrases?|\\w*_API_KEY)";
/** Exposure verb acting on a credential (`includes the model credential`) ... */
const VERB_THEN_CREDENTIAL = new RegExp(`\\b${EXPOSURE_VERB}\\b(?:\\W+\\w+){0,5}?\\W+${CREDENTIAL_PATTERN}\\b`, "i");
/** ... or a credential that is the subject of a passive exposure (`credential exposed`). */
const CREDENTIAL_THEN_VERB = new RegExp(`\\b${CREDENTIAL_PATTERN}\\b(?:\\W+\\w+){0,4}?\\W+${EXPOSURE_VERB}\\b`, "i");
const MESSAGE_WORDS = /\b(error|errors|exception|message|messages|output|log|logs|stack ?trace|response)\b/i;
/**
 * Conditions that make a finding ambiguous or about something other than
 * exposure: negations/disclaimers and HTTP status wording. Any hit keeps it.
 */
const KEEP_CONDITIONS =
  /\b(?:no|not|none|without|never|nor|cannot|[1-5]\d\d|status|returns?|returned|returning)\b|n't\b/i;

/**
 * True only when a finding positively asserts that a credential is exposed
 * through a message/log/output: an exposure verb tied to a credential word,
 * a message-like subject, and no negation or status wording (#158). Keyword
 * co-occurrence alone is not a claim; mixed or ambiguous findings are kept.
 */
export function isCredentialInMessageClaim(finding: Finding): boolean {
  const text = `${finding.title}\n${finding.body}`;
  if (KEEP_CONDITIONS.test(text)) return false;
  return (VERB_THEN_CREDENTIAL.test(text) || CREDENTIAL_THEN_VERB.test(text)) && MESSAGE_WORDS.test(text);
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

/** Words that may only NAME a credential; never allowed in a value position. */
const CREDENTIAL_NOUNS = new Set([
  "credential", "credentials", "secret", "secrets", "token", "tokens", "password", "passwords",
  "passphrase", "passphrases", "key", "keys", "api", "auth", "authentication", "authorization",
  "apikey",
]);
/** Credential nouns that may directly precede another one (`API key`, `auth token`). */
const CREDENTIAL_MODIFIERS = new Set(["api", "auth", "authentication", "authorization"]);
/** Closed status/predicate set: what a message may say about a credential. */
const STATUS_WORDS = new Set([
  "missing", "not", "no", "set", "unset", "required", "invalid", "expired", "configured", "empty",
  "failed", "failure", "rejected", "unavailable", "found", "provided", "supplied", "defined",
  "specified", "present", "valid", "absent",
]);
/** Neutral function words and message vocabulary. */
const NEUTRAL_WORDS = new Set([
  "model", "see", "please", "check", "your", "add", "use", "the", "a", "an", "for", "in", "to",
  "from", "of", "on", "or", "and", "with", "this", "that", "it", "has", "have", "been", "must",
  "cannot", "can", "need", "needed", "error", "access", "login", "bearer", "env", "environment",
  "variable", "config", "configuration", "value", "when", "if", "before", "after", "run",
]);
/** Copulas: everything after one is the predicate, so it must be status words only. */
const COPULAS = new Set(["is", "are", "was", "be"]);
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
  let afterCopula = false;
  let previousCredential: string | undefined;
  for (const raw of literal.split(/\s+/).filter((t) => t.length > 0)) {
    const token = raw.replace(/[.,;:!]+$/, "");
    if (token.length === 0) return false;
    const isEnvName = CREDENTIAL_ENV_NAME.test(token);
    const word = token.toLowerCase();
    if (isEnvName || CREDENTIAL_NOUNS.has(word)) {
      // A credential noun in the predicate (`is secret`) or directly after
      // another one (`password: secret`) could be the value itself.
      if (afterCopula) return false;
      if (previousCredential !== undefined && !CREDENTIAL_MODIFIERS.has(previousCredential)) return false;
      previousCredential = isEnvName ? token : word;
      namesCredential = true;
      // `password: <x>` and `password is <x>` alike: whatever follows is the
      // predicate and must be status words only, never an ordinary word that
      // could itself be the value.
      if (/:$/.test(raw)) afterCopula = true;
      continue;
    }
    previousCredential = undefined;
    if (DOC_PATH.test(token)) continue;
    if (COPULAS.has(word)) {
      afterCopula = true;
    } else if (afterCopula) {
      if (!STATUS_WORDS.has(word) && word !== "been" && word !== "a" && word !== "an" && word !== "the") return false;
      if (/[.;]$/.test(raw)) afterCopula = false; // clause boundary ends the predicate
    } else if (!STATUS_WORDS.has(word) && !NEUTRAL_WORDS.has(word)) {
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
