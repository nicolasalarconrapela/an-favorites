import * as vscode from 'vscode';
import * as path from 'path';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { MRUService } from '../services/mruService';
import { Logger } from '../logging/logger';
import {
  QuickOpenConfig,
  QuickOpenConfigService,
} from './quickOpen/quickOpenHelpers';
import { QuickOpenSearchService } from './quickOpen/quickOpenSearchService';
import {
  applyCollisionLabels,
  normalizeFsPath,
  safeBasenameFromUri,
} from '../utils/collisionUtils';
import { VscodeQuickOpenConfigService } from '../adapters/vscodeQuickOpenConfigService';
import { VscodeQuickOpenSearchService } from '../adapters/vscodeQuickOpenSearchService';

type QuickOpenItem = vscode.QuickPickItem;

interface SearchCacheEntry {
  uris: vscode.Uri[];
  exceededMaxFiles: boolean;
}

class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  private maxEntries: number;

  constructor(maxEntries: number) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (!value) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.evictIfNeeded();
  }

  clear(): void {
    this.map.clear();
  }

  setLimit(maxEntries: number): void {
    this.maxEntries = Math.max(1, maxEntries);
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) return;
      this.map.delete(oldestKey);
    }
  }
}

function buildSearchPattern(searchValue: string): string {
  const normalized = searchValue.trim();
  if (!normalized) return '**/*';
  return `**/*${normalized}*`;
}

function isFileItem(item: vscode.QuickPickItem): item is FileQuickPickItem {
  return (item as any)?.itemType === 'file';
}

function isLineFavoriteItem(
  item: vscode.QuickPickItem,
): item is LineQuickPickItem {
  return (item as any)?.itemType === 'lineFavorite';
}

function isFileLikeItem(
  item: vscode.QuickPickItem,
): item is FileQuickPickItem | LineQuickPickItem {
  return isFileItem(item) || isLineFavoriteItem(item);
}

type FavoritesAction = 'clearRecents' | 'loadMore';

interface ActionQuickPickItem extends vscode.QuickPickItem {
  action: FavoritesAction;
}

function toSafeFileUri(value: unknown, logger?: Logger): vscode.Uri | null {
  if (typeof value !== 'string') {
    logger?.warn?.('MRU entry is not a string', { value });
    return null;
  }

  const p = value.trim();
  if (!p) return null;

  try {
    return vscode.Uri.file(p);
  } catch (e) {
    logger?.warn?.('Failed to build Uri.file from MRU entry', {
      value: p,
      error: e,
    });
    return null;
  }
}

function workspaceRelativeLabel(uri: vscode.Uri): {
  rel: string;
  rootName?: string;
} {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    const fsPath = (uri as any)?.fsPath;
    return {
      rel: typeof fsPath === 'string' && fsPath ? fsPath : uri.toString(),
    };
  }

  const folder = vscode.workspace.getWorkspaceFolder(uri);

  const rel = vscode.workspace.asRelativePath(uri, false);

  if (folders.length > 1 && folder) {
    return { rel, rootName: folder.name };
  }

  return { rel };
}

function getQuickPickItemKey(item: QuickOpenItem): string | null {
  if (isLineFavoriteItem(item)) {
    return `${item.resourceUri.toString()}:${item.line}`;
  }
  if (isFileItem(item)) {
    return item.resourceUri.toString();
  }
  return null;
}

async function openFileAtLine(
  uri: vscode.Uri,
  line: number,
  viewColumn?: vscode.ViewColumn,
): Promise<void> {
  const targetLine = Math.max(1, line) - 1;
  const editor = await vscode.window.showTextDocument(uri, {
    preview: false,
    viewColumn,
  });
  const position = new vscode.Position(targetLine, 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position));
}

function debounce<T extends (...args: any[]) => any>(
  func: T,
  waitMs: number,
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | undefined;
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, waitMs);
  };
}

function buildPinnedItems(
  uris: vscode.Uri[],
  favoritesProvider: FavoritesTreeDataProvider,
  config: QuickOpenConfig,
): FileQuickPickItem[] {
  return uris.map((uri) => {
    const isIndividual = favoritesProvider.isPinned(uri);
    return new FileQuickPickItem({
      uri,
      isFavorite: favoritesProvider.hasFavorite(uri),
      isPinned: true,
      isRecentlyOpened: false,
      openToSide: config.openToSide,
      isIndividualPinned: isIndividual,
      showIcons: config.showIcons,
      pathDetailLocation: config.pathDetailLocation,
      showPathWhen: config.showPathWhen,
    });
  });
}

function buildLineFavoriteItems(
  entries: Array<{ uri: vscode.Uri; line: number; isPinned: boolean }>,
  config: QuickOpenConfig,
): LineQuickPickItem[] {
  return entries.map(
    ({ uri, line, isPinned }) =>
      new LineQuickPickItem({
        uri,
        line,
        isPinned,
        showIcons: config.showIcons,
        pathDetailLocation: config.pathDetailLocation,
        showPathWhen: config.showPathWhen,
      }),
  );
}

function buildRecentFavoriteItems(
  uris: vscode.Uri[],
  favoritesProvider: FavoritesTreeDataProvider,
  config: QuickOpenConfig,
): FileQuickPickItem[] {
  return uris.map((uri) => {
    const isPinned = favoritesProvider.isPinned(uri);
    return new FileQuickPickItem({
      uri,
      isFavorite: true,
      isPinned: false,
      isIndividualPinned: isPinned,
      isRecentlyOpened: false,
      openToSide: config.openToSide,
      showIcons: config.showIcons,
      pathDetailLocation: config.pathDetailLocation,
      showPathWhen: config.showPathWhen,
    });
  });
}

