import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../logging/logger';
import { SharedStorageService } from '../services/sharedStorageService';
import { detectCollisions, safeBasenameFromUri } from '../utils/collisionUtils';
import { isExcludedPath } from '../utils/exclusionUtils';
import { runWithConcurrency } from '../utils/concurrency';

const VALIDATION_CONCURRENCY = 12;

export class GroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupName: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    isDefault: boolean = false,
  ) {
    super(groupName, collapsibleState);

    this.id = `group:${groupName}`;
    this.tooltip = `Grupo: ${groupName}`;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.contextValue = isDefault ? 'groupItem:default' : 'groupItem';
  }
}

export class FavoriteItem extends vscode.TreeItem {
  private _fullPath: string;
  private _dirPath: string;

  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly group: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly isPinned: boolean = false,
  ) {
    // ✅ IMPORTANTE:
    // NO uses `super(resourceUri, ...)` porque VS Code tiende a autogenerar
    // description/path en el árbol aunque tú lo pongas undefined.
    // Forzamos label explícito:
    super(path.basename(resourceUri.fsPath), collapsibleState);

    this.id = `favorite:${group}:${resourceUri.fsPath}`;

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
    let ctx = isPinned ? 'favoriteItem:pinned' : 'favoriteItem';
    if (group !== FavoritesTreeDataProvider.DEFAULT_GROUP) {
      ctx += ':grouped';
    }
    this.contextValue = ctx;
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

export class WorkspaceItem extends vscode.TreeItem {
  constructor(
    public readonly name: string,
    public readonly groupName: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly workspaceFolder: vscode.WorkspaceFolder,
  ) {
    super(name, collapsibleState);
    this.id = `workspace:${groupName}:${workspaceFolder.uri.toString()}`;
    this.contextValue = 'workspaceItem';
    this.iconPath = new vscode.ThemeIcon('root-folder');
    this.tooltip = workspaceFolder.uri.fsPath;
  }
}

interface FavoriteData {
  path: string;
  group: string;
  addedAt?: number;
  isPinned?: boolean;
}

interface FavoriteMetadata {
  group: string;
  addedAt: number;
  isPinned: boolean;
}

export class FavoritesTreeDataProvider
  implements
    vscode.TreeDataProvider<GroupItem | FavoriteItem | WorkspaceItem>,
    vscode.TreeDragAndDropController<GroupItem | FavoriteItem | WorkspaceItem>
{
  private _onDidChangeTreeData: vscode.EventEmitter<
    GroupItem | FavoriteItem | WorkspaceItem | undefined | null | void
  > = new vscode.EventEmitter<
    GroupItem | FavoriteItem | WorkspaceItem | undefined | null | void
  >();

  readonly onDidChangeTreeData: vscode.Event<
    GroupItem | FavoriteItem | WorkspaceItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  // Drag & Drop MIME Types
  public readonly dragMimeTypes = ['application/vnd.code.tree.favorites'];
  public readonly dropMimeTypes = [
    'application/vnd.code.tree.favorites',
    'text/uri-list',
  ];

  // Map<filePath, FavoriteMetadata>
  private favorites: Map<string, FavoriteMetadata> = new Map();
  // Set<groupName>
  private groups: Set<string> = new Set([
    FavoritesTreeDataProvider.DEFAULT_GROUP,
  ]);

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

    // Refresh when configuration changes
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (
        e.affectsConfiguration('anfavorites.multiroot.separation') ||
        e.affectsConfiguration('anfavorites.search.exclusions')
      ) {
        this.logger.info(
          '[config] relevant configuration changed -> refresh()',
        );
        this.refresh();
      }
    });

    this.logger.info(
      `[init] Provider created. favorites=${this.favorites.size}`,
    );
  }

  refresh(): void {
    this.logger.info('[tree] refresh() fired');
    this._onDidChangeTreeData.fire();
  }

  public getFavoritePaths(): string[] {
    return Array.from(this.favorites.keys());
  }

  getTreeItem(element: GroupItem | FavoriteItem): vscode.TreeItem {
    return element;
  }

  async getChildren(
    element?: GroupItem | FavoriteItem | WorkspaceItem,
  ): Promise<(GroupItem | FavoriteItem | WorkspaceItem)[]> {
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
            new GroupItem(
              groupName,
              vscode.TreeItemCollapsibleState.Expanded,
              groupName === FavoritesTreeDataProvider.DEFAULT_GROUP,
            ),
          );
        }
      });

      this.logger.info(
        `[getChildren:root] End. returnedGroups=${groups.length} in ${Date.now() - t0}ms`,
      );
      return Promise.resolve(groups);
    }

    if (element instanceof GroupItem) {
      // Group level: check multiroot separation
      const config = vscode.workspace.getConfiguration('anfavorites.multiroot');
      const separationMode = config.get<string>('separation', 'none');
      const workspaceFolders = vscode.workspace.workspaceFolders || [];
      const isMultiRoot = workspaceFolders.length > 1;

      let shouldSeparate = false;
      if (isMultiRoot) {
        if (separationMode === 'both') {
          shouldSeparate = true;
        } else if (
          separationMode === 'ungrouped' &&
          element.groupName === FavoritesTreeDataProvider.DEFAULT_GROUP
        ) {
          shouldSeparate = true;
        } else if (
          separationMode === 'groups' &&
          element.groupName !== FavoritesTreeDataProvider.DEFAULT_GROUP
        ) {
          shouldSeparate = true;
        }
      }

      if (shouldSeparate) {
        const workspaceItems: WorkspaceItem[] = [];
        for (const wf of workspaceFolders) {
          let hasFiles = false;
          this.favorites.forEach((metadata, filePath) => {
            if (metadata.group === element.groupName) {
              const uri = vscode.Uri.file(filePath);
              const fileWf = vscode.workspace.getWorkspaceFolder(uri);
              if (fileWf && fileWf.uri.toString() === wf.uri.toString()) {
                hasFiles = true;
              }
            }
          });

          if (hasFiles) {
            workspaceItems.push(
              new WorkspaceItem(
                wf.name,
                element.groupName,
                vscode.TreeItemCollapsibleState.Expanded,
                wf,
              ),
            );
          }
        }
        return Promise.resolve(workspaceItems);
      }

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
            metadata.isPinned,
          ),
        );
      });

      this.logger.info(`[getChildren:group] Collected items=${items.length}`);

      await this._resolveCollisions(items, element.groupName);

      this.logger.info(
        '[getChildren:group] ' +
          `End "${element.groupName}" returnedItems=${items.length} in ${Date.now() - t0}ms`,
      );
      return Promise.resolve(items);
    }

    if (element instanceof WorkspaceItem) {
      const items: FavoriteItem[] = [];
      this.favorites.forEach((metadata, filePath) => {
        if (metadata.group !== element.groupName) return;
        const uri = vscode.Uri.file(filePath);
        const wf = vscode.workspace.getWorkspaceFolder(uri);
        if (
          wf &&
          wf.uri.toString() === element.workspaceFolder.uri.toString()
        ) {
          items.push(
            new FavoriteItem(
              uri,
              element.groupName,
              vscode.TreeItemCollapsibleState.None,
              metadata.isPinned,
            ),
          );
        }
      });

      await this._resolveCollisions(
        items,
        `${element.groupName}:${element.name}`,
      );
      return Promise.resolve(items);
    }

    return Promise.resolve([]);
  }

  private async _resolveCollisions(
    items: FavoriteItem[],
    groupName: string,
  ): Promise<void> {
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
        `[collisions] Found ${collisions.size} colliding basenames in "${groupName}"`,
      );

      for (const item of items) {
        const basename = safeBasenameFromUri(item.resourceUri);
        if (collisions.has(basename)) {
          // Show relative directory path
          const rel = vscode.workspace.asRelativePath(item.resourceUri, false);
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
  }

  // Helper to get group -> filePaths mapping
  private getGroupMap(): Map<string, string[]> {
    const groupMap = new Map<string, string[]>();

    // 1. Initialize with explicit groups
    this.groups.forEach((g) => groupMap.set(g, []));

    // Ensure default group exists
    if (!groupMap.has(FavoritesTreeDataProvider.DEFAULT_GROUP)) {
      groupMap.set(FavoritesTreeDataProvider.DEFAULT_GROUP, []);
      this.groups.add(FavoritesTreeDataProvider.DEFAULT_GROUP);
    }

    // 2. Populate with favorites
    this.favorites.forEach((metadata, filePath) => {
      if (!groupMap.has(metadata.group)) {
        // Auto-recover missing group
        this.groups.add(metadata.group);
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
      isPinned: false,
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

  removeAllFavorites(): void {
    this.logger.info('[favorites] removeAllFavorites');
    this.favorites.clear();
    this.saveFavorites();
    this.refresh();
  }

  clearGroupItems(groupName: string): void {
    this.logger.info(`[favorites] clearGroupItems -> ${groupName}`);
    this.favorites.forEach((metadata, filePath) => {
      if (metadata.group === groupName) {
        metadata.group = FavoritesTreeDataProvider.DEFAULT_GROUP;
      }
    });

    this.saveFavorites();
    this.refresh();
  }

  resetFavoriteGroup(uri: vscode.Uri): void {
    const metadata = this.favorites.get(uri.fsPath);
    if (!metadata) return;

    this.logger.info(`[favorites] resetFavoriteGroup -> ${uri.fsPath}`);
    metadata.group = FavoritesTreeDataProvider.DEFAULT_GROUP;

    this.saveFavorites();
    this.refresh();
  }

  hasFavorite(uri: vscode.Uri): boolean {
    return this.favorites.has(uri.fsPath);
  }

  getGroupForFavorite(uri: vscode.Uri): string | undefined {
    return this.favorites.get(uri.fsPath)?.group;
  }

  deleteFavoritesInGroup(groupName: string): void {
    this.logger.info(`[favorites] deleteFavoritesInGroup -> ${groupName}`);
    const toDelete: string[] = [];

    this.favorites.forEach((metadata, filePath) => {
      if (metadata.group === groupName) {
        toDelete.push(filePath);
      }
    });

    toDelete.forEach((filePath) => this.favorites.delete(filePath));
    this.saveFavorites();
    this.refresh();
  }

  addGroup(groupName: string): boolean {
    const groupMap = this.getGroupMap();

    if (groupMap.has(groupName)) {
      this.logger.warn(`[groups] addGroup FAILED (exists) -> "${groupName}"`);
      return false;
    }

    this.logger.info(`[groups] addGroup OK -> "${groupName}"`);
    this.groups.add(groupName);
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

    this.groups.delete(groupName);
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

    this.groups.delete(oldName);
    this.groups.add(newName);

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

  togglePin(uri: vscode.Uri): void {
    const metadata = this.favorites.get(uri.fsPath);
    if (!metadata) return;

    metadata.isPinned = !metadata.isPinned;
    if (metadata.isPinned) {
      metadata.addedAt = Date.now();
    }
    this.logger.info(
      `[favorites] togglePin -> ${uri.fsPath} = ${metadata.isPinned}`,
    );
    this.saveFavorites();
    this.refresh();
  }

  isPinned(uri: vscode.Uri): boolean {
    return this.favorites.get(uri.fsPath)?.isPinned ?? false;
  }

  getPinnedFavorites(): vscode.Uri[] {
    const pinned = Array.from(this.favorites.entries())
      .filter(([_, metadata]) => metadata.isPinned)
      .sort((a, b) => (b[1].addedAt || 0) - (a[1].addedAt || 0))
      .map(([filePath]) => vscode.Uri.file(filePath));

    return pinned;
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
        addedAt: metadata.addedAt ?? 0,
      }))
      .sort((a, b) => a.addedAt - b.addedAt)
      .slice(0, count);

    this.logger.info(
      `[favorites] getRecentFavorites count=${count}`,
      allFavorites.map((f) => f.uri.fsPath),
    );
    return allFavorites.map((f) => f.uri);
  }

  // --- Drag & Drop Implementation ---

  handleDrag(
    source: (GroupItem | FavoriteItem | WorkspaceItem)[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this.logger.info(`[dnd] handleDrag sourceItems=${source.length}`);

    // Solo permitimos arrastrar FavoriteItems por ahora
    const draggedFiles = source
      .filter((item): item is FavoriteItem => item instanceof FavoriteItem)
      .map((item) => item.resourceUri.fsPath);

    if (draggedFiles.length > 0) {
      dataTransfer.set(
        'application/vnd.code.tree.favorites',
        new vscode.DataTransferItem(JSON.stringify(draggedFiles)),
      );
    }
  }

  async handleDrop(
    target: GroupItem | FavoriteItem | WorkspaceItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): Promise<void> {
    this.logger.info('[dnd] handleDrop initiated');

    // Identificar el grupo destino
    let targetGroupName: string;
    if (!target) {
      // Si se suelta en el "vacío" (root), enviamos al grupo por defecto
      targetGroupName = FavoritesTreeDataProvider.DEFAULT_GROUP;
    } else if (target instanceof GroupItem) {
      targetGroupName = target.groupName;
    } else if (target instanceof FavoriteItem) {
      targetGroupName = target.group;
    } else if (target instanceof WorkspaceItem) {
      targetGroupName = target.groupName;
    } else {
      return;
    }

    this.logger.info(`[dnd] Target group: "${targetGroupName}"`);

    // 1. Manejar movimiento interno (items arrastrados desde el mismo árbol)
    const treeItem = dataTransfer.get('application/vnd.code.tree.favorites');
    if (treeItem) {
      try {
        const filePaths = JSON.parse(treeItem.value) as string[];
        this.logger.info(
          `[dnd] Moving ${filePaths.length} internal items to "${targetGroupName}"`,
        );

        let movedCount = 0;
        filePaths.forEach((filePath) => {
          const metadata = this.favorites.get(filePath);
          if (metadata && metadata.group !== targetGroupName) {
            metadata.group = targetGroupName;
            movedCount++;
          }
        });
        this.saveFavorites();
        this.refresh();

        if (movedCount > 0) {
          vscode.window.showInformationMessage(
            `Se movieron ${movedCount} favoritos al grupo "${targetGroupName}"`,
          );
        }
        return;
      } catch (err) {
        this.logger.error('[dnd] Error parsing internal drag data', err);
        vscode.window.showErrorMessage(
          'Error al mover favoritos internamente.',
        );
      }
    }

    // 2. Manejar archivos externos (desde el Explorador de Archivos de OS o VS Code)
    const uriListItem = dataTransfer.get('text/uri-list');
    if (uriListItem) {
      try {
        // text/uri-list suele ser una lista de URIs separados por newline
        // VS Code a veces devuelve string, a veces ya procesado si usamos asString()
        const urlListResult = await uriListItem.asString();
        const uris = urlListResult.split('\r\n');

        this.logger.info(
          `[dnd] Adding ${uris.length} external items to "${targetGroupName}"`,
        );

        let addedCount = 0;
        let ignoredFoldersCount = 0;

        for (const uriStr of uris) {
          if (!uriStr.trim()) continue;
          try {
            const uri = vscode.Uri.parse(uriStr);

            // Validar si es esquemas 'file'
            if (uri.scheme === 'file') {
              try {
                // Verificar que sea un archivo y NO un directorio
                const stat = await vscode.workspace.fs.stat(uri);
                if (stat.type === vscode.FileType.File) {
                  this.addFavorite(uri, targetGroupName);
                  addedCount++;
                } else {
                  ignoredFoldersCount++;
                  this.logger.info(
                    `[dnd] Ignored directory/other: ${uri.fsPath}`,
                  );
                }
              } catch (statErr) {
                // Si falla el stat, es posible que no exista o no sea accesible
                this.logger.warn(
                  `[dnd] Could not stat URI: ${uri.fsPath}`,
                  statErr,
                );
              }
            }
          } catch (e) {
            this.logger.warn(`[dnd] Invalid URI received: ${uriStr}`);
          }
        }

        if (addedCount > 0) {
          vscode.window.showInformationMessage(
            `Se añadieron ${addedCount} archivos a "${targetGroupName}".`,
          );
        }

        if (ignoredFoldersCount > 0) {
          vscode.window.showWarningMessage(
            `Se ignoraron ${ignoredFoldersCount} carpetas (solo se permiten archivos).`,
          );
        }

        return;
      } catch (err) {
        this.logger.error('[dnd] Error processing external URIs', err);
        vscode.window.showErrorMessage('Error al procesar archivos externos.');
      }
    }
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
    const sharedGroups = this.storage.get<string[]>('anfavorites.groups');

    if (sharedGroups) {
      sharedGroups.forEach((g) => this.groups.add(g));
    }

    if (sharedData) {
      this.logger.info(
        `[storage] loadFavorites (shared) -> count=${sharedData.length}`,
      );
      sharedData.forEach((fav) => {
        const groupName = fav.group || FavoritesTreeDataProvider.DEFAULT_GROUP;

        this.favorites.set(fav.path, {
          group: groupName,
          addedAt: fav.addedAt || Date.now(),
          isPinned: !!fav.isPinned,
        });
        this.groups.add(groupName);
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
          isPinned: !!fav.isPinned,
        });
        this.groups.add(groupName);
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
            isPinned: false,
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
    const configSearch =
      vscode.workspace.getConfiguration('anfavorites.search');
    const searchExclusions = configSearch.get<string[]>('exclusions') ?? [];

    this.favorites.forEach((_, filePath) => {
      if (isExcludedPath(filePath, searchExclusions)) {
        return;
      }
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
        isPinned: metadata.isPinned,
      });
    });

    this.logger.info(
      `[storage] saveFavorites (shared) -> count=${favoritesArray.length} groups=${this.groups.size}`,
    );
    this.storage.update('anfavorites.favorites.v2', favoritesArray);
    this.storage.update('anfavorites.groups', Array.from(this.groups));
  }

  public async validateFavorites(): Promise<void> {
    const originalSize = this.favorites.size;
    const toDelete: string[] = [];
    const t0 = Date.now();

    this.logger.info(
      `[validate] validateFavorites start. size=${originalSize}`,
    );

    const favoritePaths = Array.from(this.favorites.keys());
    await runWithConcurrency(
      favoritePaths,
      VALIDATION_CONCURRENCY,
      async (filePath) => {
        try {
          const uri = vscode.Uri.file(filePath);
          await vscode.workspace.fs.stat(uri);
        } catch {
          toDelete.push(filePath);
        }
      },
    );

    this.logger.info(
      `[validate] validateFavorites done. processed=${favoritePaths.length} missing=${toDelete.length} durationMs=${Date.now() - t0}`,
    );

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

  public async validateFavoritesForPaths(
    filePaths: string[],
  ): Promise<void> {
    const uniquePaths = Array.from(
      new Set(filePaths.filter((filePath) => this.favorites.has(filePath))),
    );

    if (uniquePaths.length === 0) {
      return;
    }

    const toDelete: string[] = [];
    const t0 = Date.now();

    await runWithConcurrency(
      uniquePaths,
      VALIDATION_CONCURRENCY,
      async (filePath) => {
        try {
          const uri = vscode.Uri.file(filePath);
          await vscode.workspace.fs.stat(uri);
        } catch {
          toDelete.push(filePath);
        }
      },
    );

    this.logger.info(
      `[validate] validateFavoritesForPaths done. processed=${uniquePaths.length} missing=${toDelete.length} durationMs=${Date.now() - t0}`,
    );

    if (toDelete.length > 0) {
      this.logger.info(
        `[validate] Removing missing favorites count=${toDelete.length}`,
        toDelete,
      );

      toDelete.forEach((filePath) => this.favorites.delete(filePath));
      this.saveFavorites();
      this.refresh();
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
