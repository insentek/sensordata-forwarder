import type { Logger } from "../utils/logger.ts";
import { EcoisClient } from "./ecois-client.ts";
import { StateStore } from "./state.ts";
import type {
  Connector,
  DeviceSummary,
  FetchSpec,
  NormalizedDatapoint,
  PipelineConfig,
} from "./types.ts";

const STATE_PATH = "./data/state.json";

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const queue = [...items];
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) {
        return;
      }
      await worker(item);
    }
  });

  await Promise.all(workers);
}

function resolveFetchSpec(device: DeviceSummary, config: PipelineConfig): FetchSpec {
  return config.devices.overrides[device.sn] ?? config.devices.fetch;
}

function buildStreamKey(device: DeviceSummary, datapoint: NormalizedDatapoint): string {
  return `${device.sn}:${datapoint.kind}`;
}

function filterDevices(devices: DeviceSummary[], config: PipelineConfig): DeviceSummary[] {
  const includeSet = new Set(config.devices.includeSerials);
  const excludeSet = new Set(config.devices.excludeSerials);

  return devices.filter((device) => {
    if (!config.devices.includeAuthorized.includes(device.authorized ?? "own")) {
      return false;
    }

    if (excludeSet.has(device.sn)) {
      return false;
    }

    if (includeSet.size > 0) {
      return includeSet.has(device.sn);
    }

    return true;
  });
}

async function processDevice(
  config: PipelineConfig,
  client: EcoisClient,
  stateStore: StateStore,
  logger: Logger,
  device: DeviceSummary,
  connector: Connector,
): Promise<void> {
  const fetchSpec = resolveFetchSpec(device, config);
  const datapoints = await client.fetchDeviceData(device.sn, fetchSpec);

  logger.info(`Device ${device.sn}: fetched ${datapoints.length} datapoints`, {
    fetchMode: fetchSpec.mode,
  });

  for (const datapoint of datapoints) {
    const streamKey = buildStreamKey(device, datapoint);
    const streamState = stateStore.getStream(streamKey);

    if (
      typeof streamState.lastForwardedTimestamp === "number" &&
      datapoint.timestamp <= streamState.lastForwardedTimestamp
    ) {
      logger.debug("Skip already forwarded datapoint", {
        deviceSn: device.sn,
        timestamp: datapoint.timestamp,
        streamKey,
      });
      continue;
    }

    await connector.forward({
      device,
      datapoint,
      streamKey,
      logger: logger.child(`device:${device.sn}`),
    });

    stateStore.updateStream(streamKey, {
      lastForwardedTimestamp: datapoint.timestamp,
    });
  }
}

export async function runPipeline(
  config: PipelineConfig,
  connector: Connector,
  logger: Logger,
): Promise<void> {
  const stateStore = new StateStore(STATE_PATH);
  await stateStore.initialize();

  const client = new EcoisClient(config.api);

  const connectorLogger = logger.child(`connector:${connector.name}`);
  connectorLogger.info(`Loaded connector: ${connector.name}`);

  if (connector.init) {
    await connector.init(connectorLogger);
  }

  try {
    const allDevices = await client.listDevices(config.devices.pageSize);
    const devices = filterDevices(allDevices, config);

    logger.info(`Discovered ${allDevices.length} devices, selected ${devices.length}`, {
      selected: devices.map((device) => device.sn),
    });

    await mapWithConcurrency(devices, config.devices.concurrency, async (device) => {
      await processDevice(config, client, stateStore, logger, device, connector);
    });

    await stateStore.save();
  } finally {
    if (connector.close) {
      await connector.close();
    }
  }
}
