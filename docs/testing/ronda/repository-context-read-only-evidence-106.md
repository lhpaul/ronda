# Read-Only Repository Context — Read-Only Demonstration (AC4, AC5)

Evidence for read-only repository context
([#106](https://github.com/lhpaul/ronda/issues/106)): a recorded demonstration
that a pass reviewing a deliberately hostile head neither executes anything
from the reviewed repository nor lets instruction-shaped content change its
output contract, per the spec's Use Case 3 and AC4/AC5.

**Observed on**: 2026-09-29, feature branch `feature/106-read-only-symbol-context`,
commit `bcc9542` (pre-hostile-fixture parent; this evidence's own commit adds
the fixture and this document together). Node `v26.7.0`, `typescript` `5.8.3`.

**The guarantee is demonstrated, not asserted** (spec, Use Case 3
considerations): every claim below names the reproducible test that produced
it, in `tests/integration/core/repository-context-hostile-head.test.ts`. Run it
with:

```bash
npx tsx --test tests/integration/core/repository-context-hostile-head.test.ts
```

## What the hostile head carries

[`tests/fixtures/repository-context/hostile-head/`](../../../tests/fixtures/repository-context/hostile-head/)
(see its own `README.md` for the full inventory) commits, as real git objects:

- A nested `package.json` with a `postinstall` script that writes a marker
  file and exits nonzero if actually run.
- A `Makefile` whose default target does the same.
- A file shaped like a test (`would-write-if-run.ts`, deliberately without a
  `.test.ts` suffix) that writes a marker file if actually executed.
- A script shaped like a git hook or a package-manager lifecycle script
  (`hook-shaped-script.sh`).
- A script shaped like generated build/codegen tooling
  (`generated-tooling.js`).
- A real symlink (git mode `120000`) whose target climbs above the repository
  root (`escape-symlink`), and a second real symlink to a sibling directory
  within the same fixture (`sibling-symlink`).
- A real gitlink tree entry (git mode `160000`) plus a matching `.gitmodules`
  block, naming a submodule this repository never fetches.
- A `.gitattributes` entry naming a `filter` and a `diff` driver for
  `nested-project/*.bin`.
- A source file (`instruction-shaped.ts`) whose leading comment is written as
  an instruction to a reviewer, asking it to report nothing and to hide that
  it was asked.

Nothing under this directory is referenced by any `package.json` script or
workflow `paths:` list, and no file uses a `.test.ts` suffix, so
`npm test`'s own collection glob (`find tests -name '*.test.ts'`) never
selects any of it. `eslint.config.js` excludes the directory outright — it is
never meant to pass lint, only to be read as inert text.

## AC4: nothing executed, nothing written, nothing followed outside the repository

### Structural (guaranteed by construction, D1)

The read-only repository content mechanism (`src/review/symbol-resolver.ts`,
`src/review/repository-context.ts`, the repository-context phase in
`src/core/run-review-pass.ts`) reads every reviewed-repository byte through
one seam — `GithubOperations.readFileAtRef`, backed in production by
`src/github/repo-content-reader.ts`'s `readRepositoryFileAtRef` — and that
seam:

- Never spawns a process, never calls `eval`, and never constructs a
  `Function` from reviewed content. Verified structurally by
  `tests/integration/core/repository-context-hostile-head.test.ts`'s
  "no repository-context module ever imports a process-spawning or
  dynamic-evaluation API" test, which greps the four files above for
  `node:child_process`, `execSync`/`execFileSync`, `new Function(`, and
  `eval(` and asserts none appear.
- Never performs a local git checkout, never creates a working area for
  reviewed content, and never writes reviewed content to disk (D1). There is
  no code path in any of those four files that calls a `node:fs` write
  function on reviewed-repository content — confirmed by reading the modules
  (they hold in-memory `Map<string, string>` file sets only) and by the
  absence of any such call in the grep above.
- Already refuses a non-`file` content type — a directory, a symlink, or a
  submodule (gitlink) tree entry — **before decoding anything**, in
  `src/github/repo-content-reader.ts` (`Array.isArray(data)` → `"directory"`;
  `data.type !== "file"` → `"type:<type>"`). This refusal is not new code
  added for this feature; it is a pre-existing property of the one content
  seam every reviewed-repository read goes through, recorded in the
  implementation plan's Verification Log.

### Observational (this run)

Two tests exercise the fixture's actual git objects through this real code:

1. **"a symlink escaping the repository is refused, never followed, and
   nothing outside the repository is read"** — confirms, via `node:fs`'s own
   `lstatSync`/`readlinkSync`, that `escape-symlink` is a real symlink whose
   target climbs above its own directory (`../../../../../../../../etc/passwd`),
   then calls `readRepositoryFileAtRef` against it through a fake GitHub
   Contents API response shaped exactly like GitHub's own (`type: "symlink"`)
   for that path, and asserts the result is `undefined` — refused, never
   followed, and no path outside the repository is ever passed to a read
   call.
2. **"a submodule (gitlink) tree entry is never fetched"** — confirms, via
   `git ls-files -s`, that `nested-project/other-repo` is a real gitlink
   (mode `160000`) tree entry, and that no separate submodule-fetching code
   path exists anywhere in this feature — the same structural refusal above
   is what would apply if anything ever tried to read it.

Both tests passed on this observation (`npx tsx --test
tests/integration/core/repository-context-hostile-head.test.ts` — 4/4 green).
The `.gitattributes` filter/driver entry is not independently exercised
because it requires no observation beyond the structural claim above: a
`filter`/`diff` driver only ever runs during a local git checkout or a local
`git diff`/`git show` invocation, and this feature performs neither (D1) — the
absence of a checkout in the whole pipeline is itself the refusal, the same
way the constitution's replaced invariant now states it.

## AC5: instruction-shaped content never changes the output contract

### Structural

`src/inference/review-prompt.ts` renders every repository-context excerpt
inside a labelled, delimited section
(`<<<BEGIN_UNTRUSTED_REPOSITORY_CONTEXT>>>` / `<<<END_UNTRUSTED_REPOSITORY_CONTEXT>>>`)
with an explicit system-prompt instruction that the section is unchanged,
not-under-review source and must never be followed as an instruction (see
`tests/unit/inference/review-prompt-repository-context.test.ts`). Independent
of whether a model actually honours that instruction, `src/inference/
parse-model-response.ts` enforces the fixed `{"findings":[...]}` JSON contract
on every model response regardless of its content — there is no code path by
which prompt content can add a second review, a write, or any action outside
the one publish call `runReviewPass` already makes.

### Observational

The test **"a head carrying instruction-shaped content still publishes
exactly one review and one check run"** feeds `instruction-shaped.ts`'s real,
committed content (confirmed present via a `/SYSTEM OVERRIDE/` regex match on
the file read from disk) through `runReviewPass` as the pull request's sole
changed file, with a controlled fake model response that reports one real
(mild) defect the file's own code carries. The observed result:

- `result.outcome === "succeeded"`.
- Exactly one `publishReview` call and exactly one `publishCheckRun` call —
  no second review, no comment, nothing else.
- The one real defect (`"No bounds check"`) is present in `result.findings`,
  demonstrating the instruction-shaped comment did not suppress a genuine
  finding in the surrounding fixture code.

This test does not, and cannot, demonstrate that every possible model would
refuse to comply with the injected instruction — that is a model-behaviour
question the spec itself names as the residual risk repository context adds
("Repository content becomes untrusted model input", amendment
Consequences). What it demonstrates, and what AC5 asks for, is that Ronda's
own **published contract** — one review, one check run, nothing else — holds
regardless of what the model does with the content it read.

## Disclosed residual risk: synchronous compiler CPU-time worst-case measurement

`src/review/symbol-resolver.ts`'s size backstops
(`MAX_RESOLUTION_FILE_COUNT`, `MAX_RESOLUTION_TOTAL_CHARS`,
`MAX_CHANGED_FILE_CHARS`) bound the *input size* the synchronous
`ts.createProgram`/checker pass runs over, not its CPU time — a file set at
or under the caps can, in a pathological case, still take longer to
type-check than a naive size-based estimate would suggest, and nothing can
preempt that call once started (documented in the module's own doc comment,
and in the owner-facing residual-risk discussion on PR
[#130](https://github.com/lhpaul/ronda/pull/130)). This section records a
cheap, honest measurement of that worst case — not a proof of an upper
bound, and not a CI-enforced assertion (a wall-clock assertion over
synchronous compiler work would be flaky across CI runners; the owner
explicitly waived requiring one).

**Observed on**: 2026-09-30, `feature/106-read-only-symbol-context`, machine
`Darwin 25.6.0 arm64` (`MacBook-Pro-de-Luis.local`), Node `v26.7.0`,
`typescript` `5.8.3`.

**Method**: a synthetic changed-file set built to sit exactly at both caps
simultaneously — 100 files (`MAX_RESOLUTION_FILE_COUNT`), summing to
1,000,000 characters (`MAX_RESOLUTION_TOTAL_CHARS`, i.e. 10,000 characters
per file, under the 300,000-character single-file cap
`MAX_CHANGED_FILE_CHARS`) — each file containing a chain of generic
interfaces, a bounded-depth conditional type, a generic class with a dozen
methods, and a cross-file import to a neighboring synthetic file (to force
real cross-file symbol/alias resolution rather than trivially local
binding), with every line marked "changed" so `identifyCandidates`'s
identifier walk visits a realistic, large number of identifiers per file.
`identifyCandidates` and `resolveSymbols` (the same production functions the
review pass calls) were invoked directly against this set, with an in-memory
`readFile` (no network latency, isolating compiler CPU time from the
already-separately-budgeted fetch time).

**Result** (four independent cold-process runs):

| Run | `identifyCandidates` | `resolveSymbols` | Total synchronous compiler time |
| --- | --- | --- | --- |
| 1 | 583.6 ms | 197.0 ms | 780.7 ms |
| 2 | 688.9 ms | 211.0 ms | 899.9 ms |
| 3 | 548.2 ms | 204.3 ms | 752.5 ms |
| 4 | 594.0 ms | 202.9 ms | 797.0 ms |

At-cap synthetic worst case: **well under one second** of uninterruptible
synchronous compiler time (≈0.75–0.9 s total across the two synchronous
compiler passes), against this feature's default 120-second context time
budget (`RONDA_REPOSITORY_CONTEXT_TIME_BUDGET_MS`) and the pass deadline it
is a sub-budget of. This is one synthetic construction, not an exhaustive
search for the true worst case (a real pathological input — e.g. much deeper
conditional-type recursion, or heavier cross-file generic instantiation —
could take meaningfully longer), which is exactly why the follow-up
(worker-thread isolation, filed as
[#131](https://github.com/lhpaul/ronda/issues/131)) remains open rather than
closed by this measurement.

**Reproduce**: save the script below as `measure-worst-case.ts` at the
repository root, then run `./node_modules/.bin/tsx measure-worst-case.ts`.

```typescript
import {
  identifyCandidates,
  resolveSymbols,
  type InternalRequestedReference,
} from "./src/review/symbol-resolver.ts";

const MAX_RESOLUTION_FILE_COUNT = 100;
const MAX_RESOLUTION_TOTAL_CHARS = 1_000_000;
const MAX_CHANGED_FILE_CHARS = 300_000;

// Build a synthetic worst-case changed-file set: as many files as the
// file-count cap allows, each with substantial generic/class complexity,
// summed to the combined-character cap (never exceeding the per-file cap).
const FILE_COUNT = MAX_RESOLUTION_FILE_COUNT;
const CHARS_PER_FILE = Math.floor(MAX_RESOLUTION_TOTAL_CHARS / FILE_COUNT); // 10,000
if (CHARS_PER_FILE > MAX_CHANGED_FILE_CHARS) {
  throw new Error("synthetic per-file size would exceed MAX_CHANGED_FILE_CHARS");
}

function genFile(index: number): string {
  const lines: string[] = [];
  lines.push(`// synthetic worst-case file ${index}`);
  lines.push(`import { Base${(index + 1) % FILE_COUNT} } from "./file${(index + 1) % FILE_COUNT}.js";`);
  lines.push(`export interface Base${index} { value: number; next?: Base${index}; }`);
  lines.push(
    `export type Cond${index}<T, D extends number = 8> = D extends 0 ? T : T extends Base${index} ? Cond${index}<T, 7> : Cond${index}<T, 6> | Base${(index + 1) % FILE_COUNT};`,
  );
  lines.push(`export class Impl${index}<T extends Base${index} = Base${index}> {`);
  lines.push(`  constructor(private readonly seed: T) {}`);
  for (let m = 0; m < 12; m += 1) {
    lines.push(
      `  method${m}(input: Cond${index}<T>): Base${index} { const local${m} = this.seed; return local${m}; }`,
    );
  }
  lines.push(`}`);
  // Pad with repeated, referenceable statements until we reach the target
  // size — every line is a "changed" line, so identifyCandidates's identifier
  // walk visits a large, realistic number of identifiers per file.
  let body = lines.join("\n") + "\n";
  let counter = 0;
  while (body.length < CHARS_PER_FILE) {
    body += `export const derived${index}_${counter}: Base${index} = new Impl${index}(new Impl${index}({ value: ${counter} }) as unknown as Base${index}).method0({ value: ${counter} } as unknown as Cond${index}<Base${index}>);\n`;
    counter += 1;
  }
  return body.slice(0, CHARS_PER_FILE);
}

async function main() {
  const changedFilePaths: string[] = [];
  const changedLinesByFile = new Map<string, Set<number>>();
  const files = new Map<string, string>();

  for (let i = 0; i < FILE_COUNT; i += 1) {
    const path = `file${i}.ts`;
    const text = genFile(i);
    files.set(path, text);
    changedFilePaths.push(path);
    const lineCount = text.split("\n").length;
    const allLines = new Set<number>();
    for (let line = 1; line <= lineCount; line += 1) allLines.add(line);
    changedLinesByFile.set(path, allLines);
  }

  const totalChars = [...files.values()].reduce((sum, t) => sum + t.length, 0);
  console.log(`synthetic changed set: ${files.size} files, ${totalChars} combined chars`);

  const readFile = async (path: string): Promise<string | undefined> => files.get(path);

  const t0 = performance.now();
  const identified = await identifyCandidates(changedFilePaths, changedLinesByFile, readFile);
  const t1 = performance.now();
  console.log(`identifyCandidates: ${(t1 - t0).toFixed(1)} ms, requested=${identified.requested.length}`);

  // Step (c) worst case: resolve every requested reference against the same
  // file set (the changed set alone already sits at the resolution cap, so no
  // additional import closure is needed to reach it).
  const bookkeeping = {
    resolvedSpecifierKeys: new Set<string>(),
    refusedSpecifierKeys: new Set<string>(),
    attemptedSpecifierKeys: new Set<string>(),
  };
  const t2 = performance.now();
  const resolved = resolveSymbols(
    identified.changedSourceTexts,
    identified.requested as InternalRequestedReference[],
    bookkeeping,
  );
  const t3 = performance.now();
  console.log(`resolveSymbols: ${(t3 - t2).toFixed(1)} ms, resolved=${resolved.length}`);

  console.log(`TOTAL synchronous compiler time: ${(t1 - t0 + (t3 - t2)).toFixed(1)} ms`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

This script is a one-off manual measurement, not a committed CLI tool or
test — it is not added to the repository tree, only reproduced here.

## Version and reproducibility

Re-run this demonstration against a later version with:

```bash
npx tsx --test tests/integration/core/repository-context-hostile-head.test.ts
```

A future observation should append a new dated entry below rather than
editing this one, per the same convention `sweep-effect-evidence.md` uses for
superseded campaigns.
