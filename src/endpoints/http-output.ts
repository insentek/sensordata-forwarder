import { requestJson } from "../core/http.ts";
import type { HttpOutputConfig, OutboundMessage } from "../core/types.ts";
import type { Logger } from "../utils/logger.ts";

export async function sendHttpMessage(
  output: HttpOutputConfig,
  message: OutboundMessage,
  logger: Logger,
): Promise<void> {
  const url = message.path ? new URL(message.path, output.url).toString() : output.url;
  await requestJson<unknown>({
    url,
    method: output.method ?? "POST",
    headers: {
      ...(output.headers ?? {}),
      ...(message.headers ?? {}),
    },
    body: message.payload,
    timeoutMs: output.timeoutMs ?? 10_000,
    retry: {
      attempts: 3,
      backoffMs: 1_000,
    },
  });

  logger.debug("HTTP message delivered", {
    outputId: output.id,
    url,
  });
}
