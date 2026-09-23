# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-09-23

### Added

- **Local webhook service** (#25): GitHub App webhook entrypoint for running Ronda review passes on operator-owned hardware, with safe recovery of stranded in-progress jobs (#58).
- **Review quality tooling** (#24, #31, #35, #56): Precision fixtures, same-head comparison collection/summary, and an operator report that rolls up comparison and miss evidence into outcome buckets.
- **Capture external-review misses** (#53): Durable, privacy-bounded eval records for adjudicated external findings, with fail-closed sensitive-content scanning and fresh resolvability at report time.
- **Durability and idempotency review mode** (#54): Implementation-stage review mode with deterministic path activation, operator overrides, dual-surface visibility, and seeded regression fixtures.
- **Authoritative docs in review passes** (#55): Bounded constitution, architecture, adoption, and review-contract excerpts attached to governed changes with binding vs advisory labels.
- **Local reviewer timeout diagnostics** (#57): Classify local infrastructure failures separately from missing clean evidence; require explicit justification for forced Codex GitHub runs.
- **Isolating planted violations** (#63): Align REVIEW.md, Protocol 03, and Step 7a reviewers on per-assertion isolating plants.

### Changed

- **Default ready-phase reviewer** (#49): Local draft review followed by Codex GitHub (replacing Bugbot as the default).
- **Surface local reviewer findings** (#64): Redacted blocking finding locations and messages in the reviewer-loop summary and durable history.
- **Step 8a readiness checklist** (#65): Protocol 91 Checks 0–4 run via `pr-label-readiness-checklist.sh` with fixture tests.

### Fixed

- **Review-quality corpus and summary** (#29, #33, #37, #41, #43, #45, #47): Expand the same-head comparison corpus (including downstream samples) and keep unclear Ronda-clean / other-findings cases visible as false-clean candidates.
- **Reviewer-loop guard refresh** (#39): Refresh the PR-scoped completion guard status after a reviewer-loop summary is persisted.
- **`/run-epic` audit trail false booleans** (#60): Render recorded `false` policy values literally instead of blank.
- **Retrospective metrics ownership** (#62): Archive template-inherited retro rows so Ronda trend analysis starts from this repo's history.
- **Workflow repo root under zsh** (#66): Fail closed when `BASH_SOURCE` is unavailable instead of resolving to filesystem root.
- **Local reviewer loop** (#69): Escalate contradictory or unconfirmed local `needs_fixes` responses instead of creating false blockers.

## [0.1.0] - 2026-09-10

### Added

- **Ronda v0 GitHub review** (#2): ship a reusable GitHub Actions workflow that
  posts one comment-only pull-request review and one `Ronda review` check run per
  head SHA, using a configurable OpenAI-compatible model vendor.
- **Review recall benchmark** (#15): add seeded defect fixtures and a
  `benchmark:recall` command for measuring review recall, misses, false
  positives, model identity, reviewed target, and run timestamp.
- **Project bootstrap**: establish the Ronda constitution, domain docs,
  GitHub Project #11 tracking, and ADF workflow configuration for this
  repository.

### Fixed

- **Reusable workflow startup** (#9): derive review timeouts in a setup job so
  the workflow parses correctly and keeps the outer Actions timeout behind
  Ronda's in-process pass deadline.
- **GitHub-phase timeout handling** (#11): classify aborted GitHub API calls as
  `timed_out` failures and publish a failure check run when the triggering event
  already supplied a head SHA.
- **Adoption and smoke-test accuracy** (#13): document caller-side token
  permissions, private reusable-workflow access, and the local PAT limitation
  for GitHub check-run creation.
- **Reviewer-loop lock scope** (#6): key workflow reviewer-loop locks by
  repository and pull request so same-numbered PRs in different repositories do
  not block each other.
- **PR policy readiness checks** (#16): ignore stale PR policy check runs when
  deciding current-head readiness, while preserving the reviewer-loop guard that
  blocks readiness until review evidence exists.

[Unreleased]: https://github.com/lhpaul/ronda/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/lhpaul/ronda/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/lhpaul/ronda/releases/tag/v0.1.0
