import * as vscode from 'vscode';

import { Logger } from '../logging/logger';

export class VsCodeLogger implements Logger {
  private readonly channel: vscode.OutputChannel;

  constructor(channelName: string) {
    this.channel = vscode.window.createOutputChannel(channelName);
  }

  debug(message: string): void {
    this.channel.appendLine(`[debug] ${message}`);
  }

  info(message: string): void {
    this.channel.appendLine(`[info] ${message}`);
  }

  warn(message: string): void {
    this.channel.appendLine(`[warn] ${message}`);
  }

  error(message: string, error?: Error): void {
    this.channel.appendLine(`[error] ${message}`);
    if (error) {
      this.channel.appendLine(error.stack ?? error.message);
    }
  }

  dispose(): void {
    this.channel.dispose();
  }
}

