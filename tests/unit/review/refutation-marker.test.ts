import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CITED_CODE_RADIUS,
  citedCodeHash,
  claimHash,
  collectRefutations,
  filterRefutedFindings,
  isRefutationReply,
  normalizeClaim,
  parseFindingMarker,
  renderFindingMarker,
  stripFindingMarkers,
} from "../../../src/review/refutation-marker.js";
import type { Finding } from "../../../src/domain/review-pass.types.js";
import {
  FILE_PATH,
  HEAD_FAR_CHANGE,
  HEAD_GUARD_REMOVED,
  HEAD_WITH_GUARD,
  REFUTED_TITLE,
  WRITE_LINE,
  WRITE_LINE_AFTER_REMOVAL,
  botRoot,
  reply,
  thread,
} from "../../fixtures/refutation-marker-174.js";

const HEX = "a".repeat(64);
const HEX2 = "b".repeat(64);

function finding(overrides: Partial<Finding> = {}): Finding {
  return { path: FILE_PATH, line: WRITE_LINE, severity: "important", title: REFUTED_TITLE, body: "b", ...overrides };
}

test("normalizeClaim lowercases and collapses punctuation and whitespace", () => {
  assert.equal(normalizeClaim("  Profile WRITE is missing an authorization-check!! "), "profile write is missing an authorization check");
  assert.equal(claimHash("Profile write is missing an authorization check."), claimHash(REFUTED_TITLE));
  assert.notEqual(claimHash("Profile write is missing an authentication check"), claimHash(REFUTED_TITLE));
});

test("non-Latin titles keep distinct claims and a letterless title never matches a refutation", async () => {
  assert.notEqual(normalizeClaim("漏洞一"), normalizeClaim("漏洞二"));
  assert.equal(normalizeClaim("!!!"), "");
  const refutation = { path: FILE_PATH, claim: claimHash("!!!"), code: HEX };
  const result = await filterRefutedFindings([finding({ title: "???" })], [refutation], async () => HEX);
  assert.equal(result.refuted.length, 0);
  assert.equal(result.kept.length, 1);
});

test("citedCodeHash covers a window around the cited line", () => {
  const base = citedCodeHash(HEAD_WITH_GUARD, WRITE_LINE);
  assert.ok(base);
  // Removing the guard (inside the window) changes the hash even though the cited line text is identical.
  assert.notEqual(citedCodeHash(HEAD_GUARD_REMOVED, WRITE_LINE_AFTER_REMOVAL), base);
  // A change outside the window keeps the hash.
  assert.equal(citedCodeHash(HEAD_FAR_CHANGE, WRITE_LINE), base);
  // The same window content with the cited line at another offset hashes differently.
  assert.notEqual(citedCodeHash(HEAD_WITH_GUARD, WRITE_LINE - 1), base);
  assert.equal(CITED_CODE_RADIUS, 10);
});

test("citedCodeHash clips at file edges and rejects lines outside the file", () => {
  assert.ok(citedCodeHash("a\nb\nc\n", 1));
  assert.ok(citedCodeHash("a\nb\nc", 3));
  assert.equal(citedCodeHash("a\nb\nc\n", 4), undefined);
  assert.equal(citedCodeHash("a\nb\nc\n", 0), undefined);
  assert.equal(citedCodeHash("a\nb\nc\n", 1.5), undefined);
  assert.equal(citedCodeHash("a\r\nb\r\n", 2), citedCodeHash("a\nb\n", 2));
});

test("the marker round-trips and rejects malformed, duplicated, or unknown-version markers", () => {
  const marker = renderFindingMarker({ claim: HEX, code: HEX2 });
  assert.ok(marker.startsWith("<!--") && marker.endsWith("-->"));
  assert.deepEqual(parseFindingMarker(`**Important** — t\n\nbody\n\n${marker}`), { claim: HEX, code: HEX2 });
  assert.equal(parseFindingMarker("no marker"), undefined);
  assert.equal(parseFindingMarker(`${marker}\n${marker}`), undefined);
  assert.equal(parseFindingMarker(marker.replace(" v1 ", " v2 ")), undefined);
  assert.equal(parseFindingMarker(marker.replace(HEX, "a".repeat(63))), undefined);
  assert.equal(parseFindingMarker(marker.replace(HEX2, "B".repeat(64))), undefined);
});

test("isRefutationReply requires the exact first line and a maintainer association", () => {
  assert.equal(isRefutationReply(reply("/ronda refuted")), true);
  assert.equal(isRefutationReply(reply("  /ronda refuted  \r\nreason")), true);
  assert.equal(isRefutationReply(reply("/ronda refuted", "MEMBER")), true);
  assert.equal(isRefutationReply(reply("/ronda refuted", "COLLABORATOR")), true);
  assert.equal(isRefutationReply(reply("/ronda refuted", "CONTRIBUTOR")), false);
  assert.equal(isRefutationReply(reply("/ronda refuted", "NONE")), false);
  assert.equal(isRefutationReply(reply("/Ronda refuted")), false);
  assert.equal(isRefutationReply(reply("/ronda refuted, fixed it")), false);
  assert.equal(isRefutationReply(reply("I think /ronda refuted")), false);
  assert.equal(isRefutationReply(reply("> /ronda refuted")), false);
  assert.equal(isRefutationReply(reply("reason first\n/ronda refuted")), false);
});