function buildRecentItems(
  uris: vscode.Uri[],
  favoritesProvider: FavoritesTreeDataProvider,
  config: QuickOpenConfig,
): FileQuickPickItem[] {
  return uris.map((uri) => {
    const isFav = favoritesProvider.hasFavorite(uri);
    const isPinned = favoritesProvider.isPinned(uri);
    return new FileQuickPickItem({
      uri,
      isFavorite: isFav,
      isPinned: false,
      isIndividualPinned: isPinned,
      isRecentlyOpened: true,
      openToSide: config.openToSide,
      showIcons: config.showIcons,
      pathDetailLocation: config.pathDetailLocation,
      showPathWhen: config.showPathWhen,
    });
  });
}

async function buildSearchItems(params: {
  normalizedSearch: string;
  searchCache: LruCache<string, SearchCacheEntry>;
  config: QuickOpenConfig;
  favoritesProvider: FavoritesTreeDataProvider;
  recentNormSet: Set<string>;
  recentFavNormSet: Set<string>;
  pinnedNormSet: Set<string>;
  searchPage: number;
  searchService: QuickOpenSearchService;
  token: vscode.CancellationToken;
}): Promise<{
  items: FileQuickPickItem[];
  noticeItem: QuickOpenItem | null;
  loadMoreItem: ActionQuickPickItem | null;
}> {
  const {
    normalizedSearch,
    searchCache,
    config,
    favoritesProvider,
    recentNormSet,
    recentFavNormSet,
    pinnedNormSet,
    searchPage,
    searchService,
    token,
  } = params;
  const exclusionGlob = config.searchExclusions.length
    ? `{${config.searchExclusions.join(',')}}`
    : undefined;
  const cacheKey = normalizedSearch;
  let cacheEntry = searchCache.get(cacheKey);
  let noticeItem: QuickOpenItem | null = null;
  let loadMoreItem: ActionQuickPickItem | null = null;

  if (!cacheEntry) {
    const searchPattern = buildSearchPattern(cacheKey);
    const searchLimit = Math.max(1, config.maxSearchFiles) + 1;
    const foundUris = await searchService.findFiles(
      searchPattern,
      exclusionGlob,
      searchLimit,
      token,
    );
    const exceededMaxFiles = foundUris.length > config.maxSearchFiles;
    cacheEntry = {
      uris: foundUris.slice(0, config.maxSearchFiles),
      exceededMaxFiles,
    };
    searchCache.set(cacheKey, cacheEntry);
  }

  if (cacheEntry.exceededMaxFiles) {
    noticeItem = {
      label: `Se alcanzó el máximo de ${config.maxSearchFiles} archivos. Refina la búsqueda.`,
      detail: '',
    };
  }

  const maxDisplayResults = Math.max(
    1,
    Math.min(config.maxSearchResults, config.maxSearchFiles),
  );
  const displayLimit = Math.min(
    cacheEntry.uris.length,
    maxDisplayResults * searchPage,
  );

  const items = cacheEntry.uris
    .map((uri) => {
      return new FileQuickPickItem({
        uri,
        isFavorite: false,
        isPinned: false,
        isRecentlyOpened: false,
        openToSide: config.openToSide,
        showIcons: config.showIcons,
        pathDetailLocation: config.pathDetailLocation,
        showPathWhen: config.showPathWhen,
      });
    })
    .filter((item) => {
      const normalizedPath = normalizeFsPath(item.resourceUri.fsPath);
      return (
        !recentNormSet.has(normalizedPath) &&
        !recentFavNormSet.has(normalizedPath) &&
        !pinnedNormSet.has(normalizedPath)
      );
    })
    .slice(0, displayLimit)
    .map((item) => {
      const isFav = favoritesProvider.hasFavorite(item.resourceUri);
      if (item.isFavorite !== isFav) {
        item.isFavorite = isFav;
        item.updateIcon(config.showIcons);
      }
      return item;
    });

  if (cacheEntry.uris.length > displayLimit) {
    loadMoreItem = {
      label: 'Load More',
      description: `Mostrando ${displayLimit} de ${cacheEntry.uris.length}`,
      action: 'loadMore',
    };
  }

  return {
    items,
    noticeItem,
    loadMoreItem,
  };
}




async function validateFilesExistence(
  uris: vscode.Uri[],
  token?: vscode.CancellationToken,
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  await Promise.all(
    uris.map(async (uri) => {
      if (token?.isCancellationRequested) {
        return;
      }
      if (uri.scheme !== 'file') {
        results.set(uri.fsPath, false);
        return;
      }
      try {
        await vscode.workspace.fs.stat(uri);
        results.set(uri.fsPath, true);
      } catch {
        results.set(uri.fsPath, false);
      }
    }),
  );
  return results;
}

function createIconWithFallback(
  primaryIconId: string,
  fallbackIconId: string = 'file',
): vscode.ThemeIcon {
  try {
    return new vscode.ThemeIcon(primaryIconId);
  } catch {
    return new vscode.ThemeIcon(fallbackIconId);
  }
}

function createButtonIcon(
  iconId: string,
  fallbackIconId: string = 'circle-outline',
): vscode.ThemeIcon {
  const knownIcons = new Set([
    'star-full',
    'star-empty',
    'pin',
    'pinned',
    'split-horizontal',
    'close',
    'file',
    'folder',
    'symbol-file',
    'bookmark',
    'heart',
    'trash',
    'x',
    'circle-filled',
    'circle-outline',
  ]);

  if (knownIcons.has(iconId)) {
    return new vscode.ThemeIcon(iconId);
  }

  try {
    return new vscode.ThemeIcon(iconId);
  } catch {
    return new vscode.ThemeIcon(fallbackIconId);
  }
}

