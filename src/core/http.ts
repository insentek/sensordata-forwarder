import { setTimeout as sleep } from "node:timers/promises";

export interface RetryConfig {
  attempts: number;
  backoffMs: number;
}

export interface JsonRequestOptions {
  url: string;
  method?: "GET" | "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retry?: RetryConfig;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly bodyText: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export async function requestJson<T>(options: JsonRequestOptions): Promise<T> {
  const attempts = Math.max(1, options.retry?.attempts ?? 1);
  const timeoutMs = options.timeoutMs ?? 15_000;
  const backoffMs = options.retry?.backoffMs ?? 500;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(options.url, {
        method: options.method ?? "GET",
        headers: {
          "Content-Type": "application/json",
          ...(options.headers ?? {}),
        },
        body:
          options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
        signal: controller.signal,
      });

      const bodyText = await response.text();
      const parsed = bodyText.length > 0 ? JSON.parse(bodyText) : {};

      if (!response.ok) {
        throw new HttpError(
          `HTTP ${response.status} for ${options.url}`,
          response.status,
          bodyText,
        );
      }

      return parsed as T;
    } catch (error) {
      lastError = error;
      if (attempt >= attempts) {
        break;
      }
      await sleep(backoffMs * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}
