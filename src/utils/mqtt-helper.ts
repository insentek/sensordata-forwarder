import { connectAsync, type MqttClient } from "mqtt";

import type { ConnectorLogger } from "../core/types.ts";

export interface MqttPoolOptions {
  brokerUrl: string;
  username?: string;
  password?: string;
}

export class MqttConnectionPool {
  private readonly connections = new Map<string, Promise<MqttClient>>();

  constructor(
    private readonly options: MqttPoolOptions,
    private readonly logger: ConnectorLogger,
  ) {}

  getClient(clientId: string): Promise<MqttClient> {
    let clientPromise = this.connections.get(clientId);
    if (!clientPromise) {
      this.logger.debug(`Creating MQTT connection: ${clientId}`);
      clientPromise = connectAsync(this.options.brokerUrl, {
        clientId,
        username: this.options.username,
        password: this.options.password,
      });
      this.connections.set(clientId, clientPromise);
    }
    return clientPromise;
  }

  async closeAll(): Promise<void> {
    for (const [clientId, clientPromise] of this.connections) {
      try {
        const client = await clientPromise;
        await client.endAsync();
        this.logger.debug(`Closed MQTT connection: ${clientId}`);
      } catch {
        this.logger.warn(`Failed to close MQTT connection: ${clientId}`);
      }
    }
    this.connections.clear();
  }
}
