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

One group per pull request, declared on the job — not on the workflow:

- a `pull_request` pass joins the PR's group, and only a `synchronize` push
  cancels an in-flight sibling;
- a comment the job `if:` admits (on a PR, containing `/ronda review`, from an
  `OWNER`, `MEMBER` or `COLLABORATOR`) joins the **same** PR group and never
  cancels: it waits behind an in-flight pass;
- a comment the `if:` rejects never enters a group at all, because a job-level
  `concurrency` group is acquired only after the job `if:` passes.

Two hazards follow from putting `concurrency` on the workflow instead, and both
are why it is job-level (adoption doc, "Why the concurrency group is
job-level"):

- a comment the `if:` rejects still enters the group and can **cancel** an
  in-flight pass (`cancel-in-progress: true`) or **replace** a queued one
  (`cancel-in-progress: false`) before skipping, so that head SHA keeps no
  published pass;
- serialization is the point: two passes running together on one head SHA can
  both find no check run and publish one each, which breaks the one-check-run-
  per-head-SHA contract in section 4 of the adoption doc.

The routing predicate is the job `if:`'s comment test itself, so every command
form Ronda accepts — after leading whitespace, after a blank or quoted line,
case-insensitively — is serialized. It is deliberately **not** exact. No GitHub
expression can mirror `matchesReviewCommand` (`src/cli/resolve-trigger.ts`):
expressions have no regex and cannot select the first unquoted line. A comment
that merely contains the phrase, such as `/ronda review later`, is therefore
admitted to the PR's group, and Ronda then rejects it and publishes nothing
(assertion B13, the documented residual). That is the safer side of the trade:
an exact or prefix predicate drops command forms Ronda **does** accept, which
would then run in no group at all and let two passes publish two check runs.
`queue: max`, which would stop a queued run from replacing a pending one, cannot
be combined with `cancel-in-progress: true` (a workflow validation error) and is
rejected as an unexpected key by the pinned actionlint in
`.github/workflows/actionlint.yml`, which is a required CI gate. Plants 12, 13
and 14 keep the rejected routings as falsifiable violations.

## Expression proof

Evaluator: `@actions/expressions` 0.3.61 (GitHub's published implementation of
the Actions expression language), run outside the repository so no dependency is
added to it. The harness reads the expressions **from the workflow file under
test**, so a plant is an edit to that file rather than a variant of the harness.

Reproduce, from an empty scratch directory:

<!-- workflow-shell-contract: bash-zsh -->
```bash
set -euo pipefail
npm init -y
npm i @actions/expressions@0.3.61 yaml
# save the harness below as check.mjs, then:
node check.mjs /path/to/.github/workflows/ronda-review-dogfood.yml
node check.mjs /path/to/.github/workflows/ronda-review-dogfood.yml \
  --doc /path/to/docs/adoption/ronda-review-adoption.md
```

The second invocation enables the doc-parity assertions: it parses the first
`yaml` block of the adoption doc and evaluates it alongside the committed
workflow, so an adopter cannot copy a snippet that re-creates either hazard.

<details>
<summary>check.mjs</summary>

```js
// Evaluates the trigger expressions of the dogfood caller workflow with
// GitHub's own expression evaluator (@actions/expressions) against synthetic
// event contexts, and checks the structural contract the redesign depends on.
// Usage: node check.mjs <workflow.yml> [--doc <adoption.md>]
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { Parser, Lexer, Evaluator, data } from "@actions/expressions";

const file = process.argv[2];
const wf = parse(readFileSync(file, "utf8"));
const job = (o) => o?.jobs?.ronda ?? {};

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
  // A structural plant can remove the key entirely; an absent expression routes
  // nowhere and cancels nothing, so it evaluates to the empty string rather than
  // throwing out of the lexer.
  if (body === "") return "";
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

// The adoption doc's snippet must behave identically to the committed workflow,
// or an adopter re-creates the hazards this item fixes.
const docPath = (() => { const i = process.argv.indexOf("--doc"); return i === -1 ? null : process.argv[i + 1]; })();
let docRaw = null;
if (docPath) {
  const md = readFileSync(docPath, "utf8");
  const block = md.match(/```yaml\n([\s\S]*?)```/);
  const doc = parse(block[1]);
  docRaw = {
    group: job(doc).concurrency?.group ?? doc.concurrency?.group ?? "",
    cancel: job(doc).concurrency?.["cancel-in-progress"] ?? doc.concurrency?.["cancel-in-progress"] ?? "",
    jobIf: job(doc).if ?? "true",
    doc,
  };
}

// A structural plant that moves `concurrency` back to the workflow level must
// yield FAILs, not a crash, so fall back to whichever level declares it.
const raw = {
  group: job(wf).concurrency?.group ?? wf.concurrency?.group ?? "",
  cancel: job(wf).concurrency?.["cancel-in-progress"] ?? wf.concurrency?.["cancel-in-progress"] ?? "",
  jobIf: job(wf).if ?? "true",
};

const checks = [];
const check = (name, actual, expected) => checks.push({ name, actual, expected, ok: actual === expected });

// --- Structure: the job-level redesign and the contracts it carries. ---
check("S1 no workflow-level `concurrency` key exists", wf.concurrency === undefined, true);
check("S2 the job carries its own `group`", typeof job(wf).concurrency?.group === "string", true);
check("S3 the job carries its own `cancel-in-progress`", typeof job(wf).concurrency?.["cancel-in-progress"] === "string", true);
// Pinned actionlint 1.7.12 rejects `queue` as an unexpected key; adding it
// would fail the required actionlint gate, so the guard is unfixable by it.
check("S4 `queue` is absent (pinned actionlint rejects it)", job(wf).concurrency?.queue === undefined, true);
check("S5 the caller job is not named `Ronda review`", job(wf).name !== "Ronda review", true);
check("S6 the job id is `ronda`", Object.keys(wf.jobs ?? {}).join(",") === "ronda", true);
check("S7 the caller grants pull-requests: write", job(wf).permissions?.["pull-requests"] === "write", true);
check("S8 the caller grants checks: write", job(wf).permissions?.checks === "write", true);
check("S9 the caller calls the in-repo reusable workflow", job(wf).uses === "./.github/workflows/ronda-review.yml", true);

// --- Job `if:` pre-filter. ---
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

// A run reaches the group only when the `if:` admits it AND the group expression
// routes it to this PR's group. Both halves are asserted together: a hold-open
// `if:` that admits a comment Ronda rejects would otherwise route it into the
// group and read as a pass.
const group = (gh) => evaluate(raw.group, gh);
const cancel = (gh) => evaluate(raw.cancel, gh);
const prGroup = group(pr());
const reaches = (gh) => String(runs(gh) === "true" && group(gh) === prGroup);
const valid = comment("/ronda review", "COLLABORATOR");
check("B1 a valid review request reaches the PR's group", reaches(valid), "true");
check("B2 an automatic pass reaches the PR's group", reaches(pr()), "true");
check("B3 a comment on another PR does not reach this PR's group", reaches(comment("/ronda review", "COLLABORATOR", { issue: { number: 77 } })), "false");
check("B4 a comment Ronda rejects does not reach the PR's group", reaches(comment("looks good to me", "COLLABORATOR")), "false");
check("B5 a valid review request cannot cancel in progress", cancel(valid), "false");
check("B6 a synchronize push cancels an in-flight pass", cancel(pr()), "true");
check("B7 reopened does not cancel (same head SHA)", cancel(pr({ top: { event: { action: "reopened", pull_request: { number: 42, draft: false } } } })), "false");
check("B8 ready_for_review does not cancel (same head SHA)", cancel(pr({ top: { event: { action: "ready_for_review", pull_request: { number: 42, draft: false } } } })), "false");
// Every accepted form is serialized (cycle 7's constraint — the reason the
// predicate cannot be narrowed to an exact match).
check("B9 a command after a quoted line reaches the PR's group", reaches(comment("> earlier\n/ronda review", "MEMBER")), "true");
check("B10 a command after leading whitespace reaches the PR's group", reaches(comment(" /ronda review", "COLLABORATOR")), "true");
check("B11 the command followed by more lines reaches the PR's group", reaches(comment("/ronda review\nthanks", "COLLABORATOR")), "true");
check("B12 the command in any case with a CRLF ending reaches the PR's group", reaches(comment("/RONDA REVIEW\r\nthanks", "COLLABORATOR")), "true");
// The documented residual (cycle 8): a phrase-only comment the `if:` admits but
// Ronda rejects still joins the group. Asserted so the doc matches behaviour.
check("B13 a phrase-only comment reaches the PR's group (documented residual)", reaches(comment("/ronda review later", "COLLABORATOR")), "true");

// --- Trigger wiring. ---
const on = wf.on ?? wf[true];
check("C1 the workflow subscribes to issue_comment `created`", String(JSON.stringify(on.issue_comment?.types) === '["created"]'), "true");
check("C2 pull_request still targets only develop", String(JSON.stringify(on.pull_request?.branches) === '["develop"]'), "true");
check("C3 pull_request still starts on opened, reopened, ready_for_review, synchronize", String(JSON.stringify(on.pull_request?.types) === '["opened","reopened","ready_for_review","synchronize"]'), "true");

// --- Adoption-doc parity. ---
if (docRaw) {
  check("D1 the doc snippet's concurrency is job-level too", docRaw.doc.concurrency === undefined && typeof job(docRaw.doc).concurrency?.group === "string", true);
  // The last three contexts are the accepted forms a narrower predicate drops:
  // parity must hold for every form Ronda accepts, not just the bare one.
  for (const [slug, ctx, label] of [
    ["pr", pr(), "a pull_request"],
    ["valid", valid, "a valid request"],
    ["indented", comment(" /ronda review", "COLLABORATOR"), "a request after leading whitespace"],
    ["quoted", comment("> earlier\n/ronda review", "MEMBER"), "a request after a quoted line"],
    ["phrase-only", comment("/ronda review later", "COLLABORATOR"), "a phrase-only comment"],
  ]) {
    check(`D2.${slug} the doc snippet's if: agrees with the workflow's (${label})`, evaluate(docRaw.jobIf, ctx), evaluate(raw.jobIf, ctx));
    check(`D3.${slug} the doc snippet's group agrees with the workflow's (${label})`, evaluate(docRaw.group, ctx) === evaluate(raw.group, ctx) ? "true" : `wf=${evaluate(raw.group, ctx)} doc=${evaluate(docRaw.group, ctx)}`, "true");
    check(`D4.${slug} the doc snippet's cancel agrees with the workflow's (${label})`, evaluate(docRaw.cancel, ctx), evaluate(raw.cancel, ctx));
  }
}

let failed = 0;
console.log(`file: ${file}`);
for (const c of checks) {
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name}  (got ${c.actual}, want ${c.expected})`);
  if (!c.ok) failed++;
}
console.log(`${checks.length - failed}/${checks.length} pass`);
process.exit(failed ? 1 : 0);```

</details>

### Result on the workflow as committed

34 of the 34 workflow assertions pass, and the `--doc` run adds
16 doc-parity assertions — 16 of 16 pass,
50 of 50 in that run. The count is cumulative, not additive:
`--doc` is the 34 above plus 16. The last column lists the
plants (next section) under which each assertion fails, so every assertion is
shown able to fail.

| Id | Assertion | Fails under plant |
| --- | --- | --- |
| S1 | no workflow-level `concurrency` key exists | 15, 16 |
| S2 | the job carries its own `group` | 22 |
| S3 | the job carries its own `cancel-in-progress` | 16, 18, 19, 22 |
| S4 | `queue` is absent (pinned actionlint rejects it) | 17 |
| S5 | the caller job is not named `Ronda review` | 21 |
| S6 | the job id is `ronda` | 22 |
| S7 | the caller grants pull-requests: write | 22, 24 |
| S8 | the caller grants checks: write | 22, 23 |
| S9 | the caller calls the in-repo reusable workflow | 22, 25 |
| A1 | collaborator '/ronda review' on a PR runs | 5, 8 |
| A2 | owner '/RONDA REVIEW' (case-insensitive) runs | 6, 8 |
| A3 | unrelated comment by a collaborator does not run | 1, 22 |
| A4 | '/ronda review' by a non-collaborator does not run | 2, 22 |
| A5 | '/ronda review' by a contributor does not run | 2, 22 |
| A6 | '/ronda review' on a plain issue does not run | 3, 22 |
| A7 | quoted-then-command comment is not filtered out (never stricter than Ronda) | 7, 8, 9 |
| A8 | non-draft pull_request runs | 10 |
| A9 | draft pull_request does not run | 4, 22 |
| B1 | a valid review request reaches the PR's group | 5, 8, 11, 12, 13, 16 |
| B2 | an automatic pass reaches the PR's group | 10 |
| B3 | a comment on another PR does not reach this PR's group | 14, 22 |
| B4 | a comment Ronda rejects does not reach the PR's group | 1, 22 |
| B5 | a valid review request cannot cancel in progress | 18, 22 |
| B6 | a synchronize push cancels an in-flight pass | 19, 22 |
| B7 | reopened does not cancel (same head SHA) | 18, 20, 22 |
| B8 | ready_for_review does not cancel (same head SHA) | 18, 20, 22 |
| B9 | a command after a quoted line reaches the PR's group | 7, 8, 9, 11, 12, 13, 16 |
| B10 | a command after leading whitespace reaches the PR's group | 5, 8, 9, 11, 12, 13, 16 |
| B11 | the command followed by more lines reaches the PR's group | 5, 8, 11, 12, 13, 16 |
| B12 | the command in any case with a CRLF ending reaches the PR's group | 5, 8, 11, 12, 13, 16 |
| B13 | a phrase-only comment reaches the PR's group (documented residual) | 5, 8, 11, 12, 13, 16 |
| C1 | the workflow subscribes to issue_comment `created` | 26, 27 |
| C2 | pull_request still targets only develop | 28 |
| C3 | pull_request still starts on opened, reopened, ready_for_review, synchronize | 29 |
| D1 | the doc snippet's concurrency is job-level too | D1 |
| D2.pr | the doc snippet's if: agrees with the workflow's (a pull_request) | D5 |
| D3.pr | the doc snippet's group agrees with the workflow's (a pull_request) | D8 |
| D4.pr | the doc snippet's cancel agrees with the workflow's (a pull_request) | D9 |
| D2.valid | the doc snippet's if: agrees with the workflow's (a valid request) | D6 |
| D3.valid | the doc snippet's group agrees with the workflow's (a valid request) | D3 |
| D4.valid | the doc snippet's cancel agrees with the workflow's (a valid request) | D4 |
| D2.indented | the doc snippet's if: agrees with the workflow's (a request after leading whitespace) | D2, D6, D7 |
| D3.indented | the doc snippet's group agrees with the workflow's (a request after leading whitespace) | D3 |
| D4.indented | the doc snippet's cancel agrees with the workflow's (a request after leading whitespace) | D4 |
| D2.quoted | the doc snippet's if: agrees with the workflow's (a request after a quoted line) | D2, D7 |
| D3.quoted | the doc snippet's group agrees with the workflow's (a request after a quoted line) | D3 |
| D4.quoted | the doc snippet's cancel agrees with the workflow's (a request after a quoted line) | D4 |
| D2.phrase-only | the doc snippet's if: agrees with the workflow's (a phrase-only comment) | D6, D7 |
| D3.phrase-only | the doc snippet's group agrees with the workflow's (a phrase-only comment) | D3 |
| D4.phrase-only | the doc snippet's cancel agrees with the workflow's (a phrase-only comment) | D4 |

### Planted violations

Each plant is a single edit to a copy of the workflow; with it applied the
assertions in the last column fail and the rest still pass. Line numbers are
those of the committed workflow.

| Plant | Violation | Edit | Fails |
| --- | --- | --- | --- |
| 1 | Job `if:`: command phrase dropped | line 60: the command `contains(...)` term becomes `true` | A3, B4 |
| 2 | Job `if:`: association check dropped | line 61: the association `contains(...)` term becomes `true` | A4, A5 |
| 3 | Job `if:`: pull-request-only gate dropped | line 59: `issue.pull_request != null &&` becomes `true &&` | A6 |
| 4 | Job `if:`: draft gate dropped (existing behaviour, re-asserted) | line 57: `draft != true` becomes `true` | A9 |
| 5 | Job `if:`: COLLABORATOR rejected | line 61: the association list loses `COLLABORATOR` | A1, B1, B10, B11, B12, B13 |
| 6 | Job `if:`: OWNER rejected | line 61: the association list loses `OWNER` | A2 |
| 7 | Job `if:`: MEMBER rejected | line 61: the association list loses `MEMBER` | A7, B9 |
| 8 | Job `if:`: wrong command literal | line 60: `'/ronda review'` becomes `'/ronda-review'` | A1, A2, A7, B1, B9, B10, B11, B12, B13 |
| 9 | Job `if:`: `startsWith` instead of `contains` | line 60: `contains(body, ...)` becomes `startsWith(body, ...)` | A7, B9, B10 |
| 10 | Job `if:`: pull_request never runs | line 57: `draft != true` becomes `false` | A8, B2 |
| 11 | Group routing: pull_request arm dropped | line 96: `event_name == 'pull_request'` becomes `false` | B1, B9, B10, B11, B12, B13 |
| 12 | Group routing: comments get their own per-run group (the pre-serialization design) | line 98: the comments' group becomes a per-run one | B1, B9, B10, B11, B12, B13 |
| 13 | Group routing: comments share one repo-wide group (the old snippet) | line 98: the comments' group becomes a constant | B1, B9, B10, B11, B12, B13 |
| 14 | Group routing: one repo-wide group for both arms | line 97: both arms' groups become one constant | B3 |
| 15 | Placement: workflow-level `concurrency` re-added alongside the job-level one | line 37: a workflow-level `concurrency` block is added above `jobs:` | S1 |
| 16 | Placement: `concurrency` moved back to the workflow level | lines 97-106: the job-level block is deleted and an equivalent workflow-level one added | S1, S3, B1, B9, B10, B11, B12, B13 |
| 17 | Placement: `queue: max` added to the job's group | line 99: `queue: max` is added to the job `concurrency` (actionlint rejects it) | S4 |
| 18 | Cancellation: everything cancels | line 106: the expression becomes `true` | S3, B5, B7, B8 |
| 19 | Cancellation: nothing cancels | line 106: the expression becomes `false` | S3, B6 |
| 20 | Cancellation: reopened and ready_for_review cancel | line 106: `action == 'synchronize'` becomes `action != 'opened'` | B7, B8 |
| 21 | Naming: the caller job is named `Ronda review` | line 45: the job `name:` becomes `Ronda review` | S5 |
| 22 | Naming: the caller job id is renamed | line 38: the job id becomes `ronda-job` | S2, S3, S6, S7, S8, S9, A3, A4, A5, A6, A9, B3, B4, B5, B6, B7, B8 |
| 23 | Permissions: `checks: write` dropped | lines 112-112: deleted | S8 |
| 24 | Permissions: `pull-requests: write` dropped | lines 111-111: deleted | S7 |
| 25 | Reusable workflow: the caller points elsewhere | line 113: the `uses:` path changes | S9 |
| 26 | Wiring: `issue_comment` subscription removed | lines 31-32: deleted | C1 |
| 27 | Wiring: wrong comment action | line 32: `types: [created]` becomes `types: [edited]` | C1 |
| 28 | Wiring: automatic passes retargeted | line 29: `- develop` becomes `- main` | C2 |
| 29 | Wiring: automatic passes lose actions | line 30: the `types` list becomes `[opened, synchronize]` | C3 |

Each doc plant is a single edit to the adoption doc's snippet, run in `--doc`
parity mode; it must break parity for at least one context.

| Plant | Violation | Edit | Fails |
| --- | --- | --- | --- |
| D1 | Doc snippet: `concurrency` moved back to the workflow level | `concurrency:<br>  group: ronda-review-${{ github.run_id }}<br>  cancel-in-progress: false<br>jobs:` | D1 |
| D2 | Doc snippet: `startsWith` instead of `contains` | `startsWith(github.event.comment.body, '/ronda review')` | D2.indented, D2.quoted |
| D3 | Doc snippet: comments get their own per-run group | `\|\| format('ronda-review-comment-{0}', github.run_id) }}` | D3.valid, D3.indented, D3.quoted, D3.phrase-only |
| D4 | Doc snippet: everything cancels | `cancel-in-progress: true` | D4.valid, D4.indented, D4.quoted, D4.phrase-only |
| D5 | Doc snippet: `if:` drops the pull_request arm | `false \|\|` | D2.pr |
| D6 | Doc snippet: association list loses COLLABORATOR | `"OWNER","MEMBER"` | D2.valid, D2.indented, D2.phrase-only |
| D7 | Doc snippet: `if:` matches the whole body exactly | `github.event.comment.body == '/ronda review'` | D2.indented, D2.quoted, D2.phrase-only |
| D8 | Doc snippet: the pull_request arm's group is a constant | `&& 'ronda-review'` | D3.pr |
| D9 | Doc snippet: nothing cancels | `cancel-in-progress: false` | D4.pr |

Harness output for each plant (`FAIL` ids and the pass count):

```text
plant  1: FAIL A3, B4             32/34 pass
plant  2: FAIL A4, A5             32/34 pass
plant  3: FAIL A6                 33/34 pass
plant  4: FAIL A9                 33/34 pass
plant  5: FAIL A1, B1, B10, B11, B12, B13 28/34 pass
plant  6: FAIL A2                 33/34 pass
plant  7: FAIL A7, B9             32/34 pass
plant  8: FAIL A1, A2, A7, B1, B9, B10, B11, B12, B13 25/34 pass
plant  9: FAIL A7, B9, B10        31/34 pass
plant 10: FAIL A8, B2             32/34 pass
plant 11: FAIL B1, B9, B10, B11, B12, B13 28/34 pass
plant 12: FAIL B1, B9, B10, B11, B12, B13 28/34 pass
plant 13: FAIL B1, B9, B10, B11, B12, B13 28/34 pass
plant 14: FAIL B3                 33/34 pass
plant 15: FAIL S1                 33/34 pass
plant 16: FAIL S1, S3, B1, B9, B10, B11, B12, B13 26/34 pass
plant 17: FAIL S4                 33/34 pass
plant 18: FAIL S3, B5, B7, B8     30/34 pass
plant 19: FAIL S3, B6             32/34 pass
plant 20: FAIL B7, B8             32/34 pass
plant 21: FAIL S5                 33/34 pass
plant 22: FAIL S2, S3, S6, S7, S8, S9, A3, A4, A5, A6, A9, B3, B4, B5, B6, B7, B8 17/34 pass
plant 23: FAIL S8                 33/34 pass
plant 24: FAIL S7                 33/34 pass
plant 25: FAIL S9                 33/34 pass
plant 26: FAIL C1                 33/34 pass
plant 27: FAIL C1                 33/34 pass
plant 28: FAIL C2                 33/34 pass
plant 29: FAIL C3                 33/34 pass
doc plant D1: FAIL D1                 49/50 pass
doc plant D2: FAIL D2.indented, D2.quoted 48/50 pass
doc plant D3: FAIL D3.valid, D3.indented, D3.quoted, D3.phrase-only 46/50 pass
doc plant D4: FAIL D4.valid, D4.indented, D4.quoted, D4.phrase-only 46/50 pass
doc plant D5: FAIL D2.pr              49/50 pass
doc plant D6: FAIL D2.valid, D2.indented, D2.phrase-only 47/50 pass
doc plant D7: FAIL D2.indented, D2.quoted, D2.phrase-only 47/50 pass
doc plant D8: FAIL D3.pr              49/50 pass
doc plant D9: FAIL D4.pr              49/50 pass
```

Points stated rather than hidden:

- **Jump-between-checks on a rename.** Renaming the job id (plant 22) makes every
  job-scoped assertion collapse at once, because the harness reads the job by
  id. It is one plant for one violation, not evidence that the assertions are
  independent.
- **Case-insensitivity is the evaluator's.** A2's case-insensitivity is a
  property of the Actions evaluator (`contains` and `==` ignore case), not of a
  line in the workflow, so no plant isolates the casing itself; plant 8 isolates
  the command literal A1/A2 depend on.
- **One conjunct is defence in depth.** The `github.event_name == 'pull_request'`
  term inside `cancel-in-progress` cannot be isolated: a comment run's
  `github.event.action` is `created`, never `synchronize`, so removing the term
  changes no evaluated result and no plant can break it. It is kept so the
  expression reads as its own explanation.
- **`queue` is asserted absent, not exercised.** Plant 17 adds it to show the
  structural assertion S4 can fail; the reason it must stay absent is the pinned
  actionlint gate, which no unit-level plant can speak for.

### Routing against Ronda's parser

Three properties tie the group routing to what Ronda actually accepts, checked
by running the workflow's group expression and Ronda's own `matchesReviewCommand`
(`src/cli/resolve-trigger.ts`) over 24 comment bodies from an owner on a pull
request, including trailing text, longer words, leading whitespace, blank and
quoted first lines, CR and CRLF endings, a byte-order mark and the empty
comment:

- **P1** every body Ronda accepts is admitted to the shared group, so no valid
  review request runs unserialized;
- **P2** every body admitted to the group contains the phrase, so a comment
  without it never joins the group;
- **P3** a comment on one pull request reaches no other pull request's group, so
  a repo-wide or constant group cannot let one PR's comment displace another's
  pass.

P3 is what a single constant group breaks while P1 and P2 still hold — the
comparison is against the group the same PR's own `pull_request` pass resolves
to, not against the comment's own expression, which is what makes the check
sensitive to routing rather than to admission alone. The converse of P1 is
deliberately not required (see assertion B13).

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
// Cross-checks the workflow's own pre-filter and routing against Ronda's real
// parser (`matchesReviewCommand`) over a fixed corpus of comment bodies, all
// from an OWNER on a pull request. Two properties:
//   P1  every body Ronda's parser accepts reaches the shared PR group, so no
//       accepted review request runs unserialized against an automatic pass;
//   P2  every body that reaches the group carries the phrase, so a comment
//       without it never joins the group and can never displace a queued pass;
//   P3  a comment on this PR reaches no other PR's group, so a repo-wide or
//       constant group cannot let one PR's comment displace another's pass.
// P1 is the safety-critical half: a form Ronda accepts but the workflow drops
// would run in no group at all, and two passes on one head SHA can then both
// find no check run and publish one each (docs/adoption, section 4).
// P3 is what a single constant group breaks even though P1 and P2 hold: every
// PR then shares one group, so a comment on #42 can displace a queued pass on
// #77 — the cross-PR loss the job-level redesign exists to prevent.
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { Parser, Lexer, Evaluator, data } from "@actions/expressions";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [workflowPath, repoRoot] = process.argv.slice(2);
if (!workflowPath || !repoRoot) throw new Error("usage: tsx cross.mts <workflow.yml> <ronda checkout>");
const { matchesReviewCommand } = await import(pathToFileURL(resolve(repoRoot, "src/cli/resolve-trigger.ts")).href);

const wf = parse(readFileSync(workflowPath, "utf8"));
const job = wf.jobs?.ronda ?? {};
const group = job.concurrency?.group ?? wf.concurrency?.group ?? "";
const jobIf = job.if ?? "true";

const strip = (e: unknown) => String(e).trim().replace(/^\$\{\{\s*/, "").replace(/\s*\}\}$/, "");
const S = (v: string) => new data.StringData(v);
const N = (v: number) => new data.NumberData(v);
const D = (o: Record<string, unknown>) => new data.Dictionary(...Object.entries(o).map(([key, value]) => ({ key, value })));
const evalWith = (expr: string, github: data.Dictionary) => {
  const body = strip(expr);
  if (body === "") return "";
  return new Evaluator(new Parser(new Lexer(body).lex().tokens, ["github"], []).parse(), D({ github })).evaluate().coerceString();
};

const ctx = (body: string, pr = 42) => D({
  event_name: S("issue_comment"), run_id: N(1),
  event: D({ issue: D({ number: N(pr), pull_request: D({ url: S("x") }) }),
    comment: D({ body: S(body), author_association: S("OWNER") }) }),
});

// An automatic pass on the same pull request. A comment "reaches the shared
// group" only if the `if:` admits it AND its group expression resolves to the
// group that pull request's own automatic pass uses — which is the design
// contract (job-level placement, one group per PR). Comparing against the
// pull_request event rather than against this comment's own expression is what
// makes the property sensitive to the routing: a per-run group, or one group
// for both arms, no longer agrees.
const prCtx = (number: number) => D({
  event_name: S("pull_request"), run_id: N(1),
  event: D({ action: S("opened"), pull_request: D({ number: N(number), draft: new data.BooleanData(false) }) }),
});
const reaches = (body: string) => evalWith(jobIf, ctx(body)) === "true" && evalWith(group, ctx(body)) === evalWith(group, prCtx(42));

const bodies = [
  "/ronda review", "/RONDA REVIEW", "/Ronda Review", "/ronda review\n", "/ronda review\nthanks",
  "/ronda review\r\nthanks", "/ronda review\r", " /ronda review", "\t/ronda review", "\n/ronda review",
  "> quoted\n/ronda review", "> /ronda review\n", "/ronda review \n", "/ronda review\t", "﻿/ronda review",
  // admitted by the pre-filter but rejected by Ronda (the documented residual)
  "/ronda review later", "/ronda reviewer", "/ronda review.", "please /ronda review", "//ronda review",
  // neither admits
  "", "looks good", "/ronda", "/ronda  review",
];
let bad = 0;
for (const b of bodies) {
  const a = reaches(b), r = matchesReviewCommand(b);
  const p1 = !r || a; // Ronda accepts => it reaches the shared group
  const p2 = !a || b.toLowerCase().includes("/ronda review"); // reaches => it carries the phrase
  // A comment on #42 reaches #77's group iff the routing is not per-PR at all.
  const p3 = evalWith(group, ctx(b, 42)) !== evalWith(group, prCtx(77));
  const ok = p1 && p2 && p3;
  if (!ok) bad++;
  const note = !p1 ? "  <-- Ronda accepts it and it reaches no group"
    : !p2 ? "  <-- reaches the group without the phrase"
    : !p3 ? "  <-- #42's comment reaches #77's group" : "";
  console.log(`${ok ? "ok  " : "BAD "} reaches=${String(a).padEnd(5)} ronda=${String(r).padEnd(5)} ${JSON.stringify(b)}${note}`);
}
console.log(bad ? `${bad} violation(s)` : "P1, P2 and P3 hold for every body");
process.exit(bad ? 1 : 0);```

