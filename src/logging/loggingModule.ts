import * as fs from 'fs';
import * as path from 'path';
import * as util from 'util';
import * as vscode from 'vscode';

import {
  LogContext,
  LogLevel,
  LogMessage,
  LogMetadata,
  Logger,
  LoggerOptions,
} from './logger';

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
  scope?: string;
  correlationId?: string;
  message: string;
  metadata?: unknown;
}

interface LoggingModuleOptions extends LoggerOptions {
  level?: LogLevel;

  channelName?: string;

  logFileName?: string;

  maxFileSizeBytes?: number;

  maxRotatedFiles?: number;

  flushIntervalMs?: number;

  pathRoots?: string[];
}

interface ContextMetadata {
  context?: LogContext;
  metadata?: unknown;
}

export interface LoggedActionHandle {
  step(message: string, metadata?: LogMetadata): void;
  success(metadata?: LogMetadata): void;
  fail(error: unknown, metadata?: LogMetadata): void;
}

const DEFAULT_REDACT_KEYS = [
  'authorization',
  'token',
  'accessToken',
  'refreshToken',
  'password',
  'secret',
  'apiKey',
  'apikey',
];

export class LoggingModule implements Logger {
  private readonly channel: vscode.OutputChannel;
  private readonly logFilePathTxt: string;
  private readonly logFilePathJson: string;
  private readonly maxFileSizeBytes: number;
  private readonly maxRotatedFiles: number;
  private readonly flushIntervalMs: number;
  private readonly maxMetadataDepth: number;
  private readonly maxMetadataStringLength: number;
  private readonly redactKeys: string[];
  private readonly redactPaths: boolean;
  private readonly pathRoots: string[];
  private readonly consoleOutput: boolean;
  private level: InternalLogLevel;
  private readonly pendingTxtLines: string[] = [];
  private readonly pendingJsonLines: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private writeQueue: Promise<void> = Promise.resolve();
  private isDisposed = false;
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
    this.maxMetadataDepth = options.maxMetadataDepth ?? 6;
    this.maxMetadataStringLength = options.maxMetadataStringLength ?? 4000;
    this.redactKeys = (options.redactKeys ?? DEFAULT_REDACT_KEYS).map((key) =>
      key.toLowerCase(),
    );
    this.redactPaths = options.redactPaths ?? true;
    this.pathRoots = (options.pathRoots ?? []).map((root) => path.resolve(root));
    this.consoleOutput = options.consoleOutput ?? false;

