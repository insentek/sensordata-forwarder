const levels = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
} as const;

export type LogLevel = keyof typeof levels;

export class Logger {
  public constructor(
    private readonly level: LogLevel,
    private readonly scope?: string,
  ) {}

  public child(scope: string): Logger {
    return new Logger(this.level, this.scope ? `${this.scope}:${scope}` : scope);
  }

  private shouldLog(level: LogLevel): boolean {
    return levels[level] >= levels[this.level];
  }

  private emit(level: LogLevel, message: string, meta?: unknown): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const scopePart = this.scope ? ` [${this.scope}]` : "";
    const prefix = `[${new Date().toISOString()}] [${level.toUpperCase()}]${scopePart}`;
    if (meta === undefined) {
      console[level === "debug" ? "log" : level](`${prefix} ${message}`);
      return;
    }

    console[level === "debug" ? "log" : level](`${prefix} ${message}`, meta);
  }

  debug(message: string, meta?: unknown): void {
    this.emit("debug", message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.emit("info", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.emit("warn", message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.emit("error", message, meta);
  }
}

export function createLogger(level: LogLevel): Logger {
  return new Logger(level);
}
