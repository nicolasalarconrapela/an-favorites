import * as vscode from 'vscode';
import { Logger } from '../logging/logger';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { showGroupQuickPickWithCreate } from './groupQuickPick';

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
      const column = editor.selection.active.character + 1;
      const added = favoritesProvider.addLineFavoriteAtPosition(
        uri,
        line,
        column,
      );

      logger.info(
        `[lineFavorites] ${added ? 'Added' : 'Skipped'} line ${line}:${column} -> ${uri.fsPath}`,
      );

      if (added) {
        vscode.window.showInformationMessage(
          `Posición ${line}:${column} guardada en favoritos.`,
        );
      } else {
        vscode.window.showInformationMessage(
          `La posición ${line}:${column} ya estaba en favoritos.`,
        );
      }
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExistsAtCursor',
        favoritesProvider.hasLineFavoriteAtPosition(uri, line, column),
      );
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExistsOnLine',
        favoritesProvider.hasLineFavoriteOnLine(uri, line),
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
      const column = editor.selection.active.character + 1;
      if (favoritesProvider.hasLineFavoriteAtPosition(uri, line, column)) {
        vscode.window.showInformationMessage(
          `La posición ${line}:${column} ya estaba en favoritos.`,
        );
        return;
      }

      const selectedGroup = await showGroupQuickPickWithCreate({
        groups: favoritesProvider.getGroups(),
        favoritesProvider,
        placeHolder: 'Selecciona un grupo para la línea favorita',
        activeItem: FavoritesTreeDataProvider.DEFAULT_GROUP,
      });
      if (!selectedGroup) {
        return;
      }

      const added = favoritesProvider.addLineFavoriteAtPosition(
        uri,
        line,
        column,
        selectedGroup,
      );

      logger.info(
        `[lineFavorites] ${added ? 'Added' : 'Skipped'} line ${line}:${column} -> ${uri.fsPath}`,
      );

      if (added) {
        vscode.window.showInformationMessage(
          `Posición ${line}:${column} guardada en favoritos (${selectedGroup}).`,
        );
      } else {
        vscode.window.showInformationMessage(
          `La posición ${line}:${column} ya estaba en favoritos.`,
        );
      }
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExistsAtCursor',
        favoritesProvider.hasLineFavoriteAtPosition(uri, line, column),
      );
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExistsOnLine',
        favoritesProvider.hasLineFavoriteOnLine(uri, line),
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

      let column =
        typeof args?.column === 'number'
          ? args.column
          : typeof args?.columnNumber === 'number'
            ? args.columnNumber
            : undefined;

      if (!line) {
        line = editor.selection.active.line + 1;
      }
      if (!column) {
        column = editor.selection.active.character + 1;
      }

      if (line < 1 || line > maxLine) {
        vscode.window.showWarningMessage(
          `La línea debe estar entre 1 y ${maxLine}.`,
        );
        return;
      }
      if (column < 1) {
        vscode.window.showWarningMessage(
          'La columna debe ser un número mayor o igual a 1.',
        );
        return;
      }

      if (favoritesProvider.hasLineFavoriteAtPosition(uri, line, column)) {
        vscode.window.showInformationMessage(
          `La posición ${line}:${column} ya estaba en favoritos.`,
        );
        return;
      }

      const added = favoritesProvider.addLineFavoriteAtPosition(
        uri,
        line,
        column,
      );
      logger.info(
        `[lineFavorites] ${added ? 'Added' : 'Skipped'} line ${line}:${column} -> ${uri.fsPath}`,
      );

      if (added) {
        vscode.window.showInformationMessage(
          `Posición ${line}:${column} guardada en favoritos.`,
        );
      } else {
        vscode.window.showInformationMessage(
          `La posición ${line}:${column} ya estaba en favoritos.`,
        );
      }
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExistsAtCursor',
        favoritesProvider.hasLineFavoriteAtPosition(uri, line, column),
      );
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExistsOnLine',
        favoritesProvider.hasLineFavoriteOnLine(uri, line),
      );
    },
  );

  const addFromLocationDisposable = vscode.commands.registerTextEditorCommand(
    'anfavorites.addLineFavoriteFromPosition',
    async (editor) => {
      const uri = editor.document.uri;
      if (uri.scheme !== 'file') {
        vscode.window.showWarningMessage(
          'Solo se pueden guardar líneas de archivos locales.',
        );
        return;
      }

      const line = editor.selection.active.line + 1;
      const column = editor.selection.active.character + 1;
      const groups = favoritesProvider.getGroups();

      if (groups.length === 0) {
        const added = favoritesProvider.addLineFavoriteAtPosition(
          uri,
          line,
          column,
        );
        if (added) {
          vscode.window.showInformationMessage(
            `Posición ${line}:${column} guardada en favoritos.`,
          );
        } else {
          vscode.window.showInformationMessage(
            `La posición ${line}:${column} ya estaba en favoritos.`,
          );
        }
        vscode.commands.executeCommand(
          'setContext',
          'anfavorites.lineFavoriteExistsAtCursor',
          favoritesProvider.hasLineFavoriteAtPosition(uri, line, column),
        );
        vscode.commands.executeCommand(
          'setContext',
          'anfavorites.lineFavoriteExistsOnLine',
          favoritesProvider.hasLineFavoriteOnLine(uri, line),
        );
        return;
      }

      const selectedGroup = await showGroupQuickPickWithCreate({
        groups,
        favoritesProvider,
        placeHolder: 'Selecciona un grupo para la línea favorita',
        title: 'Guardar línea en favoritos (grupo)',
        activeItem: FavoritesTreeDataProvider.DEFAULT_GROUP,
      });
      if (!selectedGroup) {
        return;
      }

      const added = favoritesProvider.addLineFavoriteAtPosition(
        uri,
        line,
        column,
        selectedGroup,
      );
      if (added) {
        vscode.window.showInformationMessage(
          `Posición ${line}:${column} guardada en favoritos (${selectedGroup}).`,
        );
      } else {
        vscode.window.showInformationMessage(
          `La posición ${line}:${column} ya estaba en favoritos.`,
        );
      }
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExistsAtCursor',
        favoritesProvider.hasLineFavoriteAtPosition(uri, line, column),
      );
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExistsOnLine',
        favoritesProvider.hasLineFavoriteOnLine(uri, line),
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
      const column = editor.selection.active.character + 1;
      const removed = favoritesProvider.removeLineFavoriteAtPosition(
        uri,
        line,
        column,
      );
      if (removed) {
        logger.info(
          `[lineFavorites] Removed line ${line}:${column} -> ${uri.fsPath}`,
        );
        vscode.window.showInformationMessage(
          `Posición ${line}:${column} eliminada de favoritos.`,
        );
      } else {
        vscode.window.showInformationMessage(
          `La posición ${line}:${column} no está en favoritos.`,
        );
      }
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExistsAtCursor',
        false,
      );
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExistsOnLine',
        favoritesProvider.hasLineFavoriteOnLine(uri, line),
      );
    },
  );

  context.subscriptions.push(
    addDisposable,
    addInGroupDisposable,
    addAtPositionDisposable,
    addFromLocationDisposable,
    removeDisposable,
  );
  logger.info('[lineFavorites] addLineFavorite command registered');
}
