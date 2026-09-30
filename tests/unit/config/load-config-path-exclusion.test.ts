import { test } from "node:test";
import assert from "node:assert/strict";
import { ConfigLoadError, loadConfig } from "../../../src/config/load-config.js";

// #134: repository-configured review path-exclusion globs. Same
// first-non-blank-source, never-merged precedence discipline as every other
// setting in `RondaConfig` — see `load-config-repository-context.test.ts`.

test("path exclusion: no environment and no config file resolves an empty list", () => {
  const config = loadConfig({ env: {}, fileExists: () => false });
  assert.deepEqual(config.excludePathGlobs, []);
});

test("path exclusion: an environment comma-separated list is parsed and trimmed", () => {
  const config = loadConfig({
    env: { RONDA_EXCLUDE_PATH_GLOBS: " docs/testing/ronda/**/*.json , tests/fixtures/recall-benchmark/** " },
    fileExists: () => false,
  });
  assert.deepEqual(config.excludePathGlobs, [
    "docs/testing/ronda/**/*.json",
    "tests/fixtures/recall-benchmark/**",
  ]);
});

test("path exclusion: a newline-separated environment list is also accepted", () => {
  const config = loadConfig({
    env: { RONDA_EXCLUDE_PATH_GLOBS: "a/**\nb/**\n" },
    fileExists: () => false,
  });
  assert.deepEqual(config.excludePathGlobs, ["a/**", "b/**"]);
});

test("path exclusion: the config file accepts a JSON array", () => {
  const config = loadConfig({
    env: {},
    fileExists: () => true,
    readFile: () => JSON.stringify({ excludePathGlobs: ["docs/testing/ronda/**/*.json"] }),
  });
  assert.deepEqual(config.excludePathGlobs, ["docs/testing/ronda/**/*.json"]);
});

test("path exclusion: the config file accepts a comma-separated string", () => {
  const config = loadConfig({
    env: {},
    fileExists: () => true,
    readFile: () => JSON.stringify({ excludePathGlobs: "a/**,b/**" }),
  });
  assert.deepEqual(config.excludePathGlobs, ["a/**", "b/**"]);
});

test("path exclusion: a non-blank environment value takes precedence over the config file", () => {
  const config = loadConfig({
    env: { RONDA_EXCLUDE_PATH_GLOBS: "env-only/**" },
    fileExists: () => true,
    readFile: () => JSON.stringify({ excludePathGlobs: ["file-only/**"] }),
  });
  assert.deepEqual(config.excludePathGlobs, ["env-only/**"]);
});

test("path exclusion: a blank environment value defers to the config file", () => {
  const config = loadConfig({
    env: { RONDA_EXCLUDE_PATH_GLOBS: "   " },
    fileExists: () => true,
    readFile: () => JSON.stringify({ excludePathGlobs: ["file-only/**"] }),
  });
  assert.deepEqual(config.excludePathGlobs, ["file-only/**"]);
});

test("path exclusion: a blank config-file array entry list resolves to empty, not an error", () => {
  const config = loadConfig({
    env: {},
    fileExists: () => true,
    readFile: () => JSON.stringify({ excludePathGlobs: [] }),
  });
  assert.deepEqual(config.excludePathGlobs, []);
});

for (const [label, value] of [
  ["a number", 42],
  ["an object", { glob: "a/**" }],
  ["a boolean", true],
] as const) {
  test(`path exclusion: a config-file excludePathGlobs that is ${label} fails loudly instead of silently disabling exclusions`, () => {
    assert.throws(
      () =>
        loadConfig({
          env: {},
          fileExists: () => true,
          readFile: () => JSON.stringify({ excludePathGlobs: value }),
        }),
      (error: unknown) =>
        error instanceof ConfigLoadError &&
        error.cause instanceof TypeError &&
        /excludePathGlobs must be a string or an array of strings/.test(error.cause.message),
    );
  });
}

test("path exclusion: a usable environment override is honored even when the config file value is invalid", () => {
  const config = loadConfig({
    env: { RONDA_EXCLUDE_PATH_GLOBS: "env-only/**" },
    fileExists: () => true,
    readFile: () => JSON.stringify({ excludePathGlobs: 42 }),
  });
  assert.deepEqual(config.excludePathGlobs, ["env-only/**"]);
});

test("path exclusion: a blank environment value does not shield an invalid config file value", () => {
  assert.throws(
    () =>
      loadConfig({
        env: { RONDA_EXCLUDE_PATH_GLOBS: "   " },
        fileExists: () => true,
        readFile: () => JSON.stringify({ excludePathGlobs: 42 }),
      }),
    ConfigLoadError,
  );
});
