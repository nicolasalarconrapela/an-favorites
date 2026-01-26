import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../logging/logger';
import { SharedStorageService } from '../services/sharedStorageService';
import { detectCollisions, safeBasenameFromUri } from '../utils/collisionUtils';

export class GroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupName: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(groupName, collapsibleState);

    this.tooltip = `Grupo: ${groupName}`;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = 'groupItem';
  }
}

export class FavoriteItem extends vscode.TreeItem {
  private _fullPath: string;
  private _dirPath: string;

  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly group: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
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

    this.command = {
      command: 'vscode.open',
      title: 'Abrir Archivo',
      arguments: [
        resourceUri,
        {
          preview: false,
        },
      ],
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
  group: string;
  addedAt?: number;
}

interface FavoriteMetadata {
  group: string;
  addedAt: number;
}

export class FavoritesTreeDataProvider implements vscode.TreeDataProvider<
  GroupItem | FavoriteItem
> {
  private _onDidChangeTreeData: vscode.EventEmitter<
    GroupItem | FavoriteItem | undefined | null | void
  > = new vscode.EventEmitter<
    GroupItem | FavoriteItem | undefined | null | void
  >();

  readonly onDidChangeTreeData: vscode.Event<
    GroupItem | FavoriteItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  // Map<filePath, FavoriteMetadata>
  private favorites: Map<string, FavoriteMetadata> = new Map();

  public static readonly DEFAULT_GROUP = 'Sin Grupo';

  constructor(
    private context: vscode.ExtensionContext,
    private logger: Logger,
    private storage: SharedStorageService,
  ) {
    this.loadFavorites();
    this.storage.onDidChange(() => {
      this.logger.info('[storage] External change detected -> reloading');
      this.reloadFavorites();
      this.refresh();
    });

    // Refresh when workspace folders change (Multi-root support)
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.logger.info('[workspace] Workspace folders changed -> refresh()');
      this.refresh();
    });

