import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleWebhookRequest, startWebhookServer } from "../../../src/webhook/webhook-server.js";
import type { WebhookConfig } from "../../../src/webhook/webhook-config.js";
import type { WebhookReviewJob } from "../../../src/webhook/webhook-job.js";

const config: WebhookConfig = {
  host: "127.0.0.1",
  port: 0,
  webhookSecret: "webhook-secret",
  githubAppId: "123",
  githubPrivateKey: "private-key",
  githubAppTokenTimeoutMs: 60_000,
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
        "x-github-delivery": "delivery-4",
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

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(predicate(), true);
}
