import { createPrivateKey, generateKeyPairSync, verify } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InstallationTokenError,
  createGithubAppJwt,
  createInstallationAccessToken,
  normalizePrivateKey,
} from "../../../src/webhook/github-app-auth.js";

test("normalizes escaped newlines in private keys", () => {
  assert.equal(normalizePrivateKey("a\\nb"), "a\nb");
});

test("requests an installation access token with Bearer JWT app authentication", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const token = await createInstallationAccessToken({
    appJwt: "app.jwt",
    installationId: 456,
    apiUrl: "https://github.example/api/v3/",
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ token: "installation-token" }), { status: 201 });
    }) as typeof fetch,
  });

  assert.equal(token, "installation-token");
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    "https://github.example/api/v3/app/installations/456/access_tokens",
  );
  assert.equal(calls[0].init?.method, "POST");
  assert.equal(
    (calls[0].init?.headers as Record<string, string>).authorization,
    "Bearer app.jwt",
  );
});

test("installation token request errors are sanitized", async () => {
  await assert.rejects(
    () =>
      createInstallationAccessToken({
        appJwt: "app.jwt",
        installationId: 456,
        fetchImpl: (async () => new Response("secret response body", { status: 401 })) as typeof fetch,
      }),
    (error: unknown) => {
      assert.ok(error instanceof InstallationTokenError);
      assert.match(error.message, /HTTP 401/);
      assert.ok(!error.message.includes("secret response body"));
      return true;
    },
  );
});

test("installation token requests retry transient GitHub failures", async () => {
  const sleeps: number[] = [];
  const responses = [
    new Response("server unavailable", { status: 503 }),
    new Response(JSON.stringify({ message: "You have exceeded a secondary rate limit" }), {
      status: 403,
    }),
    new Response(JSON.stringify({ token: "installation-token" }), { status: 201 }),
  ];
  const token = await createInstallationAccessToken({
    appJwt: "app.jwt",
    installationId: 456,
    fetchImpl: (async () => responses.shift() ?? new Response(null, { status: 500 })) as typeof fetch,
    retrySleep: async (ms) => {
      sleeps.push(ms);
    },
  });

  assert.equal(token, "installation-token");
  assert.deepEqual(sleeps, [2_000, 5_000]);
});

test("installation token retry backoff observes the request signal", async () => {
  const controller = new AbortController();
  let fetchCalls = 0;
  let sleepDelay: number | undefined;
  let resolveSleep: (() => void) | undefined;
  const tokenPromise = createInstallationAccessToken({
    appJwt: "app.jwt",
    installationId: 456,
    fetchImpl: (async () => {
      fetchCalls += 1;
      if (fetchCalls > 1) {
        return new Response(JSON.stringify({ token: "unexpected-token" }), { status: 201 });
      }
      return new Response("server unavailable", { status: 503 });
    }) as typeof fetch,
    retrySleep: async (ms) => {
      sleepDelay = ms;
      return new Promise<void>((resolve) => {
        resolveSleep = resolve;
      });
    },
    signal: controller.signal,
  }).then(
    (token) => token,
    (error: unknown) => error,
  );

  await new Promise<void>((resolve) => setImmediate(resolve));
  controller.abort(new DOMException("The operation was aborted.", "AbortError"));

  const watchdog = new Error("installation-token retry backoff did not abort");
  const result = await Promise.race([
    tokenPromise,
    new Promise<Error>((resolve) => setTimeout(() => resolve(watchdog), 100)),
  ]);
  if (result === watchdog) {
    resolveSleep?.();
    await tokenPromise;
  }

  assert.notEqual(result, watchdog);
  assert.equal((result as { name?: string }).name, "AbortError");
  assert.equal(sleepDelay, 2_000);
});

test("creates an RS256 GitHub App JWT with app id as issuer", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const token = createGithubAppJwt({ appId: "12345", privateKey: pem, nowMs: 1_700_000_000_000 });
  const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");

  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as {
    alg: string;
  };
  const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
    iss: string;
    iat: number;
    exp: number;
  };

  assert.equal(header.alg, "RS256");
  assert.equal(payload.iss, "12345");
  assert.equal(payload.iat, 1_699_999_940);
  assert.equal(payload.exp, 1_700_000_540);
  assert.equal(
    verify(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      createPrivateKey(pem).asymmetricKeyType === "rsa" ? publicKey : publicKey,
      Buffer.from(encodedSignature, "base64url"),
    ),
    true,
  );
});
