import { createServer, type Server } from "node:http";

export interface MockModelServerOptions {
  modelName?: string;
  responseContent?: string;
  /** Delays the response by this many milliseconds — used to exercise the timeout and supersede cases. */
  delayMs?: number;
  /** HTTP status code to respond with. Defaults to 200. Used to exercise credential and availability failures. */
  statusCode?: number;
  /** When true, respond with a 200 body that has no `choices[0].message.content`. */
  omitContent?: boolean;
}

export interface MockModelServer {
  url: string;
  close(): Promise<void>;
}

/**
 * A local OpenAI-compatible `/chat/completions` HTTP stub, used by the
 * integration test and by smoke test step 8 (alternate model vendor).
 */
export async function startMockModelServer(
  options: MockModelServerOptions = {},
): Promise<MockModelServer> {
  const modelName = options.modelName ?? "mock-model";
  const responseContent = options.responseContent ?? '{"findings":[]}';
  const delayMs = options.delayMs ?? 0;
  const statusCode = options.statusCode ?? 200;
  const omitContent = options.omitContent ?? false;

  const server: Server = createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    req.on("data", () => undefined);
    req.on("end", () => {
      const send = () => {
        res.writeHead(statusCode, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            omitContent
              ? { model: modelName, choices: [{ message: { role: "assistant" } }] }
              : {
                  model: modelName,
                  choices: [{ message: { role: "assistant", content: responseContent } }],
                },
          ),
        );
      };
      if (delayMs > 0) {
        setTimeout(send, delayMs);
      } else {
        send();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
