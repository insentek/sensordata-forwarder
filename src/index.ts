import type { LogLevel } from "./utils/logger.ts";
import { loadConfig } from "./core/config.ts";
import { loadConnector, loadConnectorConfig } from "./core/connector-loader.ts";
import { runPipeline } from "./core/pipeline.ts";
import { createLogger } from "./utils/logger.ts";

function getArgValue(argv: string[], flag: string): string | undefined {
  const flagIndex = argv.findIndex((item) => item === flag);
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1];
  }

  const prefix = `${flag}=`;
  const inlineFlag = argv.find((item) => item.startsWith(prefix));
  if (inlineFlag) {
    return inlineFlag.slice(prefix.length);
  }

  return undefined;
}

const LOG_LEVEL = (process.env["LOG_LEVEL"] ?? "info") as LogLevel;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const connectorName = getArgValue(argv, "--connector");
  const extraConfigPath = getArgValue(argv, "--extra-config");

  if (!connectorName) {
    console.error("Usage: bun start --connector <name> [--extra-config <path>]");
    console.error("Example: bun start --connector xkh --extra-config ./xkh.yml");
    process.exit(1);
  }

  const logger = createLogger(LOG_LEVEL);
  const config = await loadConfig();

  const connectorConfig = extraConfigPath
    ? await loadConnectorConfig(extraConfigPath)
    : undefined;

  const connector = await loadConnector(connectorName, connectorConfig);

  await runPipeline(config, connector, logger);
}

main().catch((error: unknown) => {
  console.error("[fatal]", error);
  process.exit(1);
});
