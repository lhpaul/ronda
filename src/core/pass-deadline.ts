export interface PassDeadline {
  /** Aborted when the budget is exceeded before `markPublishing` was called. */
  signal: AbortSignal;
  /** True once the timer has fired and aborted the signal. */
  expired(): boolean;
  /**
   * Call immediately before publication starts. Neutralises a deadline that
   * fires afterward so a late timer can never produce a second,
   * contradictory outcome once the review is already being posted.
   */
  markPublishing(): void;
  /** Clears the timer. Always call from a `finally` block. */
  dispose(): void;
}

export interface DeadlineTimerHandle {
  unref?: () => void;
}

export interface DeadlineClock {
  setTimeout: (callback: () => void, ms: number) => DeadlineTimerHandle;
  clearTimeout: (handle: DeadlineTimerHandle) => void;
}

const realClock: DeadlineClock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms) as unknown as DeadlineTimerHandle,
  clearTimeout: (handle) => clearTimeout(handle as unknown as NodeJS.Timeout),
};

/**
 * Arms a timer for `budgetMs`. On expiry it aborts the shared
 * `AbortController`, unless `markPublishing` was already called. The timer
 * is `unref`-ed so it can never hold the process open.
 */
export function createPassDeadline(
  budgetMs: number,
  clock: DeadlineClock = realClock,
): PassDeadline {
  const controller = new AbortController();
  let expiredFlag = false;
  let publishing = false;

  const timer = clock.setTimeout(() => {
    if (publishing) {
      return;
    }
    expiredFlag = true;
    controller.abort();
  }, budgetMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    expired: () => expiredFlag,
    markPublishing: () => {
      publishing = true;
    },
    dispose: () => {
      clock.clearTimeout(timer);
    },
  };
}
