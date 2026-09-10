import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenAiCompatibleClient } from "../../../src/inference/openai-compatible-client.js";
import { ModelClientError } from "../../../src/inference/model-client.js";
import { startMockModelServer } from "../../support/mock-model-server.js";

test("a successful response returns the message content", async () => {
  const server = await startMockModelServer({ responseContent: '{"findings":[]}' });
  try {
    const client = createOpenAiCompatibleClient({
      apiKey: "test-key",
      baseUrl: server.url,
      modelName: "mock-model",
    });
    const content = await client.complete(
      { systemPrompt: "sys", userPrompt: "user" },
      new AbortController().signal,
    );
    assert.equal(content, '{"findings":[]}');
  } finally {
    await server.close();
  }
});

test("the request fixes temperature at zero to reduce same-head variance", async () => {
  let requestBody: unknown;
  const client = createOpenAiCompatibleClient({
    apiKey: "test-key",
    baseUrl: "https://example.test",
    modelName: "mock-model",
    fetchImpl: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"findings":[]}' } }] }),
        { status: 200 },
      );
    },
  });

  await client.complete(
    { systemPrompt: "sys", userPrompt: "user" },
    new AbortController().signal,
  );

  assert.deepEqual(requestBody, {
    model: "mock-model",
    temperature: 0,
    messages: [
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
    ],
  });
});

test("HTTP 401 maps to credential_invalid", async () => {
  const server = await startMockModelServer({ statusCode: 401 });
  try {
    const client = createOpenAiCompatibleClient({
      apiKey: "wrong-key",
      baseUrl: server.url,
      modelName: "mock-model",
    });
    await assert.rejects(
      () => client.complete({ systemPrompt: "s", userPrompt: "u" }, new AbortController().signal),
      (error: unknown) => {
        assert.ok(error instanceof ModelClientError);
        assert.equal(error.reason, "credential_invalid");
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("HTTP 403 maps to credential_invalid", async () => {
  const server = await startMockModelServer({ statusCode: 403 });
  try {
    const client = createOpenAiCompatibleClient({
      apiKey: "wrong-key",
      baseUrl: server.url,
      modelName: "mock-model",
    });
    await assert.rejects(
      () => client.complete({ systemPrompt: "s", userPrompt: "u" }, new AbortController().signal),
      (error: unknown) => {
        assert.ok(error instanceof ModelClientError);
        assert.equal(error.reason, "credential_invalid");
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("HTTP 500 maps to model_unavailable", async () => {
  const server = await startMockModelServer({ statusCode: 500 });
  try {
    const client = createOpenAiCompatibleClient({
      apiKey: "test-key",
      baseUrl: server.url,
      modelName: "mock-model",
    });
    await assert.rejects(
      () => client.complete({ systemPrompt: "s", userPrompt: "u" }, new AbortController().signal),
      (error: unknown) => {
        assert.ok(error instanceof ModelClientError);
        assert.equal(error.reason, "model_unavailable");
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("a response with no message content maps to model_unavailable", async () => {
  const server = await startMockModelServer({ omitContent: true });
  try {
    const client = createOpenAiCompatibleClient({
      apiKey: "test-key",
      baseUrl: server.url,
      modelName: "mock-model",
    });
    await assert.rejects(
      () => client.complete({ systemPrompt: "s", userPrompt: "u" }, new AbortController().signal),
      (error: unknown) => {
        assert.ok(error instanceof ModelClientError);
        assert.equal(error.reason, "model_unavailable");
        return true;
      },
    );
  } finally {
    await server.close();
  }
});

test("an aborted signal maps to timed_out", async () => {
  const server = await startMockModelServer({ delayMs: 200 });
  try {
    const client = createOpenAiCompatibleClient({
      apiKey: "test-key",
      baseUrl: server.url,
      modelName: "mock-model",
    });
    const controller = new AbortController();
    const pending = client.complete({ systemPrompt: "s", userPrompt: "u" }, controller.signal);
    controller.abort();
    await assert.rejects(() => pending, (error: unknown) => {
      assert.ok(error instanceof ModelClientError);
      assert.equal(error.reason, "timed_out");
      return true;
    });
  } finally {
    await server.close();
  }
});

test("a connection failure (server unreachable) maps to model_unavailable", async () => {
  const client = createOpenAiCompatibleClient({
    apiKey: "test-key",
    // Port 1 is reserved and should refuse the connection immediately.
    baseUrl: "http://127.0.0.1:1",
    modelName: "mock-model",
  });
  await assert.rejects(
    () => client.complete({ systemPrompt: "s", userPrompt: "u" }, new AbortController().signal),
    (error: unknown) => {
      assert.ok(error instanceof ModelClientError);
      assert.equal(error.reason, "model_unavailable");
      return true;
    },
  );
});
