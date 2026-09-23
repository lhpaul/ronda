# PR #98 Review-Finding Corpus (real-PR evidence, 2026-09-23)

Backing evidence for the ranked category list in
[`quality-cost-baseline-2026-09-23.md`](quality-cost-baseline-2026-09-23.md).

This is **not** a set of Ronda miss records. Ronda has never reviewed a pull
request in this repository (see the baseline document, Deliverable 1), so no
`docs/testing/ronda/misses/` record can exist for these findings. What this
corpus does establish is the **defect-category distribution of a real Ronda PR**
as observed by two independent reviewers, which is the input the
category-forced prompt sweep actually needs.

## Sources

| Source | Findings | Provenance |
| --- | ---: | --- |
| `local-ai-reviewer` | 74 | `reviewer-loop-history:v1` JSON embedded in the "Automated Reviewer Loop Summary" comment on PR #98 (26 iterations) |
| `codex-github` | 5 | GitHub review comments by `chatgpt-codex-connector[bot]` on heads `c59ad086` and `b9451f90` |

Deduplication: a finding is counted once per unique
`(path, line, message-prefix)`; the `Iter` column records the iteration of first
appearance. Re-statements of the same defect at a later iteration after a failed
fix are **not** counted again, so the counts below understate thrash.

Category assignment uses the closed set in
[`src/quality/miss-record.ts`](../../../src/quality/miss-record.ts)
(`AFFECTED_CATEGORIES`). The `Sub-theme` column is an additional, non-schema
grouping introduced by this baseline, because `correctness` alone is too coarse
to scope a prompt change. Assignment was done by hand from the finding text; the
mapping is recorded in full below so it can be disputed row by row.

## Distribution

### By closed category

| Category | `local-ai-reviewer` | `codex-github` | Total | Share |
| --- | ---: | ---: | ---: | ---: |
| `correctness` | 44 | 0 | 44 | 55.7% |
| `security` | 11 | 4 | 15 | 19.0% |
| `other` | 11 | 0 | 11 | 13.9% |
| `idempotency` | 6 | 0 | 6 | 7.6% |
| `partial_success` | 2 | 1 | 3 | 3.8% |
| `durability` | 0 | 0 | 0 | 0% |
| `retries` | 0 | 0 | 0 | 0% |
| `timeouts` | 0 | 0 | 0 | 0% |
| `concurrency` | 0 | 0 | 0 | 0% |
| `configuration` | 0 | 0 | 0 | 0% |
| `observability` | 0 | 0 | 0 | 0% |
| **Total** | **74** | **5** | **79** | |

### By sub-theme (`local-ai-reviewer`, n=74)

| Sub-theme | Count | Closed category |
| --- | ---: | --- |
| `pr-head-push-order` | 14 | `correctness` |
| `planted-proof-evidence` | 10 | `other` |
| `external-output-parsing` | 8 | `correctness` |
| `spec-ac-compliance` | 7 | `correctness` |
| `record-identity` | 7 | `idempotency` (6), `correctness` (1) |
| `credential-pattern-gap` | 6 | `security` |
| `guard-fails-open` | 4 | `security` |
| `excerpt-sequence-boundaries` | 4 | `correctness` |
| `placeholder-exemption` | 3 | `correctness` |
| `refusal-precedence` | 3 | `correctness` |
| `per-finding-resolution` | 3 | `partial_success` (2), `correctness` (1) |
| `input-validation` | 2 | `correctness` |
| `path-traversal` | 1 | `security` |
| `github-api-pagination` | 1 | `correctness` |
| `operator-usability` | 1 | `other` |

## `codex-github` findings (n=5)

