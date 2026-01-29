import * as vscode from 'vscode';
import { LineFavoritesService } from '../services/lineFavoritesService';
import { Logger } from '../logging/logger';

export function registerAddLineFavoriteCommand(
  context: vscode.ExtensionContext,
  lineFavoritesService: LineFavoritesService,
  logger: Logger,
): void {
  const disposable = vscode.commands.registerTextEditorCommand(
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
      const added = lineFavoritesService.toggleLineFavorite(uri, line);

      logger.info(
        `[lineFavorites] ${added ? 'Added' : 'Removed'} line ${line} -> ${uri.fsPath}`,
      );

      vscode.window.showInformationMessage(
        added
          ? `Línea ${line} guardada en favoritos.`
          : `Línea ${line} eliminada de favoritos.`,
      );
    },
  );

  context.subscriptions.push(disposable);
  logger.info('[lineFavorites] addLineFavorite command registered');
}
