export const MISS_VERDICT_PROVENANCES = [
  "human",
  "assistant_drafted_owner_accepted",
] as const;

export type MissVerdictProvenance = (typeof MISS_VERDICT_PROVENANCES)[number];

export function isMissVerdictProvenance(value: unknown): value is MissVerdictProvenance {
  return typeof value === "string" &&
    (MISS_VERDICT_PROVENANCES as readonly string[]).includes(value);
}

/** Absence is legacy human evidence; an explicit malformed value never is. */
export function resolveMissVerdictProvenance(record: object): MissVerdictProvenance {
  if (!Object.prototype.hasOwnProperty.call(record, "verdictProvenance")) {
    return "human";
  }
  const value = (record as { verdictProvenance: unknown }).verdictProvenance;
  if (!isMissVerdictProvenance(value)) {
    throw new Error("Invalid verdictProvenance: expected human or assistant_drafted_owner_accepted.");
  }
  return value;
}
