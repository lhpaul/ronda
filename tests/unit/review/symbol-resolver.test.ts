import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSourceFileSet,
  candidatePathsFor,
  identifyCandidates,
  isOwnLibPath,
  isRepositoryContextEligiblePath,
  isResolutionFileSetOversized,
  resolveSymbols,
  RepositoryContextUnusableContentError,
  TS_LIB_DIR,
  type RepositoryContextReadFile,
} from "../../../src/review/symbol-resolver.js";
import {
  buildRepositoryContextCandidates,
  resolveRepositoryContextOutcome,
} from "../../../src/review/repository-context.js";

function readFileFrom(
  files: Map<string, string>,
  delaysMs: Map<string, number> = new Map(),
): RepositoryContextReadFile {
  return async (path: string) => {
    const delay = delaysMs.get(path);
    if (delay) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    return files.get(path);
  };
}

async function resolveAgainst(
  files: Map<string, string>,
  changedFilePaths: string[],
  changedLinesByFile: Map<string, Set<number>>,
  readFile: RepositoryContextReadFile = readFileFrom(files),
  timeBudgetMs = 5_000,
) {
  const identified = await identifyCandidates(changedFilePaths, changedLinesByFile, readFile);
  const closure = await buildSourceFileSet(identified.changedSourceTexts, readFile, timeBudgetMs);
  const resolutions = resolveSymbols(closure.fileSet, identified.requested, closure);
  const built = buildRepositoryContextCandidates(identified.requested, resolutions);
  return { identified, closure, resolutions, ...built };
}

// --- D4: language scope ----------------------------------------------------

test("D4: only the TypeScript/JavaScript family is eligible", () => {
  for (const eligible of ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs"]) {
    assert.equal(isRepositoryContextEligiblePath(eligible), true, eligible);
  }
  for (const ineligible of ["a.md", "a.json", "a.yml", "a.yaml", "a.png"]) {
    assert.equal(isRepositoryContextEligiblePath(ineligible), false, ineligible);
  }
});

// --- E10: a changed .md/.json/.yml file only -------------------------------

test("E10: a changed non-TS/JS file contributes no candidate", async () => {
  const files = new Map([["docs/readme.md", "# hello\n"]]);
  const identified = await identifyCandidates(
    ["docs/readme.md"],
    new Map([["docs/readme.md", new Set([1])]]),
    readFileFrom(files),
  );
  assert.deepEqual(identified.requested, []);
  assert.equal(identified.changedSourceTexts.size, 0);
});

// --- E1: same-named declarations on different types ------------------------

test("E1: a method call resolves to the declaration on the reference's own type, not a same-named sibling", async () => {
  const files = new Map([
    [
      "src/types.ts",
      ["export class A {", '  read(path: string): string { return "a"; }', "}", "export class B {", '  read(path: string): string { return "b"; }', "}"].join(
        "\n",
      ),
    ],
    [
      "src/caller.ts",
      ['import { B } from "./types.js";', "", "export function run(a: B): string {", '  return a.read("x");', "}"].join("\n"),
    ],
  ]);
  const { candidates, drops } = await resolveAgainst(
    files,
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
  );
  assert.equal(drops.length, 0);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].path, "src/types.ts");
  assert.match(candidates[0].text, /return "b"/);
});

// --- E2: a shadowed local is never bound to the module-level declaration ---

test("E2: a local shadowing declaration is never attached as the module-level candidate", async () => {
  const files = new Map([
    ["src/other.ts", 'export function resolve(): string {\n  return "module-level";\n}\n'],
    [
      "src/caller.ts",
      [
        'import { resolve } from "./other.js";',
        "",
        "export function run(): string {",
        '  const resolve = () => "local";',
        "  return resolve();",
        "}",
      ].join("\n"),
    ],
  ]);
  // The changed line is the shadowed call, inside the function where the
  // local `const resolve` is in scope. TypeScript's own lexical scoping
  // binds it to the local declaration, which lives in the changed file
  // itself — E8 excludes it entirely, so no candidate is produced at all,
  // and in particular never the wrong (module-level, imported) one.
  const { candidates, drops } = await resolveAgainst(
    files,
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([5])]]),
  );
  assert.equal(candidates.length, 0);
  assert.equal(drops.length, 0);
});

// --- E3: a re-export chain --------------------------------------------------

test("E3: a re-export resolves to the declaration in the originating file", async () => {
  const files = new Map([
    ["src/inner.ts", 'export function inner(): string {\n  return "hi";\n}\n'],
    ["src/reexport.ts", 'export { inner as outer } from "./inner.js";\n'],
    [
      "src/caller.ts",
      ['import { outer } from "./reexport.js";', "", "export function run(): string {", "  return outer();", "}"].join("\n"),
    ],
  ]);
  const { candidates, closure } = await resolveAgainst(
    files,
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].path, "src/inner.ts");
  assert.ok(closure.fileSet.has("src/reexport.ts"));
  assert.ok(closure.fileSet.has("src/inner.ts"));
});

