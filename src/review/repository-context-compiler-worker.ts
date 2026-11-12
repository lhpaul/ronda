import { parentPort } from "node:worker_threads";
import type { CompilerRequestMessage, FindCandidatesInput, ResolveCandidatesInput } from "./repository-context-compiler.js";
import { findCandidatesInSources, resolveSymbols } from "./symbol-resolver.js";

/**
 * The repository-context compiler worker entry (#131), loaded by
 * `repository-context-compiler-bootstrap.mjs` inside a per-pass worker
 * thread. It only runs the two compile halves over text the main thread has
 * already read: no logging, no file-system access, no network. An exception
 * thrown by the resolver is deliberately left uncaught, so it reaches the
 * session as the worker's `error` event (`stopped_unexpectedly`).
 *
 * The bootstrap calls {@link startCompilerWorker} only after it has posted
 * `ready`, so no result can ever precede `ready`. Requests posted earlier
 * are queued by Node until this listener attaches.
 */
export function startCompilerWorker(): void {
  const port = parentPort;
  if (!port) {
    throw new Error("The repository-context compiler entry must run in a worker thread");
  }
  port.on("message", (message: CompilerRequestMessage) => {
    if (message.type === "find") {
      const input = message.input as FindCandidatesInput;
      port.postMessage({
        type: "result",
        seq: message.seq,
        value: findCandidatesInSources(input.changedSourceTexts, input.changedLinesByFile),
      });
      return;
    }
    if (message.type === "resolve") {
      const input = message.input as ResolveCandidatesInput;
      port.postMessage({
        type: "result",
        seq: message.seq,
        value: resolveSymbols(input.fileSet, input.requested, input.bookkeeping),
      });
      return;
    }
    throw new Error("Unknown repository-context compiler request");
  });
}
