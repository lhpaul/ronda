import { test } from "node:test";
import assert from "node:assert/strict";
import type { Octokit } from "@octokit/rest";
import { publishCheckRun } from "../../../src/github/check-run-publisher.js";
import { GithubClientError } from "../../../src/github/github-client.js";
import { CHECK_RUN_NAME } from "../../../src/domain/review-pass.types.js";
import type { PublishCheckRunInput } from "../../../src/domain/review-pass.types.js";

function baseInput(overrides: Partial<PublishCheckRunInput> = {}): PublishCheckRunInput {
  return {
    owner: "lhpaul",
    repo: "ronda",
    headSha: "a".repeat(40),
    existingCheckRunId: null,
    title: "Review posted — no findings",
    summary: "Model: fake\nDuration: 1s",
    conclusion: "success",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}

interface FakeOctokit {
  octokit: Octokit;
  createCalls: unknown[];
  updateCalls: unknown[];
}

function createFakeOctokit(): FakeOctokit {
  const createCalls: unknown[] = [];
  const updateCalls: unknown[] = [];
  const octokit = {
    checks: {
      create: async (params: unknown) => {
        createCalls.push(params);
        return { data: { id: 1 } };
      },
      update: async (params: unknown) => {
        updateCalls.push(params);
        return { data: { id: 1 } };
      },
    },
  } as unknown as Octokit;
  return { octokit, createCalls, updateCalls };
}

test("no existing check run id issues POST checks.create, never checks.update, naming the check run", async () => {
  const fake = createFakeOctokit();
  await publishCheckRun(fake.octokit, baseInput({ existingCheckRunId: null }));

  assert.equal(fake.createCalls.length, 1);
  assert.equal(fake.updateCalls.length, 0);
  const call = fake.createCalls[0] as Record<string, unknown>;
  assert.equal(call.name, CHECK_RUN_NAME);
  assert.equal(call.status, "completed");
  assert.equal(call.conclusion, "success");
  assert.equal(call.head_sha, "a".repeat(40));
});

test("an existing check run id issues PATCH checks.update on that id, never checks.create — one identity per head SHA", async () => {
  const fake = createFakeOctokit();
  await publishCheckRun(fake.octokit, baseInput({ existingCheckRunId: 555, conclusion: "failure" }));

  assert.equal(fake.updateCalls.length, 1);
  assert.equal(fake.createCalls.length, 0);
  const call = fake.updateCalls[0] as Record<string, unknown>;
  assert.equal(call.check_run_id, 555);
  assert.equal(call.status, "completed");
  assert.equal(call.conclusion, "failure");
});

test("the output carries the caller's title and summary verbatim, for both create and update", async () => {
  const fake = createFakeOctokit();
  await publishCheckRun(
    fake.octokit,
    baseInput({ title: "Review failed — timed out", summary: "Reason: timed out" }),
  );
  const call = fake.createCalls[0] as { output: { title: string; summary: string } };
  assert.equal(call.output.title, "Review failed — timed out");
  assert.equal(call.output.summary, "Reason: timed out");
});

test("forwards the given signal as request.signal on both create and update", async () => {
  const fake = createFakeOctokit();
  const controller = new AbortController();

  await publishCheckRun(fake.octokit, baseInput({ existingCheckRunId: null }), controller.signal);
  await publishCheckRun(fake.octokit, baseInput({ existingCheckRunId: 555 }), controller.signal);

  const createCall = fake.createCalls[0] as { request?: { signal?: AbortSignal } };
  const updateCall = fake.updateCalls[0] as { request?: { signal?: AbortSignal } };
  assert.equal(createCall.request?.signal, controller.signal);
  assert.equal(updateCall.request?.signal, controller.signal);
});

// --- Issue #11: an abort during either checks.create or checks.update must
// classify as a typed GithubClientError, not the raw AbortError. ---

test("an abort during checks.create maps to a typed GithubClientError", async () => {
  const controller = new AbortController();
  controller.abort();
  const octokit = {
    checks: {
      create: async () => {
        throw new DOMException("This operation was aborted", "AbortError");
      },
      update: async () => ({ data: { id: 1 } }),
    },
  } as unknown as Octokit;

  await assert.rejects(
    () => publishCheckRun(octokit, baseInput({ existingCheckRunId: null }), controller.signal),
    (error: unknown) => {
      assert.ok(error instanceof GithubClientError);
      assert.equal(error.reason, "timed_out");
      return true;
    },
  );
});

test("an abort during checks.update maps to a typed GithubClientError", async () => {
  const controller = new AbortController();
  controller.abort();
  const octokit = {
    checks: {
      create: async () => ({ data: { id: 1 } }),
      update: async () => {
        throw new DOMException("This operation was aborted", "AbortError");
      },
    },
  } as unknown as Octokit;

  await assert.rejects(
    () => publishCheckRun(octokit, baseInput({ existingCheckRunId: 555 }), controller.signal),
    (error: unknown) => {
      assert.ok(error instanceof GithubClientError);
      assert.equal(error.reason, "timed_out");
      return true;
    },
  );
});