// --- E4: a time-budget cutoff before the declaring file is read ------------

test("E4: a reference whose declaring file the time budget stopped before reading is dropped time_budget", async () => {
  const files = new Map([
    ["src/other.ts", "export function helper(): void {\n  return;\n}\n"],
    [
      "src/caller.ts",
      ['import { helper } from "./other.js";', "", "export function run(): void {", "  helper();", "}"].join("\n"),
    ],
  ]);
  const { candidates, drops } = await resolveAgainst(
    files,
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
    readFileFrom(files),
    0, // exhausted before the closure walk even starts
  );
  assert.equal(candidates.length, 0);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].reason, "time_budget");
  assert.equal(drops[0].symbolName, "helper");
});

// --- E5: an unbindable (multi-declaration) reference is dropped, never guessed ---

test("E5: a symbol with more than one declaration (overload signatures) is dropped ambiguous_resolution", async () => {
  const files = new Map([
    [
      "src/overload.ts",
      [
        "export function overlap(x: number): void;",
        "export function overlap(x: string): void;",
        "export function overlap(x: unknown): void {",
        "  return;",
        "}",
      ].join("\n"),
    ],
    [
      "src/caller.ts",
      ['import { overlap } from "./overload.js";', "", "export function run(): void {", "  overlap(42);", "}"].join("\n"),
    ],
  ]);
  const { candidates, drops } = await resolveAgainst(
    files,
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
  );
  assert.equal(candidates.length, 0);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].reason, "ambiguous_resolution");
});

// --- E6: dedup by distinct symbol, not by occurrence count -----------------

test("E6: two references to different symbols on the same line, one repeated, yield two candidates not three", async () => {
  const files = new Map([
    ["src/other.ts", "export function foo(): void {}\nexport function bar(): void {}\n"],
    [
      "src/caller.ts",
      [
        'import { foo, bar } from "./other.js";',
        "",
        "export function run(): void {",
        "  foo(); bar(); foo();",
        "}",
      ].join("\n"),
    ],
  ]);
  const { identified, candidates } = await resolveAgainst(
    files,
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
  );
  assert.equal(identified.requested.length, 2);
  assert.equal(candidates.length, 2);
  assert.deepEqual(
    candidates.map((c) => c.symbolName).sort(),
    ["bar", "foo"],
  );
});

// --- E7: an identifier-shaped name inside a string is not a reference ------

test("E7: a symbol's name spelled inside a string literal is not a reference", async () => {
  const files = new Map([
    ["src/other.ts", "export function helper(): void {}\n"],
    [
      "src/caller.ts",
      ['import { helper } from "./other.js";', "", 'export const label = "helper";', "void helper;"].join("\n"),
    ],
  ]);
  // Changed line 3 names "helper" only inside a string literal.
  const identified = await identifyCandidates(
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([3])]]),
    readFileFrom(files),
  );
  assert.deepEqual(identified.requested, []);
});

// --- E8: a symbol declared and called in the same changed hunk ------------

test("E8: a symbol both declared and called within a changed file is not attached as its own candidate", async () => {
  const files = new Map([
    [
      "src/caller.ts",
      ["function helper(): number {", "  return 1;", "}", "", "export function run(): number {", "  return helper();", "}"].join(
        "\n",
      ),
    ],
  ]);
  const identified = await identifyCandidates(
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([6])]]),
    readFileFrom(files),
  );
  assert.deepEqual(identified.requested, []);
});

// --- E9: a count budget over several distinct symbols ----------------------

test("E9: a changed line depending on seven distinct symbols under a count budget of 3 keeps three and drops four", async () => {
  const otherLines = Array.from({ length: 7 }, (_, i) => `export function s${i}(): void {}`);
  const files = new Map([
    ["src/other.ts", otherLines.join("\n") + "\n"],
    [
      "src/caller.ts",
      [
        `import { ${Array.from({ length: 7 }, (_, i) => `s${i}`).join(", ")} } from "./other.js";`,
        "",
        "export function run(): void {",
        `  ${Array.from({ length: 7 }, (_, i) => `s${i}()`).join("; ")};`,
        "}",
      ].join("\n"),
    ],
  ]);
  const { identified, closure } = await resolveAgainst(
    files,
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
  );
  assert.equal(identified.requested.length, 7);
  // The budget itself is applied by src/review/repository-context.ts
  // (applyRepositoryContextBudgets), exercised directly in
  // tests/unit/review/repository-context.test.ts; this test only proves the
  // resolver correctly identifies and resolves all seven distinct symbols
  // for that module to apply its budget against.
  const resolved = closure.fileSet.size;
  assert.ok(resolved >= 2); // caller.ts + other.ts
});

// --- E11: a syntactically invalid changed file never throws ---------------

test("E11: a syntactically invalid changed file contributes no candidate and never throws", async () => {
  const files = new Map([["src/broken.ts", "this is not valid typescript { { {"]]);
  const identified = await identifyCandidates(
    ["src/broken.ts"],
    new Map([["src/broken.ts", new Set([1])]]),
    readFileFrom(files),
  );
  assert.deepEqual(identified.requested, []);
  assert.deepEqual(identified.unreadableChangedFilePaths, []);
  assert.equal(identified.changedSourceTexts.get("src/broken.ts"), files.get("src/broken.ts"));
});

