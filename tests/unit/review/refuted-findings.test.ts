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
