import * as vscode from 'vscode';
import { FavoriteItem } from '../views/FavoritesTreeDataProvider';
import { t } from '../utils/l10n';

export function registerOpenToSideCommand(
  context: vscode.ExtensionContext,
  logger: any,
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.openToSide',
    async (item?: FavoriteItem) => {
      try {
        if (!item || !item.resourceUri) {
          logger.warn('[openToSide] Command triggered without valid item');
          return;
        }

        logger.info(
          `[openToSide] Opening file to side: ${item.resourceUri.fsPath}`,
        );

        await vscode.window.showTextDocument(item.resourceUri, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
        });
      } catch (error) {
        logger.error('[openToSide] Error opening file to side', error);
        vscode.window.showErrorMessage(
          t('Error opening file: {0}', String(error)),
        );
      }
    },
  );

  context.subscriptions.push(disposable);
  logger.info('[openToSide] Command registered');
}
