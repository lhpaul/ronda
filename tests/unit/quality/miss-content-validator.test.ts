import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasDiffMarkers,
  hasExcessiveSourceExcerpt,
  normalizeQuotedIndentedText,
  validateCaptureFields,
  validateMissField,
} from "../../../src/quality/miss-content-validator.js";
import { findCredentialMatch } from "../../../src/quality/miss-sensitive-content-lists.js";

test("AC18 placeholder literals are accepted as whole values", () => {
  assert.equal(findCredentialMatch("REDACTED"), null);
  assert.equal(findCredentialMatch("  example  "), null);
  assert.equal(findCredentialMatch("changeme"), null);
  assert.equal(findCredentialMatch("password = \"REDACTED\""), null);
});

test("AC9 planted proof: code_hosting_access_token refuses gh tokens", () => {
  assert.equal(
    findCredentialMatch("token ghp_abcdefghijklmnopqrstuvwxyz0123456789")?.form,
    "code_hosting_access_token",
  );
});

test("AC9 planted proof: api_key refuses sk-proj and prefixed assignments", () => {
  assert.equal(
    findCredentialMatch("key sk-abcdefghijklmnopqrstuvwxyz0123")?.form,
    "api_key",
  );
  assert.equal(
    findCredentialMatch(
      "OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789",
    )?.form,
    "api_key",
  );
});

test("AC9 planted proof: private_key_block refuses PEM blocks", () => {
  assert.equal(
    findCredentialMatch(
      "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----",
    )?.form,
    "private_key_block",
  );
});

test("AC9 planted proof: cloud_access_key_identifier refuses AKIA/ASIA ids", () => {
  assert.equal(
    findCredentialMatch("AKIAIOSFODNN7EXAMPLE")?.form,
    "cloud_access_key_identifier",
  );
});

test("AC9 planted proof: authorization_bearer refuses real bearer values", () => {
  assert.equal(
    findCredentialMatch("Authorization: Bearer abcdef0123456789")?.form,
    "authorization_bearer",
  );
  assert.equal(findCredentialMatch("Authorization: Bearer REDACTED"), null);
  assert.equal(
    findCredentialMatch(
      "Authorization: Bearer REDACTED Authorization: Bearer abcdef0123456789",
    )?.form,
    "authorization_bearer",
  );
});

test("AC9 planted proof: secret_assignment refuses non-placeholder assignments", () => {
  assert.equal(
    findCredentialMatch('password = "s3cret-value"')?.form,
    "secret_assignment",
  );
  assert.equal(
    findCredentialMatch("password=supersecret")?.form,
    "secret_assignment",
  );
  assert.equal(
    findCredentialMatch("secret=bare-literal-value")?.form,
    "secret_assignment",
  );
  assert.equal(findCredentialMatch("password=REDACTED"), null);
  assert.equal(findCredentialMatch("password=REDACTED;"), null);
  assert.equal(findCredentialMatch("password=changeme,"), null);
  assert.equal(findCredentialMatch("token=example)"), null);
  assert.equal(
    findCredentialMatch("password=REDACTED password=supersecret")?.form,
    "secret_assignment",
  );
  assert.equal(findCredentialMatch("GITHUB_TOKEN=supersecret")?.form, "secret_assignment");
  assert.equal(findCredentialMatch("CLIENT_SECRET=not-a-placeholder")?.form, "secret_assignment");
  assert.equal(findCredentialMatch("DB_PASSWORD=not-a-placeholder")?.form, "secret_assignment");
});

test("quote and indent normalization strips block quotes and shared indent", () => {
  assert.equal(
    normalizeQuotedIndentedText("> diff --git a/x b/x"),
    "diff --git a/x b/x",
  );
  assert.equal(
    normalizeQuotedIndentedText("    @@ -1,2 +1,2 @@\n    line"),
    "@@ -1,2 +1,2 @@\nline",
  );
  assert.equal(
    normalizeQuotedIndentedText("\t--- a/x\n\t+++ b/x"),
    "--- a/x\n+++ b/x",
  );
});

test("AC38 / AC49 diff markers refuse after normalization", () => {
  assert.equal(hasDiffMarkers("diff --git a/foo b/foo"), true);
  assert.equal(hasDiffMarkers("@@ -1,3 +1,4 @@"), true);
  assert.equal(hasDiffMarkers("--- a/foo\n+++ b/foo"), true);
  assert.equal(hasDiffMarkers("> diff --git a/foo b/foo"), false);
  assert.equal(
    hasDiffMarkers(normalizeQuotedIndentedText("> diff --git a/foo b/foo")),
    true,
  );
  assert.equal(
    validateMissField({
      field: "text",
      value: "> @@ -1,2 +1,2 @@",
      scanSourceExcerpts: false,
    })?.kind,
    "diff_marker",
  );
  assert.equal(
    validateMissField({
      field: "text",
      value: "    --- a/x\n    +++ b/x",
      scanSourceExcerpts: false,
    })?.kind,
    "diff_marker",
  );
});

