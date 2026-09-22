import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adjudicateMissRecord,
  canDeleteMissRecord,
  mergeJudgementFields,
  runCaptureDecisionGate,
} from "../../../src/quality/miss-capture-gate.js";
import { resolveRondaResultHead } from "../../../src/quality/miss-github-evidence.js";
import {
  automaticIdentityKey,
  manualIdentityKey,
  type ExternalReviewMissRecord,
} from "../../../src/quality/miss-record.js";
import { isCodexGithubReviewer } from "../../../src/quality/miss-reviewer-aliases.js";
import type { PullRequestEvidence } from "../../../src/quality/miss-github-evidence.js";

const HEAD_A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HEAD_B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const HEAD_C = "cccccccccccccccccccccccccccccccccccccccc";

function evidence(overrides: Partial<PullRequestEvidence> = {}): PullRequestEvidence {
  return {
    repository: "lhpaul/ronda",
    pullNumber: 53,
    currentHeadSha: HEAD_A,
    baseRef: "develop",
    baseSha: "dddddddddddddddddddddddddddddddddddddddd",
    pushOrderedHeadShas: [HEAD_B, HEAD_A],
    rondaResultHeadShas: [HEAD_A],
    rondaReviewBodyByHeadSha: new Map(),
    ...overrides,
  };
}

function emptyCorpus() {
  return { changedFileContents: [] as string[], diffText: "" };
}

function baseManual(overrides: Record<string, unknown> = {}) {
  return {
    path: "manual" as const,
    evidence: evidence(),
    namedReviewer: "human-reviewer",
    manualFinding: {
      externalReviewer: "human-reviewer",
      location: "src/example.ts:10",
      text: "Missing idempotency key on retry.",
      affectedCategory: "idempotency",
      ...overrides,
    },
    existingRecords: [] as ExternalReviewMissRecord[],
    corpusForHead: () => emptyCorpus(),
    mergeBaseForHead: () => "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
  };
}

test("AC39 closed reviewer alias list is case and whitespace insensitive", () => {
  assert.equal(isCodexGithubReviewer("codex"), true);
  assert.equal(isCodexGithubReviewer("  Codex-GitHub  "), true);
  assert.equal(isCodexGithubReviewer("chatgpt-codex-connector[bot]"), true);
  assert.equal(isCodexGithubReviewer("bugbot"), false);
});

test("AC37 Ronda result head fallback uses push-order only", () => {
  // HEAD_C has a Ronda result but was pushed before HEAD_B; HEAD_B is newer
  // without a Ronda result. Reviewed HEAD_A has no Ronda result → fallback to
  // HEAD_B? No — only heads with Ronda results; newest push among those is HEAD_C
  // if push order is [HEAD_C, HEAD_B, HEAD_A] and only HEAD_C has Ronda.
  const resolved = resolveRondaResultHead({
    reviewedHeadSha: HEAD_A,
    pushOrderedHeadShas: [HEAD_C, HEAD_B, HEAD_A],
    rondaResultHeadShas: [HEAD_C],
  });
  assert.equal(resolved, HEAD_C);

  // Same-head wins over a newer other head.
  assert.equal(
    resolveRondaResultHead({
      reviewedHeadSha: HEAD_B,
      pushOrderedHeadShas: [HEAD_C, HEAD_B, HEAD_A],
      rondaResultHeadShas: [HEAD_C, HEAD_B],
    }),
    HEAD_B,
  );

  // Newer pushed Ronda head wins over older even if older commit timestamp
  // would sort differently — we only consult push order.
  assert.equal(
    resolveRondaResultHead({
      reviewedHeadSha: HEAD_A,
      pushOrderedHeadShas: [HEAD_C, HEAD_B],
      rondaResultHeadShas: [HEAD_C, HEAD_B],
    }),
    HEAD_B,
  );

  // Fail closed: never fall back to reviews/publish order when Ronda heads are
  // absent from push order (e.g. force-pushed away from commits API alone).
  // rondaResultHeadShas listed as [A, B] with A published last must not yield A.
  assert.equal(
    resolveRondaResultHead({
      reviewedHeadSha: HEAD_A,
      pushOrderedHeadShas: [HEAD_A],
      rondaResultHeadShas: [HEAD_C, HEAD_B],
    }),
    null,
  );
});

