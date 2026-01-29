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
      favoritesProvider.removeLineFavorite(item.resourceUri, item.line);
      logger.info(
        `[lineFavorites] Removed line ${item.line} -> ${item.resourceUri.fsPath}`,
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
      favoritesProvider.toggleLineFavoritePin(item.resourceUri, item.line);
    },
  );

  const unpinDisposable = vscode.commands.registerCommand(
    'anfavorites.unpinLineFavorite',
    async (item?: LineFavoriteItem) => {
      if (!item) {
        logger.warn('[lineFavorites] unpinLineFavorite without item');
        return;
      }
      favoritesProvider.toggleLineFavoritePin(item.resourceUri, item.line);
    },
  );

  context.subscriptions.push(removeDisposable, pinDisposable, unpinDisposable);
  logger.info('[lineFavorites] line favorite commands registered');
}
