import { resolve } from "node:path";

import { z } from "zod";
import type { FetchSpec, PipelineConfig } from "./types";

const fetchSpecSchema = z.object({
  mode: z.enum([
    "incremental",
    "latest",
    "range",
    "pluviometerLatest",
    "pluviometerHistory",
  ]),
  range: z.string().optional(),
  includeParameters: z.array(z.string()).default([]),
  includeNodes: z.array(z.string()).default([]),
});

const configSchema = z.object({
  api: z.object({
    baseUrl: z.url().default("http://openapi.ecois.info"),
    appid: z.string().min(1),
    secret: z.string().min(1),
    timeoutMs: z.number().int().positive().default(15_000),
    retry: z.object({
      attempts: z.number().int().min(1).default(3),
      backoffMs: z.number().int().min(0).default(500),
    }).optional(),
  }),
  devices: z.object({
    pageSize: z.number().int().positive().default(100),
    includeAuthorized: z.array(z.enum(["own", "shared"])).default(["own", "shared"]),
    includeSerials: z.array(z.string()).default([]),
    excludeSerials: z.array(z.string()).default([]),
    concurrency: z.number().int().positive().default(4),
    fetch: fetchSpecSchema.optional(),
    overrides: z.record(z.string(), fetchSpecSchema).default({}),
  }).optional(),
});

function resolvePath(inputPath: string): string {
  if (inputPath.startsWith("/") || inputPath.startsWith("file://")) {
    return inputPath;
  }

  return resolve(process.cwd(), inputPath);
}

const DEFAULT_FETCH_SPEC: FetchSpec = {
  mode: "latest",
  includeParameters: [],
  includeNodes: [],
};

const DEFAULT_RETRY = { attempts: 3, backoffMs: 500 };

export function parseConfig(rawConfig: unknown): PipelineConfig {
  const parsed = configSchema.parse(rawConfig);

  const devices = parsed.devices;
  const fetch = devices?.fetch ?? DEFAULT_FETCH_SPEC;
  const overrides = devices?.overrides ?? {};

  return {
    api: {
      ...parsed.api,
      retry: parsed.api.retry ?? DEFAULT_RETRY,
    },
    devices: {
      pageSize: devices?.pageSize ?? 100,
      includeAuthorized: devices?.includeAuthorized ?? ["own", "shared"],
      includeSerials: devices?.includeSerials ?? [],
      excludeSerials: devices?.excludeSerials ?? [],
      concurrency: devices?.concurrency ?? 4,
      fetch: {
        ...fetch,
        includeParameters: fetch.includeParameters ?? [],
        includeNodes: fetch.includeNodes ?? [],
      },
      overrides: Object.fromEntries(
        Object.entries(overrides).map(([sn, spec]) => [
          sn,
          {
            ...spec,
            includeParameters: spec.includeParameters ?? [],
            includeNodes: spec.includeNodes ?? [],
          },
        ]),
      ),
    },
  };
}

export async function loadConfig(configPath?: string): Promise<PipelineConfig> {
  const resolvedPath = resolvePath(configPath ?? "./config/config.json");
  const file = Bun.file(resolvedPath);

  if (!(await file.exists())) {
    throw new Error(
      `Config file not found: ${resolvedPath}. Create one from config/config.json.example.`,
    );
  }

  const rawText = await file.text();
  const rawConfig = JSON.parse(rawText) as unknown;
  return parseConfig(rawConfig);
}