test("AC41 manual identity uses full pre-truncation text digest", () => {
  const sharedPrefix = "x".repeat(2000);
  const first = runCaptureDecisionGate(
    baseManual({ text: `${sharedPrefix}DISTINCT_TAIL_ONE` }),
  );
  const second = runCaptureDecisionGate({
    ...baseManual({ text: `${sharedPrefix}DISTINCT_TAIL_TWO` }),
    existingRecords: [first.findings[0]!.record!],
  });
  assert.equal(first.findings[0]?.outcome, "record_written");
  assert.equal(second.findings[0]?.outcome, "record_written");
  assert.notEqual(first.findings[0]?.record?.id, second.findings[0]?.record?.id);
  assert.ok(first.findings[0]?.record?.identityDigest?.startsWith("manual:"));
  assert.notEqual(
    first.findings[0]?.record?.identityDigest,
    second.findings[0]?.record?.identityDigest,
  );

  // Same full text (case/whitespace only) updates in place.
  const same = runCaptureDecisionGate({
    ...baseManual({ text: `  ${sharedPrefix}DISTINCT_TAIL_ONE  ` }),
    existingRecords: [first.findings[0]!.record!],
  });
  assert.equal(same.findings[0]?.outcome, "record_updated");
  assert.equal(same.findings[0]?.record?.id, first.findings[0]?.record?.id);
});

test("Stage 1 conditions: unresolved reviewer, no Ronda, unsupported, silence, unparseable", () => {
  const noReviewer = runCaptureDecisionGate({
    ...baseManual(),
    namedReviewer: "",
    manualFinding: {
      externalReviewer: "",
      location: "x",
      text: "y",
      affectedCategory: "other",
    },
  });
  assert.equal(noReviewer.wholeCapture?.outcome, "capture_refused");
  assert.match(noReviewer.wholeCapture?.reason ?? "", /reviewer name is required/);

  const noRonda = runCaptureDecisionGate({
    ...baseManual(),
    evidence: evidence({ rondaResultHeadShas: [] }),
  });
  assert.equal(noRonda.wholeCapture?.outcome, "capture_refused");
  assert.match(noRonda.wholeCapture?.reason ?? "", /no Ronda result/);

  const unsupported = runCaptureDecisionGate({
    path: "automatic",
    evidence: evidence(),
    namedReviewer: "bugbot",
    automatic: {
      supported: false,
      presentOnPullRequest: false,
      findingsOnCurrentHead: [],
      unparseableOnCurrentHead: false,
    },
    existingRecords: [],
    corpusForHead: () => emptyCorpus(),
    mergeBaseForHead: () => "ee",
  });
  assert.equal(unsupported.wholeCapture?.outcome, "capture_refused");
  assert.match(unsupported.wholeCapture?.reason ?? "", /Codex GitHub/);

  const silent = runCaptureDecisionGate({
    path: "automatic",
    evidence: evidence(),
    namedReviewer: "codex",
    automatic: {
      supported: true,
      presentOnPullRequest: true,
      findingsOnCurrentHead: [],
      unparseableOnCurrentHead: false,
    },
    existingRecords: [],
    corpusForHead: () => emptyCorpus(),
    mergeBaseForHead: () => "ee",
  });
  assert.equal(silent.wholeCapture?.outcome, "nothing_to_capture");

  const unparseable = runCaptureDecisionGate({
    path: "automatic",
    evidence: evidence(),
    namedReviewer: "codex",
    automatic: {
      supported: true,
      presentOnPullRequest: true,
      findingsOnCurrentHead: [],
      unparseableOnCurrentHead: true,
    },
    existingRecords: [],
    corpusForHead: () => emptyCorpus(),
    mergeBaseForHead: () => "ee",
  });
  assert.equal(unparseable.wholeCapture?.outcome, "capture_refused");
  assert.match(unparseable.wholeCapture?.reason ?? "", /could not be interpreted/);
});

test("manual capture writes record with defaults and derived title", () => {
  const result = runCaptureDecisionGate(baseManual({ title: undefined }));
  assert.equal(result.findings[0]?.outcome, "record_written");
  const record = result.findings[0]?.record;
  assert.ok(record);
  assert.equal(record.verdict, "unadjudicated");
  assert.equal(record.intendedFollowUp, "undecided");
  assert.equal(record.captureSource, "manual");
  assert.equal(record.sourceId, null);
  assert.equal(record.title, "Missing idempotency key on retry.");
  assert.equal(record.staleEvidence, false);
});

