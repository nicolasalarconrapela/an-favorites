import * as vscode from 'vscode';
import { FavoriteItem } from '../views/FavoritesTreeDataProvider';

export function registerOpenToSideCommand(
  context: vscode.ExtensionContext,
  logger: any,
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.openToSide',
    async (item?: FavoriteItem) => {
      try {
        if (!item || !item.favoriteUri) {
          logger.warn('[openToSide] Command triggered without valid item');
          return;
        }

        logger.info(
          `[openToSide] Opening file to side: ${item.favoriteUri.fsPath}`,
        );

        await vscode.window.showTextDocument(item.favoriteUri, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
        });
      } catch (error) {
        logger.error('[openToSide] Error opening file to side', error);
        vscode.window.showErrorMessage(`Error al abrir archivo: ${error}`);
      }
    },
  );

  context.subscriptions.push(disposable);
  logger.info('[openToSide] Command registered');
}
