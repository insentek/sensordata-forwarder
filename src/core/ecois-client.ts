import { requestJson } from "./http.ts";
import type {
  DeviceSummary,
  FetchSpec,
  NormalizedDatapoint,
  StandardDatapoint,
} from "./types.ts";

interface ApiContext {
  baseUrl: string;
  appid: string;
  secret: string;
  timeoutMs: number;
  retry: {
    attempts: number;
    backoffMs: number;
  };
}

interface TokenResponse {
  message: string;
  token: string;
  expires: number;
}

interface DevicesResponse {
  message: string;
  count: number;
  list: DeviceSummary[];
}

interface StandardDataResponse {
  message: string;
  total?: number;
  list?: StandardDatapoint[];
}

interface IncrementalDataResponse {
  message: string;
  lastSync?: string;
  increments?: StandardDatapoint[];
}

interface LatestDataResponse {
  message: string;
  timestamp: number;
  datetime?: string;
  lng?: number;
  lat?: number;
  values: Record<string, Record<string, unknown>>;
}

interface PluviometerHistoryResponse {
  message: string;
  total?: number;
  datapoints?: {
    timeline?: number[];
    sensors?: Array<{
      name: string;
      values: unknown[];
    }>;
  };
}

interface PluviometerLatestResponse {
  message: string;
  latestCollectTimestamp: number;
  datapoints?: {
    timeline?: number[];
    sensors?: Array<{
      name: string;
      values: unknown[];
    }>;
  };
}

export class EcoisClient {
  private tokenCache:
    | {
        token: string;
        expiresAt: number;
      }
    | undefined;

  public constructor(private readonly ctx: ApiContext) {}

  public async listDevices(pageSize: number): Promise<DeviceSummary[]> {
    const token = await this.getToken();
    const results: DeviceSummary[] = [];
    let page = 1;
    let total = Number.POSITIVE_INFINITY;

    while (results.length < total) {
      const response = await requestJson<DevicesResponse>({
        url: new URL(
          `/v3/devices?page=${page}&limit=${pageSize}`,
          this.ctx.baseUrl,
        ).toString(),
        method: "GET",
        timeoutMs: this.ctx.timeoutMs,
        retry: this.ctx.retry,
        headers: {
          Authorization: token,
        },
      });

      if (response.message !== "ok") {
        throw new Error(`List devices failed: ${response.message}`);
      }

      total = response.count ?? results.length;
      results.push(...(response.list ?? []));
      if ((response.list?.length ?? 0) < pageSize) {
        break;
      }
      page += 1;
    }

    return results;
  }

