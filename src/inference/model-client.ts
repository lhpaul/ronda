/**
 * The vendor seam. Nothing outside `src/inference/` may reference a model
 * vendor by name — see the spec's "the model vendor is configuration" rule.
 */
export interface ModelRequest {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * One completion. `reportedModel` is the identifier the provider reported for
 * *this* response — `undefined` when the endpoint reported none, a non-string,
 * or an empty string. It travels per response rather than on the client
 * because a client-level "most recent value" would be raced by concurrent
 * calls sharing one client (the benchmark's precision `Promise.all`).
 *
 * It is a passthrough of what the operator's endpoint returned, so "the model
 * vendor is configuration" still holds. It is also **not** proof of
 * immutability: an endpoint may echo a mutable alias, which nothing in this
 * seam can distinguish from a pinned identifier, so a caller that needs an
 * AC8/AC9 same-version claim must record an operator attestation alongside it
 * and treat an absent or differing value as unattested.
 */
export interface ModelCompletion {
  content: string;
  reportedModel?: string;
}

export interface ModelClient {
  readonly modelName: string;
  complete(request: ModelRequest, signal: AbortSignal): Promise<ModelCompletion>;
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
