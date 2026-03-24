import { describe, expect, test } from "bun:test";

import { parseConfig } from "../src/core/config.ts";

describe("parseConfig", () => {
  test("minimal config with only api credentials", () => {
    const config = parseConfig({
      api: {
        appid: "appid",
        secret: "secret",
      },
    });

    expect(config.api.appid).toBe("appid");
    expect(config.api.baseUrl).toBe("http://openapi.ecois.info");
    expect(config.api.retry.attempts).toBe(3);
    expect(config.devices.fetch.mode).toBe("latest");
    expect(config.devices.concurrency).toBe(4);
  });

  test("full config with overrides", () => {
    const config = parseConfig({
      api: {
        appid: "appid",
        secret: "secret",
        timeoutMs: 5000,
        retry: { attempts: 5, backoffMs: 1000 },
      },
      devices: {
        pageSize: 50,
        includeSerials: ["SN1"],
        concurrency: 2,
        fetch: { mode: "incremental" },
      },
    });

    expect(config.api.timeoutMs).toBe(5000);
    expect(config.api.retry.attempts).toBe(5);
    expect(config.devices.pageSize).toBe(50);
    expect(config.devices.includeSerials).toEqual(["SN1"]);
    expect(config.devices.fetch.mode).toBe("incremental");
    expect(config.devices.fetch.includeParameters).toEqual([]);
  });

  test("rejects config without api", () => {
    expect(() => parseConfig({})).toThrow();
  });
});
