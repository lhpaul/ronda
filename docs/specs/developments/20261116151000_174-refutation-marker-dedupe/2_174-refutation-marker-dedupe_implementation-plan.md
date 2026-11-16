# Refutation-marker dedupe — Implementation Plan

**Spec**: [Refutation-marker dedupe spec](1_174-refutation-marker-dedupe_specs.md)
**Evidence**: [Offline measurement](../../../testing/ronda/refutation-marker-dedupe-174.md)

## Summary

**Approach**: Add a pure module that renders and parses a hidden finding
marker, recognises refutation replies, and filters refuted findings. Add one
read-only GitHub reader for review threads (GraphQL). Wire both into
`runReviewPass` after the #158 named-credential filter and before
classification, and append the marker to each inline comment.

**Estimated complexity**: M. The logic is pure and unit-testable, but it adds a
read path to the pass and changes the inline comment body.

**Dependencies**: None. The spec, plan, and code ship in one PR because LH kept
the security checkpoint and will review and merge the whole item at once.

## Verification Log

Inspected at `8a94514` (`origin/develop`) on 2026-11-16.

| Check | Command / query | Result |
| --- | --- | --- |
| Current suppression seam | `grep -n "filterNamedCredentialFindings" src/core/run-review-pass.ts` | The #158 filter runs after parsing and path exclusion, before classification and inline-comment mapping. The new filter goes right after it. |
| No thread reads today | `grep -rln "isResolved\|reviewThreads" src` | No matches. The reader is new. |
| No hidden marker today | `grep -rn "<!--" src` | No matches. Inline bodies are `**<severity>** — <title>\n\n<body>`. |
| GitHub port composition | `grep -rn "findExistingCheckRun" src` | `GithubOperations` is composed in `src/cli/review-pr.ts`, `src/webhook/webhook-job.ts`, and `src/cli/control-pass.ts`. |
| GraphQL available | `grep -n graphql node_modules/@octokit/core/dist-types/index.d.ts` | `Octokit` exposes `graphql`; no new dependency. |
| File read at head | `grep -n "failOnUnusable\|return undefined" src/github/repo-content-reader.ts` | `readFileAtRef` returns `undefined` for a missing or unusable file and throws on other errors. |

## Cross-Cutting Operational Assumption Check

| Surface | Value | Result |
| --- | --- | --- |
| Permissions | Review threads are read with the same token that already reads the pull request (`pull_requests: read`). No workflow, `action.yml`, or App permission edit. | Verified |
| Publishing | Still one review per head SHA. The only change to published content is the hidden marker in inline comments and one optional summary line. | Verified |

## Layer-by-Layer Changes

### Domain types (`src/domain/review-pass.types.ts`)

- `ReviewThreadComment { body: string; authorAssociation: string; authorIsBot: boolean }`.
- `ReviewThread { isResolved: boolean; path: string; comments: ReviewThreadComment[] }`,
  comments in thread order.
- `GithubOperations.readReviewThreads?(owner, repo, pullNumber, signal)`. It is
  optional: a port without it performs no refutation dedupe (BR4). The
  control-pass CLI leaves it unset (spec, Out of Scope).

### Marker and filter (`src/review/refutation-marker.ts`, new) — AC1–AC6

- `REFUTATION_COMMAND = "/ronda refuted"`, `MAINTAINER_ASSOCIATIONS = {OWNER, MEMBER, COLLABORATOR}`.
- `CITED_CODE_RADIUS = 10`: the window is the cited line ±10 lines, clipped to
  the file (BR3).
- `normalizeClaim(title)`: lowercase, collapse `[^\p{L}\p{N}]+` (Unicode-aware) to one space, trim. A
  title that normalizes to empty never matches a refutation.
- `claimHash(title)` and `citedCodeHash(fileText, line)`: SHA-256 hex. The code
  hash covers the cited line's offset in the window plus the window's lines
  joined with `\n`. It is `undefined` when the line is outside the file.
- `renderFindingMarker({claim, code})` returns
  `<!-- ronda:finding v1 claim=<64 hex> code=<64 hex> -->`.
- `parseFindingMarker(body)`: exactly one well-formed v1 marker, or `undefined`
  (none, more than one, an unknown version, or wrong lengths).
