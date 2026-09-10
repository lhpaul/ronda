import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleMainRejection,
  handleUncaughtException,
  handleUnhandledRejection,
  type ExitingProcess,
} from "../../../src/cli/review-pr.js";

/**
 * Fake `process`-shaped seam. Captures `exitCode` and every `exit()` call
 * instead of ever calling the real `process.exit`, which would terminate
 * the test runner itself.
 */
function createFakeProcess(): { proc: ExitingProcess; exitCalls: Array<number | undefined> } {
  const exitCalls: Array<number | undefined> = [];
  const proc: ExitingProcess = {
    exitCode: undefined,
    exit: ((code?: number) => {
      exitCalls.push(code);
    }) as ExitingProcess["exit"],
  };
  return { proc, exitCalls };
}

function withSilencedConsoleError<T>(fn: () => T): T {
  const original = console.error;
  console.error = () => undefined;
  try {
    return fn();
  } finally {
    console.error = original;
  }
}

// --- Fix 2: none of these handlers may merely set `exitCode` and return —
// Node keeps the process alive after `uncaughtException`/`unhandledRejection`
// unless something actually calls `exit()`. A broken pass must terminate
// promptly rather than sit until the Actions `timeout-minutes` backstop
// kills the job with no check run ever published (the constitution's
// "silence is a failure, not a hang"). ---

test("handleUncaughtException sets exitCode to 1 and calls exit(1) — it does not merely set exitCode and return", () => {
  const { proc, exitCalls } = createFakeProcess();
  withSilencedConsoleError(() => handleUncaughtException(new Error("boom"), proc));

  assert.equal(proc.exitCode, 1);
  assert.deepEqual(exitCalls, [1]);
});

test("handleUnhandledRejection sets exitCode to 1 and calls exit(1) — same scrutiny as the uncaughtException handler", () => {
  const { proc, exitCalls } = createFakeProcess();
  withSilencedConsoleError(() => handleUnhandledRejection("some rejected value", proc));

  assert.equal(proc.exitCode, 1);
  assert.deepEqual(exitCalls, [1]);
});

test("handleMainRejection (a rejected main()) sets exitCode to 1 and calls exit(1), for the same reason", () => {
  const { proc, exitCalls } = createFakeProcess();
  withSilencedConsoleError(() => handleMainRejection(new Error("fatal"), proc));

  assert.equal(proc.exitCode, 1);
  assert.deepEqual(exitCalls, [1]);
});

test("each handler logs to console.error before exiting, so the failure is never silent", () => {
  const messages: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    messages.push(args);
  };
  try {
    const { proc: proc1 } = createFakeProcess();
    handleUncaughtException(new Error("boom"), proc1);
    const { proc: proc2 } = createFakeProcess();
    handleUnhandledRejection("rejected", proc2);
    const { proc: proc3 } = createFakeProcess();
    handleMainRejection(new Error("fatal"), proc3);
  } finally {
    console.error = original;
  }

  assert.equal(messages.length, 3);
});