    this.logger.info(
      `[init] Provider created. favorites=${this.favorites.size}`,
    );
  }

  refresh(): void {
    this.logger.info('[tree] refresh() fired');
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: GroupItem | FavoriteItem): vscode.TreeItem {
    return element;
  }

  async getChildren(
    element?: GroupItem | FavoriteItem,
  ): Promise<(GroupItem | FavoriteItem)[]> {
    const t0 = Date.now();

    if (!element) {
      // Root level: return groups
      const groups: GroupItem[] = [];
      const groupMap = this.getGroupMap();

      const ws = (vscode.workspace.workspaceFolders ?? []).map(
        (f) => f.uri.fsPath,
      );
      this.logger.info(
        `[getChildren:root] Start. favorites=${this.favorites.size} groups=${groupMap.size}`,
        { workspaceFolders: ws },
      );
      // TODO: Poder individualizar los grupos por workspace
      // TODO: Individualizar los archivos por workspace
      groupMap.forEach((filePaths, groupName) => {
        // Filter: Check if this group has ANY file visible in current workspace
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
            `Group "${groupName}" -> files=${filePaths.length} hasVisibleFiles=${hasVisibleFiles} isEmpty=${isEmpty} included=${included}`,
        );

        if (included) {
          groups.push(
            new GroupItem(groupName, vscode.TreeItemCollapsibleState.Expanded),
          );
        }
      });

      this.logger.info(
        `[getChildren:root] End. returnedGroups=${groups.length} in ${Date.now() - t0}ms`,
      );
      return Promise.resolve(groups);
    }

    if (element instanceof GroupItem) {
      // Group level: return files in this group
      const items: FavoriteItem[] = [];
      this.logger.info(`[getChildren:group] Start "${element.groupName}"`);

      this.favorites.forEach((metadata, filePath) => {
        if (metadata.group !== element.groupName) return;

        const uri = vscode.Uri.file(filePath);

        // Filter: Only show files belonging to current workspace(s)
        const wf = vscode.workspace.getWorkspaceFolder(uri);
        if (!wf) {
          this.logger.info(
            `[getChildren:group] EXCLUDED (not in workspace): ${filePath}`,
          );
          return;
        }

        items.push(
          new FavoriteItem(
            uri,
            element.groupName,
            vscode.TreeItemCollapsibleState.None,
          ),
        );
      });

      this.logger.info(`[getChildren:group] Collected items=${items.length}`);

      // ✅ Detect name collisions and set description visibility (using workspace-wide check)
      const allUris = items.map((i) => i.resourceUri);

      // Read config/state for exclusions
      const configSearch =
        vscode.workspace.getConfiguration('anfavorites.search');
      const searchExclusions = configSearch.get<string[]>('exclusions', [
        '**/node_modules/**',
      ]);

      try {
        const collisions = await detectCollisions(
          allUris,
          searchExclusions,
          this.logger,
        );

        this.logger.info(
          `[collisions] Found ${collisions.size} colliding basenames in "${element.groupName}"`,
        );

        for (const item of items) {
          const basename = safeBasenameFromUri(item.resourceUri);
          if (collisions.has(basename)) {
            // Show relative directory path
            const rel = vscode.workspace.asRelativePath(
              item.resourceUri,
              false,
            );
            const relDir = path.dirname(rel);
            item.setDescriptionText(relDir);
          } else {
            item.setShowDescription(false);
          }
        }
      } catch (err) {
        this.logger.error(
          '[collisions] Error detecting collisions in tree view',
          err,
        );
      }

      this.logger.info(
        '[getChildren:group] ' +
          `End "${element.groupName}" returnedItems=${items.length} in ${Date.now() - t0}ms`,
      );
      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }

  // Helper to get group -> filePaths mapping
  private getGroupMap(): Map<string, string[]> {
    const groupMap = new Map<string, string[]>();

    // Ensure default group exists
    groupMap.set(FavoritesTreeDataProvider.DEFAULT_GROUP, []);

    this.favorites.forEach((metadata, filePath) => {
      if (!groupMap.has(metadata.group)) {
        groupMap.set(metadata.group, []);
      }
      groupMap.get(metadata.group)!.push(filePath);
    });

    return groupMap;
  }

  addFavorite(uri: vscode.Uri, group?: string): void {
    const targetGroup = group || FavoritesTreeDataProvider.DEFAULT_GROUP;
    const filePath = uri.fsPath;

    this.logger.info(`[favorites] addFavorite -> ${filePath}`, {
      group: targetGroup,
    });

    // Add or update with current timestamp
    this.favorites.set(filePath, {
      group: targetGroup,
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

  getGroupForFavorite(uri: vscode.Uri): string | undefined {
    return this.favorites.get(uri.fsPath)?.group;
  }

  addGroup(groupName: string): boolean {
    const groupMap = this.getGroupMap();

    if (groupMap.has(groupName)) {
      this.logger.warn(`[groups] addGroup FAILED (exists) -> "${groupName}"`);
      return false;
    }

    this.logger.info(
      `[groups] addGroup OK -> "${groupName}" (implicit until used)`,
    );
    this.saveFavorites();
    this.refresh();
    return true;
  }

  removeGroup(groupName: string): void {
    if (groupName === FavoritesTreeDataProvider.DEFAULT_GROUP) {
      this.logger.warn(
        `[groups] removeGroup IGNORED (default) -> "${groupName}"`,
      );
      return;
    }

    this.logger.info(
      `[groups] removeGroup -> "${groupName}" (move to default)`,
    );

    // Move all favorites from this group to default
    this.favorites.forEach((metadata, filePath) => {
      if (metadata.group === groupName) {
        metadata.group = FavoritesTreeDataProvider.DEFAULT_GROUP;
        this.logger.info(`[groups] Moved favorite to default`, {
          filePath,
        });
      }
    });

    this.saveFavorites();
    this.refresh();
  }

  renameGroup(oldName: string, newName: string): boolean {
    if (oldName === FavoritesTreeDataProvider.DEFAULT_GROUP) {
      this.logger.warn(`[groups] renameGroup FAILED (default) -> "${oldName}"`);
      return false;
    }

    const groupMap = this.getGroupMap();
    if (!groupMap.has(oldName) || groupMap.has(newName)) {
      this.logger.warn(
        `[groups] renameGroup FAILED -> "${oldName}" to "${newName}"`,
        {
          oldExists: groupMap.has(oldName),
          newExists: groupMap.has(newName),
        },
      );
      return false;
    }

    this.logger.info(`[groups] renameGroup -> "${oldName}" => "${newName}"`);

    // Update all favorites in the old group
    this.favorites.forEach((metadata, filePath) => {
      if (metadata.group === oldName) {
        metadata.group = newName;
        this.logger.info(`[groups] Updated favorite group`, {
          filePath,
          newName,
        });
      }
    });

    this.saveFavorites();
    this.refresh();
    return true;
  }

  moveFavorite(uri: vscode.Uri, newGroup: string): void {
    const metadata = this.favorites.get(uri.fsPath);
    if (!metadata) {
      this.logger.warn(
        `[favorites] moveFavorite FAILED (not found) -> ${uri.fsPath}`,
      );
      return;
    }

    this.logger.info(`[favorites] moveFavorite -> ${uri.fsPath}`, {
      from: metadata.group,
      to: newGroup,
    });
    metadata.group = newGroup;

    this.saveFavorites();
    this.refresh();
  }

  getGroups(): string[] {
    return Array.from(this.getGroupMap().keys());
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

    this.logger.info(
      `[favorites] getRecentFavorites count=${count}`,
      allFavorites.map((f) => f.uri.fsPath),
    );
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
    // 1) Try shared storage first
    const sharedData = this.storage.get<FavoriteData[]>(
      'anfavorites.favorites.v2',
    );
    if (sharedData) {
      this.logger.info(
        `[storage] loadFavorites (shared) -> count=${sharedData.length}`,
      );
      sharedData.forEach((fav) => {
        const groupName = fav.group || FavoritesTreeDataProvider.DEFAULT_GROUP;

        this.favorites.set(fav.path, {
          group: groupName,
          addedAt: fav.addedAt || Date.now(),
        });
      });
      this.checkForDuplicateNames();
      return;
    }

    // 2) Migration from WORKSPACE v2 -> SHARED
    const workspaceStored = this.context.workspaceState.get<FavoriteData[]>(
      'anfavorites.favorites.v2',
    );
    if (workspaceStored && workspaceStored.length > 0) {
      this.logger.info(
        `[storage] Migrating workspace v2 -> shared. Total=${workspaceStored.length}`,
      );
      workspaceStored.forEach((fav) => {
        const groupName = fav.group || FavoritesTreeDataProvider.DEFAULT_GROUP;
        this.favorites.set(fav.path, {
          group: groupName,
          addedAt: fav.addedAt || Date.now(),
        });
      });
      this.saveFavorites(); // Save to shared storage
      this.checkForDuplicateNames();
      return;
    }

    // 3) Migration from v1 (legacy global) -> SHARED
    const legacyFavorites = this.context.globalState.get<string[]>(
      'anfavorites.favorites',
    );
    if (legacyFavorites && legacyFavorites.length > 0) {
      this.logger.info(
        `[storage] Migrating v1 (legacy) -> workspace. Total legacy=${legacyFavorites.length}`,
      );

      const now = Date.now();
      let importedCount = 0;
      legacyFavorites.forEach((filePath, index) => {
        const uri = vscode.Uri.file(filePath);
        if (vscode.workspace.getWorkspaceFolder(uri)) {
          this.favorites.set(filePath, {
            group: FavoritesTreeDataProvider.DEFAULT_GROUP,
            addedAt: now - (legacyFavorites.length - index),
          });
          importedCount++;
        }
      });

      if (importedCount > 0) {
        this.saveFavorites();
        this.logger.info(
          `[storage] Migration v1 complete. Imported ${importedCount} favorites.`,
        );
      }

      this.checkForDuplicateNames();
      return;
    }

    this.logger.info('[storage] No favorites found (shared or migrated)');
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
      this.logger.warn(
        `[duplicates] Found ${duplicates.length} duplicate basenames after load`,
        duplicates,
      );
    } else {
      this.logger.info('[duplicates] No duplicate basenames found');
    }
  }

  private saveFavorites(): void {
    const favoritesArray: any[] = [];

    this.favorites.forEach((metadata, filePath) => {
      favoritesArray.push({
        path: filePath,
        group: metadata.group,
        addedAt: metadata.addedAt,
      });
    });

    this.logger.info(
      `[storage] saveFavorites (shared) -> count=${favoritesArray.length}`,
    );
    this.storage.update('anfavorites.favorites.v2', favoritesArray);
  }

  public async validateFavorites(): Promise<void> {
    const originalSize = this.favorites.size;
    const toDelete: string[] = [];

    this.logger.info(
      `[validate] validateFavorites start. size=${originalSize}`,
    );

    const validations = Array.from(this.favorites.keys()).map(
      async (filePath) => {
        try {
          const uri = vscode.Uri.file(filePath);
          await vscode.workspace.fs.stat(uri);
        } catch {
          toDelete.push(filePath);
        }
      },
    );

    await Promise.all(validations);

    if (toDelete.length > 0) {
      this.logger.info(
        `[validate] Removing missing favorites count=${toDelete.length}`,
        toDelete,
      );

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
      this.logger.warn(
        `[favorites] updatePath FAILED (not found) -> ${oldPath}`,
      );
      return;
    }

    this.logger.info(`[favorites] updatePath -> ${oldPath} => ${newPath}`, {
      group: metadata.group,
    });

    this.favorites.delete(oldPath);
    this.favorites.set(newPath, metadata);

    this.saveFavorites();
    this.refresh();
  }
}
