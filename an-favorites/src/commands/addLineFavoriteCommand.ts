import * as vscode from 'vscode';
import { Logger } from '../logging/logger';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';

export function registerAddLineFavoriteCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: Logger,
): void {
  const addDisposable = vscode.commands.registerTextEditorCommand(
    'anfavorites.addLineFavorite',
    (editor) => {
      const uri = editor.document.uri;
      if (uri.scheme !== 'file') {
        vscode.window.showWarningMessage(
          'Solo se pueden guardar líneas de archivos locales.',
        );
        return;
      }

      const line = editor.selection.active.line + 1;
      const added = favoritesProvider.addLineFavorite(uri, line);

      logger.info(
        `[lineFavorites] ${added ? 'Added' : 'Skipped'} line ${line} -> ${uri.fsPath}`,
      );

      if (added) {
        vscode.window.showInformationMessage(
          `Línea ${line} guardada en favoritos.`,
        );
      } else {
        vscode.window.showInformationMessage(
          `La línea ${line} ya estaba en favoritos.`,
        );
      }
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExists',
        favoritesProvider.hasLineFavorite(uri, line),
      );
    },
  );

  const addInGroupDisposable = vscode.commands.registerTextEditorCommand(
    'anfavorites.addLineFavoriteInGroup',
    async (editor) => {
      const uri = editor.document.uri;
      if (uri.scheme !== 'file') {
        vscode.window.showWarningMessage(
          'Solo se pueden guardar líneas de archivos locales.',
        );
        return;
      }

      const line = editor.selection.active.line + 1;
      if (favoritesProvider.hasLineFavorite(uri, line)) {
        vscode.window.showInformationMessage(
          `La línea ${line} ya estaba en favoritos.`,
        );
        return;
      }

      const groups = favoritesProvider.getGroups();
      if (groups.length === 0) {
        vscode.window.showInformationMessage('No hay grupos disponibles.');
        return;
      }

      const selectedGroup = await vscode.window.showQuickPick(groups, {
        placeHolder: 'Selecciona un grupo para la línea favorita',
      });
      if (!selectedGroup) {
        return;
      }

      const added = favoritesProvider.addLineFavorite(
        uri,
        line,
        selectedGroup,
      );

      logger.info(
        `[lineFavorites] ${added ? 'Added' : 'Skipped'} line ${line} -> ${uri.fsPath}`,
      );

      if (added) {
        vscode.window.showInformationMessage(
          `Línea ${line} guardada en favoritos (${selectedGroup}).`,
        );
      } else {
        vscode.window.showInformationMessage(
          `La línea ${line} ya estaba en favoritos.`,
        );
      }
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExists',
        favoritesProvider.hasLineFavorite(uri, line),
      );
    },
  );

  const addAtPositionDisposable = vscode.commands.registerTextEditorCommand(
    'anfavorites.addLineFavoriteAtPosition',
    async (editor, _edit, args) => {
      const uri = editor.document.uri;
      if (uri.scheme !== 'file') {
        vscode.window.showWarningMessage(
          'Solo se pueden guardar líneas de archivos locales.',
        );
        return;
      }

      const maxLine = editor.document.lineCount;
      const argsLine =
        typeof args?.line === 'number'
          ? args.line
          : typeof args?.lineNumber === 'number'
            ? args.lineNumber
            : undefined;
      let line = argsLine;

      if (!line) {
        line = editor.selection.active.line + 1;
      }

      if (line < 1 || line > maxLine) {
        vscode.window.showWarningMessage(
          `La línea debe estar entre 1 y ${maxLine}.`,
        );
        return;
      }

      if (favoritesProvider.hasLineFavorite(uri, line)) {
        vscode.window.showInformationMessage(
          `La línea ${line} ya estaba en favoritos.`,
        );
        return;
      }

      const added = favoritesProvider.addLineFavorite(uri, line);
      logger.info(
        `[lineFavorites] ${added ? 'Added' : 'Skipped'} line ${line} -> ${uri.fsPath}`,
      );

      if (added) {
        vscode.window.showInformationMessage(
          `Línea ${line} guardada en favoritos.`,
        );
      } else {
        vscode.window.showInformationMessage(
          `La línea ${line} ya estaba en favoritos.`,
        );
      }
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExists',
        favoritesProvider.hasLineFavorite(uri, line),
      );
    },
  );

  const removeDisposable = vscode.commands.registerTextEditorCommand(
    'anfavorites.removeLineFavorite',
    (editor) => {
      const uri = editor.document.uri;
      if (uri.scheme !== 'file') {
        vscode.window.showWarningMessage(
          'Solo se pueden guardar líneas de archivos locales.',
        );
        return;
      }

      const line = editor.selection.active.line + 1;
      if (favoritesProvider.hasLineFavorite(uri, line)) {
        favoritesProvider.removeLineFavorite(uri, line);
        logger.info(
          `[lineFavorites] Removed line ${line} -> ${uri.fsPath}`,
        );
        vscode.window.showInformationMessage(
          `Línea ${line} eliminada de favoritos.`,
        );
      } else {
        vscode.window.showInformationMessage(
          `La línea ${line} no está en favoritos.`,
        );
      }
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExists',
        false,
      );
    },
  );

  context.subscriptions.push(
    addDisposable,
    addInGroupDisposable,
    addAtPositionDisposable,
    removeDisposable,
  );
  logger.info('[lineFavorites] addLineFavorite command registered');
}
