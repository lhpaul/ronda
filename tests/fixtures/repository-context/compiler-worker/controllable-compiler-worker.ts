import { parentPort, workerData } from "node:worker_threads";
import type {
  CompilerRequestMessage,
  FindCandidatesInput,
  ResolveCandidatesInput,
} from "../../../../src/review/repository-context-compiler.js";
import { findCandidatesInSources, resolveSymbols } from "../../../../src/review/symbol-resolver.js";

/**
 * A test-only compiler worker entry (#131) speaking the production message
 * protocol and loaded through the production bootstrap. `workerData.behaviour`
 * picks, per request type, how this worker answers:
 *
 * - `normal` (default): the real `findCandidatesInSources` / `resolveSymbols`.
 * - `busy`: busy-loops for `ms` on the worker thread, then answers normally —
 *   a deliberately slow compile.
 * - `exit`: ends the thread mid-request (no `error`, just `exit`).
 * - `throw`: throws while handling the request (an `error` event).
 * - `malformed`: posts a result that fails validation.
 * - `wrong_seq`: posts a valid-looking result with another `seq`.
 * - `unknown_type`: posts a message of an unknown type.
 * - `handshake_throw`: synchronises with the test through
 *   `workerData.handshake` (an `Int32Array` over a `SharedArrayBuffer`) so
 *   the test can place a worker `error` between a stop or `close()` and the
 *   worker's `exit`. Slot 0: the worker sets 1 once it is waiting. Slot 1:
 *   the test sets 1 to let it throw. Slot 2: the worker sets 1 from
 *   `uncaughtExceptionMonitor`, i.e. once its fatal-error report is under
 *   way. With `answerFirst`, the worker answers normally before waiting.
 */
type Behaviour =
  | { kind: "normal" }
  | { kind: "busy"; ms: number }
  | { kind: "exit" }
  | { kind: "throw" }
  | { kind: "malformed" }
  | { kind: "wrong_seq" }
  | { kind: "unknown_type" }
  | { kind: "handshake_throw"; answerFirst?: boolean };

interface ControllableWorkerData {
  behaviour?: { find?: Behaviour; resolve?: Behaviour };
  handshake?: Int32Array;
}

function answer(message: CompilerRequestMessage): unknown {
  if (message.type === "find") {
    const input = message.input as FindCandidatesInput;
    return findCandidatesInSources(input.changedSourceTexts, input.changedLinesByFile);
  }
  const input = message.input as ResolveCandidatesInput;
  return resolveSymbols(input.fileSet, input.requested, input.bookkeeping);
}

export function startCompilerWorker(): void {
  const port = parentPort;
  if (!port) {
    throw new Error("must run in a worker thread");
  }
  const data = workerData as ControllableWorkerData;
  const handshake = data.handshake;
  if (handshake) {
    process.on("uncaughtExceptionMonitor", () => {
      Atomics.store(handshake, 2, 1);
      Atomics.notify(handshake, 2);
    });
  }

  port.on("message", (message: CompilerRequestMessage) => {
    const behaviour: Behaviour = data.behaviour?.[message.type] ?? { kind: "normal" };
    switch (behaviour.kind) {
      case "normal":
        port.postMessage({ type: "result", seq: message.seq, value: answer(message) });
        return;
      case "busy": {
        const until = Date.now() + behaviour.ms;
        while (Date.now() < until) {
          // deliberately slow compile
        }
        port.postMessage({ type: "result", seq: message.seq, value: answer(message) });
        return;
      }
      case "exit":
        process.exit(3);
        return;
      case "throw":
        throw new Error("planted compiler failure");
      case "malformed":
        port.postMessage({ type: "result", seq: message.seq, value: { requested: "not-a-list" } });
        return;
      case "wrong_seq":
        port.postMessage({ type: "result", seq: message.seq + 100, value: answer(message) });
        return;
      case "unknown_type":
        port.postMessage({ type: "progress", seq: message.seq });
        return;
      case "handshake_throw": {
        if (!handshake) {
          throw new Error("handshake_throw needs workerData.handshake");
        }
        if (behaviour.answerFirst) {
          port.postMessage({ type: "result", seq: message.seq, value: answer(message) });
        }
        Atomics.store(handshake, 0, 1);
        Atomics.notify(handshake, 0);
        Atomics.wait(handshake, 1, 0);
        throw new Error("planted failure after the session stopped this worker");
      }
    }
  });
}
