import path from "node:path";
import { pathToFileURL } from "node:url";
import yaml from "js-yaml";

import type { Connector, ConnectorFactory } from "./types.ts";

const CONNECTORS_DIR = path.resolve(process.cwd(), "connectors");

export async function loadConnectorConfig(
  configPath: string,
): Promise<unknown> {
  const absolutePath = path.isAbsolute(configPath)
    ? configPath
    : path.resolve(process.cwd(), configPath);

  const file = Bun.file(absolutePath);
  if (!(await file.exists())) {
    throw new Error(`Connector config not found: ${absolutePath}`);
  }

  const text = await file.text();
  return yaml.load(text);
}

export async function loadConnector(
  connectorName: string,
  connectorConfig?: unknown,
): Promise<Connector> {
  const scriptPath = path.join(CONNECTORS_DIR, `${connectorName}-connector.ts`);
  const file = Bun.file(scriptPath);

  if (!(await file.exists())) {
    throw new Error(
      `Connector "${connectorName}" not found at ${scriptPath}`,
    );
  }

  const module = (await import(pathToFileURL(scriptPath).href)) as Record<
    string,
    unknown
  >;
  const candidate = module["default"];

  if (!candidate) {
    throw new Error(
      `Connector default export not found in ${scriptPath}`,
    );
  }

  let connector: Connector;

  if (
    typeof candidate === "function" &&
    !("forward" in (candidate as object))
  ) {
    connector = await (candidate as ConnectorFactory)(connectorConfig);
  } else {
    connector = candidate as Connector;
  }

  if (
    typeof connector.forward !== "function" ||
    typeof connector.name !== "string"
  ) {
    throw new Error(
      `Connector from ${scriptPath} must have a 'name' string and a 'forward' method.`,
    );
  }

  return connector;
}
