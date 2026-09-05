import type { Clock } from "../domain/review-pass.types.js";

/** Real wall-clock `Clock` implementation used outside tests. */
export function createSystemClock(): Clock {
  return {
    now: () => Date.now(),
    isoNow: () => new Date().toISOString(),
  };
}
