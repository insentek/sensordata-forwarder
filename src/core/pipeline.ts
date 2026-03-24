import type { Logger } from "../utils/logger.ts";
import { loadConnector } from "./connector-loader.ts";
import { loadConverter } from "./converter.ts";
import { EcoisClient } from "./ecois-client.ts";
import { buildOutputRouter } from "./output-router.ts";
import { StateStore } from "./state.ts";
import type {
  Connector,
  DeviceSummary,
  FetchSpec,
  NormalizedDatapoint,
  PipelineConfig,
} from "./types.ts";

interface ProcessDeviceContext {
  config: PipelineConfig;
  client: EcoisClient;
  stateStore: StateStore;
  logger: Logger;
}

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

// --- Converter mode (legacy) ---

async function processDeviceWithConverter(
  {
    config,
    client,
    stateStore,
    logger,
  }: ProcessDeviceContext,
  device: DeviceSummary,
  converter: Awaited<ReturnType<typeof loadConverter>>,
  router: Awaited<ReturnType<typeof buildOutputRouter>>,
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

    const messages = await converter({
      device,
      datapoint,
      streamKey,
      state: {
        lastForwardedTimestamp: streamState.lastForwardedTimestamp,
      },
    });

    if (messages.length === 0) {
      logger.debug("Converter returned no messages", {
        deviceSn: device.sn,
        timestamp: datapoint.timestamp,
      });
      continue;
    }

    await router.send(config.routing!.defaultOutputIds, messages);
    stateStore.updateStream(streamKey, {
      lastForwardedTimestamp: datapoint.timestamp,
    });
  }
}

async function runConverterPipeline(
  config: PipelineConfig,
  logger: Logger,
): Promise<void> {
  const stateStore = new StateStore(config.state.path);
  await stateStore.initialize();

  const client = new EcoisClient(config.api);
  const converter = await loadConverter(
    config.converter!.scriptPath,
    config.converter!.exportName,
    config.routing!.defaultOutputIds,
  );
  const router = await buildOutputRouter(config.outputs!, logger);

  try {
    const allDevices = await client.listDevices(config.devices.pageSize);
    const devices = filterDevices(allDevices, config);

    logger.info(`Discovered ${allDevices.length} devices, selected ${devices.length}`, {
      selected: devices.map((device) => device.sn),
    });

    await mapWithConcurrency(devices, config.devices.concurrency, async (device) => {
      await processDeviceWithConverter(
        { config, client, stateStore, logger },
        device,
        converter,
        router,
      );
    });

    await stateStore.save();
  } finally {
    await router.close();
  }
}

// --- Connector mode ---

async function processDeviceWithConnector(
  {
    config,
    client,
    stateStore,
    logger,
  }: ProcessDeviceContext,
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

async function runConnectorPipeline(
  config: PipelineConfig,
  logger: Logger,
): Promise<void> {
  const stateStore = new StateStore(config.state.path);
  await stateStore.initialize();

  const client = new EcoisClient(config.api);
  const connector = await loadConnector(
    config.connector!.scriptPath,
    config.connector!.exportName,
  );

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
      await processDeviceWithConnector(
        { config, client, stateStore, logger },
        device,
        connector,
      );
    });

    await stateStore.save();
  } finally {
    if (connector.close) {
      await connector.close();
    }
  }
}

// --- Entry point ---

export async function runPipeline(
  config: PipelineConfig,
  logger: Logger,
): Promise<void> {
  if (config.connector) {
    return runConnectorPipeline(config, logger);
  }
  return runConverterPipeline(config, logger);
}
