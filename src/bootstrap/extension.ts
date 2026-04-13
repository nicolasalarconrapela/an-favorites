import * as vscode from 'vscode';
import * as path from 'path';
import { createAppLogger, startLoggedAction } from '../logging/loggingModule';
import { LogLevel, Logger } from '../logging/logger';

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
import { registerCommandFavoritesCommands } from '../commands/commandFavoritesCommands';
import { MRUService } from '../services/mruService';
import { SharedStorageService } from '../services/sharedStorageService';
import {
  disposeCollisionIndex,
  invalidateCollisionIndex,
} from '../utils/collisionUtils';
import {
  disposeGitignoreService,
  initGitignoreSync,
  subscribeGitignoreDiscoveryChange,
  subscribeGitignoreRulesChange,
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
    ['trace', 'debug', 'info', 'warn', 'error'].includes(configuredLevel)
      ? configuredLevel
      : 'info';
  const maxRotatedFiles = loggingConfig.get<number>('maxRotatedFiles', 5);

  const logger = createAppLogger(context, {
    channelName: t('AnFavorites'),
    level: logLevel,
    maxFileSizeBytes: 5 * 1024 * 1024,
    maxRotatedFiles,
  });
  registerProcessFaultTracing(context, logger);
  const activationTrace = startLoggedAction(logger, 'activacion de extension', {
    version: context.extension.packageJSON.version,
  });
  logRuntimeSnapshot(logger, 'activate:logger-ready', {
    workspaceFolderCount: vscode.workspace.workspaceFolders?.length ?? 0,
    windowName: getCurrentWindowLabel(),
    logLevel,
  });

  logger.debug('━━━ Extension activation started ━━━');

  const sharedStorage = new SharedStorageService(context, logger);
  const telemetry = new TelemetryService();
  const mruService = new MRUService(context, logger);
  activationTrace.step('servicios base creados');

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
    showCollapseAll: false,
  });

  context.subscriptions.push(treeView);
  activationTrace.step('tree view registrada');

  let treeExpanded = true;
  void vscode.commands.executeCommand(
    'setContext',
    'anfavorites.treeExpanded',
    treeExpanded,
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('anfavorites.toggleTreeExpansion', async () => {
      if (treeExpanded) {
        await vscode.commands.executeCommand(
          'workbench.actions.treeView.anfavorites.favoritesView.collapseAll',
        );
        treeExpanded = false;
        await vscode.commands.executeCommand(
          'setContext',
          'anfavorites.treeExpanded',
          treeExpanded,
        );
        return;
      }

      await vscode.commands.executeCommand('anfavorites.favoritesView.focus');
      const rootItems = await favoritesProvider.getChildren();
      for (const rootItem of rootItems) {
        await treeView.reveal(rootItem, {
          expand: 1,
          focus: false,
          select: false,
        });
      }
      treeExpanded = true;
      await vscode.commands.executeCommand(
        'setContext',
        'anfavorites.treeExpanded',
        treeExpanded,
      );
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('anfavorites.toggleTreeExpansionExpand', async () => {
      await vscode.commands.executeCommand('anfavorites.toggleTreeExpansion');
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('anfavorites.toggleTreeExpansionCollapse', async () => {
      await vscode.commands.executeCommand('anfavorites.toggleTreeExpansion');
    }),
  );

  logger.debug('Registering favorites commands...');

  registerAddToFavoritesCommand(context, favoritesProvider, treeView, logger);
  registerAddToFavoritesInGroupCommand(
    context,
    favoritesProvider,
    treeView,
    logger,
  );
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
  activationTrace.step('comandos registrados');

  registerCommandFavoritesCommands(context, favoritesProvider, logger);
  logger.debug('[activate] commandFavorites commands registered.');

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
  activationTrace.success();

  // Check for new version and show notification
  void checkReleaseUpdate(context, logger);

  // Delay the .gitignore scan so startup-critical work finishes first.
  let gitignoreInitTimer: NodeJS.Timeout | undefined;
  let gitignoreInitStarted = false;
  const startGitignoreSync = (): void => {
    if (gitignoreInitStarted) {
      logger.debug('[activate] Deferred .gitignore sync already in progress');
      return;
    }

    if ((vscode.workspace.workspaceFolders ?? []).length === 0) {
      logger.debug(
        '[activate] Deferred .gitignore sync skipped for now: no workspace folders yet',
      );
      return;
    }

    gitignoreInitStarted = true;
    logger.debug('[activate] Starting deferred .gitignore sync');
    logRuntimeSnapshot(logger, 'activate:gitignore-sync-start');
    void initGitignoreSync(context, logger)
      .catch((error) => {
        logger.warn('[activate] Deferred .gitignore sync failed', error);
        logRuntimeSnapshot(logger, 'activate:gitignore-sync-failed', { error });
      })
      .finally(() => {
        gitignoreInitStarted = false;
      });
  };
  context.subscriptions.push(
    subscribeGitignoreDiscoveryChange(() => {
      try {
        logger?.info?.(
          '[gitignore] Discovery changed -> invalidating collision index',
        );
        invalidateCollisionIndex(logger, 'gitignore changed');
      } catch (error) {
        logger.error(
          '[activate] Crash while handling gitignore discovery change',
          error,
        );
        logRuntimeSnapshot(logger, 'activate:gitignore-discovery-crash', {
          error,
        });
      }
    }),
  );
  context.subscriptions.push(
    subscribeGitignoreRulesChange(() => {
      try {
        logger?.info?.(
          '[gitignore] Rules changed -> invalidating collision index',
        );
        invalidateCollisionIndex(logger, 'gitignore rules changed');
      } catch (error) {
        logger.error(
          '[activate] Crash while handling gitignore rules change',
          error,
        );
        logRuntimeSnapshot(logger, 'activate:gitignore-rules-crash', {
          error,
        });
      }
    }),
  );
  gitignoreInitTimer = setTimeout(() => {
    gitignoreInitTimer = undefined;
    logger.debug(
      `[activate] Deferred .gitignore sync timer elapsed after ${GITIGNORE_INIT_DELAY_MS}ms`,
    );
    startGitignoreSync();
  }, GITIGNORE_INIT_DELAY_MS);
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      startGitignoreSync();
    }),
  );

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

    try {
      await Promise.all([
        favoritesProvider.validateFavoritesForPaths(paths),
        mruService.validateFilesForPaths(paths),
      ]);
    } catch (error) {
      logger.error('[watcher] Failed while flushing path validations', {
        pathCount: paths.length,
        samplePaths: paths.slice(0, 10),
        error,
      });
      logRuntimeSnapshot(logger, 'activate:flush-validations-failed', {
        pathCount: paths.length,
        error,
      });
    }
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
    logger.throttle?.(
      'debug',
      'watcher:sync-summary',
      '[watcher] Synchronizing file watchers',
      {
        targetPathCount: targetPaths.size,
        currentWatcherCount: watchedPaths.size,
      },
      2000,
    );

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
      try {
        syncFileWatchers();
      } catch (error) {
        logger.error('[watcher] syncFileWatchers crashed', error);
        logRuntimeSnapshot(logger, 'activate:watcher-sync-crash', { error });
      }
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
    try {
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
    } catch (error) {
      logger.error('[watcher] Rename handler crashed', {
        fileCount: event.files.length,
        error,
      });
      logRuntimeSnapshot(logger, 'activate:rename-handler-crash', {
        fileCount: event.files.length,
        error,
      });
    }
  });

  context.subscriptions.push(renameListener);
  context.subscriptions.push({
    dispose: () => {
      if (gitignoreInitTimer) {
        clearTimeout(gitignoreInitTimer);
      }
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

function registerProcessFaultTracing(
  context: vscode.ExtensionContext,
  logger: Logger,
): void {
  const onUnhandledRejection = (reason: unknown) => {
    logger.error('[fatal] Unhandled promise rejection in extension host', {
      reason,
    });
    logRuntimeSnapshot(logger, 'fatal:unhandled-rejection', { reason });
  };

  const onUncaughtException = (error: Error) => {
    logger.error('[fatal] Uncaught exception in extension host', error);
    logRuntimeSnapshot(logger, 'fatal:uncaught-exception', { error });
  };

  process.on('unhandledRejection', onUnhandledRejection);
  process.on('uncaughtException', onUncaughtException);

  context.subscriptions.push({
    dispose: () => {
      process.off('unhandledRejection', onUnhandledRejection);
      process.off('uncaughtException', onUncaughtException);
    },
  });
}

function logRuntimeSnapshot(
  logger: Logger,
  reason: string,
  metadata?: Record<string, unknown>,
): void {
  const memory = process.memoryUsage();
  logger.info('[trace] Runtime snapshot', {
    reason,
    rssBytes: memory.rss,
    heapTotalBytes: memory.heapTotal,
    heapUsedBytes: memory.heapUsed,
    externalBytes: memory.external,
    arrayBuffersBytes: memory.arrayBuffers,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    ...metadata,
  });
}

function getCurrentWindowLabel(): string {
  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile) {
    return path.basename(workspaceFile.fsPath);
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return 'no-workspace';
  }

  if (folders.length === 1) {
    return folders[0].name;
  }

  return folders.map((folder) => folder.name).join(', ');
}

const RELEASE_NOTICE_DELAY_MS = 4000;
const GITIGNORE_INIT_DELAY_MS = 750;
const RELEASE_NOTICE_LAST_SEEN_VERSION_KEY = 'anfavorites.lastSeenVersion';
const RELEASE_NOTICE_PREFERENCE_CONFIG_KEY =
  'releaseNotifications.preference';

type ReleaseNoticePreference = 'show' | 'skip' | 'never';

/**
 * Comprueba si la versi\u00f3n actual de la extensi\u00f3n es distinta a la \u00faltima que vio el usuario.
 * Si es as\u00ed, muestra una notificaci\u00f3n para ver los cambios.
 */
async function checkReleaseUpdate(
  context: vscode.ExtensionContext,
  logger: Logger,
): Promise<void> {
  const currentVersion = context.extension.packageJSON.version;
  const lastSeenVersion = context.globalState.get<string>(
    RELEASE_NOTICE_LAST_SEEN_VERSION_KEY,
  );
  const releaseNoticePreference = vscode.workspace
    .getConfiguration('anfavorites')
    .get<ReleaseNoticePreference>(
      RELEASE_NOTICE_PREFERENCE_CONFIG_KEY,
      'show',
    );

  if (!lastSeenVersion) {
    logger.info(
      `[ReleaseNotice] Primera instalación detectada. Guardando versión actual sin mostrar notificación: ${currentVersion}`,
    );
    await context.globalState.update(
      RELEASE_NOTICE_LAST_SEEN_VERSION_KEY,
      currentVersion,
    );
    return;
  }

  if (releaseNoticePreference === 'never') {
    logger.info(
      `[ReleaseNotice] Notificaciones deshabilitadas desde configuración. Guardando versión actual sin mostrar notificación: ${currentVersion}`,
    );
    if (lastSeenVersion !== currentVersion) {
      await context.globalState.update(
        RELEASE_NOTICE_LAST_SEEN_VERSION_KEY,
        currentVersion,
      );
    }
    return;
  }

  if (releaseNoticePreference === 'skip') {
    logger.info(
      `[ReleaseNotice] Notificación omitida por configuración para la versión ${currentVersion}.`,
    );
    if (lastSeenVersion !== currentVersion) {
      await context.globalState.update(
        RELEASE_NOTICE_LAST_SEEN_VERSION_KEY,
        currentVersion,
      );
    }
    await vscode.workspace
      .getConfiguration('anfavorites')
      .update(
        RELEASE_NOTICE_PREFERENCE_CONFIG_KEY,
        'show',
        vscode.ConfigurationTarget.Global,
      );
    return;
  }

  if (lastSeenVersion !== currentVersion) {
    logger.info(
      `[ReleaseNotice] Nueva versi\u00f3n detectada: ${currentVersion} (anterior: ${lastSeenVersion})`,
    );

    const btnTitle = t('Ver Notas de Lanzamiento');
    const btnSkip = t('Skip');
    const btnLater = t('Más tarde');
    const btnNever = t('Nunca');
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
        btnSkip,
        btnLater,
        btnNever,
      );

      if (selection === btnTitle) {
        await vscode.commands.executeCommand('anfavorites.openReleaseChanges');
        await context.globalState.update(
          RELEASE_NOTICE_LAST_SEEN_VERSION_KEY,
          currentVersion,
        );
        return;
      }

      if (selection === btnSkip) {
        logger.info(
          `[ReleaseNotice] El usuario omitió la notificación de la versión ${currentVersion}.`,
        );
        await context.globalState.update(
          RELEASE_NOTICE_LAST_SEEN_VERSION_KEY,
          currentVersion,
        );
        return;
      }

      if (selection === btnNever) {
        await vscode.workspace
          .getConfiguration('anfavorites')
          .update(
            RELEASE_NOTICE_PREFERENCE_CONFIG_KEY,
            'never',
            vscode.ConfigurationTarget.Global,
          );
        logger.info(
          `[ReleaseNotice] El usuario deshabilitó permanentemente las notificaciones de novedades.`,
        );
        await context.globalState.update(
          RELEASE_NOTICE_LAST_SEEN_VERSION_KEY,
          currentVersion,
        );
        return;
      }

      if (selection === btnLater) {
        logger.info(
          `[ReleaseNotice] El usuario pospuso la notificación de la versión ${currentVersion}.`,
        );
        return;
      }

      logger.info(
        `[ReleaseNotice] Notificación cerrada sin selección para la versión ${currentVersion}.`,
      );
    } catch (error) {
      logger.warn(
        `[ReleaseNotice] No se pudo mostrar la notificaci\u00f3n de la versi\u00f3n ${currentVersion}`,
        error,
      );
    }

    return;
  }

  logger.debug(
    `[ReleaseNotice] Sin cambios de versión. current=${currentVersion}, lastSeen=${lastSeenVersion}`,
  );
}
