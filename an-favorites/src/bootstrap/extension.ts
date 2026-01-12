import * as vscode from 'vscode';

import { VsCodeLogger } from '../adapters/vscodeLogger';
import { registerHelloCommand } from '../commands/helloCommand';
import { registerWebviewCommand } from '../commands/webviewCommand';
import { loadSettings } from '../config/settings';
import { HelloService } from '../services/helloService';
import { TelemetryService } from '../services/telemetry';

export function activate(context: vscode.ExtensionContext): void {
  const logger = new VsCodeLogger('AnFavorites');
  const settings = loadSettings();
  const helloService = new HelloService();
  const telemetry = new TelemetryService();

  registerHelloCommand(context, helloService, logger, settings);
  registerWebviewCommand(context);

  telemetry.track('activated');
  logger.info('Extension activada');
}

export function deactivate(): void {}
