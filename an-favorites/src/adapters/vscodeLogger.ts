import * as vscode from 'vscode';

import { LogContext, LogMessage, LogMetadata, Logger } from '../logging/logger';

export class VsCodeLogger implements Logger {
  private readonly channel: vscode.OutputChannel;

  constructor(channelName: string) {
    this.channel = vscode.window.createOutputChannel(channelName);
  }

  debug(message: LogMessage): void {
    this.channel.appendLine(`[debug] ${this.resolveMessage(message)}`);
  }

  info(message: LogMessage): void {
    this.channel.appendLine(`[info] ${this.resolveMessage(message)}`);
  }

  warn(message: LogMessage): void {
    this.channel.appendLine(`[warn] ${this.resolveMessage(message)}`);
  }

  error(message: LogMessage, error?: Error | unknown | LogMetadata): void {
    this.channel.appendLine(`[error] ${this.resolveMessage(message)}`);
    if (error) {
      const resolved = typeof error === 'function' ? error() : error;
      if (resolved instanceof Error) {
        this.channel.appendLine(resolved.stack ?? resolved.message);
      } else {
        this.channel.appendLine(String(resolved));
      }
    }
  }

  withContext(_context: LogContext): Logger {
    return this;
  }

  dispose(): void {
    this.channel.dispose();
  }

  private resolveMessage(message: LogMessage): string {
    return typeof message === 'function' ? message() : message;
  }
}
