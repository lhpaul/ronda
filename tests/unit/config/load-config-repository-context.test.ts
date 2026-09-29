import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES,
  DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS,
  DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
  loadConfig,
} from "../../../src/config/load-config.js";

// Scenario 4 (Testing Strategy): repository-context switch resolution — the
// same first-non-blank-source discipline the #105 sweep switch established.

test("repository context: default constants (#106, D3)", () => {
  assert.equal(DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES, 12);
  assert.equal(DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS, 24_000);
  assert.equal(DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS, 120_000);
});

test("repository context: no environment and no config file resolves off with no raw value", () => {
  const config = loadConfig({ env: {}, fileExists: () => false });
  assert.equal(config.repositoryContextMode, "off");
  assert.equal(config.repositoryContextModeRaw, undefined);
  assert.equal(config.maxRepositoryContextCandidates, DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES);
  assert.equal(config.maxRepositoryContextChars, DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS);
  assert.equal(config.repositoryContextTimeBudgetMs, DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS);
  assert.deepEqual(config.repositoryContextBudgetFallbacks, []);
});

test("repository context: recognized on values enable it with no raw value", () => {
  for (const value of ["on", "1", "TRUE", " On "]) {
    const config = loadConfig({ env: { RONDA_REPOSITORY_CONTEXT: value }, fileExists: () => false });
    assert.equal(config.repositoryContextMode, "on", `expected ${JSON.stringify(value)} to enable`);
    assert.equal(config.repositoryContextModeRaw, undefined);
  }
});

test("repository context: recognized off values and default disable with no raw value", () => {
  for (const value of ["off", "0", "false", "default", "OFF"]) {
    const config = loadConfig({ env: { RONDA_REPOSITORY_CONTEXT: value }, fileExists: () => false });
    assert.equal(config.repositoryContextMode, "off", `expected ${JSON.stringify(value)} to disable`);
    assert.equal(config.repositoryContextModeRaw, undefined, `${value} is recognized, not carried`);
  }
});

test("repository context: whitespace-only value is blank — deferred to the config file", () => {
  const config = loadConfig({
    env: { RONDA_REPOSITORY_CONTEXT: "   " },
    fileExists: () => true,
    readFile: () => JSON.stringify({ repositoryContext: "on" }),
  });
  assert.equal(config.repositoryContextMode, "on");
  assert.equal(config.repositoryContextModeRaw, undefined);
});

test("repository context: unrecognized value disables and carries the raw text", () => {
  const config = loadConfig({ env: { RONDA_REPOSITORY_CONTEXT: "banana" }, fileExists: () => false });
  assert.equal(config.repositoryContextMode, "off");
  assert.equal(config.repositoryContextModeRaw, "banana");
});

test("repository context: an unrecognized higher-precedence value is not deferred to the file", () => {
  const config = loadConfig({
    env: { RONDA_REPOSITORY_CONTEXT: "banana" },
    fileExists: () => true,
    readFile: () => JSON.stringify({ repositoryContext: "on" }),
  });
  assert.equal(config.repositoryContextMode, "off");
  assert.equal(config.repositoryContextModeRaw, "banana");
});

// Scenario 5: the three budgets fail towards the recorded default, never
// towards unbounded.

test("repository context budgets: environment values override the config file", () => {
  const config = loadConfig({
    env: {
      RONDA_MAX_REPOSITORY_CONTEXT_CANDIDATES: "5",
      RONDA_MAX_REPOSITORY_CONTEXT_CHARS: "1000",
      RONDA_REPOSITORY_CONTEXT_TIME_BUDGET_MS: "9000",
    },
    fileExists: () => false,
  });
  assert.equal(config.maxRepositoryContextCandidates, 5);
  assert.equal(config.maxRepositoryContextChars, 1000);
  assert.equal(config.repositoryContextTimeBudgetMs, 9000);
  assert.deepEqual(config.repositoryContextBudgetFallbacks, []);
});

test("repository context budgets: a blank environment value defers to the config file", () => {
  const config = loadConfig({
    env: { RONDA_MAX_REPOSITORY_CONTEXT_CANDIDATES: "  " },
    fileExists: () => true,
    readFile: () => JSON.stringify({ maxRepositoryContextCandidates: 7 }),
  });
  assert.equal(config.maxRepositoryContextCandidates, 7);
  assert.deepEqual(config.repositoryContextBudgetFallbacks, []);
});

test("repository context budgets: a non-numeric value falls back to the default and is recorded", () => {
  const config = loadConfig({
    env: { RONDA_MAX_REPOSITORY_CONTEXT_CHARS: "many" },
    fileExists: () => false,
  });
  assert.equal(config.maxRepositoryContextChars, DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS);
  assert.deepEqual(config.repositoryContextBudgetFallbacks, ["chars"]);
});

test("repository context budgets: a non-positive value falls back to the default and is recorded", () => {
  const config = loadConfig({
    env: { RONDA_REPOSITORY_CONTEXT_TIME_BUDGET_MS: "0" },
    fileExists: () => false,
  });
  assert.equal(config.repositoryContextTimeBudgetMs, DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS);
  assert.deepEqual(config.repositoryContextBudgetFallbacks, ["time"]);
});

test("repository context budgets: an unusable higher-precedence value is not deferred to the file", () => {
  const config = loadConfig({
    env: { RONDA_MAX_REPOSITORY_CONTEXT_CANDIDATES: "-1" },
    fileExists: () => true,
    readFile: () => JSON.stringify({ maxRepositoryContextCandidates: 9 }),
  });
  assert.equal(config.maxRepositoryContextCandidates, DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES);
  assert.deepEqual(config.repositoryContextBudgetFallbacks, ["candidates"]);
});

test("repository context budgets: multiple unusable values are all recorded", () => {
  const config = loadConfig({
    env: {
      RONDA_MAX_REPOSITORY_CONTEXT_CANDIDATES: "nope",
      RONDA_MAX_REPOSITORY_CONTEXT_CHARS: "nope",
      RONDA_REPOSITORY_CONTEXT_TIME_BUDGET_MS: "nope",
    },
    fileExists: () => false,
  });
  assert.deepEqual(config.repositoryContextBudgetFallbacks, ["candidates", "chars", "time"]);
});

test("repository context budgets: a numeric config-file value is accepted directly", () => {
  const config = loadConfig({
    env: {},
    fileExists: () => true,
    readFile: () =>
      JSON.stringify({
        maxRepositoryContextCandidates: 3,
        maxRepositoryContextChars: 500,
        repositoryContextTimeBudgetMs: 4000,
      }),
  });
  assert.equal(config.maxRepositoryContextCandidates, 3);
  assert.equal(config.maxRepositoryContextChars, 500);
  assert.equal(config.repositoryContextTimeBudgetMs, 4000);
  assert.deepEqual(config.repositoryContextBudgetFallbacks, []);
});
