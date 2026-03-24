import { describe, expect, test } from "bun:test";

import { parseConfig } from "../src/core/config.ts";

describe("parseConfig", () => {
  test("normalizes relative paths and defaults", () => {
    const config = parseConfig({
      api: {
        baseUrl: "http://openapi.ecois.info",
        appid: "appid",
        secret: "secret",
        timeoutMs: 1000,
        retry: {
          attempts: 2,
          backoffMs: 100,
        },
      },
      devices: {
        pageSize: 100,
        includeAuthorized: ["own"],
        includeSerials: [],
        excludeSerials: [],
        concurrency: 2,
        fetch: {
          mode: "incremental",
        },
        overrides: {},
      },
      converter: {
        scriptPath: "./scripts/default-converter.ts",
        exportName: "default",
      },
      routing: {
        defaultOutputIds: ["http-primary"],
      },
      outputs: [
        {
          id: "http-primary",
          type: "http",
          url: "https://example.com/ingest",
        },
      ],
      state: {
        path: "./data/state.json",
      },
      logging: {
        level: "info",
      },
    });

    expect(config.converter.scriptPath.startsWith("/")).toBe(true);
    expect(config.state.path.startsWith("/")).toBe(true);
    expect(config.devices.fetch.includeParameters).toEqual([]);
    expect(config.devices.fetch.includeNodes).toEqual([]);
  });
});
