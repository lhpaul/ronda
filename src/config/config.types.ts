export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  modelName: string;
}

export type DurabilityModeSetting = "on" | "off" | "default";

/** Resolved enablement for the category-forced review sweep (#105). */
export type SweepModeSetting = "on" | "off";

export interface RondaConfig {
  model: ModelConfig;
  passTimeoutMs: number;
  maxPatchChars: number;
  /** Maximum authoritative docs attached to one review pass (after relevance selection). */
  maxAuthoritativeDocCount: number;
  /** Maximum combined characters of authoritative doc excerpts in the user prompt. */
  maxAuthoritativeDocChars: number;
  /**
   * Operator force for durability/idempotency mode (#54).
   * `on` / `off` override automatic rules; `default` leaves activation to paths
   * and {@link durabilityModeDefault}.
   */
  durabilityMode: DurabilityModeSetting;
  /** When true, activate durability mode on every implementation review without automatic match. */
  durabilityModeDefault: boolean;
  /**
   * Operator enablement for the category-forced review sweep (#105). Resolved
   * from the first non-blank source; a non-empty value that is neither a
   * recognized on/off word nor `default` resolves to `off` and is carried in
   * {@link sweepModeRaw} rather than deferred to a lower-precedence source.
   */
  sweepMode: SweepModeSetting;
  /**
   * The unrecognized non-blank enablement value, when the resolved source was
   * not recognized. Carried for the degraded record's *fact* only — never
   * logged, published, or echoed into a review body.
   */
  sweepModeRaw: string | undefined;
  /**
   * Set only by the CLI entrypoint when the operator config file existed but
   * could not be read or parsed. Carries a message naming the file path —
   * never file contents. `runReviewPass` checks this before calling the
   * model and fails the pass with `unexpected_error`, which keeps
   * `src/cli/review-pr.ts` free of review-domain logic: it still needs to
   * read the pull request and publish a check run through the normal pass
   * machinery even when configuration failed to load.
   */
  loadError?: string;
}
