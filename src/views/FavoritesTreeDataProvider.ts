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
const LOCAL_COMMANDS_STORAGE_KEY = 'anfavorites.commands.local.v1';
const GLOBAL_COMMANDS_STORAGE_KEY = 'anfavorites.commands.global.v1';
const LEGACY_COMMANDS_STORAGE_KEY = 'anfavorites.commands.v1';
const TREE_EXPANSION_STATE_STORAGE_KEY = 'anfavorites.tree.expanded.v1';

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

function getDefaultWorkspacePath(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return t('Workspace root');
  }

  return folders[0].uri.fsPath;
}

async function promptWorkspaceRootForCommand(
  label: string,
): Promise<string | undefined> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    return undefined;
  }

  if (folders.length === 1) {
    return folders[0].uri.fsPath;
  }

  const selected = await vscode.window.showQuickPick(
    folders.map((folder) => ({
      label: folder.name,
      description: folder.uri.fsPath,
      folder,
    })),
    {
      placeHolder: t('Select workspace root for command "{0}"', label),
      ignoreFocusOut: true,
    },
  );

  return selected?.folder.uri.fsPath;
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
  type?: 'shell' | 'vscode';
  scope: 'local' | 'global' | 'opensource';
  language: string;
  readonly?: boolean;
  source?: 'builtin' | 'file';
  templateSourceId?: string;
}

export class CommandItem extends vscode.TreeItem {
  constructor(
    public readonly data: CommandFavoriteData,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.None,
  ) {
    super(data.label, collapsibleState);

    this.id = `command:${data.scope}:${data.id}`;
    const isVscode = data.type === 'vscode';
    const locationLabel = data.cwd
      ? resolveWorkspaceCwd(data.cwd) ?? data.cwd
      : getDefaultWorkspacePath();

    if (isVscode) {
      this.tooltip = data.command;
      this.description = `${data.command} [${locationLabel}]`;
      this.detail = undefined;
    } else {
      this.tooltip = data.background
        ? `${data.command}${data.cwd ? ` (${data.cwd})` : ''} — ${t('Background')}`
        : `${data.command}${data.cwd ? ` (${data.cwd})` : ''} — ${t('Foreground')}`;
      this.description = `${data.command} [${locationLabel}]`;
      this.detail = undefined;
    }

    this.iconPath = new vscode.ThemeIcon(
      data.scope === 'local'
        ? 'folder-library'
        : data.scope === 'global'
          ? 'globe'
          : 'library',
    );

    let ctx = `commandItem:${data.scope}:${data.language}`;
    ctx += data.readonly ? ':readonly' : ':editable';
    this.contextValue = ctx;

  }
}

export class CommandScopeItem extends vscode.TreeItem {
  constructor(
    public readonly scope: CommandFavoriteData['scope'],
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
  ) {
    super(FavoritesTreeDataProvider.getScopeDisplayName(scope), collapsibleState);
    this.id = `command-scope:${scope}`;
    this.contextValue = `commandScopeItem:${scope}`;
    this.iconPath = new vscode.ThemeIcon(
      scope === 'local' ? 'folder-library' : scope === 'global' ? 'globe' : 'library',
    );
  }
}

export class CommandSectionItem extends vscode.TreeItem {
  constructor(
    public readonly section:
      | 'favorites'
      | 'commands'
      | 'personalized'
      | 'predefined'
      | 'globals'
      | 'opensource',
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
  ) {
    super(
      section === 'favorites'
        ? t('Favorites')
        : section === 'commands'
        ? t('Commands')
        : section === 'personalized'
          ? t('Personalized')
          : section === 'predefined'
            ? t('Predefined')
            : section === 'globals'
              ? t('Global Commands')
              : t('Template'),
      collapsibleState,
    );
    this.id = `command-section:${section}`;
    this.contextValue = `commandSectionItem:${section}`;
    this.iconPath = new vscode.ThemeIcon(
      section === 'favorites'
        ? 'star-full'
        : section === 'commands'
        ? 'terminal'
        : section === 'personalized'
          ? 'symbol-misc'
          : section === 'globals'
            ? 'globe'
            : 'library',
    );
  }
}

