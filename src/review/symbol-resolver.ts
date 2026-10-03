import * as path from "node:path";
import ts from "typescript";
import type { RepositoryContextDropReason } from "../domain/review-pass.types.js";
import type {
  RepositoryContextRequestedReference,
  RepositoryContextResolution,
} from "./repository-context.js";

/**
 * The TypeScript-compiler-backed resolver (D2). Reads every reviewed-repo
 * file through the single injected {@link RepositoryContextReadFile} seam —
 * never `node:fs`, never a repository-wide listing (owner decision,
 * 2026-09-29) — and binds each changed-line reference to the declaration the
 * reviewed language's own compiler/checker binds it to, or drops it rather
 * than guessing (**Context Selection Order** → Resolution correctness).
 */

/** D4: the reviewed repository's TypeScript/JavaScript family, and nothing else. */
const ELIGIBLE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/**
 * Defensive backstops on the fetched closure `resolveSymbols` will
 * synchronously parse and type-check. `buildSourceFileSet`'s time budget
 * already bounds how much *network* time is spent fetching, but a small
 * number of pathologically large or type-complex files could still make the
 * synchronous compiler pass itself run long after every read has already
 * returned — and unlike a GitHub read, a synchronous `ts.Program`/checker
 * call cannot be interrupted by an `AbortSignal` once started, which could
 * otherwise block a long-lived webhook worker past its own watchdog
 * recovery. When either backstop is exceeded, resolution is skipped
 * entirely and every requested reference is dropped `time_budget` — the
 * same reason an exhausted context time budget already uses, since this is
 * the same budget-protection concern, not a sixth drop reason.
 *
 * **Recorded limitation, not a full fix**: these are size caps, not a CPU-
 * time bound. A file set at or under either cap can still, in a pathological
 * case (deeply nested generic or conditional types, for instance), take
 * longer to type-check than the configured budget — nothing here can
 * preempt a synchronous compiler call already in flight; only running that
 * call in a separate worker thread, with its own terminable execution
 * context, would give a genuine CPU-time bound, and that is a materially
 * larger architectural change than this feature's existing GitHub-contents-
 * seam, in-process design (D2) — out of scope for this iteration. The
 * values below are set low enough to keep this a narrow, disclosed residual
 * risk rather than a first-order concern for this repository's own
 * TypeScript source, which this feature dogfoods against first. A synthetic
 * at-cap worst-case measurement (well under one second of synchronous
 * compiler time; see
 * `docs/testing/ronda/repository-context-read-only-evidence-106.md`) and the
 * worker-thread-isolation follow-up (owner-accepted residual risk, filed as
 * https://github.com/lhpaul/ronda/issues/131, to land before this feature is
 * enabled on a long-lived webhook ingress) are both recorded there.
 */
const MAX_RESOLUTION_FILE_COUNT = 100;
const MAX_RESOLUTION_TOTAL_CHARS = 1_000_000;
/**
 * Same concern, applied to identification's own changed-files-only program
 * (step a — bounded by the pass deadline alone, D5, but its parse/type-check/
 * AST-walk is just as synchronous and just as uninterruptible). One
 * pathologically large single changed file is capped here directly; the
 * combined-total and file-count caps below reuse the resolution backstops
 * above, since both programs carry the same synchronous-blocking risk.
 */
const MAX_CHANGED_FILE_CHARS = 300_000;

/** The module-resolution contract's fixed compiler options. `tsconfig.json` is not read this iteration. */
const COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.Node16,
  moduleResolution: ts.ModuleResolutionKind.Node16,
  allowJs: true,
  checkJs: false,
  esModuleInterop: true,
  strict: false,
  noEmit: true,
  skipLibCheck: true,
  types: [],
};

/** `.js`-family → TypeScript source extension substitutions (module-resolution contract). */
const EXTENSION_SUBSTITUTIONS: Array<[string, string]> = [
  [".mjs", ".mts"],
  [".cjs", ".cts"],
  [".jsx", ".tsx"],
  [".js", ".ts"],
];

const EXTENSIONLESS_FORMS = [".ts", ".tsx", ".d.ts", ".js"];

export function isRepositoryContextEligiblePath(filePath: string): boolean {
  return ELIGIBLE_EXTENSIONS.some((ext) => filePath.endsWith(ext));
}

export type RepositoryContextReadFileOptions = { failOnUnusable?: boolean };
export type RepositoryContextReadFile = (
  path: string,
  options?: RepositoryContextReadFileOptions,
) => Promise<string | undefined>;

/** Thrown by an injected {@link RepositoryContextReadFile} for a real-but-unusable path (E12a). */
export class RepositoryContextUnusableContentError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`Repository content unusable at ${path}: ${reason}`);
    this.name = "RepositoryContextUnusableContentError";
  }
}

/** A requested reference augmented with the resolver's own internal bookkeeping. Not exported to `repository-context.ts`. */
export interface InternalRequestedReference extends RepositoryContextRequestedReference {
  /**
   * Character offset of the reference identifier within its changed file's
   * text (the *same* text `buildSourceFileSet` and `resolveSymbols` reuse),
   * used to relocate the same reference in the closure program without
   * relying on cross-program node identity.
   */
  anchorPos: number;
  /**
   * `${importingFile}::${specifierText}` when this reference is bound to an
   * import/re-export alias whose target module is the changed file's own
   * *direct* (first-hop) specifier. Used only to classify an unresolved
   * first-hop reference as `time_budget` versus `ambiguous_resolution`
   * (E4). A reference with no specifier (a local declaration reached only
   * through a re-export chain beyond the first hop, or a non-alias symbol)
   * carries no key, and an unresolved deeper-hop chain is classified
   * `ambiguous_resolution` — a documented simplification (see
   * `symbol-resolver.ts`'s module doc comment).
   */
  specifierKey?: string;
}