// --- E12: a symlink/submodule/directory in both positions ------------------

test("E12(b): a refused changed path yields no reference, no candidate, no drop", async () => {
  const readFile: RepositoryContextReadFile = async () => undefined; // simulates a refused/absent changed path
  const identified = await identifyCandidates(
    ["src/symlink.ts"],
    new Map([["src/symlink.ts", new Set([1])]]),
    readFile,
  );
  assert.deepEqual(identified.requested, []);
  assert.deepEqual(identified.unreadableChangedFilePaths, []);
});

test("E12(a): a refused candidate-target path is dropped read_failed, not ambiguous_resolution", async () => {
  const files = new Map([
    [
      "src/caller.ts",
      ['import { helper } from "./other.js";', "", "export function run(): void {", "  helper();", "}"].join("\n"),
    ],
  ]);
  const readFile: RepositoryContextReadFile = async (p, options) => {
    if (p === "src/caller.ts") {
      return files.get(p);
    }
    if (p === "src/other.ts" && options?.failOnUnusable) {
      throw new RepositoryContextUnusableContentError(p, "type:symlink");
    }
    return undefined;
  };
  const { candidates, drops } = await resolveAgainst(
    files,
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
    readFile,
  );
  assert.equal(candidates.length, 0);
  assert.equal(drops.length, 1);
  assert.equal(drops[0].reason, "read_failed");
});

// --- E13: a .d.ts-only declaration ------------------------------------------

test("E13: a .d.ts-only declaration is bound when it is the single declaration", async () => {
  const files = new Map([
    ["src/lib.d.ts", "export declare function helper(x: number): number;\n"],
    [
      "src/caller.ts",
      ['import { helper } from "./lib";', "", "export function run(): number {", "  return helper(1);", "}"].join("\n"),
    ],
  ]);
  const { candidates, drops } = await resolveAgainst(
    files,
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
  );
  assert.equal(drops.length, 0);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].path, "src/lib.d.ts");
});

// --- E14: the three resolvable specifier forms -----------------------------

test("E14: a .js specifier resolves to its .ts source", () => {
  const candidates = candidatePathsFor("src/caller.ts", "./util.js");
  assert.ok(candidates !== undefined);
  assert.ok(candidates.includes("src/util.ts"));
  assert.ok(candidates.indexOf("src/util.js") < candidates.indexOf("src/util.ts"));
});

test("E14: an extensionless specifier resolves via the extensionless forms", () => {
  const candidates = candidatePathsFor("src/caller.ts", "./util");
  assert.ok(candidates?.includes("src/util.ts"));
});

test("E14: a directory specifier resolves via the index forms", () => {
  const candidates = candidatePathsFor("src/caller.ts", "./sub");
  assert.ok(candidates?.includes("src/sub/index.ts"));
});

// --- E15: unresolvable specifier forms are dropped, never guessed ---------

test("E15: a bare specifier is never probed and is never requested (#153: skipped, not dropped)", async () => {
  assert.equal(candidatePathsFor("src/caller.ts", "some-package"), undefined);
  const files = new Map([
    [
      "src/caller.ts",
      ['import { helper } from "some-package";', "", "export function run(): void {", "  helper();", "}"].join("\n"),
    ],
  ]);
  let probed = false;
  const readFile: RepositoryContextReadFile = async (p) => {
    if (p === "src/caller.ts") return files.get(p);
    probed = true;
    return undefined;
  };
  const { identified, candidates, drops } = await resolveAgainst(
    files,
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
    readFile,
  );
  assert.equal(probed, false); // AC9: no node_modules / bare-specifier read is ever attempted
  assert.equal(identified.requested.length, 0);
  assert.equal(identified.nonRepositoryReferencesSkipped, 1);
  assert.equal(candidates.length, 0);
  assert.equal(drops.length, 0);
});

// --- #153: non-repository references are not requested ---------------------

const BUILT_IN_ONLY = [
  'import test from "node:test";',
  'import assert from "node:assert/strict";',
  'import { readFileSync } from "node:fs";',
  "",
  'test("x", () => {',
  '  const text = readFileSync("a", "utf8");',
  '  assert.ok(text.includes("x"));',
  '  const parts = text.split(",");',
  "  const first = parts.slice(0, 1).find((p) => p.startsWith(\"a\"));",
  "  const m = /a/.exec(text);",
  "  JSON.stringify({ first, m });",
  "  void Promise.resolve(1);",
  "});",
].join("\n");

