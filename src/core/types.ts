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
}

// --- Connector ---

export interface ConnectorLogger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
  child(scope: string): ConnectorLogger;
}

export interface ConnectorContext {
  device: DeviceSummary;
  datapoint: NormalizedDatapoint;
  streamKey: string;
  logger: ConnectorLogger;
}

export interface Connector {
  name: string;
  init?(logger: ConnectorLogger): Promise<void>;
  forward(context: ConnectorContext): Promise<void>;
  close?(): Promise<void>;
}

export type ConnectorFactory = (config?: unknown) => Connector | Promise<Connector>;

export interface PipelineState {
  streams: Record<
    string,
    {
      lastForwardedTimestamp?: number;
      lastRunAt?: string;
    }
  >;
}
