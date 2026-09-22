/**
 * Published credential-refusal forms and placeholder literals for miss capture
 * (AC9, AC18). Expanding either list is a deliberate source change — not
 * runtime config.
 */

/** Whole-literal placeholders accepted even when credential-shaped (AC18). */
export const MISS_PLACEHOLDER_LITERALS = [
  "REDACTED",
  "example",
  "changeme",
] as const;

export type MissPlaceholderLiteral = (typeof MISS_PLACEHOLDER_LITERALS)[number];

export type CredentialRefusalForm =
  | "code_hosting_access_token"
  | "api_key"
  | "private_key_block"
  | "cloud_access_key_identifier"
  | "authorization_bearer"
  | "secret_assignment";

export interface CredentialMatch {
  form: CredentialRefusalForm;
  /** Matched substring; never echoed in operator-facing refusal text. */
  matchedLength: number;
}

const CODE_HOSTING_TOKEN =
  /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/;

const API_KEY =
  /\b(?:sk(?:-[A-Za-z0-9]+)*-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|(?:[A-Za-z0-9_]*_)?api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}['"]?)\b/i;

const PRIVATE_KEY_BLOCK =
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/;

const CLOUD_ACCESS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/;

const AUTHORIZATION_BEARER =
  /\bAuthorization\s*:\s*Bearer\s+([A-Za-z0-9\-._~+/]+=*)/i;

/**
 * Assignment whose name reads as password/secret/token/api_key with a literal
 * value — quoted (`password="x"`) or unquoted (`password=x`) per AC9.
 * Capture groups: [2]=quoted value, [3]=unquoted value.
 */
const SECRET_ASSIGNMENT =
  /(?:^|[^A-Za-z0-9_])(?:password|passwd|secret|token|(?:[A-Za-z0-9_]+_)?api[_-]?key)\b\s*[:=]\s*(?:(['"])([^'"]+)\1|([^\s'"]+))/i;

/**
 * Returns whether `value` equals a published placeholder literal after
 * trimming surrounding whitespace and ignoring case.
 */
export function isPublishedPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return MISS_PLACEHOLDER_LITERALS.some(
    (literal) => literal.toLowerCase() === normalized,
  );
}

/**
 * Scan text for credential-shaped content. Placeholder whole-literal values
 * (AC18) are accepted and do not match. Returns the first matching form in
 * precedence order of the six published forms.
 */
export function findCredentialMatch(text: string): CredentialMatch | null {
  if (text.trim() === "") {
    return null;
  }

  // Whole-field placeholder acceptance: if the entire field is a placeholder,
  // never refuse even when the shape would otherwise match.
  if (isPublishedPlaceholder(text)) {
    return null;
  }

  const checks: Array<{ form: CredentialRefusalForm; regex: RegExp }> = [
    { form: "code_hosting_access_token", regex: CODE_HOSTING_TOKEN },
    { form: "api_key", regex: API_KEY },
    { form: "private_key_block", regex: PRIVATE_KEY_BLOCK },
    { form: "cloud_access_key_identifier", regex: CLOUD_ACCESS_KEY },
    { form: "authorization_bearer", regex: AUTHORIZATION_BEARER },
    { form: "secret_assignment", regex: SECRET_ASSIGNMENT },
  ];

  for (const check of checks) {
    if (check.form === "secret_assignment") {
      const assignmentPattern = new RegExp(
        SECRET_ASSIGNMENT.source,
        SECRET_ASSIGNMENT.flags.includes("g")
          ? SECRET_ASSIGNMENT.flags
          : `${SECRET_ASSIGNMENT.flags}g`,
      );
      let assignmentMatch: RegExpExecArray | null;
      while ((assignmentMatch = assignmentPattern.exec(text)) !== null) {
        const assigned = assignmentMatch[2] ?? assignmentMatch[3] ?? "";
        if (!isPublishedPlaceholder(assigned)) {
          return {
            form: "secret_assignment",
            matchedLength: assignmentMatch[0].length,
          };
        }
      }
      continue;
    }

    if (check.form === "authorization_bearer") {
      const bearerPattern = new RegExp(
        AUTHORIZATION_BEARER.source,
        AUTHORIZATION_BEARER.flags.includes("g")
          ? AUTHORIZATION_BEARER.flags
          : `${AUTHORIZATION_BEARER.flags}g`,
      );
      let bearerMatch: RegExpExecArray | null;
      while ((bearerMatch = bearerPattern.exec(text)) !== null) {
        const bearerValue = bearerMatch[1] ?? "";
        if (!isPublishedPlaceholder(bearerValue)) {
          return {
            form: "authorization_bearer",
            matchedLength: bearerMatch[0].length,
          };
        }
      }
      continue;
    }

    const match = check.regex.exec(text);
    if (!match) {
      continue;
    }
    if (isPublishedPlaceholder(match[0])) {
      continue;
    }
    return { form: check.form, matchedLength: match[0].length };
  }

  return null;
}
