import { createHmac } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyGithubSignature } from "../../../src/webhook/signature.js";

test("validates the GitHub sha256 webhook signature against the raw body", () => {
  const body = Buffer.from('{"ok":true}', "utf8");
  const secret = "webhook-secret";
  const digest = createHmac("sha256", secret).update(body).digest("hex");

  assert.equal(
    verifyGithubSignature({
      body,
      secret,
      signatureHeader: `sha256=${digest}`,
    }),
    true,
  );
});

test("rejects missing, malformed, or wrong signatures", () => {
  const body = Buffer.from("{}", "utf8");
  const secret = "webhook-secret";

  assert.equal(verifyGithubSignature({ body, secret, signatureHeader: undefined }), false);
  assert.equal(verifyGithubSignature({ body, secret, signatureHeader: "sha1=abc" }), false);
  assert.equal(verifyGithubSignature({ body, secret, signatureHeader: "sha256=abc" }), false);
  assert.equal(
    verifyGithubSignature({
      body,
      secret,
      signatureHeader: `sha256=${"0".repeat(64)}`,
    }),
    false,
  );
});

