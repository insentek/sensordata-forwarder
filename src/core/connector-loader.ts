import path from "node:path";
import { pathToFileURL } from "node:url";

import type { Connector, ConnectorFactory } from "./types.ts";

export async function loadConnector(
  scriptPath: string,
  exportName: string = "default",
): Promise<Connector> {
  const absolutePath = path.isAbsolute(scriptPath)
    ? scriptPath
    : path.resolve(process.cwd(), scriptPath);

  const module = (await import(pathToFileURL(absolutePath).href)) as Record<
    string,
    unknown
  >;
  const candidate =
    exportName === "default" ? module["default"] : module[exportName];

  if (!candidate) {
    throw new Error(
      `Connector export "${exportName}" not found in ${absolutePath}`,
    );
  }

  let connector: Connector;

  if (
    typeof candidate === "function" &&
    !("forward" in (candidate as object))
  ) {
    connector = await (candidate as ConnectorFactory)();
  } else {
    connector = candidate as Connector;
  }

  if (
    typeof connector.forward !== "function" ||
    typeof connector.name !== "string"
  ) {
    throw new Error(
      `Connector from ${absolutePath} must have a 'name' string and a 'forward' method.`,
    );
  }

  return connector;
}