export class CommandLanguageItem extends vscode.TreeItem {
  constructor(
    public readonly scope: CommandFavoriteData['scope'],
    public readonly language: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
  ) {
    super(
      FavoritesTreeDataProvider.getLanguageDisplayName(language),
      collapsibleState,
    );
    this.id = `command-language:${scope}:${language}`;
    this.contextValue = `commandLanguageItem:${scope}:${language}`;
    this.iconPath = new vscode.ThemeIcon('symbol-string');
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
      | GroupItem
      | FavoriteItem
      | WorkspaceItem
      | CommandItem
      | CommandSectionItem
      | CommandScopeItem
      | CommandLanguageItem
    >,
    vscode.TreeDragAndDropController<
      | GroupItem
      | FavoriteItem
      | WorkspaceItem
      | CommandItem
      | CommandSectionItem
      | CommandScopeItem
      | CommandLanguageItem
    >,
    vscode.Disposable
{
  private readonly commandSectionItems = {
    favorites: new CommandSectionItem('favorites'),
    commands: new CommandSectionItem('commands'),
    personalized: new CommandSectionItem('personalized'),
    predefined: new CommandSectionItem('predefined'),
    globals: new CommandSectionItem('globals'),
    opensource: new CommandSectionItem('opensource'),
  } as const;

  private readonly disposables: vscode.Disposable[] = [];
  private _onDidChangeTreeData: vscode.EventEmitter<
    | GroupItem
    | FavoriteItem
    | WorkspaceItem
    | CommandItem
    | CommandSectionItem
    | CommandScopeItem
    | CommandLanguageItem
    | undefined
    | null
    | void
  > = new vscode.EventEmitter<
    | GroupItem
    | FavoriteItem
    | WorkspaceItem
    | CommandItem
    | CommandSectionItem
    | CommandScopeItem
    | CommandLanguageItem
    | undefined
    | null
    | void
  >();

  readonly onDidChangeTreeData: vscode.Event<
    | GroupItem
    | FavoriteItem
    | WorkspaceItem
    | CommandItem
    | CommandSectionItem
    | CommandScopeItem
    | CommandLanguageItem
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
  private localCommands: CommandFavoriteData[] = [];
  private globalCommands: CommandFavoriteData[] = [];
  private openSourceCommands: CommandFavoriteData[] = [];
  private expandedTreeItemIds = new Set<string>();
  private expandedTreeStateDirty = false;
  private persistExpandedTreeStateTimer: NodeJS.Timeout | undefined;
  private cachedGroupMap?: Map<string, string[]>;
  private cachedVisibleFavoriteGroups?: GroupItem[];
  private cachedWorkspaceFolderByPath = new Map<
    string,
    vscode.WorkspaceFolder | null
  >();
  private pendingCommandRenderTraces = new Map<
    string,
    {
      startedAt: number;
      scope: 'local' | 'global';
      label: string;
      refreshFiredAt?: number;
      commandsSectionSeenAt?: number;
      scopeSectionSeenAt?: number;
    }
  >();

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

  public static getScopeDisplayName(
    scope: CommandFavoriteData['scope'],
  ): string {
    if (scope === 'local') return t('Local');
    if (scope === 'global') return t('Global');
    return t('Template');
  }

  public static getLanguageDisplayName(language: string): string {
    switch (language.trim().toLowerCase()) {
      case 'python':
        return t('Python');
      case 'node':
        return t('Node');
      case 'java':
        return t('Java');
      default:
        return t('Personalized');
    }
  }

  public createFavoriteItem(
    uri: vscode.Uri,
    group: string,
    isPinned = false,
  ): FavoriteItem {
    return new FavoriteItem(
      uri,
      group,
      vscode.TreeItemCollapsibleState.None,
      isPinned,
    );
  }

  public createCommandSectionItem(
    section:
      | 'favorites'
      | 'commands'
      | 'personalized'
      | 'predefined'
      | 'globals'
      | 'opensource',
  ): CommandSectionItem {
    return this.commandSectionItems[section];
  }

  public createGroupItem(groupName: string): GroupItem {
    return new GroupItem(
      groupName,
      this.getPersistedCollapsibleState(`group:${groupName}`),
      groupName === FavoritesTreeDataProvider.DEFAULT_GROUP,
    );
  }

  constructor(
    private context: vscode.ExtensionContext,
    private logger: Logger,
    private storage: SharedStorageService,
  ) {
    this.expandedTreeItemIds = new Set(
      this.context.workspaceState.get<string[]>(
        TREE_EXPANSION_STATE_STORAGE_KEY,
        [],
      ),
    );
    this.applyStaticTreeExpansionState();
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
        this.logger.debug(
          '[workspace] Workspace folders changed -> reloadFavorites() + refresh()',
        );
        this.reloadFavorites();
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
    this.invalidateTreeCaches();
    const refreshAt = Date.now();
    for (const trace of this.pendingCommandRenderTraces.values()) {
      if (!trace.refreshFiredAt) {
        trace.refreshFiredAt = refreshAt;
      }
    }
    this._onDidChangeTreeData.fire();
  }

  private applyStaticTreeExpansionState(): void {
    for (const item of Object.values(this.commandSectionItems)) {
      item.collapsibleState = this.getPersistedCollapsibleState(item.id);
    }
  }

  private getPersistedCollapsibleState(
    itemId: string | undefined,
  ): vscode.TreeItemCollapsibleState {
    if (!itemId) {
      return vscode.TreeItemCollapsibleState.Collapsed;
    }

    return this.expandedTreeItemIds.has(itemId)
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed;
  }

  private persistExpandedTreeState(): void {
    this.expandedTreeStateDirty = true;

    if (this.persistExpandedTreeStateTimer) {
      clearTimeout(this.persistExpandedTreeStateTimer);
    }

    this.persistExpandedTreeStateTimer = setTimeout(() => {
      this.persistExpandedTreeStateTimer = undefined;
      void this.flushExpandedTreeState();
    }, 5000);
  }

  public async flushExpandedTreeState(): Promise<void> {
    if (!this.expandedTreeStateDirty) {
      return;
    }

    const startedAt = Date.now();
    const expandedIds = Array.from(this.expandedTreeItemIds);
    this.expandedTreeStateDirty = false;
    this.logger.trace('[tree][trace] persistExpandedTreeState started', {
      expandedItemCount: expandedIds.length,
    });

    try {
      await this.context.workspaceState.update(
        TREE_EXPANSION_STATE_STORAGE_KEY,
        expandedIds,
      );
      this.logger.trace('[tree][trace] persistExpandedTreeState finished', {
        durationMs: Date.now() - startedAt,
        expandedItemCount: expandedIds.length,
      });
    } catch (error) {
      this.expandedTreeStateDirty = true;
      this.logger.error('[tree] persistExpandedTreeState failed', error);
    }
  }

  public setTreeItemExpanded(
    element:
      | GroupItem
      | FavoriteItem
      | WorkspaceItem
      | CommandItem
      | CommandSectionItem
      | CommandScopeItem
      | CommandLanguageItem,
    expanded: boolean,
  ): void {
    if (!element.id || element.collapsibleState === vscode.TreeItemCollapsibleState.None) {
      return;
    }

    if (expanded) {
      this.expandedTreeItemIds.add(element.id);
      element.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
    } else {
      this.expandedTreeItemIds.delete(element.id);
      element.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
    }

    this.persistExpandedTreeState();
  }

  public isTreeExpanded(): boolean {
    const rootIds = [this.commandSectionItems.favorites.id];
    if (this.getCommands().length > 0) {
      rootIds.push(this.commandSectionItems.commands.id);
    }

    return rootIds.every((id) => !!id && this.expandedTreeItemIds.has(id));
  }

  refreshSection(section: 'favorites' | 'commands'): void {
    this.logger.debug(`[tree] refreshSection(${section}) fired`);
    this.invalidateTreeCaches();
    this._onDidChangeTreeData.fire(this.commandSectionItems[section]);
  }

  private refreshTreeElement(
    element:
      | GroupItem
      | FavoriteItem
      | WorkspaceItem
      | CommandItem
      | CommandSectionItem
      | CommandScopeItem
      | CommandLanguageItem,
    traceLabel: string,
  ): void {
    this.logger.debug(`[tree] ${traceLabel} fired`);
    this.invalidateTreeCaches();
    this._onDidChangeTreeData.fire(element);
  }

  private invalidateTreeCaches(): void {
    this.cachedGroupMap = undefined;
    this.cachedVisibleFavoriteGroups = undefined;
    this.cachedWorkspaceFolderByPath.clear();
  }

  private getWorkspaceFolderCached(
    filePath: string,
  ): vscode.WorkspaceFolder | undefined {
    const cached = this.cachedWorkspaceFolderByPath.get(filePath);
    if (cached !== undefined) {
      return cached ?? undefined;
    }

    const workspaceFolder =
      vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath)) ?? null;
    this.cachedWorkspaceFolderByPath.set(filePath, workspaceFolder);
    return workspaceFolder ?? undefined;
  }

