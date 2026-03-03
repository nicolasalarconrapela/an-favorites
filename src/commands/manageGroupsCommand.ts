import * as vscode from 'vscode';
import {
  FavoritesTreeDataProvider,
  GroupItem,
  FavoriteItem,
  CommandItem,
} from '../views/FavoritesTreeDataProvider';
import { t } from '../utils/l10n';

type GroupQuickPickItem = vscode.QuickPickItem & { groupName: string };
type MoveGroupQuickPickItem = vscode.QuickPickItem & {
  groupName?: string;
  isCreate?: boolean;
};

export function registerManageGroupsCommands(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('anfavorites.addGroup', async () => {
      const groupInput = await vscode.window.showInputBox({
        prompt: t(
          'New group name (you can create multiple separated by commas)',
        ),
        placeHolder: t('e.g. Projects, Documentation, G2'),
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return t('Name cannot be empty');
          }
          return null;
        },
      });

      if (groupInput) {
        const groupNames = groupInput
          .split(/[;,]/)
          .map((n) => n.trim())
          .filter((n) => n.length > 0);

        if (groupNames.length === 0) return;

        let createdCount = 0;
        let existingCount = 0;
        const lastCreatedGroupName =
          groupNames.length === 1 ? groupNames[0] : '';

        for (const name of groupNames) {
          logger.debug(`Adding new group: ${name}`);
          const success = favoritesProvider.addGroup(name);
          if (success) {
            createdCount++;
            logger.debug(`Group created successfully: ${name}`);
          } else {
            existingCount++;
            logger.warn(`Group already exists or failed: ${name}`);
          }
        }

        if (createdCount > 0) {
          if (groupNames.length === 1) {
            vscode.window.showInformationMessage(
              t('Group "{0}" created', lastCreatedGroupName),
            );
          } else {
            vscode.window.showInformationMessage(
              t('{0} groups created successfully.', createdCount),
            );
          }
        }

        if (existingCount > 0) {
          if (groupNames.length === 1) {
            vscode.window.showErrorMessage(t('This group already exists'));
          } else {
            vscode.window.showWarningMessage(
              t(
                '{0} groups already existed and were not created.',
                existingCount,
              ),
            );
          }
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.removeGroup',
      async (
        item?: GroupItem,
        selectedItems?: (GroupItem | FavoriteItem)[],
      ) => {
        let groupsToProcess: string[] = [];

        if (selectedItems && selectedItems.length > 0) {
          groupsToProcess = selectedItems
            .filter((i): i is GroupItem => i instanceof GroupItem)
            .map((g) => g.groupName);
        } else if (item && item instanceof GroupItem) {
          groupsToProcess = [item.groupName];
        }

        if (groupsToProcess.length === 0) {
          const groups = favoritesProvider
            .getGroups()
            .filter((grp) => grp !== FavoritesTreeDataProvider.DEFAULT_GROUP);
          if (groups.length === 0) {
            vscode.window.showInformationMessage(t('No groups to remove'));
            return;
          }

          const groupItems: GroupQuickPickItem[] = groups.map((group) => ({
            label: FavoritesTreeDataProvider.getGroupDisplayName(group),
            groupName: group,
          }));

          const selected = await vscode.window.showQuickPick(groupItems, {
            placeHolder: t('Select the group to remove'),
          });
          if (selected) {
            groupsToProcess = [selected.groupName];
          } else {
            return;
          }
        }

        groupsToProcess = groupsToProcess.filter(
          (g) => g !== FavoritesTreeDataProvider.DEFAULT_GROUP,
        );

        if (groupsToProcess.length === 0) return;

        const count = groupsToProcess.length;
        const deleteLabel = t('Remove');
        const defaultGroupDisplayName =
          FavoritesTreeDataProvider.getDefaultGroupLabel();
        const confirm = await vscode.window.showWarningMessage(
          count === 1
            ? t(
                'Remove group "{0}"? Favorites will be moved to "{1}"',
                FavoritesTreeDataProvider.getGroupDisplayName(
                  groupsToProcess[0],
                ),
                defaultGroupDisplayName,
              )
            : t(
                'Remove {0} selected groups? Favorites will be moved to "{1}"',
                count,
                defaultGroupDisplayName,
              ),
          { modal: true },
          deleteLabel,
        );

        if (confirm === deleteLabel) {
          for (const g of groupsToProcess) {
            logger.debug(`Removing group: ${g}`);
            favoritesProvider.removeGroup(g);
          }
          vscode.window.showInformationMessage(
            count === 1
              ? t(
                  'Group "{0}" removed',
                  FavoritesTreeDataProvider.getGroupDisplayName(
                    groupsToProcess[0],
                  ),
                )
              : t('{0} groups removed', count),
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.renameGroup',
      async (item?: GroupItem) => {
        let oldName: string | undefined;

        if (item && item instanceof GroupItem) {
          oldName = item.groupName;
        } else {
          const groups = favoritesProvider
            .getGroups()
            .filter((grp) => grp !== FavoritesTreeDataProvider.DEFAULT_GROUP);
          if (groups.length === 0) {
            vscode.window.showInformationMessage(t('No groups to rename'));
            return;
          }

          const groupItems: GroupQuickPickItem[] = groups.map((group) => ({
            label: FavoritesTreeDataProvider.getGroupDisplayName(group),
            groupName: group,
          }));

          const selected = await vscode.window.showQuickPick(groupItems, {
            placeHolder: t('Select the group to rename'),
          });
          oldName = selected?.groupName;
        }

        if (!oldName) {
          return;
        }

        if (oldName === FavoritesTreeDataProvider.DEFAULT_GROUP) {
          vscode.window.showWarningMessage(
            t('The default group cannot be renamed'),
          );
          return;
        }

        const newName = await vscode.window.showInputBox({
          prompt: t('New name for "{0}"', oldName),
          value: oldName,
          valueSelection: [0, oldName.length],
          title: t('Rename Group: {0}', oldName),
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return t('Name cannot be empty');
            }
            if (value.trim() === oldName) {
              return t('Name must be different');
            }
            // Allow merging: do not check if group exists
            return null;
          },
        });

        if (newName) {
          const trimmedNewName = newName.trim();
          logger.debug(
            `Renaming group from "${oldName}" to "${trimmedNewName}"`,
          );
          const success = favoritesProvider.renameGroup(
            oldName,
            trimmedNewName,
          );
          if (success) {
            vscode.window.showInformationMessage(
              t('Group renamed to "{0}"', newName),
            );
            logger.debug(`Group renamed successfully`);
          } else {
            vscode.window.showErrorMessage(t('Could not rename group'));
            logger.error(
              `Failed to rename group from "${oldName}" to "${trimmedNewName}"`,
            );
          }
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.moveFavorite',
      async (
        item?: FavoriteItem | CommandItem,
        selectedItems?: (FavoriteItem | CommandItem)[],
      ) => {
        const allItems = selectedItems || (item ? [item] : []);
        const favoriteItems = allItems.filter(
          (i): i is FavoriteItem => i instanceof FavoriteItem,
        );
        const commandItems = allItems.filter(
          (i): i is CommandItem => i instanceof CommandItem,
        );
        const totalItems = favoriteItems.length + commandItems.length;

        if (totalItems === 0) {
          vscode.window.showWarningMessage(t('Select a favorite to move'));
          return;
        }

        const groups = favoritesProvider.getGroups();

        const items: MoveGroupQuickPickItem[] = groups.map((grp) => ({
          label: FavoritesTreeDataProvider.getGroupDisplayName(grp),
          groupName: grp,
          description:
            grp === FavoritesTreeDataProvider.DEFAULT_GROUP
              ? t('Default group')
              : undefined,
        }));

        items.push({
          label: `$(add) ${t('New Group...')}`,
          description: t('Create a new group'),
          isCreate: true,
        });

        const currentGroupName =
          favoriteItems.length > 0
            ? favoriteItems[0].group
            : commandItems[0].data.group ||
              FavoritesTreeDataProvider.DEFAULT_GROUP;

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder:
            totalItems === 1
              ? t(
                  'Move from "{0}" to...',
                  FavoritesTreeDataProvider.getGroupDisplayName(
                    currentGroupName,
                  ),
                )
              : t('Move {0} items to...', totalItems),
        });

        if (!selected) {
          return;
        }

        let targetGroup: string;

        if (selected.isCreate) {
          const newGroupName = await vscode.window.showInputBox({
            prompt: t('New group name'),
            placeHolder: t('e.g. Projects, Documentation, etc.'),
            validateInput: (value) => {
              if (!value || value.trim().length === 0) {
                return t('Name cannot be empty');
              }
              if (groups.includes(value.trim())) {
                return t('This group already exists');
              }
              return null;
            },
          });

          if (!newGroupName) {
            return;
          }

          targetGroup = newGroupName.trim();
          favoritesProvider.addGroup(targetGroup);
        } else {
          targetGroup =
            selected.groupName ?? FavoritesTreeDataProvider.DEFAULT_GROUP;
        }

        const targetGroupDisplayName =
          FavoritesTreeDataProvider.getGroupDisplayName(targetGroup);

        for (const f of favoriteItems) {
          logger.debug(
            `Moving favorite ${f.resourceUri.fsPath} to group "${targetGroup}"`,
          );
          favoritesProvider.moveFavorite(f.resourceUri, targetGroup);
        }

        for (const c of commandItems) {
          logger.debug(
            `Moving command "${c.data.label}" to group "${targetGroup}"`,
          );
          favoritesProvider.moveCommand(c.data.id, targetGroup);
        }

        vscode.window.showInformationMessage(
          totalItems === 1
            ? t('Favorite moved to "{0}"', targetGroupDisplayName)
            : t(
                '{0} favorites moved to "{1}"',
                totalItems,
                targetGroupDisplayName,
              ),
        );
        logger.debug(`Favorite(s) moved successfully`);
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.clearGroup',
      async (item?: GroupItem) => {
        if (!item || !(item instanceof GroupItem)) {
          return;
        }

        const clearGroupLabel = t('Clear Group');
        const defaultGroupDisplayName =
          FavoritesTreeDataProvider.getDefaultGroupLabel();
        const confirm = await vscode.window.showWarningMessage(
          t(
            'Move all favorites from "{0}" to "{1}"?',
            FavoritesTreeDataProvider.getGroupDisplayName(item.groupName),
            defaultGroupDisplayName,
          ),
          { modal: true },
          clearGroupLabel,
        );

        if (confirm === clearGroupLabel) {
          logger.debug(`Clearing group: ${item.groupName}`);
          favoritesProvider.clearGroupItems(item.groupName);
          vscode.window.showInformationMessage(
            t(
              'Group "{0}" cleared',
              FavoritesTreeDataProvider.getGroupDisplayName(item.groupName),
            ),
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.removeFromGroup',
      async (
        item?: FavoriteItem | CommandItem,
        selectedItems?: (FavoriteItem | CommandItem)[],
      ) => {
        const allItems = selectedItems || (item ? [item] : []);
        const favoriteItems = allItems.filter(
          (i): i is FavoriteItem => i instanceof FavoriteItem,
        );
        const commandItems = allItems.filter(
          (i): i is CommandItem => i instanceof CommandItem,
        );
        const totalItems = favoriteItems.length + commandItems.length;

        if (totalItems === 0) {
          return;
        }

        for (const f of favoriteItems) {
          logger.debug(
            `Removing from group: ${f.resourceUri.fsPath} (group: ${f.group})`,
          );
          favoritesProvider.resetFavoriteGroup(f.resourceUri);
        }

        for (const c of commandItems) {
          logger.debug(
            `Removing command from group: "${c.data.label}" (group: ${c.data.group})`,
          );
          favoritesProvider.moveCommand(
            c.data.id,
            FavoritesTreeDataProvider.DEFAULT_GROUP,
          );
        }

        if (totalItems > 1) {
          vscode.window.showInformationMessage(
            t(
              '{0} items moved to "{1}"',
              totalItems,
              FavoritesTreeDataProvider.getDefaultGroupLabel(),
            ),
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.removeAllFavorites',
      async () => {
        const deleteAllLabel = t('Remove All');
        const confirm = await vscode.window.showWarningMessage(
          t('Are you sure you want to remove ALL favorites?'),
          { modal: true },
          deleteAllLabel,
        );

        if (confirm === deleteAllLabel) {
          logger.debug('Removing ALL favorites');
          favoritesProvider.removeAllFavorites();
          vscode.window.showInformationMessage(t('All favorites removed'));
        }
      },
    ),
  );
}
