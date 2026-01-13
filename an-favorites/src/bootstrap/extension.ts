import * as vscode from 'vscode';
import { createAppLogger } from '../logging/loggingModule';
import { registerHelloCommand } from '../commands/helloCommand';
import { registerWebviewCommand } from '../commands/webviewCommand';
import { registerShowLogsCommand } from '../commands/showLogsCommand';
import { registerAddToFavoritesCommand } from '../commands/addToFavoritesCommand';
import { registerRemoveFromFavoritesCommand } from '../commands/removeFromFavoritesCommand';
import { registerManageCategoriesCommands } from '../commands/manageCategoriesCommand';
import { registerQuickOpenCommand } from '../commands/quickOpenCommand';
import { loadSettings } from '../config/settings';
import { HelloService } from '../services/helloService';
import { TelemetryService } from '../services/telemetry';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { MRUService } from '../services/mruService';

export function activate(context: vscode.ExtensionContext): void {
  const logger = createAppLogger(context, {
    channelName: 'AnFavorites Logs',
    level: 'debug',
    maxFileSizeBytes: 5 * 1024 * 1024,
  });

  logger.info('━━━ Extension activation started ━━━');
  logger.show(true);

  const settings = loadSettings();
  const helloService = new HelloService();
  const telemetry = new TelemetryService();
  const mruService = new MRUService(context);

  // Registrar comandos existentes
  registerHelloCommand(context, helloService, logger, settings);
  registerWebviewCommand(context);
  registerShowLogsCommand(context);

  logger.info('Registering favorites tree provider...');

  // Registrar el árbol de favoritos
  const favoritesProvider = new FavoritesTreeDataProvider(context);
  vscode.window.registerTreeDataProvider('anfavorites.favoritesView', favoritesProvider);

  logger.info('Registering favorites commands...');

  // Registrar comandos de favoritos con logger
  registerAddToFavoritesCommand(context, favoritesProvider, logger);
  registerRemoveFromFavoritesCommand(context, favoritesProvider, logger);
  registerManageCategoriesCommands(context, favoritesProvider, logger);
  registerQuickOpenCommand(context, favoritesProvider, logger, mruService);

  telemetry.track('activated');
  logger.info('━━━ Extension activation completed successfully ━━━');

  context.subscriptions.push({ dispose: () => logger.dispose?.() });
}

export function deactivate(): void {}
