import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadWebhookConfig, WebhookConfigError, type WebhookConfig } from "./webhook-config.js";
import { verifyGithubSignature } from "./signature.js";
import { resolveWebhookJob, runWebhookReviewJob, type WebhookReviewJob } from "./webhook-job.js";

const MAX_BODY_BYTES = 10 * 1024 * 1024;
const MAX_SEEN_DELIVERY_IDS = 1_000;

export interface WebhookServerDeps {
  runJob?: (job: WebhookReviewJob, config: WebhookConfig) => Promise<void>;
  onJobFailure?: (error: unknown) => void;
  log?: Pick<Console, "error" | "log">;
}

export function startWebhookServer(
  config: WebhookConfig,
  deps: WebhookServerDeps = {},
): ReturnType<typeof createServer> {
  const log = deps.log ?? console;
  const runJob = deps.runJob ?? runWebhookReviewJob;
  let queue = Promise.resolve();
  let fatalError: unknown;
  const seenDeliveryIds = new Set<string>();

  const server = createServer(async (req, res) => {
    await handleWebhookRequest(req, res, config, {
      log,
      acceptDeliveryId: (deliveryId) => rememberDeliveryId(seenDeliveryIds, deliveryId),
      enqueue: (job) => {
        if (fatalError !== undefined) {
          return false;
        }
        queue = queue
          .then(() => {
            if (fatalError !== undefined) {
              return;
            }
            return runJob(job, config);
          })
          .catch((error: unknown) => {
            fatalError = error;
            log.error("Ronda webhook job failed", error);
            if (deps.onJobFailure) {
              deps.onJobFailure(error);
              return;
            }
            process.exitCode = 1;
            server.close();
          });
        return true;
      },
    });
  });

  server.listen(config.port, config.host, () => {
    log.log(`Ronda webhook listening on http://${config.host}:${config.port}`);
  });
  return server;
}

interface HandleWebhookRequestDeps {
  enqueue: (job: WebhookReviewJob) => boolean;
  acceptDeliveryId?: (deliveryId: string) => boolean;
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
    writeJson(res, 503, { ok: false, error: "webhook_worker_unavailable" });
    return;
  }
  writeJson(res, 202, { ok: true, queued: true, pullNumber: decision.job.pullNumber });
}

function readRequestBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`request body exceeded ${maxBytes} bytes`));
        req.destroy();
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

function rememberDeliveryId(seenDeliveryIds: Set<string>, deliveryId: string): boolean {
  if (seenDeliveryIds.has(deliveryId)) {
    return false;
  }
  seenDeliveryIds.add(deliveryId);
  if (seenDeliveryIds.size > MAX_SEEN_DELIVERY_IDS) {
    const oldestDeliveryId = seenDeliveryIds.values().next().value;
    if (oldestDeliveryId !== undefined) {
      seenDeliveryIds.delete(oldestDeliveryId);
    }
  }
  return true;
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
