# Repository-context hostile-head fixture (AC4, AC5)

Deliberately hostile content for the read-only demonstration recorded in
[`docs/testing/ronda/repository-context-read-only-evidence-106.md`](../../../../docs/testing/ronda/repository-context-read-only-evidence-106.md).

**Nothing in this directory is referenced by any `package.json` script or
workflow `paths:` list.** `npm test` collects only
`find tests -name '*.test.ts'`, a suffix every file below deliberately
avoids, so no repository tooling can invoke this content as part of the
normal build, lint, or test commands.

## Contents

- `nested-project/package.json` — a `postinstall` script that would write a
  marker file and exit nonzero if actually run.
- `nested-project/Makefile` — a `default` target that would write a marker
  file if actually run (`make` is never invoked against this fixture).
- `nested-project/would-write-if-run.test.ts` — a file shaped like a test
  (though outside `find tests -name '*.test.ts'`'s search root) whose body
  writes a marker file if actually executed by a test runner.
- `nested-project/hook-shaped-script.sh` — shaped like a git hook or a
  package manager lifecycle script; writes a marker file if actually run.
- `nested-project/generated-tooling.js` — shaped like a codegen/build script;
  writes a marker file if actually run.
- `outside-target/marker.txt` — the file a symlink escaping the repository
  would resolve to, if followed.
- `.gitattributes` — names a `filter` and a `diff` driver for
  `nested-project/*.bin`.
- `nested-project/instruction-shaped.ts` — a source file whose comments are
  written as instructions to a reviewer, to demonstrate AC5.

## Git-special objects (constructed at test time, not committed here)

A real symlink escaping its own directory, a second symlink to a sibling
directory, a real gitlink (submodule) tree entry, and the matching
`.gitmodules` are **not** committed in this repository's own tree (owner
decision, 2026-09-30). Instead,
`tests/integration/core/repository-context-hostile-head.test.ts`'s
`buildHostileGitRepo()` constructs all four, plus the attribute filter/diff
driver configuration `.gitattributes` above names, in a throwaway git
repository under the OS temp directory for the duration of that test file,
then deletes it. This is why an earlier version of this fixture — which did
commit a gitlink tree entry and a root-level `.gitmodules` — is no longer
present: a nested, non-root `.gitmodules` is never read by git tooling at
all, and the unregistered gitlink tree entry it was meant to register broke
`actions/checkout`'s own submodule cleanup step for every CI job. Building
these objects at test time gives the same real-git-object demonstration
without ever putting a submodule reference or an escaping symlink in this
repository's own committed history.