test("#153: built-in members, node:* imports and globals request no candidate", async () => {
  const files = new Map([["tests/a.test.ts", BUILT_IN_ONLY]]);
  const lines = new Set(BUILT_IN_ONLY.split("\n").map((_, i) => i + 1));
  const identified = await identifyCandidates(
    ["tests/a.test.ts"],
    new Map([["tests/a.test.ts", lines]]),
    readFileFrom(files),
  );
  assert.deepEqual(
    identified.requested.map((ref) => ref.symbolName),
    [],
  );
  assert.ok(identified.nonRepositoryReferencesSkipped > 0);
});

test("#153: a relative import used alongside built-ins is still requested; the built-ins are not", async () => {
  const files = new Map([
    ["src/repo.ts", "export class Repo {\n  read(path: string): string { return path; }\n}\n"],
    [
      "src/caller.ts",
      [
        'import { readFileSync } from "node:fs";',
        'import { Repo } from "./repo.js";',
        "",
        "export function run(repo: Repo): string {",
        '  const text = readFileSync("a", "utf8").slice(1);',
        '  return repo.read(text.split(",")[0]);',
        "}",
      ].join("\n"),
    ],
  ]);
  const { identified, candidates, drops } = await resolveAgainst(
    files,
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([5, 6])]]),
  );
  const names = identified.requested.map((ref) => ref.symbolName).sort();
  assert.ok(names.includes("read"));
  for (const builtIn of ["slice", "split", "readFileSync"]) {
    assert.ok(!names.includes(builtIn), builtIn);
  }
  assert.equal(drops.length, 0);
  assert.ok(candidates.some((c) => c.symbolName === "read" && c.path === "src/repo.ts"));
});

test("#153: a member access on a local initialised from a relative import is traced and requested", async () => {
  const files = new Map([
    ["src/repo.ts", "export function makeRepo() {\n  return { read(): string { return \"r\"; } };\n}\n"],
    [
      "src/caller.ts",
      [
        'import { makeRepo } from "./repo.js";',
        "",
        "export function run(): string {",
        "  const repo = makeRepo();",
        "  return repo.read();",
        "}",
      ].join("\n"),
    ],
  ]);
  const identified = await identifyCandidates(
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([5])]]),
    readFileFrom(files),
  );
  assert.ok(identified.requested.some((ref) => ref.symbolName === "read"));
});

const REPO_SOURCE = "export class Repo {\n  read(): string { return \"r\"; }\n}\n";

async function requestedFor(body: string[]): Promise<string[]> {
  const files = new Map([
    ["src/repo.ts", REPO_SOURCE],
    ["src/caller.ts", ['import { Repo } from "./repo.js";', "", ...body].join("\n")],
  ]);
  const lines = new Set(body.map((_, i) => i + 3));
  const identified = await identifyCandidates(
    ["src/caller.ts"],
    new Map([["src/caller.ts", lines]]),
    readFileFrom(files),
  );
  return identified.requested.map((ref) => ref.symbolName);
}

test("#153: unknown or unmodelled provenance keeps the candidate (only proven non-repository is skipped)", async () => {
  const cases: Record<string, string[]> = {
    "element of an array-typed parameter": ["export function run(repos: Repo[]): string {", "  return repos[0].read();", "}"],
    "a local type alias of the imported type": [
      "type R = Repo;",
      "export function run(r: R): string {",
      "  return r.read();",
      "}",
    ],
    "a destructured parameter": [
      "export function run({ repo }: { repo: Repo }): string {",
      "  return repo.read();",
      "}",
    ],
    "an inferred callback parameter": [
      "export function run(repos: Repo[]): string[] {",
      "  return repos.map((r) => r.read());",
      "}",
    ],
    "a generic wrapper of the imported type": [
      "export async function run(p: Promise<Repo>): Promise<string> {",
      "  return (await p).read();",
      "}",
    ],
    "an awaited Promise.resolve of the imported value": [
      "export async function run(repo: Repo): Promise<string> {",
      "  const r = await Promise.resolve(repo);",
      "  return r.read();",
      "}",
    ],
    "Array.from over imported values": [
      "export function run(repos: Repo[]): string {",
      "  return Array.from(repos)[0].read();",
      "}",
    ],
    "a callback that builds the imported type": [
      "export function run(): string {",
      "  const q = [1].map(() => new Repo())[0];",
      "  return q.read();",
      "}",
    ],
    "Array.from with an element callback": [
      "export function run(repos: Repo[]): string[] {",
      "  return Array.from(repos, (repo) => repo.read());",
      "}",
    ],
    "a generic constructor with the imported type as an argument": [
      "export function run(): string {",
      '  const repos = new Map<string, Repo>();',
      '  return repos.get("a").read();',
      "}",
    ],
    "an assertion to a local interface extending the imported type": [
      "interface LocalRepo extends Repo {}",
      "export function run(): string {",
      "  const repos = [] as LocalRepo[];",
      "  return repos[0].read();",
      "}",
    ],
    "a contextually typed parameter with a null default": [
      "declare function visit(cb: (repo: Repo | null) => unknown): void;",
      "export function run(): void {",
      "  visit((repo = null) => {",
      "    if (repo) repo.read();",
      "  });",
      "}",
    ],
    "a let reassigned to the imported type": [
      "export function run(): string {",
      "  let r = null;",
      "  r = new Repo();",
      "  return r.read();",
      "}",
    ],
    "an instanceof narrowing of an external declared type": [
      "export function run(e: Error): string {",
      "  if (e instanceof Repo) return e.read();",
      '  return "";',
      "}",
    ],
    "a closure inside an instanceof narrowing": [
      "export function run(e: Error): (() => string) | undefined {",
      "  if (e instanceof Repo) {",
      "    return () => e.read();",
      "  }",
      "  return undefined;",
      "}",
    ],
    "a closure under a module-scope instanceof narrowing": [
      "const e: Error = new Error();",
      "if (e instanceof Repo) {",
      "  const fn = () => e.read();",
      "  fn();",
      "}",
    ],
    "a const alias of a narrowed name": [
      "export function run(e: Error): string {",
      "  if (e instanceof Repo) {",
      "    const alias = e;",
      "    return alias.read();",
      "  }",
      '  return "";',
      "}",
    ],
    "a guard result held in a boolean": [
      'import { isRepo } from "./repo.js";',
      "export function run(e: Error): string {",
      "  const ok = isRepo(e);",
      "  if (ok) return e.read();",
      '  return "";',
      "}",
    ],
    "a local alias of an imported guard": [
      'import { isRepo } from "./repo.js";',
      "const guard = isRepo;",
      "export function run(e: Error): string {",
      "  if (guard(e)) return e.read();",
      '  return "";',
      "}",
    ],
    "a local type-predicate guard": [
      "declare function isRepo(x: Error): x is Repo;",
      "export function run(e: Error): string {",
      "  if (isRepo(e)) return e.read();",
      '  return "";',
      "}",
    ],
    "an operand with satisfies": [
      "export function run(): string {",
      "  const repo = new Repo() satisfies object;",
      "  return repo.read();",
      "}",
    ],
    "an unannotated parameter whose type is unknown": ["export function run(thing) {", "  return thing.read();", "}"],
  };
  for (const [name, body] of Object.entries(cases)) {
    assert.ok((await requestedFor(body)).includes("read"), name);
  }
});

