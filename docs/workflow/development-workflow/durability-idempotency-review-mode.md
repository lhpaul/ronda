# Durability and Idempotency Review Mode

This mode layers **lifecycle** questions onto an ordinary implementation review.
It does not replace REVIEW.md, stage checklists, or review doctrine. When the
mode is active, reason about restart, retry, timeout, duplicate delivery,
partial success, and persistence failures on the changed surfaces — especially
webhook workers, job queues, retry wrappers, and external publishers.

**Concise-output rule.** Report only independently actionable defects. Do not
paste a family-by-family checklist into comment bodies. When no lifecycle
defect is found, report nothing extra inline; coverage belongs in activation
metadata only.

## Scenario families

### Restart and recovery

If the process crashes or is restarted mid-work, is durable state consistent?
Is in-flight work resumed safely, abandoned cleanly, or left half-applied?
Look for listeners that stay closed, queues that stall, or recovery that
re-enters work without clearing prior partial effects.

### Retry semantics

Are retries bounded, idempotent, and safe after a partial external effect?
Are transient failures distinguished from fatal ones so fatal paths do not
keep draining work? Confirm that retry wrappers do not amplify duplicate
side effects on publishers or durable stores.

### Timeout and watchdog

Can a long-running job exceed its budget without an outer bound? Watch for
stuck queues, closed listeners that never reopen, health checks that still
pass while work is blocked, and supervisors that cannot restart the worker.

### Duplicate delivery

If the same external event arrives twice — replay, redelivery, or dual
ingress — can side effects happen twice when they must not? Check that
manual and automatic paths share arbitration or deduplication for the same
intent.

### Partial success

If an external effect succeeded once (review published, check run written,
queue entry stored) and a later step fails, can recovery duplicate or lose
work? Prefer resume or compensate over replaying the same publish intent.

### Persistence integrity

Can on-disk or durable queue state become corrupt, silently dropped, or
inconsistent with memory after crash or failed cleanup? Confirm cleanup and
rewrite paths leave a recoverable store.

## When no lifecycle defect is found

If you inspected the in-scope families and found no independently actionable
lifecycle defect, return an empty findings list for this mode. Do not invent
"looks fine" comments per family. Activation metadata already records which
families were in scope.
