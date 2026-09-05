import { test } from "node:test";
import assert from "node:assert/strict";
import { createPassDeadline } from "../../../src/core/pass-deadline.js";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("the timer fires and aborts the signal after the budget elapses", async () => {
  const deadline = createPassDeadline(10);
  assert.equal(deadline.expired(), false);
  assert.equal(deadline.signal.aborted, false);
  await wait(40);
  assert.equal(deadline.expired(), true);
  assert.equal(deadline.signal.aborted, true);
  deadline.dispose();
});

test("markPublishing neutralises a deadline that fires afterward", async () => {
  const deadline = createPassDeadline(10);
  deadline.markPublishing();
  await wait(40);
  assert.equal(deadline.expired(), false);
  assert.equal(deadline.signal.aborted, false);
  deadline.dispose();
});

test("dispose clears the timer before it can fire", async () => {
  const deadline = createPassDeadline(10);
  deadline.dispose();
  await wait(40);
  assert.equal(deadline.expired(), false);
  assert.equal(deadline.signal.aborted, false);
});

test("dispose calls the injected clock's clearTimeout with the timer handle", () => {
  let cleared: unknown;
  const handle = { unref: () => undefined };
  const deadline = createPassDeadline(10, {
    setTimeout: () => handle,
    clearTimeout: (h) => {
      cleared = h;
    },
  });
  deadline.dispose();
  assert.equal(cleared, handle);
});