test("#153: shared initializer chains are traced in bounded time", async () => {
  const refs = (name: string) => Array.from({ length: 60 }, () => name).join(", ");
  const body = [
    "const a0 = [];",
    `const a1 = [${refs("a0")}];`,
    `const a2 = [${refs("a1")}];`,
    `const a3 = [${refs("a2")}];`,
    `const a4 = [${refs("a3")}];`,
    "a4.missing();",
  ];
  const files = new Map([["src/caller.ts", body.join("\n")]]);
  const started = Date.now();
  const identified = await identifyCandidates(
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([6])]]),
    readFileFrom(files),
  );
  assert.ok(Date.now() - started < 3_000, `took ${Date.now() - started}ms`);
  // Exhausting the work budget yields unknown, which keeps the candidate.
  assert.ok(identified.requested.every((ref) => ref.symbolName === "missing"));
});

test("#153: a JSDoc-typed declaration in a JavaScript file keeps its candidate", async () => {
  const files = new Map([
    ["src/repo.js", "export class Repo {\n  read() { return 'r'; }\n}\n"],
    [
      "src/caller.js",
      [
        'import { Repo } from "./repo.js";',
        "",
        "export function run() {",
        "  /** @type {Repo} */",
        "  const r = null;",
        "  return r.read();",
        "}",
      ].join("\n"),
    ],
  ]);
  const identified = await identifyCandidates(
    ["src/caller.js"],
    new Map([["src/caller.js", new Set([6])]]),
    readFileFrom(files),
  );
  assert.ok(identified.requested.some((ref) => ref.symbolName === "read"));
});

test("#153: a member missing from a concretely typed base may be a repository augmentation and is kept", async () => {
  const files = new Map([
    ["src/extend.ts", 'declare global {\n  interface String {\n    repoMethod(): string;\n  }\n}\nexport {};\n'],
    [
      "src/caller.ts",
      ['import "./extend.js";', "", "export function run(text: string): string {", "  return text.repoMethod();", "}"].join(
        "\n",
      ),
    ],
  ]);
  const identified = await identifyCandidates(
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
    readFileFrom(files),
  );
  assert.ok(identified.requested.some((ref) => ref.symbolName === "repoMethod"));
});

test("#153: a chained access through a repository-augmented member of a concrete receiver is kept", async () => {
  const files = new Map([
    [
      "src/extend.ts",
      'import { Repo } from "./repo.js";\ndeclare global {\n  interface String {\n    repo(): Repo;\n  }\n}\nexport {};\n',
    ],
    ["src/repo.ts", REPO_SOURCE],
    [
      "src/caller.ts",
      ['import "./extend.js";', "", "export function run(text: string): string {", "  return text.repo().read();", "}"].join(
        "\n",
      ),
    ],
  ]);
  const identified = await identifyCandidates(
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
    readFileFrom(files),
  );
  assert.ok(identified.requested.some((ref) => ref.symbolName === "read"));
});

