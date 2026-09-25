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
- a comment the job `if:` would run (on a PR, containing `/ronda review`, from an
  `OWNER`, `MEMBER` or `COLLABORATOR`): the same PR group, never cancelling. It
  queues behind an in-flight pass, so two passes on one head SHA never run
  together and an older pass cannot finish last and overwrite a newer result;
- **any other comment**: a group of its own, so it cannot cancel, queue behind or
  displace anything before the job `if:` skips it.

The routing test is the job `if:`'s comment test, so every command form Ronda
accepts (after leading whitespace, after a blank or quoted line) is serialized.
It is not exact: a comment that merely contains the phrase, such as
`/ronda review later`, also enters the group and Ronda then skips it (assertion
B15). That is accepted because `cancel-in-progress` is true only for
`synchronize`, so a queued run in the PR's group is only ever a `reopened` or
`ready_for_review` pass on the same head SHA, which would have skipped on the
running pass's check run, or an earlier request that the newer one replaces with
the same intent; a push cancels and replaces the queue itself.

Two earlier versions were rejected by the local reviewer and are kept as plants.
Giving every comment its own group let a manual pass run alongside an automatic
one on the same head SHA (plant 13). Routing on an exact or prefix match left
accepted forms, such as a command after leading whitespace or a quoted line,
outside the group and so unserialized (plants 15 and 16); it was traded for the
harmless displacement above.

## Expression proof

Evaluator: `@actions/expressions` 0.3.61 (GitHub's published implementation of
the Actions expression language), run outside the repository so no dependency is
added to it. The harness reads the expressions **from the workflow file under
test**, so a plant is an edit to that file.

Reproduce, from an empty scratch directory:

<!-- workflow-shell-contract: bash-zsh -->
```bash
set -euo pipefail
npm init -y
npm i @actions/expressions@0.3.61 yaml
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
check("B11 a command after a quoted line joins the PR's group (an accepted form is serialized)", inPrGroup(comment("> earlier\n/ronda review", "MEMBER")), "true");
check("B12 a command after leading whitespace joins the PR's group", inPrGroup(comment(" /ronda review", "COLLABORATOR")), "true");
check("B13 the command followed by more lines joins the PR's group", inPrGroup(comment("/ronda review\nthanks", "COLLABORATOR")), "true");
check("B14 the command in any case with a CRLF ending joins the PR's group", inPrGroup(comment("/RONDA REVIEW\r\nthanks", "COLLABORATOR")), "true");
check("B15 a comment that merely contains the phrase also joins the group (accepted cost; Ronda then skips it)", inPrGroup(comment("/ronda review later", "COLLABORATOR")), "true");

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

27 of 27 assertions pass. The last column lists the plants (next
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
| B6 | a valid review request cannot cancel in progress | 17 |
| B7 | an unrelated comment cannot cancel in progress | 17 |
| B8 | a synchronize push still cancels an in-flight pass | 18 |
| B9 | reopened does not cancel | 17, 19 |
| B10 | ready_for_review does not cancel | 17, 19 |
| B11 | a command after a quoted line joins the PR's group (an accepted form is serialized) | 13, 15, 16 |
| B12 | a command after leading whitespace joins the PR's group | 13, 15, 16 |
| B13 | the command followed by more lines joins the PR's group | 13, 16 |
| B14 | the command in any case with a CRLF ending joins the PR's group | 13, 16 |
| B15 | a comment that merely contains the phrase also joins the group (accepted cost; Ronda then skips it) | 13, 16 |
| C1 | the workflow subscribes to issue_comment `created` | 20, 21 |
| C2 | pull_request still targets only develop | 22 |
| C3 | pull_request still starts on opened, reopened, ready_for_review, synchronize | 23 |

### Planted violations

Each plant is a single edit to a copy of the workflow; with it applied the
assertions in the last column fail and the rest still pass. Line numbers are
those of the committed workflow.

| Plant | Violation | Edit | Fails |
| --- | --- | --- | --- |
| 1 | Job `if:`: comment filter dropped | line 98: `contains(body, '/ronda review') &&` becomes `true &&` | A3 |
| 2 | Job `if:`: association check dropped | line 99: the association `contains(...)` term becomes `true` | A4, A5 |
| 3 | Job `if:`: pull-request-only gate dropped | line 97: `issue.pull_request != null &&` becomes `true &&` | A6 |
| 4 | Job `if:`: draft gate dropped (existing behaviour, re-asserted) | line 95: `draft != true` becomes `true` | A9 |
| 5 | Job `if:`: COLLABORATOR rejected | line 99: the association list loses `COLLABORATOR` | A1 |
| 6 | Job `if:`: wrong command literal | line 98: `'/ronda review'` becomes `'/ronda-review'` | A1, A2, A7 |
| 7 | Job `if:`: `startsWith` instead of `contains` | line 98: `contains(body, ...)` becomes `startsWith(body, ...)` | A7 |
| 8 | Job `if:`: pull_request never runs | line 95: `draft != true` becomes `false` | A8 |
| 9 | Job `if:`: OWNER rejected | line 99: the association list loses `OWNER` | A2 |
| 10 | Group routing: command test dropped | line 66: the command `contains(...)` term becomes `true` | B1, B4 |
| 11 | Group routing: association test dropped | line 67: the association `contains(...)` term becomes `true` | B2 |
| 12 | Group routing: pull-request-only gate dropped | line 65: `issue.pull_request != null` becomes `true` | B3 |
| 13 | Group routing: valid requests get their own group (the pre-serialization design) | line 68: the shared-group `format(...)` becomes the per-run one | B5, B11, B12, B13, B14, B15 |
| 14 | Group routing: every comment shares the PR's group (the old snippet) | line 69: the fallback per-run group becomes the PR's group | B1, B2, B3, B4 |
| 15 | Group routing: prefix match, so accepted forms escape serialization | line 66: `contains(body, ...)` becomes `startsWith(body, ...)` | B11, B12 |
| 16 | Group routing: exact match, so accepted forms escape serialization | line 66: `contains(body, ...)` becomes `body == '/ronda review'` | B11, B12, B13, B14, B15 |
| 17 | Cancellation: everything cancels | line 76: the expression becomes `true` | B6, B7, B9, B10 |
| 18 | Cancellation: nothing cancels | line 76: the expression becomes `false` | B8 |
| 19 | Cancellation: reopened and ready_for_review cancel | line 76: `action == 'synchronize'` becomes `action != 'opened'` | B9, B10 |
| 20 | Wiring: `issue_comment` subscription removed | lines 31-32: deleted | C1 |
| 21 | Wiring: wrong comment action | line 32: `types: [created]` becomes `types: [edited]` | C1 |
| 22 | Wiring: automatic passes retargeted | line 29: `- develop` becomes `- main` | C2 |
| 23 | Wiring: automatic passes lose actions | line 30: the `types` list becomes `[opened, synchronize]` | C3 |

Harness output for each plant (`FAIL` ids and the pass count):

```text
plant  1: FAIL A3                 26/27 pass
plant  2: FAIL A4, A5             25/27 pass
plant  3: FAIL A6                 26/27 pass
plant  4: FAIL A9                 26/27 pass
plant  5: FAIL A1                 26/27 pass
plant  6: FAIL A1, A2, A7         24/27 pass
plant  7: FAIL A7                 26/27 pass
plant  8: FAIL A8                 26/27 pass
plant  9: FAIL A2                 26/27 pass
plant 10: FAIL B1, B4             25/27 pass
plant 11: FAIL B2                 26/27 pass
plant 12: FAIL B3                 26/27 pass
plant 13: FAIL B5, B11, B12, B13, B14, B15 21/27 pass
plant 14: FAIL B1, B2, B3, B4     23/27 pass
plant 15: FAIL B11, B12           25/27 pass
plant 16: FAIL B11, B12, B13, B14, B15 22/27 pass
plant 17: FAIL B6, B7, B9, B10    23/27 pass
plant 18: FAIL B8                 26/27 pass
plant 19: FAIL B9, B10            25/27 pass
plant 20: FAIL C1                 26/27 pass
plant 21: FAIL C1                 26/27 pass
plant 22: FAIL C2                 26/27 pass
plant 23: FAIL C3                 26/27 pass
```

The case-insensitivity in A2 is a property of the Actions evaluator (`contains`
and `==` ignore case), not of a line in the workflow, so plant 9 isolates the
`OWNER` acceptance that A2 exercises rather than the casing.

Not isolated, and stated rather than hidden: the `github.event_name ==
'pull_request'` conjunct in line 76 is defence in depth. A comment run's
`github.event.action` is `created`, never `synchronize`, so removing that
conjunct changes no result and no plant can isolate it.

### Routing against Ronda's parser

Two properties tie the group routing to what Ronda actually accepts, checked by
running the workflow's group expression and Ronda's own `matchesReviewCommand`
(`src/cli/resolve-trigger.ts`) over 22 comment bodies from a collaborator on a
PR, including trailing text, longer words, leading whitespace, blank and quoted
first lines, CR and CRLF endings, a byte-order mark and the empty comment:

- **P1** every body Ronda accepts is admitted to the shared group, so no valid
  review request runs unserialized;
- **P2** every admitted body contains the phrase, so a comment without it never
  enters the group.

The converse of P1 is deliberately not required (see assertion B15).

Run from the scratch directory above with the repository's `tsx`:

<!-- workflow-shell-contract: bash-zsh -->
```bash
set -euo pipefail
RONDA=/path/to/ronda   # your checkout, after `npm ci`
"$RONDA/node_modules/.bin/tsx" cross.mts "$RONDA/.github/workflows/ronda-review-dogfood.yml" "$RONDA"
```

<details>
<summary>cross.mts</summary>

```ts
// Properties, over a fixed list of comment bodies (all from a COLLABORATOR on a PR):
//   P1  every body Ronda's own parser accepts is admitted to the shared PR group,
//       so no valid review request runs unserialized;
//   P2  every admitted body contains the phrase, so a comment without it never
//       enters the group (it could otherwise displace a queued pass).
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { Parser, Lexer, Evaluator, data } from "@actions/expressions";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
// Usage: tsx cross.mts <workflow.yml> <path to the ronda checkout>
const [workflowPath, repoRoot] = process.argv.slice(2);
if (!workflowPath || !repoRoot) throw new Error("usage: tsx cross.mts <workflow.yml> <ronda checkout>");
const { matchesReviewCommand } = await import(pathToFileURL(resolve(repoRoot, "src/cli/resolve-trigger.ts")).href);
const wf = parse(readFileSync(workflowPath, "utf8"));
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
  const p1 = !r || a; // Ronda accepts => admitted
  const p2 = !a || b.toLowerCase().includes("/ronda review"); // admitted => contains the phrase
  const ok = p1 && p2;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "BAD "} admitted=${a} ronda=${r} ${JSON.stringify(b)}`);
}
console.log(bad ? `${bad} violation(s)` : "P1 and P2 hold for every body");
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
ok   admitted=true ronda=false "/ronda review later"
ok   admitted=true ronda=false "/ronda reviewer"
ok   admitted=true ronda=false "/ronda review."
ok   admitted=true ronda=true " /ronda review"
ok   admitted=true ronda=true "\n/ronda review"
ok   admitted=true ronda=true "> q\n/ronda review"
ok   admitted=true ronda=false "please /ronda review"
ok   admitted=false ronda=false "/ronda  review"
ok   admitted=true ronda=true "/ronda review \n"
ok   admitted=true ronda=true "/ronda review\t"
ok   admitted=false ronda=false ""
ok   admitted=false ronda=false "looks good"
ok   admitted=false ronda=false "/ronda"
ok   admitted=true ronda=true "/ronda review\r"
ok   admitted=true ronda=true "﻿/ronda review"
ok   admitted=true ronda=false "//ronda review"
P1 and P2 hold for every body
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
