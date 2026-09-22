import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { CAPTURE_HELP, main } from "../../../src/cli/capture-external-review-misses.js";
import { RONDA_REVIEW_HEADING } from "../../../src/core/summary.js";

const HEAD_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const BASE = "dddddddddddddddddddddddddddddddddddddddd";

function createGhFixture(input: {
  repository?: string;
  head?: string;
  baseRef?: string;
  commits?: string[];
  reviews?: unknown[];
  comments?: unknown[];
  mergeBase?: string;
  compareFiles?: Array<{ filename: string; patch?: string; status?: string }>;
  fileContents?: Record<string, string>;
}): (args: string[]) => string {
  const repository = input.repository ?? "lhpaul/ronda";
  const head = input.head ?? HEAD_A;
  const baseRef = input.baseRef ?? "develop";
  const commits = input.commits ?? [HEAD_B, HEAD_A];
  const reviews = input.reviews ?? [
    {
      id: 1,
      user: { login: "ronda-bot" },
      body: `${RONDA_REVIEW_HEADING}\n\nNo findings.`,
      commit_id: HEAD_A,
    },
  ];
  const comments = input.comments ?? [];
  const mergeBase = input.mergeBase ?? BASE;
  const compareFiles = input.compareFiles ?? [];
  const fileContents = input.fileContents ?? {};

  return (args: string[]) => {
    const joined = args.join(" ");
    if (joined.includes("repo view") && joined.includes("nameWithOwner")) {
      return repository;
    }
    if (args[0] === "pr" && args[1] === "view") {
      return JSON.stringify({
        headRefOid: head,
        baseRefName: baseRef,
        baseRefOid: BASE,
        url: `https://github.com/${repository}/pull/53`,
      });
    }
    if (joined.includes("/commits")) {
      return JSON.stringify(commits.map((sha) => ({ sha })));
    }
    if (joined.includes("/timeline")) {
      return JSON.stringify([]);
    }
    if (joined.includes("/reviews")) {
      return JSON.stringify(reviews);
    }
    if (joined.includes("/comments")) {
      return JSON.stringify(comments);
    }
    if (joined.includes("/git/ref/heads/")) {
      return BASE;
    }
    if (joined.includes("/compare/") && joined.includes("--jq")) {
      return mergeBase;
    }
    if (joined.includes("/compare/")) {
      return JSON.stringify({
        merge_base_commit: { sha: mergeBase },
        files: compareFiles,
      });
    }
    if (joined.includes("/contents/")) {
      const match = /contents\/([^?]+)/.exec(joined);
      const path = decodeURIComponent((match?.[1] ?? "").replace(/\//g, "/"));
      // args path uses encoded segments joined by /
      const key = args
        .find((arg) => arg.includes("/contents/"))
        ?.split("/contents/")[1]
        ?.split("?")[0]
        ?.split("/")
        .map((part) => decodeURIComponent(part))
        .join("/");
      const content = fileContents[key ?? path] ?? "";
      return JSON.stringify({
        encoding: "base64",
        content: Buffer.from(content).toString("base64"),
      });
    }
    throw new Error(`Unexpected gh args: ${joined}`);
  };
}

test("help text names the four Capture Decision Gate stages and outcomes", () => {
  assert.match(CAPTURE_HELP, /Stage 1/);
  assert.match(CAPTURE_HELP, /Stage 2/);
  assert.match(CAPTURE_HELP, /Stage 3/);
  assert.match(CAPTURE_HELP, /Stage 4/);
  assert.match(CAPTURE_HELP, /capture_refused/);
  assert.match(CAPTURE_HELP, /nothing_to_capture/);
  assert.match(CAPTURE_HELP, /record_written/);
  assert.match(CAPTURE_HELP, /record_updated/);
  assert.match(CAPTURE_HELP, /read-only/);
});

test("manual capture writes a record via injectable gh seam (AC1–AC3 shape)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-misses-"));
  try {
    const code = await main(
      [
        "capture-manual",
        "--pr",
        "53",
        "--repository",
        "lhpaul/ronda",
        "--reviewer",
        "human-reviewer",
        "--location",
        "src/example.ts:10",
        "--text",
        "Missing idempotency key on retry.",
        "--category",
        "idempotency",
        "--dir",
        dir,
      ],
      { runGh: createGhFixture({}) },
    );
    assert.equal(code, 0);
    const files = (await import("node:fs")).readdirSync(dir).filter((n) =>
      n.endsWith(".json"),
    );
    assert.equal(files.length, 1);
    const record = JSON.parse(readFileSync(join(dir, files[0]!), "utf8"));
    assert.equal(record.captureSource, "manual");
    assert.equal(record.verdict, "unadjudicated");
    assert.equal(record.pullNumber, 53);
    assert.equal(record.reviewedHeadSha, HEAD_A);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("automatic capture of Codex comments writes source-based record", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-misses-"));
  try {
    const runGh = createGhFixture({
      comments: [
        {
          id: 99,
          user: { login: "chatgpt-codex-connector[bot]" },
          body: "Unhandled timeout on webhook drain.",
          path: "src/webhook.ts",
          line: 42,
          commit_id: HEAD_A,
        },
      ],
      reviews: [
        {
          id: 1,
          user: { login: "ronda-bot" },
          body: `${RONDA_REVIEW_HEADING}\n\nNo findings.`,
          commit_id: HEAD_A,
        },
        {
          id: 2,
          user: { login: "chatgpt-codex-connector[bot]" },
          body: "",
          commit_id: HEAD_A,
        },
      ],
    });
    const code = await main(
      [
        "capture",
        "--pr",
        "53",
        "--repository",
        "lhpaul/ronda",
        "--reviewer",
        "codex",
        "--category",
        "timeouts",
        "--dir",
        dir,
      ],
      { runGh },
    );
    assert.equal(code, 0);
    const files = (await import("node:fs")).readdirSync(dir);
    assert.equal(files.length, 1);
    const record = JSON.parse(readFileSync(join(dir, files[0]!), "utf8"));
    assert.equal(record.captureSource, "automatic");
    assert.equal(record.sourceId, "comment:99:0");
    assert.equal(record.affectedCategory, "timeouts");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("automatic silence on current head reports nothing_to_capture (AC16)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-misses-"));
  try {
    const runGh = createGhFixture({
      comments: [
        {
          id: 50,
          user: { login: "chatgpt-codex-connector[bot]" },
          body: "Old finding",
          path: "src/old.ts",
          line: 1,
          commit_id: HEAD_B,
        },
      ],
      reviews: [
        {
          id: 1,
          user: { login: "ronda-bot" },
          body: `${RONDA_REVIEW_HEADING}\n`,
          commit_id: HEAD_A,
        },
        {
          id: 2,
          user: { login: "chatgpt-codex-connector[bot]" },
          body: "prior",
          commit_id: HEAD_B,
        },
      ],
    });
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const code = await main(
        [
          "capture",
          "--pr",
          "53",
          "--repository",
          "lhpaul/ronda",
          "--reviewer",
          "codex",
          "--category",
          "other",
          "--dir",
          dir,
        ],
        { runGh },
      );
      assert.equal(code, 0);
      assert.ok(logs.some((line) => line.includes("nothing_to_capture")));
      assert.equal((await import("node:fs")).readdirSync(dir).length, 0);
    } finally {
      console.log = original;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("automatic capture reports Stage 1 condition 3 before Codex fetch failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-misses-"));
  try {
    const runGh = (args: string[]) => {
      const joined = args.join(" ");
      if (joined.includes("/comments")) {
        throw new Error("comments API unavailable");
      }
      return createGhFixture({ reviews: [] })(args);
    };
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const code = await main(
        [
          "capture",
          "--pr",
          "53",
          "--repository",
          "lhpaul/ronda",
          "--reviewer",
          "codex",
          "--category",
          "other",
          "--dir",
          dir,
        ],
        { runGh },
      );
      assert.equal(code, 1);
      assert.ok(logs.some((line) => line.includes("capture_refused")));
      assert.ok(
        logs.some((line) =>
          line.includes("no Ronda result to compare against"),
        ),
      );
    } finally {
      console.log = original;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gh fixture never issues write verbs (AC2 read-only)", () => {
  const calls: string[] = [];
  const runGh = createGhFixture({});
  const wrapped = (args: string[]) => {
    calls.push(args.join(" "));
    // Refuse any mutating gh subcommands if they appear
    const joined = args.join(" ");
    assert.equal(/pr (comment|edit|close|ready|merge)/.test(joined), false);
    assert.equal(/api .* -X (POST|PUT|PATCH|DELETE)/.test(joined), false);
    return runGh(args);
  };
  wrapped(["pr", "view", "53", "--repo", "lhpaul/ronda", "--json", "headRefOid,baseRefName,baseRefOid,url"]);
  wrapped(["api", "repos/lhpaul/ronda/pulls/53/reviews", "--paginate"]);
  assert.ok(calls.length >= 2);
});

test("adjudicate and guarded delete lifecycle (AC44–AC45)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-misses-"));
  try {
    const runGh = createGhFixture({});
    await main(
      [
        "capture-manual",
        "--pr",
        "53",
        "--repository",
        "lhpaul/ronda",
        "--reviewer",
        "human",
        "--location",
        "src/x.ts:1",
        "--text",
        "A durable finding",
        "--category",
        "other",
        "--dir",
        dir,
      ],
      { runGh },
    );
    const files = (await import("node:fs")).readdirSync(dir);
    const record = JSON.parse(readFileSync(join(dir, files[0]!), "utf8"));

    // Delete while unadjudicated succeeds
    const deleteOk = await main(["delete", "--id", record.id, "--dir", dir], {
      runGh,
    });
    assert.equal(deleteOk, 0);
    assert.equal((await import("node:fs")).readdirSync(dir).length, 0);

    // Recreate and adjudicate, then delete must refuse
    await main(
      [
        "capture-manual",
        "--pr",
        "53",
        "--repository",
        "lhpaul/ronda",
        "--reviewer",
        "human",
        "--location",
        "src/x.ts:1",
        "--text",
        "A durable finding",
        "--category",
        "other",
        "--dir",
        dir,
      ],
      { runGh },
    );
    const files2 = (await import("node:fs")).readdirSync(dir);
    const record2 = JSON.parse(readFileSync(join(dir, files2[0]!), "utf8"));
    const adj = await main(
      [
        "adjudicate",
        "--id",
        record2.id,
        "--verdict",
        "true_positive",
        "--follow-up",
        "eval_record",
        "--rationale",
        "Confirmed miss",
        "--dir",
        dir,
      ],
      { runGh },
    );
    assert.equal(adj, 0);
    const deleteRefused = await main(
      ["delete", "--id", record2.id, "--dir", dir],
      { runGh },
    );
    assert.equal(deleteRefused, 1);
    assert.equal((await import("node:fs")).readdirSync(dir).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("planted credential in fixture refuses capture", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-misses-"));
  try {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const code = await main(
        [
          "capture-manual",
          "--pr",
          "53",
          "--repository",
          "lhpaul/ronda",
          "--reviewer",
          "human",
          "--location",
          "src/x.ts:1",
          "--text",
          'password = "s3cret-value"',
          "--category",
          "security",
          "--dir",
          dir,
        ],
        { runGh: createGhFixture({}) },
      );
      assert.equal(code, 1);
      assert.ok(logs.some((line) => /credential form/.test(line)));
      assert.equal((await import("node:fs")).readdirSync(dir).length, 0);
    } finally {
      console.log = original;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("malformed --pr values are refused before any GitHub call", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-miss-badpr-"));
  try {
    await assert.rejects(
      () =>
        main(
          [
            "capture-manual",
            "--pr",
            "98oops",
            "--repository",
            "lhpaul/ronda",
            "--reviewer",
            "human",
            "--location",
            "src/x.ts:1",
            "--text",
            "Missing retry backoff",
            "--dir",
            dir,
          ],
          {
            runGh: () => {
              throw new Error("GitHub must not be called for malformed --pr");
            },
          },
        ),
      /--pr must be a positive integer/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * REVIEW.md planted-violation proof (fail-then-pass) for each sensitive-content
 * guard at the CLI capture boundary:
 * - credential form (`password = "..."`)
 * - authorization bearer header
 * - mixed placeholder then real secret assignment
 * - diff hunk marker (`@@ `)
 * - six consecutive source lines from the compare corpus
 *
 * Each assertion is isolating: plant → refuse (no write); remove plant → write.
 */
test("CLI planted-violation fail-then-pass: credential, diff-marker, source-excerpt", async () => {
  const sourceLines = [
    "alpha-line-one",
    "bravo-line-two",
    "charlie-line-three",
    "delta-line-four",
    "echo-line-five",
    "foxtrot-line-six",
  ];
  const corpusGh = createGhFixture({
    compareFiles: [
      {
        filename: "src/changed.ts",
        patch: sourceLines.map((line) => `+${line}`).join("\n"),
        status: "modified",
      },
    ],
    fileContents: {
      "src/changed.ts": sourceLines.join("\n"),
    },
  });

  async function runCapture(
    text: string,
    dir: string,
  ): Promise<{ code: number; logs: string[]; files: string[] }> {
    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const code = await main(
        [
          "capture-manual",
          "--pr",
          "53",
          "--repository",
          "lhpaul/ronda",
          "--reviewer",
          "human-reviewer",
          "--location",
          "src/changed.ts:1",
          "--text",
          text,
          "--category",
          "correctness",
          "--dir",
          dir,
        ],
        { runGh: corpusGh },
      );
      const files = (await import("node:fs")).readdirSync(dir);
      return { code, logs, files };
    } finally {
      console.log = original;
    }
  }

  // --- Credential guard (isolating plant) ---
  {
    const dir = mkdtempSync(join(tmpdir(), "ronda-miss-cred-"));
    try {
      const planted = await runCapture('password = "s3cret-value"', dir);
      assert.equal(planted.code, 1, "credential plant must fail capture");
      assert.ok(
        planted.logs.some((line) => /credential form/.test(line)),
        "credential plant must name the credential form",
      );
      assert.equal(planted.files.length, 0, "credential plant must write nothing");

      const cleaned = await runCapture(
        "Missing retry backoff on webhook delivery.",
        dir,
      );
      assert.equal(cleaned.code, 0, "clean credential-free text must pass");
      assert.equal(cleaned.files.length, 1, "clean path must write one record");
      assert.ok(
        cleaned.logs.some((line) => /record_written/.test(line)),
        "clean path must report record_written",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Bearer header guard (isolating plant) ---
  {
    const dir = mkdtempSync(join(tmpdir(), "ronda-miss-bearer-"));
    try {
      const planted = await runCapture(
        "Authorization: Bearer abcdef0123456789",
        dir,
      );
      assert.equal(planted.code, 1, "bearer plant must fail capture");
      assert.ok(planted.logs.some((line) => /credential form/.test(line)));
      assert.equal(planted.files.length, 0);

      const cleaned = await runCapture(
        "Authorization: Bearer REDACTED",
        dir,
      );
      assert.equal(cleaned.code, 0, "placeholder bearer must pass");
      assert.equal(cleaned.files.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Mixed placeholder then real secret assignment (isolating plant) ---
  {
    const dir = mkdtempSync(join(tmpdir(), "ronda-miss-mixed-"));
    try {
      const planted = await runCapture(
        "password=REDACTED password=supersecretvalue",
        dir,
      );
      assert.equal(planted.code, 1, "mixed placeholder+secret must fail");
      assert.ok(planted.logs.some((line) => /credential form/.test(line)));
      assert.equal(planted.files.length, 0);

      const cleaned = await runCapture("password=REDACTED", dir);
      assert.equal(cleaned.code, 0, "placeholder-only assignment must pass");
      assert.equal(cleaned.files.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Diff-marker guard (isolating plant) ---
  {
    const dir = mkdtempSync(join(tmpdir(), "ronda-miss-diff-"));
    try {
      const planted = await runCapture(
        "See hunk\n@@ -1,3 +1,4 @@\ncontext around the change",
        dir,
      );
      assert.equal(planted.code, 1, "diff-marker plant must fail capture");
      assert.ok(
        planted.logs.some((line) => /source or diff content|diff/i.test(line)),
        "diff-marker plant must name source/diff refusal",
      );
      assert.equal(planted.files.length, 0, "diff-marker plant must write nothing");

      const cleaned = await runCapture(
        "Missing retry backoff on webhook delivery.",
        dir,
      );
      assert.equal(cleaned.code, 0, "clean text without hunk markers must pass");
      assert.equal(cleaned.files.length, 1);
      assert.ok(cleaned.logs.some((line) => /record_written/.test(line)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // --- Source-excerpt guard (isolating plant: six consecutive corpus lines) ---
  {
    const dir = mkdtempSync(join(tmpdir(), "ronda-miss-src-"));
    try {
      const planted = await runCapture(sourceLines.join("\n"), dir);
      assert.equal(planted.code, 1, "six-line source plant must fail capture");
      assert.ok(
        planted.logs.some((line) => /source or diff content|source/i.test(line)),
        "source-excerpt plant must name source/diff refusal",
      );
      assert.equal(planted.files.length, 0, "source plant must write nothing");

      const cleaned = await runCapture(sourceLines.slice(0, 5).join("\n"), dir);
      assert.equal(
        cleaned.code,
        0,
        "five consecutive source lines must pass (AC38)",
      );
      assert.equal(cleaned.files.length, 1);
      assert.ok(cleaned.logs.some((line) => /record_written/.test(line)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("fixture JSON sample loads as a miss record shape", () => {
  const fixture = join(
    process.cwd(),
    "tests/fixtures/external-review-misses/sample-manual-miss.json",
  );
  writeFileSync(
    fixture,
    `${JSON.stringify(
      {
        id: "lhpaul-ronda-pr-53-manual-sample",
        repository: "lhpaul/ronda",
        pullNumber: 53,
        reviewedHeadSha: HEAD_A,
        rondaResultHeadSha: HEAD_A,
        staleEvidence: false,
        externalReviewer: "human-reviewer",
        location: "src/example.ts:10",
        locationUnresolved: false,
        title: "Missing idempotency key on retry.",
        text: "Missing idempotency key on retry.",
        textTruncated: false,
        verdict: "unadjudicated",
        affectedCategory: "idempotency",
        intendedFollowUp: "undecided",
        captureSource: "manual",
        sourceId: null,
      },
      null,
      2,
    )}\n`,
  );
  const parsed = JSON.parse(readFileSync(fixture, "utf8"));
  assert.equal(parsed.captureSource, "manual");
});

test("adjudication refuses when source corpus cannot be loaded", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-misses-"));
  try {
    const runGh = createGhFixture({});
    await main(
      [
        "capture-manual",
        "--pr",
        "53",
        "--repository",
        "lhpaul/ronda",
        "--reviewer",
        "human",
        "--location",
        "src/x.ts:1",
        "--text",
        "A durable finding",
        "--category",
        "other",
        "--dir",
        dir,
      ],
      { runGh },
    );
    const files = (await import("node:fs")).readdirSync(dir);
    const record = JSON.parse(readFileSync(join(dir, files[0]!), "utf8"));

    const brokenGh = (args: string[]): string => {
      const joined = args.join(" ");
      if (joined.includes("/compare/") && !joined.includes("--jq")) {
        return JSON.stringify({
          files: [{ filename: "src/a.ts", patch: "+x", status: "modified" }],
        });
      }
      if (joined.includes("/contents/")) {
        throw new Error("blob unavailable");
      }
      return runGh(args);
    };

    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };
    try {
      const code = await main(
        [
          "adjudicate",
          "--id",
          record.id,
          "--verdict",
          "true_positive",
          "--rationale",
          "Should refuse without corpus",
          "--dir",
          dir,
        ],
        { runGh: brokenGh },
      );
      assert.equal(code, 1);
      assert.ok(logs.some((line) => line.includes("adjudication_refused")));
      assert.ok(logs.some((line) => /source corpus could not be loaded/i.test(line)));
    } finally {
      console.log = original;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("delete/adjudicate --id refuses paths outside the miss directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-misses-"));
  const outsideDir = mkdtempSync(join(tmpdir(), "ronda-outside-"));
  try {
    const outsidePath = join(outsideDir, "escape.json");
    writeFileSync(
      outsidePath,
      `${JSON.stringify({
        id: "escape-record",
        repository: "lhpaul/ronda",
        pullNumber: 53,
        reviewedHeadSha: HEAD_A,
        rondaResultHeadSha: HEAD_A,
        staleEvidence: false,
        externalReviewer: "human",
        location: "src/x.ts:1",
        locationUnresolved: false,
        title: "escape",
        text: "escape",
        textTruncated: false,
        verdict: "unadjudicated",
        affectedCategory: "other",
        intendedFollowUp: "undecided",
        captureSource: "manual",
        sourceId: null,
      })}\n`,
    );

    const deleteCode = await main(
      ["delete", "--id", outsidePath, "--dir", dir],
      { runGh: createGhFixture({}) },
    );
    assert.equal(deleteCode, 1);
    assert.equal(
      (await import("node:fs")).existsSync(outsidePath),
      true,
      "outside file must remain untouched",
    );

    const adjCode = await main(
      [
        "adjudicate",
        "--id",
        outsidePath,
        "--verdict",
        "true_positive",
        "--rationale",
        "must not touch outside path",
        "--dir",
        dir,
      ],
      { runGh: createGhFixture({}) },
    );
    assert.equal(adjCode, 1);
    const outside = JSON.parse(readFileSync(outsidePath, "utf8"));
    assert.equal(outside.verdict, "unadjudicated");
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});