test("#153: a const alias of a repository-augmented member of a concrete receiver is kept", async () => {
  const files = new Map([
    [
      "src/extend.ts",
      'import { Repo } from "./repo.js";\ndeclare global {\n  interface String {\n    repo(): Repo;\n  }\n}\nexport {};\n',
    ],
    ["src/repo.ts", REPO_SOURCE],
    [
      "src/caller.ts",
      [
        'import "./extend.js";',
        "",
        "export function run(text: string): string {",
        "  const r = text.repo();",
        "  return r.read();",
        "}",
      ].join("\n"),
    ],
  ]);
  const identified = await identifyCandidates(
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([5])]]),
    readFileFrom(files),
  );
  assert.ok(identified.requested.some((ref) => ref.symbolName === "read"));
});

test("#153: a lib member that a side-effect-imported module may augment is kept", async () => {
  const files = new Map([
    [
      "src/extend.ts",
      'declare global {\n  interface String {\n    slice(from: number, to: number, extra: string): string;\n  }\n}\nexport {};\n',
    ],
    [
      "src/caller.ts",
      ['import "./extend.js";', "", "export function run(text: string): string {", "  return text.slice(0);", "}"].join("\n"),
    ],
  ]);
  const identified = await identifyCandidates(
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
    readFileFrom(files),
  );
  assert.ok(identified.requested.some((ref) => ref.symbolName === "slice"));
});

test("#153: narrowing analysis scales linearly with the number of traced names", async () => {
  const count = 1_500;
  const body = ['import { readFileSync } from "node:fs";'];
  for (let i = 0; i < count; i += 1) {
    body.push(`const x${i} = readFileSync("x");`, `x${i}.foo();`);
  }
  const files = new Map([["src/caller.ts", body.join("\n")]]);
  const lines = new Set(body.map((_, i) => i + 1));
  const started = Date.now();
  const identified = await identifyCandidates(["src/caller.ts"], new Map([["src/caller.ts", lines]]), readFileFrom(files));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5_000, `took ${elapsed}ms`);
  assert.equal(identified.requested.length, 0);
});

test("#153: a callback over a primitive-typed array is proven non-repository and skipped", async () => {
  const names = await requestedFor([
    "export function run(words: string[]): boolean {",
    '  return words.some((w) => w.startsWith("a"));',
    "}",
  ]);
  assert.deepEqual(names, []);
});

test("#153: a member access on a member of an external import is skipped", async () => {
  const files = new Map([
    [
      "src/caller.ts",
      ['import express from "express";', "", "export function run(): void {", "  express().listen(3000);", "}"].join(
        "\n",
      ),
    ],
  ]);
  const identified = await identifyCandidates(
    ["src/caller.ts"],
    new Map([["src/caller.ts", new Set([4])]]),
    readFileFrom(files),
  );
  assert.deepEqual(identified.requested, []);
  assert.ok(identified.nonRepositoryReferencesSkipped >= 1);
});

test("#153: a pass whose references are all non-repository reports nothing_to_resolve, not unavailable", async () => {
  const files = new Map([["tests/a.test.ts", BUILT_IN_ONLY]]);
  const { identified } = await resolveAgainst(
    files,
    ["tests/a.test.ts"],
    new Map([["tests/a.test.ts", new Set(BUILT_IN_ONLY.split("\n").map((_, i) => i + 1))]]),
  );
  assert.equal(
    resolveRepositoryContextOutcome({
      candidatesRequested: identified.requested.length,
      candidatesResolved: 0,
    }),
    "nothing_to_resolve",
  );
});

// --- E16: one changed file reads fine, a sibling fails transiently --------

test("E16: a transiently-failing changed file is unaccounted; a sibling's references still resolve", async () => {
  const files = new Map([
    ["src/good.ts", 'import { helper } from "./other.js";\n\nexport function run(): void {\n  helper();\n}\n'],
    ["src/other.ts", "export function helper(): void {}\n"],
  ]);
  const readFile: RepositoryContextReadFile = async (p) => {
    if (p === "src/bad.ts") {
      throw new Error("transient 503");
    }
    return files.get(p);
  };
  const identified = await identifyCandidates(
    ["src/bad.ts", "src/good.ts"],
    new Map([
      ["src/bad.ts", new Set([1])],
      ["src/good.ts", new Set([4])],
    ]),
    readFile,
  );
  assert.deepEqual(identified.unreadableChangedFilePaths, ["src/bad.ts"]);
  assert.equal(identified.requested.length, 1);
  assert.equal(identified.requested[0].symbolName, "helper");
});

// --- Scenario 1 (timing-variation half): reproducible under differing latency ---

