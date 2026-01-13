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

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  metadata?: unknown;
}

interface LoggingModuleOptions extends LoggerOptions {
  /**
   * Establece el nivel mínimo de logs que se escribirán.
   * Por defecto: info.
   */
  level?: LogLevel;
  /**
   * Nombre del canal de salida en VS Code.
   * Por defecto: AnFavorites.
   */
  channelName?: string;
  /**
   * Nombre base del archivo de log (sin extensión).
   * Por defecto: extension.
   */
  logFileName?: string;
  /**
   * Tamaño máximo del archivo antes de rotarlo (bytes).
   * Por defecto: 5 MB.
   */
  maxFileSizeBytes?: number;
}

export class LoggingModule implements Logger {
  private readonly channel: vscode.OutputChannel;
  private readonly logFilePathTxt: string;
  private readonly logFilePathJson: string;
  private readonly maxFileSizeBytes: number;
  private level: InternalLogLevel;

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
    this.level = options.level ?? 'info';

    this.ensureLogDirectory();
  }

  static create(context: vscode.ExtensionContext, options: LoggingModuleOptions = {}): LoggingModule {
    const channelName = options.channelName ?? 'AnFavorites';
    const channel = vscode.window.createOutputChannel(channelName);
    const baseLogDir = path.join(context.logUri.fsPath, 'anfavorites');
    const logFileNameBase = options.logFileName ?? 'extension';
    const logFilePathTxt = path.join(baseLogDir, `${logFileNameBase}.txt`);
    const logFilePathJson = path.join(baseLogDir, `${logFileNameBase}.json`);

    return new LoggingModule(channel, logFilePathTxt, logFilePathJson, options);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
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

  dispose(): void {
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
    if (level === 'error') {
      this.channel.appendLine(`[error] ${line}`);
      return;
    }
    this.channel.appendLine(`[${level}] ${line}`);
  }

  private appendToFileTxt(line: string): void {
    try {
      this.rotateIfNeeded(this.logFilePathTxt);
      fs.appendFileSync(this.logFilePathTxt, `${line}\n`, 'utf8');
    } catch (err) {
      // Evitar bucle recursivo: no escribimos errores de logging al propio logger,
      // solo informamos en el canal de salida.
      this.channel.appendLine(`[logger-error] No se pudo escribir en archivo TXT: ${String(err)}`);
    }
  }

  private appendToFileJson(entry: LogEntry): void {
    try {
      this.rotateIfNeeded(this.logFilePathJson);
      const jsonLine = JSON.stringify(entry);
      fs.appendFileSync(this.logFilePathJson, `${jsonLine}\n`, 'utf8');
    } catch (err) {
      // Evitar bucle recursivo: no escribimos errores de logging al propio logger,
      // solo informamos en el canal de salida.
      this.channel.appendLine(`[logger-error] No se pudo escribir en archivo JSON: ${String(err)}`);
    }
  }

  private rotateIfNeeded(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) {
        return;
      }

      const stats = fs.statSync(filePath);
      if (stats.size < this.maxFileSizeBytes) {
        return;
      }

      const { dir, name, ext } = path.parse(filePath);
      const timestamp = this.buildTimestamp();
      const rotatedName = `${name}-${timestamp}${ext || '.log'}`;
      fs.renameSync(filePath, path.join(dir, rotatedName));
    } catch (err) {
      this.channel.appendLine(`[logger-error] No se pudo rotar el log: ${String(err)}`);
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
      return JSON.stringify({ message: metadata.message, stack: metadata.stack });
    }

    if (typeof metadata === 'object') {
      try {
        return JSON.stringify(metadata);
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
