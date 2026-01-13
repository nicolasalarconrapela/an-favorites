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
   * Nombre del archivo de log.
   * Por defecto: extension.log.
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
  private readonly logFilePath: string;
  private readonly maxFileSizeBytes: number;
  private level: InternalLogLevel;

  private constructor(channel: vscode.OutputChannel, logFilePath: string, options: LoggingModuleOptions) {
    this.channel = channel;
    this.logFilePath = logFilePath;
    this.maxFileSizeBytes = options.maxFileSizeBytes ?? 5 * 1024 * 1024;
    this.level = options.level ?? 'info';

    this.ensureLogDirectory();
  }

  static create(context: vscode.ExtensionContext, options: LoggingModuleOptions = {}): LoggingModule {
    const channelName = options.channelName ?? 'AnFavorites';
    const channel = vscode.window.createOutputChannel(channelName);
    const baseLogDir = path.join(context.logUri.fsPath, 'anfavorites');
    const logFileName = options.logFileName ?? 'extension.log';
    const logFilePath = path.join(baseLogDir, logFileName);

    return new LoggingModule(channel, logFilePath, options);
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
    const serializedMetadata = metadata !== undefined ? ` ${this.serializeMetadata(metadata)}` : '';
    const line = `[${timestamp}] [${level}] ${message}${serializedMetadata}`;

    this.appendToChannel(level, line);
    this.appendToFile(line);
  }

  private appendToChannel(level: LogLevel, line: string): void {
    if (level === 'error') {
      this.channel.appendLine(`[error] ${line}`);
      return;
    }
    this.channel.appendLine(`[${level}] ${line}`);
  }

  private appendToFile(line: string): void {
    try {
      this.rotateIfNeeded();
      fs.appendFileSync(this.logFilePath, `${line}\n`, 'utf8');
    } catch (err) {
      // Evitar bucle recursivo: no escribimos errores de logging al propio logger,
      // solo informamos en el canal de salida.
      this.channel.appendLine(`[logger-error] No se pudo escribir en disco: ${String(err)}`);
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(this.logFilePath)) {
        return;
      }

      const stats = fs.statSync(this.logFilePath);
      if (stats.size < this.maxFileSizeBytes) {
        return;
      }

      const { dir, name, ext } = path.parse(this.logFilePath);
      const timestamp = this.buildTimestamp();
      const rotatedName = `${name}-${timestamp}${ext || '.log'}`;
      fs.renameSync(this.logFilePath, path.join(dir, rotatedName));
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
    const dir = path.dirname(this.logFilePath);
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
