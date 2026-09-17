import type { Octokit } from "@octokit/rest";
import { withAbortMapping, withRetry } from "./github-client.js";

function isNotFoundError(error: unknown): boolean {
  const status = (error as { status?: number } | undefined)?.status;
  return status === 404;
}

function decodeFileContent(content: string): string {
  return Buffer.from(content, "base64").toString("utf8");
}

/**
 * Reads a single repository file at `ref` via the GitHub contents API.
 * Returns `undefined` when the file is missing, not a file, truncated, or
 * otherwise unusable — the review pass continues without that doc.
 */
export async function readRepositoryFileAtRef(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
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
      return undefined;
    }
    if (data.type !== "file") {
      return undefined;
    }
    if ("truncated" in data && data.truncated === true) {
      return undefined;
    }
    if (typeof data.content !== "string" || data.content.length === 0) {
      return undefined;
    }
    return decodeFileContent(data.content.replace(/\n/g, ""));
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }
    throw error;
  }
}
