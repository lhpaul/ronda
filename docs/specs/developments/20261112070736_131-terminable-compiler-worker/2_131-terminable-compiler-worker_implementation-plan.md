# Terminable Repository-Context Compiler Work — Implementation Plan

**Spec**: [`1_131-terminable-compiler-worker_specs.md`](./1_131-terminable-compiler-worker_specs.md)
**Smoke test runbook**: [`131-terminable-compiler-worker.smoke-test.md`](../../../testing/ronda/131-terminable-compiler-worker.smoke-test.md)

---

## Summary

**Approach**: Move the two compiler steps of read-only repository context —
finding candidates (`ts.createProgram` + checker + AST walk over the changed
files) and resolving them (`resolveSymbols` over the fetched closure) — into a
per-pass `node:worker_threads` worker that the review pass terminates the
moment a stop signal fires. Reads stay on the main thread, on the existing
`readFileAtRef` seam; only already-read text crosses into the worker. The
repository-context phase in `run-review-pass.ts` drives a small
"compiler session" object that always settles with exactly one typed outcome
(result, stopped, or isolation failed), decided by one pure precedence
function, and maps each outcome onto the existing record shapes. The webhook
job's watchdog signal is passed into the pass so a watchdog abort also stops
an in-flight compile. Resolver logic is unchanged: `identifyCandidates` is
split mechanically into its read half and its compile half, and the compile
halves are what the worker calls.

**Estimated complexity**: M

**Rationale**: One new main-thread module, one worker entry, one small
bootstrap file, a mechanical split of one resolver function, and a rewiring of
one pass phase plus one webhook call site. The bulk of the effort is the
concurrency contract (stop precedence, late/malformed results, cleanup) and
its tests, including real-worker tests that must be stable on CI.

**Dependencies**: #106 (read-only repository context) — merged. No other
item. No new package dependency (D7).

---

## Decisions

Every value and design choice in this plan is asserted once, here. Other
sections refer to these rows by number.

