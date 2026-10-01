import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  DurabilityModeSetting,
  RepositoryContextBudgetName,
  RepositoryContextModeSetting,
  RondaConfig,
  SweepModeSetting,
} from "./config.types.js";

/** Ten minutes, per the constitution's "timeout in minutes, not hours" rule. */
export const DEFAULT_PASS_TIMEOUT_MS = 600_000;
/** Vendor-published DashScope international endpoint — not operator-specific. */
export const DEFAULT_MODEL_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
export const DEFAULT_MODEL_NAME = "qwen-plus";
export const DEFAULT_MAX_PATCH_CHARS = 400_000;
export const DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT = 4;
export const DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS = 120_000;
/** #106, plan decision D3. */
export const DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES = 12;
export const DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS = 24_000;
export const DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS = 120_000;

/**
 * Thrown when the operator config file exists but cannot be read or parsed.
 * The message names only the file path, never its contents, so a credential
 * accidentally left in a malformed file is never echoed into logs or a
 * published check run.
 */
export class ConfigLoadError extends Error {
  readonly path: string;
  /**
   * Fixed, safe text for published surfaces. The underlying cause can carry
   * local paths or operator-supplied values, so callers publish this instead
   * of the cause. Defaults to the config-file message; a failure that comes
   * from an environment variable supplies its own.
   */
  readonly publicMessage: string;

  constructor(path: string, cause: unknown, publicMessage?: string) {
    super(`Failed to load Ronda config file at ${path}`);
    this.name = "ConfigLoadError";
    this.path = path;
    this.cause = cause;
    this.publicMessage = publicMessage ?? `Failed to load Ronda config file at ${path}`;
  }
}

interface OperatorConfigFile {
  modelApiKey?: string;
  modelBaseUrl?: string;
  modelName?: string;
  passTimeoutMs?: number | string;
  maxPatchChars?: number | string;
  maxAuthoritativeDocCount?: number | string;
  maxAuthoritativeDocChars?: number | string;
  durabilityMode?: string;
  durabilityModeDefault?: boolean | string;
  sweepMode?: string;
  repositoryContext?: string;
  maxRepositoryContextCandidates?: number | string;
  maxRepositoryContextChars?: number | string;
  repositoryContextTimeBudgetMs?: number | string;
  excludePathGlobs?: string | string[];
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
}

/**
 * Resolves Ronda's configuration in descending precedence: process
 * environment, then the operator config file (`RONDA_CONFIG_FILE` or
 * `~/.config/ronda/config.json`), then built-in defaults. A missing file is
 * not an error — secrets simply have no default. An unreadable or malformed
 * file throws {@link ConfigLoadError}.
 */
