import { Octokit } from "@octokit/rest";

export interface GithubClientConfig {
  token: string;
  /** Honours `GITHUB_API_URL` for GitHub Enterprise; undefined uses the public API. */
  apiUrl?: string;
}

export interface GithubClient {
  octokit: Octokit;
}

export function createGithubClient(config: GithubClientConfig): GithubClient {
  return {
    octokit: new Octokit({
      auth: config.token,
      baseUrl: config.apiUrl,
    }),
  };
}

/** Fixed 2s then 5s backoff — at most two retries, per the plan's bounded-retry policy. */
const RETRY_DELAYS_MS = [2_000, 5_000];

export function isRetryableError(error: unknown): boolean {
  const status = (error as { status?: number } | undefined)?.status;
  if (typeof status !== "number") {
    return false;
  }
  if (status >= 500) {
    return true;
  }
  const message = (error as { message?: string } | undefined)?.message ?? "";
  return status === 403 && /secondary rate limit/i.test(message);
}

/**
 * Retries `operation` at most twice, with fixed 2s then 5s backoff, only on
 * HTTP 5xx or a secondary-rate-limit response. Any other error propagates
 * immediately.
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryableError(error)) {
        throw error;
      }
      await sleep(RETRY_DELAYS_MS[attempt]);
      attempt += 1;
    }
  }
}
