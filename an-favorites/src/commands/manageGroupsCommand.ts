import * as vscode from 'vscode';
import {
  FavoritesTreeDataProvider,
  GroupItem,
  FavoriteItem,
} from '../views/FavoritesTreeDataProvider';

export function registerManageGroupsCommands(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any,
): void {
  // Comando: Añadir nuevo grupo
  context.subscriptions.push(
    vscode.commands.registerCommand('anfavorites.addGroup', async () => {
      const groupInput = await vscode.window.showInputBox({
        prompt: 'Nombre del nuevo grupo (puedes crear varios separados por comas)',
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
        const lastCreatedGroupName = groupNames.length === 1 ? groupNames[0] : '';

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
            vscode.window.showInformationMessage(`Grupo "${lastCreatedGroupName}" creado`);
          } else {
            vscode.window.showInformationMessage(`Se han creado ${createdCount} grupos correctamente.`);
          }
        }

        if (existingCount > 0) {
          if (groupNames.length === 1) {
            vscode.window.showErrorMessage('Este grupo ya existe');
          } else {
            vscode.window.showWarningMessage(`${existingCount} grupos ya existían y no fueron creados.`);
          }
        }
      }
    }),
  );

  // Comando: Eliminar grupo
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.removeGroup',
      async (item?: GroupItem) => {
        let groupName: string | undefined;

        if (item && item instanceof GroupItem) {
          groupName = item.groupName;
        } else {
          // Show picker if no group provided
          const groups = favoritesProvider
            .getGroups()
            .filter((grp) => grp !== FavoritesTreeDataProvider.DEFAULT_GROUP);
          if (groups.length === 0) {
            vscode.window.showInformationMessage('No hay grupos para eliminar');
            return;
          }

          groupName = await vscode.window.showQuickPick(groups, {
            placeHolder: 'Selecciona el grupo a eliminar',
          });
        }

        if (!groupName) {
          return;
        }

        if (groupName === FavoritesTreeDataProvider.DEFAULT_GROUP) {
          const confirm = await vscode.window.showWarningMessage(
            'Ests seguro de que quieres eliminar los favoritos del grupo por defecto? Se perdern todos los favoritos.',
            { modal: true },
            'Eliminar Definitivamente',
          );

          if (confirm === 'Eliminar Definitivamente') {
            logger.info(`Deleting all favorites in default group`);
            favoritesProvider.deleteFavoritesInGroup(groupName);
            vscode.window.showInformationMessage(
              'Grupo por defecto vaciado correctamente',
            );
          }
          return;
        }

        const confirm = await vscode.window.showWarningMessage(
          `¿Eliminar el grupo "${groupName}"? Los favoritos se moverán a "${FavoritesTreeDataProvider.DEFAULT_GROUP}"`,
          { modal: true },
          'Eliminar',
        );

        if (confirm === 'Eliminar') {
          logger.info(`Removing group: ${groupName}`);
          favoritesProvider.removeGroup(groupName);
          vscode.window.showInformationMessage(
            `Grupo "${groupName}" eliminado`,
          );
          logger.info(`Group removed: ${groupName}`);
        }
      },
    ),
  );

  // Comando: Renombrar grupo
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.renameGroup',
      async (item?: GroupItem) => {
        let oldName: string | undefined;

        if (item && item instanceof GroupItem) {
          oldName = item.groupName;
        } else {
          // Show picker if no group provided
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

  // Comando: Mover favorito a otro grupo
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.moveFavorite',
      async (item?: FavoriteItem) => {
        if (!item || !(item instanceof FavoriteItem)) {
          vscode.window.showWarningMessage('Selecciona un favorito para mover');
          return;
        }

        const groups = favoritesProvider.getGroups();
        const currentGroup = item.group;

        const items: vscode.QuickPickItem[] = groups
          .filter((grp) => grp !== currentGroup)
          .map((grp) => ({
            label: grp,
            description:
              grp === FavoritesTreeDataProvider.DEFAULT_GROUP
                ? 'Grupo por defecto'
                : undefined,
          }));

        // Añadir opción para crear nuevo grupo
        items.push({
          label: '$(add) Nuevo Grupo...',
          description: 'Crear un nuevo grupo',
        });

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: `Mover de "${currentGroup}" a...`,
        });

        if (!selected) {
          return;
        }

        let targetGroup: string;

        if (selected.label.startsWith('$(add)')) {
          const newGroupName = await vscode.window.showInputBox({
            prompt: 'Nombre del nuevo grupo',
            placeHolder: 'Ej: Proyectos, Documentación, etc.',
            validateInput: (value) => {
              if (!value || value.trim().length === 0) {
                return 'El nombre no puede estar vacío';
              }
              if (groups.includes(value.trim())) {
                return 'Este grupo ya existe';
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
          targetGroup = selected.label;
        }

        logger.info(
          `Moving favorite ${item.resourceUri.fsPath} to group "${targetGroup}"`,
        );
        favoritesProvider.moveFavorite(item.resourceUri, targetGroup);
        vscode.window.showInformationMessage(
          `Favorito movido a "${targetGroup}"`,
        );
        logger.info(`Favorite moved successfully`);
      },
    ),
  );

  // Comando: Limpiar grupo (mover items a default)
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

  // Comando: Quitar del grupo (mover a default)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.removeFromGroup',
      async (item?: FavoriteItem) => {
        if (!item || !(item instanceof FavoriteItem)) {
          return;
        }

        logger.info(
          `Removing from group: ${item.resourceUri.fsPath} (group: ${item.group})`,
        );
        favoritesProvider.resetFavoriteGroup(item.resourceUri);
        // No confirmation needed for single item usually, but maybe?
        // User asked for a cross, usually instant.
      },
    ),
  );

  // Comando: Eliminar TODOS los favoritos
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
