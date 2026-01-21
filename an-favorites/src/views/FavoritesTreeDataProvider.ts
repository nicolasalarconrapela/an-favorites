import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../logging/logger';

export class CategoryItem extends vscode.TreeItem {
  constructor(
    public readonly categoryName: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(categoryName, collapsibleState);

    this.tooltip = `Categoría: ${categoryName}`;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'categoryItem';
  }
}

export class FavoriteItem extends vscode.TreeItem {
  private _fullPath: string;
  private _dirPath: string;

  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly category: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    // ✅ IMPORTANTE:
    // NO uses `super(resourceUri, ...)` porque VS Code tiende a autogenerar
    // description/path en el árbol aunque tú lo pongas undefined.
    // Forzamos label explícito:
    super(path.basename(resourceUri.fsPath), collapsibleState);

    // Mantener resourceUri para iconos/decorations/comportamiento de recurso
    this.resourceUri = resourceUri;

    this._fullPath = resourceUri.fsPath;
    this._dirPath = path.dirname(resourceUri.fsPath);

    // Tooltip siempre con path completo
    this.tooltip = this._fullPath;

    // Por defecto: ocultar description
    this.description = undefined;

    // Comando: abrir archivo
    this.command = {
      command: 'vscode.open',
      title: 'Abrir Archivo',
      arguments: [resourceUri],
    };

    this.iconPath = vscode.ThemeIcon.File;
    this.contextValue = 'favoriteItem';
  }

  /**
   * Muestra descripción solo si hay colisión.
   * Por defecto usa el directorio absoluto. Si quieres uno relativo,
   * usa setDescriptionText(...) desde el provider.
   */
  public setShowDescription(isDuplicate: boolean): void {
    this.description = isDuplicate ? this._dirPath : undefined;
  }

  /**
   * Set directo de description (útil para poner path relativo)
   */
  public setDescriptionText(text?: string): void {
    this.description = text;
  }

  public get fullPath(): string {
    return this._fullPath;
  }

  public get dirPath(): string {
    return this._dirPath;
  }
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