export interface IdentifyCandidatesResult {
  requested: InternalRequestedReference[];
  /** Paths whose read failed **transiently** (past the bounded retry) — D5, E16. */
  unreadableChangedFilePaths: string[];
  /** Changed files successfully read, keyed by path — reused by `buildSourceFileSet` (never re-read). */
  changedSourceTexts: Map<string, string>;
  contentRequestCount: number;
  /**
   * Distinct references the identification step declined to request because
   * they cannot name repository code (built-in or global library members,
   * `node:*` and package imports, member accesses not traceable to a relative
   * import). A count only, so the filter stays visible without restoring the
   * noise it removed (#153).
   */
  nonRepositoryReferencesSkipped: number;
}

/**
 * Step (a): reads the changed TypeScript/JavaScript-family files' full text
 * at the head — under the **pass deadline only**, never the context time
 * budget (D5) — parses each, and returns one requested candidate per
 * distinct referenced symbol whose declaration is not itself in one of the
 * changed files (E8).
 */
export async function identifyCandidates(
  changedFilePaths: string[],
  changedLinesByFile: Map<string, Set<number>>,
  readFile: RepositoryContextReadFile,
): Promise<IdentifyCandidatesResult> {
  const eligible = [...new Set(changedFilePaths)]
    .filter(isRepositoryContextEligiblePath)
    .sort((a, b) => a.localeCompare(b));

  const changedSourceTexts = new Map<string, string>();
  const unreadableChangedFilePaths: string[] = [];
  let contentRequestCount = 0;
  let combinedChangedChars = 0;

  for (const filePath of eligible) {
    contentRequestCount += 1;
    let text: string | undefined;
    try {
      text = await readFile(filePath);
    } catch {
      unreadableChangedFilePaths.push(filePath);
      continue;
    }
    if (text !== undefined) {
      // A single pathologically large changed file, or too many combined,
      // would make the synchronous parse+type-check+AST-walk below
      // (nothing here observes any `AbortSignal`, same concern as
      // `resolveSymbols`'s own backstop) block the process for a long time
      // — on the webhook ingress, potentially past the pass deadline/
      // watchdog. Declining to include an oversized file is a deterministic
      // fact about the head, exactly like a refused non-file type (position
      // (b) below) — accounted for, no candidate, no drop, and `nothing_to_
      // resolve` stays available when every other changed file also
      // produces nothing.
      if (
        text.length <= MAX_CHANGED_FILE_CHARS &&
        combinedChangedChars + text.length <= MAX_RESOLUTION_TOTAL_CHARS &&
        changedSourceTexts.size < MAX_RESOLUTION_FILE_COUNT
      ) {
        changedSourceTexts.set(filePath, text);
        combinedChangedChars += text.length;
      }
    }
    // text === undefined: absent (404) or a refused non-file type — both are
    // "accounted for" at this position (module-resolution contract, position
    // (b)): no source, no reference, no candidate, no drop.
  }

  if (changedSourceTexts.size === 0) {
    return {
      requested: [],
      unreadableChangedFilePaths,
      changedSourceTexts,
      contentRequestCount,
      nonRepositoryReferencesSkipped: 0,
    };
  }

  const host = createVirtualCompilerHost(changedSourceTexts);
  const program = ts.createProgram({
    rootNames: [...changedSourceTexts.keys()],
    options: COMPILER_OPTIONS,
    host,
  });
  const checker = program.getTypeChecker();
  const changedFileSet = new Set(changedSourceTexts.keys());
  const seen = new Map<ts.Symbol, number>();
  const seenDeferred = new Map<string, number>();
  const symbolIds = new Map<ts.Symbol, number>();
  const skipped = new Set<string | ts.Symbol>();
  const trace: TraceContext = {
    checker,
    remaining: TRACE_WORK_BUDGET,
    symbolMemo: new Map(),
    traced: new Set(),
    narrowingMemo: new Map(),
  };
  const requested: InternalRequestedReference[] = [];
  let nextId = 0;

  for (const filePath of [...changedSourceTexts.keys()].sort((a, b) => a.localeCompare(b))) {
    const sourceFile = program.getSourceFile(filePath);
    const changedLines = changedLinesByFile.get(filePath);
    if (!sourceFile || !changedLines || changedLines.size === 0) {
      continue;
    }

    const visit = (node: ts.Node): void => {
      if (ts.isIdentifier(node)) {
        considerIdentifier(
          node,
          sourceFile,
          filePath,
          changedLines,
          changedFileSet,
          checker,
          seen,
          seenDeferred,
          symbolIds,
          skipped,
          trace,
          requested,
          () => nextId++,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return {
    requested,
    unreadableChangedFilePaths,
    changedSourceTexts,
    contentRequestCount,
    nonRepositoryReferencesSkipped: skipped.size,
  };
}

function considerIdentifier(
  node: ts.Identifier,
  sourceFile: ts.SourceFile,
  filePath: string,
  changedLines: Set<number>,
  changedFileSet: Set<string>,
  checker: ts.TypeChecker,
  seen: Map<ts.Symbol, number>,
  seenDeferred: Map<string, number>,
  symbolIds: Map<ts.Symbol, number>,
  skipped: Set<string | ts.Symbol>,
  trace: TraceContext,
  requested: InternalRequestedReference[],
  allocateId: () => number,
): void {
  const oneBasedLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
  if (!changedLines.has(oneBasedLine)) {
    return;
  }

  let symbol: ts.Symbol | undefined;
  try {
    symbol = checker.getSymbolAtLocation(node);
  } catch {
    symbol = undefined;
  }

  const isPropertyAccessMember =
    ts.isPropertyAccessExpression(node.parent) && node.parent.name === node;

  if (!symbol) {
    if (!isPropertyAccessMember) {
      return; // not a bindable reference at all (a keyword, a punctuation-shaped node, etc.)
    }
    // Deferred (E1): a member access on a value whose type comes from an
    // import cannot bind in the changed-files-only program — the checker has
    // no member list for a type it cannot see yet. Request it now, so its
    // budget is spent, and re-resolve it once the full program exists (step
    // c), which is exactly what step (c) does via `anchorPos` relocation.
    // Dedup key is the *base* expression's symbol (when program-1 can
    // resolve it — usually a plain local/imported identifier) or its text,
    // paired with the member name — a documented simplification of E6 for
    // this sub-case: it merges the common repeated-access pattern
    // (`a.read()` called twice on the same `a`) without needing full type
    // information, but a resolved declaration is deduplicated again, by
    // declaration identity, in `resolveSymbols`.
    const key = deferredDedupKey(node.parent.expression, node.text, checker, symbolIds);
    if (seenDeferred.has(key)) {
      return;
    }
    // #153: skip a member access only when its base is *proven* not to be
    // repository code (`text.includes(...)`, `re.exec(...)`, members of a
    // literal, a primitive-typed local, or an external import). Requesting
    // them spent the budget and turned a pass with nothing to resolve into
    // `unavailable`. A base the tracer does not model keeps its candidate, and
    // so does a member missing from a *concretely typed* base: the full lib is
    // loaded, so `"a".repoMethod()` is unresolved only because some repository
    // file may augment `String`.
    trace.remaining = TRACE_WORK_BUDGET;
    trace.traced = new Set();
    // The root name is traced even when it has no declaration to follow.
    const rootSymbol = rootSymbolOf(node.parent.expression, checker);
    if (rootSymbol) {
      trace.traced.add(rootSymbol);
    }
    if (
      classifyProvenance(node.parent.expression, trace, 0) === "external" &&
      isAnyChain(node.parent.expression, checker) &&
      ![...trace.traced].some((traced) => narrowingMayApply(traced, trace))
    ) {
      skipped.add(`deferred:${key}`);
      return;
    }
    const id = allocateId();
    seenDeferred.set(key, id);
    requested.push({
      id,
      kind: "definition",
      symbolName: node.text,
      changedPath: filePath,
      changedLine: oneBasedLine,
      anchorPos: node.getStart(sourceFile),
    });
    return;
  }

  const declarations = symbol.declarations ?? [];
  if (declarations.some((decl) => isNameNodeOf(decl, node))) {
    return; // this occurrence is the declaration site itself, not a reference to it.
  }
  // E8: a *non-alias* symbol's declaration is decidable from the
  // changed-files-only program alone — a locally declared function, class,
  // or variable used within the changed files is excluded, because the
  // changed lines already show it. An alias (import/re-export) symbol's raw
  // `declarations` at this stage is always the import specifier itself, which
  // is trivially "in a changed file" (the importing file) regardless of
  // where its target actually lives — that is not what E8 means, so the
  // exclusion is deliberately not applied to alias symbols here. The rare
  // case of a changed file importing a symbol whose declaration is itself in
  // another changed file is a documented simplification: it may still
  // surface as a candidate rather than being suppressed, which is safe
  // (extra, harmless context) rather than a correctness gap.
  const isAlias = (symbol.flags & ts.SymbolFlags.Alias) !== 0;
  if (
    !isAlias &&
    declarations.length > 0 &&
    declarations.every((decl) => changedFileSet.has(decl.getSourceFile().fileName))
  ) {
    return;
  }
  // #153: globals and default-library members (`Promise`, `JSON`,
  // `String.prototype.slice`) are declared only in TypeScript's own lib
  // files, and an import whose first-hop specifier is not relative (`node:*`,
  // a package name) points outside the repository. Neither can resolve to
  // repository code, so neither is requested.
  const declaredOnlyInLib =
    declarations.length > 0 &&
    declarations.every((decl) => isOwnLibPath(decl.getSourceFile().fileName));
  const externalImport = isAlias && isNonRelativeSpecifier(aliasModuleSpecifier(symbol));
  if (declaredOnlyInLib || externalImport) {
    skipped.add(symbol);
    return;
  }
  if (seen.has(symbol)) {
    return; // E6: one requested candidate per distinct referenced symbol.
  }

  const id = allocateId();
  seen.set(symbol, id);
  requested.push({
    id,
    kind: "definition",
    symbolName: node.text,
    changedPath: filePath,
    changedLine: oneBasedLine,
    anchorPos: node.getStart(sourceFile),
    specifierKey: firstHopSpecifierKey(symbol, filePath),
  });
}

/**
 * True for a module specifier that cannot be a repository path: `node:*`,
 * package names, `#imports`, `paths` aliases. The exact complement of what
 * {@link candidatePathsFor} is willing to probe, so identification never
 * requests a reference resolution would refuse to follow.
 */
function isNonRelativeSpecifier(specifier: string | undefined): boolean {
  return specifier !== undefined && candidatePathsFor("", specifier) === undefined;
}

/**
 * The module specifier text of the import/re-export an alias symbol was
 * declared by, when that can be read syntactically; `undefined` when it
 * cannot (callers then keep the candidate rather than guess).
 */
function aliasModuleSpecifier(symbol: ts.Symbol): string | undefined {
  let node: ts.Node | undefined = symbol.declarations?.[0];
  while (node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      return node.moduleSpecifier.text;
    }
    if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      return node.moduleReference.expression.text;
    }
    node = node.parent;
  }
  return undefined;
}

/**
 * Whether an access chain is `any`-typed at every member step, not just at its
 * end. `text.repo().read()` ends in an `any` (the unresolved `repo`), but that
 * is a member missing from a concretely typed `string`, which a repository
 * augmentation may supply; only members missing from an `any` base are
 * explained by an unresolved import.
 */
function isAnyChain(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  if (!isAnyTyped(expression, checker)) {
    return false;
  }
  return everyMemberBaseIsAny(expression, checker);
}

function everyMemberBaseIsAny(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return isAnyTyped(expression.expression, checker) && everyMemberBaseIsAny(expression.expression, checker);
  }
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
    return everyMemberBaseIsAny(expression.expression, checker);
  }
  if (ts.isNonNullExpression(expression) || ts.isParenthesizedExpression(expression) || ts.isAwaitExpression(expression)) {
    return everyMemberBaseIsAny(expression.expression, checker);
  }
  return true;
}

