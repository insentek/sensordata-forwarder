import { resolve } from "node:path";

import { z } from "zod";
import type {
  FetchSpec,
  HttpOutputConfig,
  MqttOutputConfig,
  PipelineConfig,
} from "./types";

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

const httpOutputSchema = z.object({
  id: z.string().min(1),
  type: z.literal("http"),
  url: z.url(),
  method: z.enum(["POST", "PUT", "PATCH"]).default("POST"),
  headers: z.record(z.string(), z.string()).default({}),
  timeoutMs: z.number().int().positive().default(10_000),
});

const mqttOutputSchema = z.object({
  id: z.string().min(1),
  type: z.literal("mqtt"),
  brokerUrl: z.string().min(1),
  topic: z.string().min(1),
  clientId: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  qos: z.union([z.literal(0), z.literal(1), z.literal(2)]).default(0),
  retain: z.boolean().default(false),
});

const connectorSchema = z.object({
  scriptPath: z.string().min(1),
  exportName: z.string().default("default"),
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
    }),
  }),
  devices: z.object({
    pageSize: z.number().int().positive().default(100),
    includeAuthorized: z.array(z.enum(["own", "shared"])).default(["own", "shared"]),
    includeSerials: z.array(z.string()).default([]),
    excludeSerials: z.array(z.string()).default([]),
    concurrency: z.number().int().positive().default(4),
    fetch: fetchSpecSchema,
    overrides: z.record(z.string(), fetchSpecSchema).default({}),
  }),
  converter: z.object({
    scriptPath: z.string().min(1),
    exportName: z.string().default("default"),
  }).optional(),
  routing: z.object({
    defaultOutputIds: z.array(z.string()).min(1),
  }).optional(),
  outputs: z.array(z.union([httpOutputSchema, mqttOutputSchema])).optional(),
  connector: connectorSchema.optional(),
  state: z.object({
    path: z.string().min(1).default("./data/state.json"),
  }),
  logging: z.object({
    level: z.enum(["debug", "info", "warn", "error"]).default("info"),
  }),
}).refine(
  (config) => !!config.converter || !!config.connector,
  { message: "Config must specify either 'converter' or 'connector'." },
).refine(
  (config) => !(config.converter && config.connector),
  { message: "Config must not specify both 'converter' and 'connector'." },
).refine(
  (config) => {
    if (config.converter) {
      return !!config.routing && !!config.outputs && config.outputs.length > 0;
    }
    return true;
  },
  { message: "When using 'converter' mode, 'routing' and 'outputs' must also be provided." },
);

function resolvePath(inputPath: string): string {
  if (inputPath.startsWith("/") || inputPath.startsWith("file://")) {
    return inputPath;
  }

  return resolve(process.cwd(), inputPath);
}

function normalizeFetchSpec(fetchSpec: FetchSpec): FetchSpec {
  return {
    ...fetchSpec,
    includeParameters: fetchSpec.includeParameters ?? [],
    includeNodes: fetchSpec.includeNodes ?? [],
  };
}

export function parseConfig(rawConfig: unknown): PipelineConfig {
  const parsed = configSchema.parse(rawConfig);

  const outputs = parsed.outputs?.map((output) => {
    if (output.type === "http") {
      const httpOutput: HttpOutputConfig = {
        ...output,
      };
      return httpOutput;
    }

    const mqttOutput: MqttOutputConfig = {
      ...output,
    };
    return mqttOutput;
  });

  return {
    ...parsed,
    converter: parsed.converter
      ? {
          ...parsed.converter,
          scriptPath: resolvePath(parsed.converter.scriptPath),
        }
      : undefined,
    connector: parsed.connector
      ? {
          ...parsed.connector,
          scriptPath: resolvePath(parsed.connector.scriptPath),
        }
      : undefined,
    state: {
      path: resolvePath(parsed.state.path),
    },
    devices: {
      ...parsed.devices,
      fetch: normalizeFetchSpec(parsed.devices.fetch),
      overrides: Object.fromEntries(
        Object.entries(parsed.devices.overrides).map(([sn, spec]) => [
          sn,
          normalizeFetchSpec(spec),
        ]),
      ),
    },
    outputs,
  };
}

export async function loadConfig(configPath?: string): Promise<PipelineConfig> {
  const resolvedPath = resolvePath(configPath ?? "./config/config.json");
  const file = Bun.file(resolvedPath);

  if (!(await file.exists())) {
    throw new Error(
      `Config file not found: ${resolvedPath}. Create one from config/example.config.json.`,
    );
  }

  const rawText = await file.text();
  const rawConfig = JSON.parse(rawText) as unknown;
  return parseConfig(rawConfig);
}