class FileQuickPickItem implements vscode.QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  buttons?: vscode.QuickInputButton[];
  iconPath?: vscode.ThemeIcon;
  kind?: vscode.QuickPickItemKind;
  readonly itemType = 'file';

  resourceUri: vscode.Uri;
  isFavorite: boolean;
  isPinned: boolean;
  isRecentlyOpened: boolean;
  isIndividualPinned: boolean;

  private _fullPathLabel: string = '';
  private _dirPathLabel: string = '';

  private _detailPathText?: string;

  private _openToSide: boolean;
  public showIcons: boolean;
  private pathDetailLocation: 'description' | 'detail';
  private showPathWhen: 'always' | 'onConflict';

  constructor(params: {
    uri: vscode.Uri;
    isFavorite: boolean;
    isPinned?: boolean;
    isRecentlyOpened?: boolean;
    openToSide?: boolean;
    isIndividualPinned?: boolean;
    showIcons?: boolean;
    pathDetailLocation?: 'description' | 'detail';
    showPathWhen?: 'always' | 'onConflict';
  }) {
    const {
      uri,
      isFavorite,
      isPinned = false,
      isRecentlyOpened = false,
      openToSide = false,
      isIndividualPinned = false,
      showIcons = true,
      pathDetailLocation = 'detail',
      showPathWhen = 'onConflict',
    } = params;

    this.resourceUri = uri;
    this.isFavorite = isFavorite;
    this.isPinned = isPinned;
    this.isRecentlyOpened = isRecentlyOpened;
    this._openToSide = openToSide;
    this.isIndividualPinned = isIndividualPinned;
    this.showIcons = showIcons;
    this.pathDetailLocation = pathDetailLocation;
    this.showPathWhen = showPathWhen;

    const baseName = safeBasenameFromUri(uri);

    let iconPrefix = isFavorite ? '$(star-full)' : '$(star-empty)';
    if (isPinned) iconPrefix = '$(pin)';

    this.label = `${iconPrefix} ${baseName}`;

    const { rel, rootName } = workspaceRelativeLabel(uri);

    const dir = path.dirname(rel);
    const cleanDir = dir === '.' || dir === '' ? '.' : dir;

    if (rootName) {
      this._fullPathLabel =
        cleanDir === '.' ? rootName : `[ ${rootName} ] ${cleanDir}`;
      this._dirPathLabel = this._fullPathLabel;
    } else {
      this._fullPathLabel = cleanDir;
      this._dirPathLabel = this._fullPathLabel;
    }

    if (this.pathDetailLocation === 'detail') {
      this._detailPathText = rootName
        ? cleanDir === '.'
          ? `${rootName}`
          : `[ ${rootName} ] ${cleanDir}`
        : `${cleanDir}`;

      this.detail = `${this._detailPathText}`;
      this.description = '';
    } else {
      this.detail = '';
      this.description = '';
    }

    this.updateIcon(this.showIcons);

    this.setShowDescription(false);
  }

  public setShowDescription(isDuplicate: boolean): void {
    const shouldShowPath = this.showPathWhen === 'always' || isDuplicate;

    if (this.pathDetailLocation === 'detail') {
      if (shouldShowPath && this._detailPathText) {
        this.detail = `${this._detailPathText}`;
      } else {
        this.detail = '';
      }
      this.description = ' ';
      return;
    }

    this.description = shouldShowPath ? this._fullPathLabel : '';
    this.detail = undefined;
  }

  updateIcon(showIcons: boolean = true): void {
    if (showIcons) {
      this.iconPath = createIconWithFallback('file', 'symbol-file');
    } else {
      this.iconPath = undefined;
    }

    const baseName = safeBasenameFromUri(this.resourceUri);
    let iconPrefix = this.isFavorite ? '$(star-full) ' : '     ';
    if (this.isPinned) iconPrefix = '$(pin) ';
    this.label = `${iconPrefix} ${baseName}`;

    const buttons: vscode.QuickInputButton[] = [];

    const isPinnedState = this.isIndividualPinned;
    const pinTooltip = isPinnedState ? 'Desfijar' : 'Fijar';

    if (!this.isRecentlyOpened) {
      buttons.push({
        iconPath: createButtonIcon(
          isPinnedState ? 'pinned' : 'pin',
          'bookmark',
        ),
        tooltip: pinTooltip,
      });
    }

    buttons.push({
      iconPath: createButtonIcon(
        this.isFavorite ? 'star-full' : 'star-empty',
        this.isFavorite ? 'heart' : 'circle-outline',
      ),
      tooltip: this.isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos',
    });

    if (!this._openToSide) {
      buttons.push({
        iconPath: createButtonIcon('split-horizontal', 'symbol-file'),
        tooltip: 'Abrir al lado',
      });
    }

    if (this.isRecentlyOpened) {
      buttons.push({
        iconPath: createButtonIcon('close', 'x'),
        tooltip: 'Eliminar de recientes',
      });
    }

    this.buttons = buttons;
  }
}

