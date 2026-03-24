import { connectAsync, type MqttClient } from "mqtt";

import type { MqttOutputConfig, OutboundMessage } from "../core/types.ts";
import type { Logger } from "../utils/logger.ts";

export class MqttOutput {
  private clientPromise: Promise<MqttClient> | undefined;

  public constructor(
    private readonly config: MqttOutputConfig,
    private readonly logger: Logger,
  ) {}

  public async send(message: OutboundMessage): Promise<void> {
    const client = await this.getClient();
    const topic = message.topic ?? this.config.topic;
    const qos = message.qos ?? this.config.qos ?? 0;
    const retain = message.retain ?? this.config.retain ?? false;
    const payload =
      typeof message.payload === "string"
        ? message.payload
        : JSON.stringify(message.payload);

    await client.publishAsync(topic, payload, { qos, retain });
    this.logger.debug("MQTT message delivered", {
      outputId: this.config.id,
      topic,
    });
  }

  public async close(): Promise<void> {
    if (!this.clientPromise) {
      return;
    }

    const client = await this.clientPromise;
    await client.endAsync();
  }

  private async getClient(): Promise<MqttClient> {
    if (!this.clientPromise) {
      this.clientPromise = connectAsync(this.config.brokerUrl, {
        clientId: this.config.clientId,
        username: this.config.username,
        password: this.config.password,
      });
    }

    return this.clientPromise;
  }
}