  private getVisibleFavoriteGroups(): GroupItem[] {
    if (this.cachedVisibleFavoriteGroups) {
      return this.cachedVisibleFavoriteGroups;
    }

    const groups: GroupItem[] = [];
    const groupMap = this.getGroupMap();

    groupMap.forEach((filePaths, groupName) => {
      const hasVisibleFiles = filePaths.some(
        (filePath) => !!this.getWorkspaceFolderCached(filePath),
      );

      if (hasVisibleFiles || filePaths.length === 0) {
        groups.push(
          new GroupItem(
            groupName,
            this.getPersistedCollapsibleState(`group:${groupName}`),
            groupName === FavoritesTreeDataProvider.DEFAULT_GROUP,
          ),
        );
      }
    });

    this.cachedVisibleFavoriteGroups = groups;
    return groups;
  }

  public getFavoritePaths(): string[] {
    return Array.from(this.favorites.keys());
  }

  public getQuickOpenFavoritesSnapshot(): Array<{
    uri: vscode.Uri;
    addedAt: number;
    isPinned: boolean;
  }> {
    return Array.from(this.favorites.entries()).map(([filePath, metadata]) => ({
      uri: vscode.Uri.file(filePath),
      addedAt: metadata.addedAt,
      isPinned: metadata.isPinned,
    }));
  }

  getTreeItem(
    element:
      | GroupItem
      | FavoriteItem
      | WorkspaceItem
      | CommandItem
      | CommandSectionItem
      | CommandScopeItem
      | CommandLanguageItem,
  ): vscode.TreeItem {
    return element;
  }

  getParent(
    element:
      | GroupItem
      | FavoriteItem
      | WorkspaceItem
      | CommandItem
      | CommandSectionItem
      | CommandScopeItem
      | CommandLanguageItem,
  ):
    | GroupItem
    | WorkspaceItem
    | CommandSectionItem
    | CommandLanguageItem
    | CommandItem
    | undefined {
    if (element instanceof CommandSectionItem) {
      if (element.section === 'favorites' || element.section === 'commands') {
        return undefined;
      }

      if (
        element.section === 'personalized' ||
        element.section === 'predefined'
      ) {
        return this.commandSectionItems.commands;
      }

      if (
        element.section === 'globals' ||
        element.section === 'opensource'
      ) {
        return this.commandSectionItems.predefined;
      }
    }

    if (element instanceof GroupItem) {
      return this.commandSectionItems.favorites;
    }

    if (element instanceof WorkspaceItem) {
      return new GroupItem(
        element.groupName,
        this.getPersistedCollapsibleState(`group:${element.groupName}`),
        element.groupName === FavoritesTreeDataProvider.DEFAULT_GROUP,
      );
    }

    if (element instanceof FavoriteItem) {
      const groupName = element.group;
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
          groupName === FavoritesTreeDataProvider.DEFAULT_GROUP
        ) {
          shouldSeparate = true;
        } else if (
          separationMode === 'groups' &&
          groupName !== FavoritesTreeDataProvider.DEFAULT_GROUP
        ) {
          shouldSeparate = true;
        }
      }

