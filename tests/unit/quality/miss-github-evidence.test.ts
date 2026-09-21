import assert from "node:assert/strict";
import { test } from "node:test";
import { RONDA_REVIEW_HEADING } from "../../../src/core/summary.js";
import {
  buildPushOrderedHeadShas,
  buildResolvabilityChecker,
  readCodexGithubFindings,
  readPullRequestEvidence,
  readSourceScanCorpus,
  resolveRondaResultHead,
} from "../../../src/quality/miss-github-evidence.js";

const HEAD_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HEAD_C = "cccccccccccccccccccccccccccccccccccccccc";
const BASE = "dddddddddddddddddddddddddddddddddddddddd";

test("AC37 buildPushOrderedHeadShas prefers timeline force-push tips over commits alone", () => {
  const ordered = buildPushOrderedHeadShas({
    currentHeadSha: HEAD_C,
    commits: [{ sha: HEAD_C }],
    timelineEvents: [
      { event: "head_ref_force_pushed", before: HEAD_A, after: HEAD_B },
      { event: "head_ref_force_pushed", before: HEAD_B, after: HEAD_C },
    ],
  });
  assert.deepEqual(ordered, [HEAD_A, HEAD_B, HEAD_C]);

  // With timeline tips present, push-order fallback selects B (not publish-later A).
  assert.equal(
    resolveRondaResultHead({
      reviewedHeadSha: HEAD_C,
      pushOrderedHeadShas: ordered,
      rondaResultHeadShas: [HEAD_A, HEAD_B],
    }),
    HEAD_B,
  );
});

test("blob lookup failures fail closed for sensitive-content corpus", () => {
  const runGh = (args: string[]): string => {
    const joined = args.join(" ");
    if (joined.includes("/compare/") && !joined.includes("--jq")) {
      return JSON.stringify({
        files: [{ filename: "src/secret.ts", patch: "+line", status: "modified" }],
      });
    }
    if (joined.includes("/contents/")) {
      throw new Error("Not Found");
    }
    throw new Error(`Unexpected gh args: ${joined}`);
  };

  assert.throws(
    () =>
      readSourceScanCorpus({
        repository: "lhpaul/ronda",
        pullNumber: 53,
        reviewedHeadSha: HEAD_A,
        mergeBaseSha: BASE,
        runGh,
      }),
    /Blob lookup failed/,
  );
});

test("review-comment source id is stable (not findings.length position)", () => {
  const comments = [
    {
      id: 100,
      user: { login: "chatgpt-codex-connector[bot]" },
      body: "First finding",
      path: "a.ts",
      line: 1,
      commit_id: HEAD_A,
    },
    {
      id: 200,
      user: { login: "chatgpt-codex-connector[bot]" },
      body: "Second finding",
      path: "b.ts",
      line: 2,
      commit_id: HEAD_A,
    },
  ];

  const runGhBoth = (args: string[]): string => {
    const joined = args.join(" ");
    if (joined.includes("/reviews")) {
      return JSON.stringify([]);
    }
    if (joined.includes("/comments")) {
      return JSON.stringify(comments);
    }
    throw new Error(`Unexpected: ${joined}`);
  };

  const both = readCodexGithubFindings({
    repository: "lhpaul/ronda",
    pullNumber: 53,
    currentHeadSha: HEAD_A,
    namedReviewer: "codex",
    runGh: runGhBoth,
  });
  assert.equal(both.findingsOnCurrentHead.length, 2);
  assert.equal(both.findingsOnCurrentHead[0]?.sourceId, "100:0");
  assert.equal(both.findingsOnCurrentHead[1]?.sourceId, "200:0");

  // Dropping the first comment must not change the second comment's source id.
  const runGhSecondOnly = (args: string[]): string => {
    const joined = args.join(" ");
    if (joined.includes("/reviews")) {
      return JSON.stringify([]);
    }
    if (joined.includes("/comments")) {
      return JSON.stringify([comments[1]]);
    }
    throw new Error(`Unexpected: ${joined}`);
  };
  const secondOnly = readCodexGithubFindings({
    repository: "lhpaul/ronda",
    pullNumber: 53,
    currentHeadSha: HEAD_A,
    namedReviewer: "codex",
    runGh: runGhSecondOnly,
  });
  assert.equal(secondOnly.findingsOnCurrentHead[0]?.sourceId, "200:0");
});

test("readPullRequestEvidence uses timeline tips and never publish-order fallback", () => {
  const runGh = (args: string[]): string => {
    const joined = args.join(" ");
    if (joined.includes("repo view")) {
      return "lhpaul/ronda";
    }
    if (args[0] === "pr" && args[1] === "view") {
      return JSON.stringify({
        headRefOid: HEAD_C,
        baseRefName: "develop",
        baseRefOid: BASE,
      });
    }
    if (joined.includes("/commits")) {
      // Force-pushed away A and B — commits API only sees C.
      return JSON.stringify([{ sha: HEAD_C }]);
    }
    if (joined.includes("/timeline")) {
      return JSON.stringify([
        { event: "head_ref_force_pushed", before: HEAD_A, after: HEAD_B },
        { event: "head_ref_force_pushed", before: HEAD_B, after: HEAD_C },
      ]);
    }
    if (joined.includes("/reviews")) {
      // Publish order: A reviewed after B (A listed last).
      return JSON.stringify([
        {
          id: 1,
          body: `${RONDA_REVIEW_HEADING}\nB`,
          commit_id: HEAD_B,
        },
        {
          id: 2,
          body: `${RONDA_REVIEW_HEADING}\nA`,
          commit_id: HEAD_A,
        },
      ]);
    }
    throw new Error(`Unexpected: ${joined}`);
  };

  const evidence = readPullRequestEvidence({
    pullNumber: 53,
    repository: "lhpaul/ronda",
    runGh,
  });
  assert.deepEqual(evidence.pushOrderedHeadShas, [HEAD_A, HEAD_B, HEAD_C]);
  assert.equal(
    resolveRondaResultHead({
      reviewedHeadSha: HEAD_C,
      pushOrderedHeadShas: evidence.pushOrderedHeadShas,
      rondaResultHeadShas: evidence.rondaResultHeadShas,
    }),
    HEAD_B,
  );
});

test("buildResolvabilityChecker treats missing evidence as unresolvable", () => {
  const checker = buildResolvabilityChecker(
    new Map([["lhpaul/ronda#53", { rondaResultHeadShas: [HEAD_A] }]]),
  );
  assert.equal(
    checker({
      repository: "lhpaul/ronda",
      pullNumber: 53,
      rondaResultHeadSha: HEAD_A,
    }),
    true,
  );
  assert.equal(
    checker({
      repository: "lhpaul/ronda",
      pullNumber: 53,
      rondaResultHeadSha: HEAD_B,
    }),
    false,
  );
  assert.equal(
    checker({
      repository: "lhpaul/ronda",
      pullNumber: 99,
      rondaResultHeadSha: HEAD_A,
    }),
    false,
  );
});
