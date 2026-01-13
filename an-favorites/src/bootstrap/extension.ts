import * as vscode from 'vscode';

import { createAppLogger } from '../logging/loggingModule';
import { registerHelloCommand } from '../commands/helloCommand';
import { registerWebviewCommand } from '../commands/webviewCommand';
import { loadSettings } from '../config/settings';
import { HelloService } from '../services/helloService';
import { TelemetryService } from '../services/telemetry';

export function activate(context: vscode.ExtensionContext): void {
  const logger = createAppLogger(context, {
    channelName: 'AnFavorites Logs',
    level: 'info',
    maxFileSizeBytes: 5 * 1024 * 1024,
  });

  // Asegurar que el canal se muestre en el panel de Output
  logger.show(false);

  const settings = loadSettings();
  const helloService = new HelloService();
  const telemetry = new TelemetryService();

  registerHelloCommand(context, helloService, logger, settings);
  registerWebviewCommand(context);

  telemetry.track('activated');
  logger.info('Extension activada');

  context.subscriptions.push({ dispose: () => logger.dispose?.() });
}

export function deactivate(): void {}
