import { test } from "node:test";
import assert from "node:assert/strict";
import {
  filterNamedCredentialFindings,
  isCredentialInMessageClaim,
  lineNamesCredentialWithoutValue,
} from "../../../src/review/refuted-findings.js";
import type { ChangedFile, Finding } from "../../../src/domain/review-pass.types.js";
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
    'throw new Error("No model credential is configured; see RONDA_MODEL_API_KEY.", cause);',
    'throw new Error("No model credential is configured; see RONDA_MODEL_API_KEY." + x);',
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

test("lineNamesCredentialWithoutValue: near-miss and hardcoded-value literals are kept", () => {
  for (const line of [
    'throw new Error("bad key sk-abcdef1234567890abcdef");',
    'console.log("token ghp_abcdefghijklmnop1234");',
    'throw new Error("password=hunter2222");',
    'console.error("Authorization: Bearer abcdefgh12345678");',
    'console.log("The password is hunter2");',
    'console.log("password model");',
    'console.log("password: hunter2");',
    'console.log("password: model");',
    'console.log("API key missing!");',
    'console.log("API key missing");',
    'console.error("No API token is configured.");',
    'throw new Error("Missing RONDA_MODEL_API_KEY; see docs/adoption/ronda-review-adoption.md.");',
    'throw new Error("no model credential is configured; see RONDA_MODEL_API_KEY.");',
    'throw new Error("No model credential is configured; see RONDA_MODEL_API_KEY");',
    'throw new Error("No model credential is configured; see RONDA_MODEL_API_KEY. extra");',
  ]) {
    assert.equal(lineNamesCredentialWithoutValue(line), false, line);
  }
});

test("lineNamesCredentialWithoutValue: only the enumerated Ronda templates are suppressed", () => {
  for (const line of [
    'throw new Error("No model credential is configured; see docs/adoption/ronda-review-adoption.md.");',
    "console.error('No model credential is configured; see RONDA_MODEL_API_KEY.');",
    'console.error( " No model credential is configured; see RONDA_MODEL_API_KEY. " );',
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

test("isCredentialInMessageClaim: co-occurrence, negation, and status wording are not an exposure claim", () => {
  const base = { path: "a.ts", line: 1, severity: "blocking" as const };
  for (const [title, body] of [
    ["Return 401 for missing credentials", "This error message contains no secret, but throwing here returns 500 instead of 401"],
    ["Error message handling", "The message includes the token but the status is wrong; returns 500"],
    ["Credential handling", "The error message does not leak the API key"],
    ["Token error message", "Error message mentions the token"],
  ]) {
    assert.equal(isCredentialInMessageClaim({ ...base, title, body }), false, title);
  }
});

test("filterNamedCredentialFindings: negative control - 401 status finding on a name-only message is kept", () => {
  const finding: Finding = {
    path: "src/a.ts",
    line: 1,
    severity: "blocking",
    title: "Return 401 for missing credentials",
    body: "This error message contains no secret, but throwing here returns 500 instead of 401",
  };
  const file: ChangedFile = {
    path: "src/a.ts",
    status: "modified",
    additions: 1,
    deletions: 0,
    patch: ['@@ -0,0 +1,1 @@', '+throw new Error("API key missing");'].join("\n"),
  };
  const result = filterNamedCredentialFindings([finding], [file]);
  assert.equal(result.suppressed.length, 0);
  assert.deepEqual(result.kept, [finding]);
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
