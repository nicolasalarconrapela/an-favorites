import * as vscode from 'vscode';
import {
  FavoritesTreeDataProvider,
  GroupItem,
  FavoriteItem,
} from '../views/FavoritesTreeDataProvider';
import { showGroupQuickPickWithCreate } from './groupQuickPick';

export function registerManageGroupsCommands(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any,
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('anfavorites.addGroup', async () => {
      const groupInput = await vscode.window.showInputBox({
        prompt:
          'Nombre del nuevo grupo (puedes crear varios separados por comas)',
        placeHolder: 'Ej: Proyectos, Documentación, G2',
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'El nombre no puede estar vacío';
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
          logger.info(`Adding new group: ${name}`);
          const success = favoritesProvider.addGroup(name);
          if (success) {
            createdCount++;
            logger.info(`Group created successfully: ${name}`);
          } else {
            existingCount++;
            logger.warn(`Group already exists or failed: ${name}`);
          }
        }

        if (createdCount > 0) {
          if (groupNames.length === 1) {
            vscode.window.showInformationMessage(
              `Grupo "${lastCreatedGroupName}" creado`,
            );
          } else {
            vscode.window.showInformationMessage(
              `Se han creado ${createdCount} grupos correctamente.`,
            );
          }
        }

        if (existingCount > 0) {
          if (groupNames.length === 1) {
            vscode.window.showErrorMessage('Este grupo ya existe');
          } else {
            vscode.window.showWarningMessage(
              `${existingCount} grupos ya existían y no fueron creados.`,
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
            vscode.window.showInformationMessage('No hay grupos para eliminar');
            return;
          }

          const selected = await vscode.window.showQuickPick(groups, {
            placeHolder: 'Selecciona el grupo a eliminar',
          });
          if (selected) {
            groupsToProcess = [selected];
          } else {
            return;
          }
        }

        groupsToProcess = groupsToProcess.filter(
          (g) => g !== FavoritesTreeDataProvider.DEFAULT_GROUP,
        );

        if (groupsToProcess.length === 0) return;

        const count = groupsToProcess.length;
        const confirm = await vscode.window.showWarningMessage(
          count === 1
            ? `¿Eliminar el grupo "${groupsToProcess[0]}"? Los favoritos se moverán a "${FavoritesTreeDataProvider.DEFAULT_GROUP}"`
            : `¿Eliminar los ${count} grupos seleccionados? Los favoritos se moverán a "${FavoritesTreeDataProvider.DEFAULT_GROUP}"`,
          { modal: true },
          'Eliminar',
        );

        if (confirm === 'Eliminar') {
          for (const g of groupsToProcess) {
            logger.info(`Removing group: ${g}`);
            favoritesProvider.removeGroup(g);
          }
          vscode.window.showInformationMessage(
            count === 1
              ? `Grupo "${groupsToProcess[0]}" eliminado`
              : `${count} grupos eliminados`,
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
            vscode.window.showInformationMessage(
              'No hay grupos para renombrar',
            );
            return;
          }

          oldName = await vscode.window.showQuickPick(groups, {
            placeHolder: 'Selecciona el grupo a renombrar',
          });
        }

        if (!oldName) {
          return;
        }

        if (oldName === FavoritesTreeDataProvider.DEFAULT_GROUP) {
          vscode.window.showWarningMessage(
            'No se puede renombrar el grupo por defecto',
          );
          return;
        }

        const newName = await vscode.window.showInputBox({
          prompt: `Nuevo nombre para "${oldName}"`,
          value: oldName,
          valueSelection: [0, oldName.length],
          title: `Renombrar Grupo: ${oldName}`,
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return 'El nombre no puede estar vacío';
            }
            if (value.trim() === oldName) {
              return 'El nombre debe ser diferente';
            }
            if (favoritesProvider.getGroups().includes(value.trim())) {
              return 'Este grupo ya existe';
            }
            return null;
          },
        });

        if (newName) {
          const trimmedNewName = newName.trim();
          logger.info(
            `Renaming group from "${oldName}" to "${trimmedNewName}"`,
          );
          const success = favoritesProvider.renameGroup(
            oldName,
            trimmedNewName,
          );
          if (success) {
            vscode.window.showInformationMessage(
              `Grupo renombrado a "${newName}"`,
            );
            logger.info(`Group renamed successfully`);
          } else {
            vscode.window.showErrorMessage('No se pudo renombrar el grupo');
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
      async (item?: FavoriteItem, selectedItems?: FavoriteItem[]) => {
        const itemsToProcess = (selectedItems || (item ? [item] : [])).filter(
          (i): i is FavoriteItem => i instanceof FavoriteItem,
        );

        if (itemsToProcess.length === 0) {
          vscode.window.showWarningMessage('Selecciona un favorito para mover');
          return;
        }

        const selected = await showGroupQuickPickWithCreate({
          groups: favoritesProvider.getGroups(),
          favoritesProvider,
          placeHolder:
            itemsToProcess.length === 1
              ? `Mover de "${itemsToProcess[0].group}" a...`
              : `Mover ${itemsToProcess.length} elementos a...`,
          activeItem:
            itemsToProcess.length === 1 ? itemsToProcess[0].group : undefined,
          title: 'Mover favoritos a grupo',
        });

        if (!selected) {
          return;
        }

        const targetGroup = selected;

        for (const f of itemsToProcess) {
          logger.info(
            `Moving favorite ${f.favoriteUri.fsPath} to group "${targetGroup}"`,
          );
          favoritesProvider.moveFavorite(f.favoriteUri, targetGroup);
        }

        vscode.window.showInformationMessage(
          itemsToProcess.length === 1
            ? `Favorito movido a "${targetGroup}"`
            : `${itemsToProcess.length} favoritos movidos a "${targetGroup}"`,
        );
        logger.info(`Favorite(s) moved successfully`);
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

        const confirm = await vscode.window.showWarningMessage(
          `¿Mover todos los favoritos de "${item.groupName}" a "Sin Grupo"?`,
          { modal: true },
          'Limpiar Grupo',
        );

        if (confirm === 'Limpiar Grupo') {
          logger.info(`Clearing group: ${item.groupName}`);
          favoritesProvider.clearGroupItems(item.groupName);
          vscode.window.showInformationMessage(
            `Grupo "${item.groupName}" vaciado`,
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.removeFromGroup',
      async (item?: FavoriteItem, selectedItems?: FavoriteItem[]) => {
        const itemsToProcess = (selectedItems || (item ? [item] : [])).filter(
          (i): i is FavoriteItem => i instanceof FavoriteItem,
        );

        if (itemsToProcess.length === 0) {
          return;
        }

        for (const f of itemsToProcess) {
          logger.info(
            `Removing from group: ${f.favoriteUri.fsPath} (group: ${f.group})`,
          );
          favoritesProvider.resetFavoriteGroup(f.favoriteUri);
        }

        if (itemsToProcess.length > 1) {
          vscode.window.showInformationMessage(
            `${itemsToProcess.length} elementos movidos a "Sin Grupo"`,
          );
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.removeAllFavorites',
      async () => {
        const confirm = await vscode.window.showWarningMessage(
          '¿Estás seguro de que quieres eliminar TODOS los favoritos?',
          { modal: true },
          'Eliminar Todo',
        );

        if (confirm === 'Eliminar Todo') {
          logger.info('Removing ALL favorites');
          favoritesProvider.removeAllFavorites();
          vscode.window.showInformationMessage(
            'Todos los favoritos eliminados',
          );
        }
      },
    ),
  );
}
