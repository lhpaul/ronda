import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { REVIEW_COMMAND, type PublishCheckRunInput } from "../../../src/domain/review-pass.types.js";
import type { WebhookConfig } from "../../../src/webhook/webhook-config.js";
import {
  checkRunSignal,
  findExistingWebhookCheckRun,
  refreshRecoveredWebhookCheckRunInput,
  resolveWebhookJob,
  runWebhookReviewJob,
  withOuterAbortSignal,
} from "../../../src/webhook/webhook-job.js";

const HEAD_SHA = "a".repeat(40);

function checkRunInput(overrides: Partial<PublishCheckRunInput> = {}): PublishCheckRunInput {
  return {
    owner: "lhpaul",
    repo: "example",
    headSha: HEAD_SHA,
    existingCheckRunId: null,
    title: "Review posted",
    summary: "Ronda finished the review.",
    conclusion: "success",
    startedAt: "2026-09-11T00:00:00.000Z",
    completedAt: "2026-09-11T00:00:01.000Z",
    ...overrides,
  };
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    action: "synchronize",
    repository: { full_name: "lhpaul/example" },
    installation: { id: 42 },
    pull_request: { number: 7, head: { sha: HEAD_SHA } },
    ...overrides,
  };
}

test("maps a pull_request webhook to an automatic review job", () => {
  const decision = resolveWebhookJob("pull_request", "delivery-1", basePayload());

  assert.equal(decision.shouldRun, true);
  assert.deepEqual(decision.job, {
    owner: "lhpaul",
    repo: "example",
    pullNumber: 7,
    trigger: "automatic",
    headSha: HEAD_SHA,
    installationId: 42,
    deliveryId: "delivery-1",
  });
});

test("maps a review command issue_comment webhook to a manual review job", () => {
  const decision = resolveWebhookJob("issue_comment", "delivery-2", {
    action: "created",
    repository: { full_name: "lhpaul/example" },
    installation: { id: 42 },
    issue: { number: 8, pull_request: {} },
    comment: { body: REVIEW_COMMAND, author_association: "MEMBER" },
  });

  assert.equal(decision.shouldRun, true);
  assert.equal(decision.job?.pullNumber, 8);
  assert.equal(decision.job?.trigger, "manual");
  assert.equal(decision.job?.headSha, undefined);
});

test("keeps unsupported events as no-op decisions", () => {
  const decision = resolveWebhookJob("push", "delivery-3", basePayload());

  assert.equal(decision.shouldRun, false);
  assert.match(decision.reason ?? "", /unsupported event/);
});

test("keeps valid JSON non-object payloads as no-op decisions", () => {
  const decision = resolveWebhookJob("pull_request", "delivery-primitive", null);

  assert.equal(decision.shouldRun, false);
  assert.equal(decision.reason, "payload must be a JSON object");
});

test("rejects runnable events that do not include repository or installation context", () => {
  const missingRepository = resolveWebhookJob(
    "pull_request",
    "delivery-4",
    basePayload({ repository: undefined }),
  );
  const missingInstallation = resolveWebhookJob(
    "pull_request",
    "delivery-5",
    basePayload({ installation: undefined }),
  );

  assert.equal(missingRepository.shouldRun, false);
  assert.equal(missingRepository.reason, "payload missing repository.full_name");
  assert.equal(missingInstallation.shouldRun, false);
  assert.equal(missingInstallation.reason, "payload missing installation.id");
});

test("combines webhook job timeout signal into model calls", async () => {
  const outer = new AbortController();
  const pass = new AbortController();
  let observedSignal: AbortSignal | undefined;
  const model = withOuterAbortSignal(
    {
      modelName: "test-model",
      complete: async (_request, signal) => {
        observedSignal = signal;
        return "ok";
      },
    },
    outer.signal,
  );

  assert.equal(
    await model.complete({ systemPrompt: "system", userPrompt: "user" }, pass.signal),
    "ok",
  );
  assert.equal(observedSignal?.aborted, false);
  outer.abort(new Error("job timeout"));
  assert.equal(observedSignal?.aborted, true);
});

test("uses a fresh bounded signal for terminal check-run publication", () => {
  const pass = new AbortController();
  const combined = checkRunSignal(pass.signal);
  const terminal = checkRunSignal(undefined);

  assert.notEqual(combined, undefined);
  assert.notEqual(terminal, undefined);
  assert.equal(terminal?.aborted, false);
  assert.equal(combined?.aborted, false);
  pass.abort(new Error("pass timeout"));
  assert.equal(combined?.aborted, true);
});

