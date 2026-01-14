import * as vscode from 'vscode';
import * as path from 'path';

export class CategoryItem extends vscode.TreeItem {
  constructor(
    public readonly categoryName: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(categoryName, collapsibleState);

    this.tooltip = `Categoría: ${categoryName}`;
    this.iconPath = new vscode.ThemeIcon('folder');
  }

  contextValue = 'categoryItem';
}

export class FavoriteItem extends vscode.TreeItem {
  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly category: string,
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

interface FavoriteData {
  path: string;
  category: string;
}

export class FavoritesTreeDataProvider implements vscode.TreeDataProvider<CategoryItem | FavoriteItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    CategoryItem | FavoriteItem | undefined | null | void
  > = new vscode.EventEmitter<CategoryItem | FavoriteItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<CategoryItem | FavoriteItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  private favorites: Map<string, Set<string>> = new Map(); // category -> Set of file paths
  public static readonly DEFAULT_CATEGORY = 'Sin Categoría';

  constructor(private context: vscode.ExtensionContext) {
    this.loadFavorites();

    // Refresh when workspace folders change (Multi-root support)
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.refresh();
    });
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CategoryItem | FavoriteItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CategoryItem | FavoriteItem): Thenable<(CategoryItem | FavoriteItem)[]> {
    if (!element) {
      // Root level: return categories
      const categories: CategoryItem[] = [];

      // Ensure default category exists internally, but we might not show it if empty/filtered
      if (!this.favorites.has(FavoritesTreeDataProvider.DEFAULT_CATEGORY)) {
        this.favorites.set(FavoritesTreeDataProvider.DEFAULT_CATEGORY, new Set());
      }

      this.favorites.forEach((files, categoryName) => {
        // Filter: Check if this category has ANY file visible in current workspace
        let hasVisibleFiles = false;

        for (const filePath of files) {
          const uri = vscode.Uri.file(filePath);
          if (vscode.workspace.getWorkspaceFolder(uri)) {
             hasVisibleFiles = true;
             break;
          }
        }

        const isEmpty = files.size === 0;

        if (hasVisibleFiles || isEmpty) {
           categories.push(
            new CategoryItem(categoryName, vscode.TreeItemCollapsibleState.Expanded)
          );
        }
      });

      return Promise.resolve(categories);
    } else if (element instanceof CategoryItem) {
      // Category level: return files in this category
      const items: FavoriteItem[] = [];
      const files = this.favorites.get(element.categoryName) || new Set();

      files.forEach((favPath) => {
        const uri = vscode.Uri.file(favPath);
        // Filter: Only show files belonging to current workspace(s)
        if (vscode.workspace.getWorkspaceFolder(uri)) {
            items.push(new FavoriteItem(uri, element.categoryName, vscode.TreeItemCollapsibleState.None));
        }
      });

      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }

  addFavorite(uri: vscode.Uri, category?: string): void {
    const targetCategory = category || FavoritesTreeDataProvider.DEFAULT_CATEGORY;

    if (!this.favorites.has(targetCategory)) {
      this.favorites.set(targetCategory, new Set());
    }

    this.favorites.get(targetCategory)!.add(uri.fsPath);
    this.saveFavorites();
    this.refresh();
  }

  removeFavorite(uri: vscode.Uri): void {
    // Remove from all categories
    this.favorites.forEach((files) => {
      files.delete(uri.fsPath);
    });

    this.saveFavorites();
    this.refresh();
  }

  hasFavorite(uri: vscode.Uri): boolean {
    for (const files of this.favorites.values()) {
      if (files.has(uri.fsPath)) {
        return true;
      }
    }
    return false;
  }

  getCategoryForFavorite(uri: vscode.Uri): string | undefined {
    for (const [category, files] of this.favorites.entries()) {
      if (files.has(uri.fsPath)) {
        return category;
      }
    }
    return undefined;
  }

  addCategory(categoryName: string): boolean {
    if (this.favorites.has(categoryName)) {
      return false; // Category already exists
    }

    this.favorites.set(categoryName, new Set());
    this.saveFavorites();
    this.refresh();
    return true;
  }

  removeCategory(categoryName: string): void {
    const files = this.favorites.get(categoryName);

    if (files && categoryName !== FavoritesTreeDataProvider.DEFAULT_CATEGORY) {
      // Move files to default category
      const defaultFiles = this.favorites.get(FavoritesTreeDataProvider.DEFAULT_CATEGORY) || new Set();
      files.forEach((file) => defaultFiles.add(file));
      this.favorites.set(FavoritesTreeDataProvider.DEFAULT_CATEGORY, defaultFiles);

      // Remove category
      this.favorites.delete(categoryName);
      this.saveFavorites();
      this.refresh();
    }
  }

  renameCategory(oldName: string, newName: string): boolean {
    if (!this.favorites.has(oldName) || this.favorites.has(newName)) {
      return false; // Old category doesn't exist or new name already exists
    }

    if (oldName === FavoritesTreeDataProvider.DEFAULT_CATEGORY) {
      return false; // Cannot rename default category
    }

    const files = this.favorites.get(oldName)!;
    this.favorites.delete(oldName);
    this.favorites.set(newName, files);

    this.saveFavorites();
    this.refresh();
    return true;
  }

  moveFavorite(uri: vscode.Uri, newCategory: string): void {
    // Remove from current category
    this.removeFavorite(uri);

    // Add to new category
    this.addFavorite(uri, newCategory);
  }

  getCategories(): string[] {
    return Array.from(this.favorites.keys());
  }

  private loadFavorites(): void {
    // 1. Try to load new v2 format
    const storedFavorites = this.context.globalState.get<FavoriteData[]>('anfavorites.favorites.v2');

    if (storedFavorites) {
      // Load standard v2 data
      storedFavorites.forEach((fav) => {
        if (!this.favorites.has(fav.category)) {
          this.favorites.set(fav.category, new Set());
        }
        this.favorites.get(fav.category)!.add(fav.path);
      });
    } else {
      // 2. Migration: Check for v1 format
      const legacyFavorites = this.context.globalState.get<string[]>('anfavorites.favorites');

      if (legacyFavorites && legacyFavorites.length > 0) {
        console.log('[AnFavorites] Migrating legacy favorites to v2...');
        // Migrate all to default category
        const defaultSet = new Set<string>(legacyFavorites);
        this.favorites.set(FavoritesTreeDataProvider.DEFAULT_CATEGORY, defaultSet);

        // Save immediately in new format
        this.saveFavorites();

        // Optional: you might want to keep or clear the old one. We'll leave it for safety now.
      }
    }

    // Ensure default category exists
    if (!this.favorites.has(FavoritesTreeDataProvider.DEFAULT_CATEGORY)) {
      this.favorites.set(FavoritesTreeDataProvider.DEFAULT_CATEGORY, new Set());
    }
  }

  private saveFavorites(): void {
    const favoritesArray: FavoriteData[] = [];

    this.favorites.forEach((files, category) => {
      files.forEach((filePath) => {
        favoritesArray.push({ path: filePath, category });
      });
    });

    this.context.globalState.update('anfavorites.favorites.v2', favoritesArray);
  }
}
