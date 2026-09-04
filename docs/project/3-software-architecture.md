# Software Architecture

## Tech Stack

Language and HTTP framework are **not locked** (v0 spec). Constraints that
are locked:

| Layer | Constraint | Notes |
| --- | --- | --- |
| Ingress | One public HTTPS URL | GitHub App webhook or stable hostname |
| Host | Any machine that can bind localhost | MacBook for tests; Mini for 24/7 |
| GitHub output | Pull Request Review + check run | So ADF `pr-review-loop.sh` can wait |
| Inference | API first, local later | Same handler |
| CI | GitHub Actions from the ADF template | Until a spec says otherwise |

## Key Architectural Decisions

### URL is not the machine

- **Context**: Tests can start on the MacBook; 24/7 and local models live elsewhere.
- **Decision**: GitHub sees a hostname. A tunnel maps it to the current process.
- **Consequences**: Change tunnel target without rotating the GitHub App.

### Comment-only, one pass per SHA

- **Context**: CodeRabbit rate-limits; Codex/Copilot stall after the first finding.
- **Decision**: Publish every finding in one review; never push fixes.
- **Consequences**: ADF loop owns fix cycles; this bot stays a reviewer.

### Thin ADF/Helm adapters, fat product here

- **Context**: The template already has a platform list for GitHub reviewers.
- **Decision**: Add one provider name; do not implement the bot inside ADF.
- **Consequences**: Follow-ups of the bot stay in Project #11.

### Action is an allowed v0 stand-in

- **Context**: A GitHub App takes registration; an Action can dogfood the poster.
- **Decision**: v0 spec may ship a reusable workflow first, then the App.
- **Consequences**: The poster API is the stable core either way.

## Security

- Webhook secret verified on every request.
- Installation tokens via GitHub App, not a PAT in git.
- Model keys only in `~/.config/ronda/` or 1Password.
- No vault paths in versioned config.