test("AC8 stale marker when reviewed head differs from Ronda result head", () => {
  const result = runCaptureDecisionGate(
    baseManual({ reviewedHeadSha: HEAD_B }),
  );
  // HEAD_B is a known PR head; Ronda only on HEAD_A → stale
  assert.equal(result.findings[0]?.outcome, "record_written");
  assert.equal(result.findings[0]?.record?.staleEvidence, true);
  assert.equal(result.findings[0]?.record?.reviewedHeadSha, HEAD_B);
  // AC53: stored Ronda result head is the fallback head, not the reviewed head
  assert.equal(result.findings[0]?.record?.rondaResultHeadSha, HEAD_A);
  assert.notEqual(
    result.findings[0]?.record?.reviewedHeadSha,
    result.findings[0]?.record?.rondaResultHeadSha,
  );
});

test("same-head abbreviated SHA does not mark stale evidence", () => {
  const abbreviated = HEAD_A.slice(0, 12);
  const result = runCaptureDecisionGate(
    baseManual({ reviewedHeadSha: abbreviated }),
  );
  assert.equal(result.findings[0]?.outcome, "record_written");
  assert.equal(result.findings[0]?.record?.staleEvidence, false);
  assert.equal(result.findings[0]?.record?.rondaResultHeadSha, HEAD_A);
});

test("AC9 / AC11 scan-before-truncate refused for title and long text", () => {
  const secretTail = 'password = "s3cret-beyond-title"';
  const longTitleLine = `${"x".repeat(130)} ${secretTail}`;
  const titleOnly = runCaptureDecisionGate(
    baseManual({
      title: longTitleLine,
      text: "Safe finding body without credentials.",
    }),
  );
  assert.equal(titleOnly.findings[0]?.outcome, "capture_refused");
  assert.match(titleOnly.findings[0]?.reason ?? "", /field 'title'/);

  const beyondBound = `${"safe line\n".repeat(250)}${secretTail}`;
  const textOnly = runCaptureDecisionGate(baseManual({ text: beyondBound }));
  assert.equal(textOnly.findings[0]?.outcome, "capture_refused");
  assert.match(textOnly.findings[0]?.reason ?? "", /credential/);
});

test("AC20 derived title truncates to 120 after a clean scan", () => {
  const longSafe = `Safe derived title ${"word ".repeat(40)}end`;
  const result = runCaptureDecisionGate(
    baseManual({ title: undefined, text: `${longSafe}\nsecond line` }),
  );
  assert.equal(result.findings[0]?.outcome, "record_written");
  assert.equal(result.findings[0]?.record?.title.length, 120);
  assert.equal(result.findings[0]?.record?.title, longSafe.slice(0, 120));
});

test("AC31 refuses malformed / unknown reviewed head", () => {
  const result = runCaptureDecisionGate(
    baseManual({ reviewedHeadSha: "not-a-real-head" }),
  );
  assert.equal(result.findings[0]?.outcome, "capture_refused");
  assert.match(result.findings[0]?.reason ?? "", /never a head/);

  // Single matching hex character is malformed — must not prefix-match (AC31).
  const singleHex = runCaptureDecisionGate(
    baseManual({ reviewedHeadSha: "a" }),
  );
  assert.equal(singleHex.findings[0]?.outcome, "capture_refused");
  assert.match(singleHex.findings[0]?.reason ?? "", /malformed|never a head/);
});

test("malformed reviewed head is refused before credential scan on same value", () => {
  const tokenHead = runCaptureDecisionGate(
    baseManual({ reviewedHeadSha: "ghp_notarealheadbutlookslikeatoken" }),
  );
  assert.equal(tokenHead.findings[0]?.outcome, "capture_refused");
  assert.match(
    tokenHead.findings[0]?.reason ?? "",
    /malformed|never a head/,
  );
  assert.doesNotMatch(tokenHead.findings[0]?.reason ?? "", /credential/i);
});

