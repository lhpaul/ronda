export interface ModelConfig {
  apiKey: string;
  baseUrl: string;
  modelName: string;
}

export interface RondaConfig {
  model: ModelConfig;
  passTimeoutMs: number;
  maxPatchChars: number;
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