    this.ensureLogDirectory();
  }

  static create(
    context: vscode.ExtensionContext,
    options: LoggingModuleOptions = {},
  ): LoggingModule {
    const channelName = options.channelName ?? 'AnFavorites';
    const channel = vscode.window.createOutputChannel(channelName);

    // channel.append('\uFEFF');

    const baseLogDir = LoggingModule.buildSessionLogDirectory(context);
    const logFileNameBase = options.logFileName ?? 'extension';
    const logFilePathTxt = path.join(baseLogDir, `${logFileNameBase}.txt`);
    const logFilePathJson = path.join(baseLogDir, `${logFileNameBase}.json`);

    const logger = new LoggingModule(
      channel,
      logFilePathTxt,
      logFilePathJson,
      {
        ...options,
        redactPaths: options.redactPaths ?? true,
        pathRoots: [
          ...(options.pathRoots ?? []),
          ...((vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath)),
          context.extensionUri.fsPath,
          context.logUri.fsPath,
        ],
      },
    );

    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('📋 Canal de logs AnFavorites iniciado');
    logger.info('📁 Archivos de log inicializados', {
      txtLogPath: logFilePathTxt,
      jsonLogPath: logFilePathJson,
    });
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    return logger;
  }

  private static buildSessionLogDirectory(
    context: vscode.ExtensionContext,
  ): string {
    const version = String(context.extension.packageJSON.version ?? 'unknown');
    const now = new Date();
    const pad = (value: number) => value.toString().padStart(2, '0');
    const ddmmyy = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${String(
      now.getFullYear(),
    ).slice(-2)}`;
    const hhmmss = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(
      now.getSeconds(),
    )}`;

    return path.join(context.logUri.fsPath, 'anfavorites', version, ddmmyy, hhmmss);
  }

  setLevel(level: LogLevel): void {
    const oldLevel = this.level;
    this.level = level;
    this.info(`[logging] Level changed from ${oldLevel} to ${level}`);
  }

  throttle(
    level: LogLevel,
    key: string,
    message: LogMessage,
    metadata?: LogMetadata,
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

  debug(message: LogMessage, metadata?: LogMetadata): void {
    this.write('debug', message, metadata);
  }

  info(message: LogMessage, metadata?: LogMetadata): void {
    this.write('info', message, metadata);
  }

  warn(message: LogMessage, metadata?: LogMetadata): void {
    this.write('warn', message, metadata);
  }

  error(message: LogMessage, error?: Error | unknown | LogMetadata): void {
    const resolved = this.resolveMetadata(error);
    const metadata = this.normalizeError(resolved);
    this.write('error', message, metadata);
  }

  withContext(context: LogContext): Logger {
    return new ContextualLogger(this, context);
  }

  startTimer(
    level: LogLevel,
    message: LogMessage,
    metadata?: LogMetadata,
  ): () => void {
    const start = Date.now();
    return () => {
      const durationMs = Date.now() - start;
      const resolvedMetadata = this.resolveMetadata(metadata);
      if (
        resolvedMetadata &&
        typeof resolvedMetadata === 'object' &&
        !(resolvedMetadata instanceof Error)
      ) {
        this.write(level, message, {
          ...resolvedMetadata,
          durationMs,
        });
        return;
      }
      if (resolvedMetadata !== undefined) {
        this.write(level, message, {
          metadata: resolvedMetadata,
          durationMs,
        });
        return;
      }
      this.write(level, message, { durationMs });
    };
  }

  show(preserveFocus?: boolean): void {
    this.channel.show(preserveFocus);
  }

  getChannelName(): string {
    return this.channel.name;
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    const txtLines = this.pendingTxtLines.splice(0);
    const jsonLines = this.pendingJsonLines.splice(0);

    this.writeQueue = this.writeQueue.finally(async () => {
      if (txtLines.length > 0) {
        await this.appendBuffered(this.logFilePathTxt, txtLines.join(''));
      }
      if (jsonLines.length > 0) {
        await this.appendBuffered(this.logFilePathJson, jsonLines.join(''));
      }
      this.channel.dispose();
    });
  }

  private write(
    level: LogLevel,
    message: LogMessage,
    metadata?: LogMetadata,
  ): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const resolvedMessage = this.redactString(this.resolveMessage(message));
    const resolvedMetadata = this.resolveMetadata(metadata);
    const contextMetadata = this.extractContext(resolvedMetadata);
    const safeMetadata = this.sanitizeMetadata(contextMetadata.metadata);
    const logEntry: LogEntry = {
      timestamp,
      level,
      scope: contextMetadata.context?.scope,
      correlationId: contextMetadata.context?.correlationId,
      message: resolvedMessage,
      metadata: safeMetadata,
    };

    const contextSuffix = this.formatContext(contextMetadata.context);
    const serializedMetadata =
      safeMetadata !== undefined
        ? ` ${this.serializeMetadata(safeMetadata)}`
        : '';
    const line = `[${timestamp}] [${level}]${contextSuffix} ${resolvedMessage}${serializedMetadata}`;

    this.appendToChannel(level, line);
    this.appendToFileTxt(line);
    this.appendToFileJson(logEntry);
  }

  private appendToChannel(level: LogLevel, line: string): void {
    if (this.isDisposed) {
      return;
    }
    const icon = LEVEL_ICONS[level];
    const colorIndicator = LEVEL_COLORS[level];
    const formattedLine = `${icon} ${colorIndicator} [${level.toUpperCase()}] ${line}`;
    this.channel.appendLine(formattedLine);
    if (this.consoleOutput) {
      if (level === 'error') {
        console.error(formattedLine);
      } else if (level === 'warn') {
        console.warn(formattedLine);
      } else {
        console.log(formattedLine);
      }
    }
  }

  private appendToFileTxt(line: string): void {
    this.pendingTxtLines.push(`${line}\n`);
    this.scheduleFlush();
  }

  private appendToFileJson(entry: LogEntry): void {
    const jsonLine = this.safeStringify(entry);
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
      this.channel.appendLine(
        `❌ [logger-error] No se pudo rotar el log: ${String(err)}`,
      );
    }
  }

  private async cleanupRotatedLogs(
    dir: string,
    baseName: string,
    ext: string,
  ): Promise<void> {
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

  private resolveMessage(message: LogMessage | undefined): string {
    if (typeof message === 'function') {
      return message();
    }
    return message ?? '';
  }

  private resolveMetadata(metadata?: LogMetadata): unknown {
    if (typeof metadata === 'function') {
      return metadata();
    }
    return metadata;
  }

  private normalizeError(error: unknown): unknown {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }
    return error;
  }

  private extractContext(metadata: unknown): ContextMetadata {
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      metadata instanceof Error
    ) {
      return { metadata };
    }

    const candidate = metadata as Record<string, unknown>;
    const scope =
      typeof candidate.scope === 'string' ? candidate.scope : undefined;
    const correlationId =
      typeof candidate.correlationId === 'string'
        ? candidate.correlationId
        : undefined;

    if (!scope && !correlationId) {
      return { metadata };
    }

    const { scope: _scope, correlationId: _correlationId, ...rest } = candidate;
    const context: LogContext = { scope, correlationId };
    const remaining = Object.keys(rest).length > 0 ? rest : undefined;
    return { context, metadata: remaining };
  }

  private formatContext(context?: LogContext): string {
    if (!context) {
      return '';
    }
    const parts: string[] = [];
    if (context.scope) {
      parts.push(`scope=${context.scope}`);
    }
    if (context.correlationId) {
      parts.push(`cid=${context.correlationId}`);
    }
    return parts.length > 0 ? ` [${parts.join(' ')}]` : '';
  }

  private sanitizeMetadata(metadata: unknown, depth = 0): unknown {
    if (metadata === null || metadata === undefined) {
      return metadata;
    }

    if (metadata instanceof Error) {
      return {
        name: metadata.name,
        message: metadata.message,
        stack: metadata.stack,
      };
    }

    if (typeof metadata === 'string') {
      return this.redactString(metadata, undefined);
    }

    if (typeof metadata !== 'object') {
      return metadata;
    }

    if (depth >= this.maxMetadataDepth) {
      return '[metadata: max depth reached]';
    }

    if (Array.isArray(metadata)) {
      return metadata.map((item) => this.sanitizeMetadata(item, depth + 1));
    }

    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      metadata as Record<string, unknown>,
    )) {
      if (this.redactKeys.includes(key.toLowerCase())) {
        sanitized[key] = '[redacted]';
        continue;
      }
      sanitized[key] = this.sanitizeMetadata(value, depth + 1);
      if (typeof sanitized[key] === 'string') {
        sanitized[key] = this.redactString(sanitized[key] as string, key);
      }
    }
    return sanitized;
  }

  private redactString(value: string, key?: string): string {
    if (value.length > this.maxMetadataStringLength) {
      return `${value.slice(0, this.maxMetadataStringLength)}…[truncated]`;
    }

    if (this.redactPaths) {
      if (
        key &&
        ['txtlogpath', 'jsonlogpath', 'logfilepath', 'logdir'].includes(
          key.toLowerCase(),
        )
      ) {
        return value;
      }
      if (key && key.toLowerCase().includes('path')) {
        return this.rewriteAbsolutePaths(value);
      }
      return this.rewriteAbsolutePaths(value);
    }

    return value;
  }

  private rewriteAbsolutePaths(value: string): string {
    const absolutePathPattern =
      /([a-zA-Z]:\\[^<>:"|?*\r\n]+|\/[^<>:"|?*\r\n]+)(?=$|[\s),;])/g;

    return value.replace(absolutePathPattern, (match) =>
      this.toSafePathReference(match),
    );
  }

  private toSafePathReference(value: string): string {
    const normalizedInput = path.normalize(value);

    for (const root of this.pathRoots) {
      const relative = path.relative(root, normalizedInput);
      if (
        relative &&
        !relative.startsWith('..') &&
        !path.isAbsolute(relative)
      ) {
        return `<${this.getRootLabel(root)}>/${relative.replace(/\\/g, '/')}`;
      }

      if (relative === '') {
        return `<${this.getRootLabel(root)}>`;
      }
    }

    if (path.isAbsolute(normalizedInput)) {
      return '[absolute-path]';
    }

    return value;
  }

  private getRootLabel(root: string): string {
    const workspaceFolder = vscode.workspace.workspaceFolders?.find(
      (folder) => path.resolve(folder.uri.fsPath) === root,
    );
    if (workspaceFolder) {
      return workspaceFolder.name;
    }

    if (
      path.resolve(root) ===
      path.resolve(vscode.workspace.workspaceFile?.fsPath ?? '')
    ) {
      return 'workspace';
    }

    return path.basename(root) || 'root';
  }

  private serializeMetadata(metadata: unknown): string {
    if (metadata === undefined) {
      return '';
    }
    return this.safeInspect(metadata);
  }

  private safeStringify(value: unknown): string {
    const seen = new WeakSet<object>();
    try {
      return JSON.stringify(value, (_key, val) => {
        if (typeof val === 'bigint') {
          return val.toString();
        }
        if (typeof val === 'object' && val !== null) {
          if (seen.has(val)) {
            return '[circular]';
          }
          seen.add(val);
        }
        return val;
      });
    } catch {
      return '[metadata: not serializable]';
    }
  }

  private safeInspect(value: unknown): string {
    try {
      return util.inspect(value, {
        depth: this.maxMetadataDepth,
        breakLength: Infinity,
        compact: true,
        maxArrayLength: 50,
        maxStringLength: this.maxMetadataStringLength,
        sorted: true,
      });
    } catch {
      return '[metadata: not serializable]';
    }
  }
}