</details>

Output on the committed workflow:

```text
ok   reaches=true  ronda=true  "/ronda review"
ok   reaches=true  ronda=true  "/RONDA REVIEW"
ok   reaches=true  ronda=true  "/Ronda Review"
ok   reaches=true  ronda=true  "/ronda review\n"
ok   reaches=true  ronda=true  "/ronda review\nthanks"
ok   reaches=true  ronda=true  "/ronda review\r\nthanks"
ok   reaches=true  ronda=true  "/ronda review\r"
ok   reaches=true  ronda=true  " /ronda review"
ok   reaches=true  ronda=true  "\t/ronda review"
ok   reaches=true  ronda=true  "\n/ronda review"
ok   reaches=true  ronda=true  "> quoted\n/ronda review"
ok   reaches=true  ronda=false "> /ronda review\n"
ok   reaches=true  ronda=true  "/ronda review \n"
ok   reaches=true  ronda=true  "/ronda review\t"
ok   reaches=true  ronda=true  "﻿/ronda review"
ok   reaches=true  ronda=false "/ronda review later"
ok   reaches=true  ronda=false "/ronda reviewer"
ok   reaches=true  ronda=false "/ronda review."
ok   reaches=true  ronda=false "please /ronda review"
ok   reaches=true  ronda=false "//ronda review"
ok   reaches=false ronda=false ""
ok   reaches=false ronda=false "looks good"
ok   reaches=false ronda=false "/ronda"
ok   reaches=false ronda=false "/ronda  review"
P1, P2 and P3 hold for every body

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
| Unrelated comment does not start a pass | plant 1 (job `if:` command test becomes `true`, so every comment is admitted) | _pending_ | committed `if:` | _pending_ |
| Non-collaborator `/ronda review` does not start a pass | plant 2 (association test becomes `true`) | _pending_ | committed `if:` | _pending_ |
| Comment on a plain issue does not start a pass | plant 3 (`issue.pull_request != null` becomes `true`) | _pending_ | committed `if:` | _pending_ |
| Unrelated comment during an in-flight `pull_request` pass does not cancel or displace it | plant 1 (every comment admitted, so an unrelated one enters the PR's group) | _pending_ | committed `if:` | _pending_ |
| Valid request during an in-flight pass waits for it, then publishes one `Ronda review` check run | plant 12 (comments get their own per-run group, so the request stops waiting) | _pending_ | committed group | _pending_ |
| Comment containing the phrase but not a command (`/ronda review later`) is admitted to the PR's group and can displace a queued run, then adds no pass | doc plant D7 (predicate matches the whole body exactly, so the phrase-only comment is admitted nowhere) | _pending_ | committed `contains`: admitted (assertion B13) | _pending_ |

The stale statements in [`dogfood-evidence-103.md`](dogfood-evidence-103.md)
(the "Manual rerun" row, and wiring defects 1 and 2) were corrected in this PR.
