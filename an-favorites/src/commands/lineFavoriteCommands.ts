import * as vscode from 'vscode';
import {
  FavoritesTreeDataProvider,
  LineFavoriteItem,
} from '../views/FavoritesTreeDataProvider';
import { Logger } from '../logging/logger';

export function registerLineFavoriteCommands(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: Logger,
): void {
  const removeDisposable = vscode.commands.registerCommand(
    'anfavorites.removeLineFavoriteItem',
    async (item?: LineFavoriteItem) => {
      if (!item) {
        logger.warn('[lineFavorites] removeLineFavoriteItem without item');
        return;
      }
      favoritesProvider.removeLineFavoriteAtPosition(
        item.resourceUri,
        item.line,
        item.column,
      );
      logger.info(
        `[lineFavorites] Removed line ${item.line}:${item.column} -> ${item.resourceUri.fsPath}`,
      );
    },
  );

  const pinDisposable = vscode.commands.registerCommand(
    'anfavorites.pinLineFavorite',
    async (item?: LineFavoriteItem) => {
      if (!item) {
        logger.warn('[lineFavorites] pinLineFavorite without item');
        return;
      }
      favoritesProvider.toggleLineFavoritePinAtPosition(
        item.resourceUri,
        item.line,
        item.column,
      );
    },
  );

  const unpinDisposable = vscode.commands.registerCommand(
    'anfavorites.unpinLineFavorite',
    async (item?: LineFavoriteItem) => {
      if (!item) {
        logger.warn('[lineFavorites] unpinLineFavorite without item');
        return;
      }
      favoritesProvider.toggleLineFavoritePinAtPosition(
        item.resourceUri,
        item.line,
        item.column,
      );
    },
  );

  const openToSideDisposable = vscode.commands.registerCommand(
    'anfavorites.openLineToSide',
    async (item?: LineFavoriteItem) => {
      if (!item) {
        logger.warn('[lineFavorites] openLineToSide without item');
        return;
      }
      try {
        const lineIndex = Math.max(0, item.line - 1);
        const columnIndex = Math.max(0, item.column - 1);
        const range = new vscode.Range(
          lineIndex,
          columnIndex,
          lineIndex,
          columnIndex,
        );
        await vscode.window.showTextDocument(item.resourceUri, {
          viewColumn: vscode.ViewColumn.Beside,
          preview: false,
          selection: range,
        });
      } catch (error) {
        logger.error('[lineFavorites] Error opening line to side', error);
        vscode.window.showErrorMessage(`Error al abrir línea: ${error}`);
      }
    },
  );

  const moveDisposable = vscode.commands.registerCommand(
    'anfavorites.moveLineFavorite',
    async (item?: LineFavoriteItem) => {
      if (!item) {
        logger.warn('[lineFavorites] moveLineFavorite without item');
        return;
      }
      const groups = favoritesProvider.getGroups();
      if (groups.length === 0) {
        vscode.window.showInformationMessage('No hay grupos disponibles.');
        return;
      }
      const currentGroup =
        favoritesProvider.getLineFavoriteGroupAtPosition(
          item.resourceUri,
          item.line,
          item.column,
        ) ??
        FavoritesTreeDataProvider.DEFAULT_GROUP;
      const selection = await vscode.window.showQuickPick(groups, {
        placeHolder: `Mover línea a grupo (actual: ${currentGroup})`,
      });
      if (!selection) {
        return;
      }
      favoritesProvider.moveLineFavoriteAtPosition(
        item.resourceUri,
        item.line,
        item.column,
        selection,
      );
    },
  );

  context.subscriptions.push(
    removeDisposable,
    pinDisposable,
    unpinDisposable,
    openToSideDisposable,
    moveDisposable,
  );
  logger.info('[lineFavorites] line favorite commands registered');
}
