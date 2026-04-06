import * as vscode from 'vscode';

import { LogContext, LogMessage, LogMetadata, Logger } from '../logging/logger';

export class VsCodeLogger implements Logger {
  private readonly channel: vscode.OutputChannel;
  private readonly context?: LogContext;

  constructor(channelNameOrChannel: string | vscode.OutputChannel, context?: LogContext) {
    this.channel =
      typeof channelNameOrChannel === 'string'
        ? vscode.window.createOutputChannel(channelNameOrChannel)
        : channelNameOrChannel;
    this.context = context;
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
    this.write('error', message, error);
  }

  withContext(context: LogContext): Logger {
    return new VsCodeLogger(this.channel, {
      ...(this.context ?? {}),
      ...context,
    });
  }

  dispose(): void {
    this.channel.dispose();
  }

  private resolveMessage(message: LogMessage): string {
    return typeof message === 'function' ? message() : message;
  }

  private write(
    level: 'debug' | 'info' | 'warn' | 'error',
    message: LogMessage,
    metadata?: LogMetadata,
  ): void {
    const parts = [`[${level}]`];
    const scope = this.context?.scope;

    if (scope) {
      parts.push(`[${scope}]`);
    }

    parts.push(this.resolveMessage(message));

    const resolvedMetadata =
      typeof metadata === 'function' ? metadata() : metadata;
    if (resolvedMetadata !== undefined) {
      parts.push(this.stringifyMetadata(resolvedMetadata));
    }

    this.channel.appendLine(parts.join(' '));
  }

  private stringifyMetadata(metadata: unknown): string {
    if (metadata instanceof Error) {
      return metadata.stack ?? metadata.message;
    }

    if (typeof metadata === 'string') {
      return metadata;
    }

    try {
      return JSON.stringify(metadata);
    } catch {
      return String(metadata);
    }
  }
}
