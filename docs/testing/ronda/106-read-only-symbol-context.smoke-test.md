# Smoke Test Runbook: Read-Only Repository Context With Symbol-Level Resolution

**Feature**: Read-only repository context with symbol-level resolution (#106)
**Spec**: [`../../specs/developments/20260929133804_106-read-only-symbol-context/1_106-read-only-symbol-context_specs.md`](../../specs/developments/20260929133804_106-read-only-symbol-context/1_106-read-only-symbol-context_specs.md)
**Implementation plan**: [`../../specs/developments/20260929133804_106-read-only-symbol-context/2_106-read-only-symbol-context_implementation-plan.md`](../../specs/developments/20260929133804_106-read-only-symbol-context/2_106-read-only-symbol-context_implementation-plan.md)
**Created in**: Plan Ready stage
**Updated in**: In Development stage

---

## Prerequisites

Before running this smoke test:

- [ ] `npm ci` has been run in the repository root.
- [ ] `RONDA_MODEL_API_KEY` is set for every step that reaches a model call (steps 3 onwards). Steps that only check configuration resolution can run without it.
- [ ] `GITHUB_TOKEN` is set with `pull-requests: write` and `checks: write` on the repository used for the live steps.
- [ ] The amendment is recorded in **both** `docs/project/3-software-architecture.md` and `docs/constitution.md` (step 1 of the implementation order). If it is not, stop: no other step is valid.
- [ ] A scratch pull request exists on this repository with at least one changed TypeScript file whose changed lines call a symbol defined in another file. (A symbol *called from* elsewhere is no longer needed: call sites are out of scope for this iteration by owner amendment of 2026-09-29, and are follow-up #129.)
- [ ] A fork-originated pull request is reachable for step 7. If none exists, open one from a fork of this repository.

No design assets exist for this item (the issue body has no `## Design assets` section and the development folder has no `assets/` directory), so this runbook contains no design-fidelity step.

---

## Test Data

| Item | Value |
| --- | --- |
| Same-repository pull request | `[PR number with a TypeScript change]` |
| Fork-originated pull request | `[PR number whose head belongs to a fork]` |
| Documentation-only pull request | `[PR number changing only .md files]` |
| Resolution fixture | `tests/fixtures/repository-context/resolution/` |
| Hostile-head fixture | `tests/fixtures/repository-context/hostile-head/` |
| Repository variable | `RONDA_REPOSITORY_CONTEXT` (repository settings → Variables) |
| Switch environment name | `RONDA_REPOSITORY_CONTEXT` |
| Budget environment names | `RONDA_MAX_REPOSITORY_CONTEXT_CANDIDATES`, `RONDA_MAX_REPOSITORY_CONTEXT_CHARS`, `RONDA_REPOSITORY_CONTEXT_TIME_BUDGET_MS` |

---

## Smoke Test Steps

### Step 0: Confirm the amendment is recorded

**Maps to**: AC1, AC2

1. Read the **Key Architectural Decisions** section of `docs/project/3-software-architecture.md`.
2. Read the **Surface** section of `docs/constitution.md`.

**Expected result**: The architecture document carries the replacement decision, recorded as accepted with changes, attributed to the repository owner, dated 2026-09-29, referencing #106, naming which of the two bundled commitments it keeps and which it changes. The constitution carries the replacement invariant. Both texts hold AC2's three substantive commitments: reads only with the mechanism left open, the reviewed repository's code never executed, fork-originated heads excluded.

### Step 1: Feature absent-by-default — a validly disabled pass is indistinguishable

**Maps to**: AC19, AC21

1. With `RONDA_REPOSITORY_CONTEXT` unset and no `repositoryContext` key in the operator config file, run a pass on the same-repository pull request.
2. Read the published review body, the check-run output, and the log lines for the pass.
3. Repeat with `RONDA_REPOSITORY_CONTEXT=off`, then with `RONDA_REPOSITORY_CONTEXT="   "`.

**Expected result**: In all three runs the review body carries no repository-context line, the check-run output carries no repository-context record or budget figure, and the logs carry no repository-context event. The three runs are indistinguishable from each other and from a version without the feature.

### Step 2: Unrecognized switch value is recorded, and is not replaced by a lower source

**Maps to**: AC21, AC19

1. Set `RONDA_REPOSITORY_CONTEXT=maybe` and put `"repositoryContext": "on"` in the operator config file. Run a pass on the same-repository pull request.
2. Read the check-run output and the logs.
3. Set `RONDA_REPOSITORY_CONTEXT=` (empty) with the same file value, and run again.

**Expected result**: In run 1 repository context is **off** — the unrecognized higher-precedence value is effective and is not replaced by the recognized `on` below it — and both the check-run output and the logs record that a value was unrecognized **without** the string `maybe` appearing anywhere. In run 3 the empty value defers to the file, the switch is **on**, and the pass records a repository-context outcome.

### Step 3: Repository context used on a same-repository head

**Maps to**: AC3, AC20

1. With the switch on and the three budgets at their defaults, run a pass on the same-repository pull request.
2. Read the published review body.
3. Read the check-run output and the logs.
4. Run the same pass again on the same head and diff the two records.

**Expected result**: The review body carries exactly **one** repository-context line, stating that repository context was active and naming the outcome (`used` or `partial`), and **no** count, identifier, drop reason, or budget figure appears anywhere in the body. The check-run output and the logs each carry the outcome, the candidates requested, the candidates resolved, each drop with its reason, and the budget utilisation. The two runs' records name the same candidates in the same order.

### Step 4: Budgets bound the context and the diff never gives way

**Maps to**: AC6, AC7

1. Set `RONDA_MAX_REPOSITORY_CONTEXT_CANDIDATES=2` and run a pass on a pull request whose changed lines name more than two candidates.
2. Set `RONDA_MAX_REPOSITORY_CONTEXT_CHARS=200` and run again.
3. For each run, compare the changed-file patch text the pass sent with the text sent in step 1's disabled run.

**Expected result**: Run 1 retains the two highest-priority candidates, drops the rest with reason `candidate_count_budget`, and records `partial`. Run 2 drops every candidate whose excerpt exceeds the budget whole — never truncated mid-excerpt — and records `partial` or `unavailable` according to whether any candidate fit. In both runs the diff is present in full and identical to the disabled run's, and the review is published.

### Step 5: Nothing to resolve reads as the everyday case, not a failure

**Maps to**: AC3

1. With the switch on, run a pass on the documentation-only pull request.

**Expected result**: The outcome is `nothing_to_resolve`. The review body's one line names that outcome. The record states zero candidates requested. Nothing reads as a failure and the outcome is **not** `unavailable`.

### Step 6: Degradation on read failure and on an exhausted time budget

**Maps to**: AC8, AC11

1. Deny the reads for a pass (revoke `contents: read`, or point the client at an unreachable API host) and run a pass on the same-repository pull request. Note which reads were denied: denying the **candidate-target** reads while the changed files still read is what yields `unavailable`; a changed file that is merely **absent** is accounted for and does not, on its own, make a pass `unavailable`.
2. Set `RONDA_REPOSITORY_CONTEXT_TIME_BUDGET_MS=1` and run again.
3. Note each pass's elapsed time against the pass budget in effect and the job's own `timeout-minutes`.

**Expected result**: Both passes publish exactly one review for the head. Run 1 records `unavailable` with `read_failed` drops; run 2 records `unavailable` when the budget expired before the first candidate resolved, or `partial` when it expired part-way — in which case exactly the candidates resolved by then are retained, that being a prefix of the deterministic **read (discovery)** order rather than of the priority order, and the remainder carries `time_budget` drops (plan decision D5). The priority order governs only which *resolved* candidates the count and character budgets keep; it cannot govern the reads, because a candidate's own location is not known until its declaring file has been read. Neither pass fails, neither suppresses the review, and neither exceeds the pass deadline or the job backstop.

### Step 7: A fork-originated head reads no repository context, at the most permissive configuration

**Maps to**: AC10, AC19

1. Set the switch on and every budget to its largest value you are willing to run.
2. Trigger a pass on the fork-originated pull request through the webhook ingress.
3. Trigger a pass on the same pull request with a `/ronda review` comment on the reusable-workflow ingress.
4. Trigger an automatic `pull_request` run for the same fork head on the reusable-workflow ingress.

**Expected result**: In steps 2 and 3 the fork head receives exactly the review it receives today, with **no** repository-context line in the body, **no** repository-context record on the check-run output or in the logs, and no candidate resolved or source read beyond the pull request's own changed lines. In step 4 the pass is skipped before any repository content is read, unchanged from today. No configuration surface changes any of these outcomes.

### Step 8: Read-only property on a hostile head

**Maps to**: AC4, AC5, AC9

> The symlink and submodule cases rest on one seam: the contents reader refuses any entry whose `type` is not `file`, before decoding. Confirm the recorded evidence names that refusal, and confirm the pass requested **no** repository-wide listing — the plan reads single files only.

1. Open a pull request whose head carries `tests/fixtures/repository-context/hostile-head/`.
2. Confirm first that no `package.json` script and no workflow `paths:` list references that directory.
3. Run a pass on it with the switch on.
4. Inspect the logs, the pass record, the published review, and the filesystem of the host that ran the pass.

**Expected result**: Nothing from the reviewed repository was executed — no build, install, test, script, hook, or generated tooling. Nothing was written to the reviewed repository beyond the one review and its check run. The symlink pointing outside the repository was not followed and nothing outside the repository was read through it; the submodule reference was not fetched; the `.gitattributes` filter and diff drivers caused nothing to run. Per the plan's unreadable-and-refused-paths contract: a refused entry that was a **candidate target** appears as a `read_failed` drop, while one that was a **changed path** yields no candidate and therefore no drop — so a hostile head whose every changed path is refused records `nothing_to_resolve`, not a drop list. No working area was created on the host. The instruction-shaped source produced no action: the pass published exactly one review for the head, in the same JSON-derived shape, and took no action outside it.

### Step 9: Non-publishing control pass

**Maps to**: AC22

1. Pick a head that already carries exactly one published Ronda review plus its single check run.
2. Run `npm run quality:control-pass -- --pr <number> --repository-context <opposite arm>` against it. Both flags are required; a fork head is refused before any read.
3. Re-read the pull request's reviews, its check runs, and its comments.
4. Read the appended line in `docs/testing/ronda/repository-context-control-passes.jsonl` (or the `--out` path used).

**Expected result**: The head still has exactly one published review and one check run, both from the original pass. No comment was added. The control pass's result is present only in the evidence record, as one appended JSON line. The command's own write counter was zero, which is the mechanism the guarantee rests on. No trigger started the control pass.

### Step 10: No record survives a pre-review-execution end

**Maps to**: AC3, AC19

1. With the switch on, run a pass on a draft pull request.
2. Run an automatic pass on a head that already carries a `Ronda review` check run.

**Expected result**: Both passes end before review execution. Neither emits a repository-context record, activation line, or budget figure on any surface.

### Step 11: Resolution correctness and precision

**Maps to**: AC23

1. Run `npm test -- tests/unit/review/symbol-resolver.test.ts` (or the repository's equivalent single-file invocation).
2. Read `docs/testing/ronda/repository-context-resolution-precision-106.md`.

**Expected result**: Every edge case E1–E16 from the plan's parser-risk addendum has a passing test. The recorded precision on the resolution fixture is **100%**: every resolved candidate is the declaration or call site the TypeScript checker binds the reference to, and every reference that cannot be bound to exactly one declaration is dropped with the reason `ambiguous_resolution`. A figure below 100% is a defect to fix before step 15 of the
implementation order — the step that sets this repository's switch on — not a figure to
report.

### Step 12: Evidence, tiers and claims

**Maps to**: AC13, AC14, AC15, AC16, AC17, AC18

1. Read `docs/testing/ronda/repository-context-effect-evidence-106.md`.

**Expected result**: The document states, **before** any recall figure, whether the fixture target provides resolvable surrounding source for the symbols in its changed lines. It reports per-run recall for both arms overall and per target seed, the mean and population standard deviation of per-run recall, the paired precision result with its regression outcome, per-pass elapsed time and billed minutes for both arms, model calls per pass, candidates resolved, how many passes exhausted the context time budget, and how many hit the pass budget or the job backstop. It labels the comparative figures apart from the descriptive references (the committed 2026-09-23 baseline and the measured dogfood pass), states that the arms were interleaved under one immutable model version with equal run counts, carries the evidence-tier ledger with its counted pull requests and date, attaches the tier label, the independence caveat and the own-repository label to every claim, and states that the `guard-fails-open` movement already observed under the #105 sweep is not attributed to repository context.

### Step 13: Demonstrations come before the switch

**Maps to**: AC19

1. Read the commit dates of `docs/testing/ronda/repository-context-read-only-evidence-106.md` and `docs/testing/ronda/repository-context-resolution-precision-106.md`.
2. Read the recorded date and time of the `RONDA_REPOSITORY_CONTEXT` repository-variable change in the effect-evidence document, and the variable's current value in repository settings.

**Expected result**: The AC4, AC5 and AC23 evidence commits precede the repository-variable change. The variable is set to `on` for this repository, and a single change in repository settings turns it off again with no workflow edit and no redeploy.

### Step 14: No working area accumulates on the webhook ingress

**Maps to**: AC12

1. Run five consecutive passes through the webhook ingress.
2. Abort one pass mid-read (send the process the supersede/watchdog path, or kill the in-flight job).
3. Restart the webhook process so startup reconciliation runs.
4. Inspect the host for any temporary directory or file created for reviewed content.

**Expected result**: No working area was created by any pass, so none can outlive one, be shared between passes, or survive the abort — the guarantee is structural (plan decision D1). Concurrency is unchanged: one active review job and the existing bounded queue. The aborted pass published no second review for its head.

### Last Step: Validate and shut down

- Verify every assertion in the checklist below.
- Restore the switch and the three budgets to the values the repository should run with, and shut down the webhook process if it was started for this run.

---

## Assertions Checklist

- [ ] AC1 — the amendment is recorded in both `docs/project/3-software-architecture.md` and `docs/constitution.md` (step 0).
- [ ] AC2 — the recorded text holds all three substantive commitments (step 0).
- [ ] AC3 — outcome, counts and budget utilisation on the check-run output and the logs; one activation line and nothing more in the review body (steps 3, 5, 10).
- [ ] AC4 — hostile head executes nothing, writes nothing, and the three read-side attacks are refused (step 8).
- [ ] AC5 — instruction-shaped content produced exactly one review and no action outside it (step 8).
- [ ] AC6 — neither budget is exceeded; drops are whole, recorded, and follow the selection order (step 4).
- [ ] AC7 — the diff is present in full at every budget setting (step 4).
- [ ] AC8 — an exhausted time budget degrades and never extends the pass deadline or job backstop (step 6).
- [ ] AC9 — the output contract is unchanged and nothing outside the reviewed head's own repository was read (step 8).
- [ ] AC10 — a fork head reads no repository context on any ingress or trigger, at the most permissive configuration (step 7).
- [ ] AC11 — denied reads degrade and never suppress the review (step 6).
- [ ] AC12 — no working area exists to accumulate, and an aborted pass published no second review (step 14).
- [ ] AC13 — recall evidence with its admissibility statement first (step 12).
- [ ] AC14 — cost evidence on measured passes, comparative and descriptive figures labelled apart (step 12).
- [ ] AC15 — every comparative claim rests on paired, interleaved arms under one immutable model version with equal run counts (step 12).
- [ ] AC16 — paired precision evidence accompanies every recall claim (step 12).
- [ ] AC17 — the evidence-tier ledger and per-claim tier, independence and own-repository labels (step 12).
- [ ] AC18 — the `guard-fails-open` movement under the #105 sweep is not re-attributed (step 12).
- [ ] AC19 — off by default for adopters, on here, set only after the evidence, and a validly disabled pass is indistinguishable (steps 1, 13).
- [ ] AC20 — the same head and configuration select the same candidates in the same order, and the record explains every inclusion and exclusion (step 3).
- [ ] AC21 — switch and budget resolution over the two sources, fail-closed, with the unrecognized value recorded and no unlimited budget (steps 1, 2, 4).
- [ ] AC22 — the control pass publishes nothing to GitHub (step 9).
- [ ] AC23 — 100% resolution precision on the recorded fixture, with unbindable references dropped (step 11).

---

## Seed Data Reference

| Entity | Scenario | How to load |
| --- | --- | --- |
| Resolution fixture | Same-named methods on different types, a shadowed name, a re-export, an unbindable reference | Committed at `tests/fixtures/repository-context/resolution/`; used by `tests/unit/review/symbol-resolver.test.ts` |
| Hostile-head fixture | Executable-if-invoked content, symlink out of the repository, submodule reference, `.gitattributes` filter/driver, instruction-shaped source | Committed at `tests/fixtures/repository-context/hostile-head/`; push it as a pull-request head for step 8 |
| Benchmark surrounding source | The definitions of the three target seeds' changed-line symbols — no callers, since call sites are out of scope (owner amendment, 2026-09-29) | Committed at `tests/fixtures/recall-benchmark/repository-context/`; used by `npm run benchmark:quality -- --repository-context on` |

---

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Step 3 records `nothing_to_resolve` on a TypeScript change | The changed lines name no symbol declared in another file, or the changed file's extension is outside the plan's D4 language scope. Note that a symbol declared *and* used inside the changed hunk is not a candidate (E8) | Pick a pull request whose changed lines call a symbol defined in another file |
| Step 3 records `nothing_to_resolve` while `unreadableChangedFilePaths` is non-empty | A defect: that combination is forbidden — a transiently unreadable changed file must yield `used`, `partial` or `unavailable`, never a claim that the changed lines named nothing. A file refused by content type, absent, or unparseable is *accounted for* and does not populate that field | Report it against plan decision D5's identification rule |
| Step 3 records `unavailable` with `read_failed` drops | The token lacks `contents: read` at the reviewed head, or the tree read returned `truncated` | Confirm the token scope; a truncated tree is expected on a very large repository and is recorded, not an error |
| Step 9 exits non-zero with a usage message | `--pr` or `--repository-context` was omitted, or the head is fork-originated | Both flags are required by the control pass's invocation contract, and a fork head is refused because it reads no context on either arm |
| Step 7 shows a repository-context line on a fork head | The fork gate did not run before the switch, or `headRepoFullName` was empty and treated as same-repository | This is an AC10 defect, not a configuration problem — the gate must precede the switch and an unknown head origin must be treated as a fork |
| Step 4 shows the diff truncated | Repository-context characters were counted into the patch budget | This is an AC7 defect: the context section has its own budget and must never enter the `maxPatchChars` measurement |
| Step 11 reports precision below 100% | The resolver bound a reference the checker would not, or guessed where it should have dropped | Fix before step 15 of the implementation order; AC23 makes this a defect, not a figure to report |

---

## Known Limitations

- Steps 3 to 9 and 12 need a model credential and consume model quota; steps 0, 1, 2, 11 and 13 do not.
- Step 7's reusable-workflow arms need a real fork-originated pull request; the webhook arm can be exercised locally, the Actions arms cannot.
- Step 14's abort arm is timing-sensitive on a fast pass. Lower `RONDA_REPOSITORY_CONTEXT_TIME_BUDGET_MS` to widen the window, or use a pull request with many candidates.
- Step 12 is not a single sitting: the effect evidence accumulates across the cohort, and the tier ledger records where the count stands on the date it was read.

---

## Execution Record (In Development stage, 2026-09-29)

Recorded honestly per protocol: this run had **no live GitHub App
installation, no `GITHUB_TOKEN` with write access to a real repository, no
model credential, and no ability to push a scratch pull request** to
`lhpaul/ronda` from this sandboxed implementation session. Every step that
needs a real pull request, a live webhook delivery, or a model call is
recorded below as **executed via its automated-test equivalent** (the exact
production code paths this feature added, exercised through the committed
test suite with injected fakes) rather than as a live run, or as
**deferred** with the specific missing resource named. No step's expected
result is claimed without a cited, reproducible source.

| Step | Status | Evidence |
| --- | --- | --- |
| 0 — amendment recorded | **Executed** | `docs/project/3-software-architecture.md` Key Architectural Decisions and `docs/constitution.md` Surface section, both committed as this item's first commit |
| 1 — off-by-default indistinguishability | **Executed (automated-test equivalent)** | `tests/integration/core/review-pass-repository-context.test.ts` — `"off: a validly disabled switch emits no repository-context record"`; `tests/unit/config/load-config-repository-context.test.ts` covers the unset/off/whitespace resolution cases directly |
| 2 — unrecognized switch value | **Executed (automated-test equivalent)** | `tests/integration/core/review-pass-repository-context.test.ts` — `"an unrecognized switch value emits a degraded record, released once the request is issued"`; `tests/unit/config/load-config-repository-context.test.ts`'s not-deferred-to-a-lower-source cases |
| 3 — used, one line, reproducible | **Executed (automated-test equivalent)** | `tests/integration/core/review-pass-repository-context.test.ts` — `"used: every requested candidate resolves within budget"`; `tests/unit/core/summary-repository-context.test.ts` for the one-line body claim; `tests/unit/review/symbol-resolver.test.ts`'s `"scenario 1"` for same-head reproducibility |
| 4 — budgets, diff never gives way | **Executed (automated-test equivalent)** | `tests/unit/review/repository-context.test.ts`'s budget tests (E9, oversized-candidate, once-stopped-always-dropped); `tests/unit/inference/review-prompt-repository-context.test.ts`'s scenario-6 diff-byte-identical test |
| 5 — nothing_to_resolve | **Executed (automated-test equivalent)** | `tests/integration/core/review-pass-repository-context.test.ts` — `"nothing_to_resolve: changed lines producing no candidate never read as unavailable"` |
| 6 — read-failure and time-budget degradation | **Executed (automated-test equivalent)** | `tests/integration/core/review-pass-repository-context.test.ts` — scenario 7 (forced-zero time budget) and scenario 8a (candidate-target reads denied) |
| 7 — fork exclusion at the most permissive configuration | **Executed (automated-test equivalent); live Actions/webhook fork delivery not reproduced** | `tests/integration/core/review-pass-repository-context.test.ts` — `"fork_excluded: a fork-originated head reads no repository context at the most permissive configuration"`. **Deferred**: a live delivery through the reusable-workflow's automatic trigger, its manual comment trigger, and the webhook ingress against a real fork-originated pull request — no such pull request or live ingress was reachable from this session |
| 8 — hostile head | **Executed, locally, against the real committed fixture** | `tests/integration/core/repository-context-hostile-head.test.ts` (4/4 passing) and `docs/testing/ronda/repository-context-read-only-evidence-106.md`. Run through the real production code (`readRepositoryFileAtRef`, `runReviewPass`) against the real git objects in `tests/fixtures/repository-context/hostile-head/`, not through a pushed pull request and a live Actions run — no ability to push to a real repository from this session. The evidence document labels which parts are structural and which are this run's own observation |
| 9 — non-publishing control pass | **Deferred — no `GITHUB_TOKEN` or reachable pull request in this session** | The command's mechanism (argument validation, fork refusal before any read, the no-write counter, the JSONL record) is unit-tested end to end with a fake `Octokit` in `tests/unit/cli/control-pass.test.ts`; a live run against a real pull request is not reproduced here |
| 10 — no record before review execution | **Executed (automated-test equivalent)** | `tests/integration/core/review-pass-repository-context.test.ts` — `"not_applicable: a draft pull request never reaches the repository-context phase"` |
| 11 — resolution correctness and precision | **Executed** | `npx tsx --test tests/unit/review/symbol-resolver.test.ts` — 23/23 passing on 2026-09-29, including every E1–E16 edge case and the AC23 precision test; `docs/testing/ronda/repository-context-resolution-precision-106.md` records the measured 100% (6/6) |
| 12 — evidence, tiers and claims | **Partially executed — admissibility statement only, per this item's agreed PR scope** | `docs/testing/ronda/repository-context-effect-evidence-106.md` records AC13's admissibility statement (not admissible for the three current target seeds) before any figure, and the `fixture_only` evidence-tier ledger. The recall, precision, and cost campaign (AC14–AC18) is explicitly deferred to a follow-up evidence pull request, the same way `#105`'s campaign landed as `#119`/`#120`/`#123` — that document states this explicitly |
| 13 — demonstrations before the switch | **Partially executed** | The AC4/AC5 and AC23 evidence commits exist and precede any repository-variable change, by construction (the variable has not been set at all yet). **The repository variable is not set** — plan step 15 is reserved for the human repository owner and is explicitly out of scope for this implementation PR |
| 14 — no working area on the webhook ingress | **Executed (structural + regression evidence); live 5-pass/abort/restart cycle not reproduced** | D1's no-working-area guarantee is structural (no `node:fs` write call for reviewed content exists in the added modules — same grep evidence as AC4) and the existing webhook test suite (`tests/unit/webhook/webhook-server.test.ts`) passes unchanged, confirming no new concurrency or job dispatch was added. **Deferred**: a live run of five consecutive webhook deliveries plus a mid-read abort and process restart — no reachable live webhook listener in this session |

**Overall**: every step whose expected result depends only on this
repository's own code was executed, honestly, through the automated test
suite added by this implementation (`npm test` — 595/595 passing on
2026-09-29) or, for the hostile-head demonstration, through a real run
against real committed fixture content. Every step that requires a live
GitHub App installation, a real pull request, a model credential, or a
running webhook listener is recorded above as deferred, with the missing
resource named, rather than marked complete without an observation. The
Assertions Checklist below is annotated to match.

### Assertions Checklist (annotated)

- [x] AC1 — recorded in both documents (step 0, executed).
- [x] AC2 — three substantive commitments held (step 0, executed).
- [x] AC3 — automated-test equivalent (steps 3, 5, 10).
- [x] AC4 — executed locally against the real hostile fixture (step 8).
- [x] AC5 — executed locally against the real hostile fixture (step 8).
- [x] AC6 — automated-test equivalent (step 4).
- [x] AC7 — automated-test equivalent (step 4).
- [x] AC8 — automated-test equivalent (step 6).
- [x] AC9 — executed locally against the real hostile fixture (step 8).
- [x] AC10 — automated-test equivalent; live fork delivery not reproduced (step 7).
- [x] AC11 — automated-test equivalent (step 6).
- [ ] AC12 — structural + regression evidence only; live abort/restart cycle deferred (step 14).
- [x] AC13 — admissibility statement recorded before any figure (step 12).
- [ ] AC14 — deferred to the follow-up evidence pull request (step 12).
- [ ] AC15 — deferred to the follow-up evidence pull request (step 12).
- [ ] AC16 — deferred to the follow-up evidence pull request (step 12).
- [x] AC17 — evidence-tier ledger recorded at `fixture_only` (step 12).
- [ ] AC18 — not applicable until the deferred campaign runs (step 12).
- [ ] AC19 — off-by-default and indistinguishability executed; the switch is deliberately **not yet set on** (steps 1, 13) — reserved for the human owner (plan step 15).
- [x] AC20 — reproducibility executed via `symbol-resolver.test.ts` scenario 1 (step 3).
- [x] AC21 — automated-test equivalent (steps 1, 2, 4).
- [x] AC22 — mechanism unit-tested end to end; live run deferred (step 9).
- [x] AC23 — 100% measured precision (step 11).
