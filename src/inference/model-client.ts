/**
 * The vendor seam. Nothing outside `src/inference/` may reference a model
 * vendor by name — see the spec's "the model vendor is configuration" rule.
 */
export interface ModelRequest {
  systemPrompt: string;
  userPrompt: string;
}

export interface ModelClient {
  readonly modelName: string;
  complete(request: ModelRequest, signal: AbortSignal): Promise<string>;
}

export type ModelClientFailureReason =
  | "credential_invalid"
  | "model_unavailable"
  | "timed_out";

/** Thrown by a `ModelClient` implementation; `runReviewPass` maps `reason` directly to a `FailureReason`. */
export class ModelClientError extends Error {
  readonly reason: ModelClientFailureReason;

  constructor(
    reason: ModelClientFailureReason,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ModelClientError";
    this.reason = reason;
  }
}
