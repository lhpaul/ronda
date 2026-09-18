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

test("review prompt appends durability mode instructions when active", () => {
  const prompt = buildReviewPrompt({
    title: "Webhook change",
    body: "",
    changedFiles: [],
    maxPatchChars: 400_000,
    durabilityMode: {
      state: "active",
      activationReason: "automatic_match",
      unavailableReason: "",
      scenarioFamiliesInScope: ["restart_recovery", "duplicate_delivery"],
      scenarioFamiliesNa: [],
      modeText: "### Restart and recovery\nCheck crash paths.",
    },
  });

  assert.match(prompt.systemPrompt, /Durability and idempotency mode/);
  assert.match(prompt.systemPrompt, /automatic_match/);
  assert.match(prompt.systemPrompt, /restart_recovery/);
  assert.match(prompt.systemPrompt, /Check crash paths/);
});

test("review prompt omits durability instructions when inactive", () => {
  const prompt = buildReviewPrompt({
    title: "Docs only",
    body: "",
    changedFiles: [],
    maxPatchChars: 400_000,
    durabilityMode: {
      state: "inactive",
      activationReason: "",
      unavailableReason: "",
      inactiveReason: "automatic_rules_did_not_match",
      scenarioFamiliesInScope: [],
      scenarioFamiliesNa: [],
      modeText: "",
    },
  });

  assert.doesNotMatch(prompt.systemPrompt, /Durability and idempotency mode/);
});
