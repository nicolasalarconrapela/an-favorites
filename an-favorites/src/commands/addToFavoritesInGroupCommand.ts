import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';

export function registerAddToFavoritesInGroupCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any,
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.addToFavoritesInGroup',
    async (uri?: vscode.Uri) => {
      try {
        logger.debug('addToFavoritesInGroup command triggered', {
          uri: uri?.fsPath,
        });


        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;

        if (!targetUri) {
          vscode.window.showWarningMessage('No se seleccionó ningún archivo');
          logger.warn('No URI provided for addToFavoritesInGroup');
          return;
        }

        logger.debug(`Target URI: ${targetUri.fsPath}`);


        try {
          const stat = await vscode.workspace.fs.stat(targetUri);
          if (stat.type === vscode.FileType.Directory) {
            vscode.window.showWarningMessage(
              'No se pueden añadir carpetas a favoritos',
            );
            logger.warn('Attempted to add directory to favorits');
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


        const groups = favoritesProvider.getGroups();
        if (groups.length === 0) {

          favoritesProvider.addFavorite(targetUri);
          return;
        }


        const selectedGroup = await vscode.window.showQuickPick(groups, {
          placeHolder: 'Selecciona el grupo donde añadir el favorito',
          title: 'Añadir a Grupo de Favoritos',
        });

        if (!selectedGroup) {

          return;
        }

        logger.info(
          `Adding favorite directly to group "${selectedGroup}": ${targetUri.fsPath}`,
        );
        favoritesProvider.addFavorite(targetUri, selectedGroup);

        vscode.window.showInformationMessage(
          `Añadido a favoritos en "${selectedGroup}": ${targetUri.fsPath}`,
        );
        logger.info('Favorite added successfully');
      } catch (error) {
        logger.error('Unexpected error in addToFavoritesInGroup', error);
        vscode.window.showErrorMessage(`Error al añadir favorito: ${error}`);
      }
    },
  );

  context.subscriptions.push(disposable);
  logger.debug('addToFavoritesInGroup command registered');
}
