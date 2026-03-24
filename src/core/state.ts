import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { PipelineState } from "./types.ts";

const EMPTY_STATE: PipelineState = {
  streams: {},
};

export class StateStore {
  private state: PipelineState = structuredClone(EMPTY_STATE);

  public constructor(private readonly statePath: string) {}

  public async initialize(): Promise<void> {
    this.state = await this.load();
  }

  public getStream(streamKey: string): {
    lastForwardedTimestamp?: number;
    lastRunAt?: string;
  } {
    return this.state.streams[streamKey] ?? {};
  }

  public updateStream(
    streamKey: string,
    patch: {
      lastForwardedTimestamp?: number;
    },
  ): void {
    const existing = this.state.streams[streamKey] ?? {};
    this.state.streams[streamKey] = {
      ...existing,
      ...patch,
      lastRunAt: new Date().toISOString(),
    };
  }

  public async save(): Promise<void> {
    const resolvedPath = resolve(this.statePath);
    await mkdir(dirname(resolvedPath), { recursive: true });
    await Bun.write(resolvedPath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  private async load(): Promise<PipelineState> {
    const resolvedPath = resolve(this.statePath);
    const file = Bun.file(resolvedPath);

    if (!(await file.exists())) {
      return structuredClone(EMPTY_STATE);
    }

    const raw = await file.text();
    if (!raw.trim()) {
      return structuredClone(EMPTY_STATE);
    }

    const parsed = JSON.parse(raw) as PipelineState;
    return {
      streams: parsed.streams ?? {},
    };
  }
}
