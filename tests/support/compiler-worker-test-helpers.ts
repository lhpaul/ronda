import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import type { Worker } from "node:worker_threads";
import {
  activeRepositoryContextCompilerWorkerCount,
  spawnCompilerWorker,
  type CompilerWorkerSpawn,
} from "../../src/review/repository-context-compiler.js";

/** Shared helpers for tests that start real repository-context compiler workers (#131). */

const COMPILER_WORKER_FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "repository-context",
  "compiler-worker",
);

/** The controllable test entry; see the fixture's own doc comment for its behaviours. */
export const CONTROLLABLE_ENTRY_URL = pathToFileURL(join(COMPILER_WORKER_FIXTURE_DIR, "controllable-compiler-worker.ts")).href;

/** An entry module that does not exist, so the real worker cannot start. */
export const MISSING_ENTRY_URL = pathToFileURL(join(COMPILER_WORKER_FIXTURE_DIR, "does-not-exist.ts")).href;

export async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) {
      assert.fail(`timed out after ${timeoutMs}ms waiting for: ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export async function waitForNoLiveWorker(timeoutMs = 5_000): Promise<void> {
  await waitFor(() => activeRepositoryContextCompilerWorkerCount() === 0, timeoutMs, "no live compiler worker");
}

/**
 * The production spawn, recording when each worker exits and when it emits
 * `error` — the latter by wrapping `emit` rather than adding a listener,
 * since a listener would itself hide a missing one in the session.
 */
export function recordingSpawn(): { spawn: CompilerWorkerSpawn; exits: number[]; errors: number[] } {
  const exits: number[] = [];
  const errors: number[] = [];
  return {
    exits,
    errors,
    spawn: (url, options) => {
      const worker = spawnCompilerWorker(url, options) as Worker;
      worker.once("exit", () => exits.push(performance.now()));
      const originalEmit = worker.emit.bind(worker);
      worker.emit = ((event: string | symbol, ...args: unknown[]) => {
        if (event === "error") {
          errors.push(performance.now());
        }
        return originalEmit(event, ...args);
      }) as typeof worker.emit;
      return worker;
    },
  };
}

/** Runs `run`, collecting any uncaught exception or unhandled rejection raised meanwhile. */
export async function captureUncaught<T>(run: () => Promise<T>): Promise<{ value: T; uncaught: unknown[] }> {
  const uncaught: unknown[] = [];
  const onUncaught = (error: unknown): void => {
    uncaught.push(error);
  };
  process.on("uncaughtException", onUncaught);
  process.on("unhandledRejection", onUncaught);
  try {
    const value = await run();
    return { value, uncaught };
  } finally {
    process.off("uncaughtException", onUncaught);
    process.off("unhandledRejection", onUncaught);
  }
}
