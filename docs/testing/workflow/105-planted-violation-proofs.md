# Planted-violation proofs — #105

Recorded for PR #118 per REVIEW.md Workflow Policy checklist item 4 and the
implementation plan. Each proof: plant location (file:line), fail
command/outcome, restore, pass command/outcome.

Scope: the seventeen assertions this PR adds to
`tests/unit/cli/recall-benchmark.test.ts` under
`campaign attributes each precision finding under AC9 independently of the
recall pass` (line 848) — the coverage that answers the two review findings
routed against the precision sweep records and the per-request prompt
identity. The pre-existing credential-scanner suite (`P1`–`P14`,
`the credential scan fails on a planted canary and passes once it is
removed, per shape` at line 1201) is unchanged by this PR and is not re-proved
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

**Plant**: `src/cli/recall-benchmark.ts:1013` — replace
`...classifySweepFindings(result.findings, list),` with
`...classifySweepFindings(pass.findings, list),` so the per-fixture record is
built from the recall pass's findings instead of the precision request's own.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: 13, expected: 1` — the precision record's
`uncategorizedFindingCount` becomes the recall pass's count. Isolates the
independence of the two classifications
(`assert.equal(precisionRecord.uncategorizedFindingCount, 1)`, line 889).

## P2 — precision request's own fingerprint omitted

**Plant**: `src/cli/recall-benchmark.ts:1045-1047` — delete the
`...(result.promptFingerprint !== undefined ? { promptFingerprint: … } : {})`
spread from the precision entry of `requests[]`.

**Fail**: `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy
value: actual: undefined, expected: true`. Isolates
`assert.ok(onRequests[1].promptFingerprint)` (line 914).

## P3 — sweep section not stripped from the prompt fingerprint

**Plant**: `src/cli/recall-benchmark.ts:770-773` — replace the marker
truncation with `return sha256Hex(\`${prompt.systemPrompt}\n${prompt.userPrompt}\`);`
so `fingerprintPrompt` hashes the swept system prompt.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
deep-equal: actual: [ '128da42b…', 'abaa2c96…' ], expected: [ '1f76380e…',
'41593c7c…' ]` — the two arms stop agreeing, because the sweep section is the
only difference between them. Isolates the arm-equality deep-equal of
`promptFingerprint` across sweep-off and sweep-on (line 922).

## P4 — precision per-fixture record not published

**Plant**: `src/cli/recall-benchmark.ts:1015-1021` — delete the `console.error(
JSON.stringify({ event: "sweep_pass_record", runIndex,
...result.summary.sweepPassRecord }))` call.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: 1, expected: 2` — only the recall pass's line remains on the
`benchmark-output` surface. Isolates `assert.equal(published.length, 2)`
(line 930).

## P5 — sweep-off run admitted to the per-fixture record

**Plant**: `src/cli/recall-benchmark.ts:1009-1014` — change the guard to
`if (list !== undefined || context.options.quality) {` and default the
`listVersion`/classification to a synthetic list when `list` is absent.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: true, expected: false`. Isolates
`assert.equal("sweepPassRecord" in offFixtures[0], false)` (line 903) — the
sweep-off arm must publish no per-fixture record.

## P6 — precision per-fixture record never assigned

**Plant**: `src/cli/recall-benchmark.ts:1011-1014` — replace the whole
`result.summary.sweepPassRecord = { … }` assignment with `void
result.findings;`.

**Fail**: `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy
value: actual: undefined, expected: true`. Isolates `assert.ok(precisionRecord)`
(line 882).

## P7 — precision record carries a different list version

**Plant**: `src/cli/recall-benchmark.ts:1012` — replace `listVersion:
list.version,` with `listVersion: \`${list.version}-planted\`,`.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: 'sweep-categories-v1-planted', expected: 'sweep-categories-v1'`.
Isolates `assert.equal(precisionRecord.listVersion, recalled.listVersion)`
(line 883) — one list, one version, across both request kinds.

## P8 — precision entries dropped from the request identity list

**Plant**: `src/cli/recall-benchmark.ts:1042` — replace
`...precisionResults.map((result, index) => ({` with
`...precisionResults.slice(0, 0).map((result, index) => ({`.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: 1, expected: 2`. Isolates `assert.equal(onRequests.length, 2)`
(line 912).

## P9 — precision entry reuses the recall fingerprint

**Plant**: `src/cli/recall-benchmark.ts:1045-1047` — replace
`result.promptFingerprint` with `pass.promptFingerprint` in the precision
entry's spread.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected "actual" to be strictly
unequal to: actual: '1f76380e…', expected: '1f76380e…'`. Isolates
`assert.notEqual(onRequests[0].promptFingerprint,
onRequests[1].promptFingerprint)` (line 915) — each request's entry must
reflect that request's own prompt.

## P10 — recall stderr line gains a seventh key

**Plant**: `src/cli/recall-benchmark.ts:1074` — insert `plantedExtra: 1,` into
the recall `sweep_pass_record` object literal.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
deep-equal: actual: [ 'categories', 'event', 'findings', 'listVersion',
'plantedExtra', 'runIndex', 'uncategorizedFindingCount' ], expected: [
'categories', 'event', 'findings', 'listVersion', 'runIndex',
'uncategorizedFindingCount' ]`. Isolates `assert.deepEqual(keySets[0], […])`
(line 932).

## P11 — precision stderr line gains a seventh key

**Plant**: `src/cli/recall-benchmark.ts:1017-1019` — insert `plantedExtra: 1,`
into the precision `sweep_pass_record` object literal.

**Fail**: same deep-equal failure as P10, on the precision line. Together
P10 and P11 isolate both halves of the schema check: P10 breaks the recall
line's key set (`keySets[0]`, line 932), P11 breaks the precision line's —
which only the final `assert.deepEqual(keySets[1], keySets[0])` (line 940)
catches, since `keySets[1]` is otherwise never compared to a literal. Remove
either plant and its line matches the six-key literal again.

## P12 — precision per-category outcomes copied from the recall pass

**Plant**: `src/cli/recall-benchmark.ts:1013` — after the
`classifySweepFindings(result.findings, list)` spread, add `categories:
classifySweepFindings(pass.findings, list).categories,` so the per-category
outcomes are the recall pass's.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
deep-equal: actual: [ 'produced_findings', 'produced_findings',
'produced_none', 'produced_findings', 'produced_findings' ], expected: [
'produced_none', 'produced_none', 'produced_none', 'produced_none',
'produced_none' ]`. Isolates `assert.notDeepEqual(precisionRecord.categories,
recalled.categories)` (line 898) — each request records its own per-category
outcome.

## P13 — recall request's own fingerprint omitted

**Plant**: `src/cli/recall-benchmark.ts:1037-1039` — delete the
`...(pass.promptFingerprint !== undefined ? { promptFingerprint: … } : {})`
spread from the recall entry of `requests[]`.

**Fail**: `AssertionError [ERR_ASSERTION]: The expression evaluated to a falsy
value: actual: undefined, expected: true`. Isolates
`assert.ok(onRequests[0].promptFingerprint)` (line 913), the pairing that
proves P2 and P9 fail for the reason stated rather than because the whole
array is malformed.

## P14 — sweep-off recall record admitted

**Plant**: `src/cli/recall-benchmark.ts:1082` — replace `sweep: sweepRecord,`
with a synthetic record stand-in, `sweep: sweepRecord ?? ({ listVersion:
"planted", categories: [], findings: [], uncategorizedFindingCount: 0 } as
typeof sweepRecord),`.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: true, expected: false`. Isolates
`assert.equal("sweepPassRecord" in offRecord, false)` (line 904) — a
sweep-off run publishes no recall-side record either, not only no per-fixture
record.

## P15 — per-fixture summaries dropped from the quality summary

**Plant**: `src/cli/recall-benchmark.ts:1093` — replace `precisionFixtures:
precisionResults.map((result) => result.summary),` with `precisionFixtures:
[],`.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: 0, expected: 1`. Isolates `assert.equal(fixtures.length, 1)`
(line 872) — the quality summary carries one entry per configured precision
fixture, which is the collection every other assertion in the test addresses.

## P16 — recall gate applied to the runs of a campaign

**Plant**: `src/cli/recall-benchmark.ts:1204` — drop the `&& runs === 1`
condition from `if (only !== undefined && isFailureRecord(only) === false &&
runs === 1) {`, so the recall gate judges the first record of a multi-run
campaign too.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: 1, expected: 0`. Isolates `assert.equal(campaign.exitCode, 0)`
(line 679) — a two-run campaign whose runs fail the recall gate still exits
zero, because per-run recall is the measurement and only a failure record may
turn a campaign's exit code non-zero. The single-run assertion beside it
(`assert.equal(single.exitCode, 1)`) keeps the gate itself proven.

## P17 — a rejected precision request does not cancel its siblings

**Plant**: `src/cli/recall-benchmark.ts:1008` — replace `await
settleOrAbort(controller, …)` with `await Promise.all(…)`, so a rejection
neither aborts the run's controller nor waits for the other requests.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: false, expected: true`. Isolates
`assert.equal(siblingSawAbort, true)` (test line 739) — the in-flight sibling
observes its request being aborted.

## P18 — the run does not wait for a cancelled sibling to settle

**Plant**: `src/cli/recall-benchmark.ts:946-965` — replace the body of
`settleOrAbort` with `return Promise.all(requests.map((request) =>
request.catch((error) => { controller.abort(); throw error; })));`, which
aborts the controller but rejects at once instead of awaiting every request.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: false, expected: true`. Isolates
`assert.equal(siblingSettled, true)` (test line 740). The abort assertion
above it (line 739) stays green under this plant, so it is not masked by it:
the sibling winds down 30 ms after the abort, and only a run that awaits it
sees `siblingSettled`.

## P19 — the run's own cancellation reads as a timeout

**Plant**: `src/cli/recall-benchmark.ts:1152` — replace `deadlineFired` with
`controller.signal.aborted` in `buildFailureDetail(error, context.manifest,
deadlineFired)`.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
equal: actual: true, expected: false`. Isolates
`assert.equal((records[0].failure as { aborted: boolean }).aborted, false)`
(test line 742) — the run aborting its own sibling after an ordinary error is
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
`assert.equal(result.outcome, "succeeded")` (test line 1168) — AC19: a list
that cannot be loaded never fails the pass, whatever the loader does. The
second test in the pair also fails under this plant because its pass fails
before it can publish; it is proved separately by P22.

## P21 — the degraded record's detail is not the fixed text

**Plant**: `src/core/run-review-pass.ts:256` — change the `catch` to `catch
(error)` and the detail to `` `the list loader threw: ${error instanceof Error
? error.message : String(error)}` ``.

**Fail**: `AssertionError [ERR_ASSERTION]: Expected values to be strictly
deep-equal`. Isolates `assert.deepEqual(result.sweep, { degraded: … })` (test
line 1169), which pins the reason to `unreadable` and the detail to the fixed
text. The `outcome` assertion above it (line 1168) stays green under this
plant, so it is not masked by it.

## P22 — a thrown loader error's text reaches a surface

**Plant**: the same edit as P21 at `src/core/run-review-pass.ts:256`.

**Fail**: `AssertionError [ERR_ASSERTION]: The input was expected to not match
the regular expression /operator|exploded/`. Isolates `assert.doesNotMatch(surface,
/operator|exploded/)` (test line 1205) in the separate "a thrown loader error's
own text reaches no surface" test, which asserts nothing else: a thrown error's
text can carry a local path and must reach neither the check run, the review,
nor any log field. It is a different test from the one P21 fails.

Unplanted outcome for all three: `./node_modules/.bin/tsx --test
tests/unit/core/run-review-pass.test.ts` reports `ℹ pass 42`, `ℹ fail 0`.

## P23 — a count argument is read by its numeric prefix

**Plant**: `src/cli/recall-benchmark.ts:687` — replace `const parsed =
/^\d+$/.test(value) ? Number(value) : Number.NaN;` with `const parsed =
Number.parseInt(value, 10);`, so `--runs 5x` or `--runs 5.9` runs five times.

**Fail**: `AssertionError [ERR_ASSERTION]: Missing expected rejection: --runs
"5x" must be rejected`. Isolates the `assert.rejects` in `a count argument must
be a whole positive integer, not a parsed prefix` (test line 649), which
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
| P24 | rename `const CANONICAL_CREDENTIAL_NAME = ` to `const OTHER_NAME = ` | test line 1250, `must define the canonical-name guard the defect is about` | the patch defines the guard the seed is about |
| P25 | change the guard `/^token$/` to `/^tokenX$/` | test line 1252, `the guard must recognize the canonical name token` | the guard recognizes the canonical form |
| P26 | change `return redactCredentials({ authToken });` to `return { authToken };` | test line 1259, `must pass a credential-named value to the guard` | the variant goes through the guard |
| P27 | change `redactCredentials({ authToken })` to `redactCredentials({ token })` | test line 1260, `Expected "actual" to be strictly unequal` | the value passed is not the canonical name |
| P28 | broaden the guard to `/[Tt]oken$/` | test line 1261, `the guard must miss the variant authToken, or the seeded defect is not in the patch` | the guard misses the variant, which is the defect |

All five fail as `AssertionError [ERR_ASSERTION]`. A guard broadened with a
regex flag (`/token$/i`) is not a P28 plant: the extraction pattern stops
matching it, so it fails at line 1250 first and would be masked, which is why
P28 broadens the character class instead.
