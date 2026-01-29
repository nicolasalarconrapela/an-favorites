import * as vscode from 'vscode';
import * as path from 'path';
import { createAppLogger } from '../logging/loggingModule';
import { LogLevel } from '../logging/logger';

import { registerAddToFavoritesCommand } from '../commands/addToFavoritesCommand';
import { registerAddToFavoritesInGroupCommand } from '../commands/addToFavoritesInGroupCommand';
import { registerRemoveFromFavoritesCommand } from '../commands/removeFromFavoritesCommand';
import { registerManageGroupsCommands } from '../commands/manageGroupsCommand';
import { registerPinCommands } from '../commands/pinCommands';
import { registerOpenToSideCommand } from '../commands/openToSideCommand';
import { registerQuickOpenCommand } from '../commands/quickOpenCommand';
import { registerAddLineFavoriteCommand } from '../commands/addLineFavoriteCommand';
import { TelemetryService } from '../services/telemetry';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { MRUService } from '../services/mruService';
import { SharedStorageService } from '../services/sharedStorageService';
import { disposeCollisionIndex } from '../utils/collisionUtils';
import { LineFavoritesDecoration } from '../views/lineFavoritesDecoration';

export function activate(context: vscode.ExtensionContext): void {
  const loggingConfig = vscode.workspace.getConfiguration(
    'anfavorites.logging',
  );
  const configuredLevel = loggingConfig.get<LogLevel>('level', 'info');
  const logLevel: LogLevel =
    configuredLevel &&
    ['debug', 'info', 'warn', 'error'].includes(configuredLevel)
      ? configuredLevel
      : 'info';
  const maxRotatedFiles = loggingConfig.get<number>('maxRotatedFiles', 5);

  const logger = createAppLogger(context, {
    channelName: 'AnFavorites Logs',
    level: logLevel,
    maxFileSizeBytes: 5 * 1024 * 1024,
    maxRotatedFiles,
  });

  logger.info('━━━ Extension activation started ━━━');
  logger.show(true);

  const sharedStorage = new SharedStorageService(context, logger);
  const telemetry = new TelemetryService();
  const mruService = new MRUService(context, logger);

  logger.info('Registering favorites tree provider...');

  const favoritesProvider = new FavoritesTreeDataProvider(
    context,
    logger,
    sharedStorage,
  );
  context.subscriptions.push(favoritesProvider);

  const treeView = vscode.window.createTreeView('anfavorites.favoritesView', {
    treeDataProvider: favoritesProvider,
    dragAndDropController: favoritesProvider,
    canSelectMany: true,
  });

  context.subscriptions.push(treeView);

  logger.info('Registering favorites commands...');

  registerAddToFavoritesCommand(context, favoritesProvider, logger);
  registerAddToFavoritesInGroupCommand(context, favoritesProvider, logger);
  registerRemoveFromFavoritesCommand(context, favoritesProvider, logger);

  registerManageGroupsCommands(context, favoritesProvider, logger);
  registerPinCommands(context, favoritesProvider, logger);
  registerOpenToSideCommand(context, logger);
  registerAddLineFavoriteCommand(context, favoritesProvider, logger);
  logger.info('[activate] registering quickOpen...');
  registerQuickOpenCommand(
    context,
    favoritesProvider,
    logger,
    mruService,
  );
  logger.info('[activate] quickOpen registered.');

  const lineFavoritesDecoration = new LineFavoritesDecoration(
    context,
    favoritesProvider,
    logger,
  );
  context.subscriptions.push(lineFavoritesDecoration);

  const updateLineFavoriteContext = (
    editor: vscode.TextEditor | undefined,
  ): void => {
    if (!editor || editor.document.uri.scheme !== 'file') {
      void vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExists',
        false,
      );
      return;
    }

    const line = editor.selection.active.line + 1;
    const exists = favoritesProvider.hasLineFavorite(
      editor.document.uri,
      line,
    );
    void vscode.commands.executeCommand(
      'setContext',
      'anfavorites.lineFavoriteExists',
      exists,
    );
  };

  updateLineFavoriteContext(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      updateLineFavoriteContext(editor);
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      updateLineFavoriteContext(event.textEditor);
    }),
    vscode.window.onDidChangeTextEditorVisibleRanges((event) => {
      updateLineFavoriteContext(event.textEditor);
    }),
    favoritesProvider.onDidChangeTreeData(() => {
      updateLineFavoriteContext(vscode.window.activeTextEditor);
    }),
  );

  telemetry.track('activated');
  logger.info('━━━ Extension activation completed successfully ━━━');

  const watchedPaths = new Map<string, vscode.FileSystemWatcher>();
  const pendingValidations = new Set<string>();
  let validationTimer: NodeJS.Timeout | undefined;
  let watcherSyncTimer: NodeJS.Timeout | undefined;

  const flushValidations = async (): Promise<void> => {
    const paths = Array.from(pendingValidations);
    pendingValidations.clear();
    validationTimer = undefined;

    if (paths.length === 0) {
      return;
    }

    logger.throttle?.(
      'debug',
      'watcher:file-deleted',
      `Files deleted (batch): ${paths.length}`,
      undefined,
      2000,
    ) ?? logger.debug(`Files deleted (batch): ${paths.length}`);

    await Promise.all([
      favoritesProvider.validateFavoritesForPaths(paths),
      mruService.validateFilesForPaths(paths),
      favoritesProvider.validateLineFavoritesForPaths(paths),
    ]);
  };

  const scheduleValidation = (fsPath: string): void => {
    pendingValidations.add(fsPath);
    if (validationTimer) {
      clearTimeout(validationTimer);
    }
    validationTimer = setTimeout(() => {
      void flushValidations();
    }, 300);
  };

  const createWatcherForPath = (
    fsPath: string,
  ): vscode.FileSystemWatcher | null => {
    const baseName = path.basename(fsPath);
    if (!baseName) {
      return null;
    }

    const pattern = new vscode.RelativePattern(path.dirname(fsPath), baseName);
    const watcher = vscode.workspace.createFileSystemWatcher(pattern);
    watcher.onDidDelete((uri) => scheduleValidation(uri.fsPath));
    return watcher;
  };

  const syncFileWatchers = (): void => {
    const favoritePaths = favoritesProvider.getFavoritePaths();
    const recentPaths = mruService.getRecentFiles();
    const lineFavoritePaths = favoritesProvider.getLineFavoritePaths();
    const targetPaths = new Set([
      ...favoritePaths,
      ...recentPaths,
      ...lineFavoritePaths,
    ]);

    for (const [fsPath, watcher] of watchedPaths) {
      if (!targetPaths.has(fsPath)) {
        watcher.dispose();
        watchedPaths.delete(fsPath);
      }
    }

    for (const fsPath of targetPaths) {
      if (watchedPaths.has(fsPath)) {
        continue;
      }

      const watcher = createWatcherForPath(fsPath);
      if (!watcher) {
        continue;
      }
      watchedPaths.set(fsPath, watcher);
      context.subscriptions.push(watcher);
    }
  };

  const scheduleWatcherSync = (): void => {
    if (watcherSyncTimer) {
      clearTimeout(watcherSyncTimer);
    }
    watcherSyncTimer = setTimeout(() => {
      watcherSyncTimer = undefined;
      syncFileWatchers();
    }, 200);
  };

  scheduleWatcherSync();

  context.subscriptions.push(
    favoritesProvider.onDidChangeTreeData(() => {
      scheduleWatcherSync();
    }),
  );
  context.subscriptions.push(
    mruService.onDidChangeRecentFiles(() => {
      scheduleWatcherSync();
    }),
  );

  const renameListener = vscode.workspace.onDidRenameFiles(async (event) => {
    logger.throttle?.(
      'debug',
      'watcher:file-renamed',
      `Files renamed/moved: ${event.files.length} files`,
      undefined,
      2000,
    ) ?? logger.debug(`Files renamed/moved: ${event.files.length} files`);

    for (const file of event.files) {
      const oldPath = file.oldUri.fsPath;
      const newPath = file.newUri.fsPath;

      const oldName = path.basename(oldPath);
      const newName = path.basename(newPath);
      const nameChanged = oldName !== newName;

      logger.debug(
        `Updating path: ${oldPath} -> ${newPath} (name changed: ${nameChanged})`,
      );

      favoritesProvider.updatePath(oldPath, newPath);
      mruService.updatePath(oldPath, newPath);
      favoritesProvider.updateLineFavoritePath(oldPath, newPath);

      if (nameChanged) {
        logger.debug(
          `Filename changed: "${oldName}" -> "${newName}", collision detection will be recalculated`,
        );
      }
    }
  });

  context.subscriptions.push(renameListener);
  context.subscriptions.push({
    dispose: () => {
      if (validationTimer) {
        clearTimeout(validationTimer);
      }
      if (watcherSyncTimer) {
        clearTimeout(watcherSyncTimer);
      }
      watchedPaths.forEach((watcher) => watcher.dispose());
      watchedPaths.clear();
    },
  });
  context.subscriptions.push({ dispose: () => sharedStorage.dispose() });
  context.subscriptions.push({ dispose: () => mruService.dispose() });
  context.subscriptions.push({ dispose: () => disposeCollisionIndex() });
  context.subscriptions.push({ dispose: () => logger.dispose?.() });
}

export function deactivate(): void {}
