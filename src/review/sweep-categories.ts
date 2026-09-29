import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  Finding,
  SweepCategory,
  SweepCategoryList,
  SweepCategoryPassOutcome,
  SweepFindingAttribution,
} from "../domain/review-pass.types.js";

/**
 * The committed category list, resolved against the module's own URL rather
 * than the process's working directory — the same anchoring
 * `durability-regression.ts`'s `fixtureRoot()` uses. A deployed CLI or webhook
 * can run from outside the checkout, and a cwd-relative path would silently
 * degrade every pass to `sweep-did-not-run` (AC19), which is indistinguishable
 * from a genuinely broken artifact.
 */
export const SWEEP_CATEGORY_LIST_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../docs/testing/ronda/sweep-categories.json",
);

/** AC19's three list states, carried verbatim into the degraded record. */
export type SweepListFailureReason = "unreadable" | "empty" | "malformed";

export type SweepListResult =
  | { ok: true; list: SweepCategoryList }
  | { ok: false; reason: SweepListFailureReason; detail: string };

export interface SweepClassification {
  categories: Array<{ identifier: string; outcome: SweepCategoryPassOutcome }>;
  findings: SweepFindingAttribution[];
  uncategorizedFindingCount: number;
}

function nonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function malformed(detail: string): SweepListResult {
  return { ok: false, reason: "malformed", detail };
}

/**
 * Validates a parsed value against AC19's malformed-list domain. Every field a
 * category declares is checked in its own right (AC4, AC5): a description, a
 * failure shape, a count, and an evidence source are never inferred from one
 * another, so a list missing any of them is malformed rather than partly used.
 */
function validateParsed(value: unknown): SweepListResult {
  if (typeof value !== "object" || value === null) {
    return malformed("the list is not a JSON object");
  }

  const version = (value as { version?: unknown }).version;
  if (typeof version !== "string") {
    return malformed("the list version is missing or is not a scalar string");
  }
  if (version.trim() === "") {
    return malformed("the list version is blank");
  }

  const categories = (value as { categories?: unknown }).categories;
  if (!Array.isArray(categories)) {
    return malformed("the list has no categories array");
  }
  if (categories.length === 0) {
    return { ok: false, reason: "empty", detail: "the list has zero categories" };
  }

  const seen = new Set<string>();
  const validated: SweepCategory[] = [];

  for (const [index, entry] of categories.entries()) {
    const where = `category at index ${index}`;
    if (typeof entry !== "object" || entry === null) {
      return malformed(`${where} is not an object`);
    }
    const category = entry as Record<string, unknown>;

    for (const field of [
      "identifier",
      "displayLabel",
      "description",
      "failureShape",
      "evidenceSource",
    ] as const) {
      if (!nonBlankString(category[field])) {
        return malformed(`${where} has no non-blank ${field}`);
      }
    }

    const count = category.findingInstanceCount;
    if (typeof count !== "number" || !Number.isInteger(count) || count <= 0) {
      return malformed(`${where} has no positive integer findingInstanceCount`);
    }

    const matchTerms = category.matchTerms;
    if (!Array.isArray(matchTerms) || matchTerms.length === 0) {
      return malformed(`${where} has no non-empty matchTerms array`);
    }
    if (!matchTerms.every((term) => nonBlankString(term))) {
      return malformed(`${where} has a blank or non-string match term`);
    }

    const identifier = category.identifier as string;
    if (seen.has(identifier)) {
      return malformed(`duplicate category identifier ${identifier}`);
    }
    seen.add(identifier);

    validated.push({
      identifier,
      displayLabel: category.displayLabel as string,
      description: category.description as string,
      failureShape: category.failureShape as string,
      evidenceSource: category.evidenceSource as string,
      findingInstanceCount: count,
      matchTerms: matchTerms as string[],
    });
  }

  return { ok: true, list: { version, categories: validated } };
}

/**
 * Reads and validates the recorded category list. The optional `path` is the
 * direct-loader test seam only — no operator-configurable list path exists
 * (AC19's degrade branch needs no live reconfiguration; a malformed artifact
 * is fixed by editing the artifact).
 */
export function loadSweepList(options?: { path?: string }): SweepListResult {
  const path = options?.path ?? SWEEP_CATEGORY_LIST_PATH;

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    return {
      ok: false,
      reason: "unreadable",
      detail: `the list could not be read: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return malformed(
      `the list is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return validateParsed(parsed);
}

/**
 * Attributes each published finding to the swept categories it matches (AC20),
 * and reports what each category established. A function of the parsed
 * findings and the recorded list alone: no regex, no stemming, no model call,
 * so replaying the same findings against the same list version yields the same
 * record.
 *
 * Matching is literal substring containment of a category's recorded
 * `matchTerms` against the lowercase `title + "\n" + body`, the only signal.
 * A finding that genuinely belongs to a category but is phrased without any of
 * its terms is recorded uncategorized and that category is `produced_none` —
 * the honest record of a lexical classifier, and it stays inside AC1's fixed
 * three-outcome vocabulary rather than inventing an abstention.
 */
export function classifyFindings(
  findings: readonly Finding[],
  list: SweepCategoryList,
): SweepClassification {
  const attribution: SweepFindingAttribution[] = [];
  const matched = new Set<string>();
  let uncategorizedFindingCount = 0;

  findings.forEach((finding, publicationIndex) => {
    const text = `${finding.title}\n${finding.body}`.toLowerCase();
    const categories = list.categories
      .filter((category) => category.matchTerms.some((term) => text.includes(term)))
      .map((category) => category.identifier);

    if (categories.length === 0) {
      uncategorizedFindingCount += 1;
    } else {
      for (const identifier of categories) {
        matched.add(identifier);
      }
    }

    attribution.push({ publicationIndex, categories });
  });

  return {
    categories: list.categories.map((category) => ({
      identifier: category.identifier,
      outcome: matched.has(category.identifier) ? "produced_findings" : "produced_none",
    })),
    findings: attribution,
    uncategorizedFindingCount,
  };
}
