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
    async (item?: FavoriteItem) => {
      if (!item) {
        vscode.window.showWarningMessage('No se seleccionó ningún elemento');
        logger.warn('removeFromFavorites called without item');
        return;
      }

      logger.info(`Removing favorite: ${item.resourceUri.fsPath}`);
      favoritesProvider.removeFavorite(item.resourceUri);
      vscode.window.showInformationMessage(`Eliminado de favoritos: ${item.resourceUri.fsPath}`);
    }
  );

  context.subscriptions.push(disposable);
  logger.debug('removeFromFavorites command registered');
}
