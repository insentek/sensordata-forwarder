import { loadConfig } from "./core/config.ts";
import { runPipeline } from "./core/pipeline.ts";
import { createLogger } from "./utils/logger.ts";

function getConfigPathFromArgv(argv: string[]): string | undefined {
  const flagIndex = argv.findIndex((item) => item === "--pipeline-config");
  if (flagIndex >= 0 && argv[flagIndex + 1]) {
    return argv[flagIndex + 1];
  }

  const inlineFlag = argv.find((item) => item.startsWith("--pipeline-config="));
  if (inlineFlag) {
    return inlineFlag.slice("--pipeline-config=".length);
  }

  return undefined;
}

async function main(): Promise<void> {
  const configPath = getConfigPathFromArgv(process.argv.slice(2));
  const config = await loadConfig(configPath);
  const logger = createLogger(config.logging.level);
  await runPipeline(config, logger);
}

main().catch((error: unknown) => {
  console.error("[fatal]", error);
  process.exit(1);
});
