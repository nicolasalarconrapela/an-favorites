import * as vscode from 'vscode';

import { createAppLogger } from '../logging/loggingModule';
import { registerHelloCommand } from '../commands/helloCommand';
import { registerWebviewCommand } from '../commands/webviewCommand';
import { registerShowLogsCommand } from '../commands/showLogsCommand';
import { registerAddToFavoritesCommand } from '../commands/addToFavoritesCommand';
import { registerRemoveFromFavoritesCommand } from '../commands/removeFromFavoritesCommand';
import { loadSettings } from '../config/settings';
import { HelloService } from '../services/helloService';
import { TelemetryService } from '../services/telemetry';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';

export function activate(context: vscode.ExtensionContext): void {
  const logger = createAppLogger(context, {
    channelName: 'AnFavorites Logs',
    level: 'info',
    maxFileSizeBytes: 5 * 1024 * 1024,
  });

  vscode.commands.executeCommand('workbench.action.output.show');
  logger.show(false);

  const settings = loadSettings();
  const helloService = new HelloService();
  const telemetry = new TelemetryService();

  // Registrar comandos existentes
  registerHelloCommand(context, helloService, logger, settings);
  registerWebviewCommand(context);
  registerShowLogsCommand(context);

  // Registrar el árbol de favoritos
  const favoritesProvider = new FavoritesTreeDataProvider(context);
  vscode.window.registerTreeDataProvider('anfavorites.favoritesView', favoritesProvider);

  // Registrar comandos de favoritos
  registerAddToFavoritesCommand(context, favoritesProvider);
  registerRemoveFromFavoritesCommand(context, favoritesProvider);

  telemetry.track('activated');
  logger.info('Extension activada');

  context.subscriptions.push({ dispose: () => logger.dispose?.() });
}

export function deactivate(): void {}
