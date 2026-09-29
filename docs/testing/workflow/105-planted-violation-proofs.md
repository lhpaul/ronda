# Planted-violation proofs — #105

Recorded for PR #118 per REVIEW.md Workflow Policy checklist item 4 and the
implementation plan. Each proof: plant location (file:line), fail
command/outcome, restore, pass command/outcome.

Scope: the seventeen assertions this PR adds to
`tests/unit/cli/recall-benchmark.test.ts` under
`campaign attributes each precision finding under AC9 independently of the
recall pass` (line 1358) — the coverage that answers the two review findings
routed against the precision sweep records and the per-request prompt
identity. The pre-existing credential-scanner suite (`P1`–`P14`,
`the credential scan fails on a planted canary and passes once it is
removed, per shape` at line 1781) is unchanged by this PR and is not re-proved
here; the plan's scenario-7 canary proof already covers it.

The guard tests over committed artifacts — `tests/unit/testing/evidence-records.test.ts`
and the committed-list assertions in `tests/unit/review/sweep-categories.test.ts`
— have their own per-assertion proof set in
[`105-planted-violation-proofs-guards.md`](105-planted-violation-proofs-guards.md).

Both commands below are identical, run from the repository root:

```bash
./node_modules/.bin/tsx --test \
  --test-name-pattern="campaign attributes each precision finding" \
  tests/unit/cli/recall-benchmark.test.ts
```

Unplanted outcome (`**Pass**` for every proof): `ℹ pass 1`, `ℹ fail 0`.

## P1 — precision record classifies the recall pass's findings

