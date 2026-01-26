import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';

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
            vscode.window.showWarningMessage(
              'No se pueden añadir carpetas a favoritos',
            );
            logger.warn('Attempted to add directory to favorites');
            return;
          }
        } catch (error) {
          logger.error('Error checking file', error);
          vscode.window.showErrorMessage('Error al verificar el archivo');
          return;
        }

        if (favoritesProvider.hasFavorite(targetUri)) {
          vscode.window.showInformationMessage(
            'El archivo ya está en favoritos',
          );
          logger.info('File already in favorites');
          return;
        }

        // Obtener grupos existentes
        const groups = favoritesProvider.getGroups();
        logger.debug(`Available groups: ${groups.join(', ')}`);

        const items: vscode.QuickPickItem[] = groups.map((grp) => ({
          label: grp,
          description: 'Grupo existente',
        }));

        // Añadir opción para crear nuevo grupo
        items.push({
          label: '$(add) Nuevo Grupo...',
          description: 'Crear un nuevo grupo',
        });

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: 'Selecciona un grupo para el favorito',
        });

        if (!selected) {
          logger.debug('User cancelled group selection');
          return; // User cancelled
        }

        logger.debug(`Selected group option: ${selected.label}`);

        let groupName: string;

        if (selected.label.startsWith('$(add)')) {
          // Create new group
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
            logger.debug('User cancelled new group creation');
            return; // User cancelled
          }

          groupName = newGroupName.trim();
          logger.info(`Creating new group: ${groupName}`);
          favoritesProvider.addGroup(groupName);
        } else {
          groupName = selected.label;
        }

        logger.info(
          `Adding favorite to group "${groupName}": ${targetUri.fsPath}`,
        );
        favoritesProvider.addFavorite(targetUri, groupName);

        vscode.window.showInformationMessage(
          `Añadido a favoritos en "${groupName}": ${targetUri.fsPath}`,
        );
        logger.info('Favorite added successfully');
      } catch (error) {
        logger.error('Unexpected error in addToFavorites', error);
        vscode.window.showErrorMessage(`Error al añadir favorito: ${error}`);
      }
    },
  );

  context.subscriptions.push(disposable);
  logger.debug('addToFavorites command registered');
}
