import { existsSync, readFileSync } from "node:fs";

export interface WebhookConfig {
  host: string;
  port: number;
  webhookSecret: string;
  githubAppId: string;
  githubPrivateKey: string;
  githubAppTokenTimeoutMs: number;
  webhookJobTimeoutMs: number;
  webhookJobSettlementTimeoutMs: number;
  githubApiUrl?: string;
  detailsUrl?: string;
}

export interface LoadWebhookConfigOptions {
  env?: NodeJS.ProcessEnv;
  fileExists?: (path: string) => boolean;
  readFile?: (path: string) => string;
}

export class WebhookConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookConfigError";
  }
}

export function loadWebhookConfig(options: LoadWebhookConfigOptions = {}): WebhookConfig {
  const env = options.env ?? process.env;
  const fileExists = options.fileExists ?? existsSync;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));

  const webhookSecret = required(env.RONDA_WEBHOOK_SECRET, "RONDA_WEBHOOK_SECRET");
  const githubAppId = required(env.RONDA_GITHUB_APP_ID, "RONDA_GITHUB_APP_ID");
  const githubPrivateKey =
    nonBlank(env.RONDA_GITHUB_PRIVATE_KEY) ??
    readPrivateKeyFile(env.RONDA_GITHUB_PRIVATE_KEY_FILE, fileExists, readFile);

  if (githubPrivateKey === undefined) {
    throw new WebhookConfigError(
      "Set RONDA_GITHUB_PRIVATE_KEY or RONDA_GITHUB_PRIVATE_KEY_FILE",
    );
  }

  return {
    host: nonBlank(env.RONDA_WEBHOOK_HOST) ?? "127.0.0.1",
    port: positiveInt(env.RONDA_WEBHOOK_PORT) ?? 3000,
    webhookSecret,
    githubAppId,
    githubPrivateKey,
    githubAppTokenTimeoutMs: positiveInt(env.RONDA_GITHUB_APP_TOKEN_TIMEOUT_MS) ?? 60_000,
    webhookJobTimeoutMs: positiveInt(env.RONDA_WEBHOOK_JOB_TIMEOUT_MS) ?? 900_000,
    webhookJobSettlementTimeoutMs:
      positiveInt(env.RONDA_WEBHOOK_JOB_SETTLEMENT_TIMEOUT_MS) ?? 30_000,
    githubApiUrl: nonBlank(env.GITHUB_API_URL),
    detailsUrl: nonBlank(env.RONDA_DETAILS_URL),
  };
}

function readPrivateKeyFile(
  path: string | undefined,
  fileExists: (path: string) => boolean,
  readFile: (path: string) => string,
): string | undefined {
  const trimmed = nonBlank(path);
  if (trimmed === undefined) {
    return undefined;
  }
  if (!fileExists(trimmed)) {
    throw new WebhookConfigError(`RONDA_GITHUB_PRIVATE_KEY_FILE does not exist: ${trimmed}`);
  }
  return readFile(trimmed);
}

function required(value: string | undefined, name: string): string {
  const trimmed = nonBlank(value);
  if (trimmed === undefined) {
    throw new WebhookConfigError(`Missing required environment variable: ${name}`);
  }
  return trimmed;
}

function nonBlank(value: string | undefined | null): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function positiveInt(value: string | undefined): number | undefined {
  const trimmed = nonBlank(value);
  if (trimmed === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