class LineQuickPickItem implements vscode.QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  iconPath?: vscode.ThemeIcon;
  buttons?: vscode.QuickInputButton[];
  kind?: vscode.QuickPickItemKind;
  readonly itemType = 'lineFavorite';

  resourceUri: vscode.Uri;
  line: number;
  isPinned: boolean;

  private _fullPathLabel: string = '';
  private _dirPathLabel: string = '';
  private _detailPathText?: string;

  public showIcons: boolean;
  private pathDetailLocation: 'description' | 'detail';
  private showPathWhen: 'always' | 'onConflict';

  constructor(params: {
    uri: vscode.Uri;
    line: number;
    isPinned?: boolean;
    showIcons?: boolean;
    pathDetailLocation?: 'description' | 'detail';
    showPathWhen?: 'always' | 'onConflict';
  }) {
    const {
      uri,
      line,
      isPinned = false,
      showIcons = true,
      pathDetailLocation = 'detail',
      showPathWhen = 'onConflict',
    } = params;

    this.resourceUri = uri;
    this.line = line;
    this.isPinned = isPinned;
    this.showIcons = showIcons;
    this.pathDetailLocation = pathDetailLocation;
    this.showPathWhen = showPathWhen;

    this.updateIcon(this.showIcons);

    const { rel, rootName } = workspaceRelativeLabel(uri);

    const dir = path.dirname(rel);
    const cleanDir = dir === '.' || dir === '' ? '.' : dir;

    if (rootName) {
      this._fullPathLabel =
        cleanDir === '.' ? rootName : `[ ${rootName} ] ${cleanDir}`;
      this._dirPathLabel = this._fullPathLabel;
    } else {
      this._fullPathLabel = cleanDir;
      this._dirPathLabel = this._fullPathLabel;
    }

    if (this.pathDetailLocation === 'detail') {
      this._detailPathText = rootName
        ? cleanDir === '.'
          ? `${rootName}`
          : `[ ${rootName} ] ${cleanDir}`
        : `${cleanDir}`;

      this.detail = `${this._detailPathText}`;
      this.description = '';
    } else {
      this.detail = '';
      this.description = '';
    }

    this.setShowDescription(false);
  }

  public setShowDescription(isDuplicate: boolean): void {
    const shouldShowPath = this.showPathWhen === 'always' || isDuplicate;

    if (this.pathDetailLocation === 'detail') {
      if (shouldShowPath && this._detailPathText) {
        this.detail = `${this._detailPathText}`;
      } else {
        this.detail = '';
      }
      this.description = ' ';
      return;
    }

    this.description = shouldShowPath ? this._fullPathLabel : '';
    this.detail = undefined;
  }

  updateIcon(showIcons: boolean = true): void {
    if (showIcons) {
      this.iconPath = createIconWithFallback('bookmark', 'symbol-file');
    } else {
      this.iconPath = undefined;
    }

    const baseName = safeBasenameFromUri(this.resourceUri);
    const iconPrefix = this.isPinned ? '$(pin)' : '$(star-full)';
    this.label = `${iconPrefix} ${baseName}:${this.line}`;

    const pinTooltip = this.isPinned ? 'Desfijar' : 'Fijar';
    this.buttons = [
      {
        iconPath: createButtonIcon(this.isPinned ? 'pinned' : 'pin', 'bookmark'),
        tooltip: pinTooltip,
      },
      {
        iconPath: createButtonIcon('close', 'x'),
        tooltip: 'Eliminar de favoritos',
      },
    ];
  }
}

