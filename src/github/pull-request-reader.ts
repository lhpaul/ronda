import type { Octokit } from "@octokit/rest";
import { RONDA_REVIEW_HEADING } from "../core/summary.js";
import { CHECK_RUN_NAME } from "../domain/review-pass.types.js";
import type { ChangedFile, PullRequestMetadata } from "../domain/review-pass.types.js";
import { withAbortMapping, withRetry } from "./github-client.js";

export interface ExistingRondaPullRequestReview {
  headSha: string;
}

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
    headBranch: data.head.ref ?? "",
    // #106, D6: an absent head repository (a deleted fork) reads as "" —
    // fork-originated by the fail-closed same-repository test, never
    // same-repository.
    headRepoFullName: data.head.repo?.full_name ?? "",
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

/**
 * Returns a Ronda pull-request review already published on `headSha`, if any.
 * Matches `commit_id` to the head SHA and the canonical Ronda summary marker.
 */
export async function findExistingRondaReview(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  headSha: string,
  signal?: AbortSignal,
): Promise<ExistingRondaPullRequestReview | null> {
  const reviews = await withAbortMapping(
    () =>
      withRetry(
        () =>
          octokit.paginate(octokit.pulls.listReviews, {
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
  for (const review of reviews) {
    if (review.commit_id !== headSha) {
      continue;
    }
    const body = review.body ?? "";
    if (!body.includes(RONDA_REVIEW_HEADING)) {
      continue;
    }
    return { headSha: review.commit_id };
  }
  return null;
}

const RESOLVED_THREADS_QUERY = `
query($owner: String!, $repo: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          path
          comments(first: 1) { nodes { body } }
        }
      }
    }
  }
}`;

interface ReviewThreadsPage {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          isResolved: boolean;
          path: string;
          comments: { nodes: Array<{ body: string }> };
        }>;
      };
    } | null;
  } | null;
}

/** Hard page cap so a pathological thread count cannot stall a pass. */
const MAX_THREAD_PAGES = 5;

/**
 * First-comment bodies of every resolved review thread (#158). Callers filter
 * to Ronda-shaped bodies; this reads only resolved threads' first comment.
 */
export async function readResolvedReviewThreads(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  signal?: AbortSignal,
): Promise<Array<{ path: string; body: string }>> {
  const out: Array<{ path: string; body: string }> = [];
  let cursor: string | null = null;
  for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
    const data: ReviewThreadsPage = await withAbortMapping(
      () =>
        withRetry(
          () =>
            octokit.graphql<ReviewThreadsPage>(RESOLVED_THREADS_QUERY, {
              owner,
              repo,
              number: pullNumber,
              cursor,
              request: { signal },
            }),
          undefined,
          signal,
        ),
      signal,
    );
    const threads = data.repository?.pullRequest?.reviewThreads;
    if (!threads) break;
    for (const node of threads.nodes) {
      const body = node.comments.nodes[0]?.body;
      if (node.isResolved && body !== undefined) out.push({ path: node.path, body });
    }
    if (!threads.pageInfo.hasNextPage) break;
    cursor = threads.pageInfo.endCursor;
  }
  return out;
}
