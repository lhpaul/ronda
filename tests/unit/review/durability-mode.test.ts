import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewStageForBranch } from "../../../src/review/stage-resolution.js";
import {
  durabilityModeDocumentIsComplete,
  durabilityPathIsSensitive,
  resolveDurabilityMode,
} from "../../../src/review/durability-mode.js";

const MODE_TEXT = [
  "# Durability",
  "",
  "### Restart and recovery",
  "ok",
  "### Retry semantics",
  "ok",
  "### Timeout and watchdog",
  "ok",
  "### Duplicate delivery",
  "ok",
  "### Partial success",
  "ok",
  "### Persistence integrity",
  "ok",
].join("\n");

test("reviewStageForBranch maps workflow prefixes", () => {
  assert.equal(reviewStageForBranch("spec/54-foo"), "spec");
  assert.equal(reviewStageForBranch("implementation-plan/54-foo"), "plan");
  assert.equal(reviewStageForBranch("feature/54-foo"), "implementation");
  assert.equal(reviewStageForBranch("fix/57-bar"), "implementation");
  assert.equal(reviewStageForBranch("refactor/x"), "implementation");
  assert.equal(reviewStageForBranch("hotfix/x"), "implementation");
  assert.equal(reviewStageForBranch("specification/foo"), "default");
  assert.equal(reviewStageForBranch("develop"), "default");
});

test("durabilityPathIsSensitive matches documented surfaces", () => {
  assert.equal(durabilityPathIsSensitive("src/webhook/webhook-job.ts"), true);
  assert.equal(durabilityPathIsSensitive("webhook/handler.ts"), true);
  assert.equal(durabilityPathIsSensitive("apps/bot/webhook/handler.ts"), true);
  assert.equal(durabilityPathIsSensitive("vendor/foo/webhook-job.ts"), true);
  assert.equal(durabilityPathIsSensitive("docs/specs/foo/1_spec.md"), false);
  assert.equal(durabilityPathIsSensitive("src/webhook-job-backup.ts"), true);
  assert.equal(durabilityPathIsSensitive("README.md"), false);
  assert.equal(durabilityPathIsSensitive("src/github/review-publisher.ts"), true);
  assert.equal(durabilityPathIsSensitive("src/core/run-review-pass.ts"), true);
  assert.equal(durabilityPathIsSensitive("scripts/development-workflow/pr-review-loop.sh"), true);
  assert.equal(durabilityPathIsSensitive("src/foo/retry-helper.ts"), true);
  assert.equal(durabilityPathIsSensitive("src/RetryWorker.ts"), true);
  assert.equal(durabilityPathIsSensitive("scripts/JobQueue.sh"), true);
});

test("root-level webhook paths activate automatic match and keep duplicate_delivery in scope", () => {
  const mode = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["webhook/handler.ts"],
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(mode.state, "active");
  assert.equal(mode.activationReason, "automatic_match");
  assert.equal(
    mode.scenarioFamiliesNa.some((entry) => entry.family === "duplicate_delivery"),
    false,
  );
});

test("publisher paths keep duplicate_delivery in scope", () => {
  const mode = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["src/github/review-publisher.ts"],
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(mode.state, "active");
  assert.equal(
    mode.scenarioFamiliesNa.some((entry) => entry.family === "duplicate_delivery"),
    false,
  );
  assert.equal(mode.scenarioFamiliesInScope.includes("duplicate_delivery"), true);
});

test("resolveDurabilityMode follows decision matrix rows", () => {
  const inactiveSpec = resolveDurabilityMode({
    headBranch: "spec/54-x",
    changedPaths: ["src/webhook/a.ts"],
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(inactiveSpec.state, "inactive");
  assert.equal(inactiveSpec.inactiveReason, "non_implementation_stage");

  const auto = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["src/webhook/a.ts"],
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(auto.state, "active");
  assert.equal(auto.activationReason, "automatic_match");

  const inactiveDocs = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["docs/project/a.md"],
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(inactiveDocs.state, "inactive");
  assert.equal(inactiveDocs.inactiveReason, "automatic_rules_did_not_match");

  const forceOn = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["docs/project/a.md"],
    durabilityMode: "on",
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(forceOn.state, "active");
  assert.equal(forceOn.activationReason, "operator_override");

  const forceOff = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["src/webhook/a.ts"],
    durabilityMode: "off",
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(forceOff.state, "inactive");
  assert.equal(forceOff.inactiveReason, "operator_override");

  const unavailable = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["src/webhook/a.ts"],
    modeDocumentText: null,
  });
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.unavailableReason, "missing");

  const incomplete = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["src/webhook/a.ts"],
    modeDocumentText: "# Durability\n\n### Restart and recovery\nok\n",
  });
  assert.equal(incomplete.state, "unavailable");
  assert.equal(incomplete.unavailableReason, "incomplete");

  const proseOnlyDoc = [
    "# Durability",
    "",
    "Missing section: ### Restart and recovery",
    "Missing section: ### Retry semantics",
    "Missing section: ### Timeout and watchdog",
    "Missing section: ### Duplicate delivery",
    "Missing section: ### Partial success",
    "Missing section: ### Persistence integrity",
    "",
  ].join("\n");
  assert.equal(durabilityModeDocumentIsComplete(proseOnlyDoc), false);
  const proseOnlyHeadings = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["src/webhook/a.ts"],
    modeDocumentText: proseOnlyDoc,
  });
  assert.equal(proseOnlyHeadings.state, "unavailable");
  assert.equal(proseOnlyHeadings.unavailableReason, "incomplete");
  assert.equal(
    durabilityModeDocumentIsComplete(
      [
        "### Restart and recovery",
        "### Retry semantics",
        "### Timeout and watchdog",
        "### Duplicate delivery",
        "### Partial success",
        "### Persistence integrity",
      ].join("\n"),
    ),
    true,
  );

  const fencedOnlyDoc = [
    "# Durability",
    "",
    "```md",
    "### Restart and recovery",
    "### Retry semantics",
    "### Timeout and watchdog",
    "### Duplicate delivery",
    "### Partial success",
    "### Persistence integrity",
    "```",
    "",
  ].join("\n");
  assert.equal(durabilityModeDocumentIsComplete(fencedOnlyDoc), false);

  const defaultOn = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["docs/project/a.md"],
    durabilityModeDefault: true,
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(defaultOn.state, "active");
  assert.equal(defaultOn.activationReason, "operator_default");
  assert.deepEqual(
    defaultOn.scenarioFamiliesNa.map((entry) => entry.family),
    ["duplicate_delivery"],
  );

  const retryOnly = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["src/foo/retry-helper.ts"],
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(retryOnly.state, "active");
  assert.deepEqual(
    retryOnly.scenarioFamiliesNa.map((entry) => entry.family),
    ["duplicate_delivery"],
  );
});

test("empty changed-files list is inactive unless override", () => {
  const inactive = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: [],
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(inactive.state, "inactive");
});
