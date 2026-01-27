import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { LogLevel, Logger, LoggerOptions } from './logger';

type InternalLogLevel = LogLevel | 'off';

const LEVEL_PRIORITY: Record<InternalLogLevel, number> = {
  off: 0,
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LEVEL_ICONS: Record<LogLevel, string> = {
  debug: '🔍',
  info: 'ℹ️',
  warn: '⚠️',
  error: '❌',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '🔵',
  info: '🟢',
  warn: '🟡',
  error: '🔴',
};

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: unknown;
}

interface LoggingModuleOptions extends LoggerOptions {
  /**
   * Sets the minimum log level to be written.
   * Default: info.
   */
  level?: LogLevel;
  /**
   * Name of the output channel in VS Code.
   * This name will appear in the VS Code Output panel.
   * Default: "AnFavorites Logs".
   */
  channelName?: string;
  /**
   * Base name of the log file (without extension).
   * Default: extension.
   */
  logFileName?: string;
  /**
   * Maximum file size before rotation (bytes).
   * Default: 5 MB.
   */
  maxFileSizeBytes?: number;
  /**
   * Maximum number of rotated log files to keep per log type.
   * Default: 5.
   */
  maxRotatedFiles?: number;
  /**
   * Buffer flush interval for async log writes (ms).
   * Default: 200.
   */
  flushIntervalMs?: number;
}

export class LoggingModule implements Logger {
  private readonly channel: vscode.OutputChannel;
  private readonly logFilePathTxt: string;
  private readonly logFilePathJson: string;
  private readonly maxFileSizeBytes: number;
  private readonly maxRotatedFiles: number;
  private readonly flushIntervalMs: number;
  private level: InternalLogLevel;
  private readonly pendingTxtLines: string[] = [];
  private readonly pendingJsonLines: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly throttleBuckets = new Map<
    string,
    { lastLoggedAt: number; skipped: number }
  >();
  private readonly defaultThrottleMs = 2000;

  private constructor(
    channel: vscode.OutputChannel,
    logFilePathTxt: string,
    logFilePathJson: string,
    options: LoggingModuleOptions,
  ) {
    this.channel = channel;
    this.logFilePathTxt = logFilePathTxt;
    this.logFilePathJson = logFilePathJson;
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 5 * 1024 * 1024;
    this.maxRotatedFiles = options.maxRotatedFiles ?? 5;
    this.flushIntervalMs = options.flushIntervalMs ?? 200;
    this.level = options.level ?? 'info';

    this.ensureLogDirectory();
  }

  static create(context: vscode.ExtensionContext, options: LoggingModuleOptions = {}): LoggingModule {
    const channelName = options.channelName ?? 'AnFavorites Logs';
    const channel = vscode.window.createOutputChannel(channelName);

    // Escribir BOM UTF-8 al inicio del canal para asegurar encoding correcto
    channel.append('\uFEFF');

    const baseLogDir = path.join(context.logUri.fsPath, 'anfavorites');
    const logFileNameBase = options.logFileName ?? 'extension';
    const logFilePathTxt = path.join(baseLogDir, `${logFileNameBase}.txt`);
    const logFilePathJson = path.join(baseLogDir, `${logFileNameBase}.json`);

    const logger = new LoggingModule(channel, logFilePathTxt, logFilePathJson, options);

    // Startup message with UTF-8 encoding (this ensures content before showing)
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('📋 Canal de logs AnFavorites iniciado');
    logger.info(`📁 Archivos de log: ${logFilePathTxt} | ${logFilePathJson}`);
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return logger;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  throttle(
    level: LogLevel,
    key: string,
    message: string,
    metadata?: unknown,
    intervalMs = this.defaultThrottleMs,
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const now = Date.now();
    const bucket = this.throttleBuckets.get(key) ?? {
      lastLoggedAt: 0,
      skipped: 0,
    };

    if (now - bucket.lastLoggedAt < intervalMs) {
      bucket.skipped += 1;
      this.throttleBuckets.set(key, bucket);
      return;
    }

    const skipped = bucket.skipped;
    bucket.skipped = 0;
    bucket.lastLoggedAt = now;
    this.throttleBuckets.set(key, bucket);

    if (skipped > 0) {
      this.write(
        level,
        `${message} (se omitieron ${skipped} mensajes repetidos)`,
        metadata,
      );
      return;
    }

    this.write(level, message, metadata);
  }

  debug(message: string, metadata?: unknown): void {
    this.write('debug', message, metadata);
  }

  info(message: string, metadata?: unknown): void {
    this.write('info', message, metadata);
  }

  warn(message: string, metadata?: unknown): void {
    this.write('warn', message, metadata);
  }

  error(message: string, error?: Error | unknown): void {
    const metadata =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : error && typeof error === 'object'
          ? error
          : undefined;
    this.write('error', message, metadata);
  }

  /**
   * Shows the log channel in the VS Code Output panel.
   * @param preserveFocus If true, does not remove focus from the current editor.
   */
  show(preserveFocus?: boolean): void {
    this.channel.show(preserveFocus);
  }

  /**
   * Gets the name of the log channel.
   */
  getChannelName(): string {
    return this.channel.name;
  }

  dispose(): void {
    void this.flushPending();
    this.channel.dispose();
  }

  private write(level: LogLevel, message: string, metadata?: unknown): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const logEntry: LogEntry = {
      timestamp,
      level,
      message,
      metadata,
    };

    const serializedMetadata = metadata !== undefined ? ` ${this.serializeMetadata(metadata)}` : '';
    const line = `[${timestamp}] [${level}] ${message}${serializedMetadata}`;

    this.appendToChannel(level, line);
    this.appendToFileTxt(line);
    this.appendToFileJson(logEntry);
  }

