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

/**
 * The closed set of Ronda-owned fixed messages that name a credential and
 * point to configuration, with no value. A literal is suppressed only when it
 * equals one of these exactly (case-sensitive, after trimming); there are no
 * free slots, word lists, or patterns. Intentionally narrow: any other
 * literal, however harmless it looks, is kept.
 */
const NAMED_CREDENTIAL_TEMPLATES: ReadonlySet<string> = new Set([
  "No model credential is configured; see docs/adoption/ronda-review-adoption.md.",
  "No model credential is configured; see RONDA_MODEL_API_KEY.",
]);

/**
 * True when the cited source line is one fixed string literal that exactly
 * equals an enumerated Ronda template, passed as the sole argument of an
 * error constructor or log call. Every other expression is retained.
 */
export function lineNamesCredentialWithoutValue(line: string): boolean {
  const split = splitStringLiterals(line);
  if (split === undefined || split.literals.length !== 1) return false;
  if (!HARMLESS_CODE.test(split.code)) return false;
  return NAMED_CREDENTIAL_TEMPLATES.has((split.literals[0] as string).trim());
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
