# Comment-Trigger Evidence: #109

Evidence for [#109](https://github.com/lhpaul/ronda/issues/109) (epic
[#52](https://github.com/lhpaul/ronda/issues/52)): the `/ronda review` comment
trigger in `.github/workflows/ronda-review-dogfood.yml` and the corrected
caller snippet in
[`ronda-review-adoption.md`](../../adoption/ronda-review-adoption.md).

Two kinds of proof, kept apart because they prove different things:

1. **Expression proof (this PR).** The workflow's job `if:`, `concurrency.group`,
   `cancel-in-progress` and `on:` triggers, evaluated with GitHub's own evaluator
   against synthetic event payloads, each assertion with an isolating planted
   violation. It proves the expressions decide as intended. It does **not** prove
   how GitHub schedules, queues or displaces runs.
2. **Runtime proof (after merge, still owed).** Real workflow runs from real
   comments. `issue_comment` workflows load from the default branch (`develop`),
   so the PR that adds the trigger cannot exercise it. Issue #109 stays open
   until the "Runtime proof" table below is filled with run ids.

## Design being proven

A run is placed in one of three concurrency groups:

- a `pull_request` pass: the PR's group, and only a `synchronize` push cancels;
- a **valid review request** (a PR comment that starts with `/ronda review`, from
  an `OWNER`, `MEMBER` or `COLLABORATOR`): the same PR group, never cancelling.
  It queues behind an in-flight pass, so two passes on one head SHA never run
  together and an older pass cannot finish last and overwrite a newer result;
- **any other comment**: a group of its own, so it cannot cancel, queue behind or
  displace anything before the job `if:` skips it.

A first version gave every comment its own group. The local reviewer rejected it:
a manual pass could then run alongside an automatic one on the same head SHA.
Plant 13 below restores that version, and assertion B5 fails.

## Expression proof

Evaluator: `@actions/expressions` 0.3.61 (GitHub's published implementation of
the Actions expression language), run outside the repository so no dependency is
added to it. The harness reads the expressions **from the workflow file under
test**, so a plant is an edit to that file.

Reproduce, from an empty scratch directory:

```bash
npm init -y && npm i @actions/expressions@0.3.61 yaml
# save the harness below as check.mjs, then:
node check.mjs /path/to/.github/workflows/ronda-review-dogfood.yml
```

<details>
<summary>check.mjs</summary>

```js
// Evaluates the trigger expressions of a caller workflow with GitHub's own
// expression evaluator (@actions/expressions) against synthetic event contexts.
// Usage: node check.mjs <workflow.yml>
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { Parser, Lexer, Evaluator, data } from "@actions/expressions";

const file = process.argv[2];
const wf = parse(readFileSync(file, "utf8"));
const raw = {
  group: wf.concurrency.group,
  cancel: wf.concurrency["cancel-in-progress"],
  jobIf: wf.jobs.ronda.if,
};

function toData(v) {
  if (v === null || v === undefined) return new data.Null();
  if (typeof v === "string") return new data.StringData(v);
  if (typeof v === "number") return new data.NumberData(v);
  if (typeof v === "boolean") return new data.BooleanData(v);
  if (Array.isArray(v)) { const a = new data.Array(); v.forEach((x) => a.add(toData(x))); return a; }
  return new data.Dictionary(...Object.entries(v).map(([key, value]) => ({ key, value: toData(value) })));
}

function evaluate(expr, github) {
  const body = String(expr).trim().replace(/^\$\{\{\s*/, "").replace(/\s*\}\}$/, "");
  const lr = new Lexer(body).lex();
  const tree = new Parser(lr.tokens, ["github"], []).parse();
  const ctx = new data.Dictionary({ key: "github", value: toData(github) });
  return new Evaluator(tree, ctx).evaluate().coerceString();
}

const pr = (over = {}) => ({
  event_name: "pull_request", run_id: 1001,
  event: { action: "synchronize", pull_request: { number: 42, draft: false, ...(over.pull_request ?? {}) } },
  ...over.top,
});
const comment = (body, assoc, over = {}) => ({
  event_name: "issue_comment", run_id: 2002,
  event: { action: "created", issue: { number: 42, pull_request: { url: "x" }, ...(over.issue ?? {}) }, comment: { body, author_association: assoc } },
});

const checks = [];
const check = (name, actual, expected) => checks.push({ name, actual, expected, ok: actual === expected });

// Job `if:` pre-filter.
const runs = (gh) => evaluate(raw.jobIf, gh);
check("A1 collaborator '/ronda review' on a PR runs", runs(comment("/ronda review", "COLLABORATOR")), "true");
check("A2 owner '/RONDA REVIEW' (case-insensitive) runs", runs(comment("/RONDA REVIEW", "OWNER")), "true");
check("A3 unrelated comment by a collaborator does not run", runs(comment("looks good to me", "COLLABORATOR")), "false");
check("A4 '/ronda review' by a non-collaborator does not run", runs(comment("/ronda review", "NONE")), "false");
check("A5 '/ronda review' by a contributor does not run", runs(comment("/ronda review", "CONTRIBUTOR")), "false");
check("A6 '/ronda review' on a plain issue does not run", runs(comment("/ronda review", "COLLABORATOR", { issue: { pull_request: null } })), "false");
check("A7 quoted-then-command comment is not filtered out (never stricter than Ronda)", runs(comment("> earlier\n/ronda review", "MEMBER")), "true");
check("A8 non-draft pull_request runs", runs(pr()), "true");
check("A9 draft pull_request does not run", runs(pr({ pull_request: { draft: true } })), "false");

// Concurrency. A comment run is placed in one of three ways: the PR's own group
// (valid request: serialized with automatic passes), or a group of its own.
const group = (gh) => evaluate(raw.group, gh);
const cancel = (gh) => evaluate(raw.cancel, gh);
const prGroup = group(pr());
const inPrGroup = (gh) => String(group(gh) === prGroup);
const valid = comment("/ronda review", "COLLABORATOR");
check("B1 an unrelated comment is not in the PR's group", inPrGroup(comment("looks good to me", "COLLABORATOR")), "false");
check("B2 the command from a non-collaborator is not in the PR's group", inPrGroup(comment("/ronda review", "NONE")), "false");
check("B3 the command on a plain issue is not in the PR's group", inPrGroup(comment("/ronda review", "COLLABORATOR", { issue: { pull_request: null } })), "false");
check("B4 two unrelated comments on one PR never share a group", String(group(comment("hello", "OWNER")) === group({ ...comment("hello", "OWNER"), run_id: 2003 })), "false");
check("B5 a valid review request joins the PR's group (serialized with automatic passes)", inPrGroup(valid), "true");
check("B6 a valid review request cannot cancel in progress", cancel(valid), "false");
check("B7 an unrelated comment cannot cancel in progress", cancel(comment("hello", "OWNER")), "false");
check("B8 a synchronize push still cancels an in-flight pass", cancel(pr()), "true");
check("B9 reopened does not cancel", cancel(pr({ top: { event: { action: "reopened", pull_request: { number: 42, draft: false } } } })), "false");
check("B10 ready_for_review does not cancel", cancel(pr({ top: { event: { action: "ready_for_review", pull_request: { number: 42, draft: false } } } })), "false");
check("B11 a command that does not begin the comment runs in its own group", inPrGroup(comment("> earlier\n/ronda review", "MEMBER")), "false");

// Trigger wiring.
const on = wf.on ?? wf[true];
check("C1 the workflow subscribes to issue_comment `created`", String(JSON.stringify(on.issue_comment?.types) === '["created"]'), "true");
check("C2 pull_request still targets only develop", String(JSON.stringify(on.pull_request?.branches) === '["develop"]'), "true");
check("C3 pull_request still starts on opened, reopened, ready_for_review, synchronize", String(JSON.stringify(on.pull_request?.types) === '["opened","reopened","ready_for_review","synchronize"]'), "true");

let failed = 0;
console.log(`file: ${file}`);
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  (got ${c.actual}, want ${c.expected})`);
  if (!c.ok) failed++;
}
console.log(`${checks.length - failed}/${checks.length} pass`);
process.exit(failed ? 1 : 0);
```

</details>

### Result on the workflow as committed

23 of 23 assertions pass. The last column lists the plants (next
section) under which each assertion fails, so every assertion is shown able to
fail.

| Id | Assertion | Fails under plant |
| --- | --- | --- |
| A1 | collaborator '/ronda review' on a PR runs | 5, 6 |
| A2 | owner '/RONDA REVIEW' (case-insensitive) runs | 6, 9 |
| A3 | unrelated comment by a collaborator does not run | 1 |
| A4 | '/ronda review' by a non-collaborator does not run | 2 |
| A5 | '/ronda review' by a contributor does not run | 2 |
| A6 | '/ronda review' on a plain issue does not run | 3 |
| A7 | quoted-then-command comment is not filtered out (never stricter than Ronda) | 6, 7 |
| A8 | non-draft pull_request runs | 8 |
| A9 | draft pull_request does not run | 4 |
| B1 | an unrelated comment is not in the PR's group | 10, 14 |
| B2 | the command from a non-collaborator is not in the PR's group | 11, 14 |
| B3 | the command on a plain issue is not in the PR's group | 12, 14 |
| B4 | two unrelated comments on one PR never share a group | 10, 14 |
| B5 | a valid review request joins the PR's group (serialized with automatic passes) | 13 |
| B6 | a valid review request cannot cancel in progress | 16 |
| B7 | an unrelated comment cannot cancel in progress | 16 |
| B8 | a synchronize push still cancels an in-flight pass | 17 |
| B9 | reopened does not cancel | 16, 18 |
| B10 | ready_for_review does not cancel | 16, 18 |
| B11 | a command that does not begin the comment runs in its own group | 10, 14, 15 |
| C1 | the workflow subscribes to issue_comment `created` | 19, 20 |
| C2 | pull_request still targets only develop | 21 |
| C3 | pull_request still starts on opened, reopened, ready_for_review, synchronize | 22 |

### Planted violations

Each plant is a single edit to a copy of the workflow; with it applied the
assertions in the last column fail and the rest still pass. Line numbers are
those of the committed workflow.

| Plant | Violation | Edit | Fails |
| --- | --- | --- | --- |
| 1 | Job `if:`: comment filter dropped | line 97: `contains(body, '/ronda review') &&` becomes `true &&` | A3 |
| 2 | Job `if:`: association check dropped | line 98: the association `contains(...)` term becomes `true` | A4, A5 |
| 3 | Job `if:`: pull-request-only gate dropped | line 96: `issue.pull_request != null &&` becomes `true &&` | A6 |
| 4 | Job `if:`: draft gate dropped (existing behaviour, re-asserted) | line 94: `draft != true` becomes `true` | A9 |
| 5 | Job `if:`: COLLABORATOR rejected | line 98: the association list loses `COLLABORATOR` | A1 |
| 6 | Job `if:`: wrong command literal | line 97: `'/ronda review'` becomes `'/ronda-review'` | A1, A2, A7 |
| 7 | Job `if:`: `startsWith` instead of `contains` | line 97: `contains(body, ...)` becomes `startsWith(body, ...)` | A7 |
| 8 | Job `if:`: pull_request never runs | line 94: `draft != true` becomes `false` | A8 |
| 9 | Job `if:`: OWNER rejected | line 98: the association list loses `OWNER` | A2 |
| 10 | Group routing: command test dropped | line 65: `startsWith(body, ...)` becomes `true` | B1, B4, B11 |
| 11 | Group routing: association test dropped | line 66: the association `contains(...)` term becomes `true` | B2 |
| 12 | Group routing: pull-request-only gate dropped | line 64: `issue.pull_request != null` becomes `true` | B3 |
| 13 | Group routing: valid requests get their own group (the pre-serialization design) | line 67: the shared-group `format(...)` becomes the per-run one | B5 |
| 14 | Group routing: every comment shares the PR's group (the old snippet) | line 68: the fallback per-run group becomes the PR's group | B1, B2, B3, B4, B11 |
| 15 | Group routing: `contains` instead of `startsWith` | line 65: `startsWith(body, ...)` becomes `contains(body, ...)` | B11 |
| 16 | Cancellation: everything cancels | line 75: the expression becomes `true` | B6, B7, B9, B10 |
| 17 | Cancellation: nothing cancels | line 75: the expression becomes `false` | B8 |
| 18 | Cancellation: reopened and ready_for_review cancel | line 75: `action == 'synchronize'` becomes `action != 'opened'` | B9, B10 |
| 19 | Wiring: `issue_comment` subscription removed | lines 31-32: lines 31-32 deleted | C1 |
| 20 | Wiring: wrong comment action | line 32: `types: [created]` becomes `types: [edited]` | C1 |
| 21 | Wiring: automatic passes retargeted | line 29: `- develop` becomes `- main` | C2 |
| 22 | Wiring: automatic passes lose actions | line 30: the `types` list becomes `[opened, synchronize]` | C3 |

Harness output for each plant (`FAIL` ids and the pass count):

```text
plant  1: FAIL A3                 22/23 pass
plant  2: FAIL A4, A5             21/23 pass
plant  3: FAIL A6                 22/23 pass
plant  4: FAIL A9                 22/23 pass
plant  5: FAIL A1                 22/23 pass
plant  6: FAIL A1, A2, A7         20/23 pass
plant  7: FAIL A7                 22/23 pass
plant  8: FAIL A8                 22/23 pass
plant  9: FAIL A2                 22/23 pass
plant 10: FAIL B1, B4, B11        20/23 pass
plant 11: FAIL B2                 22/23 pass
plant 12: FAIL B3                 22/23 pass
plant 13: FAIL B5                 22/23 pass
plant 14: FAIL B1, B2, B3, B4, B11 18/23 pass
plant 15: FAIL B11                22/23 pass
plant 16: FAIL B6, B7, B9, B10    19/23 pass
plant 17: FAIL B8                 22/23 pass
plant 18: FAIL B9, B10            21/23 pass
plant 19: FAIL C1                 22/23 pass
plant 20: FAIL C1                 22/23 pass
plant 21: FAIL C2                 22/23 pass
plant 22: FAIL C3                 22/23 pass
```

The case-insensitivity in A2 is a property of the Actions evaluator (`contains`
and `==` ignore case), not of a line in the workflow, so plant 9 isolates the
`OWNER` acceptance that A2 exercises rather than the casing.

Not isolated, and stated rather than hidden: the `github.event_name ==
'pull_request'` conjunct in line 75 is defence in depth. A comment run's
`github.event.action` is `created`, never `synchronize`, so removing that
conjunct changes no result and no plant can isolate it.

## Runtime proof (after merge, still owed)

The expression proof cannot show that GitHub queues a valid request behind an
in-flight pass, keeps an unrelated comment from cancelling or displacing one,
starts the `issue_comment` workflow from a collaborator's comment at all, or that
Ronda publishes on the current head. These need real runs, recorded here as
workflow-run ids once this PR is on `develop`:

| Assertion | Plant (violation present) | Run id | Without the plant | Run id |
| --- | --- | --- | --- | --- |
| Collaborator `/ronda review` produces a pass on the current head | not applicable (positive case) | _pending_ | | |
| Unrelated comment does not start a pass | | _pending_ | | |
| Non-collaborator `/ronda review` does not start a pass | | _pending_ | | |
| Comment on a plain issue does not start a pass | | _pending_ | | |
| Unrelated comment during an in-flight `pull_request` pass does not cancel or displace it | plant 14 (every comment in the PR's group) | _pending_ | committed group | _pending_ |
| Valid request during an in-flight pass waits for it, then publishes one `Ronda review` check run | plant 13 (own group, runs alongside) | _pending_ | committed group | _pending_ |

The stale statements in [`dogfood-evidence-103.md`](dogfood-evidence-103.md)
(the "Manual rerun" row, and wiring defects 1 and 2) were corrected in this PR.
