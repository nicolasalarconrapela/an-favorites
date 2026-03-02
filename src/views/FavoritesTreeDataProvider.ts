import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../logging/logger';
import { SharedStorageService } from '../services/sharedStorageService';
import { applyCollisionLabels } from '../utils/collisionUtils';
import { isExcludedPath } from '../utils/exclusionUtils';
import { runWithConcurrency } from '../utils/concurrency';
import { t } from '../utils/l10n';

const VALIDATION_CONCURRENCY = 12;
const DEFAULT_GROUP_ID = 'Sin Grupo';

function getDefaultGroupLabel(): string {
  return t('Ungrouped');
}

export function resolveWorkspaceCwd(cwd?: string): string | undefined {
  if (!cwd) return undefined;

  if (path.isAbsolute(cwd)) return cwd;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return cwd;

  // Multi-root: paths are stored as "FolderName/subdir" or just "FolderName"
  if (folders.length > 1) {
    const slashIdx = cwd.indexOf('/');
    const folderName = slashIdx !== -1 ? cwd.slice(0, slashIdx) : cwd;
    const subdir = slashIdx !== -1 ? cwd.slice(slashIdx + 1) : undefined;

    const matchingFolder = folders.find((f) => f.name === folderName);
    if (matchingFolder) {
      return subdir
        ? path.join(matchingFolder.uri.fsPath, subdir)
        : matchingFolder.uri.fsPath;
    }
  }

  return path.join(folders[0].uri.fsPath, cwd);
}

const getGroupDisplayName = (groupName: string): string =>
  groupName === DEFAULT_GROUP_ID ? getDefaultGroupLabel() : groupName;

export interface CommandFavoriteData {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  background: boolean;
  addedAt: number;
  group?: string;
  type?: 'shell' | 'vscode';
}

export class CommandItem extends vscode.TreeItem {
  constructor(public readonly data: CommandFavoriteData) {
    super(data.label, vscode.TreeItemCollapsibleState.None);

    this.id = `command:${data.id}`;
    const groupName = data.group || FavoritesTreeDataProvider.DEFAULT_GROUP;
    const isVscode = data.type === 'vscode';

    if (isVscode) {
      this.tooltip = data.command;
      this.description = data.command;
      this.iconPath = new vscode.ThemeIcon('symbol-event');
    } else {
      this.tooltip = data.background
        ? `${data.command}${data.cwd ? ` (${data.cwd})` : ''} — ${t('Background')}`
        : `${data.command}${data.cwd ? ` (${data.cwd})` : ''} — ${t('Foreground')}`;
      this.description = data.cwd
        ? `${data.command} [${data.cwd}]`
        : data.command;
      this.iconPath = new vscode.ThemeIcon(
        data.background ? 'server-process' : 'terminal',
      );
    }

    let ctx = isVscode
      ? 'commandItem:vscode'
      : data.background
        ? 'commandItem:background'
        : 'commandItem';
    if (groupName !== FavoritesTreeDataProvider.DEFAULT_GROUP) {
      ctx += ':grouped';
    }
    this.contextValue = ctx;

    this.command = {
      command: 'anfavorites.runCommandFavorite',
      title: t('Run Command'),
      arguments: [this],
    };
  }
}

