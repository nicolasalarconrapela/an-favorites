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
import { t } from '../utils/l10n';
import {
  getMergedExclusions,
  buildExclusionGlobFromPatterns,
} from '../utils/gitignoreService';

type QuickOpenItem = vscode.QuickPickItem;

interface SearchCacheEntry {
  uris: vscode.Uri[];
  exceededMaxFiles: boolean;
  workspaceSearchDeferred: boolean;
  mutationVersion: number;
  exclusionSignature: string;
}

interface PersistedSearchCacheEntry {
  uris: string[];
  exceededMaxFiles: boolean;
  workspaceSearchDeferred: boolean;
  exclusionSignature: string;
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

  entries(): Array<[K, V]> {
    return Array.from(this.map.entries()).reverse();
  }

  load(entries: Array<[K, V]>): void {
    this.map.clear();
    for (const [key, value] of entries.slice(0, this.maxEntries).reverse()) {
      this.map.set(key, value);
    }
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

const MIN_WORKSPACE_SEARCH_QUERY_LENGTH = 3;
const HYBRID_PREFIX_STAGE_LIMIT = 1200;
const HYBRID_FALLBACK_STAGE_LIMIT = 400;
const MAX_QUICKOPEN_EXCLUSION_GLOB_LENGTH = 12000;
const MAX_INCREMENTAL_SEARCH_CHANGES = 100;
const QUICKOPEN_SEARCH_CACHE_STATE_KEY = 'anfavorites.quickOpen.searchCache';
const PERSISTED_SEARCH_CACHE_ENTRIES = 25;
const PERSISTED_SEARCH_CACHE_URIS_PER_QUERY = 600;
const MAX_PREFIX_SEED_QUERIES = 3;
const MAX_PREFIX_SEED_URIS = 1200;

function dedupeUrisByFsPath(uris: vscode.Uri[]): vscode.Uri[] {
  const seen = new Set<string>();
  const unique: vscode.Uri[] = [];

  for (const uri of uris) {
    const key = normalizeFsPath(uri.fsPath);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(uri);
  }

  return unique;
}

function matchesSearchText(uri: vscode.Uri, searchValue: string): boolean {
  const normalizedSearch = searchValue.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  const basename = safeBasenameFromUri(uri).toLowerCase();
  if (basename.includes(normalizedSearch)) {
    return true;
  }

  const relative = vscode.workspace
    .asRelativePath(uri, false)
    .replace(/\\/g, '/')
    .toLowerCase();
  return relative.includes(normalizedSearch);
}

function rankSearchBasename(uri: vscode.Uri, searchValue: string): number {
  const normalizedSearch = searchValue.trim().toLowerCase();
  const basename = safeBasenameFromUri(uri).toLowerCase();

  if (!normalizedSearch) {
    return 4;
  }

  if (basename === normalizedSearch) {
    return 0;
  }

  if (basename.startsWith(`${normalizedSearch}.`)) {
    return 1;
  }

  if (basename.startsWith(`${normalizedSearch}_`)) {
    return 2;
  }

  if (basename.startsWith(normalizedSearch)) {
    return 3;
  }

  if (basename.includes(normalizedSearch)) {
    return 4;
  }

  return 5;
}

function compareSearchUris(
  left: vscode.Uri,
  right: vscode.Uri,
  searchValue: string,
): number {
  const leftRank = rankSearchBasename(left, searchValue);
  const rightRank = rankSearchBasename(right, searchValue);
  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  const leftName = safeBasenameFromUri(left);
  const rightName = safeBasenameFromUri(right);
  const byName = leftName.localeCompare(rightName, undefined, {
    sensitivity: 'base',
  });
  if (byName !== 0) {
    return byName;
  }

  return left.fsPath.localeCompare(right.fsPath, undefined, {
    sensitivity: 'base',
  });
}

function prioritizeDistinctBasenames(
  uris: vscode.Uri[],
  searchValue: string,
): vscode.Uri[] {
  const sorted = [...uris].sort((left, right) =>
    compareSearchUris(left, right, searchValue),
  );
  const firstByBasename = new Map<string, vscode.Uri>();
  const repeated: vscode.Uri[] = [];

  for (const uri of sorted) {
    const basenameKey = safeBasenameFromUri(uri).toLowerCase();
    if (!firstByBasename.has(basenameKey)) {
      firstByBasename.set(basenameKey, uri);
      continue;
    }
    repeated.push(uri);
  }

  return [...firstByBasename.values(), ...repeated];
}

function getSafeQuickOpenExclusionGlob(
  patterns: string[],
  logger?: Logger,
): string | undefined {
  const glob = buildExclusionGlobFromPatterns(patterns);
  if (!glob) {
    return undefined;
  }

  if (glob.length <= MAX_QUICKOPEN_EXCLUSION_GLOB_LENGTH) {
    return glob;
  }

  logger?.warn?.(
    `[QuickOpen] Exclusion glob too large (${glob.length}). Falling back to base search exclusions only.`,
  );
  return undefined;
}

function buildSearchExclusionSignature(exclusionGlob: string | undefined): string {
  return exclusionGlob ?? '';
}

function serializeSearchCacheEntry(
  entry: SearchCacheEntry,
): PersistedSearchCacheEntry {
  return {
    uris: entry.uris
      .slice(0, PERSISTED_SEARCH_CACHE_URIS_PER_QUERY)
      .map((uri) => uri.fsPath),
    exceededMaxFiles: entry.exceededMaxFiles,
    workspaceSearchDeferred: entry.workspaceSearchDeferred,
    exclusionSignature: entry.exclusionSignature,
  };
}

function deserializeSearchCacheEntries(
  raw: unknown,
): Array<[string, SearchCacheEntry]> {
  if (!Array.isArray(raw)) {
    return [];
  }

  const restored: Array<[string, SearchCacheEntry]> = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 2 || typeof item[0] !== 'string') {
      continue;
    }
    const value = item[1] as Partial<PersistedSearchCacheEntry>;
    if (!value || !Array.isArray(value.uris)) {
      continue;
    }
    restored.push([
      item[0],
      {
        uris: value.uris.map((fsPath) => vscode.Uri.file(fsPath)),
        exceededMaxFiles: value.exceededMaxFiles === true,
        workspaceSearchDeferred: value.workspaceSearchDeferred === true,
        mutationVersion: 0,
        exclusionSignature:
          typeof value.exclusionSignature === 'string'
            ? value.exclusionSignature
            : '',
      },
    ]);
  }

