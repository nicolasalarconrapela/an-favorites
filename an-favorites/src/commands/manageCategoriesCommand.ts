import * as vscode from 'vscode';
import { FavoritesTreeDataProvider, CategoryItem, FavoriteItem } from '../views/FavoritesTreeDataProvider';

export function registerManageCategoriesCommands(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any
): void {
  // Comando: Añadir nueva categoría
  context.subscriptions.push(
    vscode.commands.registerCommand('anfavorites.addCategory', async () => {
      const categoryName = await vscode.window.showInputBox({
        prompt: 'Nombre de la nueva categoría',
        placeHolder: 'Ej: Proyectos, Documentación, etc.',
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'El nombre no puede estar vacío';
          }
          if (favoritesProvider.getCategories().includes(value.trim())) {
            return 'Esta categoría ya existe';
          }
          return null;
        },
      });

      if (categoryName) {
        const trimmedName = categoryName.trim();
        logger.info(`Adding new category: ${trimmedName}`);
        const success = favoritesProvider.addCategory(trimmedName);
        if (success) {
          vscode.window.showInformationMessage(`Categoría "${categoryName}" creada`);
          logger.info(`Category created successfully: ${trimmedName}`);
        } else {
          vscode.window.showErrorMessage('No se pudo crear la categoría');
          logger.error(`Failed to create category: ${trimmedName}`);
        }
      }
    })
  );

  // Comando: Eliminar categoría
  context.subscriptions.push(
    vscode.commands.registerCommand('anfavorites.removeCategory', async (item?: CategoryItem) => {
      let categoryName: string | undefined;

      if (item && item instanceof CategoryItem) {
        categoryName = item.categoryName;
      } else {
        // Show picker if no category provided
        const categories = favoritesProvider.getCategories().filter((cat) => cat !== FavoritesTreeDataProvider.DEFAULT_CATEGORY);
        if (categories.length === 0) {
          vscode.window.showInformationMessage('No hay categorías para eliminar');
          return;
        }

        categoryName = await vscode.window.showQuickPick(categories, {
          placeHolder: 'Selecciona la categoría a eliminar',
        });
      }

      if (!categoryName) {
        return;
      }

      if (categoryName === FavoritesTreeDataProvider.DEFAULT_CATEGORY) {
        vscode.window.showWarningMessage('No se puede eliminar la categoría por defecto');
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `¿Eliminar la categoría "${categoryName}"? Los favoritos se moverán a "${FavoritesTreeDataProvider.DEFAULT_CATEGORY}"`,
        { modal: true },
        'Eliminar'
      );

      if (confirm === 'Eliminar') {
        logger.info(`Removing category: ${categoryName}`);
        favoritesProvider.removeCategory(categoryName);
        vscode.window.showInformationMessage(`Categoría "${categoryName}" eliminada`);
        logger.info(`Category removed: ${categoryName}`);
      }
    })
  );

  // Comando: Renombrar categoría
  context.subscriptions.push(
    vscode.commands.registerCommand('anfavorites.renameCategory', async (item?: CategoryItem) => {
      let oldName: string | undefined;

      if (item && item instanceof CategoryItem) {
        oldName = item.categoryName;
      } else {
        // Show picker if no category provided
        const categories = favoritesProvider.getCategories().filter((cat) => cat !== FavoritesTreeDataProvider.DEFAULT_CATEGORY);
        if (categories.length === 0) {
          vscode.window.showInformationMessage('No hay categorías para renombrar');
          return;
        }

        oldName = await vscode.window.showQuickPick(categories, {
          placeHolder: 'Selecciona la categoría a renombrar',
        });
      }

      if (!oldName) {
        return;
      }

      if (oldName === FavoritesTreeDataProvider.DEFAULT_CATEGORY) {
        vscode.window.showWarningMessage('No se puede renombrar la categoría por defecto');
        return;
      }

      const newName = await vscode.window.showInputBox({
        prompt: `Nuevo nombre para "${oldName}"`,
        value: oldName,
        validateInput: (value) => {
          if (!value || value.trim().length === 0) {
            return 'El nombre no puede estar vacío';
          }
          if (value.trim() === oldName) {
            return 'El nombre debe ser diferente';
          }
          if (favoritesProvider.getCategories().includes(value.trim())) {
            return 'Esta categoría ya existe';
          }
          return null;
        },
      });

      if (newName) {
        const trimmedNewName = newName.trim();
        logger.info(`Renaming category from "${oldName}" to "${trimmedNewName}"`);
        const success = favoritesProvider.renameCategory(oldName, trimmedNewName);
        if (success) {
          vscode.window.showInformationMessage(`Categoría renombrada a "${newName}"`);
          logger.info(`Category renamed successfully`);
        } else {
          vscode.window.showErrorMessage('No se pudo renombrar la categoría');
          logger.error(`Failed to rename category from "${oldName}" to "${trimmedNewName}"`);
        }
      }
    })
  );

  // Comando: Mover favorito a otra categoría
  context.subscriptions.push(
    vscode.commands.registerCommand('anfavorites.moveFavorite', async (item?: FavoriteItem) => {
      if (!item || !(item instanceof FavoriteItem)) {
        vscode.window.showWarningMessage('Selecciona un favorito para mover');
        return;
      }

      const categories = favoritesProvider.getCategories();
      const currentCategory = item.category;

      const items: vscode.QuickPickItem[] = categories
        .filter((cat) => cat !== currentCategory)
        .map((cat) => ({
          label: cat,
          description: cat === FavoritesTreeDataProvider.DEFAULT_CATEGORY ? 'Categoría por defecto' : undefined,
        }));

      // Añadir opción para crear nueva categoría
      items.push({
        label: '$(add) Nueva Categoría...',
        description: 'Crear una nueva categoría',
      });

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: `Mover de "${currentCategory}" a...`,
      });

      if (!selected) {
        return;
      }

      let targetCategory: string;

      if (selected.label.startsWith('$(add)')) {
        const newCategoryName = await vscode.window.showInputBox({
          prompt: 'Nombre de la nueva categoría',
          placeHolder: 'Ej: Proyectos, Documentación, etc.',
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return 'El nombre no puede estar vacío';
            }
            if (categories.includes(value.trim())) {
              return 'Esta categoría ya existe';
            }
            return null;
          },
        });

        if (!newCategoryName) {
          return;
        }

        targetCategory = newCategoryName.trim();
        favoritesProvider.addCategory(targetCategory);
      } else {
        targetCategory = selected.label;
      }

      logger.info(`Moving favorite ${item.resourceUri.fsPath} to category "${targetCategory}"`);
      favoritesProvider.moveFavorite(item.resourceUri, targetCategory);
      vscode.window.showInformationMessage(`Favorito movido a "${targetCategory}"`);
      logger.info(`Favorite moved successfully`);
    })
  );
}
