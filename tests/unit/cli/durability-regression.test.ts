import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  classifyDurabilityFindings,
  forcedActiveDurabilityMode,
  runDurabilityRegression,
} from "../../../src/cli/durability-regression.js";

const MODE_TEXT = readFileSync(
  "docs/workflow/development-workflow/durability-idempotency-review-mode.md",
  "utf8",
);

test("forcedActiveDurabilityMode activates with operator override", () => {
  const mode = forcedActiveDurabilityMode(MODE_TEXT, ["docs/only.md"]);
  assert.equal(mode.state, "active");
  assert.equal(mode.activationReason, "operator_override");
});

test("classifyDurabilityFindings requires every expected keyword", () => {
  const found = classifyDurabilityFindings({
    shapeId: "fatal_queue_drain",
    expectedKeywords: ["fatal", "queue", "drain", "discard"],
    expectedSeverity: "blocking",
    findings: [
      {
        path: "src/fixtures/fatal_queue_drain.ts",
        line: 1,
        severity: "blocking",
        title: "Fatal error still drains queue",
        body: "After a fatal failure the worker continues draining queued jobs instead of discarding them.",
      },
    ],
  });
  assert.equal(found.found, 1);
  assert.equal(found.missed, 0);
  assert.deepEqual(found.matchedKeywords, ["fatal", "queue", "drain", "discard"]);

  const genericOnly = classifyDurabilityFindings({
    shapeId: "fatal_queue_drain",
    expectedKeywords: ["fatal", "queue", "drain", "discard"],
    expectedSeverity: "blocking",
    findings: [
      {
        path: "src/fixtures/fatal_queue_drain.ts",
        line: 1,
        severity: "blocking",
        title: "Consider a queue",
        body: "A queue might help throughput.",
      },
    ],
  });
  assert.equal(genericOnly.found, 0);
  assert.equal(genericOnly.missed, 1);
  assert.deepEqual(genericOnly.matchedKeywords, ["queue"]);

  const wrongSeverity = classifyDurabilityFindings({
    shapeId: "fatal_queue_drain",
    expectedKeywords: ["fatal", "queue", "drain", "discard"],
    expectedSeverity: "blocking",
    findings: [
      {
        path: "src/fixtures/fatal_queue_drain.ts",
        line: 1,
        severity: "nit",
        title: "Fatal error still drains queue",
        body: "After a fatal failure the worker continues draining queued jobs instead of discarding them.",
      },
    ],
  });
  assert.equal(wrongSeverity.found, 0);
  assert.equal(wrongSeverity.missed, 1);

  const splitAcrossFindings = classifyDurabilityFindings({
    shapeId: "fatal_queue_drain",
    expectedKeywords: ["fatal", "queue", "drain", "discard"],
    expectedSeverity: "blocking",
    findings: [
      {
        path: "src/fixtures/fatal_queue_drain.ts",
        line: 1,
        severity: "blocking",
        title: "Fatal error",
        body: "Something went wrong.",
      },
      {
        path: "src/fixtures/fatal_queue_drain.ts",
        line: 2,
        severity: "blocking",
        title: "Queue note",
        body: "Mentions a queue only.",
      },
      {
        path: "src/fixtures/fatal_queue_drain.ts",
        line: 3,
        severity: "blocking",
        title: "Drain note",
        body: "Mentions drain only.",
      },
      {
        path: "src/fixtures/fatal_queue_drain.ts",
        line: 4,
        severity: "blocking",
        title: "Discard note",
        body: "Mentions discard only.",
      },
    ],
  });
  assert.equal(splitAcrossFindings.found, 0);
  assert.equal(splitAcrossFindings.missed, 1);

  const wrongPath = classifyDurabilityFindings({
    shapeId: "fatal_queue_drain",
    expectedKeywords: ["fatal", "queue", "drain", "discard"],
    expectedSeverity: "blocking",
    targetPaths: ["src/fixtures/fatal_queue_drain.ts"],
    findings: [
      {
        path: "README.md",
        line: 1,
        severity: "blocking",
        title: "Fatal error still drains queue",
        body: "After a fatal failure the worker continues draining queued jobs instead of discarding them.",
      },
    ],
  });
  assert.equal(wrongPath.found, 0);
  assert.equal(wrongPath.missed, 1);
});

test("runDurabilityRegression reports found for each shape with fake model output", async () => {
  const fakeResponses: Record<string, string> = {
    dual_ingress_arbitration: JSON.stringify({
      findings: [
        {
          path: "src/fixtures/dual_ingress_arbitration.ts",
          line: 1,
          severity: "blocking",
          title: "Dual ingress without arbitration",
          body: "Manual and webhook ingress both trigger duplicate reviews.",
        },
      ],
    }),
    fatal_queue_drain: JSON.stringify({
      findings: [
        {
          path: "src/fixtures/fatal_queue_drain.ts",
          line: 1,
          severity: "blocking",
          title: "Fatal queue drain",
          body: "Fatal errors still drain the queue instead of discarding work.",
        },
      ],
    }),
    delivery_replay_manual: JSON.stringify({
      findings: [
        {
          path: "src/fixtures/delivery_replay_manual.ts",
          line: 1,
          severity: "blocking",
          title: "Delivery replay on manual path",
          body: "Replayed delivery identifiers bypass dedup on the manual path.",
        },
      ],
    }),
    outer_job_timeout: JSON.stringify({
      findings: [
        {
          path: "src/fixtures/outer_job_timeout.ts",
          line: 1,
          severity: "important",
          title: "Outer job timeout missing",
          body: "No outer watchdog budget surrounds the long-running pass.",
        },
      ],
    }),
    partial_publish_recovery: JSON.stringify({
      findings: [
        {
          path: "src/fixtures/partial_publish_recovery.ts",
          line: 1,
          severity: "blocking",
          title: "Partial publish on recovery",
          body: "Recovery republishes after a partial publish success and can create duplicate reviews.",
        },
      ],
    }),
    transient_token_retry: JSON.stringify({
      findings: [
        {
          path: "src/fixtures/transient_token_retry.ts",
          line: 1,
          severity: "important",
          title: "Transient auth not retried",
          body: "Transient token failures tear down the worker instead of bounded retry.",
        },
      ],
    }),
  };

  const summary = await runDurabilityRegression({
    modeText: MODE_TEXT,
    fakeResponses,
  });
  assert.equal(summary.shapes.length, 6);
  assert.equal(summary.allFound, true);
  for (const shape of summary.shapes) {
    assert.equal(shape.found, 1, shape.id);
  }
});