export function loadConfig(options: LoadConfigOptions = {}): RondaConfig {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const fileExists = options.fileExists ?? existsSync;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));

  const configPath =
    nonBlank(env.RONDA_CONFIG_FILE) ?? join(home, ".config", "ronda", "config.json");

  let fileConfig: OperatorConfigFile = {};
  if (fileExists(configPath)) {
    let raw: string;
    try {
      raw = readFile(configPath);
    } catch (error) {
      throw new ConfigLoadError(configPath, error);
    }
    try {
      fileConfig = JSON.parse(raw) as OperatorConfigFile;
    } catch (error) {
      throw new ConfigLoadError(configPath, error);
    }
  }

  const apiKey =
    nonBlank(env.RONDA_MODEL_API_KEY) ?? nonBlank(fileConfig.modelApiKey) ?? "";
  const baseUrl =
    nonBlank(env.RONDA_MODEL_BASE_URL) ??
    nonBlank(fileConfig.modelBaseUrl) ??
    DEFAULT_MODEL_BASE_URL;
  const modelName =
    nonBlank(env.RONDA_MODEL_NAME) ?? nonBlank(fileConfig.modelName) ?? DEFAULT_MODEL_NAME;
  const passTimeoutMs =
    positiveInt(env.RONDA_PASS_TIMEOUT_MS) ??
    positiveInt(fileConfig.passTimeoutMs) ??
    DEFAULT_PASS_TIMEOUT_MS;
  const maxPatchChars =
    positiveInt(env.RONDA_MAX_PATCH_CHARS) ??
    positiveInt(fileConfig.maxPatchChars) ??
    DEFAULT_MAX_PATCH_CHARS;
  const maxAuthoritativeDocCount =
    positiveInt(env.RONDA_MAX_AUTHORITATIVE_DOC_COUNT) ??
    positiveInt(fileConfig.maxAuthoritativeDocCount) ??
    DEFAULT_MAX_AUTHORITATIVE_DOC_COUNT;
  const maxAuthoritativeDocChars =
    positiveInt(env.RONDA_MAX_AUTHORITATIVE_DOC_CHARS) ??
    positiveInt(fileConfig.maxAuthoritativeDocChars) ??
    DEFAULT_MAX_AUTHORITATIVE_DOC_CHARS;
  const durabilityMode =
    parseDurabilityMode(env.RONDA_DURABILITY_MODE) ??
    parseDurabilityMode(fileConfig.durabilityMode) ??
    "default";
  const durabilityModeDefault =
    parseBooleanFlag(env.RONDA_DURABILITY_MODE_DEFAULT) ??
    parseBooleanFlag(fileConfig.durabilityModeDefault) ??
    false;
  // Sweep enablement resolves from the first non-blank source only. Deliberately
  // not an `??` chain over `parseSweepMode`: an unrecognized non-empty value must
  // be carried as unrecognized, not silently deferred to a lower-precedence
  // source that would happen to parse (AC18).
  const sweepSource = nonBlank(env.RONDA_SWEEP_MODE) ?? nonBlank(fileConfig.sweepMode);
  const parsedSweepMode = parseSweepMode(sweepSource);
  const sweepMode = parsedSweepMode ?? "off";
  const sweepModeRaw = sweepSource !== undefined && parsedSweepMode === undefined ? sweepSource : undefined;

  // Repository context enablement (#106, AC21) resolves the same way: the
  // first non-blank source only, never an `??` chain over the parser, so an
  // unrecognized non-empty value is carried as unrecognized rather than
  // silently deferred to a lower-precedence source that would happen to parse.
  const repositoryContextSource =
    nonBlank(env.RONDA_REPOSITORY_CONTEXT) ?? nonBlank(fileConfig.repositoryContext);
  const parsedRepositoryContextMode = parseRepositoryContextMode(repositoryContextSource);
  const repositoryContextMode = parsedRepositoryContextMode ?? "off";
  const repositoryContextModeRaw =
    repositoryContextSource !== undefined && parsedRepositoryContextMode === undefined
      ? repositoryContextSource
      : undefined;

  const repositoryContextBudgetFallbacks: RepositoryContextBudgetName[] = [];
  const maxRepositoryContextCandidates = resolveRepositoryContextBudget(
    "candidates",
    env.RONDA_MAX_REPOSITORY_CONTEXT_CANDIDATES,
    fileConfig.maxRepositoryContextCandidates,
    DEFAULT_MAX_REPOSITORY_CONTEXT_CANDIDATES,
    repositoryContextBudgetFallbacks,
  );
  const maxRepositoryContextChars = resolveRepositoryContextBudget(
    "chars",
    env.RONDA_MAX_REPOSITORY_CONTEXT_CHARS,
    fileConfig.maxRepositoryContextChars,
    DEFAULT_MAX_REPOSITORY_CONTEXT_CHARS,
    repositoryContextBudgetFallbacks,
  );
  const repositoryContextTimeBudgetMs = resolveRepositoryContextBudget(
    "time",
    env.RONDA_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
    fileConfig.repositoryContextTimeBudgetMs,
    DEFAULT_REPOSITORY_CONTEXT_TIME_BUDGET_MS,
    repositoryContextBudgetFallbacks,
  );

  // Validate the config-file excludePathGlobs shape before parsing (#134): only
  // a string or an array of strings is meaningful. Any other non-null value
  // would otherwise be treated as absent and silently disable the requested
  // exclusions, sending excluded content to the model.
  // The environment wins outright over the file, so the file value is only
  // validated when no usable environment override was selected.
  const envExcludePathGlobs = parseGlobList(env.RONDA_EXCLUDE_PATH_GLOBS);
  const rawExcludePathGlobs: unknown = fileConfig.excludePathGlobs;
  if (envExcludePathGlobs === undefined && rawExcludePathGlobs !== undefined && rawExcludePathGlobs !== null) {
    if (Array.isArray(rawExcludePathGlobs)) {
      const invalidIndex = rawExcludePathGlobs.findIndex((entry) => typeof entry !== "string");
      if (invalidIndex !== -1) {
        const invalidEntry: unknown = rawExcludePathGlobs[invalidIndex];
        throw new ConfigLoadError(
          configPath,
          new TypeError(
            `excludePathGlobs array contains non-string entry: ${JSON.stringify(invalidEntry)}`,
          ),
        );
      }
    } else if (typeof rawExcludePathGlobs !== "string") {
      throw new ConfigLoadError(
        configPath,
        new TypeError(
          `excludePathGlobs must be a string or an array of strings, got ${JSON.stringify(rawExcludePathGlobs)}`,
        ),
      );
    }
  }

  const excludePathGlobs = envExcludePathGlobs ?? parseGlobList(fileConfig.excludePathGlobs) ?? [];
  // The matcher supports only `**`, `*` and `?`. Bracket and brace syntax would
  // be treated as literal filename characters, so a pattern like
  // `generated/**/*.[jt]s` would silently fail open and send matching files to
  // the model; reject it instead.
  const unsupportedGlob = excludePathGlobs.find((glob) => /[[\]{}]/.test(glob));
  if (unsupportedGlob !== undefined) {
    const fromEnvironment = envExcludePathGlobs !== undefined;
    throw new ConfigLoadError(
      configPath,
      new TypeError(
        `excludePathGlobs contains unsupported glob syntax (only **, * and ? are supported): ${JSON.stringify(unsupportedGlob)}`,
      ),
      fromEnvironment
        ? "Invalid Ronda configuration: RONDA_EXCLUDE_PATH_GLOBS contains unsupported glob syntax (only **, * and ? are supported)"
        : undefined,
    );
  }

  return {
    model: { apiKey, baseUrl, modelName },
    passTimeoutMs,
    maxPatchChars,
    maxAuthoritativeDocCount,
    maxAuthoritativeDocChars,
    durabilityMode,
    durabilityModeDefault,
    sweepMode,
    sweepModeRaw,
    repositoryContextMode,
    repositoryContextModeRaw,
    maxRepositoryContextCandidates,
    maxRepositoryContextChars,
    repositoryContextTimeBudgetMs,
    repositoryContextBudgetFallbacks,
    excludePathGlobs,
  };
}

