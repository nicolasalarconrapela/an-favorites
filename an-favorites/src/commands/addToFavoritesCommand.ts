import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';

export function registerAddToFavoritesCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.addToFavorites',
    async (uri?: vscode.Uri) => {
      try {
        logger.debug('addToFavorites command triggered', { uri: uri?.fsPath });

        // Si no se proporciona URI, usar el archivo activo
        const targetUri = uri || vscode.window.activeTextEditor?.document.uri;

        if (!targetUri) {
          vscode.window.showWarningMessage('No se seleccionó ningún archivo');
          logger.warn('No URI provided for addToFavorites');
          return;
        }

        logger.debug(`Target URI: ${targetUri.fsPath}`);

        // Verificar si es un archivo (no una carpeta)
        try {
          const stat = await vscode.workspace.fs.stat(targetUri);
          if (stat.type === vscode.FileType.Directory) {
            vscode.window.showWarningMessage('No se pueden añadir carpetas a favoritos');
            logger.warn('Attempted to add directory to favorites');
            return;
          }
        } catch (error) {
          logger.error('Error checking file', error);
          vscode.window.showErrorMessage('Error al verificar el archivo');
          return;
        }

        if (favoritesProvider.hasFavorite(targetUri)) {
          vscode.window.showInformationMessage('El archivo ya está en favoritos');
          logger.info('File already in favorites');
          return;
        }

        // Obtener categorías existentes
        const categories = favoritesProvider.getCategories();
        logger.debug(`Available categories: ${categories.join(', ')}`);

        const items: vscode.QuickPickItem[] = categories.map((cat) => ({
          label: cat,
          description: 'Categoría existente',
        }));

        // Añadir opción para crear nueva categoría
        items.push({
          label: '$(add) Nueva Categoría...',
          description: 'Crear una nueva categoría',
        });

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Selecciona una categoría para el favorito',
        });

        if (!selected) {
          logger.debug('User cancelled category selection');
          return; // User cancelled
        }

        logger.debug(`Selected category option: ${selected.label}`);

        let categoryName: string;

        if (selected.label.startsWith('$(add)')) {
          // Create new category
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
            logger.debug('User cancelled new category creation');
            return; // User cancelled
          }

          categoryName = newCategoryName.trim();
          logger.info(`Creating new category: ${categoryName}`);
          favoritesProvider.addCategory(categoryName);
        } else {
          categoryName = selected.label;
        }

        logger.info(`Adding favorite to category "${categoryName}": ${targetUri.fsPath}`);
        favoritesProvider.addFavorite(targetUri, categoryName);

        vscode.window.showInformationMessage(
          `Añadido a favoritos en "${categoryName}": ${targetUri.fsPath}`
        );
        logger.info('Favorite added successfully');
      } catch (error) {
        logger.error('Unexpected error in addToFavorites', error);
        vscode.window.showErrorMessage(`Error al añadir favorito: ${error}`);
      }
    }
  );

  context.subscriptions.push(disposable);
  logger.debug('addToFavorites command registered');
}
