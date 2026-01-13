import * as vscode from 'vscode';
import * as path from 'path';

export class FavoriteItem extends vscode.TreeItem {
  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(resourceUri, collapsibleState);

    this.tooltip = resourceUri.fsPath;
    this.description = path.dirname(resourceUri.fsPath);

    // Usar el comando de VS Code para abrir el archivo
    this.command = {
      command: 'vscode.open',
      title: 'Abrir Archivo',
      arguments: [resourceUri],
    };

    // Configurar el icono basado en el tipo de archivo
    this.iconPath = vscode.ThemeIcon.File;
  }

  contextValue = 'favoriteItem';
}

export class FavoritesTreeDataProvider implements vscode.TreeDataProvider<FavoriteItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<FavoriteItem | undefined | null | void> =
    new vscode.EventEmitter<FavoriteItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<FavoriteItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private favorites: Set<string> = new Set();

  constructor(private context: vscode.ExtensionContext) {
    this.loadFavorites();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: FavoriteItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: FavoriteItem): Thenable<FavoriteItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const items: FavoriteItem[] = [];
    this.favorites.forEach((favPath) => {
      const uri = vscode.Uri.file(favPath);
      items.push(new FavoriteItem(uri, vscode.TreeItemCollapsibleState.None));
    });

    return Promise.resolve(items);
  }

  addFavorite(uri: vscode.Uri): void {
    this.favorites.add(uri.fsPath);
    this.saveFavorites();
    this.refresh();
  }

  removeFavorite(uri: vscode.Uri): void {
    this.favorites.delete(uri.fsPath);
    this.saveFavorites();
    this.refresh();
  }

  hasFavorite(uri: vscode.Uri): boolean {
    return this.favorites.has(uri.fsPath);
  }

  private loadFavorites(): void {
    const storedFavorites = this.context.globalState.get<string[]>('anfavorites.favorites', []);
    this.favorites = new Set(storedFavorites);
  }

  private saveFavorites(): void {
    this.context.globalState.update('anfavorites.favorites', Array.from(this.favorites));
  }
}
