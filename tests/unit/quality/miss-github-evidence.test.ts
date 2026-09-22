import assert from "node:assert/strict";
import { test } from "node:test";
import { RONDA_REVIEW_HEADING } from "../../../src/core/summary.js";
import {
  buildPushOrderedHeadShas,
  buildResolvabilityChecker,
  isKnownPullRequestHead,
  readCodexGithubFindings,
  readPullRequestEvidence,
  readSourceScanCorpus,
  resolveRondaResultHead,
  splitCommentFindingTexts,
} from "../../../src/quality/miss-github-evidence.js";
const HEAD_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HEAD_C = "cccccccccccccccccccccccccccccccccccccccc";
const BASE = "dddddddddddddddddddddddddddddddddddddddd";

test("AC37 buildPushOrderedHeadShas prefers timeline force-push tips over commit list", () => {
  const ordered = buildPushOrderedHeadShas({
    currentHeadSha: HEAD_C,
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

test("compare entries without patch refuse capture (incomplete diff evidence)", () => {
  const runGh = (args: string[]): string => {
    const joined = args.join(" ");
    if (joined.includes("/compare/") && !joined.includes("--jq")) {
      return JSON.stringify({
        files: [{ filename: "src/gone.ts", status: "removed" }],
      });
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
    /Incomplete diff evidence/,
  );
});

test("compare responses at the 300-file cap refuse capture", () => {
  const files = Array.from({ length: 300 }, (_, index) => ({
    filename: `src/file-${index}.ts`,
    patch: "+line",
    status: "modified",
  }));
  const runGh = (args: string[]): string => {
    const joined = args.join(" ");
    if (joined.includes("/compare/") && !joined.includes("--jq")) {
      return JSON.stringify({ files });
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
    /300-file limit/,
  );
});

test("parseGhPaginatedJsonArray slurps concatenated page arrays", async () => {
  const { parseGhPaginatedJsonArray } = await import(
    "../../../src/quality/miss-github-evidence.js"
  );
  const page1 = JSON.stringify([{ sha: HEAD_A }, { sha: HEAD_B }]);
  const page2 = JSON.stringify([{ sha: HEAD_C }]);
  const flattened = parseGhPaginatedJsonArray<{ sha: string }>(
    `${page1}${page2}`,
  );
  assert.deepEqual(
    flattened.map((row) => row.sha),
    [HEAD_A, HEAD_B, HEAD_C],
  );
  assert.deepEqual(parseGhPaginatedJsonArray("[]"), []);
  assert.deepEqual(
    parseGhPaginatedJsonArray(JSON.stringify([{ sha: HEAD_A }])),
    [{ sha: HEAD_A }],
  );
});

test("readPullRequestEvidence flattens paginated commits/reviews pages", () => {
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
      return `${JSON.stringify([{ sha: HEAD_A }])}${JSON.stringify([{ sha: HEAD_C }])}`;
    }
    if (joined.includes("/timeline")) {
      return JSON.stringify([
        { event: "head_ref_force_pushed", before: HEAD_A, after: HEAD_C },
      ]);
    }
    if (joined.includes("/reviews")) {
      return `${JSON.stringify([
        {
          id: 1,
          body: `${RONDA_REVIEW_HEADING}\nA`,
          commit_id: HEAD_A,
        },
      ])}${JSON.stringify([
        {
          id: 2,
          body: `${RONDA_REVIEW_HEADING}\nC`,
          commit_id: HEAD_C,
        },
      ])}`;
    }
    throw new Error(`Unexpected: ${joined}`);
  };

  const evidence = readPullRequestEvidence({
    pullNumber: 53,
    repository: "lhpaul/ronda",
    runGh,
  });
  assert.ok(evidence.pushOrderedHeadShas.includes(HEAD_A));
  assert.ok(evidence.pushOrderedHeadShas.includes(HEAD_C));
  assert.ok(evidence.rondaResultHeadShas.some((sha) => sha === HEAD_A));
  assert.ok(evidence.rondaResultHeadShas.some((sha) => sha === HEAD_C));
  assert.equal(
    evidence.rondaReviewBodyByHeadSha.get(HEAD_A)?.includes(RONDA_REVIEW_HEADING),
    true,
  );
});

test("splitCommentFindingTexts separates bullet items in one comment", () => {
  assert.deepEqual(
    splitCommentFindingTexts("- First issue\n- Second issue"),
    ["First issue", "Second issue"],
  );
});

test("one comment with multiple findings yields distinct stable source positions", () => {
  const comments = [
    {
      id: 300,
      user: { login: "chatgpt-codex-connector[bot]" },
      body: "- Alpha finding\n- Beta finding",
      path: "src/a.ts",
      line: 1,
      commit_id: HEAD_A,
    },
  ];

  const runGh = (args: string[]): string => {
    const joined = args.join(" ");
    if (joined.includes("/reviews")) {
      return JSON.stringify([]);
    }
    if (joined.includes("/comments")) {
      return JSON.stringify(comments);
    }
    throw new Error(`Unexpected: ${joined}`);
  };

  const result = readCodexGithubFindings({
    repository: "lhpaul/ronda",
    pullNumber: 53,
    currentHeadSha: HEAD_A,
    namedReviewer: "codex",
    runGh,
  });
  assert.equal(result.findingsOnCurrentHead.length, 2);
  assert.equal(result.findingsOnCurrentHead[0]?.sourceId, "comment:300:0");
  assert.equal(result.findingsOnCurrentHead[1]?.sourceId, "comment:300:1");
  assert.match(result.findingsOnCurrentHead[0]?.text ?? "", /Alpha/);
  assert.match(result.findingsOnCurrentHead[1]?.text ?? "", /Beta/);
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
  assert.equal(both.findingsOnCurrentHead[0]?.sourceId, "comment:100:0");
  assert.equal(both.findingsOnCurrentHead[1]?.sourceId, "comment:200:0");

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
  assert.equal(secondOnly.findingsOnCurrentHead[0]?.sourceId, "comment:200:0");
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

test("AC31 without force-push timeline only the current head is a known tip", () => {
  const ordered = buildPushOrderedHeadShas({
    currentHeadSha: HEAD_C,
    timelineEvents: [],
  });
  assert.deepEqual(ordered, [HEAD_C]);
  assert.equal(
    isKnownPullRequestHead({
      headSha: HEAD_B,
      pushOrderedHeadShas: ordered,
      currentHeadSha: HEAD_C,
    }),
    false,
  );
});

test("AC31 planted-violation fail-then-pass rejects commit-list head inference", () => {
  const pass = buildPushOrderedHeadShas({
    currentHeadSha: HEAD_C,
    timelineEvents: [],
  });
  assert.deepEqual(pass, [HEAD_C]);

  const plantOrdered = [HEAD_A, HEAD_B, HEAD_C];
  assert.equal(
    isKnownPullRequestHead({
      headSha: HEAD_B,
      pushOrderedHeadShas: plantOrdered,
      currentHeadSha: HEAD_C,
    }),
    true,
  );
  assert.equal(
    isKnownPullRequestHead({
      headSha: HEAD_B,
      pushOrderedHeadShas: pass,
      currentHeadSha: HEAD_C,
    }),
    false,
  );
});

test("review body findings split when inline comments exist on same review", () => {
  const reviews = [
    {
      id: 42,
      user: { login: "chatgpt-codex-connector[bot]" },
      body: "- Summary alpha\n- Summary beta",
      commit_id: HEAD_A,
    },
  ];
  const comments = [
    {
      id: 301,
      user: { login: "chatgpt-codex-connector[bot]" },
      body: "Inline detail",
      path: "src/a.ts",
      line: 10,
      commit_id: HEAD_A,
      pull_request_review_id: 42,
    },
  ];

  const runGh = (args: string[]): string => {
    const joined = args.join(" ");
    if (joined.includes("/reviews")) {
      return JSON.stringify(reviews);
    }
    if (joined.includes("/comments")) {
      return JSON.stringify(comments);
    }
    throw new Error(`Unexpected: ${joined}`);
  };

  const result = readCodexGithubFindings({
    repository: "lhpaul/ronda",
    pullNumber: 53,
    currentHeadSha: HEAD_A,
    namedReviewer: "codex",
    runGh,
  });
  assert.equal(result.findingsOnCurrentHead.length, 3);
  assert.equal(result.findingsOnCurrentHead[0]?.sourceId, "comment:301:0");
  assert.equal(result.findingsOnCurrentHead[1]?.sourceId, "review:42:0");
  assert.equal(result.findingsOnCurrentHead[2]?.sourceId, "review:42:1");
  assert.match(result.findingsOnCurrentHead[1]?.text ?? "", /Summary alpha/);
  assert.match(result.findingsOnCurrentHead[2]?.text ?? "", /Summary beta/);
});

test("AC41 comment and review numeric ids do not collide in sourceId namespace", () => {
  const reviews = [
    {
      id: 100,
      user: { login: "chatgpt-codex-connector[bot]" },
      body: "- Review-level finding",
      commit_id: HEAD_A,
    },
  ];
  const comments = [
    {
      id: 100,
      user: { login: "chatgpt-codex-connector[bot]" },
      body: "Comment-level finding",
      path: "src/a.ts",
      line: 1,
      commit_id: HEAD_A,
    },
  ];
  const runGh = (args: string[]): string => {
    const joined = args.join(" ");
    if (joined.includes("/reviews")) {
      return JSON.stringify(reviews);
    }
    if (joined.includes("/comments")) {
      return JSON.stringify(comments);
    }
    throw new Error(`Unexpected: ${joined}`);
  };
  const result = readCodexGithubFindings({
    repository: "lhpaul/ronda",
    pullNumber: 53,
    currentHeadSha: HEAD_A,
    namedReviewer: "codex",
    runGh,
  });
  assert.equal(result.findingsOnCurrentHead.length, 2);
  assert.equal(result.findingsOnCurrentHead[0]?.sourceId, "comment:100:0");
  assert.equal(result.findingsOnCurrentHead[1]?.sourceId, "review:100:0");
});

test("AC16 clean Codex review body yields nothing_to_capture signal", () => {
  const runGh = (args: string[]): string => {
    const joined = args.join(" ");
    if (joined.includes("/reviews")) {
      return JSON.stringify([
        {
          id: 1,
          user: { login: "chatgpt-codex-connector[bot]" },
          body: "Codex Review: Didn't find any major issues.\n**Reviewed commit:** `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`",
          commit_id: HEAD_A,
        },
      ]);
    }
    if (joined.includes("/comments")) {
      return JSON.stringify([]);
    }
    throw new Error(`Unexpected: ${joined}`);
  };
  const result = readCodexGithubFindings({
    repository: "lhpaul/ronda",
    pullNumber: 53,
    currentHeadSha: HEAD_A,
    namedReviewer: "codex",
    runGh,
  });
  assert.equal(result.findingsOnCurrentHead.length, 0);
  assert.equal(result.unparseableOnCurrentHead, false);
});

test("AC17 malformed current-head review prose is unparseable", () => {
  const runGh = (args: string[]): string => {
    const joined = args.join(" ");
    if (joined.includes("/reviews")) {
      return JSON.stringify([
        {
          id: 1,
          user: { login: "chatgpt-codex-connector[bot]" },
          body: "Review still running — check back later.",
          commit_id: HEAD_A,
        },
      ]);
    }
    if (joined.includes("/comments")) {
      return JSON.stringify([]);
    }
    throw new Error(`Unexpected: ${joined}`);
  };
  const result = readCodexGithubFindings({
    repository: "lhpaul/ronda",
    pullNumber: 53,
    currentHeadSha: HEAD_A,
    namedReviewer: "codex",
    runGh,
  });
  assert.equal(result.findingsOnCurrentHead.length, 0);
  assert.equal(result.unparseableOnCurrentHead, true);
});

test("AC37 fails closed when Ronda head is absent from push-order evidence", () => {
  assert.equal(
    resolveRondaResultHead({
      reviewedHeadSha: HEAD_C,
      pushOrderedHeadShas: [HEAD_C],
      rondaResultHeadShas: [HEAD_A, HEAD_B],
    }),
    null,
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
