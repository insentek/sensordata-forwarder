import path from "node:path";
import { pathToFileURL } from "node:url";

import type {
  ConverterContext,
  ConverterFn,
  ConverterModule,
  ConverterResult,
  OutboundMessage,
} from "./types.ts";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOutboundMessage(value: unknown): value is OutboundMessage {
  return isObject(value) && "payload" in value;
}

function normalizeSingleResult(
  result: Exclude<ConverterResult, null | undefined>,
  defaultOutputIds: string[],
): OutboundMessage {
  if (isOutboundMessage(result)) {
    const message = result;
    return {
      ...message,
      outputIds: message.outputIds ?? defaultOutputIds,
    };
  }

  return {
    payload: result,
    outputIds: defaultOutputIds,
  };
}

export async function loadConverter(
  scriptPath: string,
  exportName: string,
  defaultOutputIds: string[],
): Promise<(context: ConverterContext) => Promise<OutboundMessage[]>> {
  const absolutePath = path.isAbsolute(scriptPath)
    ? scriptPath
    : path.resolve(process.cwd(), scriptPath);
  const module = (await import(pathToFileURL(absolutePath).href)) as ConverterModule;
  const candidate =
    exportName === "default"
      ? module.default
      : (module[exportName] as ConverterFn | undefined);

  if (typeof candidate !== "function") {
    throw new Error(`Converter export "${exportName}" was not found in ${absolutePath}`);
  }

  return async (context: ConverterContext) => {
    const result = await candidate(context);
    if (result === null || result === undefined) {
      return [];
    }

    if (Array.isArray(result)) {
      return result.map((item) =>
        normalizeSingleResult(
          item as Exclude<ConverterResult, null | undefined>,
          defaultOutputIds,
        ),
      );
    }

    return [
      normalizeSingleResult(
        result as Exclude<ConverterResult, null | undefined>,
        defaultOutputIds,
      ),
    ];
  };
}