class ContextualLogger implements Logger {
  constructor(
    private readonly base: LoggingModule,
    private readonly context: LogContext,
  ) {}

  debug(message: LogMessage, metadata?: LogMetadata): void {
    this.base.debug(message, this.mergeMetadata(metadata));
  }

  info(message: LogMessage, metadata?: LogMetadata): void {
    this.base.info(message, this.mergeMetadata(metadata));
  }

  warn(message: LogMessage, metadata?: LogMetadata): void {
    this.base.warn(message, this.mergeMetadata(metadata));
  }

  error(message: LogMessage, error?: Error | unknown | LogMetadata): void {
    if (error instanceof Error) {
      this.base.error(message, {
        ...this.context,
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack,
        },
      });
      return;
    }
    this.base.error(message, this.mergeMetadata(error));
  }

  throttle(
    level: LogLevel,
    key: string,
    message: LogMessage,
    metadata?: LogMetadata,
    intervalMs?: number,
  ): void {
    this.base.throttle?.(
      level,
      key,
      message,
      this.mergeMetadata(metadata),
      intervalMs,
    );
  }

  withContext(context: LogContext): Logger {
    return new ContextualLogger(this.base, { ...this.context, ...context });
  }

  startTimer(
    level: LogLevel,
    message: LogMessage,
    metadata?: LogMetadata,
  ): () => void {
    return this.base.startTimer(level, message, this.mergeMetadata(metadata));
  }

  dispose(): void {
    this.base.dispose();
  }

  private mergeMetadata(metadata?: LogMetadata): LogMetadata {
    const resolved = typeof metadata === 'function' ? metadata() : metadata;
    if (resolved === undefined) {
      return { ...this.context };
    }
    if (
      resolved &&
      typeof resolved === 'object' &&
      !(resolved instanceof Error)
    ) {
      return { ...resolved, ...this.context };
    }
    return { ...this.context, metadata: resolved };
  }
}

