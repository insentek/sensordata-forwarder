export type AuthorizedType = "own" | "shared";

export interface DeviceLocation {
  lng?: number;
  lat?: number;
  country?: string;
  province?: string;
  city?: string;
  district?: string;
}

export interface DeviceSummary {
  sn: string;
  alias?: string;
  type?: string;
  series?: string;
  authorized?: AuthorizedType;
  location?: DeviceLocation;
  status?: {
    code?: string;
    description?: string;
  };
  widget?: {
    externalAccessUrl?: string;
  };
}

export interface StandardDatapoint {
  timestamp: number;
  datetime?: string;
  values: Record<string, Record<string, unknown>>;
  lng?: number;
  lat?: number;
}

export interface PluviometerDatapoint {
  timestamp: number;
  datetime?: string;
  sensors: Record<string, unknown>;
}

export interface NormalizedDatapoint {
  timestamp: number;
  datetime?: string;
  kind: "standard" | "pluviometer";
  nodeValues: Record<string, Record<string, unknown>>;
  sensors: Record<string, unknown>;
  flatValues: Record<string, unknown>;
  lng?: number;
  lat?: number;
  raw: unknown;
}

export interface FetchSpec {
  mode:
    | "incremental"
    | "latest"
    | "range"
    | "pluviometerLatest"
    | "pluviometerHistory";
  range?: string;
  includeParameters?: string[];
  includeNodes?: string[];
}

export interface ConverterContext {
  device: DeviceSummary;
  datapoint: NormalizedDatapoint;
  streamKey: string;
  state: {
    lastForwardedTimestamp?: number;
  };
}

export interface OutboundMessage {
  payload: unknown;
  outputIds?: string[];
  topic?: string;
  path?: string;
  headers?: Record<string, string>;
  qos?: 0 | 1 | 2;
  retain?: boolean;
}

export type ConverterResult =
  | null
  | undefined
  | OutboundMessage
  | OutboundMessage[]
  | Record<string, unknown>
  | string
  | number
  | boolean;

export type ConverterFn = (
  context: ConverterContext,
) => ConverterResult | Promise<ConverterResult>;

export interface ConverterModule {
  default?: ConverterFn;
  [key: string]: unknown;
}

export interface HttpOutputConfig {
  id: string;
  type: "http";
  url: string;
  method?: "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface MqttOutputConfig {
  id: string;
  type: "mqtt";
  brokerUrl: string;
  topic: string;
  clientId?: string;
  username?: string;
  password?: string;
  qos?: 0 | 1 | 2;
  retain?: boolean;
}

export type OutputConfig = HttpOutputConfig | MqttOutputConfig;

export interface PipelineConfig {
  api: {
    baseUrl: string;
    appid: string;
    secret: string;
    timeoutMs: number;
    retry: {
      attempts: number;
      backoffMs: number;
    };
  };
  devices: {
    pageSize: number;
    includeAuthorized: AuthorizedType[];
    includeSerials: string[];
    excludeSerials: string[];
    concurrency: number;
    fetch: FetchSpec;
    overrides: Record<string, FetchSpec>;
  };
  converter: {
    scriptPath: string;
    exportName: string;
  };
  routing: {
    defaultOutputIds: string[];
  };
  outputs: OutputConfig[];
  state: {
    path: string;
  };
  logging: {
    level: "debug" | "info" | "warn" | "error";
  };
}

export interface PipelineState {
  streams: Record<
    string,
    {
      lastForwardedTimestamp?: number;
      lastRunAt?: string;
    }
  >;
}
