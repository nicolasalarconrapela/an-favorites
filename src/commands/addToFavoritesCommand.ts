import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { Logger } from '../logging/logger';
import { t } from '../utils/l10n';

export function registerAddToFavoritesCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: Logger,
): void {
  const log = logger.withContext?.({ scope: 'AddToFavoritesCommand' }) ?? logger;
  const disposable = vscode.commands.registerCommand(
    'anfavorites.addToFavorites',
    async (uri?: vscode.Uri) => {
      try {
        log.debug('Command triggered', { uri: uri?.fsPath });

        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;

        if (!targetUri) {
          vscode.window.showWarningMessage(t('No file selected'));
          log.warn('Command aborted because no target URI was resolved');
          return;
        }

        log.debug('Resolved target URI', { filePath: targetUri.fsPath });

        try {
          const stat = await vscode.workspace.fs.stat(targetUri);
          if (stat.type === vscode.FileType.Directory) {
            vscode.window.showWarningMessage(
              t('Folders cannot be added to favorites'),
            );
            log.warn('Rejected directory favorite request', {
              filePath: targetUri.fsPath,
            });
            return;
          }
        } catch (error) {
          log.error('Failed to stat candidate favorite', {
            filePath: targetUri.fsPath,
            error,
          });
          vscode.window.showErrorMessage(t('Error checking file'));
          return;
        }

        if (favoritesProvider.hasFavorite(targetUri)) {
          vscode.window.showInformationMessage(
            t('File is already in favorites'),
          );
          log.debug('Skipped duplicate favorite', { filePath: targetUri.fsPath });
          return;
        }

        const groupName = FavoritesTreeDataProvider.DEFAULT_GROUP;
        const groupDisplayName =
          FavoritesTreeDataProvider.getGroupDisplayName(groupName);

        log.info('Adding favorite to default group', {
          filePath: targetUri.fsPath,
          groupName,
        });
        favoritesProvider.addFavorite(targetUri, groupName);

        vscode.window.showInformationMessage(
          t(
            'Added to favorites in "{0}": {1}',
            groupDisplayName,
            targetUri.fsPath,
          ),
        );
        log.info('Favorite added successfully', {
          filePath: targetUri.fsPath,
          groupName,
        });
      } catch (error) {
        log.error('Unexpected failure while adding favorite', error);
        vscode.window.showErrorMessage(
          t('Error adding favorite: {0}', String(error)),
        );
      }
    },
  );

  context.subscriptions.push(disposable);
  log.debug('Command registered');
}
