import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ConfigLoadError,
  DEFAULT_MAX_PATCH_CHARS,
  DEFAULT_MODEL_BASE_URL,
  DEFAULT_MODEL_NAME,
  DEFAULT_PASS_TIMEOUT_MS,
  loadConfig,
} from "../../../src/config/load-config.js";

test("default constant values: ten-minute pass budget and the other v0 defaults", () => {
  assert.equal(DEFAULT_PASS_TIMEOUT_MS, 600_000);
  assert.equal(DEFAULT_MODEL_BASE_URL, "https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
  assert.equal(DEFAULT_MODEL_NAME, "qwen-plus");
  assert.equal(DEFAULT_MAX_PATCH_CHARS, 400_000);
});

test("no environment and no config file: apiKey is blank and defaults apply", () => {
  const config = loadConfig({
    env: {},
    fileExists: () => false,
  });
  assert.equal(config.model.apiKey, "");
  assert.equal(config.model.baseUrl, DEFAULT_MODEL_BASE_URL);
  assert.equal(config.model.modelName, DEFAULT_MODEL_NAME);
  assert.equal(config.passTimeoutMs, DEFAULT_PASS_TIMEOUT_MS);
  assert.equal(config.maxPatchChars, DEFAULT_MAX_PATCH_CHARS);
});

test("missing config file is not an error", () => {
  assert.doesNotThrow(() => loadConfig({ env: {}, fileExists: () => false }));
});

test("config file supplies values when environment does not", () => {
  const fileConfig = {
    modelApiKey: "file-key",
    modelBaseUrl: "https://example.test/v1",
    modelName: "file-model",
    passTimeoutMs: 120_000,
    maxPatchChars: 10_000,
  };
  const config = loadConfig({
    env: {},
    fileExists: () => true,
    readFile: () => JSON.stringify(fileConfig),
  });
  assert.equal(config.model.apiKey, "file-key");
  assert.equal(config.model.baseUrl, "https://example.test/v1");
  assert.equal(config.model.modelName, "file-model");
  assert.equal(config.passTimeoutMs, 120_000);
  assert.equal(config.maxPatchChars, 10_000);
});

test("environment variables take precedence over the config file", () => {
  const config = loadConfig({
    env: {
      RONDA_MODEL_API_KEY: "env-key",
      RONDA_MODEL_BASE_URL: "https://env.test/v1",
      RONDA_MODEL_NAME: "env-model",
      RONDA_PASS_TIMEOUT_MS: "5000",
      RONDA_MAX_PATCH_CHARS: "9000",
    },
    fileExists: () => true,
    readFile: () =>
      JSON.stringify({
        modelApiKey: "file-key",
        modelBaseUrl: "https://file.test/v1",
        modelName: "file-model",
        passTimeoutMs: 120_000,
        maxPatchChars: 10_000,
      }),
  });
  assert.equal(config.model.apiKey, "env-key");
  assert.equal(config.model.baseUrl, "https://env.test/v1");
  assert.equal(config.model.modelName, "env-model");
  assert.equal(config.passTimeoutMs, 5000);
  assert.equal(config.maxPatchChars, 9000);
});

test("an unreadable config file throws ConfigLoadError naming the path", () => {
  assert.throws(
    () =>
      loadConfig({
        env: { RONDA_CONFIG_FILE: "/tmp/does-not-matter/config.json" },
        fileExists: () => true,
        readFile: () => {
          throw new Error("EACCES: permission denied");
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigLoadError);
      assert.equal(error.path, "/tmp/does-not-matter/config.json");
      assert.ok(!error.message.includes("permission denied"));
      return true;
    },
  );
});

test("a malformed config file throws ConfigLoadError naming the path, never the contents", () => {
  assert.throws(
    () =>
      loadConfig({
        env: { RONDA_CONFIG_FILE: "/tmp/ronda-config.json" },
        fileExists: () => true,
        readFile: () => "{ not valid json, super-secret-value",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ConfigLoadError);
      assert.equal(error.path, "/tmp/ronda-config.json");
      assert.ok(!error.message.includes("super-secret-value"));
      return true;
    },
  );
});
