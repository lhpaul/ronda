import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Octokit } from "@octokit/rest";
import {
  APPROVED_SPEC_PATH,
  APPROVED_SPEC_REF,
  buildArmPrompt,
  type BuildArmPromptInput,
  buildSpecPlanSystemPrompt,
  extractChecklist,
  isDatedModelId,
  parseExperimentArgs,
  parseHeadsManifest,
  resolveRepoPath,
  runExperiment,
  SpecPlanExperimentUsageError,
  synthesizeAddedPatch,
  type ExperimentOptions,
} from "../../../src/cli/spec-plan-experiment.js";
import { buildReviewPrompt } from "../../../src/inference/review-prompt.js";
import { parseModelResponse } from "../../../src/inference/parse-model-response.js";
import type { ModelClient } from "../../../src/inference/model-client.js";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const REVIEW_MD = readFileSync(join(REPO_ROOT, "REVIEW.md"), "utf8");
const HEADS_MD = readFileSync(join(REPO_ROOT, "docs/testing/ronda/spec-plan-experiment-heads-143.md"), "utf8");
const OUT = "docs/testing/ronda/.spec-plan-experiment-test.jsonl";

// --- the committed manifest --------------------------------------------------

test("the committed manifest names 5 spec heads on #115 and 3 plan heads on #117", () => {
  const heads = parseHeadsManifest(HEADS_MD);
  assert.equal(heads.length, 8);
  assert.deepEqual(
    heads.filter((head) => head.pullNumber === 115).map((head) => head.stage),
    ["spec", "spec", "spec", "spec", "spec"],
  );
  assert.deepEqual(
    heads.filter((head) => head.pullNumber === 117).map((head) => head.stage),
    ["plan", "plan", "plan"],
  );
  assert.equal(new Set(heads.map((head) => head.headSha)).size, 8);
  assert.equal(heads.reduce((sum, head) => sum + head.recordedMisses, 0), 29);
});

// --- argv --------------------------------------------------------------------

test("parseExperimentArgs requires an explicit arm and has no default", () => {
  assert.throws(() => parseExperimentArgs([]), SpecPlanExperimentUsageError);
  assert.throws(() => parseExperimentArgs(["--arm", "D"]), SpecPlanExperimentUsageError);
  assert.equal(parseExperimentArgs(["--arm", "A"]).arm, "A");
});

test("parseExperimentArgs defaults to 3 runs and the synthesize patch source", () => {
  const options = parseExperimentArgs(["--arm", "B"]);
  assert.equal(options.runs, 3);
  assert.equal(options.patchSource, "synthesize");
  assert.equal(options.dryRun, false);
});

test("parseExperimentArgs pins arm C's model and refuses --model elsewhere", () => {
  assert.throws(() => parseExperimentArgs(["--arm", "C"]), SpecPlanExperimentUsageError);
  assert.equal(parseExperimentArgs(["--arm", "C", "--model", "some-model-2026-01-01"]).modelName, "some-model-2026-01-01");
  assert.equal(parseExperimentArgs(["--arm", "C", "--model", "some-model-20260101"]).modelName, "some-model-20260101");
  assert.throws(() => parseExperimentArgs(["--arm", "A", "--model", "x"]), SpecPlanExperimentUsageError);
  assert.throws(() => parseExperimentArgs(["--arm", "B", "--model", "x"]), SpecPlanExperimentUsageError);
  // A dry run sends nothing, so arm C needs no model to build prompts.
  assert.equal(parseExperimentArgs(["--arm", "C", "--dry-run"]).dryRun, true);
});

test("arm C refuses a mutable model alias", () => {
  for (const alias of ["qwen-plus", "latest", "some-model-2026", "some-model-v2", "some-model-2026-01"]) {
    assert.throws(() => parseExperimentArgs(["--arm", "C", "--model", alias]), SpecPlanExperimentUsageError, alias);
  }
  assert.equal(isDatedModelId("qwen-plus-2025-12-01"), true);
  assert.equal(isDatedModelId("claude-haiku-4-5-20251001"), true);
  assert.equal(isDatedModelId("qwen-plus"), false);
});

