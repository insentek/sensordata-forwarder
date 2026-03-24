import type {
  DeviceSummary,
  NormalizedDatapoint,
  PluviometerDatapoint,
  StandardDatapoint,
} from "./types";

interface IncrementalResponse {
  increments?: StandardDatapoint[];
}

interface StandardListResponse {
  list?: StandardDatapoint[];
}

interface PluviometerSeriesResponse {
  datapoints?: {
    timeline?: number[];
    sensors?: Array<{
      name?: string;
      values?: unknown[];
    }>;
  };
}

export function normalizeStandardDatapoint(
  datapoint: StandardDatapoint,
): NormalizedDatapoint {
  const flatValues = flattenNodeValues(datapoint.values);

  return {
    timestamp: datapoint.timestamp,
    datetime: datapoint.datetime,
    kind: "standard",
    nodeValues: datapoint.values,
    sensors: {},
    flatValues,
    lng: datapoint.lng,
    lat: datapoint.lat,
    raw: datapoint,
  };
}

export function normalizePluviometerDatapoint(
  datapoint: PluviometerDatapoint,
): NormalizedDatapoint {
  return {
    timestamp: datapoint.timestamp,
    datetime: datapoint.datetime,
    kind: "pluviometer",
    nodeValues: {},
    sensors: datapoint.sensors,
    flatValues: { ...datapoint.sensors },
    raw: datapoint,
  };
}

export function extractNormalizedDatapoints(
  _device: DeviceSummary,
  mode: string,
  response: unknown,
): NormalizedDatapoint[] {
  if (mode === "incremental") {
    const payload = response as IncrementalResponse;
    return (payload.increments ?? [])
      .map(normalizeStandardDatapoint)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  if (mode === "latest") {
    return [normalizeStandardDatapoint(response as StandardDatapoint)];
  }

  if (mode === "range") {
    const payload = response as StandardListResponse;
    return (payload.list ?? [])
      .map(normalizeStandardDatapoint)
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  if (mode === "pluviometerLatest") {
    const series = response as PluviometerSeriesResponse;
    return pluviometerSeriesToDatapoints(series).map(normalizePluviometerDatapoint);
  }

  if (mode === "pluviometerHistory") {
    const series = response as PluviometerSeriesResponse;
    return pluviometerSeriesToDatapoints(series).map(normalizePluviometerDatapoint);
  }

  return [];
}

function flattenNodeValues(
  values: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};

  for (const [nodeName, nodeValues] of Object.entries(values)) {
    for (const [parameterName, value] of Object.entries(nodeValues)) {
      flattened[`${nodeName}.${parameterName}`] = value;
    }
  }

  return flattened;
}

function pluviometerSeriesToDatapoints(
  response: PluviometerSeriesResponse,
): PluviometerDatapoint[] {
  const timeline = response.datapoints?.timeline ?? [];
  const sensors = response.datapoints?.sensors ?? [];

  return timeline.map((timestamp, index) => {
    const pointSensors: Record<string, unknown> = {};
    for (const sensor of sensors) {
      if (!sensor.name) {
        continue;
      }

      pointSensors[sensor.name] = sensor.values?.[index];
    }

    return {
      timestamp,
      datetime: undefined,
      sensors: pointSensors,
    };
  });
}
