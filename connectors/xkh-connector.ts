/**
 * XKH Connector (星科汇)
 *
 * Forwards ecois sensor data to the XKH platform via MQTT.
 *
 * Protocol:
 *   - Broker: mqtt://58.58.10.210:1883
 *   - Topic:  /hzd/pub/{device_type}/{device_sn}
 *   - ClientID: hzd_SoilMoistureWithSalinity_{device_sn}
 *   - Payload: { type, data: [{ eleValue, relayNum, createTime }], version }
 *
 * eleValue format: 31 slash-separated values
 *   pos 1:    voltage (V)
 *   pos 2-4:  soil moisture 1, temp 1, salinity 1
 *   pos 5-7:  soil moisture 2, temp 2, salinity 2
 *   ...
 *   pos 29-31: soil moisture 10, temp 10, salinity 10
 */

import type {
  Connector,
  ConnectorContext,
  ConnectorLogger,
  NormalizedDatapoint,
} from "../src/core/types.ts";
import {
  MqttConnectionPool,
  type MqttPoolOptions,
} from "../src/utils/mqtt-helper.ts";

// --- MQTT Configuration ---
const MQTT_OPTIONS: MqttPoolOptions = {
  brokerUrl: "mqtt://58.58.10.210:1883",
  username: "xphd",
  password: "test54678ppcce",
};

// 32 zeros for relay status
const RELAY_NUM = new Array(32).fill("0").join("/");

const MISSING = "32767";

// --- Data mapping ---

/**
 * Build the 31-position eleValue string from a NormalizedDatapoint.
 *
 * ecois nodeValues structure: { "nodeName": { "paramName": value, ... }, ... }
 * The node names and param names vary by device model. We do case-insensitive
 * matching with common parameter name patterns.
 */
function buildEleValue(datapoint: NormalizedDatapoint): string {
  const positions: string[] = new Array(31).fill(MISSING);

  // Position 0: voltage — search across all nodes and flatValues
  positions[0] = findVoltage(datapoint) ?? MISSING;

  // Positions 1-30: 10 groups of (moisture, temp, salinity)
  const nodeEntries = Object.entries(datapoint.nodeValues);

  for (let i = 0; i < 10; i++) {
    const node = resolveNode(nodeEntries, i);
    if (!node) continue;

    const moisture = extractParam(node, "moisture", "humidity", "sm", "vwc");
    const temp = extractParam(node, "temperature", "temp", "st");
    const salinity = extractParam(node, "salinity", "ec", "conductivity", "salt");

    positions[1 + i * 3] = moisture ?? MISSING;
    positions[2 + i * 3] = temp ?? MISSING;
    positions[3 + i * 3] = salinity ?? MISSING;
  }

  return positions.join("/");
}

/**
 * Resolve the i-th soil node (0-indexed) from nodeValues entries.
 *
 * Ecois devices may use various naming: "1", "node1", "CH1", etc.
 * We try numbered matching first, then fall back to sorted order
 * (skipping voltage-only nodes).
 */
function resolveNode(
  entries: [string, Record<string, unknown>][],
  index: number,
): Record<string, unknown> | undefined {
  const nodeNumber = index + 1;

  // Try exact named patterns
  const candidates = [
    String(nodeNumber),
    `node${nodeNumber}`,
    `Node${nodeNumber}`,
    `ch${nodeNumber}`,
    `CH${nodeNumber}`,
  ];

  for (const key of candidates) {
    const entry = entries.find(([k]) => k === key);
    if (entry) return entry[1];
  }

  // Fallback: use sorted order (skip node "0" which is often battery/voltage)
  const sorted = entries
    .filter(([k]) => !isVoltageOnlyNode(k, entries))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  return sorted[index]?.[1];
}

function isVoltageOnlyNode(
  _key: string,
  _entries: [string, Record<string, unknown>][],
): boolean {
  // Don't filter here — let the per-position extraction handle missing params
  return false;
}

/**
 * Extract a numeric parameter from a node by trying multiple candidate names
 * (case-insensitive).
 */
function extractParam(
  node: Record<string, unknown>,
  ...candidateKeys: string[]
): string | undefined {
  for (const key of candidateKeys) {
    const lower = key.toLowerCase();
    const matchedKey = Object.keys(node).find(
      (k) => k.toLowerCase() === lower || k.toLowerCase().includes(lower),
    );
    if (matchedKey !== undefined) {
      const value = node[matchedKey];
      if (value !== undefined && value !== null) {
        return String(value);
      }
    }
  }
  return undefined;
}

/**
 * Find voltage value across all nodes and flatValues.
 */
function findVoltage(datapoint: NormalizedDatapoint): string | undefined {
  // Search flatValues first
  for (const [key, value] of Object.entries(datapoint.flatValues)) {
    if (/voltage|battery|vbat|vol/i.test(key)) {
      if (value !== undefined && value !== null) return String(value);
    }
  }

  // Search all nodes
  for (const node of Object.values(datapoint.nodeValues)) {
    const v = extractParam(node, "voltage", "battery", "vbat", "vol");
    if (v !== undefined) return v;
  }

  return undefined;
}

/**
 * Format timestamp to "YYYY-MM-DD HH:mm:ss".
 */
function formatCreateTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// --- Connector ---

let pool: MqttConnectionPool;

const connector: Connector = {
  name: "xkh",

  async init(logger: ConnectorLogger) {
    pool = new MqttConnectionPool(MQTT_OPTIONS, logger);
    logger.info("XKH connector initialized", {
      broker: MQTT_OPTIONS.brokerUrl,
    });
  },

  async forward({ device, datapoint, logger }: ConnectorContext) {
    const deviceType = device.type ?? "unknown";
    const clientId = `hzd_SoilMoistureWithSalinity_${device.sn}`;
    const topic = `/hzd/pub/${deviceType}/${device.sn}`;

    const eleValue = buildEleValue(datapoint);
    const payload = JSON.stringify({
      type: "data",
      data: [
        {
          eleValue,
          relayNum: RELAY_NUM,
          createTime: formatCreateTime(datapoint.timestamp),
        },
      ],
      version: "w-1.0",
    });

    const client = await pool.getClient(clientId);
    await client.publishAsync(topic, payload, { qos: 0 });

    logger.info(`Published to ${topic}`, { clientId, eleValue });
  },

  async close() {
    if (pool) {
      await pool.closeAll();
    }
  },
};

export default connector;