/**
 * Whether the checker typed an expression as `any` (or could not type it). In
 * the changed-files-only program that is what an unresolved import produces
 * (`readFileSync` from `node:fs`, with no `@types`), and it is the only kind of
 * base whose unresolved member is explained by the missing import rather than
 * by a possible repository augmentation. Failing to read a type answers false,
 * which keeps the candidate.
 */
function isAnyTyped(expression: ts.Expression, checker: ts.TypeChecker): boolean {
  try {
    const type = checker.getTypeAtLocation(expression);
    return (type.flags & ts.TypeFlags.Any) !== 0;
  } catch {
    return false;
  }
}

/** The symbol of the identifier an access chain (`a.b[c]!`) is rooted at, if it is rooted at one. */
function rootSymbolOf(expression: ts.Expression, checker: ts.TypeChecker): ts.Symbol | undefined {
  let root: ts.Expression = expression;
  while (
    ts.isPropertyAccessExpression(root) ||
    ts.isElementAccessExpression(root) ||
    ts.isNonNullExpression(root) ||
    ts.isParenthesizedExpression(root) ||
    ts.isAwaitExpression(root)
  ) {
    root = root.expression;
  }
  return ts.isIdentifier(root) ? symbolAt(root, checker) : undefined;
}


/**
 * Whether control-flow narrowing could change the type of the name an access
 * is rooted at, which would void an `external` proof drawn from its declared
 * type (`e: Error` is external, but `if (e instanceof RepoError) e.read()` is
 * not). Narrowing needs something that tests *that name*: an `instanceof` or
 * `in` test on it, or a guard-position call that is passed it and whose callee
 * is not proven external (a type guard or assertion function, however it was
 * reached). Looked for anywhere in the changed file, because a closure inherits
 * the narrowing of every scope around it. Tests on other names, and the many
 * ordinary helper calls a file makes, do not count.
 */
