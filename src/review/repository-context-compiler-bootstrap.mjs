// Repository-context compiler worker bootstrap (#131, D2).
//
// A worker thread does not inherit `tsx`'s TypeScript loader in a way that
// can load a `.ts` entry, so the worker starts from this plain ESM file,
// registers `tsx` here, then imports the entry named by `workerData.entryUrl`
// — always a module-relative URL built by Ronda's own code, never anything
// from the reviewed repository. It posts `ready` before starting the entry,
// so `ready` always precedes any result and marks the boundary between
// "could not start" and "stopped unexpectedly".
import { parentPort, workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";

register();
const entry = await import(workerData.entryUrl);
parentPort.postMessage({ type: "ready" });
entry.startCompilerWorker();
