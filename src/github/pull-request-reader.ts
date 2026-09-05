import type { Octokit } from "@octokit/rest";
import { CHECK_RUN_NAME } from "../domain/review-pass.types.js";
import type { ChangedFile, PullRequestMetadata } from "../domain/review-pass.types.js";
import { withRetry } from "./github-client.js";

export async function readPullRequest(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<PullRequestMetadata> {
  const response = await withRetry(() =>
    octokit.pulls.get({ owner, repo, pull_number: pullNumber }),
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

export async function readChangedFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
): Promise<ChangedFile[]> {
  const files = await octokit.paginate(octokit.pulls.listFiles, {
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });
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
): Promise<number | null> {
  const response = await withRetry(() =>
    octokit.checks.listForRef({
      owner,
      repo,
      ref: headSha,
      check_name: CHECK_RUN_NAME,
    }),
  );
  const run = response.data.check_runs[0];
  return run ? run.id : null;
}