function narrowingMayApply(symbol: ts.Symbol, ctx: TraceContext): boolean {
  const cached = ctx.narrowingMemo.get(symbol);
  if (cached !== undefined) {
    return cached;
  }
  const isTheName = (expression: ts.Node): boolean => {
    let inner = expression;
    while (
      ts.isPropertyAccessExpression(inner) ||
      ts.isElementAccessExpression(inner) ||
      ts.isNonNullExpression(inner) ||
      ts.isParenthesizedExpression(inner)
    ) {
      inner = inner.expression;
    }
    return ts.isIdentifier(inner) && symbolAt(inner, ctx.checker) === symbol;
  };
  let found = false;
  const scan = (child: ts.Node): void => {
    if (found) {
      return;
    }
    if (
      (ts.isBinaryExpression(child) &&
        ((child.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && isTheName(child.left)) ||
          (child.operatorToken.kind === ts.SyntaxKind.InKeyword && isTheName(child.right)))) ||
      (ts.isCallExpression(child) &&
        child.arguments.some((arg) => isTheName(arg)) &&
        isPotentialGuardCall(child, ctx))
    ) {
      found = true;
      return;
    }
    ts.forEachChild(child, scan);
  };
  for (const declaration of symbol.declarations ?? []) {
    scan(declaration.getSourceFile());
    if (found) {
      break;
    }
  }
  ctx.narrowingMemo.set(symbol, found);
  return found;
}

/**
 * A call that may narrow its argument: its callee is not proven external, so
 * it may be a type guard or assertion function, however it was reached
 * (an import, a local helper, `const guard = isRepo`). The call can sit
 * anywhere, a condition included or not (`const ok = isRepo(e); if (ok) ...`);
 * what limits this to the accessed name is that the caller only asks about
 * calls passed that name. Calls to external or lib functions cannot be
 * repository guards.
 */
function isPotentialGuardCall(call: ts.CallExpression, ctx: TraceContext): boolean {
  ctx.remaining = TRACE_WORK_BUDGET;
  return classifyProvenance(call.expression, ctx, 0) !== "external";
}

/**
 * Shared state for provenance tracing. `remaining` is a work budget reset per
 * traced member access: the tracer runs synchronously inside identification,
 * which nothing can interrupt, and shared initializer chains
 * (`a1 = [a0, a0, ...]`, `a2 = [a1, a1, ...]`) expand exponentially without
 * one. An exhausted budget yields `unknown`, which keeps the candidate. The
 * memo maps make each shared node or symbol cost once per run.
 */
interface TraceContext {
  checker: ts.TypeChecker;
  remaining: number;
  /** Per-symbol result with every symbol its proof passed through, so a memo hit still reports them. */
  symbolMemo: Map<ts.Symbol, { provenance: Provenance; traced: ts.Symbol[] }>;
  /** Symbols the classification in progress has passed through (declarations it relied on). */
  traced: Set<ts.Symbol>;
  narrowingMemo: Map<ts.Symbol, boolean>;
}

/** Work units one member access may spend on tracing before its provenance is `unknown`. */
const TRACE_WORK_BUDGET = 400;

function spendTraceWork(ctx: TraceContext): boolean {
  if (ctx.remaining <= 0) {
    return false;
  }
  ctx.remaining -= 1;
  return true;
}

/** Bound on how far {@link classifyProvenance} follows initializers, annotations and callbacks. */
const MAX_TRACE_DEPTH = 16;

/**
 * Where a value's type comes from, judged syntactically (#153):
 * - `repository`: traceable to an import from a relative specifier;
 * - `external`: *proven* not to be repository code (a literal, a primitive
 *   annotation, a `node:*`/package import, a lib global, or anything derived
 *   only from those);
 * - `unknown`: anything the tracer does not model.
 *
 * Only `external` is ever skipped. Unknown provenance keeps the candidate:
 * silently removing a real repository symbol is the worse error, and it
 * would report `nothing_to_resolve` for a pass that had something to resolve.
 */
