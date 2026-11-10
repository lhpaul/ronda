import { test } from "node:test";
import assert from "node:assert/strict";
import { runReviewPass } from "../../../src/core/run-review-pass.js";
import type { GithubOperations, PublishReviewInput } from "../../../src/domain/review-pass.types.js";
import type { ModelClient } from "../../../src/inference/model-client.js";
import type { RondaConfig } from "../../../src/config/config.types.js";
import {
  DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
  DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS,
  DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
} from "../../../src/config/load-config.js";
import { NO_CREDENTIAL_FILE, REAL_LEAK, REFUTED_VARIANTS } from "../../fixtures/refuted-credential-finding-158.js";

const config: RondaConfig = {
  model: { apiKey: "k", baseUrl: "https://example.test/v1", modelName: "m" },
  passTimeoutMs: 600_000,
  maxPatchChars: 400_000,
  maxAuthoritativeDocCount: DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
  maxAuthoritativeDocChars: DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
  durabilityMode: "default",
  durabilityModeDefault: false,
  sweepMode: "off",
  sweepModeRaw: undefined,
  repositoryContextMode: "off",
  repositoryContextModeRaw: undefined,
  maxRepositoryContextCandidates: DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES,
  maxRepositoryContextChars: DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS,
  repositoryContextTimeBudgetMs: DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
  repositoryContextBudgetFallbacks: [],
  excludePathGlobs: [],
};

async function run(
  findings: unknown[],
  extra: Partial<GithubOperations> = {},
): Promise<{ reviews: PublishReviewInput[]; events: Array<[string, Record<string, unknown>]>; count: number }> {
  const reviews: PublishReviewInput[] = [];
  const events: Array<[string, Record<string, unknown>]> = [];
  const github: GithubOperations = {
    async readPullRequest() {
      return { number: 7, title: "t", body: "", draft: false, headSha: "c".repeat(40), headBranch: "feature/x", headRepoFullName: "lhpaul/ronda" };
    },
    async readChangedFiles() {
      return [NO_CREDENTIAL_FILE];
    },
    async readFileAtRef() {
      return undefined;
    },
    async findExistingCheckRun() {
      return null;
    },
    async publishReview(input) {
      reviews.push(input);
    },
    async publishCheckRun() {},
    ...extra,
  };
  const model: ModelClient = {
    modelName: "m",
    async complete() {
      return { content: JSON.stringify({ findings }) };
    },
  };
  const result = await runReviewPass(
    { owner: "lhpaul", repo: "ronda", pullNumber: 7, trigger: "automatic" },
    {
      github,
      model,
      config,
      clock: { now: () => Date.now(), isoNow: () => new Date().toISOString() },
      logger: { event: (n, f) => events.push([n, f]) },
    },
  );
  return { reviews, events, count: result.findings.length };
}

test("#158: refuted credential variants are not published; a real leak on the same file still is", async () => {
  const { reviews, events, count } = await run([...REFUTED_VARIANTS, REAL_LEAK]);
  assert.equal(count, 1);
  assert.equal(reviews[0].inlineComments.length, 1);
  assert.equal(reviews[0].inlineComments[0].line, 45);
  const suppressed = events.find(([n]) => n === "findings_suppressed");
  assert.deepEqual(suppressed?.[1].byReason, { names_credential_without_value: REFUTED_VARIANTS.length });
});

test("#158: a claim already resolved on the path is not re-posted on the next push", async () => {
  const { count, events } = await run([REAL_LEAK], {
    async readResolvedRondaThreads() {
      return [{ path: REAL_LEAK.path, body: `**Blocking** — ${REAL_LEAK.title}\n\nx` }];
    },
  });
  assert.equal(count, 0);
  assert.deepEqual(events.find(([n]) => n === "findings_suppressed")?.[1].byReason, { resolved_thread: 1 });
});

test("#158: an unavailable thread read fails open and the finding is published", async () => {
  const { count, events } = await run([REAL_LEAK], {
    async readResolvedRondaThreads() {
      throw new Error("graphql unavailable");
    },
  });
  assert.equal(count, 1);
  assert.ok(events.some(([n]) => n === "resolved_thread_dedupe_unavailable"));
});