  return restored;
}

function getSearchPrefixSeeds(
  normalizedSearch: string,
  searchCache: LruCache<string, SearchCacheEntry>,
  exclusionSignature: string,
  mutationVersion: number,
): vscode.Uri[] {
  const seedQueries = searchCache
    .entries()
    .filter(([query, entry]) => {
      return (
        query.length < normalizedSearch.length &&
        normalizedSearch.startsWith(query) &&
        entry.exclusionSignature === exclusionSignature &&
        entry.mutationVersion === mutationVersion
      );
    })
    .sort((left, right) => right[0].length - left[0].length)
    .slice(0, MAX_PREFIX_SEED_QUERIES);

  return dedupeUrisByFsPath(
    seedQueries.flatMap(([_, entry]) => entry.uris),
  ).slice(0, MAX_PREFIX_SEED_URIS);
}

async function applyIncrementalSearchUpdates(params: {
  cacheEntry: SearchCacheEntry;
  normalizedSearch: string;
  changedPaths: string[];
  maxSearchFiles: number;
}): Promise<SearchCacheEntry> {
  const { cacheEntry, normalizedSearch, changedPaths, maxSearchFiles } = params;
  const changedPathSet = new Set(changedPaths.map((value) => normalizeFsPath(value)));
  let nextUris = cacheEntry.uris.filter(
    (uri) => !changedPathSet.has(normalizeFsPath(uri.fsPath)),
  );

  for (const changedPath of changedPaths) {
    try {
      const uri = vscode.Uri.file(changedPath);
      await vscode.workspace.fs.stat(uri);
      if (
        vscode.workspace.getWorkspaceFolder(uri) &&
        matchesSearchText(uri, normalizedSearch)
      ) {
        nextUris.push(uri);
      }
    } catch {
      // File no longer exists or is inaccessible; removing it from the cached set is enough.
    }
  }

  nextUris = prioritizeDistinctBasenames(
    dedupeUrisByFsPath(nextUris),
    normalizedSearch,
  ).slice(0, maxSearchFiles);

  return {
    ...cacheEntry,
    uris: nextUris,
    exceededMaxFiles: cacheEntry.exceededMaxFiles || nextUris.length >= maxSearchFiles,
  };
}

