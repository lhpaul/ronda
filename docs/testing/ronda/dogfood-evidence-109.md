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
- a **valid review request** (a PR comment whose first line is exactly
  `/ronda review`, from an `OWNER`, `MEMBER` or `COLLABORATOR`): the same PR
  group, never cancelling.
  It queues behind an in-flight pass, so two passes on one head SHA never run
  together and an older pass cannot finish last and overwrite a newer result;
- **any other comment**: a group of its own, so it cannot cancel, queue behind or
  displace anything before the job `if:` skips it.

Two earlier versions were rejected by the local reviewer and are kept as plants:
giving every comment its own group let a manual pass run alongside an automatic
one on the same head SHA (plant 13); routing on `startsWith` also admitted
`/ronda review later`, which Ronda skips, into the shared group (plant 15).

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
check("B12 the command with trailing text on its line is not in the PR's group", inPrGroup(comment("/ronda review later", "COLLABORATOR")), "false");
check("B13 a longer word starting with the command is not in the PR's group", inPrGroup(comment("/ronda reviewer", "COLLABORATOR")), "false");
check("B14 the command followed by more lines joins the PR's group", inPrGroup(comment("/ronda review\nthanks", "COLLABORATOR")), "true");
check("B15 the command in any case with a CRLF line ending joins the PR's group", inPrGroup(comment("/RONDA REVIEW\r\nthanks", "COLLABORATOR")), "true");
check("B16 a command after leading whitespace runs in its own group", inPrGroup(comment(" /ronda review", "COLLABORATOR")), "false");
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