type Provenance = "repository" | "external" | "unknown";

function combineProvenance(parts: Provenance[]): Provenance {
  if (parts.includes("repository")) {
    return "repository";
  }
  return parts.length > 0 && parts.every((part) => part === "external") ? "external" : "unknown";
}

function classifyProvenance(expression: ts.Node, ctx: TraceContext, depth: number): Provenance {
  if (depth > MAX_TRACE_DEPTH || !spendTraceWork(ctx)) {
    return "unknown";
  }
  if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression) || ts.isAwaitExpression(expression)) {
    return classifyProvenance(expression.expression, ctx, depth);
  }
  if (ts.isSatisfiesExpression(expression)) {
    // `satisfies` only checks; the expression keeps the operand's own type.
    return classifyProvenance(expression.expression, ctx, depth);
  }
  if (ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)) {
    // The asserted type replaces the operand's type outright. When the tracer
    // does not model it (`as LocalRepo[]` with `interface LocalRepo extends
    // Repo`), the result is unknown, never the operand's provenance.
    return classifyTypeProvenance(expression.type, ctx, depth + 1);
  }
  if (
    ts.isStringLiteralLike(expression) ||
    ts.isNumericLiteral(expression) ||
    ts.isBigIntLiteral(expression) ||
    ts.isRegularExpressionLiteral(expression) ||
    ts.isTemplateExpression(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword
  ) {
    return "external";
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return combineProvenance(
      expression.elements.length === 0
        ? ["external"]
        : expression.elements.map((element) => classifyProvenance(element, ctx, depth + 1)),
    );
  }
  if (ts.isElementAccessExpression(expression)) {
    return classifyProvenance(expression.expression, ctx, depth + 1);
  }
  if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
    // A call result is not simply its callee's provenance: an external
    // function can return what it was given (`Promise.resolve(repo)`,
    // `Array.from(repos)`) or what a callback builds (`xs.map(() => new Repo())`).
    // It is external only when the callee and every argument are proven so.
    const callee = classifyProvenance(expression.expression, ctx, depth + 1);
    if (callee !== "external") {
      return callee;
    }
    return combineProvenance([
      callee,
      ...(expression.arguments ?? []).map((arg) =>
        ts.isSpreadElement(arg) ? "unknown" : classifyProvenance(arg, ctx, depth + 1),
      ),
      // `new Map<string, Repo>()`, `get<Repo>()`: explicit type arguments carry the type.
      ...(expression.typeArguments ?? []).map((arg) => classifyTypeProvenance(arg, ctx, depth + 1)),
    ]);
  }
  if (ts.isPropertyAccessExpression(expression)) {
    const base = classifyProvenance(expression.expression, ctx, depth + 1);
    if (base !== "unknown") {
      return base;
    }
    return classifySymbolProvenance(symbolAt(expression.name, ctx.checker), ctx, depth + 1);
  }
  if (ts.isIdentifier(expression)) {
    return classifySymbolProvenance(symbolAt(expression, ctx.checker), ctx, depth);
  }
  return "unknown";
}

function symbolAt(node: ts.Node, checker: ts.TypeChecker): ts.Symbol | undefined {
  try {
    return checker.getSymbolAtLocation(node);
  } catch {
    return undefined;
  }
}

function classifySymbolProvenance(
  symbol: ts.Symbol | undefined,
  ctx: TraceContext,
  depth: number,
): Provenance {
  if (!symbol || depth > MAX_TRACE_DEPTH || !spendTraceWork(ctx)) {
    return "unknown";
  }
  const memoized = ctx.symbolMemo.get(symbol);
  if (memoized) {
    memoized.traced.forEach((traced) => ctx.traced.add(traced));
    return memoized.provenance;
  }
  ctx.symbolMemo.set(symbol, { provenance: "unknown", traced: [symbol] }); // breaks a self-referential initializer cycle
  const outer = ctx.traced;
  ctx.traced = new Set([symbol]);
  const result = classifySymbolProvenanceUncached(symbol, ctx, depth);
  const mine = ctx.traced;
  ctx.traced = outer;
  mine.forEach((traced) => outer.add(traced));
  if (ctx.remaining > 0) {
    ctx.symbolMemo.set(symbol, { provenance: result, traced: [...mine] });
  } else {
    ctx.symbolMemo.delete(symbol);
  }
  return result;
}

function classifySymbolProvenanceUncached(symbol: ts.Symbol, ctx: TraceContext, depth: number): Provenance {
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    const specifier = aliasModuleSpecifier(symbol);
    if (specifier === undefined) {
      return "unknown";
    }
    return isNonRelativeSpecifier(specifier) ? "external" : "repository";
  }
  const declarations = symbol.declarations ?? [];
  if (declarations.length > 0 && declarations.every((decl) => isOwnLibPath(decl.getSourceFile().fileName))) {
    return "external"; // a lib global: `JSON`, `Math`, `Promise`, ...
  }
  return combineProvenance(declarations.map((decl) => classifyDeclarationProvenance(decl, ctx, depth + 1)));
}