export class GroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupName: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    isDefault: boolean = false,
  ) {
    const displayName = getGroupDisplayName(groupName);
    super(displayName, collapsibleState);

    this.id = `group:${groupName}`;
    this.tooltip = t('Group: {0}', displayName);
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
      title: t('Open File'),
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
    vscode.TreeDataProvider<
      GroupItem | FavoriteItem | WorkspaceItem | CommandItem
    >,
    vscode.TreeDragAndDropController<
      GroupItem | FavoriteItem | WorkspaceItem | CommandItem
    >,
    vscode.Disposable
{
  private readonly disposables: vscode.Disposable[] = [];
  private _onDidChangeTreeData: vscode.EventEmitter<
    | GroupItem
    | FavoriteItem
    | WorkspaceItem
    | CommandItem
    | undefined
    | null
    | void
  > = new vscode.EventEmitter<
    | GroupItem
    | FavoriteItem
    | WorkspaceItem
    | CommandItem
    | undefined
    | null
    | void
  >();

  readonly onDidChangeTreeData: vscode.Event<
    | GroupItem
    | FavoriteItem
    | WorkspaceItem
    | CommandItem
    | undefined
    | null
    | void
  > = this._onDidChangeTreeData.event;

  public readonly dragMimeTypes = ['application/vnd.code.tree.favorites'];
  public readonly dropMimeTypes = [
    'application/vnd.code.tree.favorites',
    'text/uri-list',
  ];

  private favorites: Map<string, FavoriteMetadata> = new Map();
  private commands: CommandFavoriteData[] = [];

  private groups: Set<string> = new Set([
    FavoritesTreeDataProvider.DEFAULT_GROUP,
  ]);

  private _isSaving = false;

  public static readonly DEFAULT_GROUP = DEFAULT_GROUP_ID;

  public static getDefaultGroupLabel(): string {
    return getDefaultGroupLabel();
  }

  public static getGroupDisplayName(groupName: string): string {
    return getGroupDisplayName(groupName);
  }

  constructor(
    private context: vscode.ExtensionContext,
    private logger: Logger,
    private storage: SharedStorageService,
  ) {
    this.loadFavorites();
    this.disposables.push(
      this.storage.onDidChange(() => {
        if (this._isSaving) {
          this.logger.debug(
            '[storage] Ignoring self-triggered change during save',
          );
          return;
        }
        this.logger.debug('[storage] External change detected -> reloading');
        this.reloadFavorites();
        this.refresh();
      }),
    );

    this.disposables.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.logger.debug('[workspace] Workspace folders changed -> refresh()');
        this.refresh();
      }),
    );

    this.disposables.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (
          e.affectsConfiguration('anfavorites.multiroot.separation') ||
          e.affectsConfiguration('anfavorites.search.exclusions')
        ) {
          this.logger.debug(
            '[config] relevant configuration changed -> refresh()',
          );
          this.refresh();
        }
      }),
    );

    this.logger.debug(
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

  getTreeItem(
    element: GroupItem | FavoriteItem | WorkspaceItem | CommandItem,
  ): vscode.TreeItem {
    return element;
  }

  async getChildren(
    element?: GroupItem | FavoriteItem | WorkspaceItem | CommandItem,
  ): Promise<(GroupItem | FavoriteItem | WorkspaceItem | CommandItem)[]> {
    const t0 = Date.now();

    if (!element) {
      const groups: GroupItem[] = [];
      const groupMap = this.getGroupMap();

      groupMap.forEach((filePaths, groupName) => {
        // Check if group has visible files or commands
        let hasVisibleFiles = false;
        for (const filePath of filePaths) {
          const uri = vscode.Uri.file(filePath);
          if (vscode.workspace.getWorkspaceFolder(uri)) {
            hasVisibleFiles = true;
            break;
          }
        }

        const hasCommands = this.commands.some((cmd) => {
          const cmdGroup = cmd.group || FavoritesTreeDataProvider.DEFAULT_GROUP;
          return cmdGroup === groupName;
        });

        const isEmpty = filePaths.length === 0 && !hasCommands;
        const included = hasVisibleFiles || hasCommands || isEmpty;

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

        // After workspace sub-items, also append commands for this group
        const cmdItems: CommandItem[] = [];
        this.commands.forEach((cmd) => {
          const cmdGroup = cmd.group || FavoritesTreeDataProvider.DEFAULT_GROUP;
          if (cmdGroup === element.groupName) {
            cmdItems.push(new CommandItem(cmd));
          }
        });

        return Promise.resolve([...workspaceItems, ...cmdItems]);
      }

      const favoriteItems: FavoriteItem[] = [];
      this.logger.debug(`[getChildren:group] Start "${element.groupName}"`);

      this.favorites.forEach((metadata, filePath) => {
        if (metadata.group !== element.groupName) return;

        const uri = vscode.Uri.file(filePath);
        const wf = vscode.workspace.getWorkspaceFolder(uri);
        if (!wf) return;

        favoriteItems.push(
          new FavoriteItem(
            uri,
            element.groupName,
            vscode.TreeItemCollapsibleState.None,
            metadata.isPinned,
          ),
        );
      });

      await this._resolveCollisions(favoriteItems, element.groupName);

      // Commands in this group
      const cmdItems: CommandItem[] = [];
      this.commands.forEach((cmd) => {
        const cmdGroup = cmd.group || FavoritesTreeDataProvider.DEFAULT_GROUP;
        if (cmdGroup === element.groupName) {
          cmdItems.push(new CommandItem(cmd));
        }
      });

      return Promise.resolve([...favoriteItems, ...cmdItems]);
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
        items.filter((i): i is FavoriteItem => i instanceof FavoriteItem),
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

    this.commands.forEach((cmd) => {
      const g = cmd.group || FavoritesTreeDataProvider.DEFAULT_GROUP;
      if (!groupMap.has(g)) {
        this.groups.add(g);
        groupMap.set(g, []);
      }
    });

    return groupMap;
  }

  addFavorite(uri: vscode.Uri, group?: string): void {
    const targetGroup = group || FavoritesTreeDataProvider.DEFAULT_GROUP;
    const filePath = uri.fsPath;

    this.logger.debug(`[favorites] addFavorite -> ${filePath}`, {
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

  removeFavorite(uri: vscode.Uri): void {
    this.logger.debug(`[favorites] removeFavorite -> ${uri.fsPath}`);
    this.favorites.delete(uri.fsPath);
    this.saveFavorites();
    this.refresh();
  }

  removeAllFavorites(): void {
    this.logger.debug('[favorites] removeAllFavorites');
    this.favorites.clear();
    this.saveFavorites();
    this.refresh();
  }

  clearGroupItems(groupName: string): void {
    this.logger.debug(`[favorites] clearGroupItems -> ${groupName}`);
    this.favorites.forEach((metadata, filePath) => {
      if (metadata.group === groupName) {
        metadata.group = FavoritesTreeDataProvider.DEFAULT_GROUP;
      }
    });

    this.commands.forEach((cmd) => {
      if (cmd.group === groupName) {
        cmd.group = FavoritesTreeDataProvider.DEFAULT_GROUP;
      }
    });

    this.saveFavorites();
    this.refresh();
  }

  resetFavoriteGroup(uri: vscode.Uri): void {
    const metadata = this.favorites.get(uri.fsPath);
    if (!metadata) return;

    this.logger.debug(`[favorites] resetFavoriteGroup -> ${uri.fsPath}`);
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
    this.logger.debug(`[favorites] deleteFavoritesInGroup -> ${groupName}`);
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

    this.logger.debug(`[groups] addGroup OK -> "${groupName}"`);
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

    this.logger.debug(
      `[groups] removeGroup -> "${groupName}" (move to default)`,
    );

    this.favorites.forEach((metadata, filePath) => {
      if (metadata.group === groupName) {
        metadata.group = FavoritesTreeDataProvider.DEFAULT_GROUP;
        this.logger.debug(`[groups] Moved favorite to default`, {
          filePath,
        });
      }
    });

    this.commands.forEach((cmd) => {
      if (cmd.group === groupName) {
        cmd.group = FavoritesTreeDataProvider.DEFAULT_GROUP;
        this.logger.debug(`[groups] Moved command to default`, {
          label: cmd.label,
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
    if (!groupMap.has(oldName)) {
      this.logger.warn(
        `[groups] renameGroup FAILED (source not found) -> "${oldName}"`,
      );
      return false;
    }

    const isMerge = groupMap.has(newName);
    if (isMerge) {
      this.logger.debug(
        `[groups] renameGroup MERGING -> "${oldName}" into "${newName}"`,
      );
    }

    this.logger.debug(`[groups] renameGroup -> "${oldName}" => "${newName}"`);

    this.favorites.forEach((metadata, filePath) => {
      if (metadata.group === oldName) {
        metadata.group = newName;
        this.logger.debug(`[groups] Updated favorite group`, {
          filePath,
          newName,
        });
      }
    });

    this.commands.forEach((cmd) => {
      if (cmd.group === oldName) {
        cmd.group = newName;
        this.logger.debug(`[groups] Updated command group`, {
          label: cmd.label,
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

    this.logger.debug(`[favorites] moveFavorite -> ${uri.fsPath}`, {
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
    this.logger.debug(
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

    this.logger.debug(
      `[favorites] getRecentFavorites count=${count}`,
      allFavorites.map((f) => f.uri.fsPath),
    );
    return allFavorites.map((f) => f.uri);
  }

  handleDrag(
    source: (GroupItem | FavoriteItem | WorkspaceItem | CommandItem)[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this.logger.debug(`[dnd] handleDrag sourceItems=${source.length}`);

    const draggedFiles = source
      .filter((item): item is FavoriteItem => item instanceof FavoriteItem)
      .map((item) => item.resourceUri.fsPath);

    const draggedCommands = source
      .filter((item): item is CommandItem => item instanceof CommandItem)
      .map((item) => item.data.id);

    const payload = { files: draggedFiles, commands: draggedCommands };

    if (draggedFiles.length > 0 || draggedCommands.length > 0) {
      dataTransfer.set(
        'application/vnd.code.tree.favorites',
        new vscode.DataTransferItem(JSON.stringify(payload)),
      );
    }
  }

  async handleDrop(
    target: GroupItem | FavoriteItem | WorkspaceItem | undefined,
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): Promise<void> {
    this.logger.debug('[dnd] handleDrop initiated');

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

    this.logger.debug(`[dnd] Target group: "${targetGroupName}"`);

    const treeItem = dataTransfer.get('application/vnd.code.tree.favorites');
    if (treeItem) {
      try {
        const raw =
          typeof treeItem.value === 'string'
            ? treeItem.value
            : await treeItem.asString();

        let payload: { files?: string[]; commands?: string[] };

        // Support both old format (string[]) and new format ({ files, commands })
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          payload = { files: parsed, commands: [] };
        } else {
          payload = parsed;
        }

        const filePaths = payload.files || [];
        const commandIds = payload.commands || [];

        this.logger.debug(
          `[dnd] Moving ${filePaths.length} files + ${commandIds.length} commands to "${targetGroupName}"`,
        );

        let movedCount = 0;

        filePaths.forEach((filePath) => {
          const metadata = this.favorites.get(filePath);
          if (metadata && metadata.group !== targetGroupName) {
            metadata.group = targetGroupName;
            movedCount++;
          }
        });

        commandIds.forEach((cmdId) => {
          const cmd = this.commands.find((c) => c.id === cmdId);
          if (cmd && cmd.group !== targetGroupName) {
            cmd.group = targetGroupName;
            movedCount++;
          }
        });

        this.saveFavorites();
        this.refresh();

        if (movedCount > 0) {
          const targetGroupDisplayName =
            FavoritesTreeDataProvider.getGroupDisplayName(targetGroupName);
          vscode.window.showInformationMessage(
            t(
              'Moved {0} favorites to group "{1}"',
              movedCount,
              targetGroupDisplayName,
            ),
          );
        }
        return;
      } catch (err) {
        this.logger.error('[dnd] Error parsing internal drag data', err);
        vscode.window.showErrorMessage(t('Error moving favorites internally.'));
      }
    }

    const uriListItem = dataTransfer.get('text/uri-list');
    if (uriListItem) {
      try {
        const urlListResult = await uriListItem.asString();
        const uris = urlListResult.split('\r\n');

        this.logger.debug(
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
                  this.logger.debug(
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
          const targetGroupDisplayName =
            FavoritesTreeDataProvider.getGroupDisplayName(targetGroupName);
          vscode.window.showInformationMessage(
            t('Added {0} files to "{1}".', addedCount, targetGroupDisplayName),
          );
        }

        if (ignoredFoldersCount > 0) {
          vscode.window.showWarningMessage(
            t(
              'Ignored {0} folders (only files are allowed).',
              ignoredFoldersCount,
            ),
          );
        }

        return;
      } catch (err) {
        this.logger.error('[dnd] Error processing external URIs', err);
        vscode.window.showErrorMessage(t('Error processing external files.'));
      }
    }
  }

  reloadFavorites(): void {
    this.logger.debug('[storage] reloadFavorites()');
    this.favorites.clear();
    this.groups.clear();
    this.groups.add(FavoritesTreeDataProvider.DEFAULT_GROUP);
    this.loadFavorites();
  }

  private loadFavorites(): void {
    const sharedData = this.storage.get<FavoriteData[]>(
      'anfavorites.favorites.v2',
    );
    const sharedGroups = this.storage.get<string[]>('anfavorites.groups');
    const sharedCommands = this.storage.get<CommandFavoriteData[]>(
      'anfavorites.commands.v1',
    );

    if (sharedGroups) {
      sharedGroups.forEach((g) => this.groups.add(g));
    }

    if (sharedCommands) {
      this.commands = sharedCommands;
      sharedCommands.forEach((cmd) => {
        if (cmd.group) this.groups.add(cmd.group);
      });
    }

    if (sharedData) {
      this.logger.debug(
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
      this.logger.debug(
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
      this.logger.debug(
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
        this.logger.debug(
          `[storage] Migration v1 complete. Imported ${importedCount} favorites.`,
        );
      }

      this.checkForDuplicateNames();
      return;
    }

    this.logger.debug('[storage] No favorites found (shared or migrated)');
    this.checkForDuplicateNames();
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
      this.logger.debug('[duplicates] No duplicate basenames found');
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

    this.logger.debug(
      `[storage] saveFavorites (shared) -> count=${favoritesArray.length} groups=${this.groups.size}`,
    );
    this._isSaving = true;
    try {
      this.storage.update('anfavorites.favorites.v2', favoritesArray);
      this.storage.update('anfavorites.groups', Array.from(this.groups));
      this.storage.update('anfavorites.commands.v1', this.commands);
    } finally {
      this._isSaving = false;
    }
  }

  public async validateFavorites(): Promise<void> {
    const originalSize = this.favorites.size;
    const toDelete: string[] = [];
    const t0 = Date.now();

    this.logger.debug(
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

    this.logger.debug(
      `[validate] validateFavorites done. processed=${favoritePaths.length} missing=${toDelete.length} durationMs=${Date.now() - t0}`,
    );

    if (toDelete.length > 0) {
      this.logger.debug(
        `[validate] Removing missing favorites count=${toDelete.length}`,
        toDelete,
      );

      toDelete.forEach((filePath) => this.favorites.delete(filePath));
      this.saveFavorites();
      this.refresh();
    } else {
      this.logger.debug('[validate] No missing favorites found');
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

    this.logger.debug(
      `[validate] validateFavoritesForPaths done. processed=${uniquePaths.length} missing=${toDelete.length} durationMs=${Date.now() - t0}`,
    );

    if (toDelete.length > 0) {
      this.logger.debug(
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

    this.logger.debug(`[favorites] updatePath -> ${oldPath} => ${newPath}`, {
      group: metadata.group,
    });

    this.favorites.delete(oldPath);
    this.favorites.set(newPath, metadata);

    this.saveFavorites();
    this.refresh();
  }

  // ── Command management (Merged from CommandFavoritesTreeDataProvider) ──

  getCommands(): CommandFavoriteData[] {
    return [...this.commands];
  }

  addCommand(
    data: Omit<CommandFavoriteData, 'id' | 'addedAt'>,
  ): CommandFavoriteData {
    const newCmd: CommandFavoriteData = {
      ...data,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      addedAt: Date.now(),
      group: data.group || FavoritesTreeDataProvider.DEFAULT_GROUP,
    };
    this.commands.push(newCmd);
    this.saveFavorites();
    this.refresh();
    this.logger.debug(`[commands] addCommand -> "${newCmd.label}"`);
    return newCmd;
  }

  removeCommand(id: string): void {
    const before = this.commands.length;
    this.commands = this.commands.filter((c) => c.id !== id);
    if (this.commands.length !== before) {
      this.saveFavorites();
      this.refresh();
      this.logger.debug(`[commands] removeCommand -> id=${id}`);
    }
  }

  moveCommand(id: string, newGroup: string): void {
    const cmd = this.commands.find((c) => c.id === id);
    if (!cmd) {
      this.logger.warn(`[commands] moveCommand FAILED (not found) -> id=${id}`);
      return;
    }

    this.logger.debug(`[commands] moveCommand -> id=${id}`, {
      from: cmd.group,
      to: newGroup,
    });
    cmd.group = newGroup;

    this.saveFavorites();
    this.refresh();
  }

  editCommand(
    id: string,
    data: Partial<Omit<CommandFavoriteData, 'id' | 'addedAt'>>,
  ): boolean {
    const idx = this.commands.findIndex((c) => c.id === id);
    if (idx === -1) {
      this.logger.warn(`[commands] editCommand FAILED (not found) -> id=${id}`);
      return false;
    }
    this.commands[idx] = { ...this.commands[idx], ...data };
    this.saveFavorites();
    this.refresh();
    this.logger.debug(`[commands] editCommand -> id=${id}`);
    return true;
  }

  runCommand(item: CommandItem): void {
    const data = item.data;

    if (data.type === 'vscode') {
      this.logger.debug(
        `[commands] runCommand (vscode) -> "${data.label}" command=${data.command}`,
      );
      vscode.commands.executeCommand(data.command).then(
        () => {
          this.logger.debug(
            `[commands] VS Code command executed: "${data.label}"`,
          );
        },
        (err) => {
          this.logger.error(`[commands] Error executing VS Code command`, err);
          vscode.window.showErrorMessage(
            t('Error executing command: {0}', String(err)),
          );
        },
      );
      return;
    }

    const resolvedCwd = resolveWorkspaceCwd(data.cwd);

    this.logger.debug(
      `[commands] runCommand -> "${data.label}" background=${data.background} cwd=${resolvedCwd ?? '(none)'}`,
    );

    if (data.background) {
      const task = new vscode.Task(
        { type: 'anfavorites-command', id: data.id },
        vscode.TaskScope.Workspace,
        data.label,
        'AnFavorites',
        new vscode.ShellExecution(data.command, {
          cwd: resolvedCwd,
        }),
      );
      task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Silent,
        panel: vscode.TaskPanelKind.Dedicated,
        showReuseMessage: false,
        clear: false,
      };
      vscode.tasks.executeTask(task).then(
        () => {
          this.logger.debug(
            `[commands] Background task started: "${data.label}"`,
          );
        },
        (err) => {
          this.logger.error(`[commands] Error starting background task`, err);
          vscode.window.showErrorMessage(
            t('Error executing command: {0}', String(err)),
          );
        },
      );
    } else {
      const terminal = vscode.window.createTerminal({
        name: data.label,
        cwd: resolvedCwd,
      });
      terminal.sendText(data.command);
      terminal.show();
      this.logger.debug(
        `[commands] Foreground terminal created: "${data.label}"`,
      );
    }
  }

  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables.length = 0;
    this._onDidChangeTreeData.dispose();
  }
}