test("AC39 manual identity collapses Codex reviewer aliases", () => {
  const first = runCaptureDecisionGate(
    baseManual({ externalReviewer: "chatgpt-codex-connector[bot]" }),
  );
  assert.equal(first.findings[0]?.outcome, "record_written");
  const written = first.findings[0]!.record!;

  const alias = runCaptureDecisionGate({
    ...baseManual({ externalReviewer: "Codex" }),
    existingRecords: [written],
  });
  assert.equal(alias.findings[0]?.outcome, "record_updated");
  assert.equal(alias.findings[0]?.record?.id, written.id);
  assert.equal(alias.findings[0]?.record?.externalReviewer, "Codex");

  const nonAlias = runCaptureDecisionGate({
    ...baseManual({ externalReviewer: "Codex Bot" }),
    existingRecords: [written],
  });
  assert.equal(nonAlias.findings[0]?.outcome, "record_written");
  assert.notEqual(nonAlias.findings[0]?.record?.id, written.id);
});

test("AC30 manual identity unifies abbreviated and full reviewed head", () => {
  const full = runCaptureDecisionGate(
    baseManual({ reviewedHeadSha: HEAD_A }),
  );
  assert.equal(full.findings[0]?.outcome, "record_written");
  const written = full.findings[0]!.record!;

  const abbreviated = runCaptureDecisionGate({
    ...baseManual({ reviewedHeadSha: HEAD_A.slice(0, 12) }),
    existingRecords: [written],
  });
  assert.equal(abbreviated.findings[0]?.outcome, "record_updated");
  assert.equal(abbreviated.findings[0]?.record?.id, written.id);
});

test("AC13 / AC46 refuse missing or invalid category", () => {
  const missing = runCaptureDecisionGate(
    baseManual({ affectedCategory: undefined }),
  );
  assert.equal(missing.findings[0]?.outcome, "capture_refused");
  assert.match(missing.findings[0]?.reason ?? "", /affectedCategory/);

  const invalid = runCaptureDecisionGate(
    baseManual({ affectedCategory: "not-a-category" }),
  );
  assert.equal(invalid.findings[0]?.outcome, "capture_refused");
  assert.match(invalid.findings[0]?.reason ?? "", /affected category must be/);
});

test("AC12 / AC41 automatic source identity updates; distinct source ids separate", () => {
  const first = runCaptureDecisionGate({
    path: "automatic",
    evidence: evidence(),
    namedReviewer: "codex",
    automatic: {
      supported: true,
      presentOnPullRequest: true,
      unparseableOnCurrentHead: false,
      findingsOnCurrentHead: [
        {
          sourceId: "rev-1:0",
          externalReviewer: "chatgpt-codex-connector[bot]",
          reviewedHeadSha: HEAD_A,
          location: "src/a.ts:1",
          locationUnresolved: false,
          title: "First",
          text: "Finding one body",
        },
      ],
    },
    automaticDefaults: { affectedCategory: "correctness" },
    existingRecords: [],
    corpusForHead: () => emptyCorpus(),
    mergeBaseForHead: () => "ee",
  });
  assert.equal(first.findings[0]?.outcome, "record_written");
  const written = first.findings[0]!.record!;

  const update = runCaptureDecisionGate({
    path: "automatic",
    evidence: evidence(),
    namedReviewer: "codex",
    automatic: {
      supported: true,
      presentOnPullRequest: true,
      unparseableOnCurrentHead: false,
      findingsOnCurrentHead: [
        {
          sourceId: "rev-1:0",
          externalReviewer: "chatgpt-codex-connector[bot]",
          reviewedHeadSha: HEAD_A,
          location: "src/a.ts:2",
          locationUnresolved: false,
          title: "First edited",
          text: "Finding one body edited",
        },
      ],
    },
    automaticDefaults: { affectedCategory: "security" },
    existingRecords: [written],
    corpusForHead: () => emptyCorpus(),
    mergeBaseForHead: () => "ee",
  });
  assert.equal(update.findings[0]?.outcome, "record_updated");
  assert.equal(update.findings[0]?.record?.id, written.id);
  assert.equal(update.findings[0]?.record?.affectedCategory, "security");
  assert.equal(update.findings[0]?.record?.title, "First edited");

  const second = runCaptureDecisionGate({
    path: "automatic",
    evidence: evidence(),
    namedReviewer: "codex",
    automatic: {
      supported: true,
      presentOnPullRequest: true,
      unparseableOnCurrentHead: false,
      findingsOnCurrentHead: [
        {
          sourceId: "rev-1:1",
          externalReviewer: "chatgpt-codex-connector[bot]",
          reviewedHeadSha: HEAD_A,
          location: "src/a.ts:1",
          locationUnresolved: false,
          title: "Second",
          text: "Finding two body",
        },
      ],
    },
    automaticDefaults: { affectedCategory: "correctness" },
    existingRecords: [written],
    corpusForHead: () => emptyCorpus(),
    mergeBaseForHead: () => "ee",
  });
  assert.equal(second.findings[0]?.outcome, "record_written");
  assert.notEqual(second.findings[0]?.record?.id, written.id);
});

