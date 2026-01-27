import * as vscode from 'vscode';
import { Logger } from '../logging/logger';
import {
  FavoritesTreeDataProvider,
  FavoriteItem,
  GroupItem,
} from '../views/FavoritesTreeDataProvider';

export function registerPinCommands(
  context: vscode.ExtensionContext,
  provider: FavoritesTreeDataProvider,
  logger: Logger,
): void {
  // Pin Favorite
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.pinFavorite',
      async (item: FavoriteItem) => {
        logger.info('[commands] Pin favorite triggered');
        if (!item || !item.resourceUri) {
          logger.warn('Pin favorite called without context item');
          return;
        }
        provider.togglePin(item.resourceUri);
      },
    ),
  );

  // Unpin Favorite
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.unpinFavorite',
      async (item: FavoriteItem) => {
        logger.info('[commands] Unpin favorite triggered');
        if (!item || !item.resourceUri) {
          logger.warn('Unpin favorite called without context item');
          return;
        }
        provider.togglePin(item.resourceUri);
      },
    ),
  );
}
