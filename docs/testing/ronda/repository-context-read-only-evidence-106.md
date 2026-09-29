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

## Version and reproducibility

Re-run this demonstration against a later version with:

```bash
npx tsx --test tests/integration/core/repository-context-hostile-head.test.ts
```

A future observation should append a new dated entry below rather than
editing this one, per the same convention `sweep-effect-evidence.md` uses for
superseded campaigns.