test("an option is never allowed to swallow another option as its value, and unknown options are refused", () => {
  assert.throws(() => parseExperimentArgs(["--arm", "A", "--out", "--dry-run"]), SpecPlanExperimentUsageError);
  assert.throws(() => parseExperimentArgs(["--arm", "--dry-run"]), SpecPlanExperimentUsageError);
  assert.throws(() => parseExperimentArgs(["--arm", "A", "--runs"]), SpecPlanExperimentUsageError);
  assert.throws(() => parseExperimentArgs(["--arm", "A", "--bogus"]), SpecPlanExperimentUsageError);
  assert.throws(() => parseExperimentArgs(["--arm", "A", "stray"]), SpecPlanExperimentUsageError);
  assert.equal(parseExperimentArgs(["--arm", "A", "--dry-run", "--out", "docs/x.jsonl"]).dryRun, true);
});

test("parseExperimentArgs rejects a bad run count, patch source and repo", () => {
  assert.throws(() => parseExperimentArgs(["--arm", "A", "--runs", "0"]), SpecPlanExperimentUsageError);
  assert.throws(() => parseExperimentArgs(["--arm", "A", "--patch-source", "x"]), SpecPlanExperimentUsageError);
  assert.throws(() => parseExperimentArgs(["--arm", "A", "--repo", "nope"]), SpecPlanExperimentUsageError);
});

test("resolveRepoPath refuses a path outside the repository root", () => {
  assert.throws(() => resolveRepoPath("../elsewhere.jsonl"), SpecPlanExperimentUsageError);
  assert.throws(() => resolveRepoPath("/etc/passwd"), SpecPlanExperimentUsageError);
  assert.ok(resolveRepoPath("docs/testing/ronda/x.jsonl").endsWith("docs/testing/ronda/x.jsonl"));
});

// --- the checklists ----------------------------------------------------------

