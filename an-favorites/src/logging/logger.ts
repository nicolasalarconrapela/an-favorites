export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, metadata?: unknown): void;
  info(message: string, metadata?: unknown): void;
  warn(message: string, metadata?: unknown): void;
  error(message: string, error?: Error | unknown): void;
  dispose?(): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  channelName?: string;
  logFileName?: string;
  maxFileSizeBytes?: number;
}
