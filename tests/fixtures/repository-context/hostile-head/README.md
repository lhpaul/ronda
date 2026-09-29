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
- `nested-project/escape-symlink` — a symlink whose target path climbs above
  the repository root.
- `nested-project/sibling-symlink` — a symlink to `outside-target/`, a
  sibling directory within this same fixture (still content Ronda must not
  read through, since only literal read requests through the injected seam
  are ever made — nothing resolves a symlink target on either side).
- `nested-project/other-repo` — a real gitlink tree entry (git mode `160000`),
  a submodule reference to another repository. Registered in the
  **repository root's** `.gitmodules` (not a nested one under this
  directory) — git only ever reads `.gitmodules` from the working tree
  root, and an unregistered gitlink tree entry makes `git submodule status`
  and `actions/checkout`'s own submodule cleanup step fail outright, which
  would break CI for every PR rather than demonstrating anything. The
  submodule is never initialized or fetched (`git submodule status` reports
  it with the `-` "not initialized" prefix), which is itself part of the
  demonstration: nothing about this repository's own tooling — real or
  Ronda's — ever fetches it.
- `.gitattributes` — names a `filter` and a `diff` driver for
  `nested-project/*.bin`.
- `nested-project/instruction-shaped.ts` — a source file whose comments are
  written as instructions to a reviewer, to demonstrate AC5.
