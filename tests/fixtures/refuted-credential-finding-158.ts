import type { ChangedFile, Finding } from "../../src/domain/review-pass.types.js";

/**
 * Offline reproduction of the #158 shape (the #156 thread set itself is not
 * committed): the fixed no-credential message, and the shifting-wording
 * variants Ronda re-posted for it on successive pushes — plus controls that
 * are real leaks and must never be suppressed.
 */
export const NO_CREDENTIAL_FILE: ChangedFile = {
  path: "src/cli/spec-plan-experiment.ts",
  status: "modified",
  additions: 3,
  deletions: 0,
  patch: [
    "@@ -40,0 +41,6 @@",
    "+  if (!config.model.apiKey) {",
    '+    throw new Error("No model credential is configured; see docs/adoption/ronda-review-adoption.md.");',
    "+  }",
    "+  if (!ok) {",
    "+    throw new Error(`Request failed with key ${config.model.apiKey}`);",
    "+  }",
  ].join("\n"),
};

const wording = [
  "Model credential exposed in error message",
  "Model credential exposed in error message.",
  "model credential exposed in the error message",
  "Credential exposed in error message",
];

/** False positives on the fixed-string line (line 42), at shifting wording. */
export const REFUTED_VARIANTS: Finding[] = wording.map((title, index) => ({
  path: NO_CREDENTIAL_FILE.path,
  line: 42,
  severity: "blocking",
  title,
  body: `Variant ${index}: the error message includes the model credential and may leak it into logs.`,
}));

/** Real leak on line 45 — interpolates the key. Must be kept. */
export const REAL_LEAK: Finding = {
  path: NO_CREDENTIAL_FILE.path,
  line: 45,
  severity: "blocking",
  title: "Model credential exposed in error message",
  body: "The error message includes the API key value and may leak it into logs.",
};

/** Trimmed code of the fixed-string line (line 42) the refuted claim was raised on. */
export const REFUTED_LINE_CODE =
  'throw new Error("No model credential is configured; see docs/adoption/ronda-review-adoption.md.");';

/** The diff hunk GitHub stores on a thread attached to line 42 (hunk ends at the commented line). */
export const REFUTED_THREAD_HUNK = [
  "@@ -40,0 +41,2 @@",
  "+  if (!config.model.apiKey) {",
  `+    ${REFUTED_LINE_CODE}`,
].join("\n");

/** One GraphQL reviewThreads node as RESOLVED_THREADS_QUERY returns it. */
export function threadNode(options: {
  resolved?: boolean;
  body?: string;
  author: { __typename: string; login: string } | null;
  reviewBody: string | null;
  diffHunk?: string | null;
  line?: number | null;
  originalLine?: number | null;
}) {
  return {
    isResolved: options.resolved ?? true,
    path: REAL_LEAK.path,
    line: options.line === undefined ? 42 : options.line,
    originalLine: options.originalLine === undefined ? 42 : options.originalLine,
    comments: {
      nodes: [
        {
          body: options.body ?? `**Blocking** — ${REAL_LEAK.title}\n\nx`,
          diffHunk: options.diffHunk === undefined ? REFUTED_THREAD_HUNK : options.diffHunk,
          author: options.author,
          pullRequestReview: options.reviewBody === null ? null : { body: options.reviewBody },
        },
      ],
    },
  };
}
