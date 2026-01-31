import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../logging/logger';
import { SharedStorageService } from '../services/sharedStorageService';
import { applyCollisionLabels } from '../utils/collisionUtils';
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
    super(path.basename(resourceUri.fsPath), collapsibleState);

    this.id = `favorite:${group}:${resourceUri.fsPath}`;

    this.resourceUri = resourceUri;

    this._fullPath = resourceUri.fsPath;
    this._dirPath = path.dirname(resourceUri.fsPath);

    this.tooltip = this._fullPath;

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

  public setShowDescription(isDuplicate: boolean): void {
    this.description = isDuplicate ? this._dirPath : undefined;
  }

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

export class LineFavoriteItem extends vscode.TreeItem {
  private _fullPath: string;
  private _dirPath: string;

  constructor(
    public readonly resourceUri: vscode.Uri,
    public readonly line: number,
    public readonly isPinned: boolean,
  ) {
    super(
      `${path.basename(resourceUri.fsPath)}:${line}`,
      vscode.TreeItemCollapsibleState.None,
    );

    this.id = `favorite-line:${resourceUri.fsPath}:${line}`;
    this.resourceUri = resourceUri;
    this._fullPath = resourceUri.fsPath;
    this._dirPath = path.dirname(resourceUri.fsPath);
    this.tooltip = `${this._fullPath}:${line}`;
    this.description = undefined;
    this.iconPath = new vscode.ThemeIcon(isPinned ? 'pin' : 'bookmark');
    this.contextValue = isPinned ? 'lineFavoriteItem:pinned' : 'lineFavoriteItem';

    const lineIndex = Math.max(0, line - 1);
    const range = new vscode.Range(lineIndex, 0, lineIndex, 0);
    this.command = {
      command: 'vscode.open',
      title: 'Abrir Archivo',
      arguments: [
        resourceUri,
        {
          preview: false,
          selection: range,
        },
      ],
    };
  }

