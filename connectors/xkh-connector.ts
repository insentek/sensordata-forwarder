/**
 * XKH Connector
 *
 * Forwards ecois sensor data to the XKH platform via MQTT.
 *
 * Protocol:
 *   - Topic:  /hzd/pub/{device_type}/{station_id}
 *   - ClientID: hzd_SoilMoistureWithSalinity_{station_id}
 *   - Payload: { type, data: [{ eleValue, relayNum, createTime }], version }
 *
 * eleValue format: 31 slash-separated values
 *   pos 1:    voltage (V)
 *   pos 2-4:  soil moisture 1, temp 1, salinity 1
 *   ...
 *   pos 29-31: soil moisture 10, temp 10, salinity 10
 *
 * Requires extra config (YAML):
 *   mqtt:
 *     broker: mqtt://host:port
 *     username: xxx
 *     password: xxx
 *   stations:
 *     - sn: "11768401389126"
 *       id: "3716030001"
 */

import type {
  Connector,
  ConnectorContext,
  ConnectorLogger,
  NormalizedDatapoint,
} from "../src/core/types.ts";
import {
  MqttConnectionPool,
} from "../src/utils/mqtt-helper.ts";

// --- Config types ---

interface XkhConfig {
  mqtt: {
    broker: string;
    username: string;
    password: string;
  };
  stations: Array<{ sn: string; id: string }>;
}

function parseXkhConfig(raw: unknown): XkhConfig {
  const config = raw as Record<string, unknown>;
  if (!config || typeof config !== "object") {
    throw new Error("XKH connector requires YAML config via --extra-config");
  }

  const mqtt = config["mqtt"] as Record<string, string> | undefined;
  if (!mqtt?.broker || !mqtt?.username || !mqtt?.password) {
    throw new Error("XKH config: mqtt.broker, mqtt.username, mqtt.password are required");
  }

  const stations = config["stations"] as Array<{ sn: string; id: string }> | undefined;
  if (!Array.isArray(stations) || stations.length === 0) {
    throw new Error("XKH config: stations[] is required and must not be empty");
  }

  return {
    mqtt: { broker: mqtt.broker, username: mqtt.username, password: mqtt.password },
    stations,
  };
}

// --- Data mapping ---

const RELAY_NUM = new Array(32).fill("0").join("/");
const MISSING = "32767";

function buildEleValue(datapoint: NormalizedDatapoint): string {
  const positions: string[] = new Array(31).fill(MISSING);

  positions[0] = findVoltage(datapoint) ?? MISSING;

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

function resolveNode(
  entries: [string, Record<string, unknown>][],
  index: number,
): Record<string, unknown> | undefined {
  const nodeNumber = index + 1;

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

  const sorted = entries
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));
  return sorted[index]?.[1];
}

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

function findVoltage(datapoint: NormalizedDatapoint): string | undefined {
  for (const [key, value] of Object.entries(datapoint.flatValues)) {
    if (/voltage|battery|vbat|vol/i.test(key)) {
      if (value !== undefined && value !== null) return String(value);
    }
  }

  for (const node of Object.values(datapoint.nodeValues)) {
    const v = extractParam(node, "voltage", "battery", "vbat", "vol");
    if (v !== undefined) return v;
  }

  return undefined;
}

function formatCreateTime(timestamp: number): string {
  const d = new Date(timestamp);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

// --- Connector factory ---

export default function createXkhConnector(rawConfig: unknown): Connector {
  const config = parseXkhConfig(rawConfig);
  const snToStation = new Map(config.stations.map((s) => [s.sn, s.id]));

  let pool: MqttConnectionPool;

  return {
    name: "xkh",

    async init(logger: ConnectorLogger) {
      pool = new MqttConnectionPool(
        {
          brokerUrl: config.mqtt.broker,
          username: config.mqtt.username,
          password: config.mqtt.password,
        },
        logger,
      );
      logger.info("XKH connector initialized", {
        broker: config.mqtt.broker,
        stations: config.stations.length,
      });
    },

    async forward({ device, datapoint, logger }: ConnectorContext) {
      const stationId = snToStation.get(device.sn);
      if (!stationId) {
        logger.debug(`Device ${device.sn} not in station mapping, skipping`);
        return;
      }

      const clientId = `hzd_SoilMoistureWithSalinity_${stationId}`;
      const topic = `/hzd/pub/SoilMoistureWithSalinity/${stationId}`;

      const eleValue = buildEleValue(datapoint);
      const payload = JSON.stringify({
        type: "data",
        data: [
          {
            eleValue,
            relayNum: RELAY_NUM,
            createTime: formatCreateTime(datapoint.timestamp * 1000),
          },
        ],
        version: "w-1.0",
      });

      const client = await pool.getClient(clientId);
      const result = await client.publishAsync(topic, payload, { qos: 0 });

      logger.info(`Published to ${topic}`, {
        topic,
        payload,
        responseCode: result?.cmd ?? "sent (qos0)",
        clientId,
        sn: device.sn,
        stationId,
      });
    },

    async close() {
      if (pool) {
        await pool.closeAll();
      }
    },
  };
}
