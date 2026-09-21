import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewStageForBranch } from "../../../src/review/stage-resolution.js";
import {
  durabilityPathIsSensitive,
  resolveDurabilityMode,
} from "../../../src/review/durability-mode.js";

const MODE_TEXT = "# Durability\n\n### Restart and recovery\nok\n";

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

test("resolveDurabilityMode follows decision matrix rows", () => {
  const inactiveSpec = resolveDurabilityMode({
    headBranch: "spec/54-x",
    changedPaths: ["src/webhook/a.ts"],
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(inactiveSpec.state, "inactive");

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

  const defaultOn = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["docs/project/a.md"],
    durabilityModeDefault: true,
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(defaultOn.state, "active");
  assert.equal(defaultOn.activationReason, "operator_default");

  const publisher = resolveDurabilityMode({
    headBranch: "feature/54-x",
    changedPaths: ["src/github/review-publisher.ts"],
    modeDocumentText: MODE_TEXT,
  });
  assert.equal(publisher.state, "active");
  assert.deepEqual(
    publisher.scenarioFamiliesNa.map((entry) => entry.family),
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