| # | Head | Severity | Location | Category | Sub-theme | Title |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | `c59ad086` | P1 | `src/quality/miss-sensitive-content-lists.ts` | `security` | `credential-pattern-gap` | Reject secret variables with trailing qualifiers |
| C2 | `c59ad086` | P2 | `src/cli/capture-external-review-misses.ts` | `partial_success` | `per-finding-resolution` | Preserve one-entry per-finding category lists |
| C3 | `b9451f90` | P1 | `src/quality/miss-content-validator.ts:188` | `security` | `guard-fails-open` | Normalize diff prefixes on candidate excerpt lines |
| C4 | `b9451f90` | P1 | `src/quality/miss-sensitive-content-lists.ts:37` | `security` | `credential-pattern-gap` | Reject encrypted private-key PEM blocks |
| C5 | `b9451f90` | P1 | `src/quality/miss-sensitive-content-lists.ts:50` | `security` | `credential-pattern-gap` | Reject qualified API-key and camelCase secret names |

Both Codex passes ran **after** 22 local-reviewer iterations had already cleared.
Pass 1 (`c59ad086`) found 2 blocking findings; pass 2 (`b9451f90`), 12 minutes
later, found 3 net-new P1s that only became reachable once pass 1's findings were
fixed. Every Codex finding except C2 falls in `security`, and four of the five
are `credential-pattern-gap` or `guard-fails-open` — the same two sub-themes the
local reviewer hit 10 times.

The reviewer loop classified both Codex passes as
`local: Skipped [not_a_miss]`, i.e. the local reviewer was not run against those
heads, so these are **not** adjudicated local-reviewer misses.

## `local-ai-reviewer` findings (n=74)

