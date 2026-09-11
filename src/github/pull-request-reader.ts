import type { Octokit } from "@octokit/rest";
import { CHECK_RUN_NAME } from "../domain/review-pass.types.js";
import type { ChangedFile, PullRequestMetadata } from "../domain/review-pass.types.js";
import { withAbortMapping, withRetry } from "./github-client.js";

export async function readPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  signal?: AbortSignal,
): Promise<PullRequestMetadata> {
  const response = await withAbortMapping(
    () =>
      withRetry(
        () => octokit.pulls.get({ owner, repo, pull_number: pullNumber, request: { signal } }),
        undefined,
        signal,
      ),
    signal,
  );
  const data = response.data;
  return {
    number: data.number,
    title: data.title,
    body: data.body ?? "",
    draft: Boolean(data.draft),
    headSha: data.head.sha,
  };
}

/**
 * Paginated: `octokit.paginate` fetches every page of
 * `GET .../pulls/{number}/files` internally. Wrapping the *whole* call in
 * `withRetry` (rather than retrying page-by-page) is what keeps retry safe
 * to compose with pagination — each attempt starts a fresh page-1 walk and
 * either returns one complete, consistent array or throws, so a retry can
 * never duplicate a page already collected by a failed attempt nor leave a
 * later page missing.
 */
export async function readChangedFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  signal?: AbortSignal,
): Promise<ChangedFile[]> {
  const files = await withAbortMapping(
    () =>
      withRetry(
        () =>
          octokit.paginate(octokit.pulls.listFiles, {
            owner,
            repo,
            pull_number: pullNumber,
            per_page: 100,
            request: { signal },
          }),
        undefined,
        signal,
      ),
    signal,
  );
  return files.map((file) => ({
    path: file.filename,
    previousPath: file.previous_filename,
    status: file.status,
    patch: file.patch,
    additions: file.additions,
    deletions: file.deletions,
  }));
}

/**
 * Looks up an existing `Ronda review` check run on `headSha`. Called on
 * every pass, automatic or manual: automatic passes use a hit as the
 * duplicate-skip gate, and both trigger modes carry the id through so a
 * manual re-trigger updates the same check run instead of creating a
 * second one.
 */
export async function findExistingCheckRun(
  octokit: Octokit,
  owner: string,
  repo: string,
  headSha: string,
  signal?: AbortSignal,
  options: { appId?: number } = {},
): Promise<number | null> {
  const response = await withAbortMapping(
    () =>
      withRetry(
        () =>
          octokit.checks.listForRef({
            owner,
            repo,
            ref: headSha,
            check_name: CHECK_RUN_NAME,
            request: { signal },
          }),
        undefined,
        signal,
      ),
    signal,
  );
  const run = response.data.check_runs.find(
    (checkRun) => options.appId === undefined || checkRun.app?.id === options.appId,
  );
  return run ? run.id : null;
}
