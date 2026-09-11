import { Octokit } from "@octokit/rest";

export interface GithubClientConfig {
  token: string;
  /** Honours `GITHUB_API_URL` for GitHub Enterprise; undefined uses the public API. */
  apiUrl?: string;
}

export interface GithubClient {
  octokit: Octokit;
}

export type GithubClientFailureReason = "timed_out";

/**
 * Thrown by a `GithubOperations` implementation when a call is aborted via
 * the caller's `AbortSignal`. Mirrors `ModelClientError`
 * (`src/inference/model-client.ts`) so `runReviewPass` can classify a
 * GitHub-phase abort by error type — exactly the way it already classifies a
 * model-call abort — instead of every call site independently inspecting
 * pass-deadline state.
 */
export class GithubClientError extends Error {
  readonly reason: GithubClientFailureReason;

  constructor(
    reason: GithubClientFailureReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "GithubClientError";
    this.reason = reason;
  }
}

/**
 * Runs `operation` and re-throws any error it raises while `signal` is
 * already aborted as a typed `GithubClientError`. This is the single choke
 * point every `src/github/` read/write function routes through, so an
 * `AbortError` from Octokit's underlying `fetch` transport is classified
 * once, here, rather than re-derived from `deadline.expired()` at each of
 * `runReviewPass`'s call sites.
 */
export async function withAbortMapping<T>(
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (signal?.aborted) {
      throw new GithubClientError(
        "timed_out",
        "GitHub request was aborted before it completed",
        { cause: error },
      );
    }
    throw error;
  }
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
  if (status === 429) {
    return true;
  }
  const message = (error as { message?: string } | undefined)?.message ?? "";
  return status === 403 && /secondary rate limit/i.test(message);
}

/**
 * Retries `operation` at most twice, with fixed 2s then 5s backoff, only on
 * HTTP 5xx, HTTP 429, or a secondary-rate-limit response. Any other error
 * propagates immediately.
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