| # | Iter | Location | Category | Sub-theme | Finding |
| --- | ---: | --- | --- | --- | --- |
| 1 | 1 | `src/cli/capture-external-review-misses.ts`:491 | `security` | `guard-fails-open` | Adjudication fails open when GitHub evidence or the source corpus cannot be loaded: the catch sets corpus to undefined, which disables source-excerpt scanning and permits an unscanned rationale to... |
| 2 | 1 | `src/quality/miss-github-evidence.ts`:493 | `security` | `guard-fails-open` | Capture silently skips every changed file whose blob lookup fails. That leaves the sensitive-content corpus incomplete and allows more than five copied source lines from an unreadable, oversized, o... |
| 3 | 1 | `src/cli/summarize-review-comparisons.ts`:203 | `correctness` | `spec-ac-compliance` | quality:summary explicitly treats every miss record as resolvable instead of resolving Ronda evidence afresh. Deleted/unavailable reviews are therefore counted under verdict outcomes with unresolva... |
| 4 | 1 | `src/cli/report-review-quality.ts`:117 | `correctness` | `spec-ac-compliance` | quality:report passes miss records directly into a model that has no fresh resolvability input, despite documentation calling this the spec-complete report. Unresolvable records can consequently ap... |
| 5 | 1 | `src/quality/miss-capture-gate.ts`:508 | `idempotency` | `record-identity` | Manual identity is built from the truncated title/text and persisted records retain no digest of the full pre-truncation identity. Two findings that share the first 2,000 text characters but differ... |
| 6 | 1 | `src/quality/miss-github-evidence.ts`:329 | `idempotency` | `record-identity` | A review-comment source ID uses findings.length as its position. Removing or reordering another comment changes this suffix on the next capture, so the same immutable comment receives a new identit... |
| 7 | 1 | `src/quality/miss-github-evidence.ts`:119 | `correctness` | `pr-head-push-order` | The pulls/{pr}/commits response is treated as historical PR-head push order, but it only describes the current PR commit set and loses force-pushed-away heads. The fallback then selects the last Ro... |
| 8 | 1 | `src/cli/capture-external-review-misses.ts`:408 | `security` | `path-traversal` | --id is also accepted as an arbitrary filesystem path. If that path contains JSON with unadjudicated/undecided fields, delete removes it even when it is outside the configured miss directory; adjud... |
| 9 | 1 | `src/quality/miss-sensitive-content-lists.ts`:44 | `security` | `credential-pattern-gap` | The password/secret/token assignment detector requires a quoted value, so common literal assignments such as password=supersecret pass the credential guard. AC9 requires password assignments to be... |
| 10 | 3 | `src/quality/miss-record.ts`:184 | `idempotency` | `record-identity` | Manual identity hashes the raw normalized reviewer name instead of resolving the closed Codex alias list. Thus `Codex` and `chatgpt-codex-connector[bot]` create separate records, violating AC39. |
| 11 | 3 | `src/quality/miss-record.ts`:185 | `idempotency` | `record-identity` | Manual identity hashes the supplied SHA spelling directly. A full SHA and its valid abbreviation produce different identities, creating duplicate records contrary to AC30 and the approved plan. |
| 12 | 3 | `src/quality/miss-record.ts`:124 | `correctness` | `input-validation` | SHA matching accepts any nonempty prefix, so malformed values such as a single matching hex character pass `isKnownPullRequestHead`; AC31 requires malformed reviewed heads to be refused. |
| 13 | 3 | `src/quality/miss-github-evidence.ts`:171 | `correctness` | `github-api-pagination` | `gh api --paginate` emits one JSON document per page, but the output is parsed as one array. PRs exceeding an endpoint's page size make evidence loading fail; commits, reviews, comments, and timeli... |
| 14 | 3 | `src/quality/miss-github-evidence.ts`:580 | `security` | `guard-fails-open` | Source scanning silently accepts compare entries without `patch`. For a removed file with an omitted patch there is no blob fallback, so six copied diff/source lines cannot be detected and AC10/AC3... |
| 15 | 3 | `tests/unit/quality/miss-content-validator.test.ts`:131 | `other` | `planted-proof-evidence` | The claimed planted-violation proof does not demonstrate the required fail-then-pass run at a concrete location for each new guard assertion. It directly asserts validator return values, and the CL... |
| 16 | 4 | `src/quality/miss-sensitive-content-lists.ts`:100 | `correctness` | `placeholder-exemption` | AC18 exempts a credential match when its value is a published placeholder, but non-assignment forms compare the entire match. `Authorization: [REDACTED] [REDACTED]` is therefore refused instead of... |
| 17 | 4 | `src/quality/miss-content-validator.ts`:162 | `correctness` | `excerpt-sequence-boundaries` | Blank lines are removed before excerpt matching, so two shorter excerpts separated by a blank line become six consecutive lines and are incorrectly refused. The plan explicitly requires blank lines... |
| 18 | 4 | `src/quality/miss-github-evidence.ts`:500 | `correctness` | `external-output-parsing` | Inline findings use the comment ID as `sourceId`, but review-level deduplication checks the parent review ID. A review containing inline comments plus a summary body therefore captures the summary... |
| 19 | 5 | `src/quality/miss-content-validator.ts`:160 | `correctness` | `excerpt-sequence-boundaries` | Blank lines are removed before sequence matching, so six matching lines separated by a blank line are incorrectly treated as consecutive and refused. The approved plan explicitly requires blank lin... |
| 20 | 5 | `src/quality/miss-github-evidence.ts`:477 | `idempotency` | `record-identity` | Each review comment is collapsed into exactly one finding with source position 0. A comment containing multiple findings therefore produces one combined record instead of distinct position-based re... |
| 21 | 5 | `src/quality/miss-capture-gate.ts`:341 | `correctness` | `refusal-precedence` | For a supplied reviewed head that is both malformed and credential-shaped, this branch reports the credential refusal first. The specification's closed refusal precedence lists malformed/non-PR hea... |
| 22 | 6 | `src/cli/capture-external-review-misses.ts`:592 | `correctness` | `per-finding-resolution` | Automatic capture accepts one category/verdict/follow-up tuple and applies it to every extracted finding. The approved spec requires presenting and classifying each finding independently; findings... |
| 23 | 6 | `src/quality/miss-github-evidence.ts`:647 | `security` | `guard-fails-open` | The source-safety corpus assumes the compare API's files array is complete, but GitHub caps compare responses at 300 files. Larger changes silently omit files, allowing prohibited source excerpts f... |
| 24 | 7 | `src/quality/review-quality-report.ts`:576 | `correctness` | `spec-ac-compliance` | Stale, resolvable records with `out_of_scope` or `already_found` verdicts enter this branch before their `stale_head` outcome is counted. They are therefore reported as supplementary verdict outcom... |
| 25 | 7 | `src/cli/summarize-review-comparisons.ts`:90 | `correctness` | `spec-ac-compliance` | `categoryBreakdown` is incremented for every record before stale/resolvability and verdict classification. The spec requires the affected-category breakdown to describe confirmed misses, but false... |
| 26 | 7 | `src/quality/miss-github-evidence.ts`:154 | `correctness` | `pr-head-push-order` | Every commit returned by the PR commits endpoint is treated as a historical PR head. For a multi-commit push, interior commits were never branch heads, yet `isKnownPullRequestHead` accepts them, vi... |
| 27 | 7 | `src/quality/miss-github-evidence.ts`:541 | `correctness` | `external-output-parsing` | Inline findings use the review-comment ID in `sourceId`, so this comparison against the parent review ID cannot detect that comments already represent the review. When a review has both inline comm... |
| 28 | 8 | `src/quality/miss-sensitive-content-lists.ts`:95 | `security` | `credential-pattern-gap` | A placeholder assignment can hide a later real credential: after matching `password=REDACTED`, this `continue` skips the entire secret-assignment form without scanning subsequent matches, so `passw... |
| 29 | 8 | `src/quality/miss-github-evidence.ts`:154 | `correctness` | `pr-head-push-order` | `buildPushOrderedHeadShas` never uses `input.commits`, so an ordinary A→B→C push history without force-push timeline events becomes `[C]`. If Ronda reviewed A and B but not C, AC37 capture incorrec... |
| 30 | 8 | `src/quality/miss-github-evidence.ts`:543 | `correctness` | `external-output-parsing` | Review-level findings are silently lost or merged: any inline comment causes the entire review body to be skipped, and a review body without inline comments is always emitted as one finding even wh... |
| 31 | 9 | `src/quality/miss-sensitive-content-lists.ts`:113 | `correctness` | `placeholder-exemption` | AC18 is violated for placeholder bearer values. `Authorization: [REDACTED] [REDACTED]` matches the bearer rule, but placeholder detection examines the entire matched header rather than the credenti... |
| 32 | 9 | `src/quality/miss-capture-gate.ts`:648 | `partial_success` | `per-finding-resolution` | A missing category for one item in a multi-finding automatic capture becomes a whole-capture refusal. For example, a category vector with one valid entry and one blank entry returns here before any... |
| 33 | 9 | `src/cli/capture-external-review-misses.ts`:525 | `correctness` | `spec-ac-compliance` | AC53 is not implemented: the read operation only emits `displayRondaResultHead`, while the evidence reader discards each Ronda review body. Consequently a stale record never shows Ronda's actual re... |
| 34 | 10 | `src/quality/miss-github-evidence.ts`:456 | `idempotency` | `record-identity` | Review comments and review bodies use the same unqualified `<numeric-id>:<index>` source-ID namespace. Since these are different GitHub resource types, equal numeric IDs collapse distinct findings... |
| 35 | 10 | `src/quality/miss-github-evidence.ts`:549 | `correctness` | `external-output-parsing` | Every non-empty current-head review body is treated as finding text, while an empty current-head review with no comments is classified as unparseable. This collapses clean, silent, and malformed re... |
| 36 | 10 | `src/quality/miss-github-evidence.ts`:148 | `correctness` | `pr-head-push-order` | Push-order reconstruction loses earlier ordinary head tips after a later force-push: it retains only force-push before/after tips plus commits reachable from the current head. If Ronda reviewed an... |
| 37 | 10 | `tests/unit/quality/miss-content-validator.test.ts`:150 | `other` | `planted-proof-evidence` | The supplied PR evidence only claims that planted-violation unit proof exists; it does not provide REVIEW.md's required concrete assertion-to-plant evidence with demonstrated failing and restored-p... |
| 38 | 11 | `src/quality/miss-sensitive-content-lists.ts`:109 | `security` | `credential-pattern-gap` | Credential scanning checks only the first bearer-header match. If that match is an allowed placeholder, the code continues without scanning later bearer headers, so `Authorization: [REDACTED] [REDA... |
| 39 | 11 | `src/quality/miss-github-evidence.ts`:202 | `correctness` | `pr-head-push-order` | `mergePushOrderWithRondaHeads` inserts heads absent from commit/timeline evidence in reviews-endpoint order. When timeline lookup fails or omits multiple force-pushed-away heads, AC37 can therefore... |
| 40 | 12 | `src/cli/report-review-quality.ts`:127 | `correctness` | `spec-ac-compliance` | `quality:report` now performs live GitHub calls, contradicting the existing no-GitHub-at-report-time contract in AGENTS.md and the approved #56 plan. Preserve the offline report contract or reconci... |
| 41 | 12 | `src/quality/miss-content-validator.ts`:112 | `correctness` | `excerpt-sequence-boundaries` | Filtering blank lines from each source corpus makes lines separated by blanks appear consecutive, so a permitted excerpt can be falsely refused as six consecutive source lines. Preserve source sequ... |
| 42 | 12 | `src/cli/capture-external-review-misses.ts`:223 | `correctness` | `input-validation` | `Number.parseInt` accepts malformed PR identifiers such as `98oops` as PR 98, allowing capture against the wrong pull request instead of refusing invalid input. Validate the entire argument as a po... |
| 43 | 12 | `docs/testing/workflow/53-capture-external-review-misses-planted-proofs-record.md`:10 | `other` | `planted-proof-evidence` | The required planted-proof locations are stale or incomplete: P1–P3 point to lines that no longer contain the cited plants, and P4's range ends before the source-excerpt plant. The proof set also l... |
| 44 | 13 | `src/quality/miss-github-evidence.ts`:156 | `correctness` | `pr-head-push-order` | AC31 is violated because every commit returned by the PR commits endpoint is treated as a historical PR head. Intermediate commits from a multi-commit push were never necessarily branch tips, so ma... |
| 45 | 13 | `src/cli/capture-external-review-misses.ts`:660 | `correctness` | `refusal-precedence` | Automatic reviewer evidence is fetched before Stage 1 runs. If condition 3 already applies (no Ronda result) but the second reviews/comments lookup fails, the command throws a raw error instead of... |
| 46 | 14 | `src/quality/miss-github-evidence.ts`:151 | `correctness` | `pr-head-push-order` | `committed` timeline entries identify commits, not confirmed PR head transitions. A multi-commit push therefore admits intermediate commits that were never PR heads, breaking AC31 head validation a... |
| 47 | 14 | `src/quality/miss-sensitive-content-lists.ts`:33 | `security` | `credential-pattern-gap` | The API-key guard misses common hyphenated keys such as `sk-proj-...`; prefixed assignments such as `OPENAI_API_KEY=sk-proj-...` also evade `SECRET_ASSIGNMENT` because its word boundary cannot star... |
| 48 | 14 | `docs/testing/workflow/53-capture-external-review-misses-planted-proofs-record.md`:6 | `other` | `planted-proof-evidence` | The planted-proof set does not isolate every new credential assertion: P1 proves only `secret_assignment` and P5 proves bearer handling, while code-hosting tokens, API keys, private-key blocks, and... |
| 49 | 15 | `src/quality/miss-github-evidence.ts`:125 | `correctness` | `pr-head-push-order` | AC37 is not reliably implemented: consecutive `committed` timeline events are assumed to belong to one push, but separate pushes can produce adjacent commit events. For pushes A, B, C without inter... |
| 50 | 15 | `src/quality/miss-capture-gate.ts`:376 | `correctness` | `refusal-precedence` | Stage 3 resolves the source corpus before scanning credentials. If a credential-shaped field and a corpus-resolution failure coexist, the reported refusal is the baseline failure, contradicting the... |
| 51 | 15 | `src/quality/review-quality-report.ts`:648 | `correctness` | `spec-ac-compliance` | The suggested-action count excludes unresolvable records, but the subsequent `recordIds` selection includes every true-positive row in the category without checking `unresolvableEvidence`. A catego... |
| 52 | 15 | `docs/testing/workflow/53-capture-external-review-misses-planted-proofs-record.md`:101 | `other` | `planted-proof-evidence` | P11 explicitly says its failing planted run was not executed. REVIEW.md requires a demonstrated fail-when-planted and pass-when-restored run for each materially modified guard; a passing regression... |
| 53 | 16 | `src/quality/miss-github-evidence.ts`:149 | `correctness` | `pr-head-push-order` | AC31/AC37 violation: push boundaries are inferred from commit author dates. Commits from one push commonly have different author dates, so intermediate commits become alleged PR heads, allowing inv... |
| 54 | 16 | `src/quality/miss-github-evidence.ts`:208 | `correctness` | `external-output-parsing` | The clean-output matcher treats any body containing "didn't find any major issues" or "no blocking issues found" as finding-free. Those phrases can accompany minor/advisory findings, causing automa... |
| 55 | 16 | `src/quality/miss-github-evidence.ts`:635 | `correctness` | `external-output-parsing` | AC17's unparseable-output branch is unreachable for nonempty current-head output: every non-clean review/comment body is converted into at least one finding, regardless of structure, so malformed s... |
| 56 | 17 | `src/quality/miss-github-evidence.ts`:144 | `correctness` | `pr-head-push-order` | Push-order reconstruction only reads `head_ref_force_pushed` events, so ordinary previous PR heads are omitted. In the common A→B→C push sequence, a Ronda result on B cannot be selected for a findi... |
| 57 | 17 | `src/quality/miss-capture-gate.ts`:660 | `partial_success` | `per-finding-resolution` | Criteria/matrix mismatch: a missing or count-mismatched per-finding category returns a whole-capture refusal. Stage 2 is explicitly per finding, and AC35 requires valid sibling findings to continue... |
| 58 | 17 | `src/quality/miss-github-evidence.ts`:602 | `correctness` | `external-output-parsing` | Review-level findings always store location as `unresolved`, even when the body is considered interpretable specifically because it contains a `path:line` pointer. This discards the reviewer-provid... |
| 59 | 17 | `docs/testing/workflow/53-capture-external-review-misses-planted-proofs-record.md`:10 | `other` | `planted-proof-evidence` | The new automated guards lack the required demonstrated planted-violation evidence. This record mostly states expected arrows rather than recording executed commands and fail/pass output, and sever... |
| 60 | 18 | `src/quality/miss-sensitive-content-lists.ts`:49 | `security` | `credential-pattern-gap` | The secret-assignment guard only recognizes bare names such as `token`, `secret`, and `password`. Common credential assignments including `GITHUB_TOKEN=...`, `CLIENT_SECRET=...`, and `DB_PASSWORD=.... |
| 61 | 18 | `src/quality/miss-github-evidence.ts`:159 | `correctness` | `pr-head-push-order` | Every commit returned by the PR commits endpoint is treated as a historical PR head. When a branch containing multiple commits is pushed or used to open a PR, intermediate ancestors were never PR h... |
| 62 | 18 | `src/cli/capture-external-review-misses.ts`:690 | `other` | `operator-usability` | Automatic capture does not present extracted findings before requiring per-finding categories. With multiple findings, the documented singular `--category` is discarded, while `--categories` requir... |
| 63 | 19 | `src/quality/miss-github-evidence.ts`:159 | `correctness` | `pr-head-push-order` | Every commit returned by the PR commits endpoint is treated as a historical PR head. A branch initially pushed with multiple commits exposes all commits here even though only its tip was ever a hea... |
| 64 | 19 | `src/quality/miss-github-evidence.ts`:450 | `correctness` | `external-output-parsing` | `splitCommentFindingTexts` emits introductory prose before the first bullet as a finding, and the structured-review path later accepts that segment unconditionally. For a body such as `Codex found... |
| 65 | 19 | `src/quality/miss-sensitive-content-lists.ts`:50 | `correctness` | `placeholder-exemption` | The unquoted secret-assignment value includes trailing syntax delimiters, so published placeholders are incorrectly rejected: `password=REDACTED;`, `password=changeme,`, and `token=example)` all ma... |
| 66 | 19 | `docs/testing/workflow/53-capture-external-review-misses-planted-proofs-record.md`:15 | `other` | `planted-proof-evidence` | The required planted-violation evidence cites stale locations rather than the actual assertions. For example, P1 names `miss-content-validator.test.ts:203`, which is a prior test's closing brace; t... |
| 67 | 20 | `src/quality/miss-sensitive-content-lists.ts`:50 | `security` | `credential-pattern-gap` | AC9 security gap: SECRET_ASSIGNMENT recognizes exact/snake_case names but misses common camelCase credential assignments such as `dbPassword=...`, `clientSecret=...`, and `apiKey=...`, allowing cre... |
| 68 | 20 | `src/quality/miss-content-validator.ts`:80 | `correctness` | `excerpt-sequence-boundaries` | The diff-marker guard strips arbitrary leading whitespace after the specified quote/shared-indent normalization. This refuses inputs such as a two-space-indented `@@` line even though the spec defi... |
| 69 | 20 | `docs/testing/workflow/53-capture-external-review-misses-planted-proofs-record.md`:48 | `other` | `planted-proof-evidence` | The required planted-proof evidence cites stale/non-isolating locations: the P4 range omits the source-excerpt proof completion, the malformed-PR range points to other tests, and the P5/P6 unit and... |
| 70 | 21 | `src/quality/miss-capture-gate.ts`:368 | `correctness` | `pr-head-push-order` | Manual capture rejects a real older PR head unless it appears in the force-push tip list. `isKnownPullRequestHead` ignores `rondaResultHeadShas`, so an ordinary earlier head with a durable Ronda re... |
| 71 | 21 | `src/quality/miss-capture-gate.ts`:381 | `correctness` | `record-identity` | Explicit finding titles are trimmed before persistence. AC30 requires a matching recapture to store the title exactly as its most recent source supplied it while ignoring surrounding whitespace onl... |
| 72 | 21 | `docs/testing/workflow/53-capture-external-review-misses-planted-proofs-record.md`:9 | `other` | `planted-proof-evidence` | The recorded planted-proof command does not execute the separately named code-hosting-token, API-key, private-key, cloud-key, or new camelCase-secret assertions, and the proof entries provide no is... |
| 73 | 22 | `src/quality/miss-github-evidence.ts`:483 | `correctness` | `pr-head-push-order` | Ordinary earlier PR heads are rejected unless they received a Ronda review. pushOrderedHeadShas contains only force-push tips plus the current head, and this check ignores commitOrderShas. Thus, fo... |
| 74 | 22 | `docs/testing/workflow/53-capture-external-review-misses-planted-proofs-record.md`:16 | `other` | `planted-proof-evidence` | The required planted-violation evidence is not demonstrated: the record states only an expected passing result and uses approximate/stale line ranges, without recorded failing and restored-passing... |
## Reproduction

```bash
gh pr view 98 --json comments --jq '.comments[].body' \
  | python3 -c 'import sys,re,json; \
print(json.dumps([json.loads(b) for b in re.findall(r"reviewer-loop-history:v1 -->\s*```json\s*(\{.*?\})\s*```", sys.stdin.read(), re.S)]))'
```

```bash
gh api repos/lhpaul/ronda/pulls/98/comments --paginate \
  --jq '.[] | "\(.path):\(.line // .original_line) | \(.commit_id[0:8])\n\(.body)"'
```

Category and sub-theme assignment is manual and is not reproduced by these
commands; it is recorded in the tables above.