async function runHybridWorkspaceSearch(params: {
  normalizedSearch: string;
  localCandidateUris: vscode.Uri[];
  seedUris?: vscode.Uri[];
  exclusionGlob: string | undefined;
  maxSearchFiles: number;
  searchService: QuickOpenSearchService;
  token: vscode.CancellationToken;
}): Promise<SearchCacheEntry> {
  const {
    normalizedSearch,
    localCandidateUris,
    seedUris = [],
    exclusionGlob,
    maxSearchFiles,
    searchService,
    token,
  } = params;

  const localMatches = dedupeUrisByFsPath(
    localCandidateUris.filter((uri) => matchesSearchText(uri, normalizedSearch)),
  );
  const seededMatches = dedupeUrisByFsPath(
    seedUris.filter((uri) => matchesSearchText(uri, normalizedSearch)),
  );

  if (normalizedSearch.length < MIN_WORKSPACE_SEARCH_QUERY_LENGTH) {
    return {
      uris: dedupeUrisByFsPath([...localMatches, ...seededMatches]).slice(
        0,
        maxSearchFiles,
      ),
      exceededMaxFiles:
        localMatches.length + seededMatches.length > maxSearchFiles,
      workspaceSearchDeferred: true,
      mutationVersion: 0,
      exclusionSignature: '',
    };
  }

  const stagePatterns = [
    `**/${normalizedSearch}*`,
    buildSearchPattern(normalizedSearch),
  ];
  const stageLimits = [
    Math.min(maxSearchFiles, HYBRID_PREFIX_STAGE_LIMIT),
    Math.min(maxSearchFiles, HYBRID_FALLBACK_STAGE_LIMIT),
  ];

  let mergedUris = prioritizeDistinctBasenames(
    dedupeUrisByFsPath([...localMatches, ...seededMatches]),
    normalizedSearch,
  );
  let exceededMaxFiles = mergedUris.length > maxSearchFiles;

  for (let i = 0; i < stagePatterns.length; i += 1) {
    if (token.isCancellationRequested || mergedUris.length >= maxSearchFiles) {
      break;
    }

    const remaining = Math.max(1, maxSearchFiles - mergedUris.length);
    const stageLimit = Math.min(stageLimits[i], remaining) + 1;
    const foundUris = await searchService.findFiles(
      stagePatterns[i],
      exclusionGlob,
      stageLimit,
      token,
    );

    if (foundUris.length >= stageLimit) {
      exceededMaxFiles = true;
    }

    mergedUris = prioritizeDistinctBasenames(
      dedupeUrisByFsPath([...mergedUris, ...foundUris]),
      normalizedSearch,
    );
  }

  return {
    uris: mergedUris.slice(0, maxSearchFiles),
    exceededMaxFiles,
    workspaceSearchDeferred: false,
    mutationVersion: 0,
    exclusionSignature: '',
  };
}

function isFileItem(item: vscode.QuickPickItem): item is FileQuickPickItem {
  return typeof (item as any)?.internalUri?.fsPath === 'string';
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

async function openUriInEditor(
  uri: vscode.Uri,
  options?: {
    viewColumn?: vscode.ViewColumn;
  },
): Promise<void> {
  await vscode.commands.executeCommand('vscode.open', uri, {
    preview: false,
    preserveFocus: false,
    viewColumn: options?.viewColumn,
  });
}

async function openUriInNewWindow(uri: vscode.Uri): Promise<void> {
  await openUriInEditor(uri);
  await vscode.commands.executeCommand(
    'workbench.action.moveEditorToNewWindow',
  );
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
      openInNewWindow: config.openInNewWindow,
      showOpenToSideButton: config.showOpenToSideButton,
      showOpenInNewWindowButton: config.showOpenInNewWindowButton,
      isIndividualPinned: isIndividual,
      pathDetailLocation: config.pathDetailLocation,
      showPathWhen: config.showPathWhen,
    });
  }).sort(compareQuickPickFileItemsAlphabetically);
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
      openInNewWindow: config.openInNewWindow,
      showOpenToSideButton: config.showOpenToSideButton,
      showOpenInNewWindowButton: config.showOpenInNewWindowButton,
      pathDetailLocation: config.pathDetailLocation,
      showPathWhen: config.showPathWhen,
    });
  }).sort(compareQuickPickFileItemsAlphabetically);
}

function compareQuickPickFileItemsAlphabetically(
  left: FileQuickPickItem,
  right: FileQuickPickItem,
): number {
  const byName = safeBasenameFromUri(left.internalUri).localeCompare(
    safeBasenameFromUri(right.internalUri),
    undefined,
    { sensitivity: 'base' },
  );

  if (byName !== 0) {
    return byName;
  }

  return left.internalUri.fsPath.localeCompare(
    right.internalUri.fsPath,
    undefined,
    { sensitivity: 'base' },
  );
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
      openInNewWindow: config.openInNewWindow,
      showOpenToSideButton: config.showOpenToSideButton,
      showOpenInNewWindowButton: config.showOpenInNewWindowButton,
      pathDetailLocation: config.pathDetailLocation,
      showPathWhen: config.showPathWhen,
    });
  });
}

