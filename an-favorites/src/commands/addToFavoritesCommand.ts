import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';

export function registerAddToFavoritesCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.addToFavorites',
    async (uri?: vscode.Uri) => {
      // Si no se proporciona URI, usar el archivo activo
      const targetUri = uri || vscode.window.activeTextEditor?.document.uri;

      if (!targetUri) {
        vscode.window.showWarningMessage('No se seleccionó ningún archivo');
        return;
      }

      // Verificar si es un archivo (no una carpeta)
      try {
        const stat = await vscode.workspace.fs.stat(targetUri);
        if (stat.type === vscode.FileType.Directory) {
          vscode.window.showWarningMessage('No se pueden añadir carpetas a favoritos');
          return;
        }
      } catch (error) {
        vscode.window.showErrorMessage('Error al verificar el archivo');
        return;
      }

      if (favoritesProvider.hasFavorite(targetUri)) {
        vscode.window.showInformationMessage('El archivo ya está en favoritos');
        return;
      }

      favoritesProvider.addFavorite(targetUri);
      vscode.window.showInformationMessage(`Añadido a favoritos: ${targetUri.fsPath}`);
    }
  );

  context.subscriptions.push(disposable);
}