function nonBlank(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function positiveInt(value: string | number | undefined | null): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const parsed = typeof value === "number" ? value : parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseDurabilityMode(value: string | undefined | null): DurabilityModeSetting | undefined {
  const raw = nonBlank(value)?.toLowerCase();
  if (raw === "on" || raw === "1" || raw === "true") {
    return "on";
  }
  if (raw === "off" || raw === "0" || raw === "false") {
    return "off";
  }
  if (raw === "default") {
    return "default";
  }
  return undefined;
}

/**
 * Recognizes the sweep's enablement vocabulary. `default` means off and is
 * recognized (its raw text is not carried). Any other non-blank value is
 * unrecognized: the caller resolves it to `off` and carries its raw text for
 * the degraded record, never deferring it to another source (AC18).
 */
function parseSweepMode(value: string | undefined | null): SweepModeSetting | undefined {
  const raw = nonBlank(value)?.toLowerCase();
  if (raw === "on" || raw === "1" || raw === "true") {
    return "on";
  }
  if (raw === "off" || raw === "0" || raw === "false" || raw === "default") {
    return "off";
  }
  return undefined;
}

/**
 * Recognizes the repository-context enablement vocabulary (#106, AC21) —
 * identical to {@link parseSweepMode}'s. `default` means off and is
 * recognized (its raw text is not carried). Any other non-blank value is
 * unrecognized: the caller resolves it to `off` and carries its raw text for
 * the degraded record, never deferring it to another source.
 */
function parseRepositoryContextMode(
  value: string | undefined | null,
): RepositoryContextModeSetting | undefined {
  const raw = nonBlank(value)?.toLowerCase();
  if (raw === "on" || raw === "1" || raw === "true") {
    return "on";
  }
  if (raw === "off" || raw === "0" || raw === "false" || raw === "default") {
    return "off";
  }
  return undefined;
}

/**
 * Resolves one repository-context budget over the first non-blank source
 * (env, then the operator config file) and never yields an unlimited budget
 * (#106, AC21). An absent, empty, or whitespace-only value at both sources
 * falls back to `defaultValue` without being recorded as a fallback — no
 * operator value was ever supplied. A present value that is not a positive
 * number is a configuration error: `defaultValue` applies and `name` is
 * appended to `fallbacks`, without carrying the unusable raw value anywhere.
 */
function resolveRepositoryContextBudget(
  name: RepositoryContextBudgetName,
  envValue: string | undefined,
  fileValue: number | string | undefined,
  defaultValue: number,
  fallbacks: RepositoryContextBudgetName[],
): number {
  const envSource = nonBlank(envValue);
  const source =
    envSource ?? (typeof fileValue === "number" ? fileValue : nonBlank(fileValue));
  if (source === undefined) {
    return defaultValue;
  }
  // A string source must be a *fully* valid positive integer — `parseInt`
  // alone would accept a malformed value with a numeric prefix (e.g. "12ms")
  // by silently reading only the prefix, which is not "a positive number" and
  // must resolve to the recorded default and a recorded fallback (AC21), not
  // to a truncated guess.
  const parsed =
    typeof source === "number"
      ? source
      : /^\d+$/.test(source)
        ? Number(source)
        : Number.NaN;
  if (Number.isSafeInteger(parsed) && parsed > 0) {
    return parsed;
  }
  fallbacks.push(name);
  return defaultValue;
}

/**
 * Parses one glob-list source into an array of non-blank patterns (#134).
 * Accepts a `RondaConfig`-file array directly, or a comma/newline-separated
 * string from either the environment variable or the config file (the config
 * file's own `excludePathGlobs` may be an array or a string). Returns
 * `undefined` — not `[]` — when the source is entirely absent or blank, so
 * the caller's `??` chain can still defer to the next-lower-precedence
 * source; an operator-supplied empty list would be indistinguishable from "no
 * value" here, which is the intended behavior since an empty list carries no
 * information either way.
 */
function parseGlobList(value: string | string[] | undefined | null): string[] | undefined {
  if (Array.isArray(value)) {
    const globs = value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
    return globs.length > 0 ? globs : undefined;
  }
  const raw = nonBlank(value);
  if (raw === undefined) {
    return undefined;
  }
  const globs = raw
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return globs.length > 0 ? globs : undefined;
}

function parseBooleanFlag(value: string | boolean | undefined | null): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  const raw = nonBlank(value)?.toLowerCase();
  if (raw === "on" || raw === "1" || raw === "true") {
    return true;
  }
  if (raw === "off" || raw === "0" || raw === "false") {
    return false;
  }
  return undefined;
}
