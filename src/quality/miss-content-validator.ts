import {
  findCredentialMatch,
  type CredentialRefusalForm,
} from "./miss-sensitive-content-lists.js";

export type ScannedMissField =
  | "externalReviewer"
  | "reviewedHeadSha"
  | "location"
  | "title"
  | "text"
  | "rationale";

export type ContentRefusalReason =
  | {
      kind: "credential";
      field: ScannedMissField;
      form: CredentialRefusalForm;
    }
  | {
      kind: "diff_marker";
      field: ScannedMissField;
    }
  | {
      kind: "source_excerpt";
      field: ScannedMissField;
    };

export interface SourceScanCorpus {
  /** Changed-file contents at the reviewed head (full file text). */
  changedFileContents: string[];
  /** Unified diff text for the reviewed head vs capture-time merge-base. */
  diffText: string;
}

/**
 * Strip a leading Markdown block-quote marker (`>` plus optional space) from
 * every line, then strip one shared indented-code-block indent (one tab or
 * four spaces) when every nonblank line shares it. No further Markdown
 * transforms.
 */
export function normalizeQuotedIndentedText(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => {
    if (line.startsWith("> ")) {
      return line.slice(2);
    }
    if (line.startsWith(">")) {
      return line.slice(1);
    }
    return line;
  });

  const nonblank = lines.filter((line) => line.trim().length > 0);
  if (nonblank.length === 0) {
    return lines.join("\n");
  }

  const allHaveFourSpaces = nonblank.every((line) => line.startsWith("    "));
  const allHaveTab = nonblank.every((line) => line.startsWith("\t"));

  if (allHaveFourSpaces) {
    return lines
      .map((line) => (line.startsWith("    ") ? line.slice(4) : line))
      .join("\n");
  }
  if (allHaveTab) {
    return lines
      .map((line) => (line.startsWith("\t") ? line.slice(1) : line))
      .join("\n");
  }

  return lines.join("\n");
}

/** Detect diff headers/hunk markers on already-normalized text (AC38, AC49). */
export function hasDiffMarkers(normalizedText: string): boolean {
  const lines = normalizedText.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmedStart = line.replace(/^\s+/, "");
    if (trimmedStart.startsWith("diff --git")) {
      return true;
    }
    if (trimmedStart.startsWith("@@")) {
      return true;
    }
    if (trimmedStart.startsWith("--- ")) {
      const next = (lines[index + 1] ?? "").replace(/^\s+/, "");
      if (next.startsWith("+++ ")) {
        return true;
      }
    }
  }
  return false;
}

function normalizeComparableLine(line: string, forDiff: boolean): string {
  let value = line.replace(/^\s+|\s+$/g, "");
  if (forDiff && /^[+\- ]/.test(value)) {
    value = value.slice(1).replace(/^\s+|\s+$/g, "");
  }
  return value;
}

function collectCorpusLineSequences(corpus: SourceScanCorpus): string[][] {
  const sequences: string[][] = [];

  for (const content of corpus.changedFileContents) {
    const lines = content
      .split(/\r?\n/)
      .map((line) => normalizeComparableLine(line, false))
      .filter((line) => line.length > 0);
    if (lines.length > 0) {
      sequences.push(lines);
    }
  }

  const diffLines = corpus.diffText
    .split(/\r?\n/)
    .map((line) => normalizeComparableLine(line, true))
    .filter((line) => line.length > 0);
  if (diffLines.length > 0) {
    sequences.push(diffLines);
  }

  return sequences;
}

function sequenceContainsRun(
  haystack: string[],
  needle: string[],
): boolean {
  if (needle.length === 0 || needle.length > haystack.length) {
    return false;
  }
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }
  return false;
}

/**
 * True when normalized text contains more than five consecutive nonblank
 * lines that appear consecutively in changed-file or diff content (AC38, AC50).
 */
function nonblankLineRuns(lines: string[]): string[][] {
  const runs: string[][] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (line.length === 0) {
      if (current.length > 0) {
        runs.push(current);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    runs.push(current);
  }
  return runs;
}

export function hasExcessiveSourceExcerpt(
  normalizedText: string,
  corpus: SourceScanCorpus,
): boolean {
  const fieldLines = normalizedText
    .split(/\r?\n/)
    .map((line) => normalizeComparableLine(line, false));

  const corpusSequences = collectCorpusLineSequences(corpus);
  if (corpusSequences.length === 0) {
    return false;
  }

  for (const run of nonblankLineRuns(fieldLines)) {
    if (run.length <= 5) {
      continue;
    }
    for (let start = 0; start <= run.length - 6; start += 1) {
      const slice = run.slice(start, start + 6);
      for (const sequence of corpusSequences) {
        if (sequenceContainsRun(sequence, slice)) {
          return true;
        }
      }
    }
  }

  return false;
}

export interface ValidateMissFieldInput {
  field: ScannedMissField;
  value: string;
  /** Required for source/diff scan; omit only when scanning credentials alone. */
  corpus?: SourceScanCorpus;
  /** When false, skip consecutive-line source scan (Phase-1 marker-only). */
  scanSourceExcerpts?: boolean;
}

/**
 * Scan one free-text field before derivation/truncation/persistence.
 * Precedence within a field: credential, then diff marker, then source excerpt.
 */
export function validateMissField(
  input: ValidateMissFieldInput,
): ContentRefusalReason | null {
  const credential = findCredentialMatch(input.value);
  if (credential) {
    return {
      kind: "credential",
      field: input.field,
      form: credential.form,
    };
  }

  const normalized = normalizeQuotedIndentedText(input.value);
  if (hasDiffMarkers(normalized)) {
    return { kind: "diff_marker", field: input.field };
  }

  if (
    input.scanSourceExcerpts !== false &&
    input.corpus &&
    hasExcessiveSourceExcerpt(normalized, input.corpus)
  ) {
    return { kind: "source_excerpt", field: input.field };
  }

  return null;
}

/** Field scan order for capture (refusal precedence within Stage 3 content). */
export const CAPTURE_SCAN_FIELD_ORDER: ScannedMissField[] = [
  "externalReviewer",
  "reviewedHeadSha",
  "location",
  "title",
  "text",
];

export function validateCaptureFields(input: {
  fields: Partial<Record<ScannedMissField, string>>;
  corpus?: SourceScanCorpus;
  scanSourceExcerpts?: boolean;
}): ContentRefusalReason | null {
  for (const field of CAPTURE_SCAN_FIELD_ORDER) {
    const value = input.fields[field];
    if (value === undefined) {
      continue;
    }
    const refusal = validateMissField({
      field,
      value,
      corpus: input.corpus,
      scanSourceExcerpts: input.scanSourceExcerpts,
    });
    if (refusal) {
      return refusal;
    }
  }
  return null;
}

export function formatContentRefusal(reason: ContentRefusalReason): string {
  if (reason.kind === "credential") {
    return `Capture refused: field '${reason.field}' matched credential form '${reason.form}'.`;
  }
  if (reason.kind === "diff_marker") {
    return `Capture refused: field '${reason.field}' carried diff header or hunk markers.`;
  }
  return `Capture refused: field '${reason.field}' carried more than five consecutive matching source or diff lines.`;
}
