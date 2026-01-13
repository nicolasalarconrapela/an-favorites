import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { FavoriteItem } from '../views/FavoritesTreeDataProvider';

export function registerRemoveFromFavoritesCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.removeFromFavorites',
    async (item?: FavoriteItem) => {
      if (!item) {
        vscode.window.showWarningMessage('No se seleccionó ningún elemento');
        return;
      }

      favoritesProvider.removeFavorite(item.resourceUri);
      vscode.window.showInformationMessage(`Eliminado de favoritos: ${item.resourceUri.fsPath}`);
    }
  );

  context.subscriptions.push(disposable);
}
