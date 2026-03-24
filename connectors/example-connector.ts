/**
 * Example Connector
 *
 * This is a minimal connector template. It logs each datapoint to the console
 * without forwarding to any external system.
 *
 * Use this as a starting point for your own connector:
 *   1. Copy this file and rename it (e.g., my-connector.ts)
 *   2. Implement init() to set up connections (MQTT, HTTP, etc.)
 *   3. Implement forward() to transform and send each datapoint
 *   4. Implement close() to clean up connections
 *   5. Point your config.json to your connector:
 *      { "connector": { "scriptPath": "./connectors/my-connector.ts" } }
 */

import type { Connector, ConnectorContext, ConnectorLogger } from "../src/core/types.ts";

const connector: Connector = {
  name: "example",

  async init(logger: ConnectorLogger) {
    logger.info("Example connector initialized");
  },

  async forward({ device, datapoint, logger }: ConnectorContext) {
    logger.info(`[example] Device ${device.sn} | ${datapoint.datetime}`, {
      kind: datapoint.kind,
      flatValues: datapoint.flatValues,
    });
  },

  async close() {
    // Clean up connections here
  },
};

export default connector;
