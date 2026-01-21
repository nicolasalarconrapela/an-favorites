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

    // Show channel in Output panel after writing content
    // Use setTimeout to ensure VS Code processes content first
    setTimeout(() => {
      channel.show(false);
    }, 100);

    return logger;
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

    // Show channel automatically for errors and warnings
    if (level === 'error' || level === 'warn') {
      this.channel.show(false);
    }
  }

  private appendToFileTxt(line: string): void {
    try {
      this.rotateIfNeeded(this.logFilePathTxt);

      // Ensure file has UTF-8 BOM if new
      if (!fs.existsSync(this.logFilePathTxt)) {
        fs.writeFileSync(this.logFilePathTxt, '\uFEFF', 'utf8');
      }

      fs.appendFileSync(this.logFilePathTxt, `${line}\n`, { encoding: 'utf8', flag: 'a' });
    } catch (err) {
      // Avoid recursive loop: don't write logging errors to the logger itself,
      // solo informamos en el canal de salida.
      this.channel.appendLine(`❌ [logger-error] No se pudo escribir en archivo TXT: ${String(err)}`);
    }
  }

  private appendToFileJson(entry: LogEntry): void {
    try {
      this.rotateIfNeeded(this.logFilePathJson);

      // Ensure file has UTF-8 BOM if new
      if (!fs.existsSync(this.logFilePathJson)) {
        fs.writeFileSync(this.logFilePathJson, '\uFEFF', 'utf8');
      }

      const jsonLine = JSON.stringify(entry, null, 2);
      fs.appendFileSync(this.logFilePathJson, `${jsonLine}\n`, { encoding: 'utf8', flag: 'a' });
    } catch (err) {
      // Avoid recursive loop: don't write logging errors to the logger itself,
      // solo informamos en el canal de salida.
      this.channel.appendLine(`❌ [logger-error] No se pudo escribir en archivo JSON: ${String(err)}`);
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
      this.channel.appendLine(`❌ [logger-error] No se pudo rotar el log: ${String(err)}`);
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
