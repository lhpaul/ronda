import { test } from "node:test";
import assert from "node:assert/strict";
import { runReviewPass } from "../../src/core/run-review-pass.js";
import { createOpenAiCompatibleClient } from "../../src/inference/openai-compatible-client.js";
import { startMockModelServer } from "../support/mock-model-server.js";
import type {
  GithubOperations,
  PublishCheckRunInput,
  PublishReviewInput,
} from "../../src/domain/review-pass.types.js";

test("integration: a ready pull request with one finding produces exact review and check-run payloads", async () => {
  const headSha = "b".repeat(40);
  const server = await startMockModelServer({
    modelName: "mock-model",
    responseContent: JSON.stringify({
      findings: [
        {
          path: "src/example.ts",
          line: 2,
          severity: "blocking",
          title: "Off-by-one",
          body: "Use <= instead of <.",
        },
      ],
    }),
  });

  try {
    const publishedReviews: PublishReviewInput[] = [];
    const publishedCheckRuns: PublishCheckRunInput[] = [];

    const github: GithubOperations = {
      async readPullRequest() {
        return { number: 4, title: "Fix bug", body: "See changes", draft: false, headSha };
      },
      async readChangedFiles() {
        return [
          {
            path: "src/example.ts",
            status: "modified",
            additions: 1,
            deletions: 1,
            patch: "@@ -1,2 +1,2 @@\n context\n+added",
          },
        ];
      },
      async findExistingCheckRun() {
        return null;
      },
      async publishReview(input) {
        publishedReviews.push(input);
      },
      async publishCheckRun(input) {
        publishedCheckRuns.push(input);
      },
    };

    const model = createOpenAiCompatibleClient({
      apiKey: "test-key",
      baseUrl: server.url,
      modelName: "mock-model",
    });

    const result = await runReviewPass(
      { owner: "lhpaul", repo: "ronda", pullNumber: 4, trigger: "automatic" },
      {
        github,
        model,
        config: {
          model: { apiKey: "test-key", baseUrl: server.url, modelName: "mock-model" },
          passTimeoutMs: 600_000,
          maxPatchChars: 400_000,
        },
        // A fixed clock makes durationMs deterministic (always 0) so the
        // rendered summary/check-run text is reproducible for exact assertions.
        clock: { now: () => 0, isoNow: () => "2026-01-01T00:00:00.000Z" },
        logger: { event: () => undefined },
      },
    );

    assert.equal(result.outcome, "succeeded");
    assert.equal(publishedReviews.length, 1);
    assert.equal(publishedCheckRuns.length, 1);

    const review = publishedReviews[0];
    assert.equal(review.owner, "lhpaul");
    assert.equal(review.repo, "ronda");
    assert.equal(review.pullNumber, 4);
    assert.equal(review.headSha, headSha);
    assert.deepEqual(review.inlineComments, [
      {
        path: "src/example.ts",
        line: 2,
        body: "**Blocking** — Off-by-one\n\nUse <= instead of <.",
      },
    ]);
    assert.equal(
      review.summaryBody,
      [
        "## Ronda review",
        "",
        "Reviewed 1 changed file(s) (+1/-1).",
        "Model: mock-model",
        "Duration: 0s",
        "Trigger: Automatic",
        "",
        "### Findings by severity",
        "",
        "| Severity | Count |",
        "| --- | --- |",
        "| Blocking | 1 |",
        "| Important | 0 |",
        "| Nit | 0 |",
      ].join("\n"),
    );

    const checkRun = publishedCheckRuns[0];
    assert.equal(checkRun.owner, "lhpaul");
    assert.equal(checkRun.repo, "ronda");
    assert.equal(checkRun.headSha, headSha);
    assert.equal(checkRun.existingCheckRunId, null);
    assert.equal(checkRun.conclusion, "success");
    assert.equal(checkRun.title, "Review posted — 1 finding(s)");
    assert.equal(
      checkRun.summary,
      ["Model: mock-model", "Duration: 0s", "Blocking: 1, Important: 0, Nit: 0"].join("\n"),
    );
  } finally {
    await server.close();
  }
});

test("integration: multiple findings in the same changed file remain distinct in one review", async () => {
  const headSha = "c".repeat(40);
  const server = await startMockModelServer({
    modelName: "mock-model",
    responseContent: JSON.stringify({
      findings: [
        {
          path: "src/median.ts",
          line: 2,
          severity: "blocking",
          title: "Use numeric sort",
          body: "Array sort without a comparator performs lexicographic ordering.",
        },
        {
          path: "src/median.ts",
          line: 4,
          severity: "blocking",
          title: "Average even median values",
          body: "Even-length medians should average the middle pair.",
        },
      ],
    }),
  });

  try {
    const publishedReviews: PublishReviewInput[] = [];
    const publishedCheckRuns: PublishCheckRunInput[] = [];
    const github: GithubOperations = {
      async readPullRequest() {
        return { number: 5, title: "Add median", body: "See changes", draft: false, headSha };
      },
      async readChangedFiles() {
        return [
          {
            path: "src/median.ts",
            status: "added",
            additions: 4,
            deletions: 0,
            patch: "@@ -0,0 +1,4 @@\n+export function median(values: number[]): number {\n+  const sorted = [...values].sort();\n+  return sorted[Math.floor(sorted.length / 2)];\n+}",
          },
        ];
      },
      async findExistingCheckRun() {
        return null;
      },
      async publishReview(input) {
        publishedReviews.push(input);
      },
      async publishCheckRun(input) {
        publishedCheckRuns.push(input);
      },
    };
    const model = createOpenAiCompatibleClient({
      apiKey: "test-key",
      baseUrl: server.url,
      modelName: "mock-model",
    });

    const result = await runReviewPass(
      { owner: "lhpaul", repo: "ronda", pullNumber: 5, trigger: "automatic" },
      {
        github,
        model,
        config: {
          model: { apiKey: "test-key", baseUrl: server.url, modelName: "mock-model" },
          passTimeoutMs: 600_000,
          maxPatchChars: 400_000,
        },
        clock: { now: () => 0, isoNow: () => "2026-01-01T00:00:00.000Z" },
        logger: { event: () => undefined },
      },
    );

    assert.equal(result.outcome, "succeeded");
    assert.equal(publishedReviews.length, 1);
    assert.equal(publishedReviews[0].inlineComments.length, 2);
    assert.deepEqual(
      publishedReviews[0].inlineComments.map((comment) => comment.line),
      [2, 4],
    );
    assert.equal(publishedCheckRuns.length, 1);
    assert.equal(publishedCheckRuns[0].title, "Review posted — 2 finding(s)");
  } finally {
    await server.close();
  }
});