function classifyDeclarationProvenance(decl: ts.Declaration, ctx: TraceContext, depth: number): Provenance {
  if (ts.isVariableDeclaration(decl) || ts.isParameter(decl) || ts.isPropertyDeclaration(decl) || ts.isPropertySignature(decl)) {
    if (!ts.isIdentifier(decl.name)) {
      return "unknown"; // a destructuring pattern
    }
    // A JSDoc `@type` / `@param` (JavaScript files) types the declaration
    // independently of its initializer, and the tracer does not read it.
    if (ts.getJSDocType(decl) || (ts.isParameter(decl) && ts.getJSDocParameterTags(decl).length > 0)) {
      return "unknown";
    }
    if (decl.type) {
      return classifyTypeProvenance(decl.type, ctx, depth + 1);
    }
    if (ts.isParameter(decl)) {
      // Never the default value: an unannotated parameter is usually typed by
      // its context (`visit((repo = null) => ...)`), and the default says
      // nothing about that type.
      return classifyCallbackParameter(decl, ctx, depth + 1);
    }
    // Only a `const` initializer is evidence of what the name holds: a `let`,
    // `var` or field can be reassigned to anything (`let r = null; r = new Repo()`).
    if (
      ts.isVariableDeclaration(decl) &&
      decl.initializer &&
      ts.isVariableDeclarationList(decl.parent) &&
      (decl.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      return classifyProvenance(decl.initializer, ctx, depth + 1);
    }
  }
  return "unknown";
}

/**
 * An unannotated first parameter of a callback passed to `receiver.method(cb)`
 * takes its provenance from the receiver (`xs.map((x) => ...)`, `xs.find(...)`).
 * Only the array methods whose callback receives the receiver's elements
 * qualify: `Array.from(xs, cb)` takes its elements from the argument, and
 * `reduce`'s first parameter is the accumulator, so those stay unknown.
 */
const ELEMENT_CALLBACK_METHODS: ReadonlySet<string> = new Set([
  "map",
  "flatMap",
  "filter",
  "find",
  "findLast",
  "findIndex",
  "findLastIndex",
  "some",
  "every",
  "forEach",
]);

function classifyCallbackParameter(param: ts.ParameterDeclaration, ctx: TraceContext, depth: number): Provenance {
  const fn = param.parent;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) {
    return "unknown";
  }
  if (fn.parameters[0] !== param) {
    return "unknown";
  }
  const call = fn.parent;
  if (
    !ts.isCallExpression(call) ||
    !call.arguments.includes(fn) ||
    !ts.isPropertyAccessExpression(call.expression) ||
    !ELEMENT_CALLBACK_METHODS.has(call.expression.name.text)
  ) {
    return "unknown";
  }
  return classifyProvenance(call.expression.expression, ctx, depth + 1);
}

function classifyTypeProvenance(type: ts.TypeNode, ctx: TraceContext, depth: number): Provenance {
  if (depth > MAX_TRACE_DEPTH || !spendTraceWork(ctx)) {
    return "unknown";
  }
  switch (type.kind) {
    case ts.SyntaxKind.StringKeyword:
    case ts.SyntaxKind.NumberKeyword:
    case ts.SyntaxKind.BooleanKeyword:
    case ts.SyntaxKind.BigIntKeyword:
    case ts.SyntaxKind.SymbolKeyword:
    case ts.SyntaxKind.LiteralType:
      return "external";
    default:
      break;
  }
  if (ts.isArrayTypeNode(type)) {
    return classifyTypeProvenance(type.elementType, ctx, depth + 1);
  }
  if (ts.isParenthesizedTypeNode(type)) {
    return classifyTypeProvenance(type.type, ctx, depth);
  }
  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
    return combineProvenance(type.types.map((member) => classifyTypeProvenance(member, ctx, depth + 1)));
  }
  if (ts.isTypeReferenceNode(type)) {
    let name: ts.EntityName = type.typeName;
    while (ts.isQualifiedName(name)) {
      name = name.left;
    }
    const symbol = symbolAt(name, ctx.checker);
    const declarations = symbol?.declarations ?? [];
    let head: Provenance;
    if (symbol && declarations.length > 0 && declarations.every(ts.isTypeAliasDeclaration)) {
      // A local alias is only as external as what it aliases.
      head = combineProvenance(declarations.map((decl) => classifyTypeProvenance(decl.type, ctx, depth + 1)));
    } else {
      head = classifySymbolProvenance(symbol, ctx, depth + 1);
    }
    // `Array<Repo>`, `Promise<Repo>`: the arguments can carry a repository type.
    const args = (type.typeArguments ?? []).map((arg) => classifyTypeProvenance(arg, ctx, depth + 1));
    return head === "repository" || args.includes("repository")
      ? "repository"
      : head === "external" && args.every((arg) => arg === "external")
        ? "external"
        : "unknown";
  }
  return "unknown";
}

function isNameNodeOf(decl: ts.Declaration, node: ts.Node): boolean {
  return (decl as ts.NamedDeclaration).name === node;
}

/** Assigns each distinct `ts.Symbol` a stable string id, for building a deferred dedup key (see `considerIdentifier`). */
function symbolIdFor(symbol: ts.Symbol, symbolIds: Map<ts.Symbol, number>): number {
  const existing = symbolIds.get(symbol);
  if (existing !== undefined) {
    return existing;
  }
  const id = symbolIds.size;
  symbolIds.set(symbol, id);
  return id;
}

function deferredDedupKey(
  baseExpr: ts.Expression,
  memberName: string,
  checker: ts.TypeChecker,
  symbolIds: Map<ts.Symbol, number>,
): string {
  if (ts.isIdentifier(baseExpr)) {
    let baseSymbol: ts.Symbol | undefined;
    try {
      baseSymbol = checker.getSymbolAtLocation(baseExpr);
    } catch {
      baseSymbol = undefined;
    }
    if (baseSymbol) {
      return `sym:${symbolIdFor(baseSymbol, symbolIds)}#${memberName}`;
    }
  }
  return `text:${baseExpr.getText()}#${memberName}`;
}

/** The `${importingFile}::${specifierText}` key for an alias symbol's *own* import declaration, when it has one. */
function firstHopSpecifierKey(symbol: ts.Symbol, importingFilePath: string): string | undefined {
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) {
    return undefined;
  }
  let node: ts.Node | undefined = symbol.declarations?.[0];
  while (node && !ts.isImportDeclaration(node)) {
    node = node.parent;
  }
  if (!node || !ts.isStringLiteralLike(node.moduleSpecifier)) {
    return undefined;
  }
  return `${importingFilePath}::${node.moduleSpecifier.text}`;
}