async function buildSearchItems(params: {
  normalizedSearch: string;
  localCandidateUris: vscode.Uri[];
  searchCache: LruCache<string, SearchCacheEntry>;
  persistSearchCache: () => void;
  currentSearchMutationVersion: number;
  pendingSearchChangedPaths: Set<string>;
  config: QuickOpenConfig;
  favoritesProvider: FavoritesTreeDataProvider;
  logger?: Logger;
  recentNormSet: Set<string>;
  favoriteMatchNormSet: Set<string>;
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
    localCandidateUris,
    searchCache,
    persistSearchCache,
    currentSearchMutationVersion,
    pendingSearchChangedPaths,
    config,
    favoritesProvider,
    logger,
    recentNormSet,
    favoriteMatchNormSet,
    searchPage,
    searchService,
    token,
  } = params;
  const cacheKey = normalizedSearch;
  let cacheEntry = searchCache.get(cacheKey);
  let noticeItem: QuickOpenItem | null = null;
  let loadMoreItem: ActionQuickPickItem | null = null;

  const mergedExclusions = await getMergedExclusions(
    config.searchExclusions,
    token,
  );
  let exclusionGlob = getSafeQuickOpenExclusionGlob(mergedExclusions);
  if (!exclusionGlob && config.searchExclusions.length > 0) {
    exclusionGlob = getSafeQuickOpenExclusionGlob(
      config.searchExclusions,
      logger,
    );
  }
  const exclusionSignature = buildSearchExclusionSignature(exclusionGlob);

  if (
    cacheEntry &&
    cacheEntry.exclusionSignature === exclusionSignature &&
    cacheEntry.mutationVersion !== currentSearchMutationVersion &&
    pendingSearchChangedPaths.size > 0 &&
    pendingSearchChangedPaths.size <= MAX_INCREMENTAL_SEARCH_CHANGES
  ) {
    cacheEntry = await applyIncrementalSearchUpdates({
      cacheEntry,
      normalizedSearch: cacheKey,
      changedPaths: Array.from(pendingSearchChangedPaths),
      maxSearchFiles: config.maxSearchFiles,
    });
    cacheEntry.mutationVersion = currentSearchMutationVersion;
    searchCache.set(cacheKey, cacheEntry);
    persistSearchCache();
  }

  if (
    !cacheEntry ||
    cacheEntry.exclusionSignature !== exclusionSignature ||
    cacheEntry.mutationVersion !== currentSearchMutationVersion
  ) {
    const prefixSeedUris = getSearchPrefixSeeds(
      cacheKey,
      searchCache,
      exclusionSignature,
      currentSearchMutationVersion,
    );
    cacheEntry = await runHybridWorkspaceSearch({
      normalizedSearch: cacheKey,
      localCandidateUris,
      seedUris: prefixSeedUris,
      exclusionGlob,
      maxSearchFiles: config.maxSearchFiles,
      searchService,
      token,
    });
    cacheEntry.mutationVersion = currentSearchMutationVersion;
    cacheEntry.exclusionSignature = exclusionSignature;
    searchCache.set(cacheKey, cacheEntry);
    persistSearchCache();
  }

  if (cacheEntry.workspaceSearchDeferred) {
    noticeItem = {
      label: t(
        'Showing local matches first. Type {0}+ characters to search the workspace.',
        MIN_WORKSPACE_SEARCH_QUERY_LENGTH,
      ),
      detail: '',
    };
  } else if (cacheEntry.exceededMaxFiles) {
    noticeItem = {
      label: t(
        'Reached the maximum of {0} files. Refine your search.',
        config.maxSearchFiles,
      ),
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
        openInNewWindow: config.openInNewWindow,
        showOpenToSideButton: config.showOpenToSideButton,
        showOpenInNewWindowButton: config.showOpenInNewWindowButton,
        pathDetailLocation: config.pathDetailLocation,
        showPathWhen: config.showPathWhen,
      });
    })
    .filter((item) => {
      const normalizedPath = normalizeFsPath(item.internalUri.fsPath);
      return !favoriteMatchNormSet.has(normalizedPath);
    })
    .slice(0, displayLimit)
      .map((item) => {
        const isFav = favoritesProvider.hasFavorite(item.internalUri);
        if (item.isFavorite !== isFav) {
          item.isFavorite = isFav;
          item.updateIcon();
        }
        return item;
      });

  if (cacheEntry.uris.length > displayLimit) {
    loadMoreItem = {
      label: t('Load more'),
      description: t(
        'Showing {0} of {1}',
        displayLimit,
        cacheEntry.uris.length,
      ),
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

  internalUri: vscode.Uri;
  isFavorite: boolean;
  isPinned: boolean;
  isRecentlyOpened: boolean;
  isIndividualPinned: boolean;

  private _fullPathLabel: string = '';
  private _dirPathLabel: string = '';

  private _detailPathText?: string;

  private _openToSide: boolean;
  private _openInNewWindow: boolean;
  private _showOpenToSideButton: boolean;
  private _showOpenInNewWindowButton: boolean;
  private pathDetailLocation: 'description' | 'detail';
  private showPathWhen: 'always' | 'onConflict';

  constructor(params: {
    uri: vscode.Uri;
    isFavorite: boolean;
    isPinned?: boolean;
    isRecentlyOpened?: boolean;
    openToSide?: boolean;
    openInNewWindow?: boolean;
    showOpenToSideButton?: boolean;
    showOpenInNewWindowButton?: boolean;
    isIndividualPinned?: boolean;
    pathDetailLocation?: 'description' | 'detail';
    showPathWhen?: 'always' | 'onConflict';
  }) {
    const {
      uri,
      isFavorite,
      isPinned = false,
      isRecentlyOpened = false,
      openToSide = false,
      openInNewWindow = false,
      showOpenToSideButton = true,
      showOpenInNewWindowButton = true,
      isIndividualPinned = false,
      pathDetailLocation = 'detail',
      showPathWhen = 'onConflict',
    } = params;

    this.internalUri = uri;
    this.isFavorite = isFavorite;
    this.isPinned = isPinned;
    this.isRecentlyOpened = isRecentlyOpened;
    this._openToSide = openToSide;
    this._openInNewWindow = openInNewWindow;
    this._showOpenToSideButton = showOpenToSideButton;
    this._showOpenInNewWindowButton = showOpenInNewWindowButton;
    this.isIndividualPinned = isIndividualPinned;
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

    this.updateIcon();

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

  updateIcon(): void {
    this.iconPath = undefined;

    const baseName = safeBasenameFromUri(this.internalUri);
    let iconPrefix = this.isFavorite ? '$(star-full) ' : '     ';
    if (this.isPinned) iconPrefix = '$(pin) ';
    this.label = `${iconPrefix} ${baseName}`;

    const buttons: vscode.QuickInputButton[] = [];

    const isPinnedState = this.isIndividualPinned;
    const pinTooltip = isPinnedState ? t('Unpin') : t('Pin');

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
      tooltip: this.isFavorite
        ? t('Remove from Favorites')
        : t('Add to Favorites'),
    });

    if (!this._openToSide && this._showOpenToSideButton) {
      buttons.push({
        iconPath: createButtonIcon('split-horizontal', 'symbol-file'),
        tooltip: t('Open to the Side'),
      });
    }

    if (!this._openInNewWindow && this._showOpenInNewWindowButton) {
      buttons.push({
        iconPath: createButtonIcon('link-external', 'symbol-file'),
        tooltip: t('Open in New Window'),
      });
    }

    if (this._openToSide || this._openInNewWindow) {
      buttons.push({
        iconPath: createButtonIcon('go-to-file', 'symbol-file'),
        tooltip: t('Open in Active Editor'),
      });
    }

    if (this.isRecentlyOpened) {
      buttons.push({
        iconPath: createButtonIcon('close', 'x'),
        tooltip: t('Remove from Recent'),
      });
    }

    this.buttons = buttons;
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
      log.debug('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log.debug('🔍 [QuickOpen] COMMAND STARTED - ALT+SHIFT+F');
      log.debug('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      log.debug(
        `[QuickOpen] Environment: ${vscode.env.appName} (${vscode.version})`,
      );
      log.debug(`[QuickOpen] URI Scheme: ${vscode.env.uriScheme}`);
      log.debug(`[QuickOpen] Platform: ${process.platform}`);
      log.debug(`[QuickOpen] Language: ${vscode.env.language}`);

      const quickPick = vscode.window.createQuickPick<QuickOpenItem>();
      log.debug('[QuickOpen] QuickPick instance created');

      quickPick.placeholder = t('Search files by name');
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
        log.debug('[QuickOpen] Disposing QuickPick and listeners...');
        try {
          disposables.forEach((d) => d.dispose());
          log.debug(`[QuickOpen] Disposed ${disposables.length} listeners`);
        } finally {
          quickPick.dispose();
          log.debug('[QuickOpen] QuickPick disposed');
        }
      };

      disposables.push(
        quickPick.onDidHide(() => {
          log.debug('[QuickOpen] onDidHide triggered');
          safeDispose();
        }),
      );
      log.debug('[QuickOpen] onDidHide listener registered');

      const searchCache = new LruCache<string, SearchCacheEntry>(30);
      searchCache.load(
        deserializeSearchCacheEntries(
          context.workspaceState.get(QUICKOPEN_SEARCH_CACHE_STATE_KEY, []),
        ),
      );
      let buildTokenSource: vscode.CancellationTokenSource | null = null;
      let searchPage = 1;
      let previousSearchValue = '';
      let currentSearchMutationVersion = 0;
      const pendingSearchChangedPaths = new Set<string>();
      const persistSearchCache = (): void => {
        const payload = searchCache
          .entries()
          .slice(0, PERSISTED_SEARCH_CACHE_ENTRIES)
          .map(([key, value]) => [key, serializeSearchCacheEntry(value)]);
        void context.workspaceState.update(
          QUICKOPEN_SEARCH_CACHE_STATE_KEY,
          payload,
        );
      };
      const markSearchPathsDirty = (paths: string[]): void => {
        currentSearchMutationVersion += 1;
        for (const fsPath of paths) {
          pendingSearchChangedPaths.add(fsPath);
        }
      };

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

        const currentActiveUri =
          quickPick.activeItems.length > 0 &&
          isFileItem(quickPick.activeItems[0])
            ? (
                quickPick.activeItems[0] as FileQuickPickItem
              ).internalUri.toString()
            : null;

        try {
          const isSearchValueCurrent = () =>
            normalizedSearch === quickPick.value.trim();

          log.debug(
            `[QuickOpen] Current search value: "${normalizedSearch}" (isSearching: ${isSearching})`,
          );

          log.debug('[QuickOpen] Reloading favorites from storage...');
          favoritesProvider.reloadFavorites();
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
            `[QuickOpen] Config: maxRecentFav=${config.maxRecentFavorites}, maxPinned=${config.maxPinned}, maxRecentFiles=${config.maxRecentFiles}, exclusions=${config.searchExclusions.length}`,
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

          const allFavoriteUris = favoritesProvider
            .getFavoritePaths()
            .map((favoritePath) => vscode.Uri.file(favoritePath))
            .filter((uri) => {
              return (
                uri.scheme === 'file' && !!vscode.workspace.getWorkspaceFolder(uri)
              );
            });

          const matchingFavoriteUris = isSearching
            ? dedupeUrisByFsPath(
                allFavoriteUris.filter((uri) =>
                  matchesSearchText(uri, normalizedSearch),
                ),
              )
            : [];

          const pinnedFavUris = isSearching
            ? matchingFavoriteUris.filter((uri) => favoritesProvider.isPinned(uri))
            : favoritesProvider.getPinnedFavorites().slice(0, config.maxPinned);

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

          const recentFavUris = isSearching
            ? matchingFavoriteUris.filter((uri) => {
                const norm = normalizeFsPath(uri.fsPath);
                return !pinnedNormSet.has(norm);
              })
            : favoritesProvider
                .getRecentFavorites(20)
                .filter((uri) => {
                  return (
                    uri.scheme === 'file' &&
                    !!vscode.workspace.getWorkspaceFolder(uri)
                  );
                })
                .filter((uri, index, list) => {
                  const norm = normalizeFsPath(uri.fsPath);
                  return (
                    !pinnedNormSet.has(norm) &&
                    list.findIndex(
                      (candidate) =>
                        normalizeFsPath(candidate.fsPath) === norm,
                    ) === index
                  );
                })
                .slice(0, config.maxRecentFavorites);
          const recentFavNormSet = new Set(
            recentFavUris.map((u) => normalizeFsPath(u.fsPath)),
          );

          const allUrisToDisplay = dedupeUrisByFsPath([
            ...allPinnedUris,
            ...recentFavUris,
            ...recentUris,
          ]);
          const urisToValidate = isSearching
            ? dedupeUrisByFsPath([...allPinnedUris, ...recentFavUris])
            : allUrisToDisplay;
          const existenceMap = await validateFilesExistence(urisToValidate, token);
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
          const favoriteMatchNormSet = new Set(
            [...validPinnedUris, ...validRecentFavUris].map((uri) =>
              normalizeFsPath(uri.fsPath),
            ),
          );

          const validRecentUris = recentUris.filter((uri) => {
            if (isSearching) {
              const norm = normalizeFsPath(uri.fsPath);
              return !pinnedNormSet.has(norm) && !recentFavNormSet.has(norm);
            }
            const exists = existenceMap.get(uri.fsPath) ?? false;
            if (!exists) {
              mruService.remove(uri.fsPath);
            }
            if (!exists) return false;
            // Exclude items already shown in Pinned or Favorites sections
            const norm = normalizeFsPath(uri.fsPath);
            return !pinnedNormSet.has(norm) && !recentFavNormSet.has(norm);
          });

          const pinnedItems = buildPinnedItems(
            validPinnedUris,
            favoritesProvider,
            config,
          );
          const recentFavItems = buildRecentFavoriteItems(
            validRecentFavUris,
            favoritesProvider,
            config,
          );
          const recentItems = buildRecentItems(
            validRecentUris.slice(0, config.maxRecentFiles),
            favoritesProvider,
            config,
          );

          const items: QuickOpenItem[] = [];
          const favoriteSectionItems: QuickOpenItem[] = [];

          if (pinnedItems.length > 0) {
            favoriteSectionItems.push(...pinnedItems);
          }

          const hasFavoriteItems = recentFavItems.length > 0;
          favoriteSectionItems.push({
            label: hasFavoriteItems ? t('Favorites') : t('No favorites yet'),
            kind: vscode.QuickPickItemKind.Separator,
          });
          favoriteSectionItems.push({ label: ' ', alwaysShow: false });

          if (hasFavoriteItems) {
            favoriteSectionItems.push(...recentFavItems);
          } else if (!isSearching) {
            favoriteSectionItems.push({
              label: t(
                'Search for a file and add it to favorites using the icon on the right',
              ),
              description: '',
              detail: '',
            });
          }

          items.push(...favoriteSectionItems);

          const hasRecentFiles = recentItems.length > 0;

          if (!isSearching) {
            items.push({
              label: hasRecentFiles ? t('Recent') : t('No new recent files'),
              kind: vscode.QuickPickItemKind.Separator,
            });

            if (hasRecentFiles) {
              const clearRecentsItem: ActionQuickPickItem = {
                label: `$(trash) ${t('Clear all')}`,
                action: 'clearRecents',
              };

              items.push(clearRecentsItem);
              items.push(...recentItems);
            } else {
              items.push({
                label: '',
                description: '',
                detail: '',
              });
            }
          }

          let otherItems: FileQuickPickItem[] = [];
          let searchNoticeItem: QuickOpenItem | null = null;
          let loadMoreItem: ActionQuickPickItem | null = null;

          if (isSearching) {
            quickPick.busy = true;
            const loadingItems: QuickOpenItem[] = [...favoriteSectionItems];
            loadingItems.push({
              label: `$(loading~spin) ${t('Searching...')}`,
              description: '',
              detail: '',
            });
            quickPick.items = loadingItems;
            const searchResult = await buildSearchItems({
              normalizedSearch,
              localCandidateUris: allUrisToDisplay,
              searchCache,
              persistSearchCache,
              currentSearchMutationVersion,
              pendingSearchChangedPaths,
              config,
              favoritesProvider,
              logger: log,
              recentNormSet,
              favoriteMatchNormSet,
              searchPage,
              searchService,
              token,
            });
            otherItems = searchResult.items;
            searchNoticeItem = searchResult.noticeItem;
            loadMoreItem = searchResult.loadMoreItem;
            pendingSearchChangedPaths.clear();
          }

          const allFileItems = [
            ...pinnedItems,
            ...recentFavItems,
            ...(isSearching ? [] : recentItems),
            ...otherItems,
          ];

          log.debug(
            `[QuickOpen] Checking collisions for ${allFileItems.length} items...`,
          );
          await applyCollisionLabels(
            allFileItems,
            (item) => item.internalUri,
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
              label: t('Files'),
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
                (i) =>
                  isFileItem(i) &&
                  i.internalUri.toString() === currentActiveUri,
              );
              if (itemToRestore) {
                quickPick.activeItems = [itemToRestore as FileQuickPickItem];
              } else {
                const firstFileItem = items.find((i) => isFileItem(i)) as
                  | FileQuickPickItem
                  | undefined;
                quickPick.activeItems = firstFileItem ? [firstFileItem] : [];
              }
            } else {
              const firstFileItem = items.find((i) => isFileItem(i)) as
                | FileQuickPickItem
                | undefined;
              quickPick.activeItems = firstFileItem ? [firstFileItem] : [];
            }
          } else if (currentActiveUri) {
            const itemToSelect = items.find(
              (i) =>
                isFileItem(i) && i.internalUri.toString() === currentActiveUri,
            );
            if (itemToSelect) {
              quickPick.activeItems = [itemToSelect as FileQuickPickItem];
            }
          } else {
            const fileItems = items.filter((i) =>
              isFileItem(i),
            ) as FileQuickPickItem[];
            if (fileItems.length > 0) {
              const isAnGravityEnv =
                vscode.env.appName.includes('angravity') ||
                vscode.env.uriScheme.includes('angravity');
              const isCursor =
                vscode.env.appName.includes('cursor') ||
                vscode.env.uriScheme.includes('cursor');

              const forceIndexOneFallback = isAnGravityEnv || isCursor;
              const fallbackItem = forceIndexOneFallback
                ? fileItems[1] ?? fileItems[0]
                : fileItems[0];
              const initialItem =
                pinnedItems[0] ??
                recentFavItems[0] ??
                recentItems[0] ??
                fallbackItem;

              if (initialItem) {
                quickPick.activeItems = [initialItem];
              }
            }
          }
        } catch (error) {
          if (isDisposed) return;
          log.error('Error loading files for QuickOpen', error);
          quickPick.items = [
            {
              label: t('Error loading files (see logs)'),
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
            persistSearchCache();
            currentSearchMutationVersion += 1;
            pendingSearchChangedPaths.clear();
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

        await buildItems(quickPick.value);
      }, 200);

      disposables.push(
        vscode.workspace.onDidRenameFiles((event) => {
          markSearchPathsDirty(
            event.files.flatMap((file) => [file.oldUri.fsPath, file.newUri.fsPath]),
          );
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
          markSearchPathsDirty(event.files.map((file) => file.fsPath));
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
          markSearchPathsDirty(event.files.map((file) => file.fsPath));
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

          if (!isFileItem(selected)) {
            log.debug(
              '[QuickOpen] Selected item is not a file item (separator or action)',
            );
            return;
          }

          log.info(`[QuickOpen] Opening file: ${selected.internalUri.fsPath}`);

          try {
            await vscode.workspace.fs.stat(selected.internalUri);
            log.debug('[QuickOpen] File exists, proceeding to open');
          } catch (error) {
            log.warn(
              `[QuickOpen] ❌ File no longer exists: ${selected.internalUri.fsPath}`,
            );
            vscode.window.showErrorMessage(
              t('File does not exist: {0}', selected.internalUri.fsPath),
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
            mruService.add(selected.internalUri.fsPath);
            log.debug('[QuickOpen] File added to MRU');
          } catch (e) {
            log.warn('[QuickOpen] Failed to add MRU item', e);
          }

          log.info('[QuickOpen] Opening resource...');

          const openToSide = vscode.workspace
            .getConfiguration('anfavorites.quickOpen')
            .get<boolean>('actions.openToSide', false);
          const openInNewWindow = vscode.workspace
            .getConfiguration('anfavorites.quickOpen')
            .get<boolean>('actions.openInNewWindow', false);

          if (openInNewWindow) {
            log.info(
              `[QuickOpen] Opening in new window: ${selected.internalUri.fsPath}`,
            );
            await openUriInNewWindow(selected.internalUri);
          } else {
            await openUriInEditor(selected.internalUri, {
              viewColumn: openToSide ? vscode.ViewColumn.Beside : undefined,
            });
          }
          log.info('[QuickOpen] ✓ File opened successfully, hiding QuickPick');
          quickPick.hide();
        }),
      );

      disposables.push(
        quickPick.onDidTriggerItemButton(async (e) => {
          log.debug('[QuickOpen] onDidTriggerItemButton triggered');
          const item = e.item;
          if (!isFileItem(item)) {
            log.debug('[QuickOpen] Button triggered on non-file item');
            return;
          }

          const button = e.button;
          const uri = item.internalUri;

          if (button.tooltip === t('Open to the Side')) {
            log.info(`[QuickOpen] Opening to side: ${uri.fsPath}`);
            try {
              mruService.add(uri.fsPath);
              await openUriInEditor(uri, {
                viewColumn: vscode.ViewColumn.Beside,
              });

              quickPick.hide();
            } catch (err) {
              log.error(`[QuickOpen] Error opening to side`, err);
            }
            return;
          }

          if (button.tooltip === t('Open in New Window')) {
            log.info(`[QuickOpen] Opening in new window: ${uri.fsPath}`);
            try {
              mruService.add(uri.fsPath);
              await openUriInNewWindow(uri);

              quickPick.hide();
            } catch (err) {
              log.error(`[QuickOpen] Error opening in new window`, err);
            }
            return;
          }

          if (button.tooltip === t('Open in Active Editor')) {
            log.info(`[QuickOpen] Opening in active editor: ${uri.fsPath}`);
            try {
              mruService.add(uri.fsPath);
              await openUriInEditor(uri);

              quickPick.hide();
            } catch (err) {
              log.error(`[QuickOpen] Error opening in active editor`, err);
            }
            return;
          }

          if (button.tooltip === t('Remove from Recent')) {
            log.info(`[QuickOpen] Removing from recents: ${uri.fsPath}`);
            mruService.remove(uri.fsPath);

            return;
          }

          if (button.tooltip === t('Remove from Favorites')) {
            log.info(`[QuickOpen] Removing from favorites: ${uri.fsPath}`);
            favoritesProvider.removeFavorite(uri);
            item.isFavorite = false;
            item.isPinned = false;
            item.isIndividualPinned = false;
            item.updateIcon();
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

          if (button.tooltip === t('Pin') || button.tooltip === t('Unpin')) {
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
            item.updateIcon();

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

            item.updateIcon();
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