test("automatic multi-finding capture requires per-finding categories", () => {
  const refused = runCaptureDecisionGate({
    path: "automatic",
    evidence: evidence(),
    namedReviewer: "codex",
    automatic: {
      supported: true,
      presentOnPullRequest: true,
      unparseableOnCurrentHead: false,
      findingsOnCurrentHead: [
        {
          sourceId: "c:0",
          externalReviewer: "codex",
          reviewedHeadSha: HEAD_A,
          location: "a.ts:1",
          locationUnresolved: false,
          title: "One",
          text: "Body one",
        },
        {
          sourceId: "c:1",
          externalReviewer: "codex",
          reviewedHeadSha: HEAD_A,
          location: "b.ts:2",
          locationUnresolved: false,
          title: "Two",
          text: "Body two",
        },
      ],
    },
    automaticDefaults: { affectedCategory: "correctness" },
    existingRecords: [],
    corpusForHead: () => emptyCorpus(),
    mergeBaseForHead: () => "ee",
  });
  assert.equal(refused.wholeCapture?.outcome, "capture_refused");
  assert.match(refused.wholeCapture?.reason ?? "", /--categories/);

  const withCategories = runCaptureDecisionGate({
    path: "automatic",
    evidence: evidence(),
    namedReviewer: "codex",
    automatic: {
      supported: true,
      presentOnPullRequest: true,
      unparseableOnCurrentHead: false,
      findingsOnCurrentHead: [
        {
          sourceId: "c:0",
          externalReviewer: "codex",
          reviewedHeadSha: HEAD_A,
          location: "a.ts:1",
          locationUnresolved: false,
          title: "One",
          text: "Body one",
        },
        {
          sourceId: "c:1",
          externalReviewer: "codex",
          reviewedHeadSha: HEAD_A,
          location: "b.ts:2",
          locationUnresolved: false,
          title: "Two",
          text: "Body two",
        },
      ],
    },
    automaticPerFinding: [
      { affectedCategory: "correctness" },
      { affectedCategory: "security" },
    ],
    existingRecords: [],
    corpusForHead: () => emptyCorpus(),
    mergeBaseForHead: () => "ee",
  });
  assert.equal(withCategories.findings.length, 2);
  assert.equal(withCategories.findings[0]?.record?.affectedCategory, "correctness");
  assert.equal(withCategories.findings[1]?.record?.affectedCategory, "security");
});

test("AC35 one missing category refuses only that automatic finding", () => {
  const partial = runCaptureDecisionGate({
    path: "automatic",
    evidence: evidence(),
    namedReviewer: "codex",
    automatic: {
      supported: true,
      presentOnPullRequest: true,
      unparseableOnCurrentHead: false,
      findingsOnCurrentHead: [
        {
          sourceId: "c:0",
          externalReviewer: "codex",
          reviewedHeadSha: HEAD_A,
          location: "a.ts:1",
          locationUnresolved: false,
          title: "One",
          text: "Body one",
        },
        {
          sourceId: "c:1",
          externalReviewer: "codex",
          reviewedHeadSha: HEAD_A,
          location: "b.ts:2",
          locationUnresolved: false,
          title: "Two",
          text: "Body two",
        },
      ],
    },
    automaticPerFinding: [
      { affectedCategory: "correctness" },
      { affectedCategory: "" },
    ],
    existingRecords: [],
    corpusForHead: () => emptyCorpus(),
    mergeBaseForHead: () => "ee",
  });
  assert.equal(partial.wholeCapture, undefined);
  assert.equal(partial.findings[0]?.outcome, "record_written");
  assert.equal(partial.findings[1]?.outcome, "capture_refused");
  assert.match(partial.findings[1]?.reason ?? "", /affectedCategory/);
});

