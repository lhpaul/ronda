export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  modelName: string;
}

export type DurabilityModeSetting = "on" | "off" | "default";

/** Resolved enablement for the category-forced review sweep (#105). */
export type SweepModeSetting = "on" | "off";

/** Resolved enablement for read-only repository context (#106). */
export type RepositoryContextModeSetting = "on" | "off";

/** The three budgets that can fall back to their recorded default (#106, AC21). */
export type RepositoryContextBudgetName = "candidates" | "chars" | "time";

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
   * Operator enablement for read-only repository context (#106). Resolved
   * from the first non-blank source with the same vocabulary and
   * first-non-blank-source discipline as {@link sweepMode}; a non-empty value
   * that is neither a recognized on/off word nor `default` resolves to `off`
   * and is carried in {@link repositoryContextModeRaw} rather than deferred to
   * a lower-precedence source (AC21).
   */
  repositoryContextMode: RepositoryContextModeSetting;
  /**
   * The unrecognized non-blank enablement value, when the resolved source was
   * not recognized. Carried for the degraded record's *fact* only — never
   * logged, published, or echoed into a review body (AC21).
   */
  repositoryContextModeRaw: string | undefined;
  /** Maximum candidates (excerpts) a pass may resolve for repository context (D3, AC6). */
  maxRepositoryContextCandidates: number;
  /** Maximum combined characters of repository-context excerpts (D3, AC6, AC7). */
  maxRepositoryContextChars: number;
  /** Time budget, in milliseconds, for the repository-context phase inside the pass budget (D3, AC8). */
  repositoryContextTimeBudgetMs: number;
  /**
   * Which of the three repository-context budgets fell back to their recorded
   * default because the resolved value was absent or not a positive number
   * (AC21). Empty when every configured budget resolved directly.
   */
  repositoryContextBudgetFallbacks: RepositoryContextBudgetName[];
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
