import * as vscode from 'vscode';
import { FavoriteItem } from '../views/FavoritesTreeDataProvider';
import { Logger } from '../logging/logger';
import { t } from '../utils/l10n';

export function registerOpenToSideCommand(
  context: vscode.ExtensionContext,
  logger: Logger,
): void {
  const log = logger.withContext?.({ scope: 'OpenToSideCommand' }) ?? logger;
  const disposable = vscode.commands.registerCommand(
    'anfavorites.openToSide',
    async (item?: FavoriteItem) => {
      try {
        if (!item || !item.resourceUri) {
          log.warn('Command triggered without a valid favorite item');
          return;
        }

        log.info('Opening favorite to side', {
          filePath: item.resourceUri.fsPath,
        });

        // Reuse existing tab if the file is already open
        const existingEditor = vscode.window.visibleTextEditors.find(
          (editor) =>
            editor.document.uri.toString() === item.resourceUri.toString(),
        );
        if (existingEditor) {
          log.debug('Reusing visible editor', {
            filePath: item.resourceUri.fsPath,
            viewColumn: existingEditor.viewColumn,
          });
          await vscode.window.showTextDocument(existingEditor.document, {
            preview: false,
            viewColumn: existingEditor.viewColumn,
          });
        } else {
          log.debug('Opening file in beside column', {
            filePath: item.resourceUri.fsPath,
          });
          await vscode.window.showTextDocument(item.resourceUri, {
            viewColumn: vscode.ViewColumn.Beside,
            preview: false,
          });
        }
      } catch (error) {
        log.error('Failed to open favorite to side', error);
        vscode.window.showErrorMessage(
          t('Error opening file: {0}', String(error)),
        );
      }
    },
  );

  context.subscriptions.push(disposable);
  log.debug('Command registered');
}
