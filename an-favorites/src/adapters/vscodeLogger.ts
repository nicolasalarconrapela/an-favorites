import * as vscode from 'vscode';

import { Logger } from '../logging/logger';

export class VsCodeLogger implements Logger {
  private readonly channel: vscode.OutputChannel;

  constructor(channelName: string) {
    this.channel = vscode.window.createOutputChannel(channelName);
  }

  info(message: string): void {
    this.channel.appendLine(`[info] ${message}`);
  }

  error(message: string, error?: Error): void {
    this.channel.appendLine(`[error] ${message}`);
    if (error) {
      this.channel.appendLine(error.stack ?? error.message);
    }
  }
}
