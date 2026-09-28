import {
  ModelClientError,
  type ModelClient,
  type ModelCompletion,
  type ModelRequest,
} from "./model-client.js";

export interface OpenAiCompatibleClientConfig {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * The sampling temperature this client sends, exported as a named constant so a
 * caller can *record* the effective non-prompt request parameter without
 * restating a vendor parameter literal outside `src/inference/`. The response
 * reports the model identity but not the temperature, so a run record can only
 * state it from here.
 */
export const CHAT_COMPLETION_TEMPERATURE = 0;

interface ChatCompletionResponse {
  /**
   * The Chat Completions response schema's own top-level `model` field — the
   * identifier that generated this completion. Declared here rather than
   * inferred: it is part of the documented response object, and this local
   * interface dropped it, which was the gap.
   */
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Builds a `ModelClient` that posts to any OpenAI-compatible
 * `/chat/completions` endpoint — Qwen/DashScope by default configuration,
 * or the local mock server used in tests and the smoke runbook.
 */
export function createOpenAiCompatibleClient(
  config: OpenAiCompatibleClientConfig,
): ModelClient {
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    modelName: config.modelName,
    async complete(request: ModelRequest, signal: AbortSignal): Promise<ModelCompletion> {
      let response: Response;
      try {
        response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: config.modelName,
            temperature: CHAT_COMPLETION_TEMPERATURE,
            messages: [
              { role: "system", content: request.systemPrompt },
              { role: "user", content: request.userPrompt },
            ],
          }),
          signal,
        });
      } catch (error) {
        if (signal.aborted) {
          throw new ModelClientError(
            "timed_out",
            "Model request was aborted before it completed",
            { cause: error },
          );
        }
        throw new ModelClientError(
          "model_unavailable",
          "Model request failed before receiving a response",
          { cause: error },
        );
      }

      if (response.status === 401 || response.status === 403) {
        throw new ModelClientError(
          "credential_invalid",
          `Model API rejected the credential (HTTP ${response.status})`,
        );
      }
      if (!response.ok) {
        throw new ModelClientError(
          "model_unavailable",
          `Model API returned HTTP ${response.status}`,
        );
      }

      const payload = (await response.json()) as ChatCompletionResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new ModelClientError(
          "model_unavailable",
          "Model API response did not include message content",
        );
      }
      // Fail closed: a non-conforming endpoint (absent, non-string, or empty
      // `model`) yields `undefined` and admits no same-version claim — never a
      // silent backfill from the configured alias.
      const reportedModel =
        typeof payload.model === "string" && payload.model !== "" ? payload.model : undefined;

      return reportedModel === undefined ? { content } : { content, reportedModel };
    },
  };
}
