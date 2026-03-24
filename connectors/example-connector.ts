/**
 * Example Connector
 *
 * This is a minimal connector template. It logs each datapoint to the console
 * without forwarding to any external system.
 *
 * Usage:
 *   1. Copy this file: cp connectors/example-connector.ts connectors/my-connector.ts
 *   2. Implement init() / forward() / close()
 *   3. Run: bun start --connector my [--extra-config ./my.yml]
 *
 * The default export can be either:
 *   - A Connector object (if no config needed)
 *   - A factory function (rawConfig) => Connector (if --extra-config is used)
 */

import type { Connector, ConnectorContext, ConnectorLogger } from "../src/core/types.ts";

export default function createExampleConnector(_config?: unknown): Connector {
  return {
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
}
