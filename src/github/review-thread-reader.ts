import type { Octokit } from "@octokit/rest";
import type { ReviewThread } from "../domain/review-pass.types.js";
import { withAbortMapping, withRetry } from "./github-client.js";

/**
 * Review threads with up to 100 comments each. A thread with more comments
 * is read only partly, which can only miss a refutation reply: the finding is
 * then kept (fail open, #174).
 */
const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            isResolved
            path
            comments(first: 100) {
              nodes {
                body
                authorAssociation
                author { __typename }
              }
            }
          }
        }
      }
    }
  }
`;

interface ReviewThreadsResponse {
  repository: {
    pullRequest: {
      reviewThreads: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: Array<{
          isResolved: boolean;
          path: string | null;
          comments: {
            nodes: Array<{
              body: string | null;
              authorAssociation: string | null;
              author: { __typename: string } | null;
            } | null> | null;
          } | null;
        } | null>;
      };
    } | null;
  } | null;
}

/** Bounds the thread walk: 50 pages of 100 threads. Anything past it is not read (fail open). */
const MAX_THREAD_PAGES = 50;

/**
 * Reads every review thread of a pull request (read-only). The whole walk is
 * retried as one unit, so a retry never mixes pages from two attempts.
 */
export async function readReviewThreads(
  octokit: Pick<Octokit, "graphql">,
  owner: string,
  repo: string,
  pullNumber: number,
  signal?: AbortSignal,
): Promise<ReviewThread[]> {
  return withAbortMapping(
    () => withRetry(() => walkReviewThreads(octokit, owner, repo, pullNumber, signal), undefined, signal),
    signal,
  );
}

async function walkReviewThreads(
  octokit: Pick<Octokit, "graphql">,
  owner: string,
  repo: string,
  pullNumber: number,
  signal: AbortSignal | undefined,
): Promise<ReviewThread[]> {
  const threads: ReviewThread[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_THREAD_PAGES; page += 1) {
    const response: ReviewThreadsResponse = await octokit.graphql<ReviewThreadsResponse>(REVIEW_THREADS_QUERY, {
      owner,
      repo,
      number: pullNumber,
      after,
      request: { signal },
    });
    const connection = response.repository?.pullRequest?.reviewThreads;
    if (!connection) return threads;
    for (const node of connection.nodes) {
      if (!node) continue;
      threads.push({
        isResolved: node.isResolved === true,
        path: node.path ?? "",
        // A null comment keeps its position as an empty, non-bot,
        // non-maintainer comment, so it can never act as a Ronda root or a
        // refutation reply, and never promotes a later comment to root.
        comments: (node.comments?.nodes ?? []).map((comment) => ({
          body: comment?.body ?? "",
          authorAssociation: comment?.authorAssociation ?? "",
          authorIsBot: comment?.author?.__typename === "Bot",
        })),
      });
    }
    if (!connection.pageInfo.hasNextPage || !connection.pageInfo.endCursor) return threads;
    after = connection.pageInfo.endCursor;
  }
  return threads;
}