      if (shouldSeparate) {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(
          element.resourceUri,
        );
        if (workspaceFolder) {
          return new WorkspaceItem(
            workspaceFolder.name,
            groupName,
            this.getPersistedCollapsibleState(
              `workspace:${groupName}:${workspaceFolder.uri.toString()}`,
            ),
            workspaceFolder,
          );
        }
      }

      return new GroupItem(
        groupName,
        this.getPersistedCollapsibleState(`group:${groupName}`),
        groupName === FavoritesTreeDataProvider.DEFAULT_GROUP,
      );
    }

    if (element instanceof CommandLanguageItem) {
      return this.commandSectionItems.opensource;
    }

    if (element instanceof CommandItem) {
      if (element.data.scope === 'local') {
        return this.commandSectionItems.personalized;
      }
      if (element.data.scope === 'global') {
        return this.commandSectionItems.globals;
      }
      return new CommandLanguageItem(
        'opensource',
        element.data.language.trim().toLowerCase() || 'generic',
        this.getPersistedCollapsibleState(
          `command-language:opensource:${element.data.language.trim().toLowerCase() || 'generic'}`,
        ),
      );
    }

    return undefined;
  }

  async getChildren(
    element?:
      | GroupItem
      | FavoriteItem
      | WorkspaceItem
      | CommandItem
      | CommandSectionItem
      | CommandScopeItem
      | CommandLanguageItem,
  ): Promise<
    (
      | GroupItem
      | FavoriteItem
      | WorkspaceItem
      | CommandItem
      | CommandSectionItem
      | CommandScopeItem
      | CommandLanguageItem
    )[]
  > {
    const t0 = Date.now();

    if (!element) {
      const rootItems: (GroupItem | CommandSectionItem)[] = [];
      rootItems.push(this.commandSectionItems.favorites);
      if (this.getCommands().length > 0) {
        rootItems.push(this.commandSectionItems.commands);
      }
      return Promise.resolve(rootItems);
    }

    if (element instanceof CommandSectionItem) {
      if (element.section === 'favorites') {
        const sectionStartedAt = Date.now();
        const groups = this.getVisibleFavoriteGroups();
        this.logger.trace('[tree][trace] getChildren(favorites) resolved', {
          durationMs: Date.now() - sectionStartedAt,
          groupCount: groups.length,
        });
        return Promise.resolve(groups);
      }

      if (element.section === 'commands') {
        const now = Date.now();
        for (const trace of this.pendingCommandRenderTraces.values()) {
          if (!trace.commandsSectionSeenAt) {
            trace.commandsSectionSeenAt = now;
            this.logger.trace(
              `[commands][trace] commands root requested for "${trace.label}" after ${now - trace.startedAt}ms` +
                (trace.refreshFiredAt
                  ? ` (${now - trace.refreshFiredAt}ms since refresh)`
                  : ''),
            );
          }
        }
        const sections: (CommandSectionItem | CommandLanguageItem)[] = [];
        if (this.localCommands.length > 0) {
          sections.push(this.commandSectionItems.personalized);
        }
        if (
          this.globalCommands.length > 0 ||
          this.openSourceCommands.length > 0
        ) {
          sections.push(this.commandSectionItems.predefined);
        }
        return Promise.resolve(sections);
      }

      if (element.section === 'personalized') {
        const sectionStartedAt = Date.now();
        for (const trace of this.pendingCommandRenderTraces.values()) {
          if (trace.scope === 'local' && !trace.scopeSectionSeenAt) {
            trace.scopeSectionSeenAt = sectionStartedAt;
            this.logger.trace(
              `[commands][trace] personalized section requested for "${trace.label}" after ${sectionStartedAt - trace.startedAt}ms` +
                (trace.refreshFiredAt
                  ? ` (${sectionStartedAt - trace.refreshFiredAt}ms since refresh)`
                  : ''),
            );
          }
        }
        const commands = [...this.localCommands]
          .sort((a, b) => b.addedAt - a.addedAt || a.label.localeCompare(b.label));
        const sectionDurationMs = Date.now() - sectionStartedAt;
        this.logger.trace(
          `[commands][trace] getChildren(personalized) returned ${commands.length} items in ${sectionDurationMs}ms`,
        );
        for (const command of commands) {
          const trace = this.pendingCommandRenderTraces.get(command.id);
          if (trace) {
            this.logger.trace(
              `[commands][trace] tree materialized local command "${trace.label}" in ${Date.now() - trace.startedAt}ms`,
            );
            this.pendingCommandRenderTraces.delete(command.id);
          }
        }
        return Promise.resolve(commands.map((command) => new CommandItem(command)));
      }

      if (element.section === 'predefined') {
        const sections: CommandSectionItem[] = [];
        sections.push(this.commandSectionItems.globals);
        if (this.openSourceCommands.length > 0) {
          sections.push(this.commandSectionItems.opensource);
        }
        return Promise.resolve(sections);
      }

      if (element.section === 'globals') {
        const sectionStartedAt = Date.now();
        for (const trace of this.pendingCommandRenderTraces.values()) {
          if (trace.scope === 'global' && !trace.scopeSectionSeenAt) {
            trace.scopeSectionSeenAt = sectionStartedAt;
            this.logger.trace(
              `[commands][trace] globals section requested for "${trace.label}" after ${sectionStartedAt - trace.startedAt}ms` +
                (trace.refreshFiredAt
                  ? ` (${sectionStartedAt - trace.refreshFiredAt}ms since refresh)`
                  : ''),
            );
          }
        }
        const commands = [...this.globalCommands]
          .sort((a, b) => b.addedAt - a.addedAt || a.label.localeCompare(b.label));
        const sectionDurationMs = Date.now() - sectionStartedAt;
        this.logger.trace(
          `[commands][trace] getChildren(globals) returned ${commands.length} items in ${sectionDurationMs}ms`,
        );
        for (const command of commands) {
          const trace = this.pendingCommandRenderTraces.get(command.id);
          if (trace) {
            this.logger.trace(
              `[commands][trace] tree materialized global command "${trace.label}" in ${Date.now() - trace.startedAt}ms`,
            );
            this.pendingCommandRenderTraces.delete(command.id);
          }
        }
        return Promise.resolve(commands.map((command) => new CommandItem(command)));
      }

      if (element.section === 'opensource') {
        return Promise.resolve(
          Array.from(
            new Set(
              this.openSourceCommands
                .map((command) => command.language.trim().toLowerCase() || 'generic')
                .sort(),
            ),
          ).map(
            (language) =>
              new CommandLanguageItem(
                'opensource',
                language,
                this.getPersistedCollapsibleState(
                  `command-language:opensource:${language}`,
                ),
              ),
          ),
        );
      }

      return Promise.resolve(
        [],
      );
    }

    if (element instanceof GroupItem) {
      const groupStartedAt = Date.now();
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
          const groupPaths = this.getGroupMap().get(element.groupName) ?? [];
          const hasFiles = groupPaths.some((filePath) => {
            const fileWf = this.getWorkspaceFolderCached(filePath);
            return fileWf?.uri.toString() === wf.uri.toString();
          });

          if (hasFiles) {
            workspaceItems.push(
              new WorkspaceItem(
                wf.name,
                element.groupName,
                this.getPersistedCollapsibleState(
                  `workspace:${element.groupName}:${wf.uri.toString()}`,
                ),
                wf,
              ),
            );
          }
        }

        this.logger.trace('[tree][trace] getChildren(group->workspaces) resolved', {
          durationMs: Date.now() - groupStartedAt,
          groupName: element.groupName,
          workspaceCount: workspaceItems.length,
        });
        return Promise.resolve(workspaceItems);
      }

      const favoriteItems: FavoriteItem[] = [];
      this.logger.debug(`[getChildren:group] Start "${element.groupName}"`);
      const groupPaths = this.getGroupMap().get(element.groupName) ?? [];
      for (const filePath of groupPaths) {
        const metadata = this.favorites.get(filePath);
        if (!metadata) continue;
        const wf = this.getWorkspaceFolderCached(filePath);
        if (!wf) continue;

        favoriteItems.push(
          new FavoriteItem(
            vscode.Uri.file(filePath),
            element.groupName,
            vscode.TreeItemCollapsibleState.None,
            metadata.isPinned,
          ),
        );
      }

      await this._resolveCollisions(favoriteItems, element.groupName);

      this.logger.trace('[tree][trace] getChildren(group->favorites) resolved', {
        durationMs: Date.now() - groupStartedAt,
        groupName: element.groupName,
        favoriteCount: favoriteItems.length,
      });

      return Promise.resolve(favoriteItems);
    }

    if (element instanceof WorkspaceItem) {
      const workspaceStartedAt = Date.now();
      const items: FavoriteItem[] = [];
      const groupPaths = this.getGroupMap().get(element.groupName) ?? [];
      for (const filePath of groupPaths) {
        const metadata = this.favorites.get(filePath);
        if (!metadata) continue;
        const wf = this.getWorkspaceFolderCached(filePath);
        if (wf?.uri.toString() !== element.workspaceFolder.uri.toString()) {
          continue;
        }

        items.push(
          new FavoriteItem(
            vscode.Uri.file(filePath),
            element.groupName,
            vscode.TreeItemCollapsibleState.None,
            metadata.isPinned,
          ),
        );
      }

      await this._resolveCollisions(
        items.filter((i): i is FavoriteItem => i instanceof FavoriteItem),
        `${element.groupName}:${element.name}`,
      );
      this.logger.trace('[tree][trace] getChildren(workspace->favorites) resolved', {
        durationMs: Date.now() - workspaceStartedAt,
        groupName: element.groupName,
        workspaceName: element.name,
        favoriteCount: items.length,
      });
      return Promise.resolve(items);
    }

    if (element instanceof CommandScopeItem) {
      const languages = Array.from(
        new Set(
          this.getCommandsByScope(element.scope)
            .map((command) => command.language.trim().toLowerCase() || 'generic')
            .sort(),
        ),
      );

      return Promise.resolve(
        languages.map(
          (language) =>
            new CommandLanguageItem(
              element.scope,
              language,
              this.getPersistedCollapsibleState(
                `command-language:${element.scope}:${language}`,
              ),
            ),
        ),
      );
    }

    if (element instanceof CommandLanguageItem) {
      if (element.scope === 'opensource') {
        return Promise.resolve(
          this.getCommandsByScope(element.scope)
            .filter(
              (command) =>
                (command.language.trim().toLowerCase() || 'generic') ===
                element.language,
            )
            .sort((a, b) => b.addedAt - a.addedAt || a.label.localeCompare(b.label))
            .map((command) => new CommandItem(command)),
        );
      }

      return Promise.resolve(
        this.getCommandsByScope(element.scope)
          .filter(
            (command) =>
              (command.language.trim().toLowerCase() || 'generic') ===
              element.language,
          )
          .sort((a, b) => b.addedAt - a.addedAt || a.label.localeCompare(b.label))
          .map((command) => new CommandItem(command)),
      );
    }

    return Promise.resolve([]);
  }

  private async _resolveCollisions(
    items: FavoriteItem[],
    groupName: string,
  ): Promise<void> {
    const startedAt = Date.now();
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
      this.logger.trace('[tree][trace] applyCollisionLabels resolved', {
        durationMs: Date.now() - startedAt,
        groupName,
        itemCount: items.length,
      });
    } catch (err) {
      this.logger.error(
        '[collisions] Error detecting collisions in tree view',
        err,
      );
    }
  }

  private getGroupMap(): Map<string, string[]> {
    if (this.cachedGroupMap) {
      return this.cachedGroupMap;
    }

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

    this.cachedGroupMap = groupMap;
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
    this.refreshSection('favorites');
  }

  setPinned(
    uri: vscode.Uri,
    isPinned: boolean,
    group?: string,
  ): void {
    const targetGroup = group || FavoritesTreeDataProvider.DEFAULT_GROUP;
    const filePath = uri.fsPath;
    const existing = this.favorites.get(filePath);

    if (!existing && !isPinned) {
      return;
    }

    if (!existing) {
      this.logger.debug(`[favorites] setPinned -> creating favorite ${filePath}`, {
        group: targetGroup,
        isPinned,
      });
      this.favorites.set(filePath, {
        group: targetGroup,
        addedAt: Date.now(),
        isPinned,
      });
    } else {
      existing.isPinned = isPinned;
      if (isPinned) {
        existing.addedAt = Date.now();
      }
      this.logger.debug(`[favorites] setPinned -> ${filePath} = ${isPinned}`, {
        group: existing.group,
      });
    }

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

    this.setPinned(uri, !metadata.isPinned, metadata.group);
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
    source: (
      | GroupItem
      | FavoriteItem
      | WorkspaceItem
      | CommandItem
      | CommandSectionItem
      | CommandScopeItem
      | CommandLanguageItem
    )[],
    dataTransfer: vscode.DataTransfer,
    token: vscode.CancellationToken,
  ): void | Thenable<void> {
    this.logger.debug(`[dnd] handleDrag sourceItems=${source.length}`);

    const draggedFiles = source
      .filter((item): item is FavoriteItem => item instanceof FavoriteItem)
      .map((item) => item.resourceUri.fsPath);

    const payload = { files: draggedFiles };

    if (draggedFiles.length > 0) {
      dataTransfer.set(
        'application/vnd.code.tree.favorites',
        new vscode.DataTransferItem(JSON.stringify(payload)),
      );
    }
  }

  async handleDrop(
    target:
      | GroupItem
      | FavoriteItem
      | WorkspaceItem
      | CommandItem
      | CommandSectionItem
      | CommandScopeItem
      | CommandLanguageItem
      | undefined,
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

        let payload: { files?: string[] };

        // Support both old format (string[]) and new format ({ files, commands })
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          payload = { files: parsed };
        } else {
          payload = parsed;
        }

        const filePaths = payload.files || [];
        this.logger.debug(
          `[dnd] Moving ${filePaths.length} files to "${targetGroupName}"`,
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
    this.invalidateTreeCaches();
    this.favorites.clear();
    this.groups.clear();
    this.groups.add(FavoritesTreeDataProvider.DEFAULT_GROUP);
    this.localCommands = [];
    this.globalCommands = [];
    this.openSourceCommands = [];
    this.loadFavorites();
  }

  private loadFavorites(): void {
    const sharedData = this.storage.get<FavoriteData[]>(
      'anfavorites.favorites.v2',
    );
    const sharedGroups = this.storage.get<string[]>('anfavorites.groups');

    if (sharedGroups) {
      sharedGroups.forEach((g) => this.groups.add(g));
    }
    this.loadCommands();

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

  private loadCommands(): void {
    this.localCommands = this.normalizeCommands(
      this.context.workspaceState.get<CommandFavoriteData[]>(
        LOCAL_COMMANDS_STORAGE_KEY,
        [],
      ),
      'local',
    );
    this.globalCommands = this.normalizeCommands(
      this.context.globalState.get<CommandFavoriteData[]>(
        GLOBAL_COMMANDS_STORAGE_KEY,
        [],
      ),
      'global',
    );
    const legacyCommands =
      this.storage.get<CommandFavoriteData[]>(LEGACY_COMMANDS_STORAGE_KEY) ??
      this.context.workspaceState.get<CommandFavoriteData[]>(
        LEGACY_COMMANDS_STORAGE_KEY,
        [],
      );
    if (legacyCommands.length > 0 && this.localCommands.length === 0) {
      this.localCommands = this.normalizeCommands(legacyCommands, 'local');
      void this.context.workspaceState.update(
        LOCAL_COMMANDS_STORAGE_KEY,
        this.localCommands,
      );
      void this.context.workspaceState.update(LEGACY_COMMANDS_STORAGE_KEY, undefined);
    }

    this.openSourceCommands = this.loadOpenSourceCatalog();
  }

  private normalizeCommands(
    commands: CommandFavoriteData[],
    scope: CommandFavoriteData['scope'],
  ): CommandFavoriteData[] {
    return commands.map((command) => ({
      ...command,
      scope: command.scope ?? scope,
      language: command.language ?? 'generic',
    }));
  }

  private loadOpenSourceCatalog(): CommandFavoriteData[] {
    const builtins: CommandFavoriteData[] = [
      {
        id: 'opensource:npm-init',
        label: 'npm init',
        command: 'npm init',
        background: false,
        addedAt: 0,
        type: 'shell',
        scope: 'opensource',
        language: 'node',
        readonly: true,
        source: 'builtin',
      },
      {
        id: 'opensource:mvn-clean-install-package',
        label: 'mvn clean install package',
        command: 'mvn clean install package',
        background: true,
        addedAt: 0,
        type: 'shell',
        scope: 'opensource',
        language: 'java',
        readonly: true,
        source: 'builtin',
      },
      {
        id: 'opensource:py-env',
        label: 'py env',
        command: 'py env',
        background: false,
        addedAt: 0,
        type: 'shell',
        scope: 'opensource',
        language: 'python',
        readonly: true,
        source: 'builtin',
      },
    ];

    const configuredPath = vscode.workspace
      .getConfiguration('anfavorites.commands')
      .get<string>('openSourceCatalogPath', '')
      .trim();
    const merged = new Map<string, CommandFavoriteData>(
      builtins.map((command) => [command.id, command]),
    );

    if (configuredPath) {
      try {
        const fs = require('fs') as typeof import('fs');
        const resolvedPath = path.isAbsolute(configuredPath)
          ? configuredPath
          : path.join(
              vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
              configuredPath,
            );
        const raw = fs.readFileSync(resolvedPath, 'utf8');
        const fileCommands = JSON.parse(raw) as Array<
          Partial<CommandFavoriteData> & { id: string; label: string; command: string }
        >;
        for (const command of fileCommands) {
          merged.set(command.id, {
            id: command.id,
            label: command.label,
            command: command.command,
            background: command.background ?? false,
            addedAt: 0,
            type: command.type ?? 'shell',
            scope: 'opensource',
            language: command.language ?? 'generic',
            readonly: true,
            source: 'file',
          });
        }
      } catch (error) {
        this.logger.warn('[commands] Failed to load OpenSource catalog file', {
          configuredPath,
          error,
        });
      }
    }

    return Array.from(merged.values());
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
      .map(([name, paths]) => ({
        name,
        count: paths.length,
        samplePaths: paths.slice(0, 5),
      }));

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
    const startedAt = Date.now();
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
      this.storage.updateMany({
        'anfavorites.favorites.v2': favoritesArray,
        'anfavorites.groups': Array.from(this.groups),
      });
    } finally {
      this._isSaving = false;
      this.logger.info('[favorites][trace] saveFavorites completed', {
        favoritesCount: favoritesArray.length,
        groupsCount: this.groups.size,
        durationMs: Date.now() - startedAt,
      });
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
    return [
      ...this.localCommands,
      ...this.globalCommands,
      ...this.openSourceCommands,
    ];
  }

  getCommandsByScope(
    scope: CommandFavoriteData['scope'],
  ): CommandFavoriteData[] {
    if (scope === 'local') return [...this.localCommands];
    if (scope === 'global') return [...this.globalCommands];
    return [...this.openSourceCommands];
  }

  private async saveCommands(): Promise<void> {
    await Promise.all([
      this.context.workspaceState.update(
        LOCAL_COMMANDS_STORAGE_KEY,
        this.localCommands,
      ),
      this.context.globalState.update(
        GLOBAL_COMMANDS_STORAGE_KEY,
        this.globalCommands,
      ),
    ]);
  }

  addCommand(
    data: Omit<CommandFavoriteData, 'id' | 'addedAt'>,
  ): CommandFavoriteData {
    const startedAt = Date.now();
    const hadAnyCommands = this.getCommands().length > 0;
    const hadLocalCommands = this.localCommands.length > 0;
    const hadGlobalCommands = this.globalCommands.length > 0;
    const hadOpenSourceCommands = this.openSourceCommands.length > 0;
    const newCmd: CommandFavoriteData = {
      ...data,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
      addedAt: Date.now(),
      scope: data.scope === 'global' ? 'global' : 'local',
      language: data.language ?? 'generic',
    };

    if (newCmd.scope === 'global') {
      this.globalCommands.push(newCmd);
    } else {
      this.localCommands.push(newCmd);
    }

    this.pendingCommandRenderTraces.set(newCmd.id, {
      startedAt,
      scope: newCmd.scope,
      label: newCmd.label,
    });

    void this.saveCommands();
    if (!hadAnyCommands) {
      this.refreshSection('commands');
    } else if (newCmd.scope === 'local') {
      if (hadLocalCommands) {
        this.refreshTreeElement(
          this.commandSectionItems.personalized,
          'refreshElement(personalized)',
        );
      } else {
        this.refreshTreeElement(
          this.commandSectionItems.commands,
          'refreshElement(commands)',
        );
      }
    } else if (hadGlobalCommands) {
      this.refreshTreeElement(
        this.commandSectionItems.globals,
        'refreshElement(globals)',
      );
    } else if (hadOpenSourceCommands) {
      this.refreshTreeElement(
        this.commandSectionItems.predefined,
        'refreshElement(predefined)',
      );
    } else {
      this.refreshTreeElement(
        this.commandSectionItems.commands,
        'refreshElement(commands)',
      );
    }
    this.logger.trace(
      `[commands][trace] addCommand queued "${newCmd.label}" scope=${newCmd.scope} in ${Date.now() - startedAt}ms`,
    );
    return newCmd;
  }

  removeCommand(id: string): void {
    const localBefore = this.localCommands.length;
    const globalBefore = this.globalCommands.length;
    this.localCommands = this.localCommands.filter((c) => c.id !== id);
    this.globalCommands = this.globalCommands.filter((c) => c.id !== id);
    if (
      this.localCommands.length !== localBefore ||
      this.globalCommands.length !== globalBefore
    ) {
      void this.saveCommands();
      this.refresh();
      this.logger.debug(`[commands] removeCommand -> id=${id}`);
    }
  }

  removeCommandsByScope(scope: 'local' | 'global'): number {
    const removedCount =
      scope === 'local' ? this.localCommands.length : this.globalCommands.length;

    if (removedCount === 0) {
      return 0;
    }

    if (scope === 'local') {
      this.localCommands = [];
    } else {
      this.globalCommands = [];
    }

    void this.saveCommands();
    this.refresh();
    this.logger.debug(
      `[commands] removeCommandsByScope -> scope=${scope} removed=${removedCount}`,
    );
    return removedCount;
  }

  saveOpenSourceCommandAs(
    id: string,
    scope: 'local' | 'global',
    overrides?: Partial<Omit<CommandFavoriteData, 'id' | 'addedAt' | 'scope'>>,
  ): CommandFavoriteData | undefined {
    const source = this.openSourceCommands.find((command) => command.id === id);
    if (!source) {
      this.logger.warn(
        `[commands] saveOpenSourceCommandAs FAILED (not found) -> id=${id}`,
      );
      return undefined;
    }

    return this.addCommand({
      label: overrides?.label ?? source.label,
      command: overrides?.command ?? source.command,
      cwd: overrides?.cwd ?? source.cwd,
      background: overrides?.background ?? source.background,
      type: overrides?.type ?? source.type,
      language: overrides?.language ?? source.language,
      scope,
      readonly: false,
      source: undefined,
      templateSourceId: overrides?.templateSourceId ?? source.id,
    });
  }

  editCommand(
    id: string,
    data: Partial<Omit<CommandFavoriteData, 'id' | 'addedAt'>>,
  ): boolean {
    const existing = [...this.localCommands, ...this.globalCommands].find(
      (command) => command.id === id,
    );
    if (!existing) {
      this.logger.warn(`[commands] editCommand FAILED (not found) -> id=${id}`);
      return false;
    }

    const updated: CommandFavoriteData = {
      ...existing,
      ...data,
      scope:
        data.scope === 'global'
          ? 'global'
          : data.scope === 'local'
            ? 'local'
            : existing.scope,
      language: data.language ?? existing.language ?? 'generic',
    };

    this.localCommands = this.localCommands.filter((command) => command.id !== id);
    this.globalCommands = this.globalCommands.filter(
      (command) => command.id !== id,
    );
    if (updated.scope === 'global') {
      this.globalCommands.push(updated);
    } else {
      updated.scope = 'local';
      this.localCommands.push(updated);
    }

    void this.saveCommands();
    this.refresh();
    this.logger.debug(`[commands] editCommand -> id=${id}`);
    return true;
  }

  async runCommand(item: CommandItem): Promise<void> {
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

    let resolvedCwd = resolveWorkspaceCwd(data.cwd);
    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const requiresWorkspaceSelection =
      !data.cwd &&
      workspaceFolders.length > 1 &&
      (data.scope === 'global' || data.scope === 'opensource');

    if (requiresWorkspaceSelection) {
      resolvedCwd = await promptWorkspaceRootForCommand(data.label);
      if (!resolvedCwd) {
        this.logger.debug(
          `[commands] runCommand cancelled (workspace selection) -> "${data.label}"`,
        );
        return;
      }
    }

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
    if (this.persistExpandedTreeStateTimer) {
      clearTimeout(this.persistExpandedTreeStateTimer);
      this.persistExpandedTreeStateTimer = undefined;
    }
    void this.flushExpandedTreeState();
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables.length = 0;
    this._onDidChangeTreeData.dispose();
  }
}