  public setShowDescription(isDuplicate: boolean): void {
    this.description = isDuplicate ? this._dirPath : undefined;
  }

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

interface LineFavoriteData {
  path: string;
  line: number;
  group: string;
  addedAt?: number;
  isPinned?: boolean;
}

export class FavoritesTreeDataProvider
  implements
    vscode.TreeDataProvider<
      GroupItem | FavoriteItem | WorkspaceItem | LineFavoriteItem
    >,
    vscode.TreeDragAndDropController<
      GroupItem | FavoriteItem | WorkspaceItem | LineFavoriteItem
    >,
    vscode.Disposable
{
  private readonly disposables: vscode.Disposable[] = [];
  private _onDidChangeTreeData: vscode.EventEmitter<
    GroupItem | FavoriteItem | WorkspaceItem | LineFavoriteItem | undefined | null | void
  > = new vscode.EventEmitter<
    GroupItem | FavoriteItem | WorkspaceItem | LineFavoriteItem | undefined | null | void
  >();

  readonly onDidChangeTreeData: vscode.Event<
    GroupItem | FavoriteItem | WorkspaceItem | LineFavoriteItem | undefined | null | void
  > = this._onDidChangeTreeData.event;

  public readonly dragMimeTypes = ['application/vnd.code.tree.favorites'];
  public readonly dropMimeTypes = [
    'application/vnd.code.tree.favorites',
    'text/uri-list',
  ];

  private favorites: Map<string, FavoriteMetadata> = new Map();
  private lineFavorites: Map<
    string,
    Map<number, { addedAt: number; isPinned: boolean; group: string }>
  > = new Map();

  private groups: Set<string> = new Set([
    FavoritesTreeDataProvider.DEFAULT_GROUP,
  ]);

  public static readonly DEFAULT_GROUP = 'Sin Grupo';
  private static readonly LINE_FAVORITES_KEY = 'anfavorites.lineFavorites.v1';

  constructor(
    private context: vscode.ExtensionContext,
    private logger: Logger,
    private storage: SharedStorageService,
  ) {
    this.loadFavorites();
    this.loadLineFavorites();
    this.disposables.push(
      this.storage.onDidChange(() => {
        this.logger.info('[storage] External change detected -> reloading');
        this.reloadFavorites();
        this.reloadLineFavorites();
        this.refresh();
      }),
    );


    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.logger.info('[workspace] Workspace folders changed -> refresh()');
        this.refresh();
      }),
    );


    this.disposables.push(
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
      }),
    );

    this.logger.info(
      `[init] Provider created. favorites=${this.favorites.size}`,
    );
  }

  refresh(): void {
    this.logger.debug('[tree] refresh() fired');
    this._onDidChangeTreeData.fire();
  }

  public getFavoritePaths(): string[] {
    return Array.from(this.favorites.keys());
  }

  public getLineFavoritePaths(): string[] {
    return Array.from(this.lineFavorites.keys());
  }

  getTreeItem(
    element: GroupItem | FavoriteItem | WorkspaceItem | LineFavoriteItem,
  ): vscode.TreeItem {
    return element;
  }

  async getChildren(
    element?: GroupItem | FavoriteItem | WorkspaceItem | LineFavoriteItem,
  ): Promise<(GroupItem | FavoriteItem | WorkspaceItem | LineFavoriteItem)[]> {
    const t0 = Date.now();

    if (!element) {
      const groups: GroupItem[] = [];
      const groupMap = this.getGroupMap();

      const ws = (vscode.workspace.workspaceFolders ?? []).map(
        (f) => f.uri.fsPath,
      );
      this.logger.debug(
        `[getChildren:root] Start. favorites=${this.favorites.size} groups=${groupMap.size}`,
        { workspaceFolders: ws },
      );

      groupMap.forEach((filePaths, groupName) => {
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

        this.logger.debug(
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

      this.logger.debug(
        `[getChildren:root] End. returnedGroups=${groups.length} in ${Date.now() - t0}ms`,
      );
      return Promise.resolve(groups);
    }

    if (element instanceof GroupItem) {
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

      const items: (FavoriteItem | LineFavoriteItem)[] = [];
      this.logger.debug(`[getChildren:group] Start "${element.groupName}"`);

      this.favorites.forEach((metadata, filePath) => {
        if (metadata.group !== element.groupName) return;

        const uri = vscode.Uri.file(filePath);

        const wf = vscode.workspace.getWorkspaceFolder(uri);
        if (!wf) {
          this.logger.debug(
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

      this.lineFavorites.forEach((lineMap, filePath) => {
        const uri = vscode.Uri.file(filePath);
        const wf = vscode.workspace.getWorkspaceFolder(uri);
        if (!wf) {
          return;
        }
        lineMap.forEach((metadata, line) => {
          if (metadata.group !== element.groupName) {
            return;
          }
          items.push(new LineFavoriteItem(uri, line, metadata.isPinned));
        });
      });

      this.logger.debug(`[getChildren:group] Collected items=${items.length}`);

      await this._resolveCollisions(items, element.groupName);

      this.logger.debug(
        '[getChildren:group] ' +
          `End "${element.groupName}" returnedItems=${items.length} in ${Date.now() - t0}ms`,
      );
      return Promise.resolve(items);
    }

    if (element instanceof WorkspaceItem) {
      const items: (FavoriteItem | LineFavoriteItem)[] = [];
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

      this.lineFavorites.forEach((lineMap, filePath) => {
        const uri = vscode.Uri.file(filePath);
        const wf = vscode.workspace.getWorkspaceFolder(uri);
        if (
          wf &&
          wf.uri.toString() === element.workspaceFolder.uri.toString()
        ) {
          lineMap.forEach((metadata, line) => {
            if (metadata.group !== element.groupName) {
              return;
            }
            items.push(new LineFavoriteItem(uri, line, metadata.isPinned));
          });
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
    items: (FavoriteItem | LineFavoriteItem)[],
    groupName: string,
  ): Promise<void> {
    const configSearch =
      vscode.workspace.getConfiguration('anfavorites.search');
    const searchExclusions = configSearch.get<string[]>('exclusions', [
      '**/node_modules/**',
    ]);

    try {
      await applyCollisionLabels(
        items,
        (item) => item.resourceUri,
        (item) => {
          const rel = vscode.workspace.asRelativePath(item.resourceUri, false);
          const relDir = path.dirname(rel);
          item.setDescriptionText(relDir);
        },
        (item) => {
          item.setShowDescription(false);
        },
        searchExclusions,
        undefined,
        this.logger,
      );
    } catch (err) {
      this.logger.error(
        '[collisions] Error detecting collisions in tree view',
        err,
      );
    }
  }

  private getGroupMap(): Map<string, string[]> {
    const groupMap = new Map<string, string[]>();

    this.groups.forEach((g) => groupMap.set(g, []));

    if (!groupMap.has(FavoritesTreeDataProvider.DEFAULT_GROUP)) {
      groupMap.set(FavoritesTreeDataProvider.DEFAULT_GROUP, []);
      this.groups.add(FavoritesTreeDataProvider.DEFAULT_GROUP);
    }

    this.favorites.forEach((metadata, filePath) => {
      if (!groupMap.has(metadata.group)) {
        this.groups.add(metadata.group);
        groupMap.set(metadata.group, []);
      }
      groupMap.get(metadata.group)!.push(filePath);
    });

    this.lineFavorites.forEach((lineMap) => {
      lineMap.forEach((metadata) => {
        if (!groupMap.has(metadata.group)) {
          this.groups.add(metadata.group);
          groupMap.set(metadata.group, []);
        }
      });
    });

    return groupMap;
  }

  addFavorite(uri: vscode.Uri, group?: string): void {
    const targetGroup = group || FavoritesTreeDataProvider.DEFAULT_GROUP;
    const filePath = uri.fsPath;

    this.logger.info(`[favorites] addFavorite -> ${filePath}`, {
      group: targetGroup,
    });

    this.favorites.set(filePath, {
      group: targetGroup,
      addedAt: Date.now(),
      isPinned: false,
    });

    this.saveFavorites();
    this.refresh();
  }

  addLineFavorite(uri: vscode.Uri, line: number): boolean {
    if (line < 1) {
      this.logger.warn('[lineFavorites] Ignoring invalid line', { line });
      return false;
    }

    if (this.hasLineFavorite(uri, line)) {
      return false;
    }

    const filePath = uri.fsPath;
    const lineMap = this.lineFavorites.get(filePath) ?? new Map();
    lineMap.set(line, {
      addedAt: Date.now(),
      isPinned: false,
      group: FavoritesTreeDataProvider.DEFAULT_GROUP,
    });
    this.lineFavorites.set(filePath, lineMap);

    this.saveLineFavorites();
    this.refresh();
    return true;
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

  handleDrag(
    source: (GroupItem | FavoriteItem | WorkspaceItem)[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this.logger.info(`[dnd] handleDrag sourceItems=${source.length}`);

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

    let targetGroupName: string;
    if (!target) {
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

    const treeItem = dataTransfer.get('application/vnd.code.tree.favorites');
    if (treeItem) {
      try {
        const rawValue = treeItem.value;
        if (typeof rawValue !== 'string' || rawValue.trim() === '') {
          this.logger.warn('[dnd] Empty internal drag payload, ignoring');
          return;
        }
        const parsed = JSON.parse(rawValue);
        if (!Array.isArray(parsed)) {
          this.logger.warn('[dnd] Invalid internal drag payload, ignoring', {
            payloadType: typeof parsed,
          });
          return;
        }
        const filePaths = parsed as string[];
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

    const uriListItem = dataTransfer.get('text/uri-list');
    if (uriListItem) {
      try {
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

            if (uri.scheme === 'file') {
              try {
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

  reloadFavorites(): void {
    this.logger.info('[storage] reloadFavorites()');
    this.favorites.clear();
    this.loadFavorites();
  }

  reloadLineFavorites(): void {
    this.logger.info('[storage] reloadLineFavorites()');
    this.lineFavorites.clear();
    this.loadLineFavorites();
  }

  private loadFavorites(): void {
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
      this.saveFavorites();
      this.checkForDuplicateNames();
      return;
    }

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

  private loadLineFavorites(): void {
    const stored = this.storage.get<LineFavoriteData[]>(
      FavoritesTreeDataProvider.LINE_FAVORITES_KEY,
    );

    if (!stored || stored.length === 0) {
      this.logger.info('[lineFavorites] No stored line favorites found');
      return;
    }

    stored.forEach((entry) => {
      if (!entry.path || !entry.line || entry.line < 1) {
        return;
      }
      const lineMap = this.lineFavorites.get(entry.path) ?? new Map();
      const groupName = entry.group || FavoritesTreeDataProvider.DEFAULT_GROUP;
      lineMap.set(entry.line, {
        addedAt: entry.addedAt ?? Date.now(),
        isPinned: !!entry.isPinned,
        group: groupName,
      });
      this.lineFavorites.set(entry.path, lineMap);
      this.groups.add(groupName);
    });

    this.logger.info(
      `[lineFavorites] Loaded line favorites. entries=${stored.length}`,
    );
  }

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

  private saveLineFavorites(): void {
    const serialized: LineFavoriteData[] = [];

    this.lineFavorites.forEach((lineMap, filePath) => {
      lineMap.forEach((metadata, line) => {
        serialized.push({
          path: filePath,
          line,
          group: metadata.group,
          addedAt: metadata.addedAt,
          isPinned: metadata.isPinned,
        });
      });
    });

    this.storage.update(
      FavoritesTreeDataProvider.LINE_FAVORITES_KEY,
      serialized,
    );
  }

  public toggleLineFavorite(uri: vscode.Uri, line: number): boolean {
    if (line < 1) {
      this.logger.warn('[lineFavorites] Ignoring invalid line', { line });
      return false;
    }

    const filePath = uri.fsPath;
    const existing = this.lineFavorites.get(filePath);

    if (existing?.has(line)) {
      existing.delete(line);
      if (existing.size === 0) {
        this.lineFavorites.delete(filePath);
      }
      this.saveLineFavorites();
      this.refresh();
      return false;
    }

    const lineMap = existing ?? new Map();
    lineMap.set(line, {
      addedAt: Date.now(),
      isPinned: false,
      group: FavoritesTreeDataProvider.DEFAULT_GROUP,
    });
    this.lineFavorites.set(filePath, lineMap);

    this.saveLineFavorites();
    this.refresh();
    return true;
  }

  public getLineFavorites(uri: vscode.Uri): number[] {
    const entries = this.lineFavorites.get(uri.fsPath);
    if (!entries) return [];
    return Array.from(entries.keys()).sort((a, b) => a - b);
  }

  public getAllLineFavorites(): LineFavoriteData[] {
    const result: LineFavoriteData[] = [];
    this.lineFavorites.forEach((lineMap, filePath) => {
      lineMap.forEach((metadata, line) => {
        result.push({
          path: filePath,
          line,
          group: metadata.group,
          addedAt: metadata.addedAt,
          isPinned: metadata.isPinned,
        });
      });
    });

    return result.sort((a, b) => {
      const pinnedDiff = Number(!!b.isPinned) - Number(!!a.isPinned);
      if (pinnedDiff !== 0) return pinnedDiff;
      return (b.addedAt ?? 0) - (a.addedAt ?? 0);
    });
  }

  public hasLineFavorite(uri: vscode.Uri, line: number): boolean {
    return this.lineFavorites.get(uri.fsPath)?.has(line) ?? false;
  }

  public isLineFavoritePinned(uri: vscode.Uri, line: number): boolean {
    return this.lineFavorites.get(uri.fsPath)?.get(line)?.isPinned ?? false;
  }

  public getLineFavoriteGroup(
    uri: vscode.Uri,
    line: number,
  ): string | undefined {
    return this.lineFavorites.get(uri.fsPath)?.get(line)?.group;
  }

  public toggleLineFavoritePin(uri: vscode.Uri, line: number): void {
    const entries = this.lineFavorites.get(uri.fsPath);
    if (!entries) {
      return;
    }
    const metadata = entries.get(line);
    if (!metadata) {
      return;
    }

    metadata.isPinned = !metadata.isPinned;
    if (metadata.isPinned) {
      metadata.addedAt = Date.now();
    }
    this.saveLineFavorites();
    this.refresh();
  }

  public moveLineFavorite(
    uri: vscode.Uri,
    line: number,
    newGroup: string,
  ): void {
    const entries = this.lineFavorites.get(uri.fsPath);
    if (!entries) {
      return;
    }
    const metadata = entries.get(line);
    if (!metadata) {
      return;
    }
    metadata.group = newGroup;
    this.groups.add(newGroup);
    this.saveLineFavorites();
    this.refresh();
  }

  public removeLineFavorite(uri: vscode.Uri, line: number): void {
    const filePath = uri.fsPath;
    const entries = this.lineFavorites.get(filePath);
    if (!entries || !entries.has(line)) {
      return;
    }

    entries.delete(line);
    if (entries.size === 0) {
      this.lineFavorites.delete(filePath);
    }

    this.saveLineFavorites();
    this.refresh();
  }

  public updateLineFavoritePath(oldPath: string, newPath: string): void {
    const entries = this.lineFavorites.get(oldPath);
    if (!entries) {
      return;
    }

    this.lineFavorites.delete(oldPath);
    this.lineFavorites.set(newPath, entries);
    this.saveLineFavorites();
    this.refresh();
  }

  public async validateLineFavorites(): Promise<void> {
    await this.validateLineFavoritesForPaths(this.getLineFavoritePaths());
  }

  public async validateLineFavoritesForPaths(
    filePaths: string[],
  ): Promise<void> {
    const uniquePaths = Array.from(
      new Set(filePaths.filter((filePath) => this.lineFavorites.has(filePath))),
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
      `[lineFavorites] validateLineFavoritesForPaths done. processed=${uniquePaths.length} missing=${toDelete.length} durationMs=${Date.now() - t0}`,
    );

    if (toDelete.length > 0) {
      toDelete.forEach((filePath) => this.lineFavorites.delete(filePath));
      this.saveLineFavorites();
      this.refresh();
    }
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

  public async validateFavoritesForPaths(filePaths: string[]): Promise<void> {
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

  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables.length = 0;
    this._onDidChangeTreeData.dispose();
  }
}