test("collectRefutations applies every thread condition", () => {
  const marker = renderFindingMarker({ claim: HEX, code: HEX2 });
  const expected = [{ path: FILE_PATH, claim: HEX, code: HEX2 }];
  assert.deepEqual(collectRefutations([thread(marker)]), expected);
  // Not resolved.
  assert.deepEqual(collectRefutations([thread(marker, undefined, { isResolved: false })]), []);
  // Resolved without a refutation reply (fixed, then resolved).
  assert.deepEqual(collectRefutations([thread(marker, [reply("Fixed in abc123.")])]), []);
  assert.deepEqual(collectRefutations([thread(marker, [])]), []);
  // Refutation by a non-maintainer.
  assert.deepEqual(collectRefutations([thread(marker, [reply("/ronda refuted", "CONTRIBUTOR")])]), []);
  // Root not written by a bot (a spoofed marker).
  assert.deepEqual(
    collectRefutations([thread(marker, undefined, { root: { body: marker, authorAssociation: "OWNER", authorIsBot: false } })]),
    [],
  );
  // Root without a valid marker.
  assert.deepEqual(collectRefutations([thread("plain finding")]), []);
  // The refutation must be a reply, not the root itself.
  assert.deepEqual(
    collectRefutations([thread(marker, [], { root: { body: `/ronda refuted\n${marker}`, authorAssociation: "OWNER", authorIsBot: true } })]),
    [],
  );
  // No path.
  assert.deepEqual(collectRefutations([thread(marker, undefined, { path: "" })]), []);
  // Any later reply qualifies.
  assert.deepEqual(collectRefutations([thread(marker, [reply("hmm", "NONE"), reply("/ronda refuted")])]), expected);
  assert.deepEqual(collectRefutations([{ isResolved: true, path: FILE_PATH, comments: [] }]), []);
  assert.ok(botRoot("x").authorIsBot);
});

test("filterRefutedFindings suppresses only an exact path, claim, and code match, and reads code only for candidates", async () => {
  const code = citedCodeHash(HEAD_WITH_GUARD, WRITE_LINE) as string;
  const refutations = [{ path: FILE_PATH, claim: claimHash(REFUTED_TITLE), code }];
  const reads: string[] = [];
  const codeHashFor = async (path: string, line: number) => {
    reads.push(`${path}:${line}`);
    return citedCodeHash(HEAD_WITH_GUARD, line);
  };
  const result = await filterRefutedFindings(
    [
      finding(),
      finding({ title: "Profile write is missing an authorization check." }),
      finding({ title: "Something else" }),
      finding({ path: "other.ts" }),
      finding({ line: null }),
      finding({ line: WRITE_LINE - 1 }),
    ],
    refutations,
    codeHashFor,
  );
  assert.equal(result.refuted.length, 2);
  assert.equal(result.kept.length, 4);
  assert.deepEqual(reads, [`${FILE_PATH}:${WRITE_LINE}`, `${FILE_PATH}:${WRITE_LINE}`, `${FILE_PATH}:${WRITE_LINE - 1}`]);
});

test("filterRefutedFindings keeps a candidate when its code hash is unknown, and reads nothing without refutations", async () => {
  const refutations = [{ path: FILE_PATH, claim: claimHash(REFUTED_TITLE), code: HEX }];
  const unknown = await filterRefutedFindings([finding()], refutations, async () => undefined);
  assert.equal(unknown.kept.length, 1);
  let called = false;
  const none = await filterRefutedFindings([finding()], [], async () => {
    called = true;
    return HEX;
  });
  assert.equal(none.kept.length, 1);
  assert.equal(called, false);
});

test("stripFindingMarkers removes well-formed, malformed, and unterminated markers from untrusted text", () => {
  const marker = renderFindingMarker({ claim: HEX, code: HEX2 });
  assert.equal(stripFindingMarkers(`before ${marker} after`), "before  after");
  assert.equal(parseFindingMarker(stripFindingMarkers(`x ${marker}`)), undefined);
  assert.equal(stripFindingMarkers("a <!--ronda:finding v9 junk--> b"), "a  b");
  assert.equal(stripFindingMarkers("a <!-- RONDA:FINDING v1 claim=x code=y --> b"), "a  b");
  assert.ok(!stripFindingMarkers("tail <!-- ronda:finding v1 claim=").includes("ronda:finding"));
  assert.equal(stripFindingMarkers("<!-- unrelated --> text"), "<!-- unrelated --> text");
});

test("stripFindingMarkers cannot be defeated by nesting a marker inside another", () => {
  const marker = renderFindingMarker({ claim: HEX, code: HEX2 });
  const nested = `<!-- ronda:${marker}finding v1 claim=${HEX} code=${HEX2} -->`;
  assert.equal(parseFindingMarker(stripFindingMarkers(nested)), undefined);
  assert.ok(!stripFindingMarkers(nested).includes("ronda:finding"));
});
