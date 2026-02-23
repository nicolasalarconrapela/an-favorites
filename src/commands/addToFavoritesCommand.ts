import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { t } from '../utils/l10n';

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

        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;

        if (!targetUri) {
          vscode.window.showWarningMessage(
            t('No file selected'),
          );
          logger.warn('No URI provided for addToFavorites');
          return;
        }

        logger.debug(`Target URI: ${targetUri.fsPath}`);

        try {
          const stat = await vscode.workspace.fs.stat(targetUri);
          if (stat.type === vscode.FileType.Directory) {
            vscode.window.showWarningMessage(
              t(
                'Folders cannot be added to favorites',
              ),
            );
            logger.warn('Attempted to add directory to favorites');
            return;
          }
        } catch (error) {
          logger.error('Error checking file', error);
          vscode.window.showErrorMessage(
            t('Error checking file'),
          );
          return;
        }

        if (favoritesProvider.hasFavorite(targetUri)) {
          vscode.window.showInformationMessage(
            t('File is already in favorites'),
          );
          logger.info('File already in favorites');
          return;
        }

        const groupName = FavoritesTreeDataProvider.DEFAULT_GROUP;
        const groupDisplayName =
          FavoritesTreeDataProvider.getGroupDisplayName(groupName);

        logger.info(
          `Adding favorite directly to default group: ${targetUri.fsPath}`,
        );
        favoritesProvider.addFavorite(targetUri, groupName);

        vscode.window.showInformationMessage(
          t(
            'Added to favorites in "{0}": {1}',
            groupDisplayName,
            targetUri.fsPath,
          ),
        );
        logger.info('Favorite added successfully');
      } catch (error) {
        logger.error('Unexpected error in addToFavorites', error);
        vscode.window.showErrorMessage(
          t('Error adding favorite: {0}', String(error)),
        );
      }
    },
  );

  context.subscriptions.push(disposable);
  logger.debug('addToFavorites command registered');
}