28 of 28 assertions pass. The last column lists the plants (next
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
| B5 | a valid review request joins the PR's group (serialized with automatic passes) | 13, 19 |
| B12 | the command with trailing text on its line is not in the PR's group | 10, 14, 15, 16 |
| B13 | a longer word starting with the command is not in the PR's group | 10, 14, 15, 16 |
| B14 | the command followed by more lines joins the PR's group | 13, 17 |
| B15 | the command in any case with a CRLF line ending joins the PR's group | 13, 18 |
| B16 | a command after leading whitespace runs in its own group | 10, 14, 16 |
| B6 | a valid review request cannot cancel in progress | 20 |
| B7 | an unrelated comment cannot cancel in progress | 20 |
| B8 | a synchronize push still cancels an in-flight pass | 21 |
| B9 | reopened does not cancel | 20, 22 |
| B10 | ready_for_review does not cancel | 20, 22 |
| B11 | a command that does not begin the comment runs in its own group | 10, 14, 16 |
| C1 | the workflow subscribes to issue_comment `created` | 23, 24 |
| C2 | pull_request still targets only develop | 25 |
| C3 | pull_request still starts on opened, reopened, ready_for_review, synchronize | 26 |

### Planted violations

Each plant is a single edit to a copy of the workflow; with it applied the
assertions in the last column fail and the rest still pass. Line numbers are
those of the committed workflow.

| Plant | Violation | Edit | Fails |
| --- | --- | --- | --- |
| 1 | Job `if:`: comment filter dropped | line 103: `contains(body, '/ronda review') &&` becomes `true &&` | A3 |
| 2 | Job `if:`: association check dropped | line 104: the association `contains(...)` term becomes `true` | A4, A5 |
| 3 | Job `if:`: pull-request-only gate dropped | line 102: `issue.pull_request != null &&` becomes `true &&` | A6 |
| 4 | Job `if:`: draft gate dropped (existing behaviour, re-asserted) | line 100: `draft != true` becomes `true` | A9 |
| 5 | Job `if:`: COLLABORATOR rejected | line 104: the association list loses `COLLABORATOR` | A1 |
| 6 | Job `if:`: wrong command literal | line 103: `'/ronda review'` becomes `'/ronda-review'` | A1, A2, A7 |
| 7 | Job `if:`: `startsWith` instead of `contains` | line 103: `contains(body, ...)` becomes `startsWith(body, ...)` | A7 |
| 8 | Job `if:`: pull_request never runs | line 100: `draft != true` becomes `false` | A8 |
| 9 | Job `if:`: OWNER rejected | line 104: the association list loses `OWNER` | A2 |
| 10 | Group routing: command test dropped | line 69: the exact-command term becomes `true` | B1, B4, B12, B13, B16, B11 |
| 11 | Group routing: association test dropped | line 72: the association `contains(...)` term becomes `true` | B2 |
| 12 | Group routing: pull-request-only gate dropped | line 68: `issue.pull_request != null` becomes `true` | B3 |
| 13 | Group routing: valid requests get their own group (the pre-serialization design) | line 73: the shared-group `format(...)` becomes the per-run one | B5, B14, B15 |
| 14 | Group routing: every comment shares the PR's group (the old snippet) | line 74: the fallback per-run group becomes the PR's group | B1, B2, B3, B4, B12, B13, B16, B11 |
| 15 | Group routing: prefix match instead of exact first line | line 69: the exact-command term becomes `startsWith(body, '/ronda review')` | B12, B13 |
| 16 | Group routing: substring match instead of exact first line | line 69: the exact-command term becomes `contains(body, '/ronda review')` | B12, B13, B16, B11 |
| 17 | Group routing: LF-terminated first line not admitted | line 70: the `\n` term becomes `false` | B14 |
| 18 | Group routing: CRLF-terminated first line not admitted | line 71: the `\r\n` term becomes `false` | B15 |
| 19 | Group routing: a command that is the whole comment not admitted | line 69: the exact-command term becomes `false` | B5 |
| 20 | Cancellation: everything cancels | line 81: the expression becomes `true` | B6, B7, B9, B10 |
| 21 | Cancellation: nothing cancels | line 81: the expression becomes `false` | B8 |
| 22 | Cancellation: reopened and ready_for_review cancel | line 81: `action == 'synchronize'` becomes `action != 'opened'` | B9, B10 |
| 23 | Wiring: `issue_comment` subscription removed | lines 31-32: deleted | C1 |
| 24 | Wiring: wrong comment action | line 32: `types: [created]` becomes `types: [edited]` | C1 |
| 25 | Wiring: automatic passes retargeted | line 29: `- develop` becomes `- main` | C2 |
| 26 | Wiring: automatic passes lose actions | line 30: the `types` list becomes `[opened, synchronize]` | C3 |

Harness output for each plant (`FAIL` ids and the pass count):

```text
plant  1: FAIL A3                 27/28 pass
plant  2: FAIL A4, A5             26/28 pass
plant  3: FAIL A6                 27/28 pass
plant  4: FAIL A9                 27/28 pass
plant  5: FAIL A1                 27/28 pass
plant  6: FAIL A1, A2, A7         25/28 pass
plant  7: FAIL A7                 27/28 pass
plant  8: FAIL A8                 27/28 pass
plant  9: FAIL A2                 27/28 pass
plant 10: FAIL B1, B4, B12, B13, B16, B11 22/28 pass
plant 11: FAIL B2                 27/28 pass
plant 12: FAIL B3                 27/28 pass
plant 13: FAIL B5, B14, B15       25/28 pass
plant 14: FAIL B1, B2, B3, B4, B12, B13, B16, B11 20/28 pass
plant 15: FAIL B12, B13           26/28 pass
plant 16: FAIL B12, B13, B16, B11 24/28 pass
plant 17: FAIL B14                27/28 pass
plant 18: FAIL B15                27/28 pass
plant 19: FAIL B5                 27/28 pass
plant 20: FAIL B6, B7, B9, B10    24/28 pass
plant 21: FAIL B8                 27/28 pass
plant 22: FAIL B9, B10            26/28 pass
plant 23: FAIL C1                 27/28 pass
plant 24: FAIL C1                 27/28 pass
plant 25: FAIL C2                 27/28 pass
plant 26: FAIL C3                 27/28 pass
```

The case-insensitivity in A2 is a property of the Actions evaluator (`contains`
and `==` ignore case), not of a line in the workflow, so plant 9 isolates the
`OWNER` acceptance that A2 exercises rather than the casing.

Not isolated, and stated rather than hidden: the `github.event_name ==
'pull_request'` conjunct in line 81 is defence in depth. A comment run's
`github.event.action` is `created`, never `synchronize`, so removing that
conjunct changes no result and no plant can isolate it.

### Routing is never looser than Ronda's parser

A comment Ronda would skip must not enter the shared group, or it could displace
a queued pass and then do nothing. This property test runs the workflow's group
expression and Ronda's own `matchesReviewCommand` (`src/cli/resolve-trigger.ts`)
over 22 comment bodies, including trailing text, longer words, leading
whitespace, blank and quoted first lines, CR and CRLF endings, a byte-order mark
and the empty comment, and requires: admitted to the shared group implies Ronda
accepts. The reverse is deliberately not required, so a valid command after
whitespace or a quoted line runs in a group of its own (assertion B16, B11).

Run from the scratch directory above with the repository's `tsx`:

```bash
/path/to/ronda/node_modules/.bin/tsx cross.mts /path/to/.github/workflows/ronda-review-dogfood.yml
```

<details>
<summary>cross.mts</summary>

```ts
// Property: every comment body the routing expression admits to the shared PR
// group is one Ronda's own parser accepts (routing is never looser than Ronda).
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { Parser, Lexer, Evaluator, data } from "@actions/expressions";
import { matchesReviewCommand } from "/Users/lhpaul/Git/ronda/src/cli/resolve-trigger.ts";
const wf = parse(readFileSync(process.argv[2], "utf8"));
const expr = String(wf.concurrency.group).trim().replace(/^\$\{\{\s*/, "").replace(/\s*\}\}$/, "");
const tree = new Parser(new Lexer(expr).lex().tokens, ["github"], []).parse();
const S = (v: string) => new data.StringData(v);
const D = (o: Record<string, any>) => new data.Dictionary(...Object.entries(o).map(([key, value]) => ({ key, value })));
const admitted = (body: string) => {
  const gh = D({ event_name: S("issue_comment"), run_id: new data.NumberData(1),
    event: D({ issue: D({ number: new data.NumberData(42), pull_request: D({ url: S("x") }) }),
      comment: D({ body: S(body), author_association: S("OWNER") }) }) });
  return new Evaluator(tree, D({ github: gh })).evaluate().coerceString() === "ronda-review-42";
};
const bodies = ["/ronda review", "/RONDA REVIEW", "/ronda review\n", "/ronda review\nthanks", "/ronda review\r\nthanks", "/Ronda Review\r\n",
  "/ronda review later", "/ronda reviewer", "/ronda review.", " /ronda review", "\n/ronda review", "> q\n/ronda review", "please /ronda review",
  "/ronda  review", "/ronda review \n", "/ronda review\t", "", "looks good", "/ronda", "/ronda review\r", "﻿/ronda review", "//ronda review"];
let bad = 0;
for (const b of bodies) {
  const a = admitted(b), r = matchesReviewCommand(b);
  const ok = !a || r; // admitted => Ronda accepts
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "BAD "} admitted=${a} ronda=${r} ${JSON.stringify(b)}`);
}
console.log(bad ? `${bad} violation(s)` : "routing is never looser than Ronda's parser");
process.exit(bad ? 1 : 0);
```

</details>

Output on the committed workflow:

```text
ok   admitted=true ronda=true "/ronda review"
ok   admitted=true ronda=true "/RONDA REVIEW"
ok   admitted=true ronda=true "/ronda review\n"
ok   admitted=true ronda=true "/ronda review\nthanks"
ok   admitted=true ronda=true "/ronda review\r\nthanks"
ok   admitted=true ronda=true "/Ronda Review\r\n"
ok   admitted=false ronda=false "/ronda review later"
ok   admitted=false ronda=false "/ronda reviewer"
ok   admitted=false ronda=false "/ronda review."
ok   admitted=false ronda=true " /ronda review"
ok   admitted=false ronda=true "\n/ronda review"
ok   admitted=false ronda=true "> q\n/ronda review"
ok   admitted=false ronda=false "please /ronda review"
ok   admitted=false ronda=false "/ronda  review"
ok   admitted=false ronda=true "/ronda review \n"
ok   admitted=false ronda=true "/ronda review\t"
ok   admitted=false ronda=false ""
ok   admitted=false ronda=false "looks good"
ok   admitted=false ronda=false "/ronda"
ok   admitted=false ronda=true "/ronda review\r"
ok   admitted=false ronda=true "﻿/ronda review"
ok   admitted=false ronda=false "//ronda review"
routing is never looser than Ronda's parser
```

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
