import { test } from "node:test";
import assert from "node:assert/strict";
import type { Octokit } from "@octokit/rest";
import { readRepositoryFileAtRef } from "../../../src/github/repo-content-reader.js";

function createOctokit(handlers: {
  getContent?: (...args: unknown[]) => Promise<{ data: unknown }>;
}): Octokit {
  return {
    repos: {
      getContent: handlers.getContent ?? (async () => ({ data: {} })),
    },
  } as unknown as Octokit;
}

test("readRepositoryFileAtRef decodes a base64 file payload", async () => {
  const octokit = createOctokit({
    async getContent() {
      return {
        data: {
          type: "file",
          content: Buffer.from("hello world", "utf8").toString("base64"),
          truncated: false,
        },
      };
    },
  });

  const text = await readRepositoryFileAtRef(octokit, "lhpaul", "ronda", "README.md", "abc");
  assert.equal(text, "hello world");
});

test("readRepositoryFileAtRef returns undefined for HTTP 404", async () => {
  const octokit = createOctokit({
    async getContent() {
      const error = new Error("Not Found") as Error & { status: number };
      error.status = 404;
      throw error;
    },
  });

  const text = await readRepositoryFileAtRef(octokit, "lhpaul", "ronda", "missing.md", "abc");
  assert.equal(text, undefined);
});

test("readRepositoryFileAtRef returns undefined for directory array payloads", async () => {
  const octokit = createOctokit({
    async getContent() {
      return { data: [{ type: "file", path: "docs/a.md" }] };
    },
  });

  const text = await readRepositoryFileAtRef(octokit, "lhpaul", "ronda", "docs", "abc");
  assert.equal(text, undefined);
});

test("readRepositoryFileAtRef returns undefined for truncated file responses", async () => {
  const octokit = createOctokit({
    async getContent() {
      return {
        data: {
          type: "file",
          content: Buffer.from("partial", "utf8").toString("base64"),
          truncated: true,
        },
      };
    },
  });

  const text = await readRepositoryFileAtRef(octokit, "lhpaul", "ronda", "large.md", "abc");
  assert.equal(text, undefined);
});