test("terminal check-run publication starts with a fresh non-aborted signal", () => {
  const terminal = checkRunSignal(undefined);

  assert.notEqual(terminal, undefined);
  assert.equal(terminal?.aborted, false);
});

test("bounds stalled GitHub App installation-token requests", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const webhookConfig: WebhookConfig = {
    host: "127.0.0.1",
    port: 0,
    webhookSecret: "webhook-secret",
    githubAppId: "123",
    githubPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    githubAppTokenTimeoutMs: 20,
    webhookJobTimeoutMs: 900_000,
    webhookJobSettlementTimeoutMs: 30_000,
  };
  const originalFetch = globalThis.fetch;
  let observedSignal: AbortSignal | undefined;
  let rejectFetch: ((reason?: unknown) => void) | undefined;

  globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
    observedSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      rejectFetch = reject;
      observedSignal?.addEventListener(
        "abort",
        () => reject(new DOMException("The operation was aborted.", "AbortError")),
        { once: true },
      );
    });
  }) as typeof fetch;

  try {
    const watchdog = new Error("installation-token request was not aborted by its timeout");
    const jobPromise = runWebhookReviewJob(
      {
        owner: "lhpaul",
        repo: "example",
        pullNumber: 7,
        trigger: "automatic",
        installationId: 42,
        deliveryId: "delivery-token-timeout",
      },
      webhookConfig,
    ).then(
      () => new Error("webhook job unexpectedly completed"),
      (error: unknown) => error,
    );
    const result = await Promise.race([
      jobPromise,
      new Promise<Error>((resolve) => setTimeout(() => resolve(watchdog), 100)),
    ]);
    if (result === watchdog) {
      rejectFetch?.(new Error("test cleanup after missing timeout"));
      await jobPromise;
    }

    assert.notEqual(result, watchdog);
    assert.equal((result as { name?: string }).name, "AbortError");
    assert.equal(observedSignal?.aborted, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("automatic webhook duplicate lookup accepts any existing Ronda check run", async () => {
  const calls: Array<{ appId?: number } | undefined> = [];

  const id = await findExistingWebhookCheckRun("automatic", 42, async (options) => {
    calls.push(options);
    return 111;
  });

  assert.equal(id, 111);
  assert.deepEqual(calls, [undefined]);
});

test("automatic webhook update lookup falls back to the publishing GitHub App", async () => {
  const calls: Array<{ appId?: number } | undefined> = [];

  const id = await findExistingWebhookCheckRun("automatic", 42, async (options) => {
    calls.push(options);
    return options?.appId === 42 ? 222 : null;
  });

  assert.equal(id, 222);
  assert.deepEqual(calls, [undefined, { appId: 42 }]);
});

test("manual webhook check lookup only targets the publishing GitHub App", async () => {
  const calls: Array<{ appId?: number } | undefined> = [];

  const id = await findExistingWebhookCheckRun("manual", 42, async (options) => {
    calls.push(options);
    return options?.appId === 42 ? 222 : 111;
  });

  assert.equal(id, 222);
  assert.deepEqual(calls, [{ appId: 42 }]);
});

test("check-pending recovery refreshes the publishing App check run id before publishing", async () => {
  const signal = AbortSignal.timeout(30_000);
  const lookupCalls: Array<{
    owner: string;
    repo: string;
    headSha: string;
    signal: AbortSignal | undefined;
    appId?: number;
  }> = [];

  const refreshed = await refreshRecoveredWebhookCheckRunInput(
    checkRunInput({ existingCheckRunId: null }),
    42,
    signal,
    async (owner, repo, headSha, requestSignal, options) => {
      lookupCalls.push({ owner, repo, headSha, signal: requestSignal, appId: options.appId });
      return 333;
    },
  );

  assert.equal(refreshed.existingCheckRunId, 333);
  assert.deepEqual(lookupCalls, [
    { owner: "lhpaul", repo: "example", headSha: HEAD_SHA, signal, appId: 42 },
  ]);
});

test("check-pending recovery clears stale check run ids when lookup misses", async () => {
  const refreshed = await refreshRecoveredWebhookCheckRunInput(
    checkRunInput({ existingCheckRunId: 333 }),
    42,
    undefined,
    async () => null,
  );

  assert.equal(refreshed.existingCheckRunId, null);
});
