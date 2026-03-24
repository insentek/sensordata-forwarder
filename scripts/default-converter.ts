import type { ConverterContext } from "../src/core/types.ts";

export default async function convert({ device, datapoint }: ConverterContext) {
  return {
    payload: {
      source: "ecois-openapi",
      device: {
        sn: device.sn,
        alias: device.alias,
        type: device.type,
        series: device.series,
        authorized: device.authorized,
        location: device.location ?? null,
      },
      datapoint: {
        timestamp: datapoint.timestamp,
        datetime: datapoint.datetime ?? null,
        kind: datapoint.kind,
        flatValues: datapoint.flatValues,
        nodeValues: datapoint.nodeValues,
        sensors: datapoint.sensors,
      },
    },
  };
}
