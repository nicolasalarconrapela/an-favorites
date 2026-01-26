import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';

export function registerAddToFavoritesCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any,
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.addToFavorites',
    async (uri?: vscode.Uri) => {
      try {
        logger.debug('addToFavorites command triggered', { uri: uri?.fsPath });

        // Si no se proporciona URI, usar el archivo activo
        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;

        if (!targetUri) {
          vscode.window.showWarningMessage('No se seleccionó ningún archivo');
          logger.warn('No URI provided for addToFavorites');
          return;
        }

        logger.debug(`Target URI: ${targetUri.fsPath}`);

        // Verificar si es un archivo (no una carpeta)
        try {
          const stat = await vscode.workspace.fs.stat(targetUri);
          if (stat.type === vscode.FileType.Directory) {
            vscode.window.showWarningMessage(
              'No se pueden añadir carpetas a favoritos',
            );
            logger.warn('Attempted to add directory to favorites');
            return;
          }
        } catch (error) {
          logger.error('Error checking file', error);
          vscode.window.showErrorMessage('Error al verificar el archivo');
          return;
        }

        if (favoritesProvider.hasFavorite(targetUri)) {
          vscode.window.showInformationMessage(
            'El archivo ya está en favoritos',
          );
          logger.info('File already in favorites');
          return;
        }

        // Por defecto, añadir a "Sin Grupo" (DEFAULT_GROUP)
        const groupName = FavoritesTreeDataProvider.DEFAULT_GROUP;

        logger.info(
          `Adding favorite directly to default group: ${targetUri.fsPath}`,
        );
        favoritesProvider.addFavorite(targetUri, groupName);

        vscode.window.showInformationMessage(
          `Añadido a favoritos en "${groupName}": ${targetUri.fsPath}`,
        );
        logger.info('Favorite added successfully');
      } catch (error) {
        logger.error('Unexpected error in addToFavorites', error);
        vscode.window.showErrorMessage(`Error al añadir favorito: ${error}`);
      }
    },
  );

  context.subscriptions.push(disposable);
  logger.debug('addToFavorites command registered');
}
