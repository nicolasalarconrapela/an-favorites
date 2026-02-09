import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { FavoriteItem } from '../views/FavoritesTreeDataProvider';

export function registerRemoveFromFavoritesCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any,
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.removeFromFavorites',
    async (item?: FavoriteItem, selectedItems?: FavoriteItem[]) => {
      const itemsToProcess = selectedItems || (item ? [item] : []);

      if (itemsToProcess.length === 0) {
        vscode.window.showWarningMessage(
          vscode.l10n.t('No item selected'),
        );
        logger.warn('removeFromFavorites called without items');
        return;
      }

      const count = itemsToProcess.length;
      if (count > 1) {
        const deleteAllLabel = vscode.l10n.t('Remove All');
        const confirm = await vscode.window.showWarningMessage(
          vscode.l10n.t(
            'Remove {0} favorites?',
            count,
          ),
          { modal: true },
          deleteAllLabel,
        );
        if (confirm !== deleteAllLabel) return;
      }

      for (const current of itemsToProcess) {
        if (current instanceof FavoriteItem) {
          logger.info(`Removing favorite: ${current.resourceUri.fsPath}`);
          favoritesProvider.removeFavorite(current.resourceUri);
        }
      }

      if (count === 1) {
        vscode.window.showInformationMessage(
          vscode.l10n.t(
            'Removed from favorites: {0}',
            itemsToProcess[0].resourceUri.fsPath,
          ),
        );
      } else {
        vscode.window.showInformationMessage(
          vscode.l10n.t(
            '{0} favorites removed.',
            count,
          ),
        );
      }
    },
  );

  context.subscriptions.push(disposable);
  logger.debug('removeFromFavorites command registered');
}
