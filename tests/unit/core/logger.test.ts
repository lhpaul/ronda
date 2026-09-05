import { test } from "node:test";
import assert from "node:assert/strict";
import { createLogger } from "../../../src/core/logger.js";

test("redacts a value equal to a supplied secret, anywhere in the fields object", () => {
  const lines: string[] = [];
  const logger = createLogger(["super-secret-key"], (line) => lines.push(line));
  logger.event("pass_started", { headers: { note: "super-secret-key" }, other: "fine" });
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.headers.note, "[REDACTED]");
  assert.equal(parsed.other, "fine");
});

test("redacts any field literally named authorization regardless of value", () => {
  const lines: string[] = [];
  const logger = createLogger([], (line) => lines.push(line));
  logger.event("pass_started", { authorization: "Bearer abc123" });
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.authorization, "[REDACTED]");
});

test("ignores blank or undefined redact values instead of matching every empty string", () => {
  const lines: string[] = [];
  const logger = createLogger([undefined, ""], (line) => lines.push(line));
  logger.event("pass_started", { note: "" });
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.note, "");
});

test("emits the event name and a timestamp on every line", () => {
  const lines: string[] = [];
  const logger = createLogger([], (line) => lines.push(line));
  logger.event("pass_succeeded", { headSha: "abc" });
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.event, "pass_succeeded");
  assert.equal(typeof parsed.timestamp, "string");
  assert.equal(parsed.headSha, "abc");
});
