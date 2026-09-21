import type { Octokit } from "@octokit/rest";
import { withAbortMapping, withRetry } from "./github-client.js";

function isNotFoundError(error: unknown): boolean {
  const status = (error as { status?: number } | undefined)?.status;
  return status === 404;
}

function decodeFileContent(content: string): string {
  return Buffer.from(content, "base64").toString("utf8");
}

export class RepositoryFileUnusableError extends Error {
  constructor(
    readonly path: string,
    readonly reason: string,
  ) {
    super(`Repository file unusable at ${path}: ${reason}`);
    this.name = "RepositoryFileUnusableError";
  }
}

export interface ReadRepositoryFileAtRefOptions {
  /**
   * When true, truncated/empty/non-file content throws
   * {@link RepositoryFileUnusableError} instead of returning `undefined`.
   * Missing files (HTTP 404) still return `undefined`.
   */
  failOnUnusable?: boolean;
}

/**
 * Reads a single repository file at `ref` via the GitHub contents API.
 * Returns `undefined` when the file is missing. By default, truncated or
 * otherwise unusable content also returns `undefined` so ordinary doc
 * selection can skip it; pass `failOnUnusable` when callers must distinguish
 * missing from unusable (durability mode supply).
 */
export async function readRepositoryFileAtRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  signal?: AbortSignal,
  options?: ReadRepositoryFileAtRefOptions,
): Promise<string | undefined> {
  const failOnUnusable = options?.failOnUnusable === true;
  const unusable = (reason: string): undefined => {
    if (failOnUnusable) {
      throw new RepositoryFileUnusableError(path, reason);
    }
    return undefined;
  };

  try {
    const response = await withAbortMapping(
      () =>
        withRetry(
          () =>
            octokit.repos.getContent({
              owner,
              repo,
              path,
              ref,
              request: { signal },
            }),
          undefined,
          signal,
        ),
      signal,
    );

    const data = response.data;
    if (Array.isArray(data)) {
      return unusable("directory");
    }
    if (data.type !== "file") {
      return unusable(`type:${data.type}`);
    }
    if ("truncated" in data && data.truncated === true) {
      return unusable("truncated");
    }
    if (typeof data.content !== "string" || data.content.length === 0) {
      return unusable("empty");
    }
    return decodeFileContent(data.content.replace(/\n/g, ""));
  } catch (error) {
    if (error instanceof RepositoryFileUnusableError) {
      throw error;
    }
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}
