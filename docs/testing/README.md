# Testing — Smoke Test Execution Guide

> **STATUS: TEMPLATE**
>
> Fill in this file during project setup. Replace all `[placeholders]` with your project's actual tools, commands, and paths. Delete sections that don't apply.

**Audience**: AI agents running smoke tests (smoke-tester agent, Cursor `/smoke-tester` command, or equivalent).

The smoke test _process_ (inputs, output format, pass criteria, fail handling) is defined in the [Smoke Test Protocol](../workflow/development-workflow/protocols/04-smoke-test-protocol.md). This guide covers **how** to execute tests in this specific repo.

When a work item has graphical design references, runbooks may include optional
expected-vs-actual fidelity steps. Discover assets and record PASS/FAIL detail
per [`design-assets.md`](../workflow/development-workflow/design-assets.md) and
protocol `04`. Omit fidelity steps when no assets exist — do not invent a
baseline.

If this repository has a preferred browser automation provider, declare it in `.ai-dev-workflow.yaml` under `browser_automation.provider`.

---

## 1. Read Context

Before running anything:

1. **Read the smoke test runbook** — provided by the human or located under `docs/testing/` (e.g. `docs/testing/[app]/[feature].smoke-test.md`).
2. **Read the application source** for the pages under test — selectors, form structure, component patterns.

Workflow-framework smoke tests live under `docs/testing/workflow/`. For
delegated `/run-epic` human-checkpoint behavior, use
[`workflow/1024-human-checkpoint-lifecycle.smoke-test.md`](workflow/1024-human-checkpoint-lifecycle.smoke-test.md)
as the end-to-end lifecycle runbook.

---

## 2. Choose Execution Approach

Before writing any code, check whether a committed automated spec already exists for the feature under test.

```
Does tests/integration/[feature].test.ts (or a scenario in
tests/unit/core/run-review-pass.test.ts) exist for the feature under test?
  │
  ├─ YES → Run the committed test suite (preferred)
  │         npm test
  │
  └─ NO  → Follow the smoke test runbook manually (fallback — Section 3 does
            not apply to this repository; Ronda has no browser UI)
```

Ronda's committed-spec path convention: `tests/unit/[layer]/[module].test.ts`
for unit coverage against injected fakes, and
`tests/integration/[feature].test.ts` for a full pass exercised against
`tests/support/mock-model-server.ts` with only the GitHub layer faked. There
is no browser-based E2E suite for Ronda (no UI) — the `e2e/` Playwright
placeholder in this repository is not extended by product features; see
`docs/project/3-software-architecture.md` → Testing Strategy.

If the automated suite exists for the feature, run it and report results
directly. Sections 3 onward in this guide describe a browser-automation
fallback that does not apply to Ronda; go straight to the feature's smoke
test runbook under `docs/testing/ronda/` instead when automated coverage is
insufficient.

---

## 2a. Run the Committed Test Suite

```bash
# All unit and integration tests
npm test

# One test file
npx tsx --test tests/unit/core/run-review-pass.test.ts

# Typecheck and lint (run alongside tests before every PR)
npm run typecheck
npm run lint
```

---

## 3. Ad-hoc Script (Fallback)

Use when no committed spec exists yet.

### Environment Setup

> **TODO**: Fill in commands to start all required services and the application.

```bash
# Start backing services (e.g. local database)
[command]

# Reset and seed the database
[command]

# Start the application
[command]   # → http://localhost:[port]
```

### Install Browser Automation and Run

> **TODO**: Fill in your browser automation tooling. If using Node.js + Playwright:

```bash
cd /tmp && npm install playwright 2>/dev/null
npx playwright install chromium 2>/dev/null
node /tmp/smoke-test.mjs
```

### Script Structure

```js
// Example using Node.js + Playwright
import { chromium } from "playwright";

const BASE_URL = "http://localhost:[port]";
const results = [];

function pass(step) {
  results.push({ step, status: "PASS" });
  console.log(`✅ PASS — ${step}`);
}

function fail(step, error) {
  results.push({ step, status: "FAIL", error: String(error) });
  console.error(`❌ FAIL — ${step}: ${error}`);
}

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Step 1 — Login
    await page.goto(`${BASE_URL}/[login-path]`);
    // ... authentication
    pass("Step 1: Login");
  } catch (e) {
    fail("Step 1: Login", e);
  }

  console.log("\n--- RESULTS ---");
  results.forEach((r) =>
    console.log(`${r.status} — ${r.step}${r.error ? ": " + r.error : ""}`),
  );
  await browser.close();
})();
```

### Selector Priority

1. `[data-testid="..."]` — preferred (stable, automation-only)
2. ARIA roles (`getByRole(...)`)
3. Visible text (`getByText(...)`, `getByLabel(...)`)
4. CSS class / tag — last resort

### Waiting Strategy

```js
// ✅ Wait for element
await page.waitForSelector('[data-testid="my-element"]');

// ✅ Wait for navigation
await page.waitForURL("**/expected-path");

// ⚠️ Last resort only — document why no observable signal exists
await page.waitForTimeout(500);
```

### OTP / Email Testing

> **TODO**: Document how to extract OTPs or verification emails in your local environment (e.g. Mailpit, Mailhog, or similar).

```bash
# Example with Mailpit
curl -s http://localhost:[mailpit-port]/api/v1/messages | jq -r '.messages[0].Snippet' | grep -oE '[0-9]{6}'
```

### Database Verification

> **TODO**: Document how to query the database directly for verification.

```bash
# Example with PostgreSQL
[db-query-command]
```

### Cleanup

> **TODO**: Fill in cleanup commands.

```bash
# Stop app server
[kill-command]

# Stop backing services
[command]

# Remove temporary test files
rm -f /tmp/smoke-test*.mjs && rm -rf /tmp/smoke-screenshots
```

---

## Troubleshooting

> **TODO**: Document known issues, UI library quirks, and workarounds specific to this project's tech stack. For example: dialog rendering behaviour, dropdown interaction patterns, form submission edge cases.

---

## References

- **Smoke test process and output format**: [Smoke Test Protocol](../workflow/development-workflow/protocols/04-smoke-test-protocol.md)
