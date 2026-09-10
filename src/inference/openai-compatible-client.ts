import { ModelClientError, type ModelClient, type ModelRequest } from "./model-client.js";

export interface OpenAiCompatibleClientConfig {
  apiKey: string;
  baseUrl: string;
  modelName: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
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
    async complete(request: ModelRequest, signal: AbortSignal): Promise<string> {
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
            temperature: 0,
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
      return content;
    },
  };
}