export class FavoritesTreeDataProvider
  implements vscode.TreeDataProvider<CategoryItem | FavoriteItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    CategoryItem | FavoriteItem | undefined | null | void
  > = new vscode.EventEmitter<CategoryItem | FavoriteItem | undefined | null | void>();

  readonly onDidChangeTreeData: vscode.Event<
    CategoryItem | FavoriteItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  // Map<filePath, FavoriteMetadata>
  private favorites: Map<string, FavoriteMetadata> = new Map();

  public static readonly DEFAULT_CATEGORY = 'Sin Categoría';



  constructor(private context: vscode.ExtensionContext, private logger: Logger) {
    this.loadFavorites();

    // Refresh when workspace folders change (Multi-root support)
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.logger.info('[workspace] Workspace folders changed -> refresh()');
      this.refresh();
    });

    this.logger.info(`[init] Provider created. favorites=${this.favorites.size}`);
  }



  refresh(): void {
    this.logger.info('[tree] refresh() fired');
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CategoryItem | FavoriteItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: CategoryItem | FavoriteItem): Thenable<(CategoryItem | FavoriteItem)[]> {
    const t0 = Date.now();

    if (!element) {
      // Root level: return categories
      const categories: CategoryItem[] = [];
      const categoryMap = this.getCategoryMap();

      const ws = (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
      this.logger.info(`[getChildren:root] Start. favorites=${this.favorites.size} categories=${categoryMap.size}`, {
        workspaceFolders: ws,
      });
      // TODO: Poder individualizar las categorias por workspace
      // TODO: Individualizar los archivos por workspace
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
        const included = hasVisibleFiles || isEmpty;

        this.logger.info(
          '[getChildren:root] ' +
          `Category "${categoryName}" -> files=${filePaths.length} hasVisibleFiles=${hasVisibleFiles} isEmpty=${isEmpty} included=${included}`
        );

        if (included) {
          categories.push(new CategoryItem(categoryName, vscode.TreeItemCollapsibleState.Expanded));
        }
      });

      this.logger.info(`[getChildren:root] End. returnedCategories=${categories.length} in ${Date.now() - t0}ms`);
      return Promise.resolve(categories);
    }

    if (element instanceof CategoryItem) {
      // Category level: return files in this category
      const items: FavoriteItem[] = [];
      this.logger.info(`[getChildren:category] Start "${element.categoryName}"`);

      this.favorites.forEach((metadata, filePath) => {
        if (metadata.category !== element.categoryName) return;

        const uri = vscode.Uri.file(filePath);

        // Filter: Only show files belonging to current workspace(s)
        const wf = vscode.workspace.getWorkspaceFolder(uri);
        if (!wf) {
          this.logger.info(`[getChildren:category] EXCLUDED (not in workspace): ${filePath}`);
          return;
        }

        items.push(new FavoriteItem(uri, element.categoryName, vscode.TreeItemCollapsibleState.None));
      });

      this.logger.info(`[getChildren:category] Collected items=${items.length}`);

      // ✅ Detect name collisions and set description visibility
      // Mejorado: agrupa por basename normalizado (case-insensitive) para Windows/macOS
      const byName = new Map<string, FavoriteItem[]>();

      for (const item of items) {
        const key = path.basename(item.resourceUri.fsPath).toLowerCase();
        const bucket = byName.get(key);
        if (bucket) bucket.push(item);
        else byName.set(key, [item]);
      }

      // Log: colisiones detectadas
      const collisions = Array.from(byName.entries())
        .filter(([_, bucket]) => bucket.length > 1)
        .map(([name, bucket]) => ({
          name,
          count: bucket.length,
          files: bucket.map((b) => b.resourceUri.fsPath),
        }));

      this.logger.info(`[collisions] Found collisions=${collisions.length} in "${element.categoryName}"`, collisions);

      // Decide description por item
      for (const [nameKey, bucket] of byName.entries()) {
        const isDup = bucket.length > 1;

        for (const item of bucket) {
          if (!isDup) {
            item.setShowDescription(false);
            // Debug fino: confirmar que description queda undefined
            this.logger.info(`[collisions] OK  "${nameKey}" -> description OFF`, {
              file: item.resourceUri.fsPath,
              description: item.description,
            });
            continue;
          }

          // ✅ Cuando hay duplicado, mostrar directorio relativo al workspace (mejor UX)
          const rel = vscode.workspace.asRelativePath(item.resourceUri, false);
          const relDir = path.dirname(rel);

          item.setDescriptionText(relDir);

          this.logger.info(`[collisions] DUP "${nameKey}" -> description ON`, {
            file: item.resourceUri.fsPath,
            description: item.description,
          });
        }
      }

      this.logger.info(
        '[getChildren:category] ' +
        `End "${element.categoryName}" returnedItems=${items.length} in ${Date.now() - t0}ms`
      );
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

    this.logger.info(`[favorites] addFavorite -> ${filePath}`, { category: targetCategory });

    // Add or update with current timestamp
    this.favorites.set(filePath, {
      category: targetCategory,
      addedAt: Date.now(),
    });

    this.saveFavorites();
    this.refresh();
  }

  removeFavorite(uri: vscode.Uri): void {
    this.logger.info(`[favorites] removeFavorite -> ${uri.fsPath}`);
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
      this.logger.warn(`[categories] addCategory FAILED (exists) -> "${categoryName}"`);
      return false;
    }

    // Nota: con tu diseño actual, la categoría “real” existe si hay items;
    // aquí solo refrescamos.
    this.logger.info(`[categories] addCategory OK -> "${categoryName}" (implicit until used)`);
    this.saveFavorites();
    this.refresh();
    return true;
  }

  removeCategory(categoryName: string): void {
    if (categoryName === FavoritesTreeDataProvider.DEFAULT_CATEGORY) {
      this.logger.warn(`[categories] removeCategory IGNORED (default) -> "${categoryName}"`);
      return;
    }

    this.logger.info(`[categories] removeCategory -> "${categoryName}" (move to default)`);

    // Move all favorites from this category to default
    this.favorites.forEach((metadata, filePath) => {
      if (metadata.category === categoryName) {
        metadata.category = FavoritesTreeDataProvider.DEFAULT_CATEGORY;
        this.logger.info(`[categories] Moved favorite to default`, { filePath });
      }
    });

    this.saveFavorites();
    this.refresh();
  }

  renameCategory(oldName: string, newName: string): boolean {
    if (oldName === FavoritesTreeDataProvider.DEFAULT_CATEGORY) {
      this.logger.warn(`[categories] renameCategory FAILED (default) -> "${oldName}"`);
      return false;
    }

    const categoryMap = this.getCategoryMap();
    if (!categoryMap.has(oldName) || categoryMap.has(newName)) {
      this.logger.warn(`[categories] renameCategory FAILED -> "${oldName}" to "${newName}"`, {
        oldExists: categoryMap.has(oldName),
        newExists: categoryMap.has(newName),
      });
      return false;
    }

    this.logger.info(`[categories] renameCategory -> "${oldName}" => "${newName}"`);

    // Update all favorites in the old category
    this.favorites.forEach((metadata, filePath) => {
      if (metadata.category === oldName) {
        metadata.category = newName;
        this.logger.info(`[categories] Updated favorite category`, { filePath, newName });
      }
    });

    this.saveFavorites();
    this.refresh();
    return true;
  }

  moveFavorite(uri: vscode.Uri, newCategory: string): void {
    const metadata = this.favorites.get(uri.fsPath);
    if (!metadata) {
      this.logger.warn(`[favorites] moveFavorite FAILED (not found) -> ${uri.fsPath}`);
      return;
    }

    this.logger.info(`[favorites] moveFavorite -> ${uri.fsPath}`, { from: metadata.category, to: newCategory });
    metadata.category = newCategory;

    this.saveFavorites();
    this.refresh();
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
        addedAt: metadata.addedAt,
      }))
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, count);

    this.logger.info(`[favorites] getRecentFavorites count=${count}`, allFavorites.map((f) => f.uri.fsPath));
    return allFavorites.map((f) => f.uri);
  }

  /**
   * Reload favorites from storage
   */
  reloadFavorites(): void {
    this.logger.info('[storage] reloadFavorites()');
    this.favorites.clear();
    this.loadFavorites();
  }

  private loadFavorites(): void {
    // 1) Try v2
    const storedFavorites = this.context.globalState.get<FavoriteData[]>('anfavorites.favorites.v2');
    this.logger.info('[storage] storedFavorites', storedFavorites);
    if (storedFavorites) {
      this.logger.info(`[storage] loadFavorites v2 -> count=${storedFavorites.length}`);

      storedFavorites.forEach((fav) => {
        this.favorites.set(fav.path, {
          category: fav.category,
          addedAt: fav.addedAt || Date.now(),
        });
      });

      this.checkForDuplicateNames();
      return;
    }

    // 2) Migration from v1
    const legacyFavorites = this.context.globalState.get<string[]>('anfavorites.favorites');

    if (legacyFavorites && legacyFavorites.length > 0) {
      this.logger.info(`[storage] Migrating v1 -> v2. count=${legacyFavorites.length}`);

      const now = Date.now();
      legacyFavorites.forEach((filePath, index) => {
        this.favorites.set(filePath, {
          category: FavoritesTreeDataProvider.DEFAULT_CATEGORY,
          // preserva algo de ordering
          addedAt: now - (legacyFavorites.length - index),
        });
      });

      this.saveFavorites();
      this.checkForDuplicateNames();
      return;
    }

    this.logger.info('[storage] No favorites found (v1/v2 empty)');
    this.checkForDuplicateNames();
  }

  /**
   * Verifica y reporta nombres duplicados después de cargar favoritos
   */
  private checkForDuplicateNames(): void {
    const nameMap = new Map<string, string[]>();

    this.favorites.forEach((_, filePath) => {
      const basename = path.basename(filePath);
      const existing = nameMap.get(basename);
      if (existing) {
        existing.push(filePath);
      } else {
        nameMap.set(basename, [filePath]);
      }
    });

    const duplicates = Array.from(nameMap.entries())
      .filter(([_, paths]) => paths.length > 1)
      .map(([name, paths]) => ({ name, count: paths.length, paths }));

    if (duplicates.length > 0) {
      this.logger.warn(`[duplicates] Found ${duplicates.length} duplicate basenames after load`, duplicates);
    } else {
      this.logger.info('[duplicates] No duplicate basenames found');
    }
  }

  private saveFavorites(): void {
    const favoritesArray: FavoriteData[] = [];

    this.favorites.forEach((metadata, filePath) => {
      favoritesArray.push({
        path: filePath,
        category: metadata.category,
        addedAt: metadata.addedAt,
      });
    });

    this.logger.info(`[storage] saveFavorites v2 -> count=${favoritesArray.length}`);
    this.context.globalState.update('anfavorites.favorites.v2', favoritesArray);
  }

  public async validateFavorites(): Promise<void> {
    const originalSize = this.favorites.size;
    const toDelete: string[] = [];

    this.logger.info(`[validate] validateFavorites start. size=${originalSize}`);

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
      this.logger.info(`[validate] Removing missing favorites count=${toDelete.length}`, toDelete);

      toDelete.forEach((filePath) => this.favorites.delete(filePath));
      this.saveFavorites();
      this.refresh();
    } else {
      this.logger.info('[validate] No missing favorites found');
    }
  }

  public updatePath(oldPath: string, newPath: string): void {
    const metadata = this.favorites.get(oldPath);
    if (!metadata) {
      this.logger.warn(`[favorites] updatePath FAILED (not found) -> ${oldPath}`);
      return;
    }

    this.logger.info(`[favorites] updatePath -> ${oldPath} => ${newPath}`, { category: metadata.category });

    this.favorites.delete(oldPath);
    this.favorites.set(newPath, metadata);

    this.saveFavorites();
    this.refresh();
  }
}
