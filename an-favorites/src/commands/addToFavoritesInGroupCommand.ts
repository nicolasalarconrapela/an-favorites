import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';

type GroupQuickPickItem = vscode.QuickPickItem & { groupName: string };

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
          vscode.window.showWarningMessage(
            vscode.l10n.t('No file selected'),
          );
          logger.warn('No URI provided for addToFavoritesInGroup');
          return;
        }

        logger.debug(`Target URI: ${targetUri.fsPath}`);

        try {
          const stat = await vscode.workspace.fs.stat(targetUri);
          if (stat.type === vscode.FileType.Directory) {
            vscode.window.showWarningMessage(
              vscode.l10n.t('Folders cannot be added to favorites'),
            );
            logger.warn('Attempted to add directory to favorits');
            return;
          }
        } catch (error) {
          logger.error('Error checking file', error);
          vscode.window.showErrorMessage(
            vscode.l10n.t('Error checking file'),
          );
          return;
        }

        if (favoritesProvider.hasFavorite(targetUri)) {
          vscode.window.showInformationMessage(
            vscode.l10n.t('File is already in favorites'),
          );
          logger.info('File already in favorites');
          return;
        }

        const groups = favoritesProvider.getGroups();
        if (groups.length === 0) {
          favoritesProvider.addFavorite(targetUri);
          return;
        }

        const quickPickTitle = vscode.l10n.t('Add to Favorites Group');
        const quickPickPlaceholder = vscode.l10n.t(
          'Select the group to add the favorite to',
        );

        const groupItems: GroupQuickPickItem[] = groups.map((group) => ({
          label: FavoritesTreeDataProvider.getGroupDisplayName(group),
          groupName: group,
        }));

        const selectedGroup = await vscode.window.showQuickPick<GroupQuickPickItem>(
          groupItems,
          {
          placeHolder: quickPickPlaceholder,
          title: quickPickTitle,
          },
        );

        if (!selectedGroup) {
          return;
        }

        const targetGroup = selectedGroup.groupName;

        logger.info(
          `Adding favorite directly to group "${targetGroup}": ${targetUri.fsPath}`,
        );
        favoritesProvider.addFavorite(targetUri, targetGroup);
        const targetGroupDisplayName =
          FavoritesTreeDataProvider.getGroupDisplayName(targetGroup);

        vscode.window.showInformationMessage(
          vscode.l10n.t(
            'Added to favorites in "{0}": {1}',
            targetGroupDisplayName,
            targetUri.fsPath,
          ),
        );
        logger.info('Favorite added successfully');
      } catch (error) {
        logger.error('Unexpected error in addToFavoritesInGroup', error);
        vscode.window.showErrorMessage(
          vscode.l10n.t('Error adding favorite: {0}', String(error)),
        );
      }
    },
  );

  context.subscriptions.push(disposable);
  logger.debug('addToFavoritesInGroup command registered');
}