export interface BuildSourceFileSetResult {
  fileSet: Map<string, string>;
  contentRequestCount: number;
  timedOut: boolean;
  timeUsedMs: number;
  resolvedSpecifierKeys: Set<string>;
  refusedSpecifierKeys: Set<string>;
  attemptedSpecifierKeys: Set<string>;
}

/**
 * Step (b): fetches the module-specifier closure of the changed files under
 * the **resolution (context) time budget**, in the deterministic read
 * (discovery) order the module-resolution contract defines. The changed
 * files themselves are the seed and are never re-read.
 */
export async function buildSourceFileSet(
  changedSourceTexts: Map<string, string>,
  readFile: RepositoryContextReadFile,
  timeBudgetMs: number,
  now: () => number = Date.now,
): Promise<BuildSourceFileSetResult> {
  const startedAt = now();
  const fileSet = new Map(changedSourceTexts);
  const queue = [...changedSourceTexts.keys()].sort((a, b) => a.localeCompare(b));
  const queued = new Set(queue);
  let contentRequestCount = 0;
  let timedOut = false;
  const resolvedSpecifierKeys = new Set<string>();
  const refusedSpecifierKeys = new Set<string>();
  const attemptedSpecifierKeys = new Set<string>();

  const budgetExhausted = (): boolean => now() - startedAt >= timeBudgetMs;

  outer: while (queue.length > 0) {
    if (budgetExhausted()) {
      timedOut = true;
      break;
    }
    const currentFile = queue.shift();
    if (currentFile === undefined) {
      break;
    }
    const text = fileSet.get(currentFile);
    if (text === undefined) {
      continue;
    }

    let info: ts.PreProcessedFileInfo;
    try {
      info = ts.preProcessFile(text, true, true);
    } catch {
      continue; // an unparseable closure file contributes no further specifiers, never throws out of the phase.
    }

    for (const imported of info.importedFiles) {
      if (budgetExhausted()) {
        timedOut = true;
        break outer;
      }
      const specifierText = imported.fileName;
      const key = `${currentFile}::${specifierText}`;
      attemptedSpecifierKeys.add(key);

      const candidates = candidatePathsFor(currentFile, specifierText);
      if (!candidates) {
        continue; // bare or absolute specifier — never probed (AC9, module-resolution contract).
      }

      let resolvedPath: string | undefined;
      let refused = false;
      for (const candidate of candidates) {
        if (fileSet.has(candidate)) {
          resolvedPath = candidate;
          break;
        }
        if (budgetExhausted()) {
          timedOut = true;
          break;
        }
        contentRequestCount += 1;
        try {
          const content = await readFile(candidate, { failOnUnusable: true });
          if (content !== undefined) {
            fileSet.set(candidate, content);
            resolvedPath = candidate;
            break;
          }
        } catch (error) {
          if (error instanceof RepositoryContextUnusableContentError) {
            refused = true;
            break;
          }
          // A transient read failure while probing one candidate path is an
          // ordinary miss for that path — try the next one rather than
          // aborting the whole phase (AC11).
        }
      }

      if (resolvedPath) {
        resolvedSpecifierKeys.add(key);
        if (!queued.has(resolvedPath)) {
          queue.push(resolvedPath);
          queued.add(resolvedPath);
        }
      } else if (refused) {
        refusedSpecifierKeys.add(key);
      }
      if (timedOut) {
        break outer;
      }
    }
  }

  return {
    fileSet,
    contentRequestCount,
    timedOut,
    timeUsedMs: now() - startedAt,
    resolvedSpecifierKeys,
    refusedSpecifierKeys,
    attemptedSpecifierKeys,
  };
}

/**
 * The specifier-resolution order (module-resolution contract): the literal
 * path; the `.js`-family extension substitution; the extensionless forms;
 * then `<specifier>/index.<ext>` in the same extension order. A bare
 * specifier (no `./` or `/` prefix) is never probed (AC9, D4's `paths` /
 * `baseUrl` limitation).
 */
export function candidatePathsFor(fromFile: string, specifier: string): string[] | undefined {
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return undefined;
  }
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  const candidates: string[] = [base];

  const substitution = EXTENSION_SUBSTITUTIONS.find(([from]) => base.endsWith(from));
  if (substitution) {
    candidates.push(base.slice(0, -substitution[0].length) + substitution[1]);
  }
  for (const ext of EXTENSIONLESS_FORMS) {
    candidates.push(`${base}${ext}`);
  }
  for (const ext of EXTENSIONLESS_FORMS) {
    candidates.push(`${base}/index${ext}`);
  }
  return candidates;
}

/** Exported for testing only — the backstop check `resolveSymbols` applies before ever building a `ts.Program`. */
export function isResolutionFileSetOversized(fileSet: Map<string, string>): boolean {
  if (fileSet.size > MAX_RESOLUTION_FILE_COUNT) {
    return true;
  }
  let totalChars = 0;
  for (const text of fileSet.values()) {
    totalChars += text.length;
    if (totalChars > MAX_RESOLUTION_TOTAL_CHARS) {
      return true;
    }
  }
  return false;
}

export interface ResolveSymbolsBookkeeping {
  resolvedSpecifierKeys: Set<string>;
  refusedSpecifierKeys: Set<string>;
  attemptedSpecifierKeys: Set<string>;
}

/**
 * Step (c): builds one `ts.Program` over the full file set (changed files
 * plus their import closure) and binds each requested reference to the
 * declaration the checker resolves it to, following the alias chain through
 * a re-export (E3). Zero or more than one bound declaration is dropped
 * `ambiguous_resolution` (E5), never guessed.
 */
