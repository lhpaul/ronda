import type { Logger } from "../domain/review-pass.types.js";

/**
 * Single-line JSON logger. Every serialised string value equal to one of
 * `redactValues` (typically the resolved model API key and the GitHub
 * token), and every `authorization`-named field regardless of value, is
 * replaced with `[REDACTED]` before the line is written. See the spec's
 * Operational Visibility rule: "It must not record credentials."
 */
export function createLogger(
  redactValues: Array<string | undefined | null> = [],
  write: (line: string) => void = (line) => console.log(line),
): Logger {
  const redactSet = new Set(
    redactValues.filter((value): value is string => Boolean(value && value.length > 0)),
  );

  return {
    event(name: string, fields: Record<string, unknown>) {
      const payload = {
        event: name,
        timestamp: new Date().toISOString(),
        ...(redact(fields, redactSet) as Record<string, unknown>),
      };
      write(JSON.stringify(payload));
    },
  };
}

function redact(value: unknown, redactSet: Set<string>): unknown {
  if (typeof value === "string") {
    return redactSet.has(value) ? "[REDACTED]" : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, redactSet));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key.toLowerCase() === "authorization") {
        out[key] = "[REDACTED]";
        continue;
      }
      out[key] = redact(val, redactSet);
    }
    return out;
  }
  return value;
}
