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
      changedSourceTexts.set(filePath, text);
    }
    // text === undefined: absent (404) or a refused non-file type — both are
    // "accounted for" at this position (module-resolution contract, position
    // (b)): no source, no reference, no candidate, no drop.
  }

  if (changedSourceTexts.size === 0) {
    return { requested: [], unreadableChangedFilePaths, changedSourceTexts, contentRequestCount };
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
          requested,
          () => nextId++,
        );
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { requested, unreadableChangedFilePaths, changedSourceTexts, contentRequestCount };
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
 * `true` only for the absolute filesystem paths `ts.getDefaultLibFilePath`
 * returns (Ronda's own pinned `typescript` install, under `node_modules/`) —
 * never for a reviewed-repository path, which is always a repo-relative
 * POSIX path with no leading `/`. This is what lets the host fall back to
 * the real filesystem for `lib.*.d.ts` alone (D2) without ever risking a
 * read of an unrelated local file that happens to share a reviewed-repo's
 * relative path (AC9).
 */
function isOwnLibPath(fileName: string): boolean {
  return fileName.startsWith("/") || /^[A-Za-z]:[\\/]/.test(fileName);
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
