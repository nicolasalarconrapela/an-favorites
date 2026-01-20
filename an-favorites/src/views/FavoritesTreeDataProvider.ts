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
  private _fullPath: string;
  private _dirPath: string;

  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly category: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(resourceUri, collapsibleState);

    this.tooltip = resourceUri.fsPath;
    this._fullPath = resourceUri.fsPath;
    this._dirPath = path.dirname(resourceUri.fsPath);

    // Default: hide description
    this.description = undefined;

    // Usar el comando de VS Code para abrir el archivo
    this.command = {
      command: 'vscode.open',
      title: 'Abrir Archivo',
      arguments: [resourceUri],
    };

    // Configurar el icono basado en el tipo de archivo
    this.iconPath = vscode.ThemeIcon.File;
  }

  public setShowDescription(isDuplicate: boolean): void {
    this.description = isDuplicate ? this._dirPath : undefined;
  }

  contextValue = 'favoriteItem';
}

interface FavoriteData {
  path: string;
  category: string;
  addedAt?: number;
}

interface FavoriteMetadata {
  category: string;
  addedAt: number;
}

export class FavoritesTreeDataProvider implements vscode.TreeDataProvider<CategoryItem | FavoriteItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    CategoryItem | FavoriteItem | undefined | null | void
  > = new vscode.EventEmitter<CategoryItem | FavoriteItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<CategoryItem | FavoriteItem | undefined | null | void> =
    this._onDidChangeTreeData.event;

  // New structure: Map<filePath, FavoriteMetadata>
  private favorites: Map<string, FavoriteMetadata> = new Map();
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
      const categoryMap = this.getCategoryMap();

      categoryMap.forEach((filePaths, categoryName) => {
        // Filter: Check if this category has ANY file visible in current workspace
        let hasVisibleFiles = false;

        for (const filePath of filePaths) {
          const uri = vscode.Uri.file(filePath);
          if (vscode.workspace.getWorkspaceFolder(uri)) {
             hasVisibleFiles = true;
             break;
          }
        }

        const isEmpty = filePaths.length === 0;

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

      this.favorites.forEach((metadata, filePath) => {
        if (metadata.category === element.categoryName) {
          const uri = vscode.Uri.file(filePath);
          // Filter: Only show files belonging to current workspace(s)
          if (vscode.workspace.getWorkspaceFolder(uri)) {
              items.push(new FavoriteItem(uri, element.categoryName, vscode.TreeItemCollapsibleState.None));
          }
        }
      });

      // Detect name collisions and set description visibility
      const nameCounts = new Map<string, number>();

      for (const item of items) {
        const basename = path.basename(item.resourceUri.fsPath);
        nameCounts.set(basename, (nameCounts.get(basename) || 0) + 1);
      }

      for (const item of items) {
        const basename = path.basename(item.resourceUri.fsPath);
        item.setShowDescription((nameCounts.get(basename) || 0) > 1);
      }

      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }

  // Helper to get category -> filePaths mapping
  private getCategoryMap(): Map<string, string[]> {
    const categoryMap = new Map<string, string[]>();

    // Ensure default category exists
    categoryMap.set(FavoritesTreeDataProvider.DEFAULT_CATEGORY, []);

    this.favorites.forEach((metadata, filePath) => {
      if (!categoryMap.has(metadata.category)) {
        categoryMap.set(metadata.category, []);
      }
      categoryMap.get(metadata.category)!.push(filePath);
    });

    return categoryMap;
  }

  addFavorite(uri: vscode.Uri, category?: string): void {
    const targetCategory = category || FavoritesTreeDataProvider.DEFAULT_CATEGORY;
    const filePath = uri.fsPath;

    // Add or update with current timestamp
    this.favorites.set(filePath, {
      category: targetCategory,
      addedAt: Date.now()
    });

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

  getCategoryForFavorite(uri: vscode.Uri): string | undefined {
    return this.favorites.get(uri.fsPath)?.category;
  }

  addCategory(categoryName: string): boolean {
    const categoryMap = this.getCategoryMap();

    if (categoryMap.has(categoryName)) {
      return false; // Category already exists
    }

    // Category will be created implicitly when first favorite is added
    // For now, just ensure it's in our map
    this.saveFavorites();
    this.refresh();
    return true;
  }

  removeCategory(categoryName: string): void {
    if (categoryName === FavoritesTreeDataProvider.DEFAULT_CATEGORY) {
      return; // Cannot remove default category
    }

    // Move all favorites from this category to default
    this.favorites.forEach((metadata, filePath) => {
      if (metadata.category === categoryName) {
        metadata.category = FavoritesTreeDataProvider.DEFAULT_CATEGORY;
      }
    });

    this.saveFavorites();
    this.refresh();
  }

  renameCategory(oldName: string, newName: string): boolean {
    if (oldName === FavoritesTreeDataProvider.DEFAULT_CATEGORY) {
      return false; // Cannot rename default category
    }

    const categoryMap = this.getCategoryMap();
    if (!categoryMap.has(oldName) || categoryMap.has(newName)) {
      return false; // Old category doesn't exist or new name already exists
    }

    // Update all favorites in the old category
    this.favorites.forEach((metadata, filePath) => {
      if (metadata.category === oldName) {
        metadata.category = newName;
      }
    });

    this.saveFavorites();
    this.refresh();
    return true;
  }

  moveFavorite(uri: vscode.Uri, newCategory: string): void {
    const metadata = this.favorites.get(uri.fsPath);
    if (metadata) {
      metadata.category = newCategory;
      this.saveFavorites();
      this.refresh();
    }
  }

  getCategories(): string[] {
    return Array.from(this.getCategoryMap().keys());
  }

  /**
   * Get the N most recently added favorites
   */
  getRecentFavorites(count: number = 5): vscode.Uri[] {
    const allFavorites = Array.from(this.favorites.entries())
      .map(([filePath, metadata]) => ({
        uri: vscode.Uri.file(filePath),
        addedAt: metadata.addedAt
      }))
      .sort((a, b) => b.addedAt - a.addedAt) // Sort by most recent first
      .slice(0, count);

    return allFavorites.map(f => f.uri);
  }

  /**
   * Reload favorites from storage
   * Useful to ensure we have the latest data
   */
  reloadFavorites(): void {
    this.favorites.clear();
    this.loadFavorites();
  }

  private loadFavorites(): void {
    // 1. Try to load new v2 format
    const storedFavorites = this.context.globalState.get<FavoriteData[]>('anfavorites.favorites.v2');

    if (storedFavorites) {
      // Load v2 data
      storedFavorites.forEach((fav) => {
        this.favorites.set(fav.path, {
          category: fav.category,
          addedAt: fav.addedAt || Date.now() // Use stored timestamp or current time as fallback
        });
      });
    } else {
      // 2. Migration: Check for v1 format
      const legacyFavorites = this.context.globalState.get<string[]>('anfavorites.favorites');

      if (legacyFavorites && legacyFavorites.length > 0) {
        console.log('[AnFavorites] Migrating legacy favorites to v2...');
        // Migrate all to default category with current timestamp
        const now = Date.now();
        legacyFavorites.forEach((filePath, index) => {
          this.favorites.set(filePath, {
            category: FavoritesTreeDataProvider.DEFAULT_CATEGORY,
            addedAt: now - (legacyFavorites.length - index) // Preserve some ordering
          });
        });

        // Save immediately in new format
        this.saveFavorites();
      }
    }
  }

  private saveFavorites(): void {
    const favoritesArray: FavoriteData[] = [];

    this.favorites.forEach((metadata, filePath) => {
      favoritesArray.push({
        path: filePath,
        category: metadata.category,
        addedAt: metadata.addedAt
      });
    });

    this.context.globalState.update('anfavorites.favorites.v2', favoritesArray);
  }

  public async validateFavorites(): Promise<void> {
    const originalSize = this.favorites.size;
    const toDelete: string[] = [];

    // Parallel validation might be faster but sticking to sequential for safety/simplicity in this context
    // or Promise.all for better performance if list is large
    const validations = Array.from(this.favorites.keys()).map(async (filePath) => {
      try {
        const uri = vscode.Uri.file(filePath);
        await vscode.workspace.fs.stat(uri);
      } catch {
        toDelete.push(filePath);
      }
    });

    await Promise.all(validations);

    if (toDelete.length > 0) {
      toDelete.forEach(filePath => this.favorites.delete(filePath));
      this.saveFavorites();
      this.refresh();
      // Use console/logger if available, or just strict update
    }
  }
}
