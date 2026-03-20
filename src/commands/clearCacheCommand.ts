import * as vscode from 'vscode';
import { Logger } from '../logging/logger';
import { t } from '../utils/l10n';
import { MRUService } from '../services/mruService';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { invalidateCollisionIndex } from '../utils/collisionUtils';

export function registerClearCacheCommand(
  context: vscode.ExtensionContext,
  logger: Logger,
  favoritesProvider: FavoritesTreeDataProvider,
  mruService: MRUService,
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.clearCache',
    async () => {
      logger.info('User requested to clear cache.');

      const confirm = await vscode.window.showWarningMessage(
        t(
          'Are you sure you want to clear AnFavorites caches? This will clear legacy data, search index caches, and reset internal states. Your current favorites and groups will NOT be deleted.',
        ),
        { modal: true },
        t('Clear Cache'),
      );

      if (confirm !== t('Clear Cache')) {
        return;
      }

      quickClear(context, logger, favoritesProvider, mruService);
    },
  );

  context.subscriptions.push(disposable);
}

export async function quickClear(
  context: vscode.ExtensionContext,
  logger: Logger,
  favoritesProvider: FavoritesTreeDataProvider,
  mruService: MRUService,
): Promise<void> {
  try {
    // 1. Clear legacy global and workspace states
    logger.debug('[cache] Clearing legacy stats (v1)...');
    await context.globalState.update('anfavorites.favorites', undefined);
    await context.globalState.update('anfavorites.mru', undefined);

    // Clear unused/old workspace states
    await context.workspaceState.update('anfavorites.favorites', undefined);
    await context.workspaceState.update('anfavorites.groups', undefined);
    await context.workspaceState.update('anfavorites.gitignore.filesState', undefined);

    // 2. Invalidate search patterns and collision caches
    logger.debug('[cache] Invalidating collision cache...');
    invalidateCollisionIndex(logger, 'user manually cleared cache');

    // 3. Re-read real configs
    logger.debug('[cache] Reloading providers from clean slate...');
    favoritesProvider.reloadFavorites();
    mruService.reloadRecentFiles();

    vscode.window.showInformationMessage(
      t('AnFavorites caches and legacy data cleared successfully.'),
    );
    logger.info('Cache cleared successfully.');
  } catch (error) {
    logger.error('Failed to clear cache.', error);
    vscode.window.showErrorMessage(t('Failed to clear cache.'));
  }
}
