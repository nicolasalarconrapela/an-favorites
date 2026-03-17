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
import { registerKeyboardShortcutCommand } from '../commands/keyboardShortcutCommand';
import { registerManageGitignoreCommand } from '../commands/manageGitignoreCommand';
import { registerClearCacheCommand } from '../commands/clearCacheCommand';
import { registerOpenReleaseChangesCommand } from '../commands/openReleaseChangesCommand';
import { TelemetryService } from '../services/telemetry';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { MRUService } from '../services/mruService';
import { SharedStorageService } from '../services/sharedStorageService';
import {
  disposeCollisionIndex,
  invalidateCollisionIndex,
} from '../utils/collisionUtils';
import {
  disposeGitignoreService,
  initGitignoreSync,
  onGitignoreDiscoveryChange,
} from '../utils/gitignoreService';
import { initializeL10n, t } from '../utils/l10n';

export function activate(context: vscode.ExtensionContext): void {
  initializeL10n(context);
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
    channelName: t('AnFavorites Logs'),
    level: logLevel,
    maxFileSizeBytes: 5 * 1024 * 1024,
    maxRotatedFiles,
  });

  logger.debug('━━━ Extension activation started ━━━');

  const sharedStorage = new SharedStorageService(context, logger);
  const telemetry = new TelemetryService();
  const mruService = new MRUService(context, logger);

  logger.debug('Registering favorites tree provider...');

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

  logger.debug('Registering favorites commands...');

  registerAddToFavoritesCommand(context, favoritesProvider, logger);
  registerAddToFavoritesInGroupCommand(context, favoritesProvider, logger);
  registerRemoveFromFavoritesCommand(context, favoritesProvider, logger);

  registerManageGroupsCommands(context, favoritesProvider, logger);
  registerPinCommands(context, favoritesProvider, logger);
  registerOpenToSideCommand(context, logger);
  registerKeyboardShortcutCommand(context, logger);
  registerManageGitignoreCommand(context);
  registerClearCacheCommand(context, logger, favoritesProvider, mruService);
  registerOpenReleaseChangesCommand(context);
  logger.debug('[activate] registering quickOpen...');
  registerQuickOpenCommand(context, favoritesProvider, logger, mruService);
  logger.debug('[activate] quickOpen registered.');

  // Register Get Started command
  context.subscriptions.push(
    vscode.commands.registerCommand('anfavorites.getStarted', () => {
      vscode.commands.executeCommand(
        'workbench.action.openWalkthrough',
        'anappwilos.an-favorites#anfavorites.getStarted',
        false,
      );
    }),
  );

  // Enforce mutual exclusivity for openToSide and openInNewWindow
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('anfavorites.logging.level')) {
        const newLevel = vscode.workspace
          .getConfiguration('anfavorites.logging')
          .get<LogLevel>('level', 'info');
        logger.setLevel(newLevel);
      } else if (
        e.affectsConfiguration('anfavorites.quickOpen.actions.openToSide')
      ) {
        const config = vscode.workspace.getConfiguration(
          'anfavorites.quickOpen',
        );
        const openToSide = config.get<boolean>('actions.openToSide', false);
        if (openToSide) {
          await config.update(
            'actions.openInNewWindow',
            false,
            vscode.ConfigurationTarget.Global,
          );
        }
      } else if (
        e.affectsConfiguration('anfavorites.quickOpen.actions.openInNewWindow')
      ) {
        const config = vscode.workspace.getConfiguration(
          'anfavorites.quickOpen',
        );
        const openInNewWindow = config.get<boolean>(
          'actions.openInNewWindow',
          false,
        );
        if (openInNewWindow) {
          await config.update(
            'actions.openToSide',
            false,
            vscode.ConfigurationTarget.Global,
          );
        }
      }
    }),
  );

  telemetry.track('activated');
  logger.debug('━━━ Extension activation completed successfully ━━━');

  // Check for new version and show notification
  void checkReleaseUpdate(context, logger);

  // Sync .gitignore patterns into workspace settings in the background
  void initGitignoreSync(context, logger);
  onGitignoreDiscoveryChange(() => {
    logger?.info?.(
      '[gitignore] Discovery changed -> invalidating collision index',
    );
    invalidateCollisionIndex(logger, 'gitignore changed');
  });

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
    const targetPaths = new Set([...favoritePaths, ...recentPaths]);

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
  context.subscriptions.push({ dispose: () => disposeGitignoreService() });
  context.subscriptions.push({ dispose: () => logger.dispose?.() });
}

export function deactivate(): void {}

const RELEASE_NOTICE_DELAY_MS = 4000;

/**
 * Comprueba si la versi\u00f3n actual de la extensi\u00f3n es distinta a la \u00faltima que vio el usuario.
 * Si es as\u00ed, muestra una notificaci\u00f3n para ver los cambios.
 */
async function checkReleaseUpdate(
  context: vscode.ExtensionContext,
  logger: any,
): Promise<void> {
  const currentVersion = context.extension.packageJSON.version;
  const lastSeenVersion = context.globalState.get<string>(
    'anfavorites.lastSeenVersion',
  );

  if (lastSeenVersion !== currentVersion) {
    logger.info(
      `[ReleaseNotice] Nueva versi\u00f3n detectada: ${currentVersion} (anterior: ${lastSeenVersion})`,
    );

    const btnTitle = t('Ver Notas de Lanzamiento');
    const message = t(
      'AnFavorites se ha actualizado a la v{0}. \u00bfQuieres ver las novedades?',
      currentVersion,
    );

    await new Promise<void>((resolve) => {
      setTimeout(resolve, RELEASE_NOTICE_DELAY_MS);
    });

    try {
      const selection = await vscode.window.showInformationMessage(
        message,
        btnTitle,
      );

      if (selection === btnTitle) {
        await vscode.commands.executeCommand('anfavorites.openReleaseChanges');
      }

      await context.globalState.update(
        'anfavorites.lastSeenVersion',
        currentVersion,
      );
    } catch (error) {
      logger.warn(
        `[ReleaseNotice] No se pudo mostrar la notificaci\u00f3n de la versi\u00f3n ${currentVersion}`,
        error,
      );
    }
  }
}
