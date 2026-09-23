import { test } from "node:test";
import assert from "node:assert/strict";
import { isRetryableError, withRetry } from "../../../src/github/github-client.js";

function httpError(status: number, message = ""): unknown {
  return { status, message };
}

test("isRetryableError is true for any HTTP 5xx status", () => {
  assert.equal(isRetryableError(httpError(500)), true);
  assert.equal(isRetryableError(httpError(503)), true);
});

test("isRetryableError is true for a 403 secondary rate limit response", () => {
  assert.equal(
    isRetryableError(httpError(403, "You have exceeded a secondary rate limit")),
    true,
  );
});

test("isRetryableError is false for an ordinary 403 (not a rate limit)", () => {
  assert.equal(isRetryableError(httpError(403, "Forbidden")), false);
});

test("isRetryableError is false for a 4xx status other than the secondary rate limit case", () => {
  assert.equal(isRetryableError(httpError(422)), false);
  assert.equal(isRetryableError(httpError(401)), false);
});

test("isRetryableError is true for HTTP 429 rate limits", () => {
  assert.equal(isRetryableError(httpError(429)), true);
});

test("isRetryableError is false for a value with no numeric status", () => {
  assert.equal(isRetryableError(new Error("network down")), false);
  assert.equal(isRetryableError(undefined), false);
});

test("withRetry returns the operation's result immediately on success, with no sleep", async () => {
  let sleepCalls = 0;
  const result = await withRetry(
    async () => "ok",
    async () => {
      sleepCalls += 1;
    },
  );
  assert.equal(result, "ok");
  assert.equal(sleepCalls, 0);
});

test("withRetry retries at most twice, with the fixed 2s-then-5s backoff schedule, on a retryable error", async () => {
  let attempts = 0;
  const sleepDelays: number[] = [];
  const result = await withRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        throw httpError(500);
      }
      return "recovered";
    },
    async (ms) => {
      sleepDelays.push(ms);
    },
  );
  assert.equal(result, "recovered");
  assert.equal(attempts, 3);
  assert.deepEqual(sleepDelays, [2_000, 5_000]);
});

test("withRetry gives up after two retries (three total attempts) and throws the last error", async () => {
  let attempts = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1;
          throw httpError(500, "still failing");
        },
        async () => undefined,
      ),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 500);
      return true;
    },
  );
  assert.equal(attempts, 3);
});

test("withRetry does not retry a non-retryable error — it propagates immediately", async () => {
  let attempts = 0;
  let sleepCalls = 0;
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          attempts += 1;
          throw httpError(422);
        },
        async () => {
          sleepCalls += 1;
        },
      ),
    (error: unknown) => {
      assert.equal((error as { status?: number }).status, 422);
      return true;
    },
  );
  assert.equal(attempts, 1);
  assert.equal(sleepCalls, 0);
});

test("withRetry aborts while waiting for retry backoff", async () => {
  const controller = new AbortController();
  let attempts = 0;
  let sleepDelay: number | undefined;
  let resolveSleep: (() => void) | undefined;
  const retryPromise = withRetry(
    async () => {
      attempts += 1;
      if (attempts > 1) {
        return "unexpected retry after abort";
      }
      throw httpError(500);
    },
    async (ms) => {
      sleepDelay = ms;
      return new Promise<void>((resolve) => {
        resolveSleep = resolve;
      });
    },
    controller.signal,
  ).then(
    (value) => value,
    (error: unknown) => error,
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort(new DOMException("The operation was aborted.", "AbortError"));

  const watchdog = new Error("retry backoff did not abort");
  const result = await Promise.race([
    retryPromise,
    new Promise<Error>((resolve) => setTimeout(() => resolve(watchdog), 100)),
  ]);
  if (result === watchdog) {
    resolveSleep?.();
    await retryPromise;
  }

  assert.notEqual(result, watchdog);
  assert.equal((result as { name?: string }).name, "AbortError");
  assert.equal(attempts, 1);
  assert.equal(sleepDelay, 2_000);
});
