import { test } from "node:test";
import assert from "node:assert/strict";
import type { Octokit } from "@octokit/rest";
import { readReviewThreads } from "../../../src/github/review-thread-reader.js";

type GraphqlArgs = Record<string, unknown>;

function fakeOctokit(pages: unknown[]): { octokit: Pick<Octokit, "graphql">; calls: GraphqlArgs[] } {
  const calls: GraphqlArgs[] = [];
  const graphql = (async (_query: string, args: GraphqlArgs) => {
    calls.push(args);
    const page = pages[calls.length - 1];
    if (page instanceof Error) throw page;
    return page;
  }) as unknown as Octokit["graphql"];
  return { octokit: { graphql }, calls };
}

function page(nodes: unknown[], hasNextPage: boolean, endCursor: string | null = null) {
  return { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage, endCursor }, nodes } } } };
}

test("maps threads and comments in order and pages until the last page", async () => {
  const { octokit, calls } = fakeOctokit([
    page(
      [
        {
          isResolved: true,
          path: "a.ts",
          comments: {
            nodes: [
              { body: "root", authorAssociation: "NONE", author: { __typename: "Bot" } },
              { body: "/ronda refuted", authorAssociation: "OWNER", author: { __typename: "User" } },
            ],
          },
        },
      ],
      true,
      "c1",
    ),
    page([{ isResolved: false, path: null, comments: { nodes: [null, { body: null, authorAssociation: null, author: null }] } }, null], false),
  ]);
  const threads = await readReviewThreads(octokit, "o", "r", 7);
  assert.deepEqual(threads, [
    {
      isResolved: true,
      path: "a.ts",
      comments: [
        { body: "root", authorAssociation: "NONE", authorIsBot: true },
        { body: "/ronda refuted", authorAssociation: "OWNER", authorIsBot: false },
      ],
    },
    {
      isResolved: false,
      path: "",
      comments: [
        { body: "", authorAssociation: "", authorIsBot: false },
        { body: "", authorAssociation: "", authorIsBot: false },
      ],
    },
  ]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.after, null);
  assert.equal(calls[1]?.after, "c1");
  assert.equal(calls[0]?.number, 7);
});

test("a missing pull request yields no threads", async () => {
  const { octokit } = fakeOctokit([{ repository: { pullRequest: null } }]);
  assert.deepEqual(await readReviewThreads(octokit, "o", "r", 7), []);
});

test("a non-retryable error propagates", async () => {
  const error = Object.assign(new Error("forbidden"), { status: 403 });
  const { octokit } = fakeOctokit([error]);
  await assert.rejects(readReviewThreads(octokit, "o", "r", 7), /forbidden/);
});
