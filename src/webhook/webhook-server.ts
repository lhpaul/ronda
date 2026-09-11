import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadWebhookConfig, WebhookConfigError, type WebhookConfig } from "./webhook-config.js";
import { verifyGithubSignature } from "./signature.js";
import { resolveWebhookJob, runWebhookReviewJob, type WebhookReviewJob } from "./webhook-job.js";

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_SEEN_DELIVERY_IDS = 1_000;
const MAX_PENDING_WEBHOOK_JOBS = 25;

export interface WebhookServerDeps {
  runJob?: (job: WebhookReviewJob, config: WebhookConfig, signal: AbortSignal) => Promise<void>;
  onJobFailure?: (error: unknown) => void;
  log?: Pick<Console, "error" | "log">;
}

export class WebhookJobTimeoutError extends Error {
  constructor(job: WebhookReviewJob, timeoutMs: number) {
    super(
      `Webhook review job timed out after ${timeoutMs}ms for ${job.owner}/${job.repo}#${job.pullNumber}`,
    );
    this.name = "WebhookJobTimeoutError";
  }
}

export class WebhookJobSettlementTimeoutError extends Error {
  constructor(job: WebhookReviewJob, timeoutMs: number) {
    super(
      `Webhook review job did not settle within ${timeoutMs}ms after timeout for ` +
        `${job.owner}/${job.repo}#${job.pullNumber}`,
    );
    this.name = "WebhookJobSettlementTimeoutError";
  }
}

export function startWebhookServer(
  config: WebhookConfig,
  deps: WebhookServerDeps = {},
): ReturnType<typeof createServer> {
  const log = deps.log ?? console;
  const runJob = deps.runJob ?? runWebhookReviewJob;
  let busy = false;
  let workerStopped = false;
  const pendingJobs: WebhookReviewJob[] = [];
  const deliveryIds: DeliveryIdState = {
    active: new Set<string>(),
    completed: new Set<string>(),
    completedOrder: [],
  };

  const server = createServer(async (req, res) => {
    await handleWebhookRequest(req, res, config, {
      log,
      acceptDeliveryId: (deliveryId) => reserveDeliveryId(deliveryIds, deliveryId),
      releaseDeliveryId: (deliveryId) => {
        deliveryIds.active.delete(deliveryId);
      },
      enqueue: (job) => {
        if (workerStopped) {
          return false;
        }
        if (busy) {
          if (pendingJobs.length >= MAX_PENDING_WEBHOOK_JOBS) {
            return false;
          }
          pendingJobs.push(job);
          return true;
        }
        runNextJob(job);
        return true;
      },
    });
  });

  const runNextJob = (job: WebhookReviewJob): void => {
    busy = true;
    void withJobTimeout(
      (signal) => runJob(job, config, signal),
      config.webhookJobTimeoutMs,
      () => new WebhookJobTimeoutError(job, config.webhookJobTimeoutMs),
      () => new WebhookJobSettlementTimeoutError(job, config.webhookJobSettlementTimeoutMs),
      config.webhookJobSettlementTimeoutMs,
    )
      .then(() => {
        completeDeliveryId(deliveryIds, job.deliveryId);
      })
      .catch((error: unknown) => {
        deliveryIds.active.delete(job.deliveryId);
        log.error("Ronda webhook job failed", error);
        deps.onJobFailure?.(error);
        if (error instanceof WebhookJobSettlementTimeoutError) {
          workerStopped = true;
          pendingJobs.length = 0;
          if (!deps.onJobFailure) {
            process.exitCode = 1;
          }
          server.close();
        }
      })
      .finally(() => {
        if (workerStopped) {
          return;
        }
        const nextJob = pendingJobs.shift();
        if (nextJob === undefined) {
          busy = false;
          return;
        }
        runNextJob(nextJob);
      });
  };

  server.listen(config.port, config.host, () => {
    log.log(`Ronda webhook listening on http://${config.host}:${config.port}`);
  });
  return server;
}

interface DeliveryIdState {
  active: Set<string>;
  completed: Set<string>;
  completedOrder: string[];
}

interface HandleWebhookRequestDeps {
  enqueue: (job: WebhookReviewJob) => boolean;
  acceptDeliveryId?: (deliveryId: string) => boolean;
  releaseDeliveryId?: (deliveryId: string) => void;
  log?: Pick<Console, "error">;
}