test("AC30 / AC52 manual identity: case/whitespace update; location case-sensitive", () => {
  const first = runCaptureDecisionGate(baseManual());
  const written = first.findings[0]!.record!;

  const sameIdentity = runCaptureDecisionGate({
    ...baseManual({
      externalReviewer: "  Human-Reviewer  ",
      location: "  src/example.ts:10  ",
      text: "missing idempotency key on retry.",
      title: "missing idempotency key on retry.",
    }),
    existingRecords: [written],
  });
  assert.equal(sameIdentity.findings[0]?.outcome, "record_updated");
  assert.equal(sameIdentity.findings[0]?.record?.id, written.id);

  const locationCase = runCaptureDecisionGate({
    ...baseManual({ location: "Src/example.ts:10" }),
    existingRecords: [written],
  });
  assert.equal(locationCase.findings[0]?.outcome, "record_written");
  assert.notEqual(locationCase.findings[0]?.record?.id, written.id);
});

test("AC40 same commit on two PRs yields two records", () => {
  const a = runCaptureDecisionGate({
    ...baseManual(),
    evidence: evidence({ pullNumber: 10 }),
  });
  const b = runCaptureDecisionGate({
    ...baseManual(),
    evidence: evidence({ pullNumber: 11 }),
    existingRecords: [a.findings[0]!.record!],
  });
  assert.equal(a.findings[0]?.outcome, "record_written");
  assert.equal(b.findings[0]?.outcome, "record_written");
  assert.notEqual(a.findings[0]?.record?.id, b.findings[0]?.record?.id);
  assert.notEqual(
    manualIdentityKey({
      repository: "lhpaul/ronda",
      pullNumber: 10,
      externalReviewer: "human-reviewer",
      reviewedHeadSha: HEAD_A,
      location: "src/example.ts:10",
      title: "Missing idempotency key on retry.",
      text: "Missing idempotency key on retry.",
    }),
    manualIdentityKey({
      repository: "lhpaul/ronda",
      pullNumber: 11,
      externalReviewer: "human-reviewer",
      reviewedHeadSha: HEAD_A,
      location: "src/example.ts:10",
      title: "Missing idempotency key on retry.",
      text: "Missing idempotency key on retry.",
    }),
  );
});

test("AC42 re-capture replaces category without rationale", () => {
  const first = runCaptureDecisionGate(
    baseManual({
      verdict: "true_positive",
      intendedFollowUp: "eval_record",
    }),
  );
  const written = first.findings[0]!.record!;
  written.rationale = "initial rationale";

  const updated = runCaptureDecisionGate({
    ...baseManual({ affectedCategory: "security" }),
    existingRecords: [written],
  });
  assert.equal(updated.findings[0]?.outcome, "record_updated");
  assert.equal(updated.findings[0]?.record?.affectedCategory, "security");
  assert.equal(updated.findings[0]?.record?.verdict, "true_positive");
  assert.equal(updated.findings[0]?.record?.rationale, "initial rationale");
});

test("AC47 / AC51 defaults do not wipe adjudicated fields; differing values clear rationale", () => {
  const existing: ExternalReviewMissRecord = {
    id: "x",
    repository: "lhpaul/ronda",
    pullNumber: 53,
    reviewedHeadSha: HEAD_A,
    rondaResultHeadSha: HEAD_A,
    staleEvidence: false,
    externalReviewer: "human-reviewer",
    location: "src/example.ts:10",
    locationUnresolved: false,
    title: "Missing idempotency key on retry.",
    text: "Missing idempotency key on retry.",
    textTruncated: false,
    verdict: "true_positive",
    affectedCategory: "idempotency",
    intendedFollowUp: "eval_record",
    captureSource: "manual",
    sourceId: null,
    rationale: "keep me",
  };

  const preserved = mergeJudgementFields({
    existing,
    suppliedVerdict: "unadjudicated",
    suppliedFollowUp: "undecided",
  });
  assert.equal(preserved.verdict, "true_positive");
  assert.equal(preserved.intendedFollowUp, "eval_record");
  assert.equal(preserved.rationale, "keep me");

  const cleared = mergeJudgementFields({
    existing,
    suppliedVerdict: "false_positive",
  });
  assert.equal(cleared.verdict, "false_positive");
  assert.equal(cleared.rationale, undefined);
});