  private appendToChannel(level: LogLevel, line: string): void {
    const icon = LEVEL_ICONS[level];
    const colorIndicator = LEVEL_COLORS[level];
    const formattedLine = `${icon} ${colorIndicator} [${level.toUpperCase()}] ${line}`;
    this.channel.appendLine(formattedLine);

  }

  private appendToFileTxt(line: string): void {
    this.pendingTxtLines.push(`${line}\n`);
    this.scheduleFlush();
  }

  private appendToFileJson(entry: LogEntry): void {
    const jsonLine = JSON.stringify(entry, null, 2);
    this.pendingJsonLines.push(`${jsonLine}\n`);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushPending();
    }, this.flushIntervalMs);
  }

  private async flushPending(): Promise<void> {
    const txtLines = this.pendingTxtLines.splice(0);
    const jsonLines = this.pendingJsonLines.splice(0);

    if (txtLines.length === 0 && jsonLines.length === 0) {
      return;
    }

    this.writeQueue = this.writeQueue
      .then(async () => {
        if (txtLines.length > 0) {
          await this.appendBuffered(this.logFilePathTxt, txtLines.join(''));
        }
        if (jsonLines.length > 0) {
          await this.appendBuffered(this.logFilePathJson, jsonLines.join(''));
        }
      })
      .catch((err) => {
        this.channel.appendLine(
          `❌ [logger-error] Falló la cola de escritura: ${String(err)}`,
        );
      });

    await this.writeQueue;
  }

  private async appendBuffered(filePath: string, data: string): Promise<void> {
    try {
      await this.rotateIfNeeded(filePath);
      await this.ensureFileHeader(filePath);
      await fs.promises.appendFile(filePath, data, {
        encoding: 'utf8',
        flag: 'a',
      });
    } catch (err) {
      this.channel.appendLine(
        `❌ [logger-error] No se pudo escribir en archivo: ${String(err)}`,
      );
    }
  }

  private async ensureFileHeader(filePath: string): Promise<void> {
    try {
      await fs.promises.access(filePath, fs.constants.F_OK);
    } catch {
      await fs.promises.writeFile(filePath, '\uFEFF', 'utf8');
    }
  }

  private async rotateIfNeeded(filePath: string): Promise<void> {
    try {
      let stats: fs.Stats | null = null;
      try {
        stats = await fs.promises.stat(filePath);
      } catch {
        return;
      }

      if (!stats) {
        return;
      }

      if (stats.size < this.maxFileSizeBytes) {
        return;
      }

      const { dir, name, ext } = path.parse(filePath);
      const timestamp = this.buildTimestamp();
      const rotatedName = `${name}-${timestamp}${ext || '.log'}`;
      await fs.promises.rename(filePath, path.join(dir, rotatedName));
      await this.cleanupRotatedLogs(dir, name, ext || '.log');
    } catch (err) {
      this.channel.appendLine(`❌ [logger-error] No se pudo rotar el log: ${String(err)}`);
    }
  }

  private async cleanupRotatedLogs(dir: string, baseName: string, ext: string): Promise<void> {
    if (this.maxRotatedFiles <= 0) {
      return;
    }

    try {
      const files = await fs.promises.readdir(dir);
      const rotatedFiles = files
        .filter((file) => file.startsWith(`${baseName}-`) && file.endsWith(ext))
        .map((file) => path.join(dir, file));

      if (rotatedFiles.length <= this.maxRotatedFiles) {
        return;
      }

      const stats = await Promise.all(
        rotatedFiles.map(async (file) => ({
          file,
          stat: await fs.promises.stat(file),
        })),
      );

      stats.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs);

      const filesToDelete = stats.slice(0, stats.length - this.maxRotatedFiles);
      await Promise.all(
        filesToDelete.map(async ({ file }) => {
          await fs.promises.unlink(file);
        }),
      );
    } catch (err) {
      this.channel.appendLine(
        `❌ [logger-error] No se pudo limpiar logs rotados: ${String(err)}`,
      );
    }
  }

  private buildTimestamp(): string {
    const now = new Date();
    const pad = (value: number) => value.toString().padStart(2, '0');
    const yyyy = now.getFullYear();
    const mm = pad(now.getMonth() + 1);
    const dd = pad(now.getDate());
    const hh = pad(now.getHours());
    const mi = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.level];
  }

  private ensureLogDirectory(): void {
    const dir = path.dirname(this.logFilePathTxt);
    fs.mkdirSync(dir, { recursive: true });
  }

  private serializeMetadata(metadata: unknown): string {
    if (metadata instanceof Error) {
      return JSON.stringify({ message: metadata.message, stack: metadata.stack }, null, 2);
    }

    if (typeof metadata === 'object' && metadata !== null) {
      try {
        return JSON.stringify(metadata, null, 2);
      } catch {
        return '[metadata: no serializable]';
      }
    }

    return String(metadata);
  }
}

export function createAppLogger(context: vscode.ExtensionContext, options?: LoggingModuleOptions): LoggingModule {
  return LoggingModule.create(context, options);
}
