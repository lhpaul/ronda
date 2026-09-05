/**
 * Finding severity. See docs/specs/developments/20260905120949_ronda-v0-github-review/1_ronda-v0-github-review_specs.md
 * "Finding severity" table. Severity affects only labelling and counting — it
 * never changes the pass outcome.
 */
export type Severity = "blocking" | "important" | "nit";

const SEVERITY_LABELS: Record<Severity, string> = {
  blocking: "Blocking",
  important: "Important",
  nit: "Nit",
};

/** Code value to display label, per the spec's Statuses / Enum Values table. */
export function severityLabel(severity: Severity): string {
  return SEVERITY_LABELS[severity];
}

/** Case-sensitive membership check against the three code values. */
export function isSeverity(value: string): value is Severity {
  return value === "blocking" || value === "important" || value === "nit";
}
