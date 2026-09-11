import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { loadWebhookConfig, WebhookConfigError, type WebhookConfig } from "./webhook-config.js";
import { verifyGithubSignature } from "./signature.js";
import { resolveWebhookJob, runWebhookReviewJob, type WebhookReviewJob } from "./webhook-job.js";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export interface WebhookServerDeps {
  runJob?: (job: WebhookReviewJob, config: WebhookConfig) => Promise<void>;
  log?: Pick<Console, "error" | "log">;
}

export function startWebhookServer(
  config: WebhookConfig,
  deps: WebhookServerDeps = {},
): ReturnType<typeof createServer> {
  const log = deps.log ?? console;
  const runJob = deps.runJob ?? runWebhookReviewJob;
  let queue = Promise.resolve();

  const server = createServer(async (req, res) => {
    await handleWebhookRequest(req, res, config, {
      log,
      enqueue: (job) => {
        queue = queue
          .then(() => runJob(job, config))
          .catch((error: unknown) => {
            log.error("Ronda webhook job failed", error);
          });
      },
    });
  });

  server.listen(config.port, config.host, () => {
    log.log(`Ronda webhook listening on http://${config.host}:${config.port}`);
  });
  return server;
}

interface HandleWebhookRequestDeps {
  enqueue: (job: WebhookReviewJob) => void;
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
  const deliveryId = headerValue(req.headers["x-github-delivery"]) ?? "unknown";
  if (eventName === undefined) {
    writeJson(res, 400, { ok: false, error: "missing_event" });
    return;
  }

  const decision = resolveWebhookJob(eventName, deliveryId, payload);
  if (!decision.shouldRun || decision.job === undefined) {
    writeJson(res, 202, { ok: true, queued: false, reason: decision.reason });
    return;
  }

  deps.enqueue(decision.job);
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

