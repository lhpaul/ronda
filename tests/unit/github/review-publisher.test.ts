import { test } from "node:test";
import assert from "node:assert/strict";
import type { Octokit } from "@octokit/rest";
import { ReviewPublishError, publishReview } from "../../../src/github/review-publisher.js";
import type { PublishReviewInput } from "../../../src/domain/review-pass.types.js";

function baseInput(overrides: Partial<PublishReviewInput> = {}): PublishReviewInput {
  return {
    owner: "lhpaul",
    repo: "ronda",
    pullNumber: 1,
    headSha: "a".repeat(40),
    summaryBody: "## Ronda review\n\nsummary",
    inlineComments: [{ path: "src/a.ts", line: 2, body: "finding body" }],
    fallbackSummaryBody: "## Ronda review\n\nsummary (fallback, all findings folded in)",
    ...overrides,
  };
}

function httpError(status: number): unknown {
  return { status, message: `HTTP ${status}` };
}

function createFakeOctokit(
  createReview: (params: Record<string, unknown>) => Promise<unknown>,
): { octokit: Octokit; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const octokit = {
    pulls: {
      createReview: async (params: Record<string, unknown>) => {
        calls.push(params);
        return createReview(params);
      },
    },
  } as unknown as Octokit;
  return { octokit, calls };
}

test("a successful primary attempt publishes the summary with inline comments and makes no fallback call", async () => {
  const fake = createFakeOctokit(async () => ({ data: {} }));
  await publishReview(fake.octokit, baseInput());

  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].body, "## Ronda review\n\nsummary");
  assert.deepEqual(fake.calls[0].comments, [
    { path: "src/a.ts", line: 2, side: "RIGHT", body: "finding body" },
  ]);
});

test("HTTP 422 with inline comments present triggers exactly one fallback attempt with no inline comments — no finding is dropped", async () => {
  let attempt = 0;
  const fake = createFakeOctokit(async () => {
    attempt += 1;
    if (attempt === 1) {
      throw httpError(422);
    }
    return { data: {} };
  });

  await publishReview(fake.octokit, baseInput());

  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0].comments && (fake.calls[0].comments as unknown[]).length, 1);
  assert.deepEqual(fake.calls[1].comments, []);
  assert.equal(fake.calls[1].body, "## Ronda review\n\nsummary (fallback, all findings folded in)");
});

test("HTTP 422 with no inline comments to begin with makes no fallback attempt — the same payload would fail the same way", async () => {
  const fake = createFakeOctokit(async () => {
    throw httpError(422);
  });

  await assert.rejects(
    () => publishReview(fake.octokit, baseInput({ inlineComments: [] })),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 422);
      return true;
    },
  );
  assert.equal(fake.calls.length, 1);
});

test("a non-422 error on the primary attempt propagates immediately with no fallback attempt", async () => {
  const fake = createFakeOctokit(async () => {
    throw httpError(400);
  });

  await assert.rejects(
    () => publishReview(fake.octokit, baseInput()),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 400);
      return true;
    },
  );
  assert.equal(fake.calls.length, 1);
});

test("when the fallback attempt also fails, the pass fails with ReviewPublishError naming the HTTP status rather than dropping findings silently", async () => {
  let attempt = 0;
  const fake = createFakeOctokit(async () => {
    attempt += 1;
    throw httpError(attempt === 1 ? 422 : 400);
  });

  await assert.rejects(
    () => publishReview(fake.octokit, baseInput()),
    (error: unknown) => {
      assert.ok(error instanceof ReviewPublishError);
      assert.equal(error.status, 400);
      assert.match(error.message, /HTTP 400/);
      return true;
    },
  );
  assert.equal(fake.calls.length, 2);
});

test("forwards the given signal as request.signal on the primary call", async () => {
  const fake = createFakeOctokit(async () => ({ data: {} }));
  const controller = new AbortController();

  await publishReview(fake.octokit, baseInput(), controller.signal);

  assert.equal((fake.calls[0].request as { signal?: AbortSignal } | undefined)?.signal, controller.signal);
});
