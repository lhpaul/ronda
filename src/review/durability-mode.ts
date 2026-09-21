import { reviewStageForBranch, type ReviewStage } from "./stage-resolution.js";

/** Matches `REVIEW_DURABILITY_MODE_MAX_BYTES` in workflow-lib.sh. */
export const REVIEW_DURABILITY_MODE_MAX_BYTES = 16_000;

export const DURABILITY_SCENARIO_FAMILIES = [
  "restart_recovery",
  "retry_semantics",
  "timeout_watchdog",
  "duplicate_delivery",
  "partial_success",
  "persistence_integrity",
] as const;

export type DurabilityScenarioFamily = (typeof DURABILITY_SCENARIO_FAMILIES)[number];

export type DurabilityModeState = "active" | "inactive" | "unavailable";

export type DurabilityActivationReason =
  | "automatic_match"
  | "operator_default"
  | "operator_override"
  | "";

export type DurabilityUnavailableReason = "missing" | "unreadable" | "oversized" | "";

export type DurabilityForceMode = "on" | "off" | "default";

export interface DurabilityFamilyNa {
  family: DurabilityScenarioFamily;
  reason: string;
}

export interface DurabilityModeResolution {
  state: DurabilityModeState;
  activationReason: DurabilityActivationReason;
  unavailableReason: DurabilityUnavailableReason;
  inactiveReason?: "automatic_rules_did_not_match" | "operator_override";
  scenarioFamiliesInScope: DurabilityScenarioFamily[];
  scenarioFamiliesNa: DurabilityFamilyNa[];
  modeText: string;
}

export interface ResolveDurabilityModeInput {
  headBranch: string;
  changedPaths: string[];
  /** Force on/off; `default` means no force. */
  durabilityMode?: DurabilityForceMode;
  /** Repository default-on when automatic rules do not match. */
  durabilityModeDefault?: boolean;
  /**
   * Mode document text loaded from the reviewed head, or null when missing.
   * Pass undefined when the caller has not attempted a load yet.
   */
  modeDocumentText?: string | null;
  /** When true, treat a failed read as unreadable rather than missing. */
  modeDocumentUnreadable?: boolean;
}

/**
 * Deterministic path sensitivity rules from the #54 implementation plan.
 * False negatives on listed sensitive surfaces are defects (AC-1).
 */
export function durabilityPathIsSensitive(path: string): boolean {
  if (!path) {
    return false;
  }

  if (path === "src/webhook" || path.startsWith("src/webhook/")) {
    return true;
  }
  if (
    path === "src/github/check-run-publisher.ts" ||
    path === "src/github/review-publisher.ts" ||
    path === "src/core/run-review-pass.ts"
  ) {
    return true;
  }
  if (
    path === "scripts/development-workflow/pr-review-loop.sh" ||
    path === "scripts/development-workflow/local-ai-reviewer.sh"
  ) {
    return true;
  }

  // **/webhook/*.ts and **/webhook-*.ts (** may match zero directories)
  if (/(^|\/)webhook\/.+\.ts$/.test(path) || /(^|\/)webhook-[^/]+\.ts$/.test(path)) {
    return true;
  }

  // Keyword surfaces under src/ or scripts/
  if (
    (path.startsWith("src/") || path.startsWith("scripts/")) &&
    /queue|retry|idempot/i.test(path)
  ) {
    return true;
  }

  return false;
}

export function durabilityPathsMatch(changedPaths: string[]): boolean {
  return changedPaths.some(durabilityPathIsSensitive);
}

function pathTouchesWebhook(path: string): boolean {
  return (
    path === "src/webhook" ||
    path.startsWith("src/webhook/") ||
    /(^|\/)webhook\/.+\.ts$/.test(path) ||
    /(^|\/)webhook-[^/]+\.ts$/.test(path)
  );
}

export function durabilityFamiliesNaForPaths(changedPaths: string[]): DurabilityFamilyNa[] {
  if (changedPaths.some(pathTouchesWebhook)) {
    return [];
  }
  return [
    {
      family: "duplicate_delivery",
      reason: "no webhook or dual-ingress surface in changed files",
    },
  ];
}

