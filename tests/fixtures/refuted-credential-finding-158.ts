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