export async function handleWebhookRequest(
  req: IncomingMessage,
  res: ServerResponse,
  config: WebhookConfig,
  deps: HandleWebhookRequestDeps,
): Promise<void> {
  if (req.method === "GET" && req.url === "/healthz") {
    writeJson(res, 200, { ok: true });
    return;
  }
  if (req.method !== "POST" || req.url !== "/webhook") {
    writeJson(res, 404, { ok: false, error: "not_found" });
    return;
  }

  let body: Buffer;
  try {
    body = await readRequestBody(req, MAX_BODY_BYTES);
  } catch (error) {
    deps.log?.error("Ronda webhook body read failed", error);
    writeJson(res, 413, { ok: false, error: "body_too_large" });
    return;
  }

  if (
    !verifyGithubSignature({
      body,
      signatureHeader: req.headers["x-hub-signature-256"],
      secret: config.webhookSecret,
    })
  ) {
    writeJson(res, 401, { ok: false, error: "invalid_signature" });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    writeJson(res, 400, { ok: false, error: "invalid_json" });
    return;
  }

  const eventName = headerValue(req.headers["x-github-event"]);
  const deliveryId = headerValue(req.headers["x-github-delivery"]);
  if (eventName === undefined) {
    writeJson(res, 400, { ok: false, error: "missing_event" });
    return;
  }
  if (deliveryId === undefined) {
    writeJson(res, 400, { ok: false, error: "missing_delivery" });
    return;
  }

  const decision = resolveWebhookJob(eventName, deliveryId, payload);
  if (!decision.shouldRun || decision.job === undefined) {
    writeJson(res, 202, { ok: true, queued: false, reason: decision.reason });
    return;
  }
  if (deps.acceptDeliveryId && !deps.acceptDeliveryId(deliveryId)) {
    writeJson(res, 202, { ok: true, queued: false, reason: "duplicate_delivery" });
    return;
  }

  if (!deps.enqueue(decision.job)) {
    deps.releaseDeliveryId?.(deliveryId);
    writeJson(res, 503, { ok: false, error: "webhook_worker_unavailable" });
    return;
  }
  writeJson(res, 202, { ok: true, queued: true, pullNumber: decision.job.pullNumber });
}

function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let exceeded = false;
    req.on("data", (chunk: Buffer) => {
      if (exceeded) {
        return;
      }
      total += chunk.length;
      if (total > maxBytes) {
        exceeded = true;
        reject(new Error(`request body exceeded ${maxBytes} bytes`));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", reject);
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function reserveDeliveryId(deliveryIds: DeliveryIdState, deliveryId: string): boolean {
  if (deliveryIds.active.has(deliveryId) || deliveryIds.completed.has(deliveryId)) {
    return false;
  }
  deliveryIds.active.add(deliveryId);
  return true;
}

function completeDeliveryId(deliveryIds: DeliveryIdState, deliveryId: string): void {
  if (!deliveryIds.active.delete(deliveryId)) {
    return;
  }
  deliveryIds.completed.add(deliveryId);
  deliveryIds.completedOrder.push(deliveryId);
  while (deliveryIds.completedOrder.length > MAX_SEEN_DELIVERY_IDS) {
    const oldestDeliveryId = deliveryIds.completedOrder.shift();
    if (oldestDeliveryId !== undefined) {
      deliveryIds.completed.delete(oldestDeliveryId);
    }
  }
}

async function withJobTimeout(
  runJob: (signal: AbortSignal) => Promise<void>,
  timeoutMs: number,
  createError: () => Error,
  createSettlementError: () => Error,
  settlementTimeoutMs: number,
): Promise<void> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  let settlementTimeout: NodeJS.Timeout | undefined;
  const jobPromise = runJob(controller.signal);
  const timeoutPromise = new Promise<{ timedOut: true; error: Error }>((resolve) => {
    timeout = setTimeout(() => {
      const error = createError();
      controller.abort(error);
      resolve({ timedOut: true, error });
    }, timeoutMs);
    timeout.unref?.();
  });
  try {
    const result = await Promise.race([
      jobPromise.then(() => ({ timedOut: false as const })),
      timeoutPromise,
    ]);
    if (!result.timedOut) {
      return;
    }

    const settled = await Promise.race([
      jobPromise.then(
        () => true,
        () => true,
      ),
      new Promise<boolean>((resolve) => {
        settlementTimeout = setTimeout(() => resolve(false), settlementTimeoutMs);
        settlementTimeout.unref?.();
      }),
    ]);
    if (!settled) {
      jobPromise.catch(() => undefined);
      throw createSettlementError();
    }
    throw result.error;
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (settlementTimeout !== undefined) {
      clearTimeout(settlementTimeout);
    }
  }
}

function writeJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json");
  res.end(`${JSON.stringify(body)}\n`);
}

if (process.argv[1] && process.argv[1].endsWith("webhook-server.ts")) {
  try {
    startWebhookServer(loadWebhookConfig());
  } catch (error) {
    if (error instanceof WebhookConfigError) {
      console.error(`Ronda webhook config error: ${error.message}`);
      process.exitCode = 1;
  } else {
    throw error;
  }
}
}
