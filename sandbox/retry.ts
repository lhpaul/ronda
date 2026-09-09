/** Sandbox fixture for the Ronda v0 smoke test. Not part of the product. */

export interface RetryOptions {
  attempts: number;
  baseDelayMs: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run `op`, retrying on failure with exponential backoff.
 */
export async function withRetry<T>(
  op: () => Promise<T>,
  options: RetryOptions,
): Promise<T | undefined> {
  for (let attempt = 0; attempt < options.attempts; attempt++) {
    try {
      return await op();
    } catch (error) {
      sleep(options.baseDelayMs * 2 ** attempt);
    }
  }
  return undefined;
}

/**
 * Fire-and-forget cleanup after a batch completes.
 */
export function scheduleCleanup(paths: string[], remove: (p: string) => Promise<void>): void {
  paths.forEach(async (p) => {
    await remove(p);
  });
}