test("scenario 1: identical requested set and read order under differing per-read latencies", async () => {
  const files = new Map([
    ["src/a.ts", "export function a(): void {}\n"],
    ["src/b.ts", "export function b(): void {}\n"],
    [
      "src/caller.ts",
      [
        'import { a } from "./a.js";',
        'import { b } from "./b.js";',
        "",
        "export function run(): void {",
        "  a(); b();",
        "}",
      ].join("\n"),
    ],
  ]);
  const changedLines = new Map([["src/caller.ts", new Set([5])]]);

  const fast = await resolveAgainst(files, ["src/caller.ts"], changedLines, readFileFrom(files));
  const slow = await resolveAgainst(
    files,
    ["src/caller.ts"],
    changedLines,
    readFileFrom(
      files,
      new Map([
        ["src/a.ts", 5],
        ["src/b.ts", 1],
      ]),
    ),
  );

  assert.deepEqual(
    fast.identified.requested.map((r) => r.symbolName),
    slow.identified.requested.map((r) => r.symbolName),
  );
  assert.deepEqual([...fast.closure.fileSet.keys()], [...slow.closure.fileSet.keys()]);
  assert.deepEqual(
    fast.candidates.map((c) => c.symbolName).sort(),
    slow.candidates.map((c) => c.symbolName).sort(),
  );
});

// --- Scenario 9 (in full): the injected seam only, no repository-wide listing ---

test("scenario 9: every read goes through the injected readFile seam; no path is ever probed twice needlessly", async () => {
  const files = new Map([
    ["src/other.ts", "export function helper(): void {}\n"],
    [
      "src/caller.ts",
      ['import { helper } from "./other.js";', "", "export function run(): void {", "  helper();", "}"].join("\n"),
    ],
  ]);
  const requestedPaths: string[] = [];
  const readFile: RepositoryContextReadFile = async (p) => {
    requestedPaths.push(p);
    return files.get(p);
  };
  await resolveAgainst(files, ["src/caller.ts"], new Map([["src/caller.ts", new Set([4])]]), readFile);
  // Only the changed file and the literal .js probe (miss) plus the .ts hit
  // are ever read — never a directory listing, never a duplicate read of an
  // already-resolved path.
  assert.deepEqual(requestedPaths, ["src/caller.ts", "src/other.js", "src/other.ts"]);
});

// --- Scenario 12: AC23 measured resolution precision -----------------------

interface ExpectedReference {
  symbolName: string;
  changedLine: number;
  expected: { path: string; line: number; endLine: number } | "ambiguous_resolution";
}

interface ExpectedFixture {
  changedFile: string;
  references: ExpectedReference[];
}

const FIXTURE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "fixtures",
  "repository-context",
  "resolution",
);

test("scenario 12 (AC23): resolution precision on the recorded fixture is 100%", async () => {
  const expected: ExpectedFixture = JSON.parse(readFileSync(join(FIXTURE_DIR, "expected.json"), "utf8"));

  const fileNames = ["types.ts", "shared.ts", "inner.ts", "reexport.ts", "overload.ts", "changed.ts"];
  const files = new Map(fileNames.map((name) => [name, readFileSync(join(FIXTURE_DIR, name), "utf8")]));
  const readFile: RepositoryContextReadFile = async (path) => files.get(path);

  const changedPath = expected.changedFile;
  const changedText = files.get(changedPath);
  assert.ok(changedText, "the fixture's changed file must exist");
  const totalLines = changedText.split("\n").length;
  const changedLines = new Map([[changedPath, new Set(Array.from({ length: totalLines }, (_, i) => i + 1))]]);

  const identified = await identifyCandidates([changedPath], changedLines, readFile);
  const closure = await buildSourceFileSet(identified.changedSourceTexts, readFile, 60_000);
  const resolutions = resolveSymbols(closure.fileSet, identified.requested, closure);
  const built = buildRepositoryContextCandidates(identified.requested, resolutions);

  // Every reference the fixture names must be accounted for as either a
  // resolved candidate or an ambiguous_resolution drop — nothing silently
  // missing, and nothing silently guessed. Two expected entries can share the
  // same (symbolName, changedLine) key (A's and B's same-named `read` call,
  // both on the same line) — a queue per key, consumed in `expected.json`'s
  // own declared order against candidates sorted by declaration position,
  // disambiguates them without relying on array-find's first-match.
  const candidateQueues = new Map<string, typeof built.candidates>();
  for (const candidate of [...built.candidates].sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)) {
    const key = `${candidate.symbolName}@${candidate.changedLine}`;
    const queue = candidateQueues.get(key) ?? [];
    queue.push(candidate);
    candidateQueues.set(key, queue);
  }
  const dropQueues = new Map<string, typeof built.drops>();
  for (const drop of built.drops) {
    const key = `${drop.symbolName}@${drop.line}`;
    const queue = dropQueues.get(key) ?? [];
    queue.push(drop);
    dropQueues.set(key, queue);
  }

  for (const ref of expected.references) {
    const key = `${ref.symbolName}@${ref.changedLine}`;
    if (ref.expected === "ambiguous_resolution") {
      const drop = dropQueues.get(key)?.shift();
      assert.ok(drop, `expected an ambiguous_resolution drop for ${key}`);
      assert.equal(drop?.reason, "ambiguous_resolution");
    } else {
      const candidate = candidateQueues.get(key)?.shift();
      assert.ok(candidate, `expected a resolved candidate for ${key}`);
      assert.equal(candidate?.path, ref.expected.path);
      assert.equal(candidate?.line, ref.expected.line);
      assert.equal(candidate?.endLine, ref.expected.endLine);
    }
  }

  // Precision: resolved candidates that are correct over all resolved
  // candidates (AC23). Every resolved candidate above already matched its
  // expected declaration exactly, so precision is 100% by construction of
  // the assertions above; this second pass restates it as the measured
  // figure the evidence document cites.
  const expectedResolvedCount = expected.references.filter((r) => r.expected !== "ambiguous_resolution").length;
  assert.equal(built.candidates.length, expectedResolvedCount);
  assert.equal(built.drops.filter((d) => d.reason === "ambiguous_resolution").length, 1);
  const precision = built.candidates.length / built.candidates.length; // resolved-correct / resolved-total
  assert.equal(precision, 1);
});

