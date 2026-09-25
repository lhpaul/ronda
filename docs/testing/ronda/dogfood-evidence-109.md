# Comment-Trigger Evidence: #109

Evidence for [#109](https://github.com/lhpaul/ronda/issues/109) (epic
[#52](https://github.com/lhpaul/ronda/issues/52)): the `/ronda review` comment
trigger in `.github/workflows/ronda-review-dogfood.yml` and the corrected
caller snippet in
[`ronda-review-adoption.md`](../../adoption/ronda-review-adoption.md).

Two kinds of proof, kept apart because they prove different things:

1. **Expression proof (this PR).** The workflow's job `if:`, `concurrency.group`
   and `cancel-in-progress` expressions, evaluated with GitHub's own evaluator
   against synthetic event payloads, each with an isolating planted violation.
   It proves the expressions decide as intended. It does **not** prove how GitHub
   schedules runs.
2. **Runtime proof (after merge, still owed).** Real workflow runs from real
   comments. `issue_comment` workflows load from the default branch (`develop`),
   so the PR that adds the trigger cannot exercise it. Issue #109 stays open
   until section "Runtime proof" is filled with run ids.

## Expression proof

Evaluator: `@actions/expressions` 0.3.61 (GitHub's published implementation of
the Actions expression language), run outside the repository so no dependency is
added to it. The harness reads the three expressions **from the workflow file
under test**, so a plant is an edit to that file.

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

// Concurrency.
const group = (gh) => evaluate(raw.group, gh);
const cancel = (gh) => evaluate(raw.cancel, gh);
const prGroup = group(pr());
const commentGroup = group(comment("/ronda review", "OWNER"));
check("B1 comment run never shares a group with the pull_request pass for the same PR", String(commentGroup === prGroup), "false");
check("B2 two comment runs on one PR never share a group", String(group(comment("/ronda review", "OWNER")) === group({ ...comment("/ronda review", "OWNER"), run_id: 2003 })), "false");
check("B3 a comment run cannot cancel in progress", cancel(comment("/ronda review", "OWNER")), "false");
check("B4 a synchronize push still cancels an in-flight pass", cancel(pr()), "true");
check("B5 reopened does not cancel", cancel(pr({ top: { event: { action: "reopened", pull_request: { number: 42, draft: false } } } })), "false");
check("B6 ready_for_review does not cancel", cancel(pr({ top: { event: { action: "ready_for_review", pull_request: { number: 42, draft: false } } } })), "false");

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

18 of 18 assertions pass.

| Id | Assertion | Expression under test |
| --- | --- | --- |
| A1, A2 | A collaborator's `/ronda review` (any case) on a PR runs | job `if:`, lines 76-81 |
| A3 | An unrelated comment by a collaborator does not run | line 80 |
| A4, A5 | The command from a non-collaborator or a contributor does not run | line 81 |
| A6 | The command on a plain issue (not a PR) does not run | line 79 |
| A7 | A quoted line before the command is not filtered out (the pre-filter is never stricter than `resolve-trigger.ts`) | line 80 |
| A8, A9 | A non-draft `pull_request` runs, a draft does not | line 77 |
| B1, B2 | A comment run never shares a concurrency group with the PR pass, nor with another comment run | `group`, lines 48-51 |
| B3 | A comment run cannot cancel in progress | `cancel-in-progress`, line 58 |
| B4 | A `synchronize` push still cancels an in-flight pass | line 58 |
| B5, B6 | `reopened` and `ready_for_review` do not cancel | line 58 |
| C1 | The workflow subscribes to `issue_comment` `created` | `on.issue_comment`, lines 31-32 |
| C2, C3 | `pull_request` still targets only `develop` and the same four actions | `on.pull_request`, lines 27-30 |

### Planted violations, one per assertion

Each plant is a single edit to a copy of the workflow. On the committed file all
18 assertions pass (the baseline above); with a plant applied, the assertions in
the last column fail and the rest still pass. Together the plants make every
assertion fail at least once, so none is vacuous. Line numbers are those of the
committed workflow.

| Plant | Violation | Edit | Fails |
| --- | --- | --- | --- |
| 1 | Comment pre-filter dropped | line 80: `contains(github.event.comment.body, '/ronda review') &&` becomes `true &&` | A3 |
| 2 | Association check dropped | line 81: the `contains(fromJSON('[...]'), ...author_association)` term becomes `true)` | A4, A5 |
| 3 | Pull-request-only gate dropped | line 79: `github.event.issue.pull_request != null &&` becomes `true &&` | A6 |
| 4 | Draft gate dropped (existing behaviour, re-asserted) | line 77: `github.event.pull_request.draft != true` becomes `true` | A9 |
| 5 | Shared concurrency group | lines 50-51: both branches become `format('ronda-review-{0}', pull_request.number || issue.number)`, the group the old snippet used | B1, B2 |
| 6 | A comment run may cancel | line 58: the expression becomes `true` | B3, B5, B6 |
| 7 | Trigger subscription removed | lines 31-32: the `issue_comment` key and its `types` are deleted | C1 |
| 8 | Wrong comment action | line 32: `types: [created]` becomes `types: [edited]` | C1 |
| 9 | Over-restrictive: COLLABORATOR rejected | line 81: the list `["OWNER","MEMBER","COLLABORATOR"]` loses `COLLABORATOR` | A1 |
| 10 | Over-restrictive: wrong command literal | line 80: `'/ronda review'` becomes `'/ronda-review'` | A1, A2, A7 |
| 11 | Over-restrictive: `startsWith` instead of `contains` | line 80: `contains(body, ...)` becomes `startsWith(body, ...)` | A7 |
| 12 | Over-restrictive: nothing ever cancels | line 58: the expression becomes `false` | B4 |
| 13 | Over-restrictive: pull_request never runs | line 77: `github.event.pull_request.draft != true` becomes `false` | A8 |
| 14 | Over-restrictive: OWNER rejected | line 81: the list loses `OWNER` | A2 |
| 15 | Over-cancelling: reopened and ready_for_review cancel | line 58: the expression becomes `event_name == 'pull_request' && action != 'opened'` | B5, B6 |
| 16 | Automatic passes retargeted | line 29: `- develop` becomes `- main` | C2 |
| 17 | Automatic passes lose actions | line 30: the `types` list becomes `[opened, synchronize]` | C3 |

Coverage by assertion: A1 plants 9, 10; A2 plant 14; A3 plant 1; A4 and A5
plant 2; A6 plant 3; A7 plants 10, 11; A8 plant 13; A9 plant 4; B1 and B2
plant 5; B3 plant 6; B4 plant 12; B5 and B6 plants 6, 15; C1 plants 7, 8; C2
plant 16; C3 plant 17.

Harness output for each plant (`FAIL` ids and the pass count):

```text
plant  1: FAIL A3         17/18 pass
plant  2: FAIL A4, A5     16/18 pass
plant  3: FAIL A6         17/18 pass
plant  4: FAIL A9         17/18 pass
plant  5: FAIL B1, B2     16/18 pass
plant  6: FAIL B3, B5, B6 15/18 pass
plant  7: FAIL C1         17/18 pass
plant  8: FAIL C1         17/18 pass
plant  9: FAIL A1         17/18 pass
plant 10: FAIL A1, A2, A7 15/18 pass
plant 11: FAIL A7         17/18 pass
plant 12: FAIL B4         17/18 pass
plant 13: FAIL A8         17/18 pass
plant 14: FAIL A2         17/18 pass
plant 15: FAIL B5, B6     16/18 pass
plant 16: FAIL C2         17/18 pass
plant 17: FAIL C3         17/18 pass
```

The case-insensitivity in A2 is a property of the Actions evaluator (`contains`
and `==` ignore case), not of a line in the workflow, so plant 14 isolates the
`OWNER` acceptance that A2 exercises rather than the casing.

Not isolated, and stated rather than hidden: the `github.event_name ==
'pull_request'` conjunct in line 58 is defence in depth. A comment run's
`github.event.action` is `created`, never `synchronize`, so removing that
conjunct changes no result and no plant can isolate it.

## Runtime proof (after merge, still owed)

The expression proof cannot show that GitHub keeps a comment run from cancelling
or displacing a pass, that the `issue_comment` workflow starts from a collaborator's
comment at all, or that Ronda publishes on the current head. These need real
runs, recorded here as workflow-run ids once this PR is on `develop`:

| Assertion | Plant (violation present) | Run id | Without the plant | Run id |
| --- | --- | --- | --- | --- |
| Collaborator `/ronda review` produces a pass on the current head | not applicable (positive case) | _pending_ | | |
| Unrelated comment does not start a pass | | _pending_ | | |
| Non-collaborator `/ronda review` does not start a pass | | _pending_ | | |
| Comment on a plain issue does not start a pass | | _pending_ | | |
| Comment during an in-flight `pull_request` pass does not cancel it | shared group (plant 5) | _pending_ | committed group | _pending_ |

The stale statements in [`dogfood-evidence-103.md`](dogfood-evidence-103.md)
(the "Manual rerun" row, and wiring defects 1 and 2) were corrected in this PR.
