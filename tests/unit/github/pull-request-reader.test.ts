import { test } from "node:test";
import assert from "node:assert/strict";
import type { Octokit } from "@octokit/rest";
import {
  findExistingCheckRun,
  readChangedFiles,
  readPullRequest,
} from "../../../src/github/pull-request-reader.js";
import { CHECK_RUN_NAME } from "../../../src/domain/review-pass.types.js";

function createFakeOctokit(overrides: Partial<Record<string, unknown>> = {}): Octokit {
  return {
    pulls: {
      get: async () => ({
        data: {
          number: 4,
          title: "Add a feature",
          body: "Some description",
          draft: false,
          head: { sha: "b".repeat(40) },
        },
      }),
      listFiles: () => undefined,
    },
    paginate: async () => [
      {
        filename: "src/a.ts",
        previous_filename: undefined,
        status: "modified",
        patch: "@@ -1,2 +1,2 @@\n context\n+added",
        additions: 1,
        deletions: 0,
      },
    ],
    checks: {
      listForRef: async () => ({ data: { check_runs: [] } }),
    },
    ...overrides,
  } as unknown as Octokit;
}

test("readPullRequest maps title, body, draft, and head SHA from the API response", async () => {
  const octokit = createFakeOctokit();
  const result = await readPullRequest(octokit, "lhpaul", "ronda", 4);
  assert.equal(result.number, 4);
  assert.equal(result.title, "Add a feature");
  assert.equal(result.body, "Some description");
  assert.equal(result.draft, false);
  assert.equal(result.headSha, "b".repeat(40));
});

test("readPullRequest defaults a null body to an empty string", async () => {
  const octokit = createFakeOctokit({
    pulls: {
      get: async () => ({
        data: { number: 1, title: "t", body: null, draft: true, head: { sha: "c".repeat(40) } },
      }),
    },
  });
  const result = await readPullRequest(octokit, "lhpaul", "ronda", 1);
  assert.equal(result.body, "");
  assert.equal(result.draft, true);
});

test("readChangedFiles maps every paginated file, keyed to its current filename", async () => {
  const octokit = createFakeOctokit();
  const files = await readChangedFiles(octokit, "lhpaul", "ronda", 4);
  assert.equal(files.length, 1);
  assert.equal(files[0].path, "src/a.ts");
  assert.equal(files[0].status, "modified");
  assert.equal(files[0].additions, 1);
  assert.equal(files[0].deletions, 0);
  assert.equal(files[0].patch, "@@ -1,2 +1,2 @@\n context\n+added");
});

test("readChangedFiles keys a renamed file to its new filename and preserves previousPath", async () => {
  const octokit = createFakeOctokit({
    paginate: async () => [
      {
        filename: "src/new-name.ts",
        previous_filename: "src/old-name.ts",
        status: "renamed",
        patch: undefined,
        additions: 0,
        deletions: 0,
      },
    ],
  });
  const files = await readChangedFiles(octokit, "lhpaul", "ronda", 4);
  assert.equal(files[0].path, "src/new-name.ts");
  assert.equal(files[0].previousPath, "src/old-name.ts");
});

test("findExistingCheckRun queries by the constant check-run name and returns the first run's id", async () => {
  let queriedCheckName: unknown;
  const octokit = createFakeOctokit({
    checks: {
      listForRef: async (params: { check_name: string }) => {
        queriedCheckName = params.check_name;
        return { data: { check_runs: [{ id: 777 }] } };
      },
    },
  });
  const id = await findExistingCheckRun(octokit, "lhpaul", "ronda", "a".repeat(40));
  assert.equal(id, 777);
  assert.equal(queriedCheckName, CHECK_RUN_NAME);
});

test("findExistingCheckRun returns null when no check run is found for the head SHA", async () => {
  const octokit = createFakeOctokit({
    checks: { listForRef: async () => ({ data: { check_runs: [] } }) },
  });
  const id = await findExistingCheckRun(octokit, "lhpaul", "ronda", "a".repeat(40));
  assert.equal(id, null);
});
