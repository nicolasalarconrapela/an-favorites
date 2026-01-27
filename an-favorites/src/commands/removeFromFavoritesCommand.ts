import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { FavoriteItem } from '../views/FavoritesTreeDataProvider';

export function registerRemoveFromFavoritesCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.removeFromFavorites',
    async (item?: FavoriteItem, selectedItems?: FavoriteItem[]) => {
      const itemsToProcess = selectedItems || (item ? [item] : []);

      if (itemsToProcess.length === 0) {
        vscode.window.showWarningMessage('No se seleccionó ningún elemento');
        logger.warn('removeFromFavorites called without items');
        return;
      }

      const count = itemsToProcess.length;
      if (count > 1) {
        const confirm = await vscode.window.showWarningMessage(
          `¿Eliminar ${count} elementos de favoritos?`,
          { modal: true },
          'Eliminar Todo'
        );
        if (confirm !== 'Eliminar Todo') return;
      }

      for (const current of itemsToProcess) {
        if (current instanceof FavoriteItem) {
          logger.info(`Removing favorite: ${current.resourceUri.fsPath}`);
          favoritesProvider.removeFavorite(current.resourceUri);
        }
      }

      if (count === 1) {
        vscode.window.showInformationMessage(`Eliminado de favoritos: ${itemsToProcess[0].resourceUri.fsPath}`);
      } else {
        vscode.window.showInformationMessage(`${count} elementos eliminados de favoritos.`);
      }
    }
  );

  context.subscriptions.push(disposable);
  logger.debug('removeFromFavorites command registered');
}
