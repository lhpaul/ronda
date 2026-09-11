import { createSign } from "node:crypto";

export interface GithubAppJwtInput {
  appId: string;
  privateKey: string;
  nowMs?: number;
}

export function createGithubAppJwt(input: GithubAppJwtInput): string {
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const payload = base64UrlJson({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: input.appId,
  });
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(signingInput)
    .end()
    .sign(normalizePrivateKey(input.privateKey))
    .toString("base64url");
  return `${signingInput}.${signature}`;
}

export interface InstallationTokenInput {
  appJwt: string;
  installationId: number;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export class InstallationTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallationTokenError";
  }
}

export async function createInstallationAccessToken(
  input: InstallationTokenInput,
): Promise<string> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `${apiBaseUrl(input.apiUrl)}/app/installations/${input.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${input.appJwt}`,
        "x-github-api-version": "2022-11-28",
      },
      signal: input.signal,
    },
  );

  if (!response.ok) {
    throw new InstallationTokenError(
      `GitHub App installation token request failed with HTTP ${response.status}`,
    );
  }

  const data = (await response.json()) as { token?: unknown };
  if (typeof data.token !== "string" || data.token.trim() === "") {
    throw new InstallationTokenError("GitHub App installation token response did not include a token");
  }
  return data.token;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function normalizePrivateKey(privateKey: string): string {
  return privateKey.replace(/\\n/g, "\n");
}

function apiBaseUrl(apiUrl: string | undefined): string {
  return (apiUrl ?? "https://api.github.com").replace(/\/+$/, "");
}
