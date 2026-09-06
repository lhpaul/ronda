import type { Octokit } from "@octokit/rest";
import { CHECK_RUN_NAME } from "../domain/review-pass.types.js";
import type { PublishCheckRunInput } from "../domain/review-pass.types.js";
import { withRetry } from "./github-client.js";

/**
 * Publishes exactly one terminal check run. When `existingCheckRunId` is
 * present it issues `PATCH .../check-runs/{id}`; otherwise it issues
 * `POST .../check-runs`. This is called only at pass-terminal time —
 * creating an `in_progress` run at pass start would leave it permanently
 * pending whenever the Actions run is cancelled (the supersede path),
 * which would contradict "never pending with no explanation".
 */
export async function publishCheckRun(
  octokit: Octokit,
  input: PublishCheckRunInput,
  signal?: AbortSignal,
): Promise<void> {
  const output = { title: input.title, summary: input.summary };

  if (input.existingCheckRunId !== null) {
    await withRetry(() =>
      octokit.checks.update({
        owner: input.owner,
        repo: input.repo,
        check_run_id: input.existingCheckRunId as number,
        status: "completed",
        started_at: input.startedAt,
        completed_at: input.completedAt,
        conclusion: input.conclusion,
        details_url: input.detailsUrl,
        output,
        request: { signal },
      }),
    );
    return;
  }

  await withRetry(() =>
    octokit.checks.create({
      owner: input.owner,
      repo: input.repo,
      name: CHECK_RUN_NAME,
      head_sha: input.headSha,
      status: "completed",
      started_at: input.startedAt,
      completed_at: input.completedAt,
      conclusion: input.conclusion,
      details_url: input.detailsUrl,
      output,
      request: { signal },
    }),
  );
}
