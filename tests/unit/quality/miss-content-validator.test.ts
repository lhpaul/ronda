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

test("AC9 credential forms refuse non-placeholder values", () => {
  assert.equal(
    findCredentialMatch("token ghp_abcdefghijklmnopqrstuvwxyz0123456789")?.form,
    "code_hosting_access_token",
  );
  assert.equal(
    findCredentialMatch("key sk-abcdefghijklmnopqrstuvwxyz0123")?.form,
    "api_key",
  );
  assert.equal(
    findCredentialMatch(
      "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----",
    )?.form,
    "private_key_block",
  );
  assert.equal(
    findCredentialMatch("AKIAIOSFODNN7EXAMPLE")?.form,
    "cloud_access_key_identifier",
  );
  assert.equal(
    findCredentialMatch("Authorization: Bearer abcdef0123456789")?.form,
    "authorization_bearer",
  );
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

test("planted-violation proof: credential refuses then clean write path passes scan", () => {
  const planted = validateCaptureFields({
    fields: {
      externalReviewer: "codex",
      location: "src/x.ts:1",
      title: "Leak",
      text: 'password = "s3cret-value"',
    },
    scanSourceExcerpts: false,
  });
  assert.equal(planted?.kind, "credential");

  const clean = validateCaptureFields({
    fields: {
      externalReviewer: "codex",
      location: "src/x.ts:1",
      title: "Safe finding",
      text: "Missing retry on webhook delivery.",
    },
    corpus: { changedFileContents: [], diffText: "" },
  });
  assert.equal(clean, null);
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
