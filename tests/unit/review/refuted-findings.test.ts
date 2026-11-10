import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterNamedCredentialFindings,
  filterResolvedThreadFindings,
  isCredentialInMessageClaim,
  lineNamesCredentialWithoutValue,
  normalizeClaim,
} from "../../../src/review/refuted-findings.js";
import type { Finding } from "../../../src/domain/review-pass.types.js";
import {
  NO_CREDENTIAL_FILE,
  REAL_LEAK,
  REFUTED_VARIANTS,
} from "../../fixtures/refuted-credential-finding-158.js";

test("lineNamesCredentialWithoutValue: a fixed string naming the credential is not a leak", () => {
  assert.equal(
    lineNamesCredentialWithoutValue(
      '    throw new Error("No model credential is configured; see RONDA_MODEL_API_KEY.");',
    ),
    true,
  );
});

test("lineNamesCredentialWithoutValue: interpolation, concatenation, and value identifiers are kept", () => {
  for (const line of [
    "throw new Error(`bad key ${config.model.apiKey}`);",
    'throw new Error("bad key " + apiKey);',
    'throw new Error("bad key", apiKey);',
    'throw new Error(`bad ${x}`);',
    'throw new Error("bad key %s".format(k));',
    "throw new Error(message);",
    'throw new Error("unterminated',
  ]) {
    assert.equal(lineNamesCredentialWithoutValue(line), false, line);
  }
});

test("lineNamesCredentialWithoutValue: a log call passing a variable beside a credential-named message is kept", () => {
  for (const line of [
    'console.log("authentication failed", value);',
    'logger.error("invalid token", err);',
    'print("password rejected", pw)',
    'throw new Error("credential invalid", { cause: value });',
    'console.log("token missing", getSecret());',
  ]) {
    assert.equal(lineNamesCredentialWithoutValue(line), false, line);
  }
});

test("lineNamesCredentialWithoutValue: a hardcoded credential-looking value inside a literal is kept", () => {
  for (const line of [
    'throw new Error("bad key sk-abcdef1234567890abcdef");',
    'console.log("token ghp_abcdefghijklmnop1234");',
    'throw new Error("password=hunter2222");',
    'console.error("Authorization: Bearer abcdefgh12345678");',
    'throw new Error("secret Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5");',
    'console.log("The password is hunter2");',
    'console.log("The password is hunter");',
    'throw new Error("token is swordfish");',
    'throw new Error("the secret is correcthorsebattery");',
    'console.log("password: hunter two");',
  ]) {
    assert.equal(lineNamesCredentialWithoutValue(line), false, line);
  }
});

test("lineNamesCredentialWithoutValue: a sole fixed literal in a log call is suppressed", () => {
  assert.equal(lineNamesCredentialWithoutValue('console.error("No API token is configured.");'), true);
});

test("lineNamesCredentialWithoutValue: positively recognised credential-name-only messages are suppressed", () => {
  for (const line of [
    'console.log("API key missing");',
    'throw new Error("Authentication failed: token expired.");',
    'logger.warn("The password is not set")',
    'throw new Error("Missing RONDA_MODEL_API_KEY; see docs/adoption/ronda-review-adoption.md.");',
  ]) {
    assert.equal(lineNamesCredentialWithoutValue(line), true, line);
  }
});

test("isCredentialInMessageClaim: needs credential, exposure and message vocabulary", () => {
  const base = { path: "a.ts", line: 1, severity: "blocking" as const };
  assert.equal(
    isCredentialInMessageClaim({ ...base, title: "Model credential exposed in error message", body: "x" }),
    true,
  );
  assert.equal(isCredentialInMessageClaim({ ...base, title: "Inverted check", body: "wrong operator" }), false);
});

test("filterNamedCredentialFindings: drops every refuted variant, keeps the real leak", () => {
  const result = filterNamedCredentialFindings([...REFUTED_VARIANTS, REAL_LEAK], [NO_CREDENTIAL_FILE]);
  assert.equal(result.suppressed.length, REFUTED_VARIANTS.length);
  assert.deepEqual(result.kept, [REAL_LEAK]);
});

test("filterNamedCredentialFindings: fails open on null line, unknown file, or uncited line", () => {
  const f = REFUTED_VARIANTS[0];
  for (const variant of [{ ...f, line: null }, { ...f, path: "other.ts" }, { ...f, line: 999 }]) {
    assert.deepEqual(filterNamedCredentialFindings([variant], [NO_CREDENTIAL_FILE]).kept, [variant]);
  }
});

const resolved = [
  {
    path: "src/cli/spec-plan-experiment.ts",
    body: "**Blocking** — Model credential exposed in error message\n\nbody",
  },
];

test("filterResolvedThreadFindings: repeats on the same path are dropped regardless of line or wording drift", () => {
  const result = filterResolvedThreadFindings(REFUTED_VARIANTS, resolved);
  assert.equal(result.kept.length, 0);
  assert.equal(result.suppressed.every((s) => s.reason === "resolved_thread"), true);
});

test("filterResolvedThreadFindings: a different path or a different claim is kept; non-Ronda bodies are ignored", () => {
  const other: Finding = { ...REAL_LEAK, path: "src/other.ts" };
  const different: Finding = { ...REAL_LEAK, title: "Off-by-one in pagination loop" };
  const result = filterResolvedThreadFindings(
    [other, different],
    [...resolved, { path: "src/other.ts", body: "plain human comment" }],
  );
  assert.deepEqual(result.kept, [other, different]);
});

test("normalizeClaim: punctuation, case and backticks do not matter", () => {
  assert.equal(normalizeClaim("Model `credential` Exposed!"), "model credential exposed");
});
