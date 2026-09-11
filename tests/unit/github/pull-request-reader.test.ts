import { test } from "node:test";
import assert from "node:assert/strict";
import type { Octokit } from "@octokit/rest";
import {
  findExistingCheckRun,
  readChangedFiles,
  readPullRequest,
} from "../../../src/github/pull-request-reader.js";
import { CHECK_RUN_NAME } from "../../../src/domain/review-pass.types.js";
import { GithubClientError } from "../../../src/github/github-client.js";

/**
 * Runs `fn` with the global `setTimeout` replaced by one that invokes its
 * callback immediately, ignoring the requested delay. `withRetry`'s default
 * sleep implementation calls the *global* `setTimeout` at call time (not a
 * captured reference), so this makes retry-driven tests deterministic and
 * fast instead of incurring the real fixed 2s/5s backoff.
 */
async function withInstantTimers<T>(fn: () => Promise<T>): Promise<T> {
  const original = globalThis.setTimeout;
  globalThis.setTimeout = ((
    callback: (...callbackArgs: unknown[]) => void,
    _ms?: number,
    ...callbackArgs: unknown[]
  ) => {
    callback(...callbackArgs);
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout;
  try {
    return await fn();
  } finally {
    globalThis.setTimeout = original;
  }
}

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

test("findExistingCheckRun can filter runs to the publishing GitHub App", async () => {
  const octokit = createFakeOctokit({
    checks: {
      listForRef: async () => ({
        data: {
          check_runs: [
            { id: 111, app: { id: 15368, slug: "github-actions" } },
            { id: 222, app: { id: 42, slug: "ronda" } },
          ],
        },
      }),
    },
  });

  const id = await findExistingCheckRun(
    octokit,
    "lhpaul",
    "ronda",
    "a".repeat(40),
    undefined,
    { appId: 42 },
  );

  assert.equal(id, 222);
});

test("findExistingCheckRun returns null when only foreign App runs exist", async () => {
  const octokit = createFakeOctokit({
    checks: {
      listForRef: async () => ({
        data: { check_runs: [{ id: 111, app: { id: 15368, slug: "github-actions" } }] },
      }),
    },
  });

  const id = await findExistingCheckRun(
    octokit,
    "lhpaul",
    "ronda",
    "a".repeat(40),
    undefined,
    { appId: 42 },
  );

  assert.equal(id, null);
});

// --- Fix 3: readChangedFiles must be under the same bounded retry policy as
// every other GitHub read/publish call, and retry must compose correctly
// with pagination (retry the whole paginated fetch, never a single page). ---

test("readChangedFiles retries the whole paginated fetch once on a transient 5xx and returns the complete, non-duplicated result", async () => {
  let paginateCalls = 0;
  const octokit = createFakeOctokit({
    paginate: async () => {
      paginateCalls += 1;
      if (paginateCalls === 1) {
        throw { status: 503, message: "Service Unavailable" };
      }
      return [
        {
          filename: "src/a.ts",
          previous_filename: undefined,
          status: "modified",
          patch: "@@ -1,2 +1,2 @@\n context\n+added",
          additions: 1,
          deletions: 0,
        },
        {
          filename: "src/b.ts",
          previous_filename: undefined,
          status: "modified",
          patch: "@@ -1,1 +1,1 @@\n-old\n+new",
          additions: 1,
          deletions: 1,
        },
      ];
    },
  });

  const files = await withInstantTimers(() => readChangedFiles(octokit, "lhpaul", "ronda", 4));

  // Retried exactly once (two total attempts): the failed first attempt
  // contributed nothing, so the result is exactly the second attempt's
  // complete page set — no duplicate entries, no dropped file.
  assert.equal(paginateCalls, 2);
  assert.equal(files.length, 2);
  assert.deepEqual(
    files.map((file) => file.path),
    ["src/a.ts", "src/b.ts"],
  );
});

test("readChangedFiles does not retry a non-retryable error and propagates it immediately", async () => {
  let paginateCalls = 0;
  const octokit = createFakeOctokit({
    paginate: async () => {
      paginateCalls += 1;
      throw { status: 404, message: "Not Found" };
    },
  });

  await assert.rejects(
    () => withInstantTimers(() => readChangedFiles(octokit, "lhpaul", "ronda", 4)),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 404);
      return true;
    },
  );
  assert.equal(paginateCalls, 1);
});

test("readChangedFiles gives up after two retries (three total attempts) on a persistent 5xx", async () => {
  let paginateCalls = 0;
  const octokit = createFakeOctokit({
    paginate: async () => {
      paginateCalls += 1;
      throw { status: 500, message: "still failing" };
    },
  });

  await assert.rejects(
    () => withInstantTimers(() => readChangedFiles(octokit, "lhpaul", "ronda", 4)),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 500);
      return true;
    },
  );
  assert.equal(paginateCalls, 3);
});

// --- Fix 4: readers forward the deadline's AbortSignal to Octokit. ---