function familiesInScope(na: DurabilityFamilyNa[]): DurabilityScenarioFamily[] {
  const excluded = new Set(na.map((entry) => entry.family));
  return DURABILITY_SCENARIO_FAMILIES.filter((family) => !excluded.has(family));
}

function supplyStateFromDocument(
  modeDocumentText: string | null | undefined,
  modeDocumentUnreadable: boolean | undefined,
): "supplied" | "absent" | "unreadable" | "oversized" {
  if (modeDocumentUnreadable) {
    return "unreadable";
  }
  if (modeDocumentText === null || modeDocumentText === undefined) {
    return "absent";
  }
  if (Buffer.byteLength(modeDocumentText, "utf8") > REVIEW_DURABILITY_MODE_MAX_BYTES) {
    return "oversized";
  }
  return "supplied";
}

function unavailableReasonFromSupply(
  supply: "absent" | "unreadable" | "oversized",
): DurabilityUnavailableReason {
  if (supply === "absent") {
    return "missing";
  }
  return supply;
}

function activeResult(
  activationReason: Exclude<DurabilityActivationReason, "">,
  changedPaths: string[],
  modeText: string,
): DurabilityModeResolution {
  const scenarioFamiliesNa = durabilityFamiliesNaForPaths(changedPaths);
  return {
    state: "active",
    activationReason,
    unavailableReason: "",
    scenarioFamiliesInScope: familiesInScope(scenarioFamiliesNa),
    scenarioFamiliesNa,
    modeText,
  };
}

function inactiveResult(
  inactiveReason: "automatic_rules_did_not_match" | "operator_override",
): DurabilityModeResolution {
  return {
    state: "inactive",
    activationReason: "",
    unavailableReason: "",
    inactiveReason,
    scenarioFamiliesInScope: [],
    scenarioFamiliesNa: [],
    modeText: "",
  };
}

function unavailableResult(reason: DurabilityUnavailableReason): DurabilityModeResolution {
  return {
    state: "unavailable",
    activationReason: "",
    unavailableReason: reason,
    scenarioFamiliesInScope: [],
    scenarioFamiliesNa: [],
    modeText: "",
  };
}

/**
 * Decision matrix rows 1–8 from the #54 spec.
 */
export function resolveDurabilityMode(input: ResolveDurabilityModeInput): DurabilityModeResolution {
  const stage: ReviewStage = reviewStageForBranch(input.headBranch);
  const force = input.durabilityMode ?? "default";
  const defaultOn = Boolean(input.durabilityModeDefault);
  const automaticMatch = durabilityPathsMatch(input.changedPaths);
  const supply = supplyStateFromDocument(input.modeDocumentText, input.modeDocumentUnreadable);
  const instructionsOk = supply === "supplied";
  const modeText = instructionsOk ? (input.modeDocumentText ?? "") : "";

  // Row 1
  if (stage !== "implementation") {
    return inactiveResult("automatic_rules_did_not_match");
  }

  // Row 4
  if (force === "off") {
    return inactiveResult("operator_override");
  }

  // Rows 2–3
  if (force === "on") {
    if (!instructionsOk) {
      return unavailableResult(unavailableReasonFromSupply(supply));
    }
    return activeResult("operator_override", input.changedPaths, modeText);
  }

  // Rows 5–6
  if (automaticMatch) {
    if (!instructionsOk) {
      return unavailableResult(unavailableReasonFromSupply(supply));
    }
    return activeResult("automatic_match", input.changedPaths, modeText);
  }

  // Row 8
  if (defaultOn) {
    if (!instructionsOk) {
      return unavailableResult(unavailableReasonFromSupply(supply));
    }
    return activeResult("operator_default", input.changedPaths, modeText);
  }

  // Row 7
  return inactiveResult("automatic_rules_did_not_match");
}

export const DURABILITY_MODE_DOCUMENT_PATH =
  "docs/workflow/development-workflow/durability-idempotency-review-mode.md";