  public async fetchDeviceData(
    sn: string,
    fetchSpec: FetchSpec,
  ): Promise<NormalizedDatapoint[]> {
    const token = await this.getToken();

    switch (fetchSpec.mode) {
      case "incremental": {
        const response = await requestJson<IncrementalDataResponse>({
          url: new URL(`/v3/device/${sn}/data/incremental`, this.ctx.baseUrl).toString(),
          method: "GET",
          timeoutMs: this.ctx.timeoutMs,
          retry: this.ctx.retry,
          headers: {
            Authorization: token,
          },
        });

        if (response.message !== "ok") {
          throw new Error(`Fetch incremental data failed for ${sn}: ${response.message}`);
        }

        return (response.increments ?? []).map((item) =>
          normalizeStandardDatapoint(item),
        );
      }

      case "latest": {
        const response = await requestJson<LatestDataResponse>({
          url: new URL(`/v3/device/${sn}/latest`, this.ctx.baseUrl).toString(),
          method: "GET",
          timeoutMs: this.ctx.timeoutMs,
          retry: this.ctx.retry,
          headers: {
            Authorization: token,
          },
        });

        if (response.message !== "ok") {
          throw new Error(`Fetch latest data failed for ${sn}: ${response.message}`);
        }

        return [
          normalizeStandardDatapoint({
            timestamp: response.timestamp,
            datetime: response.datetime,
            lng: response.lng,
            lat: response.lat,
            values: response.values,
          }),
        ];
      }

      case "range": {
        const params = new URLSearchParams();
        if (fetchSpec.range) {
          params.set("range", fetchSpec.range);
        }
        if (fetchSpec.includeParameters?.length) {
          params.set("includeParameters", fetchSpec.includeParameters.join(","));
        }
        if (fetchSpec.includeNodes?.length) {
          params.set("includeNodes", fetchSpec.includeNodes.join(","));
        }

        const response = await requestJson<StandardDataResponse>({
          url: new URL(
            `/v3/device/${sn}/data${params.size ? `?${params.toString()}` : ""}`,
            this.ctx.baseUrl,
          ).toString(),
          method: "GET",
          timeoutMs: this.ctx.timeoutMs,
          retry: this.ctx.retry,
          headers: {
            Authorization: token,
          },
        });

        if (response.message !== "ok") {
          throw new Error(`Fetch ranged data failed for ${sn}: ${response.message}`);
        }

        return (response.list ?? []).map((item) => normalizeStandardDatapoint(item));
      }

      case "pluviometerLatest": {
        const response = await requestJson<PluviometerLatestResponse>({
          url: new URL(
            `/v3/device/pluviometer/${sn}/data/latest`,
            this.ctx.baseUrl,
          ).toString(),
          method: "GET",
          timeoutMs: this.ctx.timeoutMs,
          retry: this.ctx.retry,
          headers: {
            Authorization: token,
          },
        });

        if (response.message !== "ok") {
          throw new Error(`Fetch pluviometer latest failed for ${sn}: ${response.message}`);
        }

        return normalizePluviometerSeries(
          response.datapoints?.timeline ?? [response.latestCollectTimestamp],
          response.datapoints?.sensors ?? [],
        );
      }

      case "pluviometerHistory": {
        const params = new URLSearchParams();
        if (fetchSpec.range) {
          params.set("range", fetchSpec.range);
        }

        const response = await requestJson<PluviometerHistoryResponse>({
          url: new URL(
            `/v3/device/pluviometer/${sn}/data/history${params.size ? `?${params.toString()}` : ""}`,
            this.ctx.baseUrl,
          ).toString(),
          method: "GET",
          timeoutMs: this.ctx.timeoutMs,
          retry: this.ctx.retry,
          headers: {
            Authorization: token,
          },
        });

        if (response.message !== "ok") {
          throw new Error(`Fetch pluviometer history failed for ${sn}: ${response.message}`);
        }

        return normalizePluviometerSeries(
          response.datapoints?.timeline ?? [],
          response.datapoints?.sensors ?? [],
        );
      }
    }
  }

  private async getToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenCache && this.tokenCache.expiresAt > now + 60_000) {
      return this.tokenCache.token;
    }

    const url = new URL("/v3/token", this.ctx.baseUrl);
    url.searchParams.set("appid", this.ctx.appid);
    url.searchParams.set("secret", this.ctx.secret);

    const response = await requestJson<TokenResponse>({
      url: url.toString(),
      method: "GET",
      timeoutMs: this.ctx.timeoutMs,
      retry: this.ctx.retry,
    });

    if (response.message !== "ok" || !response.token) {
      throw new Error(`Token fetch failed: ${response.message}`);
    }

    this.tokenCache = {
      token: response.token,
      expiresAt: now + response.expires * 1000,
    };

    return response.token;
  }
}

function normalizeStandardDatapoint(item: StandardDatapoint): NormalizedDatapoint {
  return {
    timestamp: item.timestamp,
    datetime: item.datetime,
    kind: "standard",
    nodeValues: item.values,
    sensors: {},
    flatValues: flattenNodeValues(item.values),
    lng: item.lng,
    lat: item.lat,
    raw: item,
  };
}

function normalizePluviometerSeries(
  timeline: number[],
  sensorSeries: Array<{ name: string; values: unknown[] }>,
): NormalizedDatapoint[] {
  return timeline.map((timestamp, index) => {
    const sensors = Object.fromEntries(
      sensorSeries.map((sensor) => [sensor.name, sensor.values[index]]),
    );

    return {
      timestamp,
      datetime: undefined,
      kind: "pluviometer",
      nodeValues: {},
      sensors,
      flatValues: sensors,
      raw: {
        timestamp,
        sensors,
      },
    };
  });
}

function flattenNodeValues(
  values: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const entries: Array<[string, unknown]> = [];
  for (const [nodeName, nodeValues] of Object.entries(values)) {
    for (const [parameterName, value] of Object.entries(nodeValues)) {
      entries.push([`${nodeName}.${parameterName}`, value]);
    }
  }
  return Object.fromEntries(entries);
}
