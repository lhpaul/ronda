# Smoke Test Runbook: Terminable Repository-Context Compiler Work

**Feature**: Terminable repository-context compiler work (#131)
**Spec**: [`../../specs/developments/20261112070736_131-terminable-compiler-worker/1_131-terminable-compiler-worker_specs.md`](../../specs/developments/20261112070736_131-terminable-compiler-worker/1_131-terminable-compiler-worker_specs.md)
**Implementation plan**: [`../../specs/developments/20261112070736_131-terminable-compiler-worker/2_131-terminable-compiler-worker_implementation-plan.md`](../../specs/developments/20261112070736_131-terminable-compiler-worker/2_131-terminable-compiler-worker_implementation-plan.md)
**Created in**: Plan Ready stage
**Updated in**: In Development stage

---

## Prerequisites

Before running this smoke test:

- [ ] `npm ci` has been run in the repository root (dev dependencies included).
- [ ] Node 20 or later is active (`node --version`). Node 20 is what CI uses.
- [ ] For Step 5 only: `GITHUB_TOKEN` and `RONDA_MODEL_API_KEY` are set, and a
      scratch same-repository pull request exists with a changed TypeScript
      line that calls a symbol defined in another file. Step 5 is a live run
      with a model credential, so a human runs it; agents skip it and record
      "skipped — human step".

No design assets exist for this item (the issue body has no `## Design
assets` section and the development folder has no `assets/` directory), so
this runbook contains no design-fidelity step.

---

## Test Data

| Item | Value |
| --- | --- |
| Resolution fixture | `tests/fixtures/repository-context/resolution/` |
| Controllable worker fixture | `tests/fixtures/repository-context/compiler-worker/controllable-compiler-worker.ts` |
| Session tests | `tests/unit/review/repository-context-compiler.test.ts` |
| Pass-level tests | `tests/integration/core/review-pass-compiler-isolation.test.ts` |
| Switch for a local run | `RONDA_REPOSITORY_CONTEXT=on` in the shell environment only — never the repository variable |

---

## Smoke Test Steps

### Step 1: The real worker loads and resolves under the CI runtime

**Maps to**: AC9, AC6

1. Run `npx tsx --test tests/unit/review/repository-context-compiler.test.ts`.
2. Run `npx tsx --test tests/unit/review/symbol-resolver.test.ts`.

**Expected result**: Both files pass. The real-worker test resolves the
`helper` candidate through the production worker entry, and the parity test
shows the worker's candidates and resolutions equal the in-line results on
the resolution fixture.

### Step 2: A slow compile is stopped at its budget and the process stays responsive

**Maps to**: AC1, AC2, AC3, AC12

1. Run `npx tsx --test tests/integration/core/review-pass-compiler-isolation.test.ts`.
2. In the output, find the context-budget stop, pass-deadline stop, and
   stop-precedence cases.

**Expected result**: All cases pass. The context-budget case publishes one
review with every requested reference dropped `time_budget`; the
pass-deadline cases end `failed` with reason `timed_out`; the stop of each
compile and the worker's exit land within the grace the plan names (D3); the
timer-lateness case stays within the plan's bound (D4).

### Step 3: Isolation failures degrade, never fail, and leak nothing

**Maps to**: AC4, AC5, AC10

1. In the Step 2 output, find the could-not-start, crash, and malformed-result
   cases.

**Expected result**: Each publishes its review with repository context
`unavailable`, emits the matching isolation log event, and raises no
unhandled error. The log-content case passes: no file text, credential, or
local path appears in any event, and `repository_context_phase_failed` carries
only the fixed message.

### Step 4: Nothing is left behind, and disabled passes start nothing

**Maps to**: AC7, AC8

1. In the Step 2 output, find the cleanup cases (success, budget stop,
   isolation failure, supersede, watchdog abort) and the no-start cases (off,
   fork, draft, pre-review failure, no eligible source).
2. Run `npx tsx --test tests/unit/webhook/webhook-job.test.ts tests/unit/webhook/webhook-server.test.ts`.

**Expected result**: Every cleanup case ends with no live worker; the
watchdog case stops the compile within the grace measured from the abort. No
no-start case creates a compiler session. The webhook tests pass, including
the job-signal wiring and a second delivery acknowledged with `202` while a
compile runs.

### Step 5: Live local pass (human only)

**Maps to**: AC6 (ordinary passes unchanged), AC9 (local ingress)

1. With the prerequisites for this step in place, run
   `RONDA_REPOSITORY_CONTEXT=on npm run review` against the scratch pull
   request (see `docs/adoption/ronda-review-adoption.md` for the environment
   a local run needs).
2. Read the `repository_context_pass_record` log line.

**Expected result**: The pass succeeds; the record shows `used` or
`partial` with the expected candidate; no `repository_context_compile_stopped`,
`repository_context_compiler_start_failed`, or
`repository_context_compiler_stopped_unexpectedly` event appears.

### Step 6: Documentation

**Maps to**: AC11

1. Read the read-only repository context entry in
   `docs/project/3-software-architecture.md`.
2. Read the size-cap comments in `src/review/symbol-resolver.ts`.
3. Read "Disclosed residual risk" in
   `docs/testing/ronda/repository-context-read-only-evidence-106.md`.

**Expected result**: The architecture entry says the compiler work runs in an
isolated worker the pass can stop at its budget; the resolver comments no
longer call the review-pass compile uninterruptible; the evidence document
records the residual risk as closed by #131.

### Observed Results (In Development, 2026-11-12)

Run by the implementing agent on the feature branch, Node 22.15.0 (and the
session and pass-level files also three times each on Node 20.20.2, CI's
version).

| Step | Result | Evidence |
| --- | --- | --- |
| 1 | PASS | `repository-context-compiler.test.ts` 42/42 (real production worker resolves `helper`; parity with in-line results on the resolution fixture); `symbol-resolver.test.ts` 47/47 |
| 2 | PASS | `review-pass-compiler-isolation.test.ts` 16/16: context-budget stop publishes with every reference `time_budget`; finding and resolving pass-deadline cases end `failed` / `timed_out`; stop event and worker exit within 250 ms (D3); worst timer lateness within 200 ms (D4) |
| 3 | PASS | Could-not-start (missing entry, throwing spawn), crash, and malformed-result cases publish with `unavailable` and the matching event; the log-content check finds no file text, credential, repository path, temp path, or `file://` |
| 4 | PASS | Cleanup cases (success, budget stop, isolation failure, supersede, watchdog abort) end with no live worker; no-start cases create no session; webhook tests 59/59, including the job-signal wiring and a second delivery acknowledged `202` with `queued: true` while a real worker compiles |
| 5 | Skipped — human step | Live run with a model credential |
| 6 | PASS | Architecture entry, resolver comments, and the evidence document's residual-risk section updated |

### Last Step: Validate

- [ ] `npm run typecheck`, `npm run lint`, and `npm test` pass.
- [ ] `git diff --stat origin/develop` shows no change under `.github/` and no
      change to `package.json` or `package-lock.json`.
- [ ] Every step above is PASS, or Step 5 is recorded "skipped — human step".