- `isRefutationReply(comment)`: the first line of the body, trimmed, equals
  `REFUTATION_COMMAND`, and the association is a maintainer association.
- `collectRefutations(threads)`: one `{path, claim, code}` per thread that is
  resolved, whose first comment is by a bot and carries a valid marker, and
  that has a later refutation reply (BR1).
- `filterRefutedFindings(findings, refutations, codeHashFor)` (async): keeps any
  finding with no line or no path+claim match without reading code, and asks
  `codeHashFor(path, line)` only for a candidate. It suppresses only on an exact
  code-hash match. `codeHashFor` returning `undefined` keeps the finding.
- `SuppressionReason` in `src/review/refuted-findings.ts` gains
  `"refuted_by_maintainer"` so `findings_suppressed` reports both reasons.

### Thread reader (`src/github/review-thread-reader.ts`, new)

- GraphQL `repository.pullRequest.reviewThreads(first: 100, after:)` with
  `isResolved`, `path`, and `comments(first: 100) { body authorAssociation author { __typename } }`.
  It pages threads until `hasNextPage` is false, bounded at 50 pages (5,000
  threads). Comments past 100 in one thread, and threads past the bound, are
  not read, which can only miss a refutation (fail open).
- The whole walk goes through `withAbortMapping(withRetry(...))`, as the other
  paginated readers do.

### Pass wiring (`src/core/run-review-pass.ts`)

1. After the named-credential filter: when `readReviewThreads` exists, read the
   threads. On any error, log `refutation_threads_unavailable` (head SHA only)
   and continue with no refutations (AC5).
2. Keep a per-pass cache: path → file text at `pr.headSha` via `readFileAtRef`.
   A thrown read caches `undefined` (AC5).
3. `filterRefutedFindings`. Suppressed findings join the existing
   `findings_suppressed` event and are counted as `refutedCount`.
4. When mapping inline comments, append the marker when the code hash is known
   (AC6). The 422 fallback summary is unchanged and carries no marker.
5. `buildReviewSummary` gets `refutedCount`. In parsing notes it renders
   "`N` finding(s) a maintainer marked `/ronda refuted` on unchanged code were
   not re-posted." (BR6)

### Composition

- `src/cli/review-pr.ts` and `src/webhook/webhook-job.ts` wire
  `readReviewThreads` (the webhook combines the job signal, like its siblings).
- `src/cli/control-pass.ts` is unchanged.

## Testing Strategy

- `tests/unit/review/refutation-marker.test.ts`: normalization, hashing window
  and clipping, marker round-trip and rejection cases, the refutation-reply
  rules, `collectRefutations` for each BR1 condition, and filter fail-open.
- `tests/unit/github/review-thread-reader.test.ts`: GraphQL mapping and
  pagination with a fake `graphql`.
- `tests/unit/core/run-review-pass-refutation.test.ts`: end-to-end pass with
  fake GitHub covering AC1–AC6, including the removed-guard case (AC3) and a
  thread-read failure (AC5).
- `tests/unit/core/summary.test.ts`: the new parsing-notes line.
- Fixture `tests/fixtures/refutation-marker-174.ts` drives the AC7 before/after
  measurement asserted in the pass test.

## Documentation Updates

- `docs/testing/ronda/refutation-marker-dedupe-174.md`: offline measurement.
- `docs/adoption/ronda-review-adoption.md`: how a maintainer refutes a finding.
- `changelog.d/174.added.refutation-marker-dedupe.md`.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| A true finding is suppressed after a nearby security-relevant change outside the ±10 window | The window is the documented limit. Exact claim match only. A maintainer must have refuted it explicitly. The summary always states the count. |
| A spoofed marker in a human-authored thread | The thread's first comment must be by a bot account, and the refutation needs a maintainer association. |
| Extra GitHub reads per pass | One paginated GraphQL walk plus at most one content read per distinct inline-finding path; failures fail open. |

## Implementation Order

1. Marker module and unit tests.
2. Thread reader and tests.
3. Pass wiring, summary line, composition, and pass tests with the fixture.
4. Evidence doc, adoption doc, and changelog fragment.