export function resolveSymbols(
  fileSet: Map<string, string>,
  requested: InternalRequestedReference[],
  bookkeeping: ResolveSymbolsBookkeeping,
): RepositoryContextResolution[] {
  if (isResolutionFileSetOversized(fileSet)) {
    return requested.map((ref) => ({ id: ref.id, reason: "time_budget" as const }));
  }

  const host = createVirtualCompilerHost(fileSet);
  const program = ts.createProgram({ rootNames: [...fileSet.keys()], options: COMPILER_OPTIONS, host });
  const checker = program.getTypeChecker();
  const results: RepositoryContextResolution[] = [];

  for (const ref of requested) {
    const sourceFile = program.getSourceFile(ref.changedPath);
    const node = sourceFile && findIdentifierAtPosition(sourceFile, ref.anchorPos);
    if (!sourceFile || !node) {
      results.push({ id: ref.id, reason: classifyUnresolved(ref, bookkeeping) });
      continue;
    }

    let symbol: ts.Symbol | undefined;
    try {
      symbol = checker.getSymbolAtLocation(node);
    } catch {
      symbol = undefined;
    }
    symbol = followAliasChain(checker, symbol);

    const declarations = (symbol?.declarations ?? []).filter((decl) =>
      fileSet.has(decl.getSourceFile().fileName),
    );
    if (declarations.length !== 1) {
      results.push({ id: ref.id, reason: classifyUnresolved(ref, bookkeeping) });
      continue;
    }

    const excerptNode = excerptNodeFor(declarations[0]);
    const declSourceFile = excerptNode.getSourceFile();
    const startLine =
      declSourceFile.getLineAndCharacterOfPosition(excerptNode.getStart(declSourceFile)).line + 1;
    const endLine = declSourceFile.getLineAndCharacterOfPosition(excerptNode.getEnd()).line + 1;
    results.push({
      id: ref.id,
      path: declSourceFile.fileName,
      line: startLine,
      endLine,
      text: excerptNode.getText(declSourceFile),
    });
  }

  return results;
}

function classifyUnresolved(
  ref: InternalRequestedReference,
  bookkeeping: ResolveSymbolsBookkeeping,
): Exclude<RepositoryContextDropReason, "candidate_count_budget" | "character_budget"> {
  if (ref.specifierKey) {
    if (bookkeeping.refusedSpecifierKeys.has(ref.specifierKey)) {
      return "read_failed";
    }
    const wasAttempted =
      bookkeeping.attemptedSpecifierKeys.has(ref.specifierKey) ||
      bookkeeping.resolvedSpecifierKeys.has(ref.specifierKey);
    if (!wasAttempted) {
      // The reference's own (first-hop) specifier was never even reached
      // before the context time budget stopped the closure walk (D5, E4).
      // A deeper re-export hop cut short by the same budget is a documented
      // simplification and is classified ambiguous_resolution instead — see
      // this module's InternalRequestedReference doc comment.
      return "time_budget";
    }
  }
  return "ambiguous_resolution";
}

function followAliasChain(checker: ts.TypeChecker, symbol: ts.Symbol | undefined): ts.Symbol | undefined {
  let current = symbol;
  for (let hop = 0; current && (current.flags & ts.SymbolFlags.Alias) !== 0 && hop < 10; hop += 1) {
    let next: ts.Symbol | undefined;
    try {
      next = checker.getAliasedSymbol(current);
    } catch {
      break;
    }
    if (!next || next === current) {
      break;
    }
    current = next;
  }
  return current;
}

function excerptNodeFor(decl: ts.Declaration): ts.Node {
  if (
    ts.isVariableDeclaration(decl) &&
    ts.isVariableDeclarationList(decl.parent) &&
    ts.isVariableStatement(decl.parent.parent)
  ) {
    return decl.parent.parent;
  }
  return decl;
}

function findIdentifierAtPosition(sourceFile: ts.SourceFile, pos: number): ts.Identifier | undefined {
  const find = (node: ts.Node): ts.Identifier | undefined => {
    if (node.getStart(sourceFile) === pos && ts.isIdentifier(node)) {
      return node;
    }
    if (node.getStart(sourceFile) > pos || node.getEnd() < pos) {
      return undefined;
    }
    return ts.forEachChild(node, find);
  };
  return find(sourceFile);
}

/**
 * The real directory `ts.getDefaultLibFilePath` resolves into (Ronda's own
 * pinned `typescript` install, under `node_modules/typescript/lib`).
 * Computed once at module load — the compiler options that determine it are
 * themselves a fixed module-level constant.
 */
export const TS_LIB_DIR = path.dirname(ts.getDefaultLibFilePath(COMPILER_OPTIONS));

/**
 * `true` only for a path inside {@link TS_LIB_DIR} — never for merely "any
 * absolute path". A reviewed-repository path is always repo-relative with no
 * leading `/`, but TypeScript's own module resolution can still construct an
 * absolute-looking candidate from a reviewed file's own (untrusted) import
 * specifier. Accepting every absolute path here would let such a specifier
 * reach the real filesystem through `ts.sys` — this narrower check is what
 * keeps the fallback scoped to Ronda's own lib files (D2) and never to
 * reviewed-head content (AC9).
 */
/** Exported for testing only. */
export function isOwnLibPath(fileName: string): boolean {
  const relative = path.relative(TS_LIB_DIR, fileName);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function createVirtualCompilerHost(files: ReadonlyMap<string, string>): ts.CompilerHost {
  const read = (fileName: string): string | undefined => {
    const content = files.get(fileName);
    if (content !== undefined) {
      return content;
    }
    return isOwnLibPath(fileName) && ts.sys.fileExists(fileName) ? ts.sys.readFile(fileName) : undefined;
  };

  return {
    getSourceFile(fileName, languageVersion) {
      const text = read(fileName);
      if (text === undefined) {
        return undefined;
      }
      return ts.createSourceFile(fileName, text, languageVersion, true);
    },
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    writeFile: () => undefined,
    getCurrentDirectory: () => "",
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (fileName) => files.has(fileName) || (isOwnLibPath(fileName) && ts.sys.fileExists(fileName)),
    readFile: (fileName) => read(fileName),
  };
}
