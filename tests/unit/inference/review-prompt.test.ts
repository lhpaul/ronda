import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ChangesTooLargeError,
  buildReviewPrompt,
} from "../../../src/inference/review-prompt.js";

test("review prompt asks for independently actionable findings and sensitive-value blocking findings", () => {
  const prompt = buildReviewPrompt({
    title: "Improve code",
    body: "",
    changedFiles: [
      {
        path: "src/example.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "@@ -1 +1 @@\n+const token = 'secret';",
      },
    ],
    maxPatchChars: 400_000,
  });

  assert.match(prompt.systemPrompt, /independently actionable defect/i);
  assert.match(prompt.systemPrompt, /same file, hunk, or nearby region/i);
  assert.match(prompt.systemPrompt, /sensitive/i);
  assert.match(prompt.systemPrompt, /without repeating the sensitive value/i);
  assert.match(prompt.systemPrompt, /REDACTED/i);
  assert.match(prompt.systemPrompt, /sorts incorrectly and computes the even-length median incorrectly/i);
  assert.match(prompt.systemPrompt, /Blocking/i);
});

test("review prompt renders binding and advisory doc sections with labels", () => {
  const prompt = buildReviewPrompt({
    title: "Webhook change",
    body: "",
    changedFiles: [],
    maxPatchChars: 400_000,
    authoritativeDocs: [
      { id: "constitution", path: "docs/constitution.md", role: "binding", text: "Comment-only." },
      {
        id: "architecture",
        path: "docs/project/3-software-architecture.md",
        role: "advisory",
        text: "Use injected deps in tests.",
      },
    ],
    maxAuthoritativeDocCount: 4,
    maxAuthoritativeDocChars: 120_000,
  });

  assert.match(prompt.userPrompt, /Authoritative repository documentation \(binding\)/);
  assert.match(prompt.userPrompt, /### \[binding\] docs\/constitution\.md/);
  assert.match(prompt.userPrompt, /Authoritative repository documentation \(advisory\)/);
  assert.match(prompt.userPrompt, /### \[advisory\] docs\/project\/3-software-architecture\.md/);
});

test("review prompt omits doc headers when no authoritative docs are provided", () => {
  const prompt = buildReviewPrompt({
    title: "Small change",
    body: "",
    changedFiles: [
      {
        path: "src/example.ts",
        status: "modified",
        additions: 1,
        deletions: 0,
        patch: "+const x = 1;",
      },
    ],
    maxPatchChars: 400_000,
  });

  assert.doesNotMatch(prompt.userPrompt, /Authoritative repository documentation/);
});

test("review prompt still fails instead of truncating over-budget patch text", () => {
  assert.throws(
    () =>
      buildReviewPrompt({
        title: "Too large",
        body: "",
        changedFiles: [
          {
            path: "src/example.ts",
            status: "modified",
            additions: 1,
            deletions: 0,
            patch: "x".repeat(20),
          },
        ],
        maxPatchChars: 5,
      }),
    ChangesTooLargeError,
  );
});
