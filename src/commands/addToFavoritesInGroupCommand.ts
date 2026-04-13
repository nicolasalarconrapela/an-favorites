import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { Logger } from '../logging/logger';
import { t } from '../utils/l10n';

type GroupQuickPickItem = vscode.QuickPickItem & { groupName: string };

export function registerAddToFavoritesInGroupCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  treeView: vscode.TreeView<any>,
  logger: Logger,
): void {
  const log =
    logger.withContext?.({ scope: 'AddToFavoritesInGroupCommand' }) ?? logger;
  const disposable = vscode.commands.registerCommand(
    'anfavorites.addToFavoritesInGroup',
    async (uri?: vscode.Uri) => {
      try {
        log.debug('Command triggered', {
          uri: uri?.fsPath,
        });

        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;

        if (!targetUri) {
          vscode.window.showWarningMessage(
            t('No file selected'),
          );
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
          vscode.window.showErrorMessage(
            t('Error checking file'),
          );
          return;
        }

        if (favoritesProvider.hasFavorite(targetUri)) {
          vscode.window.showInformationMessage(
            t('File is already in favorites'),
          );
          log.info('Skipped duplicate favorite', { filePath: targetUri.fsPath });
          return;
        }

        const groups = favoritesProvider.getGroups();
        if (groups.length === 0) {
          log.info('No groups available, falling back to default group', {
            filePath: targetUri.fsPath,
          });
          favoritesProvider.addFavorite(targetUri);
          return;
        }

        const quickPickTitle = t('Add to Favorites Group');
        const quickPickPlaceholder = t(
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
          log.debug('Group selection cancelled', { filePath: targetUri.fsPath });
          return;
        }

        const targetGroup = selectedGroup.groupName;

        log.info('Adding favorite to selected group', {
          filePath: targetUri.fsPath,
          groupName: targetGroup,
        });
        favoritesProvider.addFavorite(targetUri, targetGroup);
        await treeView.reveal(
          favoritesProvider.createCommandSectionItem('favorites'),
          {
            expand: 1,
            focus: false,
            select: false,
          },
        );
        await treeView.reveal(favoritesProvider.createGroupItem(targetGroup), {
          expand: 1,
          focus: false,
          select: false,
        });
        await treeView.reveal(
          favoritesProvider.createFavoriteItem(targetUri, targetGroup),
          {
            expand: false,
            focus: false,
            select: false,
          },
        );
        const targetGroupDisplayName =
          FavoritesTreeDataProvider.getGroupDisplayName(targetGroup);

        vscode.window.showInformationMessage(
          t(
            'Added to favorites in "{0}": {1}',
            targetGroupDisplayName,
            targetUri.fsPath,
          ),
        );
        log.info('Favorite added successfully', {
          filePath: targetUri.fsPath,
          groupName: targetGroup,
        });
      } catch (error) {
        log.error('Unexpected failure while adding favorite to group', error);
        vscode.window.showErrorMessage(
          t('Error adding favorite: {0}', String(error)),
        );
      }
    },
  );

  context.subscriptions.push(disposable);
  log.debug('Command registered');
}
