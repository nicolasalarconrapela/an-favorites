import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { showGroupQuickPickWithCreate } from './groupQuickPick';

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

        const currentGroup =
          favoritesProvider.getGroupForFavorite(targetUri) ??
          FavoritesTreeDataProvider.DEFAULT_GROUP;
        const selectedGroup = await showGroupQuickPickWithCreate({
          groups: favoritesProvider.getGroups(),
          favoritesProvider,
          placeHolder: 'Selecciona el grupo donde añadir el favorito',
          title: 'Añadir a Grupo de Favoritos',
          activeItem: currentGroup,
        });

        if (!selectedGroup) {
          return;
        }

        if (favoritesProvider.hasFavorite(targetUri)) {
          favoritesProvider.moveFavorite(targetUri, selectedGroup);
        } else {
          favoritesProvider.addFavorite(targetUri, selectedGroup);
        }

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