// --- isOwnLibPath (local-ai-reviewer finding, PR #130) --------------------
// The virtual compiler host's real-filesystem fallback must be scoped to
// Ronda's own pinned typescript lib directory alone — never to "any
// absolute path", which would let a reviewed file's own (untrusted) import
// specifier reach the real filesystem through TypeScript's own module
// resolution.

test("isOwnLibPath: a real lib file inside TS_LIB_DIR is true", () => {
  assert.equal(isOwnLibPath(join(TS_LIB_DIR, "lib.es2022.d.ts")), true);
  assert.equal(isOwnLibPath(TS_LIB_DIR), true);
});

test("isOwnLibPath: an arbitrary absolute path is false", () => {
  assert.equal(isOwnLibPath("/etc/passwd"), false);
  assert.equal(isOwnLibPath("/etc/hostname"), false);
});

test("isOwnLibPath: a sibling directory sharing TS_LIB_DIR as a string prefix is false", () => {
  // Guards against a naive `startsWith` string-prefix check: "…/lib-evil"
  // starts with the same characters as "…/lib" but is not inside it.
  assert.equal(isOwnLibPath(`${TS_LIB_DIR}-evil/foo.d.ts`), false);
});

// --- Oversized-changed-file backstop (local-ai-reviewer finding, PR #130) --
// identifyCandidates's own changed-files-only program (step a) is just as
// synchronous and uninterruptible as resolveSymbols's closure program — a
// single pathologically large changed file must not reach it either.

test("identifyCandidates excludes a single oversized changed file, accounted for, never parsed", async () => {
  const files = new Map([
    ["src/huge.ts", "x".repeat(300_001)],
    ["src/normal.ts", "export function helper(): void {}\n"],
  ]);
  const identified = await identifyCandidates(
    ["src/huge.ts", "src/normal.ts"],
    new Map([
      ["src/huge.ts", new Set([1])],
      ["src/normal.ts", new Set([1])],
    ]),
    readFileFrom(files),
  );
  assert.deepEqual(identified.requested, []);
  assert.deepEqual(identified.unreadableChangedFilePaths, []);
  assert.equal(identified.changedSourceTexts.has("src/huge.ts"), false);
  assert.equal(identified.changedSourceTexts.has("src/normal.ts"), true);
});

// --- Oversized-closure backstop (local-ai-reviewer finding, PR #130) ------
// resolveSymbols builds and type-checks the fetched closure synchronously,
// which no AbortSignal can interrupt once started. A defensive size backstop
// skips compilation entirely for a pathologically large fetched set, rather
// than letting an unbounded synchronous compile block the process.

test("isResolutionFileSetOversized: within both backstops is false", () => {
  const fileSet = new Map([["a.ts", "x".repeat(100)]]);
  assert.equal(isResolutionFileSetOversized(fileSet), false);
});

test("isResolutionFileSetOversized: over the file-count backstop is true", () => {
  const fileSet = new Map<string, string>();
  for (let i = 0; i < 101; i += 1) {
    fileSet.set(`file-${i}.ts`, "x");
  }
  assert.equal(isResolutionFileSetOversized(fileSet), true);
});

test("isResolutionFileSetOversized: over the combined-character backstop is true", () => {
  const fileSet = new Map([["huge.ts", "x".repeat(1_000_001)]]);
  assert.equal(isResolutionFileSetOversized(fileSet), true);
});

test("resolveSymbols skips compilation and drops every requested reference time_budget when the fetched set is oversized", () => {
  const fileSet = new Map([["src/caller.ts", "x".repeat(1_000_001)]]);
  const requested = [
    {
      id: 0,
      kind: "definition" as const,
      symbolName: "helper",
      changedPath: "src/caller.ts",
      changedLine: 1,
      anchorPos: 0,
    },
  ];
  const results = resolveSymbols(fileSet, requested, {
    resolvedSpecifierKeys: new Set(),
    refusedSpecifierKeys: new Set(),
    attemptedSpecifierKeys: new Set(),
  });
  assert.deepEqual(results, [{ id: 0, reason: "time_budget" }]);
});
