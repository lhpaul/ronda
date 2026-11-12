import {
  decideCompileOutcome,
  isFindCandidatesResult,
  isResolutionList,
  type CompileOutcome,
  type CompileStopBound,
  type RepositoryContextCompilerFactory,
  type RepositoryContextCompilerSession,
} from "../../src/review/repository-context-compiler.js";
import { findCandidatesInSources, resolveSymbols } from "../../src/review/symbol-resolver.js";

/**
 * An in-process fake compiler session for pass-level tests that need exact
 * event ordering (#131). Every outcome is settled through the real
 * `decideCompileOutcome` and the real result validators, so the precedence a
 * test observes is the production precedence.
 *
 * - `inline`: answers with the real compile, at once.
 * - `wait_for_stop`: never answers on its own; settles when a stop aborts.
 * - `after`: ignores the stops for `ms` of real time, then dispatches `then`
 *   (a valid result, a malformed result, a crash, or a start failure) —
 *   whichever stops have expired by then win, as they would for a real
 *   worker event arriving late.
 */
export type ScriptedCompileEvent = "valid" | "malformed" | "crash" | "could_not_start";

export type ScriptedCompileStep =
  | { kind: "inline" }
  | { kind: "wait_for_stop" }
  | { kind: "after"; ms: number; then: ScriptedCompileEvent };

export interface ScriptedCompilerSessions {
  factory: RepositoryContextCompilerFactory;
  /** Sessions created by the factory, in order. */
  created: number;
  /** `close()` calls across every session. */
  closed: number;
  /** Requests still unsettled across every session. */
  inFlight: number;
}

export function createScriptedCompilerSessions(script: {
  find?: ScriptedCompileStep;
  resolve?: ScriptedCompileStep;
}): ScriptedCompilerSessions {
  const state: ScriptedCompilerSessions = {
    created: 0,
    closed: 0,
    inFlight: 0,
    factory: () => {
      state.created += 1;
      return session;
    },
  };

  function run<T>(
    step: ScriptedCompileStep,
    stops: readonly CompileStopBound[],
    compute: () => T,
    isValid: (value: unknown) => value is T,
  ): Promise<CompileOutcome<T>> {
    const dispatch = (event: ScriptedCompileEvent): CompileOutcome<T> => {
      switch (event) {
        case "valid":
          return decideCompileOutcome(stops, { kind: "message", value: compute(), isValid });
        case "malformed":
          return decideCompileOutcome(stops, { kind: "message", value: { malformed: true }, isValid });
        case "crash":
          return decideCompileOutcome<T>(stops, { kind: "failure", failure: "stopped_unexpectedly" });
        case "could_not_start":
          return decideCompileOutcome<T>(stops, { kind: "failure", failure: "could_not_start" });
      }
    };
    state.inFlight += 1;
    return new Promise<CompileOutcome<T>>((resolve) => {
      const settle = (outcome: CompileOutcome<T>): void => {
        state.inFlight -= 1;
        resolve(outcome);
      };
      if (step.kind === "inline") {
        settle(dispatch("valid"));
        return;
      }
      if (step.kind === "after") {
        setTimeout(() => settle(dispatch(step.then)), step.ms);
        return;
      }
      if (stops.some((stop) => stop.signal.aborted)) {
        settle(decideCompileOutcome<T>(stops, { kind: "stop" }));
        return;
      }
      const onAbort = (): void => {
        for (const stop of stops) {
          stop.signal.removeEventListener("abort", onAbort);
        }
        settle(decideCompileOutcome<T>(stops, { kind: "stop" }));
      };
      for (const stop of stops) {
        stop.signal.addEventListener("abort", onAbort);
      }
    });
  }

  const session: RepositoryContextCompilerSession = {
    findCandidates: (input, stops) =>
      run(
        script.find ?? { kind: "inline" },
        stops,
        () => findCandidatesInSources(input.changedSourceTexts, input.changedLinesByFile),
        (value): value is ReturnType<typeof findCandidatesInSources> => isFindCandidatesResult(value, input),
      ),
    resolveCandidates: (input, stops) =>
      run(
        script.resolve ?? { kind: "inline" },
        stops,
        () => resolveSymbols(input.fileSet, input.requested, input.bookkeeping),
        (value): value is ReturnType<typeof resolveSymbols> => isResolutionList(value, input),
      ),
    close: () => {
      state.closed += 1;
    },
  };

  return state;
}