test("blank lines break consecutive source-excerpt runs", () => {
  const lines = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
  const corpus = {
    changedFileContents: [lines.join("\n")],
    diffText: "",
  };
  const separated = [
    lines.slice(0, 3).join("\n"),
    "",
    lines.slice(3).join("\n"),
  ].join("\n");
  assert.equal(hasExcessiveSourceExcerpt(separated, corpus), false);
});

test("blank lines in corpus break consecutive source matching (AC50)", () => {
  const lines = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
  // Same six lines exist in the file but are not consecutive (blank between).
  const corpus = {
    changedFileContents: [
      [...lines.slice(0, 3), "", ...lines.slice(3)].join("\n"),
    ],
    diffText: "",
  };
  assert.equal(
    hasExcessiveSourceExcerpt(lines.join("\n"), corpus),
    false,
    "non-adjacent corpus lines must not count as consecutive",
  );
  // Adjacent six-line block in corpus still refuses.
  const contiguousCorpus = {
    changedFileContents: [lines.join("\n")],
    diffText: "",
  };
  assert.equal(
    hasExcessiveSourceExcerpt(lines.join("\n"), contiguousCorpus),
    true,
  );
});

test("AC38 / AC50 six consecutive source lines refuse; five do not", () => {
  const lines = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot"];
  const corpus = {
    changedFileContents: [lines.join("\n")],
    diffText: "",
  };
  assert.equal(
    hasExcessiveSourceExcerpt(lines.join("\n"), corpus),
    true,
  );
  assert.equal(
    hasExcessiveSourceExcerpt(lines.slice(0, 5).join("\n"), corpus),
    false,
  );
  assert.equal(
    validateMissField({
      field: "text",
      value: lines.map((line) => `> ${line}`).join("\n"),
      corpus,
    })?.kind,
    "source_excerpt",
  );
  assert.equal(
    validateMissField({
      field: "text",
      value: lines.map((line) => `    ${line}`).join("\n"),
      corpus,
    })?.kind,
    "source_excerpt",
  );
});

test("validator planted-violation fail-then-pass isolates credential, diff, source", () => {
  const sourceLines = [
    "alpha-line-one",
    "bravo-line-two",
    "charlie-line-three",
    "delta-line-four",
    "echo-line-five",
    "foxtrot-line-six",
  ];
  const corpus = {
    changedFileContents: [sourceLines.join("\n")],
    diffText: sourceLines.map((line) => `+${line}`).join("\n"),
  };
  const baseFields = {
    externalReviewer: "codex",
    location: "src/x.ts:1",
    title: "Safe title",
  };

  // Credential: plant fails, clean passes.
  assert.equal(
    validateCaptureFields({
      fields: { ...baseFields, text: 'password = "s3cret-value"' },
      corpus,
    })?.kind,
    "credential",
  );
  assert.equal(
    validateCaptureFields({
      fields: { ...baseFields, text: "Missing retry on webhook delivery." },
      corpus,
    }),
    null,
  );

  // Diff marker: plant fails, clean passes.
  assert.equal(
    validateCaptureFields({
      fields: {
        ...baseFields,
        text: "See hunk\n@@ -1,3 +1,4 @@\ncontext",
      },
      corpus,
    })?.kind,
    "diff_marker",
  );
  assert.equal(
    validateCaptureFields({
      fields: { ...baseFields, text: "Missing retry on webhook delivery." },
      corpus,
    }),
    null,
  );

  // Source excerpt: six lines fail, five pass.
  assert.equal(
    validateCaptureFields({
      fields: { ...baseFields, text: sourceLines.join("\n") },
      corpus,
    })?.kind,
    "source_excerpt",
  );
  assert.equal(
    validateCaptureFields({
      fields: { ...baseFields, text: sourceLines.slice(0, 5).join("\n") },
      corpus,
    }),
    null,
  );
});

test("lookalike prose without markers is not refused", () => {
  assert.equal(
    hasDiffMarkers("See the diff for git changes around line 12"),
    false,
  );
  assert.equal(
    validateMissField({
      field: "text",
      value: "Mention of +++ without a preceding --- line",
      scanSourceExcerpts: false,
    }),
    null,
  );
});
