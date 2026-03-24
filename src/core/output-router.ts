import { sendHttpMessage } from "../endpoints/http-output.ts";
import { MqttOutput } from "../endpoints/mqtt-output.ts";
import type { Logger } from "../utils/logger.ts";
import type { OutputConfig, OutboundMessage } from "./types.ts";

type OutputHandler = {
  send(message: OutboundMessage): Promise<void>;
  close?(): Promise<void>;
};

export class OutputRouter {
  private readonly handlers = new Map<string, OutputHandler>();

  public constructor(
    outputs: OutputConfig[],
    private readonly logger: Logger,
  ) {
    for (const output of outputs) {
      if (output.type === "http") {
        this.handlers.set(
          output.id,
          {
            send: async (message) => {
              await sendHttpMessage(
                output,
                message,
                this.logger.child(`http:${output.id}`),
              );
            },
          },
        );
        continue;
      }

      this.handlers.set(
        output.id,
        new MqttOutput(output, this.logger.child(`mqtt:${output.id}`)),
      );
    }
  }

  public async send(
    defaultOutputIds: string[],
    messages: OutboundMessage[],
  ): Promise<void> {
    for (const message of messages) {
      const outputIds = message.outputIds?.length
        ? message.outputIds
        : defaultOutputIds;

      if (!outputIds.length) {
        throw new Error("No output targets resolved for outbound message.");
      }

      for (const outputId of outputIds) {
        const handler = this.handlers.get(outputId);
        if (!handler) {
          throw new Error(`Unknown output id: ${outputId}`);
        }

        await handler.send(message);
      }
    }
  }

  public async close(): Promise<void> {
    for (const handler of this.handlers.values()) {
      await handler.close?.();
    }
  }
}

export async function buildOutputRouter(
  outputs: OutputConfig[],
  logger: Logger,
): Promise<OutputRouter> {
  return new OutputRouter(outputs, logger);
}
