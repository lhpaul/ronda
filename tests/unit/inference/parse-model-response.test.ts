import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  MAX_FINDING_BODY_CHARS,
  UnusableModelOutputError,
  parseModelResponse,
} from "../../../src/inference/parse-model-response.js";
import type { ChangedFile } from "../../../src/domain/review-pass.types.js";

function fixture(name: string): string {
  const path = fileURLToPath(new URL(`../../fixtures/${name}`, import.meta.url));
  return readFileSync(path, "utf8");
}

const changedFiles: ChangedFile[] = [
  { path: "src/example.ts", status: "modified", additions: 3, deletions: 1 },
];

test("M1: a bare JSON object is parsed", () => {
  const result = parseModelResponse(
    '{"findings":[{"path":"src/example.ts","line":1,"severity":"nit","title":"t","body":"b"}]}',
    changedFiles,
  );
  assert.equal(result.findings.length, 1);
});

test("M2: JSON inside a fence tagged json is parsed", () => {
  const result = parseModelResponse(fixture("model-response-fenced.txt"), changedFiles);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].path, "src/example.ts");
  assert.equal(result.findings[0].line, 42);
});

test("M3: JSON inside an untagged fence is parsed", () => {
  const raw = "```\n" + fixture("model-response-bare.json") + "```";
  const result = parseModelResponse(raw, changedFiles);
  assert.equal(result.findings.length, 1);
});

test("M4: prose before and after the fence is discarded", () => {
  const raw = `Some intro prose.\n\n${fixture("model-response-fenced.txt")}\n\nSome closing prose.`;
  const result = parseModelResponse(raw, changedFiles);
  assert.equal(result.findings.length, 1);
});

test("M5: the first fenced block that parses to a findings container wins", () => {
  const raw = [
    "```json",
    "not valid json",
    "```",
    "```json",
    '{"findings":[{"path":"src/example.ts","body":"second block"}]}',
    "```",
  ].join("\n");
  const result = parseModelResponse(raw, changedFiles);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].body, "second block");
});

test("M6: a closing fence longer than the opening fence is parsed (CommonMark-permitted)", () => {
  const raw = '```json\n{"findings":[{"path":"src/example.ts","body":"b"}]}\n````';
  const result = parseModelResponse(raw, changedFiles);
  assert.equal(result.findings.length, 1);
});

test("M7: an empty or whitespace-only response is unusable_output", () => {
  assert.throws(() => parseModelResponse("   \n  ", changedFiles), UnusableModelOutputError);
});

test("M8: valid JSON that is not an object is unusable_output", () => {
  assert.throws(() => parseModelResponse("42", changedFiles), UnusableModelOutputError);
  assert.throws(() => parseModelResponse('"hello"', changedFiles), UnusableModelOutputError);
  assert.throws(() => parseModelResponse("[1,2,3]", changedFiles), UnusableModelOutputError);
});

test("M9: an object with no findings key is unusable_output", () => {
  assert.throws(() => parseModelResponse('{"ok":true}', changedFiles), UnusableModelOutputError);
});

test("M10: an empty findings array succeeds with zero findings", () => {
  const result = parseModelResponse(fixture("model-response-empty.json"), changedFiles);
  assert.deepEqual(result.findings, []);
});

test("M11: a finding missing path or body is rejected and counted as malformed", () => {
  const result = parseModelResponse(
    JSON.stringify({
      findings: [
        { path: "src/example.ts" },
        { body: "no path here" },
        { path: "src/example.ts", body: "valid" },
      ],
    }),
    changedFiles,
  );
  assert.equal(result.findings.length, 1);
  assert.equal(result.malformedCount, 2);
});

test("M12: severity is matched case-insensitively or coerced to nit", () => {
  const result = parseModelResponse(
    JSON.stringify({
      findings: [
        { path: "src/example.ts", body: "a", severity: "BLOCKING" },
        { path: "src/example.ts", body: "b", severity: "Nit" },
        { path: "src/example.ts", body: "c", severity: "major" },
      ],
    }),
    changedFiles,
  );
  assert.equal(result.findings[0].severity, "blocking");
  assert.equal(result.findings[1].severity, "nit");
  assert.equal(result.findings[2].severity, "nit");
  assert.equal(result.coercedSeverityCount, 1);
});

test("M13: a line given as a numeric string is parsed with radix 10", () => {
  const result = parseModelResponse(
    JSON.stringify({ findings: [{ path: "src/example.ts", body: "b", line: "42" }] }),
    changedFiles,
  );
  assert.equal(result.findings[0].line, 42);
});

test("M14: a null, absent, zero, or negative line is treated as unmapped", () => {
  const result = parseModelResponse(
    JSON.stringify({
      findings: [
        { path: "src/example.ts", body: "a", line: null },
        { path: "src/example.ts", body: "b" },
        { path: "src/example.ts", body: "c", line: 0 },
        { path: "src/example.ts", body: "d", line: -3 },
      ],
    }),
    changedFiles,
  );
  for (const finding of result.findings) {
    assert.equal(finding.line, null);
  }
});

test("M15: a path with a leading ./, a/, or / is normalised and matched", () => {
  const result = parseModelResponse(
    JSON.stringify({
      findings: [
        { path: "./src/example.ts", body: "a", line: 1 },
        { path: "a/src/example.ts", body: "b", line: 1 },
        { path: "/src/example.ts", body: "c", line: 1 },
      ],
    }),
    [{ path: "src/example.ts", status: "modified", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+x" }],
  );
  for (const finding of result.findings) {
    assert.equal(finding.path, "src/example.ts");
    assert.equal(finding.line, 1);
  }
});

test("M16: a path that matches no changed file is unmapped", () => {
  const result = parseModelResponse(
    JSON.stringify({ findings: [{ path: "src/unknown.ts", body: "a", line: 1 }] }),
    changedFiles,
  );
  assert.equal(result.findings[0].line, null);
});

test("M17: invalid JSON (trailing comma, single-quoted keys) is unusable_output", () => {
  assert.throws(
    () => parseModelResponse('{"findings":[{"path":"x",},]}', changedFiles),
    UnusableModelOutputError,
  );
  assert.throws(
    () => parseModelResponse("{'findings': []}", changedFiles),
    UnusableModelOutputError,
  );
});

test("M18: two identical findings are deduplicated and counted", () => {
  const result = parseModelResponse(
    JSON.stringify({
      findings: [
        { path: "src/example.ts", body: "same", line: 1 },
        { path: "src/example.ts", body: "same", line: 1 },
      ],
    }),
    changedFiles,
  );
  assert.equal(result.findings.length, 1);
  assert.equal(result.duplicateCount, 1);
});

test("M19: a body longer than MAX_FINDING_BODY_CHARS is truncated with a visible marker", () => {
  const longBody = "x".repeat(MAX_FINDING_BODY_CHARS + 500);
  const result = parseModelResponse(
    JSON.stringify({ findings: [{ path: "src/example.ts", body: longBody }] }),
    changedFiles,
  );
  assert.equal(result.findings[0].body.length, MAX_FINDING_BODY_CHARS);
  assert.ok(result.findings[0].body.endsWith("[truncated]"));
});
