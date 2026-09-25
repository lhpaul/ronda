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

15 of 15 assertions pass.

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

### Planted violations, one per new assertion

Each plant is a single edit to a copy of the workflow; the harness then fails
exactly the assertion the edited line guards, and passes again on the committed
file (the baseline above). Line numbers are those of the committed workflow.

| Plant | Edit | Assertions that fail | Result on the committed line |
| --- | --- | --- | --- |
| 1. Comment pre-filter | line 80: `contains(github.event.comment.body, '/ronda review') &&` becomes `true &&` | A3 only | passes |
| 2. Association check | line 81: the `contains(fromJSON('["OWNER","MEMBER","COLLABORATOR"]'), ...)` term becomes `true)` | A4, A5 | passes |
| 3. Pull-request-only gate | line 79: `github.event.issue.pull_request != null &&` becomes `true &&` | A6 only | passes |
| 4. Draft gate (existing behaviour, re-asserted) | line 77: `github.event.pull_request.draft != true` becomes `true` | A9 only | passes |
| 5. Concurrency: group split | lines 50-51: both branches become `format('ronda-review-{0}', pull_request.number \|\| issue.number)` (the shared group the old snippet used) | B1, B2 | passes |
| 6. Concurrency: comment cannot cancel | line 58: expression becomes `true` | B3, B5, B6 | passes |

Harness output for each plant (`FAIL` lines only; every other assertion passes):

```text
plant 1: FAIL A3 (got true, want false)                          14/15
plant 2: FAIL A4, A5 (got true, want false)                      13/15
plant 3: FAIL A6 (got true, want false)                          14/15
plant 4: FAIL A9 (got true, want false)                          14/15
plant 5: FAIL B1, B2 (got true, want false)                      13/15
plant 6: FAIL B3, B5, B6 (got true, want false)                  12/15
```

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

When filled, also correct the two now-stale statements in
[`dogfood-evidence-103.md`](dogfood-evidence-103.md): the "Manual rerun" row
that calls the comment trigger a follow-up, and wiring defect 1's remark that the
adoption snippet does not document the job-name requirement.
