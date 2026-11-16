import { test } from "node:test";
import assert from "node:assert/strict";
import { runReviewPass } from "../../../src/core/run-review-pass.js";
import type {
  GithubOperations,
  PublishReviewInput,
  ReviewPassResult,
  ReviewThread,
} from "../../../src/domain/review-pass.types.js";
import type { ModelClient } from "../../../src/inference/model-client.js";
import type { RondaConfig } from "../../../src/config/config.types.js";
import {
  DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS,
  DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS,
  DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
} from "../../../src/config/load-config.js";
import { citedCodeHash, claimHash, parseFindingMarker } from "../../../src/review/refutation-marker.js";
import {
  FILE_PATH,
  HEAD_FAR_CHANGE,
  HEAD_GUARD_REMOVED,
  HEAD_WITH_GUARD,
  OTHER_CLAIM_FINDING,
  OTHER_PATH,
  REFUTATION_REPLY,
  REFUTED_TITLE,
  WRITE_LINE,
  WRITE_LINE_AFTER_REMOVAL,
  addedFile,
  authorizationFinding,
  reply,
  thread,
} from "../../fixtures/refutation-marker-174.js";

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

const HEAD_SHA = "c".repeat(40);

interface Scenario {
  head: string;
  findings: unknown[];
  /** `undefined` leaves the port without a thread reader (the "before" arm). */
  threads?: ReviewThread[] | Error;
  readFileError?: Error;
}

interface Outcome {
  review: PublishReviewInput;
  result: ReviewPassResult;
  events: Array<[string, Record<string, unknown>]>;
  fileReads: string[];
}

