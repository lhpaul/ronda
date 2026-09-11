import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleWebhookRequest,
  startWebhookServer,
  WebhookJobTimeoutError,
} from "../../../src/webhook/webhook-server.js";
import type { WebhookConfig } from "../../../src/webhook/webhook-config.js";
import type { WebhookReviewJob } from "../../../src/webhook/webhook-job.js";

const config: WebhookConfig = {
  host: "127.0.0.1",
  port: 0,
  webhookSecret: "webhook-secret",
  githubAppId: "123",
  githubPrivateKey: "private-key",
  githubAppTokenTimeoutMs: 60_000,
  webhookJobTimeoutMs: 900_000,
};

function pullRequestPayload(): Record<string, unknown> {
  return {
    action: "synchronize",
    repository: { full_name: "lhpaul/example" },
    installation: { id: 42 },
    pull_request: { number: 7, head: { sha: "a".repeat(40) } },
  };
}

function signature(body: string): string {
  return `sha256=${createHmac("sha256", config.webhookSecret).update(body).digest("hex")}`;
}

async function withWebhookServer<T>(
  callback: (baseUrl: string, jobs: WebhookReviewJob[]) => Promise<T>,
): Promise<T> {
  const jobs: WebhookReviewJob[] = [];
  const server = createServer((req, res) => {
    void handleWebhookRequest(req, res, config, {
      enqueue: (job) => {
        jobs.push(job);
        return true;
      },
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    return await callback(`http://127.0.0.1:${address.port}`, jobs);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test("GET /healthz returns a lightweight readiness response", async () => {
  await withWebhookServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/healthz`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  });
});

test("signed POST /webhook queues a review job and returns 202", async () => {
  await withWebhookServer(async (baseUrl, jobs) => {
    const body = JSON.stringify(pullRequestPayload());
    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-1",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), { ok: true, queued: true, pullNumber: 7 });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].owner, "lhpaul");
    assert.equal(jobs[0].repo, "example");
    assert.equal(jobs[0].installationId, 42);
    assert.equal(jobs[0].deliveryId, "delivery-1");
  });
});

test("POST /webhook rejects invalid signatures before queueing work", async () => {
  await withWebhookServer(async (baseUrl, jobs) => {
    const body = JSON.stringify(pullRequestPayload());
    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-2",
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
      },
      body,
    });

    assert.equal(response.status, 401);
    assert.equal(jobs.length, 0);
  });
});

test("POST /webhook rejects invalid JSON after signature verification", async () => {
  await withWebhookServer(async (baseUrl, jobs) => {
    const body = "{ not json";
    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-3",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 400);
    assert.equal(jobs.length, 0);
  });
});

test("POST /webhook treats valid JSON non-object payloads as no-op deliveries", async () => {
  await withWebhookServer(async (baseUrl, jobs) => {
    const body = "null";
    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-null",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      ok: true,
      queued: false,
      reason: "payload must be a JSON object",
    });
    assert.equal(jobs.length, 0);
  });
});

test("POST /webhook returns 413 for oversized bodies without resetting the socket", async () => {
  await withWebhookServer(async (baseUrl, jobs) => {
    const body = Buffer.alloc(10 * 1024 * 1024 + 1, "x");
    const response = await fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-4",
        "x-hub-signature-256": signature(body.toString("utf8")),
      },
      body,
    });

    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { ok: false, error: "body_too_large" });
    assert.equal(jobs.length, 0);
  });
});

test("queued webhook job failures invoke the fatal failure hook after returning 202", async () => {
  const failures: unknown[] = [];
  const server = startWebhookServer(
    { ...config, port: 0 },
    {
      runJob: async () => {
        throw new Error("job failed");
      },
      onJobFailure: (error) => {
        failures.push(error);
      },
      log: { error: () => undefined, log: () => undefined },
    },
  );

  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    const body = JSON.stringify(pullRequestPayload());
    const response = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-5",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 202);
    await eventually(() => failures.length === 1);
    assert.match(String(failures[0]), /job failed/);
  } finally {
    server.close();
  }
});

test("duplicate webhook delivery IDs are accepted but not requeued", async () => {
  const jobs: WebhookReviewJob[] = [];
  const server = startWebhookServer(
    { ...config, port: 0 },
    {
      runJob: async (job) => {
        jobs.push(job);
      },
      log: { error: () => undefined, log: () => undefined },
    },
  );

  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    const body = JSON.stringify(pullRequestPayload());
    const headers = {
      "x-github-event": "pull_request",
      "x-github-delivery": "delivery-6",
      "x-hub-signature-256": signature(body),
    };
    const first = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: "POST",
      headers,
      body,
    });
    const second = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: "POST",
      headers,
      body,
    });

    assert.equal(first.status, 202);
    assert.deepEqual(await first.json(), { ok: true, queued: true, pullNumber: 7 });
    assert.equal(second.status, 202);
    assert.deepEqual(await second.json(), {
      ok: true,
      queued: false,
      reason: "duplicate_delivery",
    });
    await eventually(() => jobs.length === 1);
    assert.equal(jobs[0].deliveryId, "delivery-6");
  } finally {
    server.close();
  }
});

test("active webhook delivery IDs are not evicted by later refused deliveries", async () => {
  const jobs: string[] = [];
  let finishFirstJob!: () => void;
  const firstJobCanFinish = new Promise<void>((resolve) => {
    finishFirstJob = resolve;
  });
  const server = startWebhookServer(
    { ...config, port: 0 },
    {
      runJob: async (job) => {
        jobs.push(job.deliveryId);
        if (job.deliveryId === "delivery-active") {
          await firstJobCanFinish;
        }
      },
      log: { error: () => undefined, log: () => undefined },
    },
  );

  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const body = JSON.stringify(pullRequestPayload());
  const postDelivery = async (deliveryId: string): Promise<Response> =>
    fetch(`${baseUrl}/webhook`, {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": deliveryId,
        "x-hub-signature-256": signature(body),
      },
      body,
    });

  try {
    assert.equal((await postDelivery("delivery-active")).status, 202);
    await eventually(() => jobs.length === 1);
    for (let index = 0; index < 1_001; index += 1) {
      assert.equal((await postDelivery(`delivery-later-${index}`)).status, 503);
    }

    const replay = await postDelivery("delivery-active");

    assert.equal(replay.status, 202);
    assert.deepEqual(await replay.json(), {
      ok: true,
      queued: false,
      reason: "duplicate_delivery",
    });
    assert.deepEqual(jobs, ["delivery-active"]);
  } finally {
    finishFirstJob();
    server.close();
  }
});

test("delivery IDs are released when the worker refuses to enqueue", async () => {
  const seenDeliveryIds = new Set<string>();
  let acceptsWork = false;
  const jobs: WebhookReviewJob[] = [];
  const server = createServer((req, res) => {
    void handleWebhookRequest(req, res, config, {
      acceptDeliveryId: (deliveryId) => {
        if (seenDeliveryIds.has(deliveryId)) {
          return false;
        }
        seenDeliveryIds.add(deliveryId);
        return true;
      },
      releaseDeliveryId: (deliveryId) => {
        seenDeliveryIds.delete(deliveryId);
      },
      enqueue: (job) => {
        if (!acceptsWork) {
          return false;
        }
        jobs.push(job);
        return true;
      },
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    const body = JSON.stringify(pullRequestPayload());
    const headers = {
      "x-github-event": "pull_request",
      "x-github-delivery": "delivery-7",
      "x-hub-signature-256": signature(body),
    };
    const refused = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: "POST",
      headers,
      body,
    });
    acceptsWork = true;
    const retried = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: "POST",
      headers,
      body,
    });

    assert.equal(refused.status, 503);
    assert.deepEqual(await refused.json(), { ok: false, error: "webhook_worker_unavailable" });
    assert.equal(retried.status, 202);
    assert.deepEqual(await retried.json(), { ok: true, queued: true, pullNumber: 7 });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].deliveryId, "delivery-7");
  } finally {
    server.close();
  }
});

test("busy webhook worker releases refused deliveries for later retry", async () => {
  const jobs: string[] = [];
  let finishFirstJob!: () => void;
  const firstJobCanFinish = new Promise<void>((resolve) => {
    finishFirstJob = resolve;
  });
  const server = startWebhookServer(
    { ...config, port: 0 },
    {
      runJob: async (job) => {
        jobs.push(job.deliveryId);
        if (job.deliveryId === "delivery-busy-first") {
          await firstJobCanFinish;
        }
      },
      log: { error: () => undefined, log: () => undefined },
    },
  );

  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address() as AddressInfo;
  const body = JSON.stringify(pullRequestPayload());
  const postDelivery = async (deliveryId: string): Promise<Response> =>
    fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": deliveryId,
        "x-hub-signature-256": signature(body),
      },
      body,
    });

  try {
    assert.equal((await postDelivery("delivery-busy-first")).status, 202);
    await eventually(() => jobs.length === 1);
    assert.equal((await postDelivery("delivery-busy-retry")).status, 503);
    finishFirstJob();
    await new Promise((resolve) => setTimeout(resolve, 5));

    const retry = await postDelivery("delivery-busy-retry");

    assert.equal(retry.status, 202);
    assert.deepEqual(await retry.json(), { ok: true, queued: true, pullNumber: 7 });
    await eventually(() => jobs.length === 2);
    assert.deepEqual(jobs, ["delivery-busy-first", "delivery-busy-retry"]);
  } finally {
    finishFirstJob();
    server.close();
  }
});

test("busy webhook workers refuse concurrent jobs for GitHub redelivery", async () => {
  const failures: unknown[] = [];
  const jobs: string[] = [];
  let failFirstJob!: () => void;
  const firstJobCanFail = new Promise<void>((resolve) => {
    failFirstJob = resolve;
  });
  const server = startWebhookServer(
    { ...config, port: 0 },
    {
      runJob: async (job) => {
        jobs.push(job.deliveryId);
        if (job.deliveryId === "delivery-8") {
          await firstJobCanFail;
          throw new Error("job failed");
        }
      },
      onJobFailure: (error) => {
        failures.push(error);
      },
      log: { error: () => undefined, log: () => undefined },
    },
  );

  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    const body = JSON.stringify(pullRequestPayload());
    const first = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-8",
        "x-hub-signature-256": signature(body),
      },
      body,
    });
    const second = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-9",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(first.status, 202);
    assert.equal(second.status, 503);
    assert.deepEqual(await second.json(), { ok: false, error: "webhook_worker_unavailable" });
    failFirstJob();
    await eventually(() => failures.length === 1);
    assert.deepEqual(jobs, ["delivery-8"]);
  } finally {
    server.close();
  }
});

test("queued webhook jobs fail fatally when they exceed the outer job timeout", async () => {
  const failures: unknown[] = [];
  const jobs: string[] = [];
  let jobSignal: AbortSignal | undefined;
  const server = startWebhookServer(
    { ...config, port: 0, webhookJobTimeoutMs: 5 },
    {
      runJob: async (job, _config, signal) => {
        jobs.push(job.deliveryId);
        jobSignal = signal;
        await new Promise((_, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      onJobFailure: (error) => {
        failures.push(error);
      },
      log: { error: () => undefined, log: () => undefined },
    },
  );

  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    const body = JSON.stringify(pullRequestPayload());
    const response = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-10",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 202);
    await eventually(() => failures.length === 1);
    assert.deepEqual(jobs, ["delivery-10"]);
    assert.equal(jobSignal?.aborted, true);
    assert.ok(failures[0] instanceof WebhookJobTimeoutError);
    assert.match(String(failures[0]), /timed out after 5ms/);
  } finally {
    server.close();
  }
});

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(predicate(), true);
}