export function createAppLogger(
  context: vscode.ExtensionContext,
  options?: LoggingModuleOptions,
): LoggingModule {
  return LoggingModule.create(context, options);
}

export function startLoggedAction(
  logger: Logger,
  action: string,
  metadata?: LogMetadata,
): LoggedActionHandle {
  const startedAt = Date.now();
  logger.info(`Inicio de ${action}`, metadata);

  return {
    step(message: string, stepMetadata?: LogMetadata) {
      logger.debug(`[${action}] ${message}`, stepMetadata);
    },
    success(successMetadata?: LogMetadata) {
      logger.info(`Fin de ${action}`, {
        durationMs: Date.now() - startedAt,
        ...toStructuredLogMetadata(successMetadata),
      });
    },
    fail(error: unknown, failMetadata?: LogMetadata) {
      logger.error(`Error en ${action}`, {
        durationMs: Date.now() - startedAt,
        ...toStructuredLogMetadata(failMetadata),
        error,
      });
    },
  };
}

export async function runLoggedAction<T>(
  logger: Logger,
  action: string,
  work: (handle: LoggedActionHandle) => T | Promise<T>,
  metadata?: LogMetadata,
): Promise<T> {
  const handle = startLoggedAction(logger, action, metadata);
  try {
    const result = await work(handle);
    handle.success();
    return result;
  } catch (error) {
    handle.fail(error);
    throw error;
  }
}

function toStructuredLogMetadata(metadata: unknown): Record<string, unknown> {
  if (metadata === undefined) {
    return {};
  }

  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    !(metadata instanceof Error)
  ) {
    return metadata as Record<string, unknown>;
  }

  return { metadata };
}