test("readPullRequest, readChangedFiles, and findExistingCheckRun each forward the given signal as request.signal", async () => {
  const seenSignals: Array<AbortSignal | undefined> = [];
  const controller = new AbortController();
  const octokit = createFakeOctokit({
    pulls: {
      get: async (params: { request?: { signal?: AbortSignal } }) => {
        seenSignals.push(params.request?.signal);
        return {
          data: {
            number: 4,
            title: "t",
            body: "b",
            draft: false,
            head: { sha: "a".repeat(40) },
          },
        };
      },
      listFiles: () => undefined,
    },
    paginate: async (_route: unknown, params: { request?: { signal?: AbortSignal } }) => {
      seenSignals.push(params.request?.signal);
      return [];
    },
    checks: {
      listForRef: async (params: { request?: { signal?: AbortSignal } }) => {
        seenSignals.push(params.request?.signal);
        return { data: { check_runs: [] } };
      },
    },
  });

  await readPullRequest(octokit, "lhpaul", "ronda", 4, controller.signal);
  await readChangedFiles(octokit, "lhpaul", "ronda", 4, controller.signal);
  await findExistingCheckRun(octokit, "lhpaul", "ronda", "a".repeat(40), controller.signal);

  assert.equal(seenSignals.length, 3);
  assert.ok(seenSignals.every((signal) => signal === controller.signal));
});

test("readPullRequest aborts retry backoff when the caller signal aborts", async () => {
  const controller = new AbortController();
  let attempts = 0;
  const octokit = createFakeOctokit({
    pulls: {
      get: async () => {
        attempts += 1;
        if (attempts > 1) {
          return {
            data: {
              number: 4,
              title: "unexpected retry",
              body: "",
              draft: false,
              head: { sha: "a".repeat(40) },
            },
          };
        }
        throw { status: 500, message: "server unavailable" };
      },
      listFiles: () => undefined,
    },
  });
  const readPromise = readPullRequest(
    octokit,
    "lhpaul",
    "ronda",
    4,
    controller.signal,
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort(new DOMException("The operation was aborted.", "AbortError"));

  await assert.rejects(
    () => readPromise,
    (error: unknown) => {
      assert.ok(error instanceof GithubClientError);
      assert.equal(error.reason, "timed_out");
      return true;
    },
  );
  assert.equal(attempts, 1);
});

// --- Issue #11: a deadline expiring during any GitHub call must classify as
// a typed `GithubClientError` (reason `timed_out`), not the raw
// `AbortError`/`DOMException` Octokit's underlying `fetch` transport throws.
// This is the client-boundary half of the fix — `runReviewPass`'s handling
// of the resulting error is covered in `tests/unit/core/run-review-pass.test.ts`. ---

function abortErrorLikeOctokitThrows(): never {
  // Mirrors the shape of the real failure reproduced live in issue #11:
  // `DOMException [AbortError]: This operation was aborted`.
  throw new DOMException("This operation was aborted", "AbortError");
}

test("readPullRequest maps an abort (signal already aborted when the underlying call rejects) to a typed GithubClientError, not the raw AbortError", async () => {
  const controller = new AbortController();
  controller.abort();
  const octokit = createFakeOctokit({
    pulls: {
      get: async () => abortErrorLikeOctokitThrows(),
      listFiles: () => undefined,
    },
  });

  await assert.rejects(
    () => readPullRequest(octokit, "lhpaul", "ronda", 4, controller.signal),
    (error: unknown) => {
      assert.ok(error instanceof GithubClientError);
      assert.equal(error.reason, "timed_out");
      return true;
    },
  );
});

test("readChangedFiles maps an abort to a typed GithubClientError", async () => {
  const controller = new AbortController();
  controller.abort();
  const octokit = createFakeOctokit({
    paginate: async () => abortErrorLikeOctokitThrows(),
  });

  await assert.rejects(
    () => readChangedFiles(octokit, "lhpaul", "ronda", 4, controller.signal),
    (error: unknown) => {
      assert.ok(error instanceof GithubClientError);
      assert.equal(error.reason, "timed_out");
      return true;
    },
  );
});

test("findExistingCheckRun maps an abort to a typed GithubClientError", async () => {
  const controller = new AbortController();
  controller.abort();
  const octokit = createFakeOctokit({
    checks: { listForRef: async () => abortErrorLikeOctokitThrows() },
  });

  await assert.rejects(
    () => findExistingCheckRun(octokit, "lhpaul", "ronda", "a".repeat(40), controller.signal),
    (error: unknown) => {
      assert.ok(error instanceof GithubClientError);
      assert.equal(error.reason, "timed_out");
      return true;
    },
  );
});

test("a non-abort failure (signal not aborted) propagates unchanged, never wrapped as GithubClientError", async () => {
  const octokit = createFakeOctokit({
    pulls: {
      get: async () => {
        throw { status: 404, message: "Not Found" };
      },
      listFiles: () => undefined,
    },
  });

  await assert.rejects(
    () => readPullRequest(octokit, "lhpaul", "ronda", 4),
    (error: unknown) => {
      assert.ok(!(error instanceof GithubClientError));
      assert.equal((error as { status?: number }).status, 404);
      return true;
    },
  );
});
