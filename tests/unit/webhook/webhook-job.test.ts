import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_COMMAND } from "../../../src/domain/review-pass.types.js";
import { resolveWebhookJob } from "../../../src/webhook/webhook-job.js";

const HEAD_SHA = "a".repeat(40);

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
    comment: { body: REVIEW_COMMAND },
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

