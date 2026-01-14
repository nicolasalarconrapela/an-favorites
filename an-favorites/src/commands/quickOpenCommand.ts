import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { MRUService } from '../services/mruService';
import * as path from 'path';

class FileQuickPickItem implements vscode.QuickPickItem {
  label: string;
  resourceUri: vscode.Uri;
  description?: string;
  detail?: string;
  buttons?: vscode.QuickInputButton[];
  isFavorite: boolean;
  kind?: vscode.QuickPickItemKind;
  iconPath?: vscode.ThemeIcon;

  constructor(
    uri: vscode.Uri,
    isFavorite: boolean,
    isRecentlyOpened: boolean = false
  ) {
    this.resourceUri = uri;
    this.label = path.basename(uri.fsPath);
    this.description = vscode.workspace.asRelativePath(uri);
    this.isFavorite = isFavorite;

    // Mimic native: Recently opened often have a distinct indicator or group
    // We will use sections instead, but we could add detail
    if (isRecentlyOpened) {
       this.description = `${this.description}`;
    }

    this.updateIcon();
  }

  updateIcon() {
    // Left icon: Star if favorite (Always visible), File if not
    this.iconPath = this.isFavorite
      ? new vscode.ThemeIcon('star-full')
      : vscode.ThemeIcon.File;

    // Right button: Interactive Star (Hover only)
    this.buttons = [{
      iconPath: this.isFavorite
        ? new vscode.ThemeIcon('star-full')
        : new vscode.ThemeIcon('star-empty'),
      tooltip: this.isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos'
    }];
  }
}

export function registerQuickOpenCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any,
  mruService: MRUService
): void {
  const disposable = vscode.commands.registerCommand('anfavorites.quickOpen', async () => {
    const quickPick = vscode.window.createQuickPick<FileQuickPickItem>();
    quickPick.placeholder = 'Buscar archivos por nombre';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;

    logger.debug('QuickOpen triggered');
    quickPick.show();
    quickPick.busy = true;

    try {
      // 1. Get recent files first
      const recentPaths = mruService.getRecentFiles();
      const recentUris = recentPaths.map(p => vscode.Uri.file(p));
      const recentSet = new Set(recentPaths);

      // 2. Get all workspace files
      const allUris = await vscode.workspace.findFiles('**/*', '**/node_modules/**');

      // 3. Create items
      const recentItems = recentUris.map(uri => {
          const isFav = favoritesProvider.hasFavorite(uri);
          return new FileQuickPickItem(uri, isFav, true);
      });

      const otherItems = allUris
        .filter(uri => !recentSet.has(uri.fsPath)) // Exclude recents to avoid duplicates
        .map(uri => {
          const isFav = favoritesProvider.hasFavorite(uri);
          return new FileQuickPickItem(uri, isFav, false);
      });

      // 4. Combine with separators
      const items: any[] = [];

      if (recentItems.length > 0) {
        items.push({ label: 'recientemente abiertos', kind: vscode.QuickPickItemKind.Separator });
        items.push(...recentItems);
      }

      items.push({ label: 'archivos', kind: vscode.QuickPickItemKind.Separator });
      items.push(...otherItems);

      quickPick.items = items;
      quickPick.busy = false;

    } catch (error) {
      logger.error('Error loading files for QuickOpen', error);
      quickPick.busy = false;
    }

    // Event: Selection (Enter)
    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems[0];
      if (selected) {
        // Add to MRU
        mruService.add(selected.resourceUri.fsPath);

        vscode.window.showTextDocument(selected.resourceUri);
        quickPick.hide();
      }
    });

    // Event: Button (Star)
    quickPick.onDidTriggerItemButton(async (e) => {
      const item = e.item;
      const uri = item.resourceUri;

      if (item.isFavorite) {
        favoritesProvider.removeFavorite(uri);
        item.isFavorite = false;
      } else {
        favoritesProvider.addFavorite(uri);
        item.isFavorite = true;
      }

      item.updateIcon();

      // Force refresh item
      const index = quickPick.items.indexOf(item);
      if (index !== -1) {
        // Al actualizar la lista, VS Code puede perder la posición.
        // ESTRATEGIA: Convertimos el item clicado en el "activo".
        // Esto fuerza a VS Code a mantener el scroll en este elemento (que es lo que queremos)
        // en lugar de saltar al elemento que estaba seleccionado anteriormente (que suele ser el primero).

        const newItems = [...quickPick.items];
        newItems[index] = item;
        quickPick.items = newItems;

        quickPick.activeItems = [item];
      }
    });
  });

  context.subscriptions.push(disposable);
  logger.debug('quickOpen command registered');
}
