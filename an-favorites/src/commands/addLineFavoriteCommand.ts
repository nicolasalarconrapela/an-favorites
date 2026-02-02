import * as vscode from 'vscode';
import * as path from 'path';
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

  const addFromLocationDisposable = vscode.commands.registerTextEditorCommand(
    'anfavorites.addLineFavoriteFromPosition',
    async () => {
      const rawInput = await vscode.window.showInputBox({
        title: 'Guardar línea por posición',
        placeHolder: 'archivo:línea:columna (ej. package.json:6:234)',
        prompt: 'También puedes usar archivo:línea si no tienes columna.',
        validateInput: (value) => {
          const trimmed = value.trim();
          if (!trimmed) {
            return 'Ingresa una ruta y línea.';
          }
          const match = trimmed.match(/:(\d+)(?::(\d+))?$/);
          if (!match) {
            return 'Formato inválido. Usa archivo:línea o archivo:línea:columna.';
          }
          const line = Number.parseInt(match[1], 10);
          if (!Number.isFinite(line) || line < 1) {
            return 'La línea debe ser un número mayor o igual a 1.';
          }
          if (match[2]) {
            const column = Number.parseInt(match[2], 10);
            if (!Number.isFinite(column) || column < 1) {
              return 'La columna debe ser un número mayor o igual a 1.';
            }
          }
          return null;
        },
      });

      if (!rawInput) {
        return;
      }

      const input = rawInput.trim();
      const match = input.match(/:(\d+)(?::(\d+))?$/);
      if (!match) {
        vscode.window.showWarningMessage(
          'Formato inválido. Usa archivo:línea o archivo:línea:columna.',
        );
        return;
      }

      const line = Number.parseInt(match[1], 10);
      if (!Number.isFinite(line) || line < 1) {
        vscode.window.showWarningMessage('Número de línea inválido.');
        return;
      }

      const locationPath = input.slice(0, match.index);
      if (!locationPath) {
        vscode.window.showWarningMessage('Ruta de archivo inválida.');
        return;
      }

      let targetUri: vscode.Uri | null = null;
      if (path.isAbsolute(locationPath)) {
        targetUri = vscode.Uri.file(locationPath);
      } else {
        const folders = vscode.workspace.workspaceFolders ?? [];
        if (folders.length === 1) {
          targetUri = vscode.Uri.joinPath(folders[0].uri, locationPath);
        } else if (folders.length > 1) {
          const matches = await vscode.workspace.findFiles(
            `**/${locationPath}`,
            undefined,
            2,
          );
          if (matches.length > 0) {
            targetUri = matches[0];
          }
        }
      }

      if (!targetUri) {
        vscode.window.showWarningMessage(
          'No se pudo resolver la ruta del archivo.',
        );
        return;
      }

      try {
        const document = await vscode.workspace.openTextDocument(targetUri);
        const maxLine = document.lineCount;
        if (line > maxLine) {
          vscode.window.showWarningMessage(
            `La línea debe estar entre 1 y ${maxLine}.`,
          );
          return;
        }

        const added = favoritesProvider.addLineFavorite(targetUri, line);
        logger.info(
          `[lineFavorites] ${added ? 'Added' : 'Skipped'} line ${line} -> ${targetUri.fsPath}`,
        );

        if (added) {
          vscode.window.showInformationMessage(
            `Línea ${line} guardada en favoritos (${targetUri.fsPath}).`,
          );
        } else {
          vscode.window.showInformationMessage(
            `La línea ${line} ya estaba en favoritos.`,
          );
        }
      } catch (error) {
        logger.error('[lineFavorites] Error opening file for position', error);
        vscode.window.showErrorMessage(
          'No se pudo abrir el archivo para guardar la línea.',
        );
      }
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
    addFromLocationDisposable,
    removeDisposable,
  );
  logger.info('[lineFavorites] addLineFavorite command registered');
}
