import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ReviewPublishedCheckRunError } from "../../../src/core/run-review-pass.js";
import {
  handleWebhookRequest,
  WebhookJobSettlementTimeoutError,
  WebhookQueuePersistenceError,
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
  webhookJobSettlementTimeoutMs: 30_000,
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

function tempQueuePath(): string {
  return join(mkdtempSync(join(tmpdir(), "ronda-webhook-queue-")), "queue.json");
}

interface WebhookQueueFileEntry extends WebhookReviewJob {
  status?: "pending" | "in_progress" | "published" | "completed";
  completedAt?: string;
}

function readQueueFile(path: string): WebhookQueueFileEntry[] {
  return JSON.parse(readFileSync(path, "utf8")) as WebhookQueueFileEntry[];
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

test("queued webhook job failures invoke the failure hook after returning 202", async () => {
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

test("accepted webhook jobs are persisted until processing completes", async () => {
  const queuePath = tempQueuePath();
  const jobs: string[] = [];
  let finishJob!: () => void;
  const jobCanFinish = new Promise<void>((resolve) => {
    finishJob = resolve;
  });
  const server = startWebhookServer(
    { ...config, port: 0, webhookQueuePath: queuePath },
    {
      runJob: async (job) => {
        jobs.push(job.deliveryId);
        await jobCanFinish;
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
        "x-github-delivery": "delivery-persisted",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 202);
    await eventually(() => jobs.length === 1);
    assert.deepEqual(
      readQueueFile(queuePath).map((job) => job.deliveryId),
      ["delivery-persisted"],
    );
    assert.deepEqual(
      readQueueFile(queuePath).map((job) => job.status),
      ["in_progress"],
    );

    finishJob();
    await eventually(() => readQueueFile(queuePath)[0]?.status === "completed");
  } finally {
    finishJob();
    server.close();
  }
});

test("pending webhook jobs are recovered from the persisted queue on startup", async () => {
  const queuePath = tempQueuePath();
  const pendingJob: WebhookReviewJob = {
    owner: "lhpaul",
    repo: "example",
    pullNumber: 7,
    trigger: "automatic",
    headSha: "a".repeat(40),
    installationId: 42,
    deliveryId: "delivery-recovered",
  };
  writeFileSync(queuePath, `${JSON.stringify([pendingJob], null, 2)}\n`);
  const jobs: string[] = [];
  const server = startWebhookServer(
    { ...config, port: 0, webhookQueuePath: queuePath },
    {
      runJob: async (job) => {
        jobs.push(job.deliveryId);
      },
      log: { error: () => undefined, log: () => undefined },
    },
  );

  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  try {
    await eventually(() => jobs.length === 1);
    assert.deepEqual(jobs, ["delivery-recovered"]);
    await eventually(() => readQueueFile(queuePath)[0]?.status === "completed");
  } finally {
    server.close();
  }
});

test("malformed persisted webhook queues fail startup", () => {
  const queuePath = tempQueuePath();
  writeFileSync(queuePath, "{not json");

  assert.throws(
    () =>
      startWebhookServer(
        { ...config, port: 0, webhookQueuePath: queuePath },
        {
          log: { error: () => undefined, log: () => undefined },
        },
      ),
    WebhookQueuePersistenceError,
  );
});

test("invalid persisted webhook queue entries fail startup", () => {
  const queuePath = tempQueuePath();
  const invalidJob = {
    owner: "lhpaul",
    repo: "example",
    pullNumber: "not-a-number",
    trigger: "automatic",
    installationId: 42,
    deliveryId: "delivery-invalid",
  };
  writeFileSync(queuePath, `${JSON.stringify([invalidJob], null, 2)}\n`);

  assert.throws(
    () =>
      startWebhookServer(
        { ...config, port: 0, webhookQueuePath: queuePath },
        {
          log: { error: () => undefined, log: () => undefined },
        },
      ),
    WebhookQueuePersistenceError,
  );
});

test("completed webhook queue entries are not replayed on startup", async () => {
  const queuePath = tempQueuePath();
  const completedJob: WebhookQueueFileEntry = {
    owner: "lhpaul",
    repo: "example",
    pullNumber: 7,
    trigger: "automatic",
    headSha: "a".repeat(40),
    installationId: 42,
    deliveryId: "delivery-completed",
    status: "completed",
    completedAt: "2026-09-11T00:00:00.000Z",
  };
  const pendingJob: WebhookQueueFileEntry = {
    owner: "lhpaul",
    repo: "example",
    pullNumber: 8,
    trigger: "automatic",
    headSha: "b".repeat(40),
    installationId: 42,
    deliveryId: "delivery-still-pending",
    status: "pending",
  };
  writeFileSync(queuePath, `${JSON.stringify([completedJob, pendingJob], null, 2)}\n`);
  const jobs: string[] = [];
  const server = startWebhookServer(
    { ...config, port: 0, webhookQueuePath: queuePath },
    {
      runJob: async (job) => {
        jobs.push(job.deliveryId);
      },
      log: { error: () => undefined, log: () => undefined },
    },
  );

  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  try {
    await eventually(() => jobs.length === 1);
    assert.deepEqual(jobs, ["delivery-still-pending"]);
    await eventually(() => readQueueFile(queuePath).every((job) => job.status === "completed"));
    assert.deepEqual(
      readQueueFile(queuePath).map((job) => job.deliveryId),
      ["delivery-completed", "delivery-still-pending"],
    );
  } finally {
    server.close();
  }
});

test("completed webhook queue entries reject matching redeliveries", async () => {
  const queuePath = tempQueuePath();
  const completedJob: WebhookQueueFileEntry = {
    owner: "lhpaul",
    repo: "example",
    pullNumber: 7,
    trigger: "automatic",
    headSha: "a".repeat(40),
    installationId: 42,
    deliveryId: "delivery-completed-redelivery",
    status: "completed",
    completedAt: "2026-09-11T00:00:00.000Z",
  };
  writeFileSync(queuePath, `${JSON.stringify([completedJob], null, 2)}\n`);
  const jobs: string[] = [];
  const server = startWebhookServer(
    { ...config, port: 0, webhookQueuePath: queuePath },
    {
      runJob: async (job) => {
        jobs.push(job.deliveryId);
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
        "x-github-delivery": "delivery-completed-redelivery",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      ok: true,
      queued: false,
      reason: "duplicate_delivery",
    });
    assert.deepEqual(jobs, []);
    assert.deepEqual(
      readQueueFile(queuePath).map((job) => job.deliveryId),
      ["delivery-completed-redelivery"],
    );
  } finally {
    server.close();
  }
});

test("published webhook queue entries reject matching redeliveries", async () => {
  const queuePath = tempQueuePath();
  const publishedJob: WebhookQueueFileEntry = {
    owner: "lhpaul",
    repo: "example",
    pullNumber: 7,
    trigger: "automatic",
    headSha: "a".repeat(40),
    installationId: 42,
    deliveryId: "delivery-published-redelivery",
    status: "published",
  };
  writeFileSync(queuePath, `${JSON.stringify([publishedJob], null, 2)}\n`);
  const jobs: string[] = [];
  const server = startWebhookServer(
    { ...config, port: 0, webhookQueuePath: queuePath },
    {
      runJob: async (job) => {
        jobs.push(job.deliveryId);
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
        "x-github-delivery": "delivery-published-redelivery",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      ok: true,
      queued: false,
      reason: "duplicate_delivery",
    });
    assert.deepEqual(jobs, []);
    assert.deepEqual(
      readQueueFile(queuePath).map((job) => [job.deliveryId, job.status]),
      [["delivery-published-redelivery", "published"]],
    );
  } finally {
    server.close();
  }
});

test("in-progress webhook queue entries can be recovered by redelivery after startup", async () => {
  const queuePath = tempQueuePath();
  const inProgressJob: WebhookQueueFileEntry = {
    owner: "lhpaul",
    repo: "example",
    pullNumber: 7,
    trigger: "manual",
    installationId: 42,
    deliveryId: "delivery-in-progress",
    status: "in_progress",
  };
  writeFileSync(queuePath, `${JSON.stringify([inProgressJob], null, 2)}\n`);
  const jobs: string[] = [];
  const server = startWebhookServer(
    { ...config, port: 0, webhookQueuePath: queuePath },
    {
      runJob: async (job) => {
        jobs.push(job.deliveryId);
      },
      log: { error: () => undefined, log: () => undefined },
    },
  );

  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  const address = server.address() as AddressInfo;
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(jobs, []);
    assert.deepEqual(
      readQueueFile(queuePath).map((job) => [job.deliveryId, job.status]),
      [["delivery-in-progress", "in_progress"]],
    );

    const body = JSON.stringify(pullRequestPayload());
    const response = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: "POST",
      headers: {
        "x-github-event": "pull_request",
        "x-github-delivery": "delivery-in-progress",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      ok: true,
      queued: true,
      pullNumber: 7,
    });

    await eventually(() => readQueueFile(queuePath).every((job) => job.status === "completed"));
    assert.deepEqual(jobs, ["delivery-in-progress"]);
    assert.deepEqual(
      readQueueFile(queuePath).map((job) => [job.deliveryId, job.status]),
      [["delivery-in-progress", "completed"]],
    );
  } finally {
    server.close();
  }
});

test("completed webhook queue history is bounded", async () => {
  const queuePath = tempQueuePath();
  const completedJobs: WebhookQueueFileEntry[] = Array.from({ length: 1_000 }, (_, index) => ({
    owner: "lhpaul",
    repo: "example",
    pullNumber: index + 1,
    trigger: "automatic",
    installationId: 42,
    deliveryId: `delivery-completed-${index}`,
    status: "completed",
    completedAt: "2026-09-11T00:00:00.000Z",
  }));
  const pendingJob: WebhookQueueFileEntry = {
    owner: "lhpaul",
    repo: "example",
    pullNumber: 1_001,
    trigger: "automatic",
    installationId: 42,
    deliveryId: "delivery-newly-completed",
    status: "pending",
  };
  writeFileSync(queuePath, `${JSON.stringify([pendingJob, ...completedJobs], null, 2)}\n`);
  const jobs: string[] = [];
  const server = startWebhookServer(
    { ...config, port: 0, webhookQueuePath: queuePath },
    {
      runJob: async (job) => {
        jobs.push(job.deliveryId);
      },
      log: { error: () => undefined, log: () => undefined },
    },
  );

  await new Promise<void>((resolve) => {
    server.once("listening", resolve);
  });
  try {
    await eventually(() => jobs.length === 1);
    await eventually(() => readQueueFile(queuePath).length === 1_000);
    const entries = readQueueFile(queuePath);
    assert.equal(entries[0].deliveryId, "delivery-completed-1");
    assert.equal(entries[entries.length - 1].deliveryId, "delivery-newly-completed");
    assert.ok(entries.every((job) => job.status === "completed"));
  } finally {
    server.close();
  }
});

test("review-published webhook failures are not replayed from the persisted queue", async () => {
  const failures: unknown[] = [];
  const jobs: string[] = [];
  const queuePath = tempQueuePath();
  const server = startWebhookServer(
    { ...config, port: 0, webhookQueuePath: queuePath },
    {
      runJob: async (job) => {
        jobs.push(job.deliveryId);
        throw new ReviewPublishedCheckRunError("review is public but check run failed");
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
        "x-github-delivery": "delivery-review-published",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 202);
    await eventually(() => failures.length === 1);
    assert.ok(failures[0] instanceof ReviewPublishedCheckRunError);
    assert.deepEqual(jobs, ["delivery-review-published"]);
    assert.deepEqual(
      readQueueFile(queuePath).map((job) => [job.deliveryId, job.status]),
      [["delivery-review-published", "published"]],
    );
  } finally {
    server.close();
  }
});

test("review-published webhook failures write a published tombstone", async () => {
  const failures: unknown[] = [];
  const calls: string[] = [];
  const queueStore = {
    load: () => [],
    loadSuppressedDeliveryIds: () => [],
    add: () => {
      calls.push("add");
      return true;
    },
    start: () => {
      calls.push("start");
      return true;
    },
    retry: () => {
      calls.push("retry");
      return true;
    },
    markPublished: () => {
      calls.push("markPublished");
      return true;
    },
    complete: () => true,
  };
  const server = startWebhookServer(
    { ...config, port: 0 },
    {
      queueStore,
      runJob: async () => {
        throw new ReviewPublishedCheckRunError("review is public but check run failed");
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
        "x-github-delivery": "delivery-review-published-complete-fails",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 202);
    await eventually(() => failures.length === 1);
    assert.ok(failures[0] instanceof ReviewPublishedCheckRunError);
    assert.deepEqual(calls, ["add", "start", "markPublished"]);
  } finally {
    server.close();
  }
});

test("completion persistence failures after a terminal outcome do not retry the job", async () => {
  const failures: unknown[] = [];
  const calls: string[] = [];
  const jobs: string[] = [];
  const queueStore = {
    load: () => [],
    loadSuppressedDeliveryIds: () => [],
    add: () => {
      calls.push("add");
      return true;
    },
    start: () => {
      calls.push("start");
      return true;
    },
    retry: () => {
      calls.push("retry");
      return true;
    },
    markPublished: () => {
      calls.push("markPublished");
      return true;
    },
    complete: () => {
      calls.push("complete");
      return false;
    },
  };
  const server = startWebhookServer(
    { ...config, port: 0 },
    {
      queueStore,
      runJob: async (job) => {
        jobs.push(job.deliveryId);
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
        "x-github-delivery": "delivery-complete-fails",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 202);
    await eventually(() => failures.length === 1);
    assert.deepEqual(jobs, ["delivery-complete-fails"]);
    assert.ok(failures[0] instanceof WebhookQueuePersistenceError);
    assert.deepEqual(calls, ["add", "start", "markPublished", "complete", "complete"]);
  } finally {
    server.close();
  }
});

test("published-marker failures after a terminal outcome do not retry the job", async () => {
  const failures: unknown[] = [];
  const calls: string[] = [];
  const queueStore = {
    load: () => [],
    loadSuppressedDeliveryIds: () => [],
    add: () => {
      calls.push("add");
      return true;
    },
    start: () => {
      calls.push("start");
      return true;
    },
    retry: () => {
      calls.push("retry");
      return true;
    },
    markPublished: () => {
      calls.push("markPublished");
      return false;
    },
    complete: () => {
      calls.push("complete");
      return false;
    },
  };
  const server = startWebhookServer(
    { ...config, port: 0 },
    {
      queueStore,
      runJob: async () => undefined,
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
        "x-github-delivery": "delivery-published-marker-fails",
        "x-hub-signature-256": signature(body),
      },
      body,
    });

    assert.equal(response.status, 202);
    await eventually(() => failures.length === 1);
    assert.ok(failures[0] instanceof WebhookQueuePersistenceError);
    assert.deepEqual(calls, ["add", "start", "markPublished", "markPublished", "complete"]);
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
      const response = await postDelivery(`delivery-later-${index}`);
      assert.equal(response.status, index < 25 ? 202 : 503);
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

test("busy webhook worker queues pending deliveries for later processing", async () => {
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
    const queued = await postDelivery("delivery-busy-queued");

    assert.equal(queued.status, 202);
    assert.deepEqual(await queued.json(), { ok: true, queued: true, pullNumber: 7 });
    assert.deepEqual(jobs, ["delivery-busy-first"]);
    finishFirstJob();
    await eventually(() => jobs.length === 2);
    assert.deepEqual(jobs, ["delivery-busy-first", "delivery-busy-queued"]);
  } finally {
    finishFirstJob();
    server.close();
  }
});

test("busy webhook worker preserves queued jobs after a job failure", async () => {
  const failures: unknown[] = [];
  const jobs: string[] = [];
  const queuePath = tempQueuePath();
  let failFirstJob!: () => void;
  const firstJobCanFail = new Promise<void>((resolve) => {
    failFirstJob = resolve;
  });
  const server = startWebhookServer(
    { ...config, port: 0, webhookQueuePath: queuePath },
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
    assert.equal(second.status, 202);
    assert.deepEqual(await second.json(), { ok: true, queued: true, pullNumber: 7 });
    failFirstJob();
    await eventually(() => failures.length === 1);
    assert.deepEqual(jobs, ["delivery-8"]);
    assert.deepEqual(
      readQueueFile(queuePath).map((job) => job.deliveryId),
      ["delivery-8", "delivery-9"],
    );
  } finally {
    server.close();
  }
});

test("timed-out webhook jobs settle before the worker stops", async () => {
  const failures: unknown[] = [];
  const jobs: string[] = [];
  const queuePath = tempQueuePath();
  let firstJobSawAbort = false;
  const server = startWebhookServer(
    { ...config, port: 0, webhookJobTimeoutMs: 5, webhookQueuePath: queuePath },
    {
      runJob: async (job, _config, signal) => {
        jobs.push(job.deliveryId);
        if (job.deliveryId !== "delivery-settle-first") {
          return;
        }
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              firstJobSawAbort = true;
              setTimeout(resolve, 20);
            },
            { once: true },
          );
        });
        throw signal.reason;
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
    assert.equal((await postDelivery("delivery-settle-first")).status, 202);
    await eventually(() => jobs.length === 1);
    assert.equal((await postDelivery("delivery-settle-second")).status, 202);
    await eventually(() => firstJobSawAbort);
    await new Promise((resolve) => setTimeout(resolve, 8));
    assert.deepEqual(jobs, ["delivery-settle-first"]);

    await eventually(() => failures.length === 1);
    assert.deepEqual(jobs, ["delivery-settle-first"]);
    assert.deepEqual(
      readQueueFile(queuePath).map((job) => job.deliveryId),
      ["delivery-settle-first", "delivery-settle-second"],
    );
    assert.ok(failures[0] instanceof WebhookJobTimeoutError);
  } finally {
    server.close();
  }
});

test("timed-out webhook jobs that resolve after abort complete and advance the queue", async () => {
  const jobs: string[] = [];
  const queuePath = tempQueuePath();
  let firstJobSawAbort = false;
  const server = startWebhookServer(
    { ...config, port: 0, webhookJobTimeoutMs: 5, webhookQueuePath: queuePath },
    {
      runJob: async (job, _config, signal) => {
        jobs.push(job.deliveryId);
        if (job.deliveryId !== "delivery-resolve-after-abort-first") {
          return;
        }
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              firstJobSawAbort = true;
              setTimeout(resolve, 20);
            },
            { once: true },
          );
        });
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
    assert.equal((await postDelivery("delivery-resolve-after-abort-first")).status, 202);
    await eventually(() => jobs.length === 1);
    assert.equal((await postDelivery("delivery-resolve-after-abort-second")).status, 202);
    await eventually(() => firstJobSawAbort);
    await eventually(() => jobs.length === 2);
    assert.deepEqual(jobs, [
      "delivery-resolve-after-abort-first",
      "delivery-resolve-after-abort-second",
    ]);
    assert.deepEqual(
      readQueueFile(queuePath).map((job) => [job.deliveryId, job.status]),
      [
        ["delivery-resolve-after-abort-first", "completed"],
        ["delivery-resolve-after-abort-second", "completed"],
      ],
    );
  } finally {
    server.close();
  }
});

test("unsettled timed-out webhook jobs stop the worker instead of advancing the queue", async () => {
  const failures: unknown[] = [];
  const jobs: string[] = [];
  const queuePath = tempQueuePath();
  const server = startWebhookServer(
    {
      ...config,
      port: 0,
      webhookJobTimeoutMs: 5,
      webhookJobSettlementTimeoutMs: 5,
      webhookQueuePath: queuePath,
    },
    {
      runJob: async (job, _config, signal) => {
        jobs.push(job.deliveryId);
        if (job.deliveryId !== "delivery-unsettled-first") {
          return;
        }
        await new Promise<void>(() => {
          signal.addEventListener("abort", () => undefined, { once: true });
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
    assert.equal((await postDelivery("delivery-unsettled-first")).status, 202);
    await eventually(() => jobs.length === 1);
    assert.equal((await postDelivery("delivery-unsettled-second")).status, 202);
    await eventually(() => failures.length === 1);

    assert.ok(failures[0] instanceof WebhookJobSettlementTimeoutError);
    assert.deepEqual(jobs, ["delivery-unsettled-first"]);
    assert.deepEqual(
      readQueueFile(queuePath).map((job) => job.deliveryId),
      ["delivery-unsettled-first", "delivery-unsettled-second"],
    );
  } finally {
    server.close();
  }
});

test("queued webhook jobs report failures when they exceed the outer job timeout", async () => {
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
