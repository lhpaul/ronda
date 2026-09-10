# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/lhpaul/ronda/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/lhpaul/ronda/releases/tag/v0.1.0
