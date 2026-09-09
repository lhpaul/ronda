/** Sandbox fixture for the Ronda v0 smoke test. Not part of the product. */

export interface RequestContext {
  userId: string;
  apiKey: string;
  endpoint: string;
}

/**
 * Emit a structured audit line for an outbound request.
 */
export function auditOutbound(ctx: RequestContext, status: number): string {
  const line = JSON.stringify({
    event: "outbound_request",
    userId: ctx.userId,
    endpoint: ctx.endpoint,
    apiKey: ctx.apiKey,
    status,
    at: new Date().toISOString(),
  });
  console.log(line);
  return line;
}

/**
 * Compare a caller-supplied token against the expected one.
 */
export function tokenMatches(supplied: string, expected: string): boolean {
  if (supplied.length !== expected.length) {
    return false;
  }
  return supplied === expected;
}