| # | Decision | Rationale |
| --- | --- | --- |
| D1 | **Isolation mechanism**: one `node:worker_threads` `Worker` per review pass, created lazily the first time the phase needs a compile (after the changed-file reads have produced at least one source text) and reused for that pass's resolution compile. It is never shared with, or reused by, another pass. | `node:worker_threads` is built in (no new dependency) and `worker.terminate()` stops a thread mid-loop (Verification Log V9). Reusing the worker for the second compile of the same pass avoids paying startup twice; the spec forbids only reuse *across* passes. Lazy start keeps AC8 (off, fork, pre-review passes, and passes with no eligible source text start no worker). |
| D2 | **Loading `.ts` in the worker under `tsx`**: the worker is started from a plain ESM bootstrap, `src/review/repository-context-compiler-bootstrap.mjs`, which calls `register()` from `tsx/esm/api`, then dynamically imports the `.ts` entry named by `workerData.entryUrl`, then posts `{ type: "ready" }`. Inherited `execArgv` and an explicit `--import` of the tsx ESM loader are **not** used. | Plan-time spike (V8, V9): with tsx 4.23.13 the inherited `execArgv` and an explicit `--import` both fail inside a worker with "Unknown file extension .ts" on Node 20.20.2 and 22.15.0; the bootstrap succeeds on both, under `tsx <file>` and under `tsx --test`. `tsx` is already the launcher of every ingress (`npm run review`, `npm run webhook`), so no setup changes. The entry URL is always a module-relative URL built by Ronda's own code; reviewed content never reaches it. |
| D3 | **Stop grace**: `REPOSITORY_CONTEXT_COMPILE_STOP_GRACE_MS = 250`, exported from `src/review/repository-context-compiler.ts`. The session never *waits* for termination: on a stop it calls `worker.terminate()` without awaiting and settles its outcome synchronously inside the stop handler, so the pass continues on the next event-loop turn. The grace is the contract the tests assert for both "outcome settled" and "worker exited", measured from the stop signal (budget expiry, deadline expiry, or watchdog abort). | Spec Business Rules ("well under one second"; "the pass never waits past the grace"). The spike measured termination of a busy worker at 5–6 ms (V9), so 250 ms leaves a wide margin for loaded CI runners while staying well under a second. |
| D4 | **AC3 timer bound**: while a deliberately slow compile (a worker busy for at least 3000 ms) is in flight, a main-thread timer fires no later than **200 ms** after its due time. Asserted as a test constant in `tests/unit/review/repository-context-compiler.test.ts`. | The spike measured under 5 ms of lateness while a worker was starting and busy (V9). A 200 ms bound is 15 times smaller than the simulated compile, so a regression to in-line compiling cannot pass, and it tolerates CI scheduling noise. |
| D5 | **Stop precedence** is implemented once, in the pure function `decideCompileOutcome(stops, event)`: first the first aborted entry in `stops` order (`watchdog_abort`, then `pass_deadline`, then `context_time_budget`), then an isolation failure, then a result that passes validation; a result that fails validation is `isolation_failed: stopped_unexpectedly`. Every event the session receives (stop signal, worker `error` / `exit` / `messageerror`, worker message) goes through it, so the order holds whichever event is dispatched first. | Spec Business Rules → "Which stop wins" and "Late and malformed results". A late result cannot be used because the stop signal is checked before the message. |
| D6 | **Which stop bounds which compile**: finding candidates is bounded by `[watchdog_abort, pass_deadline]`; resolving candidates by `[watchdog_abort, pass_deadline, <context deadline>]`. The context deadline's label is `pass_deadline` when the remaining pass time was the lesser (or equal) bound at the moment `timeBudgetMs` was computed, and `context_time_budget` otherwise. The `watchdog_abort` entry is present only when `deps.jobAbortSignal` is set. | #106's budget boundaries are unchanged (spec Use Case 1 Considerations). Labelling the clamped context deadline by what it really is keeps the stop log event and the "Which stop wins" order honest when the pass deadline is the binding bound. |
| D7 | **No new dependency, no workflow/Action change.** `tsx` stays where it is in `package.json`; `typescript` is already a runtime dependency. `.github/workflows/**`, the reusable Action, and `action.yml`-style definitions are not touched. | Spec Business Rules → "Same runtimes, no new setup"; AC9. Every ingress already installs with `npm ci` and launches through `tsx` (V7). |
| D8 | **Worker environment**: `env: {}` (the worker gets an empty `process.env`), `stdout: true` and `stderr: true` with both streams drained and discarded. No `resourceLimits`. | Keeps credentials (`RONDA_MODEL_API_KEY`, `GITHUB_TOKEN`) out of the worker and keeps any loader or runtime message (which can contain local paths) out of the logs (AC10). The spike resolved a candidate with an empty env (V9). Memory bounding is out of scope (spec Out of Scope). |
| D9 | **TypeScript lib files** are read inside the worker exactly as today: `createVirtualCompilerHost` serves reviewed files from the in-memory map and reads only `isOwnLibPath` files (Ronda's own `typescript/lib`) through `ts.sys`. The worker imports `symbol-resolver.ts`, so `TS_LIB_DIR` is computed from Ronda's install in the worker too. | Spec Business Rules → "Read-only property unchanged". The spike confirmed `TS_LIB_DIR` resolves to Ronda's `node_modules/typescript/lib` inside the worker (V9). |
| D10 | **Resolver split (no logic change)**: `identifyCandidates` is split into `readChangedSourceTexts(changedFilePaths, readFile)` (the existing read loop and size caps, async, main thread) and `findCandidatesInSources(changedSourceTexts, changedLinesByFile)` (the existing program/checker/walk, sync, worker). `identifyCandidates` stays exported as their composition, with the same signature and result. `resolveSymbols` is unchanged. | Brief objective 6 ("only the call site is wrapped"). Keeping `identifyCandidates` keeps the offline recall benchmark and the existing resolver unit tests unchanged. |
| D11 | **No in-line fallback, scoped to review passes**: `runReviewPass` never calls `findCandidatesInSources` or `resolveSymbols` in-line. The offline recall/quality benchmark (`src/cli/recall-benchmark.ts`) keeps calling `identifyCandidates` / `resolveSymbols` in-line, unchanged. | Spec Business Rules → "No in-line fallback"; spec Out of Scope (offline tooling may stay in-line). |
| D12 | **Isolation failures reach the existing failure path without the worker's error text.** The phase emits the specific isolation log event, then throws `RepositoryContextIsolationError`, whose message is fixed text naming only the failure kind. The existing `catch` builds the existing failed-phase record and emits `repository_context_phase_failed` with `String(error)` of that fixed-text error. The worker's own `Error` objects, exit codes, and stream output are never logged. | Spec Recorded Decision 1 (same record as a failed phase) and AC10. Reusing the existing catch keeps one code path for "failed repository-context phase". |
| D13 | **Watchdog wiring**: `ReviewPassDeps` gains `jobAbortSignal?: AbortSignal`; `runWebhookReviewJob` passes its job `signal` there. Only the repository-context phase reads it. The CLI and control-pass ingresses leave it unset. | Advisory item 2; AC7. Every other pass step already sees the job signal through the combined GitHub/model signals in `webhook-job.ts`. |
| D14 | **Terminal outcome of a stopped compile** (advisory items 2 and 4): the phase never throws for a stop; it returns the record pinned in **Stop and failure outcomes** below and the pass continues to its model request. For `watchdog_abort` and `pass_deadline` that request runs on an already-aborted signal and is rejected as `timed_out` (`ModelClientError` from the real client, which uses `fetch` with the signal; on the webhook ingress through `withOuterAbortSignal`). The shared `catch` then logs the held repository-context record (the request was issued) and publishes the `timed_out` failure check run through `finalizeFailure`. On the webhook ingress the job then returns normally inside the settlement window, so the delivery completes as published, as for any watchdog abort that lands on a GitHub or model call today. | Spec: "the pass ends the way a pass whose deadline runs out ends today". This is that path, unchanged; the stop only makes it happen at the deadline. |
| D15 | **Test seam**: `ReviewPassDeps` gains `createRepositoryContextCompiler?: RepositoryContextCompilerFactory` (default: `createWorkerCompilerSession()` with the production entry). `createWorkerCompilerSession` accepts `entryUrl`, extra `workerData`, and a `spawn` override for tests. A module-level counter, `activeRepositoryContextCompilerWorkerCount()`, is exported for tests only. | Lets tests use controllable real workers (slow, crashing, malformed), a scripted fake for event-ordering cases, and an in-line session for older tests whose subject is not isolation. Same optional-injection pattern as `deadlineClock` and `loadSweepList`. |

---

## Stop and failure outcomes

This is the single place the phase's record, log events, and pass ending are
pinned for each compile outcome. "Read figures" means the
`unreadableChangedFilePaths` and `contentRequestCount` that
`readChangedSourceTexts` returned.

| Phase | Winning outcome (D5) | Repository-context record | Log events | Pass ending |
| --- | --- | --- | --- | --- |
| Finding | result | Existing path, unchanged | None new | Unchanged |
| Finding | `watchdog_abort` or `pass_deadline` | `unavailable`; `candidatesRequested` 0; `drops` empty; read figures; `nonRepositoryReferencesSkipped` 0; `charsUsed` 0; `timeBudgetMs` = configured budget; `timeUsedMs` 0 | `repository_context_compile_stopped` `{ phase: "finding_candidates", stoppedBy }` | Failed, `timed_out` (D14) |
| Finding | `could_not_start` / `stopped_unexpectedly` | Existing failed-phase record (no drops, nothing requested yet) | `repository_context_compiler_start_failed` or `repository_context_compiler_stopped_unexpectedly` `{ phase }`, then `repository_context_phase_failed` (D12) | Review published |
| Resolving | result | Existing path, unchanged | None new | Unchanged |
| Resolving | `context_time_budget` | Existing path with every requested reference resolved as `time_budget` (identical to today's `contextDeadline.expired()` branch): `unavailable`, all requested dropped `time_budget`, closure counts and `timeUsedMs` from real elapsed time | `repository_context_compile_stopped` `{ phase: "resolving_candidates", stoppedBy: "context_time_budget" }` | Review published |
| Resolving | `watchdog_abort` or `pass_deadline` | Same record as the `context_time_budget` row | `repository_context_compile_stopped` with that `stoppedBy` | Failed, `timed_out` (D14) |
| Resolving | `could_not_start` / `stopped_unexpectedly` | Existing failed-phase record: `unavailable`, every requested reference dropped `read_failed` | Isolation event `{ phase }`, then `repository_context_phase_failed` (D12) | Review published |

`could_not_start` can occur in the resolving phase only if no worker was
started during finding, which the D1 lazy start never does when finding
produced candidates; the row is kept so the table has no gap.

---

## Compiler session lifecycle

The session (`createWorkerCompilerSession`) is the only stateful contract in
this plan. Every request settles exactly once; the public methods never throw
or reject.

| State | Event | Outcome of the in-flight request | Next state |
| --- | --- | --- | --- |
| `unstarted` | request with a stop already aborted | `stopped` (D5) — no worker spawned | `closed` |
| `unstarted` | request; `new Worker(...)` throws | `isolation_failed: could_not_start` | `closed` |
| `unstarted` | request; spawn succeeds | — (request posted immediately; messages queue until the worker listens) | `starting` |
| `starting` | `ready` message | — | `busy` |
| `starting` | `error` / `exit` / `messageerror` | `could_not_start`, unless a stop is aborted (D5) | `closed` |
| `starting` or `busy` | a stop signal aborts | `stopped` with the winning reason | `closed` |
| `starting` | any non-`ready` message | `stopped_unexpectedly`, unless a stop is aborted | `closed` |
| `busy` | `result` message with matching `seq` that passes validation | `result` | `idle` |
| `busy` | `result` that fails validation, wrong `seq`, or unknown message type | `stopped_unexpectedly`, unless a stop is aborted | `closed` |
| `busy` | `error` / `exit` / `messageerror` | `stopped_unexpectedly`, unless a stop is aborted | `closed` |
| `idle` | request with a stop already aborted | `stopped` — nothing posted | `closed` |
| `idle` | request | — (posted with the next `seq`) | `busy` |
| `idle` | `error` / `exit` / any message | — (no request in flight) | `dead` |
| `dead` or `closed` | request | `stopped_unexpectedly` (no throw) | `closed` |
| `starting` / `busy` | a second request while one is in flight | the second request gets `stopped_unexpectedly`; the first is unaffected | unchanged |
| any | `close()` | an in-flight request (none in normal use) settles `stopped_unexpectedly` | `closed` |

Entering `closed` from a state with a live worker (by a stop, an isolation
failure, or `close()`) calls `worker.terminate()` once (not awaited), removes
the session's listeners from the stop signals and its `message` /
`messageerror` listeners from the worker, and keeps the worker's `exit` and
`error` listeners attached until the worker's `exit` (concurrent-event-source
addendum, **Listener and resource cleanup**). The live-worker counter (D15) is
incremented on successful spawn and decremented once, on the worker's `exit`
event.

---

## Verification Log

All commands run at repository revision `9f71835` (plan branch base) on
2026-11-12 unless stated otherwise.

| # | Check | Command / query | Result |
| --- | --- | --- | --- |
| V1 | Repo revision | `git rev-parse --short HEAD` | `9f71835` |
| V2 | No worker-thread code exists yet (Rule 4) | `grep -rn "worker_threads\|new Worker" src tests` | No matches |
| V3 | Consumers of `identifyCandidates` (Rule 5) | `grep -rln "identifyCandidates(" src tests` | `src/core/run-review-pass.ts`, `src/cli/recall-benchmark.ts`, `src/review/symbol-resolver.ts` (definition), `tests/unit/review/symbol-resolver.test.ts` |
| V4 | Consumers of `resolveSymbols` (Rule 5) | `grep -rln "resolveSymbols(" src tests` | Same four files as V3 |
| V5 | Constructors of `ReviewPassDeps` outside tests (Rule 5) | `grep -rln "runReviewPass(" src` | `src/cli/review-pr.ts`, `src/cli/control-pass.ts`, `src/webhook/webhook-job.ts`, plus the definition in `src/core/run-review-pass.ts` |
| V6 | Emit sites of `repository_context_phase_failed` (Rule 3/4) | `grep -rn "repository_context_phase_failed" src tests docs` | One: `src/core/run-review-pass.ts` (the phase `catch`) |
| V7 | CI and Action runtime | `grep -n "node-version\|npm ci\|npm run" .github/workflows/node-ci.yml .github/workflows/ronda-review.yml`; `package.json` scripts | Both workflows use Node `"20"` and `npm ci`; `node-ci.yml` runs `npm test` (`tsx --test`); the reusable workflow runs `npm run review` (`tsx src/cli/review-pr.ts`); `npm run webhook` is `tsx src/webhook/webhook-server.ts`; `tsx` is pinned `4.23.13` (devDependency), `typescript` `5.8.3` (dependency) |
| V8 | Loader propagation spike (scratch files outside the repo, importing this repo's `src/review/symbol-resolver.ts`) | A `.ts` main started a `Worker` on a `.ts` entry with (a) default inherited `execArgv`, (b) `execArgv: ["--import", <tsx esm loader URL>]`, (c) a `.mjs` bootstrap calling `register()` from `tsx/esm/api` then importing the `.ts` entry; run with `node_modules/.bin/tsx` on Node 22.15.0 and Node 20.20.2 | (a) and (b) fail on both versions with "Unknown file extension .ts"; (c) resolves a candidate on both. `process.execArgv` under tsx is `--require <tsx>/preflight.cjs --import <tsx>/loader.mjs`. (c) also passes as a `node:test` test under `tsx --test` on both versions |
| V9 | Termination and responsiveness spike (same scratch setup, bootstrap (c)) | Worker busy-looping for 20 s, `terminate()` called at 1.8 s, 20 ms main-thread timers scheduled throughout; `env: {}` variant; missing-entry variant | `terminate()` resolved in 5.0–6.0 ms (5 runs, Node 22 and 20); maximum main-thread timer lateness 2.3–4.9 ms; worker `ready` after 410–430 ms; candidate resolved with `env: {}`; `TS_LIB_DIR` inside the worker is Ronda's `node_modules/typescript/lib`; a missing entry module produces an `error` event (`ERR_MODULE_NOT_FOUND`, message contains a local path) before any `ready` message |
| V10 | Tests that run the repository-context phase today | `grep -rln 'repositoryContextMode: "on"' tests` | `tests/integration/core/review-pass-repository-context.test.ts`, `tests/integration/core/repository-context-hostile-head.test.ts`, `tests/unit/core/run-review-pass-path-exclusion-doc-reads.test.ts` |
| V11 | Webhook job does not pass its signal into the pass today | `grep -n "runReviewPass(job" -A9 src/webhook/webhook-job.ts` | The deps object passes `github`, `model`, `config`, `clock`, `logger`, `detailsUrl`, `onReviewPublished` — no signal |
| V12 | AC4 structural scan list (#106) | `grep -n "filesToScan" -A6 tests/integration/core/repository-context-hostile-head.test.ts` | Scans `symbol-resolver.ts`, `repository-context.ts`, `run-review-pass.ts`, `repo-content-reader.ts` for `node:child_process`, `exec*`, `new Function(`, `eval(` |
| V13 | Uninterruptible-compile wording to retire (AC11) | `grep -rn -i -E "uninterrupt\|synchronous\|interrupted\|worker" src/review/symbol-resolver.ts`; same pattern over `src/core/run-review-pass.ts`, `docs/` | `symbol-resolver.ts` module comment on the size caps, the `MAX_CHANGED_FILE_CHARS` comment, the comment inside `identifyCandidates` above the size check, the `TraceContext` comment; `run-review-pass.ts` comments above the `contextDeadline.expired()` check and on `timeUsedMs`; `docs/testing/ronda/repository-context-read-only-evidence-106.md` "Disclosed residual risk" section |
| V14 | Same-surface open PRs (operational assumption check) | `gh pr list --state open --limit 50` at 2026-11-12T10:43Z | No open pull requests |
| V15 | Design assets | Issue #131 body has no `## Design assets` section; no `assets/` directory in this development folder | None — the runbook has no fidelity step |

---

## Factual claim evidence

**Rule 5 — consumers and their outcome after the change** (search: V3, V4,
V5, V6 at `9f71835`; places searched: `src/` and `tests/`, which is where
every importer of these modules lives):

| Changed unit | Consumer | Outcome after the change |
| --- | --- | --- |
| `identifyCandidates` (D10) | `src/core/run-review-pass.ts` | No longer called; the phase calls `readChangedSourceTexts`, then the session's `findCandidates`, which runs `findCandidatesInSources` in the worker |
| `identifyCandidates` | `src/cli/recall-benchmark.ts` | Unchanged call; identical results (composition of the same two halves, in-line, D11) |
| `identifyCandidates` | `tests/unit/review/symbol-resolver.test.ts` | Unchanged calls and assertions; they pass without edits |
| `resolveSymbols` | `src/core/run-review-pass.ts` | No longer called; the session's `resolveCandidates` runs it in the worker |
| `resolveSymbols` | `src/cli/recall-benchmark.ts`, resolver unit tests | Unchanged |
| `ReviewPassDeps` (D13, D15) | `src/cli/review-pr.ts`, `src/cli/control-pass.ts` | Unchanged call sites; both new fields optional; the default worker session applies |
| `ReviewPassDeps` | `src/webhook/webhook-job.ts` | Passes `jobAbortSignal: signal` |
| Repository-context phase | Its one caller in `runReviewPass` | Same return shape; records per **Stop and failure outcomes** |
| `repository_context_phase_failed` | The phase `catch` (V6) | Still the only emitter; for isolation failures it carries D12's fixed text |

**Rule 6 — scoped obligations**:

- "Older tests whose budget is below a realistic worker compile time switch to
  the in-line test session": governs only tests in the V10 files whose
  configured `repositoryContextTimeBudgetMs` or `passTimeoutMs` is smaller than
  the time a real worker needs to start and compile, **and** whose subject is
  not isolation. Known member at `9f71835`: "a slow changed-file read during
  identification never consumes the context time budget" (60 ms budget,
  expects `used`). Discharged in Implementation Order step 3, by running the
  three V10 files on the real worker and converting only the tests that fail
  for this reason. Assertions are never weakened.
- "The context deadline is labelled `pass_deadline` when the remaining pass
  time was the lesser or equal bound" (D6): governs the resolving phase of
  every pass with repository context on; discharged where `timeBudgetMs` is
  computed in the phase.
- "Every worker a pass starts is ended when the pass settles": governs every
  exit from the repository-context phase (return and throw); discharged by the
  phase's `finally`, which calls `session.close()`.

---

## Cross-Cutting Operational Assumption Check

### Applicable

| Assumption surface | Recorded value | Authoritative source | Verified at | Bounded cross-check scope | Result |
| --- | --- | --- | --- | --- | --- |
| Approved base / artifact owner | `develop`, this repository (`single_repo`) | `.ai-dev-workflow.yaml` (no `mode`), parent dispatch, nested-artifact guard `pre-create` (clean) | 2026-11-12, `9f71835` | Current invocation (#131 only); open PRs: none (V14) | `Verified` |
| Runtime and launcher on every ingress | Node 20 on CI and the reusable workflow; `npm ci`; `tsx` 4.23.13 launches `review`, `webhook`, and `npm test` | V7 | 2026-11-12, `9f71835` | Open PRs touching `package.json`, `package-lock.json`, `node-ci.yml`, `ronda-review.yml`: none (V14) | `Verified` |
| Repository-context switch state | Off; this item does not change it | Spec Out of Scope; `docs/project/3-software-architecture.md` repository-context entry | 2026-11-12, `9f71835` | Open PRs: none (V14) | `Verified` |

Implementation start re-checks these three rows; any change stops the work
before file edits (`Stale or conflicting`).

---

## Layer-by-Layer Changes

### Backend / API

- [ ] `src/review/symbol-resolver.ts` — D10 split:
  `readChangedSourceTexts` (exported, the existing loop and caps from the top
  of `identifyCandidates`, returning `changedSourceTexts`,
  `unreadableChangedFilePaths`, `contentRequestCount`) and
  `findCandidatesInSources` (exported, the existing program/checker/walk,
  returning `requested` and `nonRepositoryReferencesSkipped`; type
  `FindCandidatesResult`). `identifyCandidates` composes them; when no source
  text was read it still returns before any compile, as today. Retire the
  V13 "cannot be interrupted" wording (see **Documentation Updates**). **AC6,
  AC11**
- [ ] `src/review/repository-context-compiler.ts` (new, main thread):
  - Types: `CompilerPhase` (`"finding_candidates" | "resolving_candidates"`),
    `CompilerStopReason` (`"watchdog_abort" | "pass_deadline" |
    "context_time_budget"`), `CompilerIsolationFailure`
    (`"could_not_start" | "stopped_unexpectedly"`), `CompileStopBound`
    (`{ reason, signal }`), `CompileOutcome<T>`, `FindCandidatesInput`,
    `ResolveCandidatesInput`, `RepositoryContextCompilerSession`
    (`findCandidates`, `resolveCandidates`, `close`),
    `RepositoryContextCompilerFactory`.
  - `REPOSITORY_CONTEXT_COMPILE_STOP_GRACE_MS` (D3).
  - `decideCompileOutcome` (D5), pure and exported.
  - Result validators, exported for tests: `isFindCandidatesResult(value,
    input)` (object with a `requested` array whose entries have a unique
    integer `id`, `kind === "definition"`, string `symbolName`, a
    `changedPath` that is a key of the input's `changedSourceTexts`, positive
    integer `changedLine`, non-negative integer `anchorPos`, optional string
    `specifierKey`; and a non-negative integer
    `nonRepositoryReferencesSkipped`) and `isResolutionList(value, input)`
    (an array with exactly one entry per requested `id`, each either
    `{ id, path, line, endLine, text }` with `path` a key of the input
    `fileSet` and integer lines, or `{ id, reason }` with `reason` one of
    `time_budget`, `read_failed`, `ambiguous_resolution`).
  - `createWorkerCompilerSession(options?)` implementing the
    **Compiler session lifecycle** table, with D2's bootstrap, D8's worker
    options, and D15's `entryUrl` / `workerData` / `spawn` overrides.
    Messages: main to worker `{ type: "find" | "resolve", seq, input }`;
    worker to main `{ type: "ready" }` once, then `{ type: "result", seq,
    value }`. Only the three bookkeeping sets of `BuildSourceFileSetResult`
    are sent, not the whole object.
  - `RepositoryContextIsolationError` (D12).
  - `activeRepositoryContextCompilerWorkerCount()` (D15, tests only).
  **AC1, AC2, AC3, AC4, AC5, AC7, AC9, AC12**
- [ ] `src/review/repository-context-compiler-worker.ts` (new, worker entry):
  on `find`, post `findCandidatesInSources(...)`; on `resolve`, post
  `resolveSymbols(...)`; nothing else. No logging, no `node:fs`, no network.
  An exception thrown by the resolver is left uncaught, so it reaches the
  session as an `error` event (`stopped_unexpectedly`). **AC6, AC9**
- [ ] `src/review/repository-context-compiler-bootstrap.mjs` (new): D2's
  bootstrap — imports `parentPort` and `workerData`, registers tsx, imports
  `workerData.entryUrl`, posts `{ type: "ready" }`. **AC9**
- [ ] `src/domain/review-pass.types.ts` — `ReviewPassDeps.jobAbortSignal`
  (D13) and `ReviewPassDeps.createRepositoryContextCompiler` (D15), both
  optional, with doc comments in the style of `deadlineClock`. **AC7**
- [ ] `src/core/run-review-pass.ts` — the repository-context phase:
  1. Reads with `readChangedSourceTexts` under the pass deadline (unchanged
     reads).
  2. When at least one source text was read, creates the session with
     `deps.createRepositoryContextCompiler ?? createWorkerCompilerSession`
     (D1) and calls `findCandidates` with D6's finding bounds.
  3. Computes `remainingPassMs` and `timeBudgetMs` as today, arms
     `contextDeadline`, labels it per D6, runs `buildSourceFileSet` as today,
     then calls `resolveCandidates` with D6's resolving bounds.
  4. Maps each outcome per **Stop and failure outcomes**, emitting the new
     events with only `phase` and `stoppedBy` fields (AC10), and keeps the
     existing `contextDeadline.expired()` downgrade as a second guard on a
     returned result.
  5. `finally`: `session?.close()` and `contextDeadline?.dispose()`.
  Pass `deps.jobAbortSignal` into the phase. Rewrite the comments V13 lists.
  **AC1, AC2, AC4, AC5, AC7, AC8, AC10, AC11, AC12**
- [ ] `src/webhook/webhook-job.ts` — pass `jobAbortSignal: signal` into the
  `runReviewPass` deps (D13). Add an optional trailing options argument
  `{ runPass?: typeof runReviewPass }` (default `runReviewPass`) so a unit test
  can observe the deps without a real installation token. **AC7**
- [ ] `src/cli/recall-benchmark.ts` — no change (D11).

### Infrastructure / Configuration

- [ ] None. No new configuration, secret, environment variable, dependency,
  workflow, or Action change (D7).

---

## Testing Strategy

**Test types**: unit (session, decision function, validators, resolver
split), integration (review pass end to end with fakes for GitHub and the
model), webhook unit tests, and real-worker tests that run under `npm test`
on CI through `npm test` (V7).

**New test support files**:

- `tests/fixtures/repository-context/compiler-worker/controllable-compiler-worker.ts`
  — a worker entry speaking the same message protocol, loaded through the
  production bootstrap. `workerData` selects, per phase, one of: answer
  normally (by calling the real `findCandidatesInSources` / `resolveSymbols`),
  busy-loop for a given time before answering, exit the thread mid-request,
  post a malformed result, or post a result with the wrong `seq`.
- `tests/support/scripted-compiler-session.ts` — an in-process fake session
  whose requests wait on the stop signals and settle through the real
  `decideCompileOutcome`, optionally racing a scripted isolation failure or
  result; used for pass-level precedence cases that need exact event
  ordering.
- `tests/support/inline-compiler-session.ts` — a test-only session that calls
  `findCandidatesInSources` / `resolveSymbols` in-line; used only under the
  Rule 6 scope in **Factual claim evidence**.

**Key scenarios** (indicative unless marked; each names its AC):

1. **AC1** — pass level, real controllable worker slow on `resolve`, context
   budget small, pass deadline large: the stop event (`context_time_budget`)
   and worker exit both land within D3's grace of the context timer firing
   (timer fire time captured through an injected keep-alive deadline clock);
   record `unavailable`, every requested reference `time_budget`; exactly one
   review published; result `succeeded`.
2. **AC2** — pass level, real controllable worker slow on `find`, small pass
   deadline: stop event `pass_deadline` within the grace of the deadline
   firing; signal-honoring fake model; result `failed` / `timed_out`;
   `repository_context_pass_record` logged per the finding row of
   **Stop and failure outcomes**; no `unhandledRejection` /
   `uncaughtException` observed during the test.
3. **AC3** — session level, real worker busy for D4's compile duration: main-thread
   timers scheduled during the compile fire within D4's bound. Webhook level
   (`tests/unit/webhook/webhook-server.test.ts`): a `runJob` that runs a slow
   real-worker compile; a second signed delivery posted meanwhile gets `202`
   with `queued: true` before the compile ends.
4. **AC4** — session and pass level: `entryUrl` pointing at a module that does
   not exist (real worker, `could_not_start`) during finding, and a `spawn`
   override that throws; record per the table; start-failed event; review
   published; no unhandled error.
5. **AC5** — real controllable worker exiting mid-`resolve`, and one posting a
   malformed result: `stopped_unexpectedly` event; every requested reference
   `read_failed`; review published; no unhandled error.
6. **AC6** — resolver unit test: on `tests/fixtures/repository-context/resolution/`
   the composition `readChangedSourceTexts` + `findCandidatesInSources` equals
   `identifyCandidates`; session test: the real production worker returns
   `requested`, `nonRepositoryReferencesSkipped`, and resolutions deep-equal
   to the in-line results on the same fixture. Pass level: the existing
   `review-pass-repository-context.test.ts` and
   `repository-context-hostile-head.test.ts` assertions pass on the real
   worker (subject to the Rule 6 scope above).
7. **AC7** — after each settle path (success, context-budget stop, isolation
   failure, supersede via a moved head SHA, watchdog abort through
   `deps.jobAbortSignal`), `activeRepositoryContextCompilerWorkerCount()`
   returns to 0 within D3's grace; for the watchdog case the stop event
   (`watchdog_abort`) lands within the grace of the abort and the result is
   `failed` / `timed_out` (D14). `webhook-job.test.ts`: the injected `runPass`
   receives `jobAbortSignal` identical to the job signal. Teardown race: the
   controllable worker throws after `close` and after an abort-driven stop but
   before its `exit`; no uncaught exception reaches the process, the settled
   outcome is unchanged, and the counter returns to 0.
8. **AC8** — a counting factory passed as `createRepositoryContextCompiler`
   is never called for: repository context off, a fork-originated head, a
   draft pull request, a pass that fails before review execution (missing
   credential), and a pass whose changed files include no eligible source.
9. **AC9** — session test with the default production entry: a real worker
   finds and resolves the `helper` candidate in a two-file caller/util set.
   It runs in `npm test`, which `node-ci.yml` already runs (V7), with no
   workflow change.
10. **AC10** — over the AC4, AC5, and stop scenarios, serialize every logged
    event and assert it contains none of: the fixture file texts, a planted
    credential string set as the model API key, the repository root path, the
    OS temp directory path, or `file://`. Also assert the
    `repository_context_phase_failed` message equals D12's fixed text.
11. **AC11** — documentation review step in the smoke runbook (no automated
    test; prose).
12. **AC12** — `decideCompileOutcome` unit table covering every pair of
    {no stop, each stop reason, two or three stops aborted} with {result
    valid, result malformed, each isolation failure}; session tests with a
    fake `spawn` for: result arriving after the stop signal (ignored),
    `exit` emitted in the same tick as the context abort (`time_budget`),
    wrong `seq`, unknown message type. Pass level with the scripted session:
    pass deadline and context budget both expired → `failed` / `timed_out`;
    context budget expired with a simultaneous crash → every requested
    reference `time_budget`; malformed result → AC5's record.

**Existing tests to keep green or adjust**:

- `tests/integration/core/repository-context-hostile-head.test.ts` — add
  `src/review/repository-context-compiler.ts`,
  `src/review/repository-context-compiler-worker.ts`, and
  `src/review/repository-context-compiler-bootstrap.mjs` to `filesToScan`
  (V12) so the read-only structural guarantee covers the new code. **Spec
  Business Rules → Read-only property unchanged**
- The three V10 files run on the real worker by default; apply the Rule 6
  conversion only where it is scoped.

**Coverage intent**: the projected tests cover four classes — (1) the pure
precedence and validation rules, exhaustively, because they are cheap and are
where a wrong order would silently change a record; (2) event ordering in the
session, with a fake worker, because real workers cannot produce same-tick
races on demand; (3) real-worker behavior (loading under tsx, termination,
crash, start failure, responsiveness, parity), one test per behavior, because
these are what CI must prove on its own runtime; (4) pass and webhook wiring,
one test per outcome row. None of the lists above is a binding enumeration;
a coverage-equivalent set is acceptable. Gate B self-check: the scaffolding
is roughly the size of the deliverable it protects; that is proportionate
because the deliverable is a concurrency and termination contract whose
failures would be silent (a late result used, a worker left running) and
whose real-runtime behavior cannot be checked any other way.

**Parser-risk addendum**: Not applicable — no file under a lint/parse tooling
path, no parser/scanner-named module, and no regex or structured-text scanning
is introduced. The result validators check a plain structured-clone object
from Ronda's own worker, not text.

### Concurrent-event-source addendum

This plan is concurrent-event-source: worker `message` / `error` / `exit` /
`messageerror` events, up to three abort signals, and the webhook server's own
timers and HTTP callbacks share the main thread with an in-flight compile.

- **Shared mutable state guards**: the only shared state is the session's
  private state (current state, in-flight request, `seq`) and the module-level
  live-worker counter. All of it is touched only on the main thread from event
  callbacks, which Node runs one at a time; no state is shared with the worker
  except through structured-clone messages (copies).
- **Re-entrancy / in-flight tracking**: at most one request is in flight per
  session (lifecycle table); a second concurrent request settles
  `stopped_unexpectedly` without disturbing the first. Each request carries a
  `seq`; a result with another `seq` is malformed. The phase awaits each
  compile before starting the next, so in normal use the guard never fires.
- **Event deduplication**: a request settles exactly once — a `settled` flag
  set by the first event, after which later events for that request (the
  `exit` that follows `terminate()`, a late `result`, a second abort) are
  ignored. The counter decrements on the first `exit` only.
- **Listener and resource cleanup**: on settle the session removes its abort
  listeners from every stop signal; on entering `closed` (a stop, an
  isolation failure, or `close`, which the phase's `finally` always calls) it
  removes its `message` and `messageerror` listeners,
  calls `terminate()` without awaiting, and keeps two listeners attached until
  the worker's `exit`: the one-shot `exit` listener that decrements the
  counter, and a no-op-after-settlement `error` listener. Termination is
  asynchronous, so an exception already pending in the worker can still emit
  `error` before `exit`; with no `error` listener Node would rethrow it and
  crash the process. The retained `error` listener only ignores the event (the
  request is already settled or the session is `closed`) and is removed by the
  `exit` handler together with itself. `contextDeadline.dispose()` stays in
  the same `finally`.
- **Race conditions at initialization**: a request posted before the worker
  has loaded is queued by Node and delivered once the entry listens; `ready`
  only marks the boundary between `could_not_start` and
  `stopped_unexpectedly`. A stop that fires during startup terminates the
  starting worker (still compiler work in flight, counted against the phase
  that started it). A stop already aborted when a request is made settles
  before anything is spawned or posted.
- **Race conditions at teardown**: after `terminate()`, the worker may still
  emit `exit` (handled by the counter listener), an `error` already pending
  (handled by the retained `error` listener and ignored), or, rarely, a message
  already in transit (ignored: no request in flight, session `closed`). A
  dedicated test makes the controllable worker throw after `close` (and after
  an abort-driven stop) but before `exit`, and asserts the process raises no
  uncaught exception, the outcome already settled is unchanged, and the
  live-worker counter returns to zero (AC5, AC7). Because a real worker
  cannot place the `error` between `close` and `exit` on demand, a fake-`spawn`
  session test also emits `error` after `close()` and before `exit`
  deterministically (AC12 class). The pass never waits for the exit (D3).
- **Error propagation across async boundaries**: worker errors arrive as
  `error` events and are converted into an outcome, never rethrown; the
  session's public methods resolve, never reject, and `new Worker(...)`
  throwing synchronously is caught. Isolation outcomes reach the existing
  phase `catch` only through D12's fixed-text error, which the phase already
  contains. No unhandled rejection or uncaught exception can come from the
  worker: an `error` listener is attached before the first message is posted
  and stays attached until the worker's `exit`, including after `close`.
- **New concurrent pattern**: worker threads are new to this codebase (V2).
  The pattern follows the existing abort-signal style (`createPassDeadline`,
  `AbortSignal.any`) rather than introducing a scheduler or pool.

---

## Seed Data

| Entity | Values / Scenario | File |
| --- | --- | --- |
| Resolution fixture (existing) | Parity between in-line and worker results (AC6) | `tests/fixtures/repository-context/resolution/` |
| Controllable worker entry (new) | Slow, crash, throw-after-close, malformed, wrong-`seq`, normal answers per phase (AC1–AC5, AC7, AC12) | `tests/fixtures/repository-context/compiler-worker/controllable-compiler-worker.ts` |
| Caller/util pair (existing inline constants) | Real-worker resolution (AC9) and pass-level runs | `tests/integration/core/review-pass-repository-context.test.ts` (`CALLER_TEXT`, `UTIL_TEXT`) — reuse the same text in the new tests |

No database or persisted data.

---

## Documentation Updates

- [ ] `docs/project/3-software-architecture.md` — the **Read-only repository
  context** entry: state that the compiler work (finding and resolving
  candidates) runs in a per-pass worker thread that the pass terminates at the
  bounding budget, the pass deadline, or a webhook watchdog abort; that worker
  start failures and crashes degrade to a failed repository-context phase; and
  that there is no in-line fallback in review passes. **AC11**
- [ ] `src/review/symbol-resolver.ts` comments (V13) — the size-cap module
  comment becomes "defence in depth, plus a time bound from worker
  isolation (#131)"; remove "cannot be interrupted" / "uninterruptible" claims
  about review passes; keep the note that the offline benchmark still compiles
  in-line. **AC11**
- [ ] `docs/testing/ronda/repository-context-read-only-evidence-106.md` — in
  "Disclosed residual risk", record that the residual risk is closed by #131
  (compiler work now stoppable at its budget), keeping the historical
  measurement as is. **AC11**
- [ ] `docs/project/2-repo-architecture.md` — add `repository-context-compiler`
  (and its worker entry) to the `review/` module list.
- [ ] `AGENTS.md` — Troubleshooting row: symptom "logs show
  `repository_context_compiler_start_failed`"; likely cause: dependencies
  installed without dev dependencies (so `tsx` is missing) or a Node version
  older than CI's (V7); fix: run `npm ci` on CI's Node version or later.
- [ ] `docs/testing/ronda/131-terminable-compiler-worker.smoke-test.md` —
  created in this plan PR; update during implementation with observed results.

---

## Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| A future `tsx` release changes `tsx/esm/api` or worker behavior | Low | Medium — every pass with repository context degrades to `could_not_start` | `tsx` is pinned exactly (V7); the AC9 real-worker test fails in CI on any such change before it reaches a pass |
| Worker startup (V9) lengthens passes with repository context on | High | Low | Counted honestly against the pass deadline (spec Business Rules); one start per pass (D1); default budgets are minutes |
| Timing assertions flake on loaded CI runners | Medium | Medium | D3 and D4 margins are about 40 times the measured values; stop tests measure from the recorded timer fire time, not from test start; slow-compile fixtures run for seconds, not milliseconds |
| Older timing-sensitive tests start failing on the real worker | Medium | Low | Rule 6 scoped conversion to the in-line test session; assertions unchanged |
| Worker error text or stderr leaks a local path or file text into logs | Low | Medium | D8 (streams discarded), D12 (fixed-text error), AC10 test over all failure scenarios |
| Credentials visible to the worker | Low | Medium | D8 `env: {}` |
| Extra memory for a second TypeScript instance per pass | Medium | Low | The worker is terminated when the phase settles (lifecycle table); memory bounding is out of scope |

---

## Code Samples

```ts
// Illustrative — adapt during implementation.
export function decideCompileOutcome<T>(
  stops: readonly CompileStopBound[],
  event:
    | { kind: "stop" }
    | { kind: "failure"; failure: CompilerIsolationFailure }
    | { kind: "message"; value: unknown; isValid: (value: unknown) => value is T },
): CompileOutcome<T> {
  const winningStop = stops.find((stop) => stop.signal.aborted);
  if (winningStop) return { kind: "stopped", reason: winningStop.reason };
  if (event.kind === "failure") return { kind: "isolation_failed", failure: event.failure };
  if (event.kind === "message" && event.isValid(event.value)) return { kind: "result", value: event.value };
  return { kind: "isolation_failed", failure: "stopped_unexpectedly" };
}
```

```js
// Illustrative — adapt during implementation (repository-context-compiler-bootstrap.mjs).
import { parentPort, workerData } from "node:worker_threads";
import { register } from "tsx/esm/api";

register();
await import(workerData.entryUrl);
parentPort.postMessage({ type: "ready" });
```

---

## Implementation Order

Commit after each step that leaves the suite green.

1. **Resolver split** — `symbol-resolver.ts` per D10; add the AC6
   composition-parity unit test. Run `npm test` and confirm the existing
   resolver tests pass without edits.
2. **Compiler session** — add the compiler module, worker entry, bootstrap,
   the controllable fixture worker, and
   `tests/unit/review/repository-context-compiler.test.ts` (D5 table, validators,
   lifecycle with a fake `spawn`, real-worker AC3/AC4/AC5/AC6/AC9 cases).
   Run the file under `npx tsx --test` on the local Node and, if available,
   on CI's Node version (V7).
3. **Pass wiring** — `review-pass.types.ts` fields; the phase rewrite in
   `run-review-pass.ts`; the scripted and in-line test sessions;
   `tests/integration/core/review-pass-compiler-isolation.test.ts` (AC1, AC2,
   AC4, AC5, AC7, AC8, AC10, AC12); extend the hostile-head `filesToScan`;
   run the V10 files on the real worker and apply the Rule 6 conversion where
   it is scoped.
4. **Webhook wiring** — `webhook-job.ts` (D13, `runPass` option) with its
   unit test; the AC3 delivery-during-compile test in `webhook-server.test.ts`.
5. **Docs** — every item in **Documentation Updates**, and update the smoke
   runbook with observed results.
6. **Changelog fragment** — create `changelog.d/131.changed.terminable-compiler-worker.md`
   with exactly:

   ```markdown
   - **Repository-context compiles stop at their budget** (#131): the TypeScript compiler work behind read-only repository context now runs in a per-pass worker thread that the review pass terminates as soon as the context time budget, the pass deadline, or the webhook watchdog runs out, so a slow compile no longer freezes the webhook server. A worker that cannot start or crashes degrades the pass to "repository context unavailable" instead of failing it. No budget, default, outcome, prompt, or model change.
   ```

7. **Full verification** — `npm run typecheck`, `npm run lint`, `npm test`,
   and the markdown lint commands from `AGENTS.md`. Before readiness, confirm
   with `grep -rn "identifyCandidates(\|resolveSymbols(" src` that the only
   in-line callers left are `src/cli/recall-benchmark.ts` and the definitions
   (D11), and that `git diff --stat origin/develop` lists no file under
   `.github/` and no `package.json` / `package-lock.json` change (D7).