test("extractChecklist returns exactly the spec and plan sections of REVIEW.md", () => {
  const spec = extractChecklist(REVIEW_MD, "spec");
  const plan = extractChecklist(REVIEW_MD, "plan");
  assert.match(spec, /^## Spec Review Checklist/);
  assert.match(plan, /^## Plan Review Checklist/);
  assert.ok(!spec.includes("## Plan Review Checklist"));
  assert.ok(!plan.includes("## Code Review Checklist"));
  assert.ok(spec.length > 200 && plan.length > 200);
});

test("extractChecklist fails loudly when a section is missing", () => {
  assert.throws(() => extractChecklist("# nothing here\n", "spec"), SpecPlanExperimentUsageError);
});

// --- the prompts -------------------------------------------------------------

const FILE = {
  path: "docs/specs/x.md",
  status: "added",
  patch: "@@ -0,0 +1,2 @@\n+# Spec\n+text",
  additions: 2,
  deletions: 0,
};

function promptInput(arm: "A" | "B" | "C", stage: "spec" | "plan"): BuildArmPromptInput {
  return {
    arm,
    stage,
    title: "spec(#1): thing",
    body: "body",
    changedFiles: [FILE],
    maxPatchChars: 400_000,
    authoritativeDocs: [],
    checklist: extractChecklist(REVIEW_MD, stage),
    approvedSpec: { path: "docs/specs/approved.md", text: "APPROVED SPEC TEXT" },
  };
}

test("arm A is buildReviewPrompt exactly as production calls it, and never carries the spec or checklist", () => {
  const armA = buildArmPrompt(promptInput("A", "plan"));
  const production = buildReviewPrompt({
    title: "spec(#1): thing",
    body: "body",
    changedFiles: [FILE],
    maxPatchChars: 400_000,
    authoritativeDocs: [],
  });
  assert.deepEqual(armA, production);
  assert.ok(!armA.userPrompt.includes("APPROVED SPEC TEXT"));
  assert.ok(!armA.systemPrompt.includes("Review checklist"));
});

test("arms B and C share one prompt and carry the stage's checklist", () => {
  const b = buildArmPrompt(promptInput("B", "spec"));
  const c = buildArmPrompt(promptInput("C", "spec"));
  assert.deepEqual(b, c);
  assert.ok(b.systemPrompt.includes("## Spec Review Checklist"));
  assert.ok(!b.systemPrompt.includes("## Plan Review Checklist"));
  const plan = buildArmPrompt(promptInput("B", "plan"));
  assert.ok(plan.systemPrompt.includes("## Plan Review Checklist"));
});

test("a plan head gets the approved spec under arms B and C, and a spec head never does", () => {
  assert.ok(buildArmPrompt(promptInput("B", "plan")).userPrompt.includes("APPROVED SPEC TEXT"));
  assert.ok(buildArmPrompt(promptInput("C", "plan")).userPrompt.includes("APPROVED SPEC TEXT"));
  assert.ok(!buildArmPrompt(promptInput("B", "spec")).userPrompt.includes("APPROVED SPEC TEXT"));
});

test("the spec/plan prompt keeps the production JSON contract: a model following it parses", () => {
  const system = buildSpecPlanSystemPrompt("spec", "## Spec Review Checklist\n- item");
  assert.match(system, /"findings":\[\{"path":"relative\/file\/path","line":42,"severity":"blocking"\|"important"\|"nit"/);
  const parsed = parseModelResponse(
    JSON.stringify({ findings: [{ path: FILE.path, line: 1, severity: "important", title: "t", body: "b" }] }),
    [FILE],
  );
  assert.equal(parsed.findings.length, 1);
});

test("synthesizeAddedPatch renders a whole-file addition", () => {
  assert.equal(synthesizeAddedPatch("a\nb\n"), "@@ -0,0 +1,2 @@\n+a\n+b");
  assert.equal(synthesizeAddedPatch("only"), "@@ -0,0 +1,1 @@\n+only");
});

// --- the run -----------------------------------------------------------------

interface FakeCalls {
  writes: number;
  contentRefs: string[];
}

/** Heads are the 8 committed ones; #115 branches are spec/, #117 are implementation-plan/. */
function fakeOctokit(calls: FakeCalls, opts: { patchFor?: (path: string) => string | undefined } = {}): Octokit {
  const patchFor = opts.patchFor ?? (() => "@@ -0,0 +1,1 @@\n+# doc");
  return {
    pulls: {
      get: async ({ pull_number }: { pull_number: number }) => ({
        data: {
          title: `PR ${pull_number}`,
          body: "body",
          head: { ref: pull_number === 115 ? "spec/105-x" : "implementation-plan/105-x" },
          base: { sha: "b".repeat(40) },
        },
      }),
    },
    repos: {
      compareCommitsWithBasehead: async () => ({
        data: {
          files: [
            {
              filename: "docs/specs/developments/x/1_x_specs.md",
              status: "added",
              patch: patchFor("docs/specs/developments/x/1_x_specs.md"),
              additions: 1,
              deletions: 0,
            },
          ],
        },
      }),
      getContent: async ({ ref, path }: { ref: string; path: string }) => {
        calls.contentRefs.push(`${path}@${ref}`);
        const text = path === APPROVED_SPEC_PATH ? "APPROVED SPEC TEXT" : "# full document\nline two\n";
        return { data: { type: "file", size: text.length, content: Buffer.from(text).toString("base64") } };
      },
    },
  } as unknown as Octokit;
}

function options(overrides: Partial<ExperimentOptions> = {}): ExperimentOptions {
  return {
    arm: "A",
    runs: 2,
    repo: "lhpaul/ronda",
    headsPath: "docs/testing/ronda/spec-plan-experiment-heads-143.md",
    outPath: OUT,
    dryRun: false,
    patchSource: "synthesize",
    ...overrides,
  };
}

const config = { modelName: "configured-model", apiKey: "k", baseUrl: "https://example.test/v1" };

function model(content: string, seen: string[] = []): ModelClient {
  return {
    modelName: "m",
    async complete(request) {
      seen.push(request.userPrompt);
      return { content, reportedModel: "reported-model" };
    },
  };
}

function cleanup(): void {
  const out = join(REPO_ROOT, OUT);
  if (existsSync(out)) rmSync(out);
}

test("a dry run writes one record per head per run with no model request and no GitHub write", async () => {
  cleanup();
  const calls: FakeCalls = { writes: 0, contentRefs: [] };
  const { code, records } = await runExperiment(
    options({ dryRun: true, runs: 3 }),
    { octokit: fakeOctokit(calls), getWriteAttempts: () => calls.writes, reviewMarkdown: REVIEW_MD },
    config,
  );
  assert.equal(code, 0);
  assert.equal(records.length, 8 * 3);
  assert.ok(records.every((record) => record.outcome === "dry_run" && record.dryRun && record.promptChars > 0));
  assert.equal(readFileSync(join(REPO_ROOT, OUT), "utf8").trim().split("\n").length, 24);
  cleanup();
});

test("a model run records parsed findings, the reported model and the temperature", async () => {
  cleanup();
  const calls: FakeCalls = { writes: 0, contentRefs: [] };
  const reply = JSON.stringify({
    findings: [{ path: "docs/specs/developments/x/1_x_specs.md", line: 1, severity: "important", title: "t", body: "b" }],
  });
  const { records } = await runExperiment(
    options({ onlyHead: "a691d010", runs: 2 }),
    { octokit: fakeOctokit(calls), getWriteAttempts: () => 0, modelOverride: model(reply), reviewMarkdown: REVIEW_MD },
    config,
  );
  assert.equal(records.length, 2);
  for (const record of records) {
    assert.equal(record.outcome, "findings");
    assert.equal(record.findingCount, 1);
    assert.equal(record.modelRequested, "configured-model");
    assert.equal(record.modelReported, "reported-model");
    assert.equal(record.temperature, 0);
    assert.equal(record.stage, "spec");
    assert.match(record.checklistSha256, /^[0-9a-f]{64}$/);
  }
  cleanup();
});

test("arm C builds its model from the pinned id and records that id", async () => {
  cleanup();
  const calls: FakeCalls = { writes: 0, contentRefs: [] };
  const requested: string[] = [];
  const { records } = await runExperiment(
    options({ arm: "C", modelName: "stronger-2026-05-01", onlyHead: "a691d010", runs: 1 }),
    {
      octokit: fakeOctokit(calls),
      getWriteAttempts: () => 0,
      armCModelFactory: (name) => {
        requested.push(name);
        return model('{"findings":[]}');
      },
      reviewMarkdown: REVIEW_MD,
    },
    config,
  );
  assert.deepEqual(requested, ["stronger-2026-05-01"]);
  assert.equal(records[0].modelRequested, "stronger-2026-05-01");
  assert.equal(records[0].outcome, "no_findings");
  cleanup();
});

test("a file GitHub returned no patch for is sent as document text, or as production sends it", async () => {
  cleanup();
  const calls: FakeCalls = { writes: 0, contentRefs: [] };
  const noPatch = fakeOctokit(calls, { patchFor: () => undefined });
  const synthesizedPrompts: string[] = [];
  const synthesized = await runExperiment(
    options({ onlyHead: "90a694ea", runs: 1 }),
    { octokit: noPatch, getWriteAttempts: () => 0, modelOverride: model('{"findings":[]}', synthesizedPrompts), reviewMarkdown: REVIEW_MD },
    config,
  );
  assert.ok(synthesizedPrompts[0].includes("+# full document"));
  assert.deepEqual(synthesized.records[0].filesWithoutGithubPatch, ["docs/specs/developments/x/1_x_specs.md"]);
  assert.equal(synthesized.records[0].patchSource, "synthesize");

  const productionPrompts: string[] = [];
  const production = await runExperiment(
    options({ onlyHead: "90a694ea", runs: 1, patchSource: "github" }),
    { octokit: noPatch, getWriteAttempts: () => 0, modelOverride: model('{"findings":[]}', productionPrompts), reviewMarkdown: REVIEW_MD },
    config,
  );
  assert.ok(productionPrompts[0].includes("(no textual diff available for this file)"));
  assert.ok(!productionPrompts[0].includes("full document"));
  assert.equal(production.records[0].patchSource, "github");
  cleanup();
});

test("an oversized spec is recorded as changes_too_large, not skipped", async () => {
  cleanup();
  const calls: FakeCalls = { writes: 0, contentRefs: [] };
  const huge = `@@ -0,0 +1,1 @@\n+${"x".repeat(450_000)}`;
  const { records } = await runExperiment(
    options({ onlyHead: "a691d010", runs: 1 }),
    {
      octokit: fakeOctokit(calls, { patchFor: () => huge }),
      getWriteAttempts: () => 0,
      modelOverride: model('{"findings":[]}'),
      reviewMarkdown: REVIEW_MD,
    },
    config,
  );
  assert.equal(records[0].outcome, "changes_too_large");
  cleanup();
});

test("unusable model output and a model error are recorded, not thrown", async () => {
  cleanup();
  const calls: FakeCalls = { writes: 0, contentRefs: [] };
  const unusable = await runExperiment(
    options({ onlyHead: "a691d010", runs: 1 }),
    { octokit: fakeOctokit(calls), getWriteAttempts: () => 0, modelOverride: model("not json at all"), reviewMarkdown: REVIEW_MD },
    config,
  );
  assert.equal(unusable.records[0].outcome, "unusable_output");
  assert.equal(unusable.code, 1, "an arm with no usable result must not exit 0");
  const failing: ModelClient = {
    modelName: "m",
    async complete() {
      throw new Error("boom");
    },
  };
  const errored = await runExperiment(
    options({ onlyHead: "a691d010", runs: 1 }),
    { octokit: fakeOctokit(calls), getWriteAttempts: () => 0, modelOverride: failing, reviewMarkdown: REVIEW_MD },
    config,
  );
  assert.equal(errored.records[0].outcome, "model_error");
  assert.equal(errored.records[0].errorMessage, "boom");
  assert.equal(errored.code, 1);
  cleanup();
});

test("a plan head under arm B reads the approved spec at its merge commit, once", async () => {
  cleanup();
  const calls: FakeCalls = { writes: 0, contentRefs: [] };
  const seen: string[] = [];
  await runExperiment(
    options({ arm: "B", onlyHead: "a244cabd", runs: 2 }),
    { octokit: fakeOctokit(calls), getWriteAttempts: () => 0, modelOverride: model('{"findings":[]}', seen), reviewMarkdown: REVIEW_MD },
    config,
  );
  assert.ok(seen.every((prompt) => prompt.includes("APPROVED SPEC TEXT")));
  assert.equal(calls.contentRefs.filter((ref) => ref === `${APPROVED_SPEC_PATH}@${APPROVED_SPEC_REF}`).length, 1);
  cleanup();
});

test("a manifest stage that disagrees with the branch fails loudly", async () => {
  cleanup();
  const calls: FakeCalls = { writes: 0, contentRefs: [] };
  const octokit = fakeOctokit(calls);
  (octokit.pulls as unknown as { get: unknown }).get = async () => ({
    data: { title: "t", body: "", head: { ref: "feature/x" }, base: { sha: "b".repeat(40) } },
  });
  await assert.rejects(
    () =>
      runExperiment(
        options({ dryRun: true, onlyHead: "a691d010" }),
        { octokit, getWriteAttempts: () => 0, reviewMarkdown: REVIEW_MD },
        config,
      ),
    SpecPlanExperimentUsageError,
  );
  cleanup();
});

test("a write attempt fails the run", async () => {
  cleanup();
  const calls: FakeCalls = { writes: 1, contentRefs: [] };
  const { code } = await runExperiment(
    options({ dryRun: true, onlyHead: "a691d010", runs: 1 }),
    { octokit: fakeOctokit(calls), getWriteAttempts: () => calls.writes, reviewMarkdown: REVIEW_MD },
    config,
  );
  assert.equal(code, 1);
  cleanup();
});

test("--head matching no committed head is refused", async () => {
  await assert.rejects(
    () =>
      runExperiment(
        options({ dryRun: true, onlyHead: "ffffffff" }),
        { octokit: fakeOctokit({ writes: 0, contentRefs: [] }), getWriteAttempts: () => 0, reviewMarkdown: REVIEW_MD },
        config,
      ),
    SpecPlanExperimentUsageError,
  );
});