export function registerQuickOpenCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: Logger,
  mruService: MRUService,
): void {
  const throttleIntervalMs = 2000;
  const configService: QuickOpenConfigService =
    new VscodeQuickOpenConfigService();
  const searchService: QuickOpenSearchService =
    new VscodeQuickOpenSearchService();
  const logThrottled = (
    level: 'debug' | 'info' | 'warn' | 'error',
    key: string,
    message: string,
    metadata?: unknown,
    logTarget: Logger = logger,
  ) => {
    if (logTarget?.throttle) {
      logTarget.throttle(level, key, message, metadata, throttleIntervalMs);
      return;
    }
    logTarget?.[level]?.(message, metadata);
  };

  const disposable = vscode.commands.registerCommand(
    'anfavorites.quickOpen',
    async () => {
      const sessionId = `quickopen-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const log = logger?.withContext
        ? logger.withContext({ scope: 'QuickOpen', correlationId: sessionId })
        : logger;
      const logThrottledWithContext = (
        level: 'debug' | 'info' | 'warn' | 'error',
        key: string,
        message: string,
        metadata?: unknown,
      ) => logThrottled(level, key, message, metadata, log);
      log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log.info('🔍 [QuickOpen] COMMAND STARTED - ALT+SHIFT+F');
      log.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      log.debug(
        `[QuickOpen] Environment: ${vscode.env.appName} (${vscode.version})`,
      );
      log.debug(`[QuickOpen] URI Scheme: ${vscode.env.uriScheme}`);
      log.debug(`[QuickOpen] Platform: ${process.platform}`);
      log.debug(`[QuickOpen] Language: ${vscode.env.language}`);

      const quickPick = vscode.window.createQuickPick<QuickOpenItem>();
      log.debug('[QuickOpen] QuickPick instance created');

      quickPick.placeholder = 'Buscar archivos por nombre';
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;
      quickPick.canSelectMany = false;

      quickPick.ignoreFocusOut = true;
      log.debug('[QuickOpen] ignoreFocusOut set to true (hardcoded)');

      log.debug(
        '[QuickOpen] Preparing QuickPick (not showing yet to avoid focus loss)...',
      );

      try {
        log.debug('[QuickOpen] Validating favorites...');
        await favoritesProvider.validateFavorites();
        log.debug('[QuickOpen] Favorites validated successfully');

        log.debug('[QuickOpen] Validating line favorites...');
        await favoritesProvider.validateLineFavorites();
        log.debug('[QuickOpen] Line favorites validated successfully');

        log.debug('[QuickOpen] Validating MRU files...');
        await mruService.validateFiles();
        log.debug('[QuickOpen] MRU files validated successfully');
      } catch (error) {
        log.error('[QuickOpen] ❌ ERROR during validation:', error);
      }

      log.debug('[QuickOpen] Validation phase complete');

      const disposables: vscode.Disposable[] = [];
      let isDisposed = false;

      const safeDispose = () => {
        if (isDisposed) {
          log.debug('[QuickOpen] safeDispose() called but already disposed');
          return;
        }
        isDisposed = true;
        buildTokenSource?.cancel();
        buildTokenSource?.dispose();
        buildTokenSource = null;
        log.info('[QuickOpen] Disposing QuickPick and listeners...');
        try {
          disposables.forEach((d) => d.dispose());
          log.info(`[QuickOpen] Disposed ${disposables.length} listeners`);
        } finally {
          quickPick.dispose();
          log.info('[QuickOpen] QuickPick disposed');
        }
      };

      disposables.push(
        quickPick.onDidHide(() => {
          log.info('[QuickOpen] onDidHide triggered');
          safeDispose();
        }),
      );
      log.info('[QuickOpen] onDidHide listener registered');

      const searchCache = new LruCache<string, SearchCacheEntry>(30);
      let buildTokenSource: vscode.CancellationTokenSource | null = null;
      let searchPage = 1;
      let previousSearchValue = '';


      const buildItems = async (
        searchQuery: string = quickPick.value,
      ): Promise<void> => {
        buildTokenSource?.cancel();
        buildTokenSource?.dispose();
        buildTokenSource = new vscode.CancellationTokenSource();
        const token = buildTokenSource.token;
        log.debug(
          `[QuickOpen] ▶ buildItems() called - searchQuery: "${searchQuery}"`,
        );

        if (isDisposed) {
          log.warn('[QuickOpen] buildItems() aborted - already disposed');
          return;
        }

        const normalizedSearch = searchQuery.trim();
        const isSearching = normalizedSearch.length > 0;
        if (normalizedSearch !== previousSearchValue) {
          searchPage = 1;
          previousSearchValue = normalizedSearch;
        }


      const currentActiveItem = quickPick.activeItems[0];
      const currentActiveKey = currentActiveItem
        ? getQuickPickItemKey(currentActiveItem)
        : null;

        try {
          const isSearchValueCurrent = () =>
            normalizedSearch === quickPick.value.trim();

          log.debug(
            `[QuickOpen] Current search value: "${normalizedSearch}" (isSearching: ${isSearching})`,
          );

          log.debug('[QuickOpen] Reloading favorites from storage...');
          favoritesProvider.reloadFavorites();
          favoritesProvider.reloadLineFavorites();
          log.debug('[QuickOpen] Favorites reloaded');


          const config = configService.getConfig();

          const folders = vscode.workspace.workspaceFolders ?? [];
          const hasWorkspace = folders.length > 0;

          log.debug(
            `[QuickOpen] Workspace state: hasWorkspace=${hasWorkspace}, folders=${folders.length}`,
          );
          if (folders.length > 0) {
            folders.forEach((f, i) =>
              log.debug(
                `[QuickOpen] Folder[${i}]: name=${f.name}, uri=${f.uri.toString()}`,
              ),
            );
          }
          searchCache.setLimit(config.searchCacheSize);

          log.debug(
            `[QuickOpen] Config: maxRecentFav=${config.maxRecentFavorites}, maxPinned=${config.maxPinned}, maxRecentFiles=${config.maxRecentFiles}, showIcons=${config.showIcons}, exclusions=${config.searchExclusions.length}`,
          );

          log.debug('[QuickOpen] Fetching recent files from MRU...');
          const rawRecent: unknown[] =
            (mruService.getRecentFiles?.() as any) ?? [];
          log.debug(`[QuickOpen] Raw MRU entries: ${rawRecent.length}`);
          const recentUrisUnsafe = rawRecent
            .map((v) => toSafeFileUri(v, logger))
            .filter((u): u is vscode.Uri => !!u);

          const recentUris = recentUrisUnsafe.filter((u) => {
            return (
              u.scheme === 'file' && !!vscode.workspace.getWorkspaceFolder(u)
            );
          });

          const recentNormSet = new Set(
            recentUris.map((u) => normalizeFsPath(u.fsPath)),
          );

          const pinnedFavUris = favoritesProvider
            .getPinnedFavorites()
            .slice(0, config.maxPinned);


          const allPinnedUrisUnsafe = [...pinnedFavUris];

          const uniquePinnedUris: vscode.Uri[] = [];
          const seenPinned = new Set<string>();
          for (const u of allPinnedUrisUnsafe) {
            const norm = normalizeFsPath(u.fsPath);
            if (!seenPinned.has(norm)) {
              seenPinned.add(norm);
              uniquePinnedUris.push(u);
            }
          }

          const allPinnedUris = uniquePinnedUris.filter((u) => {
            return (
              u.scheme === 'file' && !!vscode.workspace.getWorkspaceFolder(u)
            );
          });
          const pinnedNormSet = new Set(
            allPinnedUris.map((u) => normalizeFsPath(u.fsPath)),
          );

          const recentFavUris = favoritesProvider
            .getRecentFavorites(20)
            .filter((uri) => {
              return (
                uri.scheme === 'file' &&
                !!vscode.workspace.getWorkspaceFolder(uri) &&
                !pinnedNormSet.has(normalizeFsPath(uri.fsPath))
              );
            })
            .slice(0, config.maxRecentFavorites);
          const recentFavNormSet = new Set(
            recentFavUris.map((u) => normalizeFsPath(u.fsPath)),
          );

          const lineFavoritesEntries = favoritesProvider
            .getAllLineFavorites()
            .map((entry) => ({
              uri: vscode.Uri.file(entry.path),
              line: entry.line,
              isPinned: !!entry.isPinned,
            }))
            .filter((entry) => {
              return (
                entry.uri.scheme === 'file' &&
                !!vscode.workspace.getWorkspaceFolder(entry.uri)
              );
            });

          const allUrisToDisplay = [
            ...allPinnedUris,
            ...recentFavUris,
            ...recentUris,
            ...lineFavoritesEntries.map((entry) => entry.uri),
          ];
          const existenceMap = await validateFilesExistence(
            allUrisToDisplay,
            token,
          );
          if (isDisposed) return;

          const validPinnedUris = allPinnedUris.filter((uri) => {
            const exists = existenceMap.get(uri.fsPath) ?? false;

            return exists;
          });

          const validRecentFavUris = recentFavUris.filter((uri) => {
            const exists = existenceMap.get(uri.fsPath) ?? false;
            if (!exists) {
              favoritesProvider.removeFavorite(uri);
            }
            return exists;
          });

          const validRecentUris = recentUris.filter((uri) => {
            const exists = existenceMap.get(uri.fsPath) ?? false;
            if (!exists) {
              mruService.remove(uri.fsPath);
            }
            return exists;
          });




          const pinnedItems = buildPinnedItems(
            validPinnedUris,
            favoritesProvider,
            config,
          );
          const validLineFavorites = lineFavoritesEntries.filter((entry) => {
            const exists = existenceMap.get(entry.uri.fsPath) ?? false;
            if (!exists) {
              favoritesProvider.removeLineFavorite(entry.uri, entry.line);
            }
            return exists;
          });

          const pinnedLineFavorites = validLineFavorites.filter(
            (entry) => entry.isPinned,
          );
          const unpinnedLineFavorites = validLineFavorites.filter(
            (entry) => !entry.isPinned,
          );

          const pinnedLineItems = buildLineFavoriteItems(
            pinnedLineFavorites,
            config,
          );
          const recentFavItems = buildRecentFavoriteItems(
            validRecentFavUris,
            favoritesProvider,
            config,
          );
          const lineFavoriteItems = buildLineFavoriteItems(
            unpinnedLineFavorites,
            config,
          );
          const recentItems = buildRecentItems(
            validRecentUris.slice(0, config.maxRecentFiles),
            favoritesProvider,
            config,
          );

          const combinedFavoriteItems = [
            ...lineFavoriteItems,
            ...recentFavItems,
          ];

          const items: QuickOpenItem[] = [];

          const combinedPinnedItems = [...pinnedItems, ...pinnedLineItems];
          if (combinedPinnedItems.length > 0) {
            items.push(...combinedPinnedItems);
          }

          const hasFavoriteItems = combinedFavoriteItems.length > 0;
          items.push({
            label: hasFavoriteItems ? 'Favoritos' : 'Aún no hay favoritos',
            kind: vscode.QuickPickItemKind.Separator,
          });
          items.push({ label: ' ', alwaysShow: false });

          if (hasFavoriteItems) {
            const sortedFavorites = [...combinedFavoriteItems].sort((a, b) => {
              const pinnedA = isLineFavoriteItem(a) ? a.isPinned : false;
              const pinnedB = isLineFavoriteItem(b) ? b.isPinned : false;
              if (pinnedA !== pinnedB) {
                return pinnedA ? -1 : 1;
              }
              return 0;
            });
            items.push(...sortedFavorites);
          } else if (!isSearching) {
            items.push({
              label:
                'Busque un archivo para añadirlo a favoritos en icono de la derecha',
              description: '',
              detail: '',
            });
          }

          const hasRecentFiles = recentItems.length > 0;

          items.push({
            label: hasRecentFiles ? 'Recientes' : 'No hay recientes nuevos',
            kind: vscode.QuickPickItemKind.Separator,
          });

          if (hasRecentFiles) {
            const clearRecentsItem: ActionQuickPickItem = {
              label: '$(trash) Limpiar todo',
              action: 'clearRecents',
            };

            if (!isSearching) {
              items.push(clearRecentsItem);
            }
            items.push(...recentItems);
          } else if (!isSearching) {
            items.push({ label: '', description: '', detail: '' });
          }

          let otherItems: FileQuickPickItem[] = [];
          let searchNoticeItem: QuickOpenItem | null = null;
          let loadMoreItem: ActionQuickPickItem | null = null;

          if (isSearching) {
            quickPick.busy = true;
            const searchResult = await buildSearchItems({
              normalizedSearch,
              searchCache,
              config,
              favoritesProvider,
              recentNormSet,
              recentFavNormSet,
              pinnedNormSet,
              searchPage,
              searchService,
              token,
            });
            otherItems = searchResult.items;
            searchNoticeItem = searchResult.noticeItem;
            loadMoreItem = searchResult.loadMoreItem;
          }


          const allFileItems = [
            ...lineFavoriteItems,
            ...combinedPinnedItems,
            ...combinedFavoriteItems,
            ...recentItems,
            ...otherItems,
          ] as Array<FileQuickPickItem | LineQuickPickItem>;

          log.debug(
            `[QuickOpen] Checking collisions for ${allFileItems.length} items...`,
          );
          await applyCollisionLabels(
            allFileItems,
            (item) => item.resourceUri,
            (item) => {
              item.setShowDescription(true);
            },
            (item) => {
              item.setShowDescription(false);
            },
            config.searchExclusions,
            token,
            logger,
          );
          if (!isSearchValueCurrent()) {
            log.debug(
              '[QuickOpen] Search value changed while building items, skipping update',
            );
            return;
          }

          if (otherItems.length > 0 || searchNoticeItem || loadMoreItem) {
            items.push({
              label: 'Archivos',
              kind: vscode.QuickPickItemKind.Separator,
            });
            if (searchNoticeItem) {
              items.push(searchNoticeItem);
            }
            if (loadMoreItem) {
              items.push(loadMoreItem);
            }
            items.push(...otherItems);
          }

          quickPick.items = items;

          if (isSearching) {
            if (currentActiveUri) {
              const itemToRestore = items.find(
                (i) => getQuickPickItemKey(i) === currentActiveKey,
              );
              if (itemToRestore) {
                quickPick.activeItems = [itemToRestore as any];
              } else {
                const firstFileItem = items.find((i) =>
                  isFileLikeItem(i),
                ) as FileQuickPickItem | LineQuickPickItem | undefined;
                quickPick.activeItems = firstFileItem ? [firstFileItem] : [];
              }
            } else {
              const firstFileItem = items.find((i) =>
                isFileLikeItem(i),
              ) as FileQuickPickItem | LineQuickPickItem | undefined;
              quickPick.activeItems = firstFileItem ? [firstFileItem] : [];
            }
          } else if (currentActiveKey) {
            const itemToSelect = items.find(
              (i) => getQuickPickItemKey(i) === currentActiveKey,
            );
            if (itemToSelect) {
              quickPick.activeItems = [itemToSelect as any];
            }
          } else {
            const fileItems = items.filter((i) => isFileLikeItem(i)) as Array<
              FileQuickPickItem | LineQuickPickItem
            >;
            if (fileItems.length > 0) {
              const hasPinned = pinnedItems.length > 0;
              const indexToSelect = hasPinned ? 0 : 1;

              const isAnGravityEnv =
                vscode.env.appName.includes('angravity') ||
                vscode.env.uriScheme.includes('angravity');
              const isCursor =
                vscode.env.appName.includes('cursor') ||
                vscode.env.uriScheme.includes('cursor');

              const forceIndexOne = isAnGravityEnv || isCursor;

              const finalIndex = forceIndexOne ? 1 : indexToSelect;

              quickPick.activeItems = [fileItems[finalIndex]];
            }
          }
        } catch (error) {
          if (isDisposed) return;
          log.error('Error loading files for QuickOpen', error);
          quickPick.items = [
            {
              label: 'Error cargando archivos (ver logs)',
              kind: vscode.QuickPickItemKind.Separator,
            },
          ];
        } finally {
          if (!isDisposed) {
            quickPick.busy = false;
          }
        }
      };

      log.info('[QuickOpen] Starting initial buildItems(false)...');
      await buildItems('');
      log.info('[QuickOpen] ✓ Initial buildItems complete');

      log.info('[QuickOpen] Showing QuickPick UI NOW (items ready)...');
      quickPick.show();
      log.info(
        '[QuickOpen] ✓ QuickPick visible and ready for user interaction',
      );

      let previousValue = '';
      const debouncedSearchRebuild = debounce(async (value: string) => {
        await buildItems(value);
      }, 150);
      const debouncedExternalRebuild = debounce(async (reason: string) => {
        logThrottledWithContext(
          'debug',
          'quickopen:external-rebuild',
          `External change (${reason}), rebuilding QuickOpen items`,
        );
        await buildItems(quickPick.value);
      }, 150);

      disposables.push(
        quickPick.onDidChangeValue(async (value) => {
          const wasEmpty = previousValue.length === 0;
          const isEmpty = value.length === 0;
          previousValue = value;

          if (wasEmpty !== isEmpty) {
            if (isEmpty) {
              await buildItems('');
            } else {
              debouncedSearchRebuild(value);
            }
            return;
          }

          if (!isEmpty) {
            debouncedSearchRebuild(value);
          }
        }),
      );

      disposables.push(
        favoritesProvider.onDidChangeTreeData(async () => {
          const isSearching = quickPick.value.trim().length > 0;
          if (isSearching) {
            logThrottledWithContext(
              'debug',
              'quickopen:favorites-changed',
              'Favorites changed while searching, skipping rebuild',
            );
            return;
          }
          logThrottledWithContext(
            'debug',
            'quickopen:favorites-changed',
            'Favorites changed, rebuilding QuickOpen items',
          );
          debouncedExternalRebuild('favorites');
        }),
      );

      disposables.push(
        mruService.onDidChangeRecentFiles(async () => {
          logThrottledWithContext(
            'debug',
            'quickopen:mru-changed',
            'MRU list changed, rebuilding QuickOpen items',
          );
          debouncedExternalRebuild('mru');
        }),
      );

      disposables.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
          if (
            e.affectsConfiguration('anfavorites.maxItems') ||
            e.affectsConfiguration('anfavorites.quickOpen') ||
            e.affectsConfiguration('anfavorites.search')
          ) {
            logThrottledWithContext(
              'debug',
              'quickopen:config-changed',
              'Configuration changed (quick open), rebuilding QuickOpen items',
            );

            searchCache.clear();
            await buildItems(quickPick.value);
          }
        }),
      );

      const debouncedRebuild = debounce(async () => {
        logThrottledWithContext(
          'debug',
          'quickopen:fs-changed',
          'File system changed (debounced), rebuilding QuickOpen items',
        );

        searchCache.clear();
        await buildItems(quickPick.value);
      }, 200);

      disposables.push(
        vscode.workspace.onDidRenameFiles((event) => {
          logThrottledWithContext(
            'debug',
            'quickopen:fs-renamed',
            `Files renamed: ${event.files.length} file(s)`,
          );
          debouncedRebuild();
        }),
      );

      disposables.push(
        vscode.workspace.onDidDeleteFiles((event) => {
          logThrottledWithContext(
            'debug',
            'quickopen:fs-deleted',
            `Files deleted: ${event.files.length} file(s)`,
          );
          debouncedRebuild();
        }),
      );

      disposables.push(
        vscode.workspace.onDidCreateFiles((event) => {
          logThrottledWithContext(
            'debug',
            'quickopen:fs-created',
            `Files created: ${event.files.length} file(s)`,
          );
          debouncedRebuild();
        }),
      );

      disposables.push(
        quickPick.onDidAccept(async () => {
          log.info('[QuickOpen] onDidAccept triggered');
          const selected = quickPick.selectedItems[0];
          if (!selected) {
            log.warn('[QuickOpen] No item selected');
            return;
          }
          log.info(
            `[QuickOpen] Selected item: ${(selected as any).label || '(no label)'}`,
          );

          const actionItem = selected as unknown as ActionQuickPickItem;
          if (actionItem.action === 'clearRecents') {
            log.info('[QuickOpen] Executing action: clearRecents');
            mruService.clear();
            log.info('[QuickOpen] Recent files list cleared from Quick Open');

            await buildItems('');
            return;
          }
          if (actionItem.action === 'loadMore') {
            log.info('[QuickOpen] Executing action: loadMore');
            searchPage += 1;
            await buildItems(quickPick.value);
            return;
          }


          if (isLineFavoriteItem(selected)) {
            log.info(
              `[QuickOpen] Opening line favorite: ${selected.resourceUri.fsPath}:${selected.line}`,
            );

            const openToSide = vscode.workspace
              .getConfiguration('anfavorites.quickOpen')
              .get<boolean>('openToSide', false);

            await openFileAtLine(
              selected.resourceUri,
              selected.line,
              openToSide ? vscode.ViewColumn.Beside : undefined,
            );
            mruService.add(selected.resourceUri.fsPath);
            quickPick.hide();
            return;
          }

          if (!isFileItem(selected)) {
            log.debug(
              '[QuickOpen] Selected item is not a file item (separator or action)',
            );
            return;
          }

          log.info(`[QuickOpen] Opening file: ${selected.resourceUri.fsPath}`);

          try {
            await vscode.workspace.fs.stat(selected.resourceUri);
            log.debug('[QuickOpen] File exists, proceeding to open');
          } catch (error) {
            log.warn(
              `[QuickOpen] ❌ File no longer exists: ${selected.resourceUri.fsPath}`,
            );
            vscode.window.showErrorMessage(
              `El archivo no existe: ${selected.resourceUri.fsPath}`,
            );

            log.info(
              '[QuickOpen] Cleaning up favorites and MRU after missing file detection',
            );
            await Promise.all([
              favoritesProvider.validateFavorites(),
              mruService.validateFiles(),
            ]);

            await buildItems(quickPick.value);
            return;
          }

          try {
            mruService.add(selected.resourceUri.fsPath);
            log.debug('[QuickOpen] File added to MRU');
          } catch (e) {
            log.warn('[QuickOpen] Failed to add MRU item', e);
          }

          log.info('[QuickOpen] Showing text document...');

          const openToSide = vscode.workspace
            .getConfiguration('anfavorites.quickOpen')
            .get<boolean>('openToSide', false);

          await vscode.window.showTextDocument(selected.resourceUri, {
            preview: false,
            viewColumn: openToSide ? vscode.ViewColumn.Beside : undefined,
          });
          log.info('[QuickOpen] ✓ File opened successfully, hiding QuickPick');
          quickPick.hide();
        }),
      );

      disposables.push(
        quickPick.onDidTriggerItemButton(async (e) => {
          log.debug('[QuickOpen] onDidTriggerItemButton triggered');
          const item = e.item;
          if (!isFileItem(item)) {
            if (isLineFavoriteItem(item)) {
              const button = e.button;
              if (button.tooltip === 'Eliminar de favoritos') {
                favoritesProvider.removeLineFavorite(
                  item.resourceUri,
                  item.line,
                );
                const currentItems = quickPick.items;
                const newItems = currentItems.filter((i) => i !== item);
                quickPick.items = newItems;
                quickPick.activeItems = newItems.filter((i) =>
                  isLineFavoriteItem(i),
                );
                return;
              }
              if (
                button.tooltip?.startsWith('Fijar') ||
                button.tooltip === 'Desfijar'
              ) {
                favoritesProvider.toggleLineFavoritePin(
                  item.resourceUri,
                  item.line,
                );
                item.isPinned = !item.isPinned;
                item.updateIcon(item.showIcons);
                const currentItems = quickPick.items;
                const index = currentItems.indexOf(item);
                if (index !== -1) {
                  const newItems = [...currentItems];
                  newItems[index] = item;
                  quickPick.items = newItems;
                  quickPick.activeItems = [item];
                }
              }
            } else {
              log.debug('[QuickOpen] Button triggered on non-file item');
            }
            return;
          }

          const button = e.button;
          const uri = item.resourceUri;

          if (button.tooltip === 'Abrir al lado') {
            log.info(`[QuickOpen] Opening to side: ${uri.fsPath}`);
            try {
              mruService.add(uri.fsPath);

              await vscode.window.showTextDocument(uri, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: false,
              });

              quickPick.hide();
            } catch (err) {
              log.error(`[QuickOpen] Error opening to side`, err);
            }
            return;
          }

          if (button.tooltip === 'Eliminar de recientes') {
            log.info(`[QuickOpen] Removing from recents: ${uri.fsPath}`);
            mruService.remove(uri.fsPath);

            return;
          }

          if (button.tooltip === 'Eliminar de favoritos') {
            log.info(`[QuickOpen] Removing from favorites: ${uri.fsPath}`);
            favoritesProvider.removeFavorite(uri);
            item.isFavorite = false;
            item.isPinned = false;
            item.isIndividualPinned = false;
            item.updateIcon(item.showIcons);
            const currentItems = quickPick.items;
            const index = currentItems.indexOf(item);
            if (index !== -1) {
              const newItems = [...currentItems];
              newItems[index] = item;
              quickPick.items = newItems;
              quickPick.activeItems = [item];
            }
            return;
          }

          if (
            button.tooltip?.startsWith('Fijar') ||
            button.tooltip === 'Desfijar'
          ) {
            log.info(`[QuickOpen] Toggling pin for: ${uri.fsPath}`);
            favoritesProvider.togglePin(uri);

            if (!favoritesProvider.hasFavorite(uri)) {
              favoritesProvider.addFavorite(uri);

              favoritesProvider.togglePin(uri);
            }

            item.isIndividualPinned = !item.isIndividualPinned;

            if (!item.isIndividualPinned) {
              item.isPinned = false;
            } else {
              item.isPinned = true;
            }

            item.isFavorite = true;
            item.updateIcon(item.showIcons);
            return;
          }

          log.info(`[QuickOpen] Toggling favorite for: ${uri.fsPath}`);

          try {
            if (item.isFavorite) {
              log.debug('[QuickOpen] Removing from favorites');
              favoritesProvider.removeFavorite(uri);
              item.isFavorite = false;
            } else {
              log.debug('[QuickOpen] Adding to favorites');
              favoritesProvider.addFavorite(uri);

              mruService.remove(uri.fsPath);
              item.isFavorite = true;
            }

            item.updateIcon(item.showIcons);
            log.debug('[QuickOpen] Favorite toggled successfully');

            const currentItems = quickPick.items;
            const index = currentItems.indexOf(item);
            if (index !== -1) {
              const newItems = [...currentItems];
              newItems[index] = item;
              quickPick.items = newItems;
              quickPick.activeItems = [item];
            }
          } catch (error) {
            log.error('[QuickOpen] ❌ Error toggling favorite', error);
          }
        }),
      );
    },
  );

  context.subscriptions.push(disposable);
  logger.info('[QuickOpen] ✓ Command registered successfully');
}