**Plant**: `src/cli/recall-benchmark.ts:1139` — replace
`...classifySweepFindings(result.findings, list),` with
`...classifySweepFindings(pass.findings, list),` so the per-fixture record is
built from the recall pass's findings instead of the precision request's own.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: 13, expected: 1` — the precision record's
`uncategorizedFindingCount` becomes the recall pass's count. Isolates the
independence of the two classifications
(`assert.equal(precisionRecord.uncategorizedFindingCount, 1)`, line 1399).

## P2 — precision request's own fingerprint omitted

**Plant**: `src/cli/recall-benchmark.ts:1173-1175` — delete the
`...(result.promptFingerprint !== undefined ? { promptFingerprint: … } : {})`
spread from the precision entry of `requests[]`.

**Fail**: `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy
value: actual: undefined, expected: true`. Isolates
`assert.ok(onRequests[1].promptFingerprint)` (line 1424).

## P3 — sweep section not stripped from the prompt fingerprint

**Plant**: `src/cli/recall-benchmark.ts:812-815` — replace the marker
truncation with `return sha256Hex(\`${prompt.systemPrompt}\n${prompt.userPrompt}\`);`
so `fingerprintPrompt` hashes the swept system prompt.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
deep-equal: actual: [ '128da42b…', 'abaa2c96…' ], expected: [ '1f76380e…',
'41593c7c…' ]` — the two arms stop agreeing, because the sweep section is the
only difference between them. Isolates the arm-equality deep-equal of
`promptFingerprint` across sweep-off and sweep-on (line 1432).

## P4 — precision per-fixture record not published

**Plant**: `src/cli/recall-benchmark.ts:1141-1149` — delete the `console.error(
JSON.stringify({ event: "sweep_pass_record", runIndex,
...result.summary.sweepPassRecord }))` call.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: 1, expected: 2` — only the recall pass's line remains on the
`benchmark-output` surface. Isolates `assert.equal(published.length, 2)`
(line 1441).

## P5 — sweep-off run admitted to the per-fixture record

**Plant**: `src/cli/recall-benchmark.ts:1135-1140` — change the guard to
`if (list !== undefined || context.options.quality) {` and default the
`listVersion`/classification to a synthetic list when `list` is absent.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: true, expected: false`. Isolates
`assert.equal("sweepPassRecord" in offFixtures[0], false)` (line 1413) — the
sweep-off arm must publish no per-fixture record.

## P6 — precision per-fixture record never assigned

**Plant**: `src/cli/recall-benchmark.ts:1137-1140` — replace the whole
`result.summary.sweepPassRecord = { … }` assignment with `void
result.findings;`.

**Fail**: `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy
value: actual: undefined, expected: true`. Isolates `assert.ok(precisionRecord)`
(line 1392).

## P7 — precision record carries a different list version

**Plant**: `src/cli/recall-benchmark.ts:1138` — replace `listVersion:
list.version,` with `listVersion: \`${list.version}-planted\`,`.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: 'sweep-categories-v1-planted', expected: 'sweep-categories-v1'`.
Isolates `assert.equal(precisionRecord.listVersion, recalled.listVersion)`
(line 1393) — one list, one version, across both request kinds.

## P8 — precision entries dropped from the request identity list

**Plant**: `src/cli/recall-benchmark.ts:1170` — replace
`...precisionResults.map((result, index) => ({` with
`...precisionResults.slice(0, 0).map((result, index) => ({`.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: 1, expected: 2`. Isolates `assert.equal(onRequests.length, 2)`
(line 1422).

## P9 — precision entry reuses the recall fingerprint

**Plant**: `src/cli/recall-benchmark.ts:1173-1175` — replace
`result.promptFingerprint` with `pass.promptFingerprint` in the precision
entry's spread.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected "actual" to be strictly
unequal to: actual: '1f76380e…', expected: '1f76380e…'`. Isolates
`assert.notEqual(onRequests[0].promptFingerprint,
onRequests[1].promptFingerprint)` (line 1425) — each request's entry must
reflect that request's own prompt.

## P10 — recall stderr line gains an extra key

**Plant**: `src/cli/recall-benchmark.ts:1202` — insert `plantedExtra: 1,`
into the recall `sweep_pass_record` object literal.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
deep-equal`, with `plantedExtra` among the emitted keys. It fails in two tests,
each at its own assertion: `assert.deepEqual(Object.keys(emitted).sort(), […])`
(line 1343) in the stderr test, and `assert.deepEqual(Object.keys(recallLine).sort(),
[…])` (line 1446) in the precision-attribution test. The recall line's
seven keys are the six record keys plus `kind`.

## P11 — precision stderr line gains an extra key

**Plant**: `src/cli/recall-benchmark.ts:1146` — insert `plantedExtra: 1,`
after `fixtureId` in the precision `sweep_pass_record` object literal.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
deep-equal`. Isolates the final `assert.deepEqual(Object.keys(precisionLine)
.filter((key) => key !== "fixtureId").sort(), Object.keys(recallLine).sort())`
(line 1456) in the precision-attribution test: the precision line must
share every key with the recall line other than its `fixtureId`. The recall-line
key assertion above it (line 1446) stays green under this plant, so it is not
masked by it.

## P12 — precision per-category outcomes copied from the recall pass

**Plant**: `src/cli/recall-benchmark.ts:1139` — after the
`classifySweepFindings(result.findings, list)` spread, add `categories:
classifySweepFindings(pass.findings, list).categories,` so the per-category
outcomes are the recall pass's.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
deep-equal: actual: [ 'produced_findings', 'produced_findings',
'produced_none', 'produced_findings', 'produced_findings' ], expected: [
'produced_none', 'produced_none', 'produced_none', 'produced_none',
'produced_none' ]`. Isolates `assert.notDeepEqual(precisionRecord.categories,
recalled.categories)` (line 1408) — each request records its own per-category
outcome.

## P13 — recall request's own fingerprint omitted

**Plant**: `src/cli/recall-benchmark.ts:1165-1167` — delete the
`...(pass.promptFingerprint !== undefined ? { promptFingerprint: … } : {})`
spread from the recall entry of `requests[]`.

**Fail**: `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy
value: actual: undefined, expected: true`. Isolates
`assert.ok(onRequests[0].promptFingerprint)` (line 1423), the pairing that
proves P2 and P9 fail for the reason stated rather than because the whole
array is malformed.

## P14 — sweep-off recall record admitted

**Plant**: `src/cli/recall-benchmark.ts:1210` — replace `sweep: sweepRecord,`
with a synthetic record stand-in, `sweep: sweepRecord ?? ({ listVersion:
"planted", categories: [], findings: [], uncategorizedFindingCount: 0 } as
typeof sweepRecord),`.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: true, expected: false`. Isolates
`assert.equal("sweepPassRecord" in offRecord, false)` (line 1414) — a
sweep-off run publishes no recall-side record either, not only no per-fixture
record.

## P15 — per-fixture summaries dropped from the quality summary

**Plant**: `src/cli/recall-benchmark.ts:1221` — replace `precisionFixtures:
precisionResults.map((result) => result.summary),` with `precisionFixtures:
[],`.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: 0, expected: 1`. Isolates `assert.equal(fixtures.length, 1)`
(line 1382) — the quality summary carries one entry per configured precision
fixture, which is the collection every other assertion in the test addresses.

## P16 — recall gate applied to the runs of a campaign

**Plant**: `src/cli/recall-benchmark.ts:1383` — drop the `&& runs === 1`
condition from `if (only !== undefined && isFailureRecord(only) === false &&
runs === 1) {`, so the recall gate judges the first record of a multi-run
campaign too.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: 1, expected: 0`. Isolates `assert.equal(campaign.exitCode, 0)`
(line 693) — a two-run campaign whose runs fail the recall gate still exits
zero, because per-run recall is the measurement and only a failure record may
turn a campaign's exit code non-zero. The single-run assertion beside it
(`assert.equal(single.exitCode, 1)`) keeps the gate itself proven.

## P17 — a rejected precision request does not cancel its siblings

**Plant**: `src/cli/recall-benchmark.ts:1096` — replace `await
settleOrAbort(controller, …)` with `await Promise.all(…)`, so a rejection
neither aborts the run's controller nor waits for the other requests.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: false, expected: true`. Isolates
`assert.equal(siblingSawAbort, true)` (test line 753) — the in-flight sibling
observes its request being aborted.

## P18 — the run does not wait for a cancelled sibling to settle

**Plant**: `src/cli/recall-benchmark.ts:1011-1033` — replace the body of
`settleOrAbort` with `return Promise.all(requests.map((request) =>
request.catch((error) => { controller.abort(); throw error; })));`, which
aborts the controller but rejects at once instead of awaiting every request.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: false, expected: true`. Isolates
`assert.equal(siblingSettled, true)` (test line 754). The abort assertion
above it (line 753) stays green under this plant, so it is not masked by it:
the sibling winds down 30 ms after the abort, and only a run that awaits it
sees `siblingSettled`.

## P19 — the run's own cancellation reads as a timeout

**Plant**: `src/cli/recall-benchmark.ts:1256` — replace `deadlineFired` with
`controller.signal.aborted` in `buildFailureDetail(error, context.manifest,
deadlineFired)`.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: true, expected: false`. Isolates
`assert.equal((records[0].failure as { aborted: boolean }).aborted, false)`
(test line 756) — the run aborting its own sibling after an ordinary error is
not recorded as a `passTimeoutMs` abort.

Unplanted outcome for all three: `./node_modules/.bin/tsx --test
--test-name-pattern="a rejected precision request" tests/unit/cli/recall-benchmark.test.ts`
reports `ℹ pass 1`, `ℹ fail 0`.

## P20 — a throwing list loader fails the pass

**Plant**: `src/core/run-review-pass.ts:249` — replace the `try`/`catch` around
the loader call with a bare `const listResult = await (deps.loadSweepList ??
loadSweepList)();`, so a throw escapes to the shared failure path.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal`. Isolates
`assert.equal(result.outcome, "succeeded")` (test line 1228) — AC19: a list
that cannot be loaded never fails the pass, whatever the loader does. The
second test in the pair also fails under this plant because its pass fails
before it can publish; it is proved separately by P22.

## P21 — the degraded record's detail is not the fixed text

**Plant**: `src/core/run-review-pass.ts:256` — change the `catch` to `catch
(error)` and the detail to `` `the list loader threw: ${error instanceof Error
? error.message : String(error)}` ``.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
deep-equal`. Isolates `assert.deepEqual(result.sweep, { degraded: … })` (test
line 1229), which pins the reason to `unreadable` and the detail to the fixed
text. The `outcome` assertion above it (line 1228) stays green under this
plant, so it is not masked by it.

## P22 — a thrown loader error's text reaches a surface

**Plant**: the same edit as P21 at `src/core/run-review-pass.ts:256`.

**Fail**: `AssertionError [ERR_ASSERTION]: The input was expected to not match
the regular expression /operator|exploded/`. Isolates `assert.doesNotMatch(surface,
/operator|exploded/)` (test line 1265) in the separate "a thrown loader error's
own text reaches no surface" test, which asserts nothing else: a thrown error's
text can carry a local path and must reach neither the check run, the review,
nor any log field. It is a different test from the one P21 fails.

Unplanted outcome for all three: `./node_modules/.bin/tsx --test
tests/unit/core/run-review-pass.test.ts` reports `ℹ pass 44`, `ℹ fail 0`.

## P23 — a count argument is read by its numeric prefix

**Plant**: `src/cli/recall-benchmark.ts:703` — replace `const parsed =
/^\d+$/.test(value) ? Number(value) : Number.NaN;` with `const parsed =
Number.parseInt(value, 10);`, so `--runs 5x` or `--runs 5.9` runs five times.

**Fail**: `AssertionError [ERR_ASSERTION]: Missing expected rejection: --runs
"5x" must be rejected`. Isolates the `assert.rejects` in `a count argument must
be a whole positive integer, not a parsed prefix` (test line 650), which
walks `5x`, `5.9`, `0`, `-1`, ` 5`, and `1e3` for both `--runs` and
`--max-patch-chars`. An empty value is not in the list: it takes the separate
"incomplete argument" path.

Unplanted outcome: `./node_modules/.bin/tsx --test
--test-name-pattern="a count argument" tests/unit/cli/recall-benchmark.test.ts`
reports `ℹ pass 1`, `ℹ fail 0`.

## P24–P28 — the harder credential seed's patch does not hold its defect

The test `the harder credential seed's patch holds a guard that knows the
canonical name and misses the variant` reads the added lines of
`tests/fixtures/recall-benchmark/patches.json`'s `src/benchmark/credentials.ts`
entry, extracts the `CANONICAL_CREDENTIAL_NAME` guard and the credential-named
argument the patch passes to it, and runs the guard against both names. Each
plant edits that one patch entry and fails one assertion; each is restored and
the file then reports `ℹ pass 49`, `ℹ fail 0`.

| Proof | Plant in `patches.json` (`credentials.ts` entry) | Fails at | Isolates |
| --- | --- | --- | --- |
| P24 | rename `const CANONICAL_CREDENTIAL_NAME = ` to `const OTHER_NAME = ` | test line 1672, `must define the canonical-name guard the defect is about` | the patch defines the guard the seed is about |
| P25 | change the guard `/^token$/` to `/^tokenX$/` | test line 1674, `the guard must recognize the canonical name token` | the guard recognizes the canonical form |
| P26 | change `return redactCredentials({ authToken });` to `return { authToken };` | test line 1681, `must pass a credential-named value to the guard` | the variant goes through the guard |
| P27 | change `redactCredentials({ authToken })` to `redactCredentials({ token })` | test line 1682, `Expected "actual" to be strictly unequal` | the value passed is not the canonical name |
| P28 | broaden the guard to `/[Tt]oken$/` | test line 1683, `the guard must miss the variant authToken, or the seeded defect is not in the patch` | the guard misses the variant, which is the defect |

All five fail as `AssertionError [ERR_ASSERTION]`. A guard broadened with a
regex flag (`/token$/i`) is not a P28 plant: the extraction pattern stops
matching it, so it fails at line 1672 first and would be masked, which is why
P28 broadens the character class instead.

## P29–P32 — a run's deadline is not enforced against a client that ignores the abort

`runOneCampaignRun` races the run's body against a deadline promise, so a
client that ignores the abort signal, or never settles, becomes a timeout
failure record at the deadline instead of holding the run and the runs after it.
Two tests hold this: `campaign gives each run its own pass deadline` (changed:
the run that outlives its deadline is now a timeout record, exit code 1) and the
new `a client that never settles cannot hold a run past its deadline`. Each plant
is restored afterwards and the file reports `ℹ pass 50`, `ℹ fail 0`. Run with
`--test-timeout=4000` so a hang fails instead of stalling the runner.

| Proof | Plant in `src/cli/recall-benchmark.ts` | Fails at | Isolates |
| --- | --- | --- | --- |
| P29 | `return await Promise.race([body, deadline]);` becomes `return await body;` (`src/cli/recall-benchmark.ts:1235`) | changed test line 786 `assert.equal(exitCode, 1)`; the new test never returns and fails with `test timed out after 4000ms` | the run is bounded by its deadline, not by the client |
| P30 | pass `false` instead of `deadlineFired` to `buildFailureDetail` | changed test line 789, new test line 1162 (`reason` is `"timeout"`), and the existing timeout test line 1303 | a deadline expiry is classified as a timeout |
| P31 | `aborted,` becomes `aborted: false,` in `buildFailureDetail` (`src/cli/recall-benchmark.ts:935`) | new test line 1163 (`aborted` is true) and the existing test line 1303; the `reason` assertion above it stays green | the record says the deadline aborted the run |
| P32 | add `if (runIndex > 0) throw new Error("planted");` at the top of `runBody` | changed test line 788 and new test line 1160 (`records.map(isFailure)` is `[true, false]`); the `exitCode` and length assertions above them stay green | a hung run does not take the next run down with it |

P32 also fails other multi-run tests, which legitimately read the same second
run. The elapsed-time assertion an earlier draft carried is dropped: the test
only completes at all if the race works, which P29 proves.

## P33–P35 — a run whose deadline passed resumes and carries on

After a run's deadline fires, its failure record is returned once its aborted
request settles or the grace period ends, but a client that ignored the abort can
still resume the run. `runOneCampaignRun` therefore checks `controller.signal`
after each stage that awaits the client. The three tests `a run that resumes from
model-creation | recall | precision after its deadline starts nothing further and
logs nothing` each make one stage late (150 ms against a 50 ms deadline) and
assert, from absolute expectations, which requests were issued (`[0, 0]`, `[1, 0]`
and `[1, 1]` recall and precision requests) and that nothing was logged. Each
plant removes one check, is restored, and the file reports `ℹ pass 54`,
`ℹ fail 0`. Run with `--test-timeout=8000`.

| Proof | Plant in `src/cli/recall-benchmark.ts` (remove `controller.signal.throwIfAborted();`) | Fails | Isolates |
| --- | --- | --- | --- |
| P33 | the check before `runRecallPass` (`src/cli/recall-benchmark.ts:1080`) | the `model-creation` test, line 852, `the timed-out run must not issue requests after its failure record`; the other two stay green | a run resuming from model creation issues no recall request |
| P34 | the check after `runRecallPass` (`src/cli/recall-benchmark.ts:1092`) | the `recall` test, line 852, same message; the other two stay green | a run resuming from the recall request issues no precision request |
| P35 | the check after the precision requests (`src/cli/recall-benchmark.ts:1125`) | the `precision` test, line 857, `the timed-out run must not log after its failure record`; the other two stay green | a run resuming from a precision request emits no per-category record |

## P36–P39 — the next run overlaps a timed-out request, waits on it forever, or starts after it

A run whose deadline passed is aborted, then waited on for a bounded grace period
(`deadlineDrainMs`, five seconds by default) so the next run does not overlap a
request that settles on abort. A request still in flight after the grace period is
recorded with `unsettledAfterDeadline: true`, and the campaign stops there: it
starts no further run, so records exist only up to that run and the exit code is
non-zero. Three tests hold this: `the next run waits for a timed-out request that
settles within the grace period`, `a client that never settles cannot hold a run
past its deadline`, and `campaign gives each run its own pass deadline`. Each plant
is restored and the file reports `ℹ pass 56`, `ℹ fail 0`. Run with
`--test-timeout=8000`.

| Proof | Plant in `src/cli/recall-benchmark.ts` | Fails | Isolates |
| --- | --- | --- | --- |
| P36 | replace the `const unsettled = deadlineFired ? … : false;` expression (`src/cli/recall-benchmark.ts:1241`) with `const unsettled = false;`, so nothing waits | the waits test, line 1199, `assert.ok(firstSettledAt > 0 && secondStartedAt >= firstSettledAt)`; the never-settles test also fails at line 1160, because nothing marks the request unsettled, so the campaign does not stop | the next run starts only after a timed-out request settles |
| P37 | replace `!(await settledWithin(body, …))` (`src/cli/recall-benchmark.ts:1242`) with `(await body.then(() => false, () => false))`, an unbounded wait | the never-settles test fails with `test timed out after 8000ms`; the waits test stays green | the wait is bounded, so a client that never settles cannot hold the campaign |
| P38 | replace the `...(unsettled ? { unsettledAfterDeadline: true } : {}),` spread (`src/cli/recall-benchmark.ts:1257`) with an empty object | the never-settles test, line 1160, `records.map(isFailure)` is `[true]`; the waits test stays green | a request still in flight after the grace period is recorded, and that record is what stops the campaign |
| P39 | make `unsettled` true whenever the deadline fired, after still waiting (`src/cli/recall-benchmark.ts:1241`) | the waits test, line 1197, `records.map(isFailure)` is `[true, false]`, and the per-run-deadline test, line 787, `records.length` is `2`; the never-settles test stays green | a request that settled within the grace period does not stop the campaign |

## P47–P48 — the campaign starts the next run while a request is in flight

Recording an unsettled request is not enough if the loop then advances: the next
run would overlap the request, doubling external calls and mixing its cost into
the next run's. The campaign loop breaks after a failure record that carries
`unsettledAfterDeadline`. In `a client that never settles cannot hold a run past
its deadline` the second run's client records whether it was ever called.

| Proof | Plant in `src/cli/recall-benchmark.ts` | Fails | Isolates |
| --- | --- | --- | --- |
| P47 | delete the `break` after the unsettled failure record (`src/cli/recall-benchmark.ts:1366`) | test line 1160, `records.map(isFailure)` is `[true]` (the campaign carried on and recorded a second run) | the campaign records nothing past an unsettled request |
| P48 | keep the `break` but first call `await runOneCampaignRun(context, deps, list, runIndex + 1);` (`src/cli/recall-benchmark.ts:1365`), so the next run starts and its record is discarded | test line 1161, `no run may start while a request is in flight`; the record assertion above it stays green | the next run is never started while a request may be in flight |

## P40–P41 — a campaign timer lets the process exit under a hung client

The run's deadline and the drain's grace period are the campaign's own clock. If
either timer is `unref`'d, a client that never settles leaves nothing keeping the
process alive: the runtime detects an unsettled top-level await and exits with
code 13 and no result, and the Node 20 test runner reports `Promise resolution is
still pending but the event loop has already resolved`. The pull request's CI
failed exactly that way while a Node 26 run passed. The test `a client that never
settles cannot hold a run past its deadline` records every timer the campaign
creates and asserts the 50 ms deadline and 100 ms grace timers are ref'd.

Reproduced outside the test runner with a script that runs one campaign against a
client whose request never settles: with both timers `unref`'d the process exits
with code 13 and prints `Detected unsettled top-level await`; with the fix it
finishes and reports the campaign's exit code 1.

| Proof | Plant in `src/cli/recall-benchmark.ts` | Fails | Isolates |
| --- | --- | --- | --- |
| P40 | add `timeout.unref?.();` after the run's deadline timer (`src/cli/recall-benchmark.ts:1065`) | test line 1169, `the 50 ms timer must keep the process alive` | the run's deadline timer keeps the process alive |
| P41 | add `timer.unref?.();` after the grace timer (`src/cli/recall-benchmark.ts:1291`) | test line 1169, `the 100 ms timer must keep the process alive`; the 50 ms case stays green | the drain's grace timer keeps the process alive |

The `bounds.length >= 2` assertion (test line 1167) guards the loop above it from
passing vacuously: it fails if the timers were never created, which would also fail
the other assertions in the test.

## P42–P44 — a record names the fixture bytes as they are now, not as they were loaded

Every record's `fixture` block carries the SHA-256 of the manifest and patch
files. If a file changes while a model request is running and the record hashes it
again, the record claims an identity for content the campaign never reviewed. The
campaign therefore reads and hashes both files once, when it parses them, and
every record copies that identity. The test `every record's fixture identity is the
hash of the bytes the campaign loaded` rewrites both files during the first run's
request, fails the second run, and asserts all three records (a success, a failure,
and a later success) carry the hashes of the original bytes.

| Proof | Plant in `src/cli/recall-benchmark.ts` | Fails | Isolates |
| --- | --- | --- | --- |
| P42 | at the failure-record site (`src/cli/recall-benchmark.ts:1246`) replace `{ ...context.fixtureIdentity }` with a `buildFixtureIdentity` call that re-reads both files | test line 896, `assert.equal(fixture.manifestSha256, sha256(manifestBytes))`, on the failure record | a failure record carries the loaded identity |
| P43 | the same re-read at the success-record site (`src/cli/recall-benchmark.ts:989`) | test line 896, on the first (success) record | a success record carries the loaded identity |
| P44 | at the success-record site keep the loaded manifest hash but re-hash only the patches | test line 897, `assert.equal(fixture.patchesSha256, sha256(patchesBytes))`; the manifest assertion above it stays green | the patch hash is the loaded one too |

## P45–P46 — a record reads as if the durability mode shaped the requests

The benchmark builds its prompts without resolving or applying a durability mode,
so a forced-on configuration never reached them. A record therefore states
`durabilityModeApplied: false` beside the configured value. The test `a record
states that the durability mode was not applied to the benchmark's requests` forces
the mode on, fails the second run, and checks a success and a failure record.

| Proof | Plant in `src/cli/recall-benchmark.ts` | Fails | Isolates |
| --- | --- | --- | --- |
| P45 | replace `durabilityModeApplied: false` with `durabilityModeApplied: true as unknown as false` (`src/cli/recall-benchmark.ts:838`) | test line 928, `assert.equal(configuration.durabilityModeApplied, false)` | a record does not claim the mode was applied |
| P46 | replace `durabilityMode: input.config.durabilityMode` with the literal `"off"` (`src/cli/recall-benchmark.ts:836`) | test line 927, `assert.equal(configuration.durabilityMode, "on")`; the applied assertion below it is not reached | the configured mode is still recorded |

Unplanted outcome for all five: `ℹ pass 56`, `ℹ fail 0` on the benchmark test file.

## P49 — a sibling's consequence hides the failure that caused the cancellation

When one precision request fails, the run aborts its siblings, and a sibling's
client can then reject too, with its own `timed_out`. `settleOrAbort` keeps the
first rejection it observes and rethrows that one after every request has settled.
Picking the first rejection in input order instead lets the sibling's consequence
replace the real provider failure.

| Proof | Plant in `src/cli/recall-benchmark.ts` | Fails | Isolates |
| --- | --- | --- | --- |
| P49 | replace `if (first !== undefined) { throw first.error; }` (`src/cli/recall-benchmark.ts:1029`) with a search of the settled results for the first rejection in input order | test line 976, `assert.equal((records[0].failure as { reason: string }).reason, "model")` in `the rejection that starts a sibling cancellation is the one recorded` | the recorded failure is the cause, not its consequence |

## P50 — a manifest that repeats a seeded defect id reports evidence

Findings are matched to seeds by id, so a manifest that repeats an id is ambiguous:
the repeated seed can land in both the found and the missed list, or twice in one,
and every recall figure and subset derived from it is corrupt. A count check or a
membership check on the original thirteen ids does not see it: all thirteen ids plus
a repeat pass a membership check. `runBenchmarkCampaign` therefore calls
`assertUniqueSeedIds` when it parses the manifest and refuses to run. The test `a
manifest that repeats a seeded defect id is rejected instead of reporting evidence`
runs the intact original set (accepted, and it reports its subset), the original
thirteen ids plus a repeat of one, and a manifest where one original id repeats in
place of another so the count is still thirteen.

| Proof | Plant in `src/cli/recall-benchmark.ts` | Fails | Isolates |
| --- | --- | --- | --- |
| P50 | delete the `assertUniqueSeedIds(manifest);` call (`src/cli/recall-benchmark.ts:1327`) | test line 1032, `assert.rejects(…)` for the original ids plus a repeat: `Missing expected rejection.` | a manifest with a repeated id is refused |
| P56 | make the check skip a repeat among the first two ids: `if (seen.has(defect.id) && seen.size >= 2)` (`src/cli/recall-benchmark.ts:871`) | test line 1053, `assert.rejects(…)` for the swapped manifest; the plus-repeat rejection above it stays green | a repeat that keeps the count at thirteen is refused too |

The check itself is `assertUniqueSeedIds` (`src/cli/recall-benchmark.ts:867`). Unplanted outcome: `ℹ pass 59`, `ℹ fail 0`
on the benchmark test file.

## P51–P53 — a log line cannot be attributed to its pass

A run can hold several precision fixtures, so each `sweep_pass_record` line names
its `kind`, and a precision line also names its `fixtureId`. Both are identifiers
from the manifest, never review content. The test `each precision log line names
its kind and the fixture it belongs to` uses two precision fixtures.

| Proof | Plant in `src/cli/recall-benchmark.ts` | Fails | Isolates |
| --- | --- | --- | --- |
| P51 | delete `fixtureId: result.summary.id,` from the precision log line (`src/cli/recall-benchmark.ts:1146`) | test line 1000 (`precision.map((line) => line.fixtureId).sort()` is both ids) and, in the precision-attribution test, line 1455 (`precisionLine.fixtureId`) | a precision line names its fixture |
| P52 | change the precision line's `kind: "precision"` to `"recall"` (`src/cli/recall-benchmark.ts:1145`) | test line 1000 and, in the precision-attribution test, line 1445 (`assert.ok(recallLine && precisionLine)`) | a precision line names its kind |
| P53 | delete `kind: "recall"` from the recall log line (`src/cli/recall-benchmark.ts:1202`) | test line 1004 (one recall line), the stderr test line 1336 (`emitted.kind` is `"recall"`), and line 1445 in the precision-attribution test | the recall line names its kind |

Unplanted outcome for P49–P53: `ℹ pass 59`, `ℹ fail 0` on the benchmark test file.

## P54–P55 — a failure after publication skips the per-category log record

Once a review is public, the record it owes the logs must not depend on what
happens next. `sweepMetadata` logs the `sweep_pass_record` (`src/core/run-review-pass.ts:772`)
before the recovery callback (`575`), the check-run write (`585`), and the
success log (`603`). Two tests hold that ordering: `sweep AC1: a failing recovery
callback after publication still leaves the per-category record on the logs` makes
the callback throw, and `sweep AC1: a check-run write that keeps failing after
publication still leaves the per-category record on the logs` makes the write fail
twice; each rejects with `ReviewPublishedCheckRunError` and asserts exactly one
record was logged. A codex finding claimed the record was lost on a callback failure;
the tests showed it was already logged before the callback, and now pin that.

| Proof | Plant in `src/core/run-review-pass.ts` | Fails | Isolates |
| --- | --- | --- | --- |
| P54 | remove the log from `sweepMetadata` (line 772) and emit it just before `publishSuccessCheckRun` (line 585), after the callback | test line 612, `assert.equal(events.filter(…).length, 1)` in the callback test; the check-run test stays green | the record is logged before the recovery callback runs |
| P55 | emit it just before the `pass_succeeded` log (line 603), after the check-run write | test line 640 in the check-run test, and line 612 in the callback test | the record is logged before the check-run write |

Unplanted outcome: `./node_modules/.bin/tsx --test tests/unit/core/run-review-pass.test.ts`
reports `ℹ pass 44`, `ℹ fail 0`. Both plants also fail the existing test `sweep AC1: a
superseded pass logs its per-category record and publishes nothing`, which reads the
same ordering.

## P57–P63 — the external-output seed's patch does not hold its defect

The `external-output-parsing-lossy` seed says items are lost or merged when another
system's output is split and classified. Its patch was a plausible bullet-list parser,
so nothing in it made a non-bullet line a valid item, and a model could report the
defect only by echoing the sweep prompt. The patch now states the external tool's
item formats in a comment, carries a sample holding all three, and a parser that keeps
only the `- ` form, so it loses two of three. The test `the external-output seed's
patch states a grammar its parser loses items from` reads that patch and checks each
part. Each plant edits the `src/benchmark/output.ts` entry of
`tests/fixtures/recall-benchmark/patches.json` (or the manifest), is restored, and the
file reports `ℹ pass 60`, `ℹ fail 0`.

| Proof | Plant | Fails at test line | Isolates |
| --- | --- | --- | --- |
| P57 | rename the seed's `id` in the manifest | 1641, `the external-output seed must exist` | the seed is present |
| P58 | change the patch entry's `path` to `src/benchmark/output-x.ts` | 1643, `the seed needs a changed file` | the seed has a changed file |
| P59 | reduce the stated formats `"- text", "* text" or "1. text"` to `"- text"` | 1651, `the patch must state the item formats` | the grammar is stated in the patch |
| P60 | rename `const SAMPLE = [` | 1653, `the patch must carry a sample of the external output` | the patch carries a sample |
| P61 | delete the `"1. missing return"` sample line | 1656, `the sample must hold at least three items in the stated formats` | the sample holds three valid items |
| P62 | replace the prefix filter with `.filter(Boolean)` | 1660, `the patch must filter lines by a fixed prefix` | the parser filters by a fixed prefix |
| P63 | make every sample line a `- ` item | 1662, `the parser must lose valid items: kept 3 of 3` | the parser actually loses valid items |

## P64–P67 — a campaign overwrites its evidence file in place

The campaign's output is evidence, and it may overwrite a file that holds a previous
campaign. `writeFileAtomic` (`src/cli/recall-benchmark.ts:730`) writes a temporary file beside the target and
renames it over the target, so a crash or a full disk during the write leaves either
the whole old file or the whole new one instead of a truncated one. Two tests hold it:
`the campaign output replaces the target whole and leaves no temporary file`, and
`a campaign that cannot write its output leaves the previous evidence intact`, which
makes the directory read-only so a temporary file cannot be created (skipped where
permissions do not restrict the user). Each plant is restored and the file reports
`ℹ pass 62`, `ℹ fail 0`.

| Proof | Plant in `src/cli/recall-benchmark.ts` | Fails | Isolates |
| --- | --- | --- | --- |
| P64 | write straight to the target: replace the temporary write and rename (`src/cli/recall-benchmark.ts:733`-`734`) with `writeFileSync(path, text)` | test line 1098, `await assert.rejects(…)` in the read-only-directory test: a direct write succeeds, so nothing is rejected | the target is not written directly |
| P65 | keep the rename out: write the temporary file, then write the target too (`src/cli/recall-benchmark.ts:733`) | test line 1083, `assert.deepEqual(readdirSync(directory), ["campaign.json"])` | no temporary file is left behind |
| P66 | truncate the content written to the temporary file (`src/cli/recall-benchmark.ts:733`) | test line 1082, `assert.doesNotThrow(() => JSON.parse(…))`; every other campaign test that parses the output also fails | the written file is the whole record |
| P67 | overwrite the target with `"corrupted"` before the temporary write, which then fails in the read-only directory (`src/cli/recall-benchmark.ts:730`) | test line 1110, `assert.equal(readFileSync(target, "utf8"), "previous evidence")`; the rejection assertion above it stays green | a failed write leaves the previous evidence intact |
