import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_COMMAND, resolveTrigger } from "../../../src/cli/resolve-trigger.js";

function issueComment(body: string, overrides: Record<string, unknown> = {}) {
  return {
    action: "created",
    issue: { number: 7, pull_request: {} },
    comment: { body, author_association: "MEMBER" },
    ...overrides,
  };
}

test("T1: issue_comment body exactly the review command resolves to manual", () => {
  const decision = resolveTrigger("issue_comment", issueComment(REVIEW_COMMAND));
  assert.deepEqual(decision, { shouldRun: true, pullNumber: 7, trigger: "manual" });
});

test("T2: surrounding whitespace is trimmed", () => {
  const decision = resolveTrigger("issue_comment", issueComment(`  ${REVIEW_COMMAND}  `));
  assert.equal(decision.shouldRun, true);
  assert.equal(decision.trigger, "manual");
});

test("T3: the command is matched case-insensitively", () => {
  const decision = resolveTrigger("issue_comment", issueComment("/Ronda Review"));
  assert.equal(decision.shouldRun, true);
});

test("T4: the phrase embedded in a longer sentence does not match", () => {
  const decision = resolveTrigger(
    "issue_comment",
    issueComment("please run /ronda review when you can"),
  );
  assert.equal(decision.shouldRun, false);
});

test("T5: a quoted reply line is skipped, and no unquoted command line follows", () => {
  const decision = resolveTrigger("issue_comment", issueComment(`> ${REVIEW_COMMAND}`));
  assert.equal(decision.shouldRun, false);
});

test("T6: leading blank lines are skipped before finding the command", () => {
  const decision = resolveTrigger("issue_comment", issueComment(`\n\n${REVIEW_COMMAND}`));
  assert.equal(decision.shouldRun, true);
  assert.equal(decision.trigger, "manual");
});

test("T7: issue_comment on an issue that is not a pull request does not run", () => {
  const decision = resolveTrigger(
    "issue_comment",
    issueComment(REVIEW_COMMAND, { issue: { number: 7 } }),
  );
  assert.equal(decision.shouldRun, false);
});

test("T8: issue_comment from an untrusted author association does not run", () => {
  const decision = resolveTrigger(
    "issue_comment",
    issueComment(REVIEW_COMMAND, { comment: { body: REVIEW_COMMAND, author_association: "CONTRIBUTOR" } }),
  );
  assert.deepEqual(decision, {
    shouldRun: false,
    reason: "comment author cannot request manual reviews",
  });
});

test("T9: issue_comment without an author association does not run", () => {
  const decision = resolveTrigger(
    "issue_comment",
    issueComment(REVIEW_COMMAND, { comment: { body: REVIEW_COMMAND } }),
  );
  assert.deepEqual(decision, {
    shouldRun: false,
    reason: "comment author cannot request manual reviews",
  });
});

test("T10: a pull_request event with draft true still resolves to automatic", () => {
  const decision = resolveTrigger("pull_request", {
    action: "ready_for_review",
    pull_request: { number: 9, draft: true },
  });
  assert.deepEqual(decision, { shouldRun: true, pullNumber: 9, trigger: "automatic" });
});

test("T11: a pull_request action outside the four handled types does not run", () => {
  const decision = resolveTrigger("pull_request", {
    action: "closed",
    pull_request: { number: 9 },
  });
  assert.equal(decision.shouldRun, false);
});

test("T12: a payload missing the pull request number does not run and is not thrown", () => {
  assert.doesNotThrow(() => {
    const decision = resolveTrigger("pull_request", { action: "opened", pull_request: {} });
    assert.equal(decision.shouldRun, false);
  });
});

test("an unsupported event name does not run", () => {
  const decision = resolveTrigger("push", {});
  assert.equal(decision.shouldRun, false);
});

// --- Issue #11: the head SHA carried by a pull_request event is threaded
// through so a first-readPullRequest abort still has a SHA to publish a
// failure check run against. ---

test("T13: a pull_request event carrying pull_request.head.sha threads it through as headSha", () => {
  const decision = resolveTrigger("pull_request", {
    action: "synchronize",
    pull_request: { number: 9, head: { sha: "d".repeat(40) } },
  });
  assert.deepEqual(decision, {
    shouldRun: true,
    pullNumber: 9,
    trigger: "automatic",
    headSha: "d".repeat(40),
  });
});

test("T14: a pull_request event with no head.sha omits headSha entirely (not undefined-valued)", () => {
  const decision = resolveTrigger("pull_request", {
    action: "opened",
    pull_request: { number: 9 },
  });
  assert.equal(decision.headSha, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(decision, "headSha"), false);
});

test("T15: issue_comment events never carry a headSha (the payload shape has none)", () => {
  const decision = resolveTrigger("issue_comment", issueComment(REVIEW_COMMAND));
  assert.equal(decision.headSha, undefined);
});
