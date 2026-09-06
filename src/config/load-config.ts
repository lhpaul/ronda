import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RondaConfig } from "./config.types.js";

/** Ten minutes, per the constitution's "timeout in minutes, not hours" rule. */
export const DEFAULT_PASS_TIMEOUT_MS = 600_000;
/** Vendor-published DashScope international endpoint — not operator-specific. */
export const DEFAULT_MODEL_BASE_URL =
  "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
export const DEFAULT_MODEL_NAME = "qwen-plus";
export const DEFAULT_MAX_PATCH_CHARS = 400_000;

/**
 * Thrown when the operator config file exists but cannot be read or parsed.
 * The message names only the file path, never its contents, so a credential
 * accidentally left in a malformed file is never echoed into logs or a
 * published check run.
 */
export class ConfigLoadError extends Error {
  readonly path: string;

  constructor(path: string, cause: unknown) {
    super(`Failed to load Ronda config file at ${path}`);
    this.name = "ConfigLoadError";
    this.path = path;
    this.cause = cause;
  }
}

interface OperatorConfigFile {
  modelApiKey?: string;
  modelBaseUrl?: string;
  modelName?: string;
  passTimeoutMs?: number | string;
  maxPatchChars?: number | string;
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

  return {
    model: { apiKey, baseUrl, modelName },
    passTimeoutMs,
    maxPatchChars,
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