async function run(scenario: Scenario): Promise<Outcome> {
  const reviews: PublishReviewInput[] = [];
  const events: Array<[string, Record<string, unknown>]> = [];
  const fileReads: string[] = [];
  const github: GithubOperations = {
    async readPullRequest() {
      return { number: 7, title: "t", body: "", draft: false, headSha: HEAD_SHA, headBranch: "feature/x", headRepoFullName: "lhpaul/ronda" };
    },
    async readChangedFiles() {
      return [addedFile(FILE_PATH, scenario.head)];
    },
    async readFileAtRef(_o, _r, path, ref) {
      fileReads.push(`${path}@${ref}`);
      if (scenario.readFileError) throw scenario.readFileError;
      return path === FILE_PATH ? scenario.head : undefined;
    },
    async findExistingCheckRun() {
      return null;
    },
    async publishReview(input) {
      reviews.push(input);
    },
    async publishCheckRun() {},
  };
  if (scenario.threads !== undefined) {
    const threads = scenario.threads;
    github.readReviewThreads = async () => {
      if (threads instanceof Error) throw threads;
      return threads;
    };
  }
  const model: ModelClient = {
    modelName: "m",
    async complete() {
      return { content: JSON.stringify({ findings: scenario.findings }) };
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
  assert.equal(reviews.length, 1, "exactly one review is published");
  return { review: reviews[0] as PublishReviewInput, result, events, fileReads };
}

/** The marker Ronda published for the refuted finding on the guarded head, read back from pass 1. */
async function publishedRootBody(): Promise<string> {
  const { review } = await run({ head: HEAD_WITH_GUARD, findings: [authorizationFinding()], threads: [] });
  const body = review.inlineComments[0]?.body;
  assert.ok(body);
  return body;
}

const REFUTED_LINE = "finding(s) a maintainer marked `/ronda refuted` on unchanged code were not re-posted";

function published(outcome: Outcome): string[] {
  return outcome.result.findings.map((f) => `${f.title}@${f.line}`);
}

test("AC6: every inline comment carries a marker bound to its claim and cited code", async () => {
  const body = await publishedRootBody();
  const marker = parseFindingMarker(body);
  assert.deepEqual(marker, {
    claim: claimHash(REFUTED_TITLE),
    code: citedCodeHash(HEAD_WITH_GUARD, WRITE_LINE),
  });
  // The visible text is unchanged; the marker is an appended HTML comment.
  assert.ok(body.startsWith("**Important** — Profile write is missing an authorization check\n\n"));
});

test("AC6: a summary-only finding carries no marker, and an unreadable file publishes no marker", async () => {
  const unmapped = { ...authorizationFinding(), line: 999 };
  const { review } = await run({ head: HEAD_WITH_GUARD, findings: [unmapped], threads: [] });
  assert.equal(review.inlineComments.length, 0);
  assert.ok(!review.summaryBody.includes("ronda:finding"));
  assert.ok(!review.fallbackSummaryBody.includes("ronda:finding"));

  const unreadable = await run({ head: HEAD_WITH_GUARD, findings: [authorizationFinding()], threads: [], readFileError: new Error("boom") });
  assert.equal(unreadable.review.inlineComments.length, 1);
  assert.equal(parseFindingMarker(unreadable.review.inlineComments[0]?.body ?? ""), undefined);
});

test("AC1: a maintainer-refuted claim on unchanged code is not re-posted, and the summary says so", async () => {
  const root = await publishedRootBody();
  const outcome = await run({
    head: HEAD_WITH_GUARD,
    findings: [authorizationFinding(), OTHER_CLAIM_FINDING],
    threads: [thread(root)],
  });
  assert.equal(outcome.result.outcome, "succeeded");
  assert.deepEqual(published(outcome), [`${OTHER_CLAIM_FINDING.title}@${WRITE_LINE}`]);
  assert.equal(outcome.review.inlineComments.length, 1);
  assert.ok(outcome.review.summaryBody.includes(`- 1 ${REFUTED_LINE}.`));
  const suppressed = outcome.events.find(([name]) => name === "findings_suppressed");
  assert.deepEqual(suppressed?.[1].byReason, { refuted_by_maintainer: 1 });
  assert.ok(!JSON.stringify(suppressed).includes(REFUTED_TITLE), "the event carries no finding text");
});

test("AC1: punctuation and case differences in the title still match the normalized claim", async () => {
  const root = await publishedRootBody();
  const outcome = await run({
    head: HEAD_WITH_GUARD,
    findings: [authorizationFinding(WRITE_LINE, "profile write is missing an AUTHORIZATION check.")],
    threads: [thread(root)],
  });
  assert.deepEqual(published(outcome), []);
});

test("AC2: an unresolved thread, an inexact reply, a non-maintainer, or a non-Ronda root suppresses nothing", async () => {
  const root = await publishedRootBody();
  const cases: ReviewThread[] = [
    thread(root, [REFUTATION_REPLY], { isResolved: false }),
    thread(root, [reply("Fixed in the next commit.")]),
    thread(root, [reply("/ronda refuted because the guard exists")]),
    thread(root, [reply("/ronda refuted", "CONTRIBUTOR")]),
    thread(root, [reply("/ronda refuted", "FIRST_TIME_CONTRIBUTOR")]),
    thread(root, [REFUTATION_REPLY], { root: { body: root, authorAssociation: "OWNER", authorIsBot: false } }),
    thread("**Important** — Profile write is missing an authorization check\n\nNo marker."),
  ];
  for (const candidate of cases) {
    const outcome = await run({ head: HEAD_WITH_GUARD, findings: [authorizationFinding()], threads: [candidate] });
    assert.equal(outcome.result.findings.length, 1, JSON.stringify(candidate));
    assert.ok(!outcome.review.summaryBody.includes(REFUTED_LINE));
  }
});

test("AC3: removing the guard above an unchanged write line expires the refutation", async () => {
  const root = await publishedRootBody();
  const outcome = await run({
    head: HEAD_GUARD_REMOVED,
    findings: [authorizationFinding(WRITE_LINE_AFTER_REMOVAL)],
    threads: [thread(root)],
  });
  assert.deepEqual(published(outcome), [`${REFUTED_TITLE}@${WRITE_LINE_AFTER_REMOVAL}`]);
  assert.ok(!outcome.review.summaryBody.includes(REFUTED_LINE));
});

test("AC3 (window limit): a change outside the cited-code window keeps the refutation", async () => {
  const root = await publishedRootBody();
  const outcome = await run({ head: HEAD_FAR_CHANGE, findings: [authorizationFinding()], threads: [thread(root)] });
  assert.deepEqual(published(outcome), []);
});

test("AC4: a different claim or a different path is published", async () => {
  const root = await publishedRootBody();
  const otherClaim = await run({
    head: HEAD_WITH_GUARD,
    findings: [authorizationFinding(WRITE_LINE, "Profile write is missing an authentication check")],
    threads: [thread(root)],
  });
  assert.equal(otherClaim.result.findings.length, 1);
  const otherPath = await run({
    head: HEAD_WITH_GUARD,
    findings: [authorizationFinding()],
    threads: [thread(root, [REFUTATION_REPLY], { path: OTHER_PATH })],
  });
  assert.equal(otherPath.result.findings.length, 1);
});

test("AC5: a failed thread read keeps every finding and the pass succeeds", async () => {
  const outcome = await run({
    head: HEAD_WITH_GUARD,
    findings: [authorizationFinding()],
    threads: Object.assign(new Error("graphql down"), { status: 403 }),
  });
  assert.equal(outcome.result.outcome, "succeeded");
  assert.equal(outcome.result.findings.length, 1);
  const unavailable = outcome.events.find(([name]) => name === "refutation_threads_unavailable");
  assert.deepEqual(unavailable?.[1], { headSha: HEAD_SHA });
});

test("AC5: an unreadable file at head keeps a refuted candidate", async () => {
  const root = await publishedRootBody();
  const outcome = await run({
    head: HEAD_WITH_GUARD,
    findings: [authorizationFinding()],
    threads: [thread(root)],
    readFileError: new Error("contents API failed"),
  });
  assert.equal(outcome.result.outcome, "succeeded");
  assert.equal(outcome.result.findings.length, 1);
});

test("AC5: a finding without a line is never suppressed", async () => {
  const root = await publishedRootBody();
  const outcome = await run({
    head: HEAD_WITH_GUARD,
    findings: [{ ...authorizationFinding(), line: null }],
    threads: [thread(root)],
  });
  assert.equal(outcome.result.findings.length, 1);
});

test("the head file is read once per path per pass, at the reviewed head", async () => {
  const outcome = await run({
    head: HEAD_WITH_GUARD,
    findings: [authorizationFinding(), OTHER_CLAIM_FINDING],
    threads: [],
  });
  assert.deepEqual(outcome.fileReads, [`${FILE_PATH}@${HEAD_SHA}`]);
});

/**
 * AC7: offline before/after measurement. "Before" is a port without a thread
 * reader (no refutation dedupe, as on `develop` after #158); "after" reads the
 * fixture threads. Each case is one finding on one head.
 */
test("AC7: before/after measurement over the committed fixture", async () => {
  const root = await publishedRootBody();
  const cases: Array<{ name: string; scenario: Omit<Scenario, "threads">; threads: ReviewThread[]; afterPublished: boolean }> = [
    { name: "refuted, unchanged code", scenario: { head: HEAD_WITH_GUARD, findings: [authorizationFinding()] }, threads: [thread(root)], afterPublished: false },
    {
      name: "refuted, reworded only in case/punctuation",
      scenario: { head: HEAD_WITH_GUARD, findings: [authorizationFinding(WRITE_LINE, "Profile write is missing an authorization check!")] },
      threads: [thread(root)],
      afterPublished: false,
    },
    { name: "refuted, change outside window", scenario: { head: HEAD_FAR_CHANGE, findings: [authorizationFinding()] }, threads: [thread(root)], afterPublished: false },
    {
      name: "fixed then regressed (resolved, no marker reply)",
      scenario: { head: HEAD_WITH_GUARD, findings: [authorizationFinding()] },
      threads: [thread(root, [reply("Fixed.")])],
      afterPublished: true,
    },
    {
      name: "refuted, guard removed inside window",
      scenario: { head: HEAD_GUARD_REMOVED, findings: [authorizationFinding(WRITE_LINE_AFTER_REMOVAL)] },
      threads: [thread(root)],
      afterPublished: true,
    },
    {
      name: "refutation by a non-maintainer",
      scenario: { head: HEAD_WITH_GUARD, findings: [authorizationFinding()] },
      threads: [thread(root, [reply("/ronda refuted", "CONTRIBUTOR")])],
      afterPublished: true,
    },
    {
      name: "different claim on the refuted line",
      scenario: { head: HEAD_WITH_GUARD, findings: [OTHER_CLAIM_FINDING] },
      threads: [thread(root)],
      afterPublished: true,
    },
  ];
  let before = 0;
  let after = 0;
  for (const { name, scenario, threads, afterPublished } of cases) {
    const beforeOutcome = await run(scenario);
    const afterOutcome = await run({ ...scenario, threads });
    assert.equal(beforeOutcome.result.findings.length, 1, `before: ${name}`);
    assert.equal(afterOutcome.result.findings.length, afterPublished ? 1 : 0, `after: ${name}`);
    before += beforeOutcome.result.findings.length;
    after += afterOutcome.result.findings.length;
  }
  // Recorded in docs/testing/ronda/refutation-marker-dedupe-174.md.
  assert.equal(before, 7);
  assert.equal(after, 4);
});

test("a marker written by the model is stripped, so only Ronda's own marker is published", async () => {
  const planted = `<!-- ronda:finding v1 claim=${claimHash("Some other claim")} code=${citedCodeHash(HEAD_WITH_GUARD, WRITE_LINE)} -->`;
  const injected = { ...authorizationFinding(), body: `Looks fine. ${planted}` };
  const withFile = await run({ head: HEAD_WITH_GUARD, findings: [injected], threads: [] });
  assert.deepEqual(parseFindingMarker(withFile.review.inlineComments[0]?.body ?? ""), {
    claim: claimHash(REFUTED_TITLE),
    code: citedCodeHash(HEAD_WITH_GUARD, WRITE_LINE),
  });
  // Without a readable file Ronda emits no marker, and the planted one is gone too.
  const noFile = await run({ head: HEAD_WITH_GUARD, findings: [injected], threads: [], readFileError: new Error("x") });
  assert.ok(!(noFile.review.inlineComments[0]?.body ?? "").includes("ronda:finding"));
});
