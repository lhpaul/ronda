import type { Logger } from "../domain/review-pass.types.js";

/**
 * Single-line JSON logger. Every occurrence of a `redactValues` entry
 * (typically the resolved model API key and the GitHub token) inside a
 * serialised string value — whether the value *is* the secret or merely
 * *contains* it, such as inside a wrapped error message — and every
 * `authorization`-named field regardless of value, is replaced with
 * `[REDACTED]` before the line is written. See the spec's Operational
 * Visibility rule: "It must not record credentials."
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
    let result = value;
    for (const secret of redactSet) {
      // Substring replace, not just exact-match: a credential can appear
      // embedded inside a larger string (a wrapped error message, a thrown
      // exception's `.message`, a URL) rather than as the field's entire
      // value. `split`/`join` replaces every occurrence without needing a
      // regex-escaped pattern for the secret's literal characters.
      result = result.split(secret).join("[REDACTED]");
    }
    return result;
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
