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
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.pinFavorite',
      async (item?: FavoriteItem, selectedItems?: FavoriteItem[]) => {
        logger.debug('[commands] Pin favorite command registered');
        const itemsToProcess = (selectedItems || (item ? [item] : [])).filter(
          (i) => i instanceof FavoriteItem,
        );

        if (itemsToProcess.length === 0) {
          logger.warn('Pin favorite called without context items');
          return;
        }

        for (const i of itemsToProcess) {
          if (!provider.isPinned(i.resourceUri)) {
            provider.togglePin(i.resourceUri);
          }
        }
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.unpinFavorite',
      async (item?: FavoriteItem, selectedItems?: FavoriteItem[]) => {
        logger.debug('[commands] Unpin favorite triggered');
        const itemsToProcess = (selectedItems || (item ? [item] : [])).filter(
          (i) => i instanceof FavoriteItem,
        );

        if (itemsToProcess.length === 0) {
          logger.warn('Unpin favorite called without context items');
          return;
        }

        for (const i of itemsToProcess) {
          if (provider.isPinned(i.resourceUri)) {
            provider.togglePin(i.resourceUri);
          }
        }
      },
    ),
  );
}
