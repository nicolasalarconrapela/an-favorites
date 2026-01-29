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
      const added = favoritesProvider.toggleLineFavorite(uri, line);

      logger.info(
        `[lineFavorites] ${added ? 'Added' : 'Removed'} line ${line} -> ${uri.fsPath}`,
      );

      vscode.window.showInformationMessage(
        added
          ? `Línea ${line} guardada en favoritos.`
          : `Línea ${line} eliminada de favoritos.`,
      );
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
      favoritesProvider.removeLineFavorite(uri, line);
      logger.info(
        `[lineFavorites] Removed line ${line} -> ${uri.fsPath}`,
      );
      vscode.window.showInformationMessage(
        `Línea ${line} eliminada de favoritos.`,
      );
      vscode.commands.executeCommand(
        'setContext',
        'anfavorites.lineFavoriteExists',
        false,
      );
    },
  );

  context.subscriptions.push(addDisposable, removeDisposable);
  logger.info('[lineFavorites] addLineFavorite command registered');
}