test("AC44 / AC45 guarded deletion", () => {
  const untouched: ExternalReviewMissRecord = {
    id: "u",
    repository: "lhpaul/ronda",
    pullNumber: 53,
    reviewedHeadSha: HEAD_A,
    rondaResultHeadSha: HEAD_A,
    staleEvidence: false,
    externalReviewer: "r",
    location: "l",
    locationUnresolved: false,
    title: "t",
    text: "text",
    textTruncated: false,
    verdict: "unadjudicated",
    affectedCategory: "other",
    intendedFollowUp: "undecided",
    captureSource: "manual",
    sourceId: null,
  };
  assert.equal(canDeleteMissRecord(untouched).allowed, true);

  const adjudicated = { ...untouched, verdict: "true_positive" as const };
  assert.equal(canDeleteMissRecord(adjudicated).allowed, false);
  assert.match(canDeleteMissRecord(adjudicated).reason ?? "", /adjudication/);
});

test("AC5 / AC28 adjudication requires rationale and scans it", () => {
  const record: ExternalReviewMissRecord = {
    id: "a",
    repository: "lhpaul/ronda",
    pullNumber: 53,
    reviewedHeadSha: HEAD_A,
    rondaResultHeadSha: HEAD_A,
    staleEvidence: false,
    externalReviewer: "r",
    location: "l",
    locationUnresolved: false,
    title: "t",
    text: "text",
    textTruncated: false,
    verdict: "unadjudicated",
    affectedCategory: "other",
    intendedFollowUp: "undecided",
    captureSource: "manual",
    sourceId: null,
  };

  const missing = adjudicateMissRecord({
    record,
    verdict: "true_positive",
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) {
    assert.match(missing.reason, /rationale is required/);
  }

  const credential = adjudicateMissRecord({
    record,
    verdict: "true_positive",
    rationale: 'password = "s3cret-value"',
    corpus: { changedFileContents: [], diffText: "" },
  });
  assert.equal(credential.ok, false);
  if (!credential.ok) {
    assert.match(credential.reason, /credential form/);
  }

  const ok = adjudicateMissRecord({
    record,
    verdict: "true_positive",
    intendedFollowUp: "eval_record",
    rationale: "Confirmed miss on retry path.",
    corpus: { changedFileContents: [], diffText: "" },
  });
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.record.verdict, "true_positive");
    assert.equal(ok.record.intendedFollowUp, "eval_record");
  }

  const missingCorpus = adjudicateMissRecord({
    record,
    verdict: "true_positive",
    rationale: "Needs corpus",
  });
  assert.equal(missingCorpus.ok, false);
  if (!missingCorpus.ok) {
    assert.match(missingCorpus.reason, /source corpus/);
  }
});

test("AC56 automatic and manual records stay separate for same finding", () => {
  const autoKey = automaticIdentityKey({
    repository: "lhpaul/ronda",
    pullNumber: 53,
    sourceId: "rev-9:0",
  });
  const manualKey = manualIdentityKey({
    repository: "lhpaul/ronda",
    pullNumber: 53,
    externalReviewer: "chatgpt-codex-connector[bot]",
    reviewedHeadSha: HEAD_A,
    location: "src/a.ts:1",
    title: "Same title",
    text: "Same text",
  });
  assert.notEqual(autoKey, manualKey);
});

test("AC11 truncation marks long credential-free text", () => {
  const longText = `${"safe line\n".repeat(300)}end`;
  const result = runCaptureDecisionGate(baseManual({ text: longText }));
  assert.equal(result.findings[0]?.outcome, "record_written");
  assert.equal(result.findings[0]?.record?.textTruncated, true);
  assert.ok((result.findings[0]?.record?.text.length ?? 0) <= 2000);
});

test("AC54 merge-base callback is invoked per capture reviewed head", () => {
  const seen: string[] = [];
  runCaptureDecisionGate({
    ...baseManual({ reviewedHeadSha: HEAD_B }),
    mergeBaseForHead: (head) => {
      seen.push(head);
      return `mb-${head.slice(0, 8)}`;
    },
  });
  assert.deepEqual(seen, [HEAD_B]);

  seen.length = 0;
  runCaptureDecisionGate({
    ...baseManual({ reviewedHeadSha: HEAD_A }),
    mergeBaseForHead: (head) => {
      seen.push(head);
      return `mb-${head.slice(0, 8)}`;
    },
  });
  assert.deepEqual(seen, [HEAD_A]);
  assert.notEqual(`mb-${HEAD_B.slice(0, 8)}`, `mb-${HEAD_A.slice(0, 8)}`);
});
