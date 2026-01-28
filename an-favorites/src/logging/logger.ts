export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogMessage = string | (() => string);
export type LogMetadata = unknown | (() => unknown);

export interface LogContext {
  scope?: string;
  correlationId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: LogMessage, metadata?: LogMetadata): void;
  info(message: LogMessage, metadata?: LogMetadata): void;
  warn(message: LogMessage, metadata?: LogMetadata): void;
  error(message: LogMessage, error?: Error | unknown | LogMetadata): void;
  throttle?(
    level: LogLevel,
    key: string,
    message: LogMessage,
    metadata?: LogMetadata,
    intervalMs?: number,
  ): void;
  withContext?(context: LogContext): Logger;
  startTimer?(
    level: LogLevel,
    message: LogMessage,
    metadata?: LogMetadata,
  ): () => void;
  dispose?(): void;
}

export interface LoggerOptions {
  level?: LogLevel;
  channelName?: string;
  logFileName?: string;
  maxFileSizeBytes?: number;
  maxMetadataDepth?: number;
  maxMetadataStringLength?: number;
  redactKeys?: string[];
  redactPaths?: boolean;
  consoleOutput?: boolean;
}
