import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { FavoriteItem } from '../views/FavoritesTreeDataProvider';
import { Logger } from '../logging/logger';
import { t } from '../utils/l10n';

export function registerRemoveFromFavoritesCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: Logger,
): void {
  const log =
    logger.withContext?.({ scope: 'RemoveFromFavoritesCommand' }) ?? logger;
  const disposable = vscode.commands.registerCommand(
    'anfavorites.removeFromFavorites',
    async (item?: FavoriteItem, selectedItems?: FavoriteItem[]) => {
      const itemsToProcess = selectedItems || (item ? [item] : []);

      if (itemsToProcess.length === 0) {
        vscode.window.showWarningMessage(t('No item selected'));
        log.warn('Command invoked without favorite items');
        return;
      }

      const count = itemsToProcess.length;
      if (count > 1) {
        const deleteAllLabel = t('Remove All');
        const confirm = await vscode.window.showWarningMessage(
          t('Remove {0} favorites?', count),
          { modal: true },
          deleteAllLabel,
        );
        if (confirm !== deleteAllLabel) {
          log.debug('Bulk removal cancelled by user', { count });
          return;
        }
      }

      for (const current of itemsToProcess) {
        if (current instanceof FavoriteItem) {
          log.info('Removing favorite', {
            filePath: current.resourceUri.fsPath,
            groupName: current.group,
          });
          favoritesProvider.removeFavorite(current.resourceUri);
        }
      }

      if (count === 1) {
        vscode.window.showInformationMessage(
          t(
            'Removed from favorites: {0}',
            itemsToProcess[0].resourceUri.fsPath,
          ),
        );
      } else {
        vscode.window.showInformationMessage(
          t('{0} favorites removed.', count),
        );
      }
    },
  );

  context.subscriptions.push(disposable);
  log.debug('Command registered');
}
