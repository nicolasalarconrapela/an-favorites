import * as vscode from 'vscode';
import * as path from 'path';
import { createAppLogger } from '../logging/loggingModule';

import { registerAddToFavoritesCommand } from '../commands/addToFavoritesCommand';
import { registerRemoveFromFavoritesCommand } from '../commands/removeFromFavoritesCommand';
import { registerManageGroupsCommands } from '../commands/manageGroupsCommand';
import { registerOpenToSideCommand } from '../commands/openToSideCommand';
import { registerQuickOpenCommand } from '../commands/quickOpenCommand';
import { TelemetryService } from '../services/telemetry';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { MRUService } from '../services/mruService';
import { SharedStorageService } from '../services/sharedStorageService';

export function activate(context: vscode.ExtensionContext): void {
  const logger = createAppLogger(context, {
    channelName: 'AnFavorites Logs',
    level: 'debug',
    maxFileSizeBytes: 5 * 1024 * 1024,
  });

  logger.info('━━━ Extension activation started ━━━');
  logger.show(true);

  const sharedStorage = new SharedStorageService(logger);
  const telemetry = new TelemetryService();
  const mruService = new MRUService(context, logger);

  logger.info('Registering favorites tree provider...');

  // Registrar el árbol de favoritos
  const favoritesProvider = new FavoritesTreeDataProvider(
    context,
    logger,
    sharedStorage,
  );
  vscode.window.registerTreeDataProvider(
    'anfavorites.favoritesView',
    favoritesProvider,
  );

  logger.info('Registering favorites commands...');

  // Registrar comandos de favoritos con logger
  registerAddToFavoritesCommand(context, favoritesProvider, logger);
  registerRemoveFromFavoritesCommand(context, favoritesProvider, logger);
  registerManageGroupsCommands(context, favoritesProvider, logger);
  registerOpenToSideCommand(context, logger);
  logger.info('[activate] registering quickOpen...');
  registerQuickOpenCommand(context, favoritesProvider, logger, mruService);
  logger.info('[activate] quickOpen registered.');

  telemetry.track('activated');
  logger.info('━━━ Extension activation completed successfully ━━━');

  // Watch for file deletions to automatically clean up favorites and recent files
  const fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');

  fileWatcher.onDidDelete(async (uri) => {
    logger.debug(`File deleted: ${uri.fsPath}`);

    await Promise.all([
      favoritesProvider.validateFavorites(),
      mruService.validateFiles(),
    ]);

    logger.debug(`Validated lists after file deletion: ${uri.fsPath}`);
  });

  context.subscriptions.push(fileWatcher);

  // Watch for file renames/moves to update paths in favorites and recent files
  const renameListener = vscode.workspace.onDidRenameFiles(async (event) => {
    logger.debug(`Files renamed/moved: ${event.files.length} files`);

    for (const file of event.files) {
      const oldPath = file.oldUri.fsPath;
      const newPath = file.newUri.fsPath;

      // Check if the filename actually changed (not just moved)
      const oldName = path.basename(oldPath);
      const newName = path.basename(newPath);
      const nameChanged = oldName !== newName;

      logger.debug(
        `Updating path: ${oldPath} -> ${newPath} (name changed: ${nameChanged})`,
      );

      // Always update the paths in storage
      favoritesProvider.updatePath(oldPath, newPath);
      mruService.updatePath(oldPath, newPath);

      // If the name changed, we need to recalculate collision detection
      // The updatePath methods already fire refresh events, but this ensures
      // that the collision detection logic runs again for all affected items
      if (nameChanged) {
        logger.debug(
          `Filename changed: "${oldName}" -> "${newName}", collision detection will be recalculated`,
        );
      }
    }
  });

  context.subscriptions.push(renameListener);
  context.subscriptions.push({ dispose: () => sharedStorage.dispose() });
  context.subscriptions.push({ dispose: () => logger.dispose?.() });
}

export function deactivate(): void {}
