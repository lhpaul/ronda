import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWebhookConfig, WebhookConfigError } from "../../../src/webhook/webhook-config.js";

test("loads webhook config from environment variables", () => {
  const config = loadWebhookConfig({
    env: {
      RONDA_WEBHOOK_SECRET: "secret",
      RONDA_GITHUB_APP_ID: "123",
      RONDA_GITHUB_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----",
      RONDA_WEBHOOK_HOST: "0.0.0.0",
      RONDA_WEBHOOK_PORT: "4321",
      RONDA_GITHUB_APP_TOKEN_TIMEOUT_MS: "12345",
      RONDA_WEBHOOK_JOB_TIMEOUT_MS: "23456",
      RONDA_WEBHOOK_JOB_SETTLEMENT_TIMEOUT_MS: "34567",
      GITHUB_API_URL: "https://github.example/api/v3",
      RONDA_DETAILS_URL: "https://ronda.local/runs",
    },
  });

  assert.equal(config.webhookSecret, "secret");
  assert.equal(config.githubAppId, "123");
  assert.equal(config.githubPrivateKey, "-----BEGIN PRIVATE KEY-----\\nkey\\n-----END PRIVATE KEY-----");
  assert.equal(config.host, "0.0.0.0");
  assert.equal(config.port, 4321);
  assert.equal(config.githubAppTokenTimeoutMs, 12345);
  assert.equal(config.webhookJobTimeoutMs, 23456);
  assert.equal(config.webhookJobSettlementTimeoutMs, 34567);
  assert.equal(config.githubApiUrl, "https://github.example/api/v3");
  assert.equal(config.detailsUrl, "https://ronda.local/runs");
});

test("loads webhook private key from a file when the inline key is absent", () => {
  const config = loadWebhookConfig({
    env: {
      RONDA_WEBHOOK_SECRET: "secret",
      RONDA_GITHUB_APP_ID: "123",
      RONDA_GITHUB_PRIVATE_KEY_FILE: "/tmp/ronda.pem",
    },
    fileExists: (path) => path === "/tmp/ronda.pem",
    readFile: () => "file-private-key",
  });

  assert.equal(config.githubPrivateKey, "file-private-key");
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 3000);
  assert.equal(config.githubAppTokenTimeoutMs, 60_000);
  assert.equal(config.webhookJobTimeoutMs, 900_000);
  assert.equal(config.webhookJobSettlementTimeoutMs, 30_000);
});

test("throws a sanitized config error when required webhook config is missing", () => {
  assert.throws(
    () => loadWebhookConfig({ env: {} }),
    (error: unknown) => {
      assert.ok(error instanceof WebhookConfigError);
      assert.match(error.message, /RONDA_WEBHOOK_SECRET/);
      return true;
    },
  );
});
