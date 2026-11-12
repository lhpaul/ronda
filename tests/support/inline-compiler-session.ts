import {
  decideCompileOutcome,
  type RepositoryContextCompilerFactory,
} from "../../src/review/repository-context-compiler.js";
import { findCandidatesInSources, resolveSymbols } from "../../src/review/symbol-resolver.js";

/**
 * A test-only compiler session that runs the two compile halves in-line
 * (#131). Used only by older pass-level tests whose configured budget is
 * smaller than the time a real worker needs to start and compile, and whose
 * subject is not isolation (plan, Factual claim evidence, Rule 6). Production
 * review passes never compile in-line. A stop already aborted when a result
 * is ready still wins (D5), as with the real session.
 */
export const createInlineCompilerSession: RepositoryContextCompilerFactory = () => ({
  async findCandidates(input, stops) {
    const value = findCandidatesInSources(input.changedSourceTexts, input.changedLinesByFile);
    return decideCompileOutcome(stops, { kind: "message", value, isValid: (v): v is typeof value => v === value });
  },
  async resolveCandidates(input, stops) {
    const value = resolveSymbols(input.fileSet, input.requested, input.bookkeeping);
    return decideCompileOutcome(stops, { kind: "message", value, isValid: (v): v is typeof value => v === value });
  },
  close() {},
});
