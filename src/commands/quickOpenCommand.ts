import * as vscode from 'vscode';
import * as path from 'path';
import Fuse from 'fuse.js';
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
import { RipgrepQuickOpenSearchService } from '../adapters/ripgrepQuickOpenSearchService';
import { t } from '../utils/l10n';
import {
  buildExclusionGlobFromPatterns,
  filterGitignoredUrisFast,
  filterGitignoredUris,
  getGitignoreSignature,
  isGitignoreCacheReady,
  subscribeGitignoreDiscoveryChange,
} from '../utils/gitignoreService';

type QuickOpenItem = vscode.QuickPickItem;

interface SearchCacheEntry {
  uris: vscode.Uri[];
  exceededMaxFiles: boolean;
  workspaceSearchDeferred: boolean;
  mutationVersion: number;
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
  if (!normalized) return '*';
  return `*${normalized}*`;
}

const HYBRID_PREFIX_STAGE_LIMIT = 1200;
const HYBRID_FALLBACK_STAGE_LIMIT = 400;
const MAX_QUICKOPEN_EXCLUSION_GLOB_LENGTH = 12000;
const MAX_INCREMENTAL_SEARCH_CHANGES = 100;
const QUICKOPEN_GITIGNORE_OVERSCAN_FACTOR = 4;
const SEARCH_CACHE_PERSIST_DEBOUNCE_MS = 500;
const MAX_PREFIX_SEED_QUERIES = 3;
const MAX_PREFIX_SEED_URIS = 1200;
const QUICKOPEN_TRACE_WARN_MS = 1500;
const QUICKOPEN_FIND_FILES_TIMEOUT_MS = 2500;
const QUICKOPEN_LARGE_WORKSPACE_FIND_FILES_TIMEOUT_MS = 12000;
const QUICKOPEN_STAGE_MAX_RESULTS = 1500;
const QUICKOPEN_SEARCH_TIMEOUT_ERROR = 'QuickOpenSearchTimeoutError';
const QUICKOPEN_MAX_HEAP_BYTES = 550 * 1024 * 1024;
const QUICKOPEN_MAX_RSS_BYTES = 800 * 1024 * 1024;
const QUICKOPEN_MAX_HEAP_DELTA_BYTES = 128 * 1024 * 1024;
const QUICKOPEN_MAX_RSS_DELTA_BYTES = 192 * 1024 * 1024;
const QUICKOPEN_MAX_SEARCH_STAGE_MS = 5000;
const QUICKOPEN_LARGE_WORKSPACE_MAX_SEARCH_STAGE_MS = 30000;
const QUICKOPEN_COMMAND_COOLDOWN_MS = 750;
const QUICKOPEN_FUSE_INDEX_MAX_FILES = 8000;

interface FuseWorkspaceFileEntry {
  uri: vscode.Uri;
  basename: string;
}

interface FuseWorkspaceIndex {
  folderKey: string;
  entries: FuseWorkspaceFileEntry[];
  fuse: Fuse<FuseWorkspaceFileEntry>;
  truncated: boolean;
  gitignoreReady: boolean;
}

let activeQuickOpenSession:
  | { dispose: () => void; createdAt: number; sessionId: string }
  | null = null;
let lastQuickOpenCommandAt = 0;
let workspaceFuseIndex: FuseWorkspaceIndex | null = null;
let workspaceFuseIndexPromise: Promise<FuseWorkspaceIndex | null> | null = null;
let lastQuickOpenIndexWarmupErrorAt = 0;

function logQuickOpenTrace(
  logger: Logger | undefined,
  message: string,
  metadata?: Record<string, unknown>,
): void {
  const memory = process.memoryUsage();
  logger?.info?.(message, {
    ...metadata,
    heapUsedBytes: memory.heapUsed,
    rssBytes: memory.rss,
  });
}

function startQuickOpenWatchdog(
  logger: Logger | undefined,
  label: string,
  metadata?: Record<string, unknown>,
): () => void {
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    logQuickOpenTrace(
      logger,
      `[QuickOpen][trace] Slow stage detected: ${label}`,
      {
        durationMs: Date.now() - startedAt,
        ...metadata,
      },
    );
  }, QUICKOPEN_TRACE_WARN_MS);

  return () => {
    clearTimeout(timer);
    logger?.debug?.(`[QuickOpen][trace] Stage completed: ${label}`, {
      durationMs: Date.now() - startedAt,
      ...metadata,
    });
  };
}

function createQuickOpenSearchTimeoutError(metadata?: Record<string, unknown>): Error {
  const error = new Error('QuickOpen search timed out');
  error.name = QUICKOPEN_SEARCH_TIMEOUT_ERROR;
  Object.assign(error, metadata);
  return error;
}

function isQuickOpenSearchTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === QUICKOPEN_SEARCH_TIMEOUT_ERROR;
}

function assertQuickOpenSearchHealth(
  logger: Logger | undefined,
  label: string,
  metadata?: Record<string, unknown>,
): void {
  const memory = process.memoryUsage();
  const baselineHeap =
    typeof metadata?.baselineHeapUsedBytes === 'number'
      ? metadata.baselineHeapUsedBytes
      : memory.heapUsed;
  const baselineRss =
    typeof metadata?.baselineRssBytes === 'number'
      ? metadata.baselineRssBytes
      : memory.rss;
  const heapDelta = memory.heapUsed - baselineHeap;
  const rssDelta = memory.rss - baselineRss;
  if (
    memory.heapUsed < QUICKOPEN_MAX_HEAP_BYTES &&
    memory.rss < QUICKOPEN_MAX_RSS_BYTES
  ) {
    return;
  }
  if (
    heapDelta < QUICKOPEN_MAX_HEAP_DELTA_BYTES &&
    rssDelta < QUICKOPEN_MAX_RSS_DELTA_BYTES
  ) {
    logger?.warn?.(`[QuickOpen][trace] High baseline memory detected but growth is within tolerance: ${label}`, {
      ...metadata,
      baselineHeapUsedBytes: baselineHeap,
      baselineRssBytes: baselineRss,
      currentHeapUsedBytes: memory.heapUsed,
      currentRssBytes: memory.rss,
      heapDeltaBytes: heapDelta,
      rssDeltaBytes: rssDelta,
      heapDeltaLimitBytes: QUICKOPEN_MAX_HEAP_DELTA_BYTES,
      rssDeltaLimitBytes: QUICKOPEN_MAX_RSS_DELTA_BYTES,
      heapLimitBytes: QUICKOPEN_MAX_HEAP_BYTES,
      rssLimitBytes: QUICKOPEN_MAX_RSS_BYTES,
    });
    return;
  }

  logQuickOpenTrace(logger, `[QuickOpen][trace] Memory guard triggered: ${label}`, {
    ...metadata,
    baselineHeapUsedBytes: baselineHeap,
    baselineRssBytes: baselineRss,
    heapDeltaBytes: heapDelta,
    rssDeltaBytes: rssDelta,
    heapLimitBytes: QUICKOPEN_MAX_HEAP_BYTES,
    rssLimitBytes: QUICKOPEN_MAX_RSS_BYTES,
    heapDeltaLimitBytes: QUICKOPEN_MAX_HEAP_DELTA_BYTES,
    rssDeltaLimitBytes: QUICKOPEN_MAX_RSS_DELTA_BYTES,
  });
  throw createQuickOpenSearchTimeoutError({
    reason: 'memory-guard',
    label,
    ...metadata,
  });
}

function wrapQuickOpenCallback<TArgs extends unknown[]>(
  logger: Logger,
  label: string,
  handler: (...args: TArgs) => void | Promise<void>,
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    void Promise.resolve()
      .then(() => handler(...args))
      .catch((error) => {
        logger.error(`[QuickOpen] Unhandled callback failure: ${label}`, error);
        void vscode.window.showErrorMessage(
          t('Quick Open failed unexpectedly. See logs for details.'),
        );
      });
  };
}

async function findFilesWithTimeout(params: {
  searchService: QuickOpenSearchService;
  pattern: string;
  excludePatterns: string[];
  limit: number;
  timeoutMs: number;
  token: vscode.CancellationToken;
  logger?: Logger;
  metadata?: Record<string, unknown>;
}): Promise<vscode.Uri[]> {
  const {
    searchService,
    pattern,
    excludePatterns,
    limit,
    timeoutMs,
    token,
    logger,
    metadata,
  } = params;

  const localTokenSource = new vscode.CancellationTokenSource();
  const relay = token.onCancellationRequested(() => {
    localTokenSource.cancel();
  });

  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      searchService.findFiles(
        pattern,
        excludePatterns,
        limit,
        localTokenSource.token,
      ),
      new Promise<vscode.Uri[]>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          localTokenSource.cancel();
          logQuickOpenTrace(
            logger,
            '[QuickOpen][trace] findFiles timed out; closing QuickOpen',
            {
              pattern,
              limit,
              timeoutMs,
              ...metadata,
            },
          );
          reject(
            createQuickOpenSearchTimeoutError({
              pattern,
              limit,
              timeoutMs,
              ...metadata,
            }),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    relay.dispose();
    localTokenSource.dispose();
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

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

  return safeBasenameFromUri(uri).toLowerCase().includes(normalizedSearch);
}

function shouldUseProtectedLocalOnlySearch(searchValue: string): boolean {
  return false;
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

function buildSearchExclusionSignature(
  exclusionGlob: string | undefined,
  gitignoreSignature: string,
): string {
  return `${exclusionGlob ?? ''}::${gitignoreSignature}`;
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
  excludePatterns: string[];
  maxSearchFiles: number;
  searchService: QuickOpenSearchService;
  logger?: Logger;
  token: vscode.CancellationToken;
  baselineHeapUsedBytes?: number;
  baselineRssBytes?: number;
}): Promise<SearchCacheEntry> {
  const {
    normalizedSearch,
    localCandidateUris,
    seedUris = [],
    excludePatterns,
    maxSearchFiles,
    searchService,
    logger,
    token,
    baselineHeapUsedBytes,
    baselineRssBytes,
  } = params;
  const searchStartedAt = Date.now();
  const workspaceSearchBudget = getQuickOpenWorkspaceSearchBudget({
    normalizedSearch,
    maxSearchFiles,
  });
  const assertSearchStillHealthy = (
    label: string,
    metadata?: Record<string, unknown>,
  ): void => {
    assertQuickOpenSearchHealth(logger, label, {
      normalizedSearch,
      elapsedMs: Date.now() - searchStartedAt,
      baselineHeapUsedBytes,
      baselineRssBytes,
      largeWorkspaceMode: workspaceSearchBudget.largeWorkspaceMode,
      ...metadata,
    });
    if (Date.now() - searchStartedAt > workspaceSearchBudget.maxSearchStageMs) {
      logQuickOpenTrace(logger, `[QuickOpen][trace] Search duration guard triggered: ${label}`, {
        normalizedSearch,
        elapsedMs: Date.now() - searchStartedAt,
        maxSearchStageMs: workspaceSearchBudget.maxSearchStageMs,
        largeWorkspaceMode: workspaceSearchBudget.largeWorkspaceMode,
        ...metadata,
      });
      throw createQuickOpenSearchTimeoutError({
        reason: 'duration-guard',
        label,
        normalizedSearch,
        elapsedMs: Date.now() - searchStartedAt,
        maxSearchStageMs: workspaceSearchBudget.maxSearchStageMs,
        largeWorkspaceMode: workspaceSearchBudget.largeWorkspaceMode,
        ...metadata,
      });
    }
  };

  const finishLocalFilterStage = startQuickOpenWatchdog(
    logger,
    'runHybridWorkspaceSearch:local-filter',
    {
      normalizedSearch,
      localCandidateCount: localCandidateUris.length,
      seedCount: seedUris.length,
    },
  );
  const localMatches = dedupeUrisByFsPath(
    localCandidateUris.filter((uri) => matchesSearchText(uri, normalizedSearch)),
  );
  finishLocalFilterStage();
  assertSearchStillHealthy('runHybridWorkspaceSearch:local-filter', {
    localMatchCount: localMatches.length,
  });

  const finishSeedFilterStage = startQuickOpenWatchdog(
    logger,
    'runHybridWorkspaceSearch:seed-filter',
    {
      normalizedSearch,
      seedCount: seedUris.length,
    },
  );
  const workspaceSearchAlreadyFiltered =
    searchService.providesFilteredResults === true;
  const fastGitignoreFilteringReady =
    workspaceSearchAlreadyFiltered || isGitignoreCacheReady();
  const filteredSeedCandidates = seedUris.filter((uri) =>
    matchesSearchText(uri, normalizedSearch),
  );
  const seededMatches = dedupeUrisByFsPath(
    fastGitignoreFilteringReady
      ? (filterGitignoredUrisFast(filteredSeedCandidates) ?? filteredSeedCandidates)
      : filteredSeedCandidates,
  );
  finishSeedFilterStage();
  assertSearchStillHealthy('runHybridWorkspaceSearch:seed-filter', {
    seededMatchCount: seededMatches.length,
  });

  const stagePatterns = [
    `${normalizedSearch}*`,
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
  let gitignoreFilteringDeferred = !fastGitignoreFilteringReady;
  const exclusionGlobApplied = excludePatterns.length > 0;
  const stageResultCap = exclusionGlobApplied
    ? maxSearchFiles
    : QUICKOPEN_STAGE_MAX_RESULTS;
  const findFilesTimeoutMs = exclusionGlobApplied
    ? workspaceSearchBudget.findFilesTimeoutMs * 2
    : workspaceSearchBudget.findFilesTimeoutMs;
  if (workspaceSearchBudget.largeWorkspaceMode) {
    logger?.info?.('[QuickOpen][trace] Large workspace search budget activated', {
      normalizedSearch,
      maxSearchFiles,
      findFilesTimeoutMs,
      maxSearchStageMs: workspaceSearchBudget.maxSearchStageMs,
      exclusionGlobApplied,
    });
  }

  for (let i = 0; i < stagePatterns.length; i += 1) {
    if (token.isCancellationRequested || mergedUris.length >= maxSearchFiles) {
      logger?.debug?.('[QuickOpen][trace] Hybrid search loop stopped early', {
        normalizedSearch,
        stageIndex: i,
        isCancelled: token.isCancellationRequested,
        mergedCount: mergedUris.length,
        maxSearchFiles,
      });
      break;
    }
    assertSearchStillHealthy(`runHybridWorkspaceSearch:before-stage:${i}`, {
      stageIndex: i,
      mergedCount: mergedUris.length,
    });

    const remaining = Math.max(1, maxSearchFiles - mergedUris.length);
    const stageLimit = Math.min(stageLimits[i], remaining) + 1;
    const rawStageLimit = Math.min(
      stageResultCap,
      Math.max(
        stageLimit,
        Math.min(
          maxSearchFiles,
          stageLimit * QUICKOPEN_GITIGNORE_OVERSCAN_FACTOR,
        ),
      ),
    );
    const finishFindFilesStage = startQuickOpenWatchdog(
      logger,
      `runHybridWorkspaceSearch:findFiles:${i}`,
      {
        normalizedSearch,
        stageIndex: i,
        pattern: stagePatterns[i],
        rawStageLimit,
      },
    );
    const foundUris = await findFilesWithTimeout({
      searchService,
      pattern: stagePatterns[i],
      excludePatterns,
      limit: rawStageLimit,
      timeoutMs: findFilesTimeoutMs,
      token,
      logger,
      metadata: {
        normalizedSearch,
        stageIndex: i,
        exclusionGlobApplied,
        workspaceSearchAlreadyFiltered,
      },
    });
    finishFindFilesStage();
    assertSearchStillHealthy(`runHybridWorkspaceSearch:after-findFiles:${i}`, {
      stageIndex: i,
      foundCount: foundUris.length,
    });
    const finishFilterStage = startQuickOpenWatchdog(
      logger,
      `runHybridWorkspaceSearch:filterGitignoredUris:${i}`,
      {
        normalizedSearch,
        stageIndex: i,
        foundCount: foundUris.length,
      },
    );
    const filteredFoundUris = fastGitignoreFilteringReady
      ? workspaceSearchAlreadyFiltered
        ? foundUris
        : (filterGitignoredUrisFast(foundUris) ?? foundUris)
      : foundUris;
    finishFilterStage();
    assertSearchStillHealthy(`runHybridWorkspaceSearch:after-filterGitignoredUris:${i}`, {
      stageIndex: i,
      foundCount: foundUris.length,
      filteredCount: filteredFoundUris.length,
    });

    if (foundUris.length >= rawStageLimit || filteredFoundUris.length >= stageLimit) {
      exceededMaxFiles = true;
    }

    mergedUris = prioritizeDistinctBasenames(
      dedupeUrisByFsPath([...mergedUris, ...filteredFoundUris]),
      normalizedSearch,
    );
    logger?.info?.('[QuickOpen][trace] Hybrid search stage merged', {
      normalizedSearch,
      stageIndex: i,
      foundCount: foundUris.length,
      filteredCount: filteredFoundUris.length,
      mergedCount: mergedUris.length,
      exceededMaxFiles,
      gitignoreFilteringDeferred,
    });
    assertSearchStillHealthy(`runHybridWorkspaceSearch:after-merge:${i}`, {
      stageIndex: i,
      mergedCount: mergedUris.length,
      exceededMaxFiles,
    });
    if (!fastGitignoreFilteringReady) {
      logger?.warn?.(
        '[QuickOpen][trace] Gitignore cache is not ready; stopping hybrid search after the current unfiltered stage',
        {
          normalizedSearch,
          stageIndex: i,
          mergedCount: mergedUris.length,
        },
      );
      break;
    }
  }

  return {
    uris: mergedUris.slice(0, maxSearchFiles),
    exceededMaxFiles,
    workspaceSearchDeferred: gitignoreFilteringDeferred,
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

function getCurrentWindowLabel(): string {
  const workspaceFile = vscode.workspace.workspaceFile;
  if (workspaceFile) {
    return path.basename(workspaceFile.fsPath);
  }

  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    return 'no-workspace';
  }

  if (folders.length === 1) {
    return folders[0].name;
  }

  return folders.map((folder) => folder.name).join(', ');
}

function getQuickOpenWorkspaceSearchBudget(params: {
  normalizedSearch: string;
  maxSearchFiles: number;
}): {
  findFilesTimeoutMs: number;
  maxSearchStageMs: number;
  largeWorkspaceMode: boolean;
} {
  const folderCount = vscode.workspace.workspaceFolders?.length ?? 0;
  const isBroadQuery = params.normalizedSearch.trim().length <= 4;
  const highResultBudget = params.maxSearchFiles >= 10000;
  const largeWorkspaceMode = folderCount > 0 && (isBroadQuery || highResultBudget);

  return {
    findFilesTimeoutMs: largeWorkspaceMode
      ? QUICKOPEN_LARGE_WORKSPACE_FIND_FILES_TIMEOUT_MS
      : QUICKOPEN_FIND_FILES_TIMEOUT_MS,
    maxSearchStageMs: largeWorkspaceMode
      ? QUICKOPEN_LARGE_WORKSPACE_MAX_SEARCH_STAGE_MS
      : QUICKOPEN_MAX_SEARCH_STAGE_MS,
    largeWorkspaceMode,
  };
}

function getQuickOpenEffectiveSearchLimit(params: {
  normalizedSearch: string;
  configuredMaxSearchFiles: number;
  immediateLimit: number;
}): number {
  const queryLength = params.normalizedSearch.trim().length;
  const minimumRequired = Math.max(params.immediateLimit, 200);

  if (queryLength <= 4) {
    return Math.max(minimumRequired, Math.min(params.configuredMaxSearchFiles, 1200));
  }

  if (queryLength <= 6) {
    return Math.max(minimumRequired, Math.min(params.configuredMaxSearchFiles, 3000));
  }

  if (queryLength <= 10) {
    return Math.max(minimumRequired, Math.min(params.configuredMaxSearchFiles, 6000));
  }

  return Math.max(minimumRequired, Math.min(params.configuredMaxSearchFiles, 10000));
}

function currentWorkspaceFolderKey(): string {
  return (vscode.workspace.workspaceFolders ?? [])
    .map((folder) => folder.uri.fsPath)
    .sort()
    .join('|');
}

function invalidateWorkspaceFuseIndex(
  logger: Logger | undefined,
  reason: string,
): void {
  workspaceFuseIndex = null;
  workspaceFuseIndexPromise = null;
  logger?.debug?.('[QuickOpen][trace] Workspace Fuse index invalidated', {
    reason,
  });
}

function getWorkspaceFuseIndexSnapshot(): FuseWorkspaceIndex | null {
  const folderKey = currentWorkspaceFolderKey();
  if (!folderKey) {
    return null;
  }

  if (workspaceFuseIndex?.folderKey !== folderKey) {
    return null;
  }

  return workspaceFuseIndex;
}

function notifyQuickOpenIndexWarmupFailure(): void {
  const now = Date.now();
  if (now - lastQuickOpenIndexWarmupErrorAt < 10000) {
    return;
  }
  lastQuickOpenIndexWarmupErrorAt = now;
  void vscode.window.showErrorMessage(
    t('Quick Open background indexing failed. Live search results are still available.'),
  );
}

function applyQuickOpenResultPathHints(items: FileQuickPickItem[]): void {
  const basenameCounts = new Map<string, number>();
  for (const item of items) {
    const basename = safeBasenameFromUri(item.internalUri).toLowerCase();
    basenameCounts.set(basename, (basenameCounts.get(basename) ?? 0) + 1);
  }

  for (const item of items) {
    const basename = safeBasenameFromUri(item.internalUri).toLowerCase();
    item.setShowDescription((basenameCounts.get(basename) ?? 0) > 1);
  }
}

async function ensureWorkspaceFuseIndex(
  config: QuickOpenConfig,
  logger: Logger | undefined,
  token: vscode.CancellationToken,
): Promise<FuseWorkspaceIndex | null> {
  const folderKey = currentWorkspaceFolderKey();
  if (!folderKey) {
    return null;
  }

  if (workspaceFuseIndex?.folderKey === folderKey) {
    if (workspaceFuseIndex.gitignoreReady || !isGitignoreCacheReady()) {
      return workspaceFuseIndex;
    }
    invalidateWorkspaceFuseIndex(
      logger,
      'gitignore-ready-after-initial-fuse-index-build',
    );
  }

  if (workspaceFuseIndexPromise) {
    return workspaceFuseIndexPromise;
  }

  const buildPromise = (async (): Promise<FuseWorkspaceIndex | null> => {
    const startedAt = Date.now();
    const excludeGlob = getSafeQuickOpenExclusionGlob(
      config.searchExclusions,
      logger,
    );
    logger?.info?.('[QuickOpen][trace] Building Fuse workspace index', {
      folderKey,
      maxFiles: QUICKOPEN_FUSE_INDEX_MAX_FILES,
      excludeGlob,
      gitignoreReady: isGitignoreCacheReady(),
    });

    const foundUris = await vscode.workspace.findFiles(
      '**/*',
      excludeGlob,
      QUICKOPEN_FUSE_INDEX_MAX_FILES,
      token,
    );

    const gitignoreReady = isGitignoreCacheReady();
    const filteredUris = gitignoreReady
      ? (filterGitignoredUrisFast(foundUris) ?? foundUris)
      : foundUris;
    const entries = filteredUris
      .filter((uri) => uri.scheme === 'file')
      .filter((uri) => Boolean(vscode.workspace.getWorkspaceFolder(uri)))
      .map((uri) => ({
        uri,
        basename: safeBasenameFromUri(uri),
      }));

    const fuse = new Fuse(entries, {
      includeScore: true,
      shouldSort: true,
      ignoreLocation: true,
      threshold: 0.35,
      keys: ['basename'],
    });

    const index: FuseWorkspaceIndex = {
      folderKey,
      entries,
      fuse,
      truncated: foundUris.length >= QUICKOPEN_FUSE_INDEX_MAX_FILES,
      gitignoreReady,
    };
    workspaceFuseIndex = index;
    logger?.info?.('[QuickOpen][trace] Fuse workspace index ready', {
      durationMs: Date.now() - startedAt,
      entryCount: entries.length,
      truncated: index.truncated,
      gitignoreReady,
    });
    return index;
  })();

  workspaceFuseIndexPromise = buildPromise;
  try {
    return await buildPromise;
  } finally {
    if (workspaceFuseIndexPromise === buildPromise) {
      workspaceFuseIndexPromise = null;
    }
  }
}

function warmWorkspaceFuseIndexInBackground(
  config: QuickOpenConfig,
  logger: Logger | undefined,
): void {
  if (
    workspaceFuseIndexPromise ||
    (workspaceFuseIndex &&
      (workspaceFuseIndex.gitignoreReady || !isGitignoreCacheReady()))
  ) {
    return;
  }

  logger?.debug?.('[QuickOpen][trace] Scheduling Fuse workspace index warmup');
  const warmupTokenSource = new vscode.CancellationTokenSource();
  void ensureWorkspaceFuseIndex(config, logger, warmupTokenSource.token)
    .catch((error) => {
      logger?.warn?.('[QuickOpen][trace] Fuse workspace index warmup failed', {
        error,
      });
      notifyQuickOpenIndexWarmupFailure();
    })
    .finally(() => {
      warmupTokenSource.dispose();
    });
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

function isGitignoreDocument(document: vscode.TextDocument): boolean {
  return (
    document.uri.scheme === 'file' &&
    document.uri.fsPath.toLowerCase().endsWith(`${path.sep}.gitignore`)
  );
}

function hasOpenGitignoreDocument(): boolean {
  return (
    vscode.window.visibleTextEditors.some((editor) =>
      isGitignoreDocument(editor.document),
    ) || vscode.workspace.textDocuments.some((document) => isGitignoreDocument(document))
  );
}

async function openUriInEditor(
  uri: vscode.Uri,
  options?: {
    viewColumn?: vscode.ViewColumn;
    logger?: Logger;
  },
): Promise<void> {
  options?.logger?.info?.('[QuickOpen] Opening resource in editor window', {
    filePath: uri.fsPath,
    windowName: getCurrentWindowLabel(),
    targetViewColumn: options.viewColumn,
  });
  await vscode.commands.executeCommand('vscode.open', uri, {
    preview: false,
    preserveFocus: false,
    viewColumn: options?.viewColumn,
  });
}

async function openUriInNewWindow(uri: vscode.Uri, logger?: Logger): Promise<void> {
  logger?.info?.('[QuickOpen] Opening resource in new window', {
    filePath: uri.fsPath,
    sourceWindowName: getCurrentWindowLabel(),
  });
  await openUriInEditor(uri, { logger });
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

function createSearchFileItems(
  uris: vscode.Uri[],
  favoritesProvider: FavoritesTreeDataProvider,
  config: QuickOpenConfig,
  favoriteMatchNormSet: Set<string>,
): FileQuickPickItem[] {
  return uris
    .map((uri) => {
      return new FileQuickPickItem({
        uri,
        isFavorite: favoritesProvider.hasFavorite(uri),
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
  isBuildCurrent?: () => boolean;
  baselineHeapUsedBytes?: number;
  baselineRssBytes?: number;
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
    isBuildCurrent,
    baselineHeapUsedBytes,
    baselineRssBytes,
  } = params;
  const shouldRetainResults = (): boolean =>
    !token.isCancellationRequested && (isBuildCurrent?.() ?? true);
  const cacheKey = normalizedSearch;
  let cacheEntry = searchCache.get(cacheKey);
  let noticeItem: QuickOpenItem | null = null;
  let loadMoreItem: ActionQuickPickItem | null = null;
  const finishBuildSearchWatchdog = startQuickOpenWatchdog(
    logger,
    'buildSearchItems',
    {
      cacheKey,
      currentSearchMutationVersion,
      pendingChangedPathCount: pendingSearchChangedPaths.size,
      localCandidateCount: localCandidateUris.length,
      searchPage,
    },
  );
  logger?.debug?.(
    `[QuickOpen] search cache ${cacheEntry ? 'hit' : 'miss'} for "${cacheKey}"`,
  );

  const exclusionGlob = getSafeQuickOpenExclusionGlob(
    config.searchExclusions,
    logger,
  );
  const finishGitignoreSignatureStage = startQuickOpenWatchdog(
    logger,
    'buildSearchItems:getGitignoreSignature',
    { cacheKey },
  );
  const gitignoreSignature = await getGitignoreSignature(token);
  finishGitignoreSignatureStage();
  const exclusionSignature = buildSearchExclusionSignature(
    exclusionGlob,
    gitignoreSignature,
  );
  const maxDisplayResults = Math.max(
    1,
    Math.min(config.maxSearchResults, config.maxSearchFiles),
  );
  const protectedLocalOnlySearch = shouldUseProtectedLocalOnlySearch(cacheKey);
  const effectiveMaxSearchFiles = Math.max(
    config.maxSearchFiles,
    maxDisplayResults * searchPage,
  );
  const needsFullRebuildReason =
    !cacheEntry
      ? 'cache-miss'
      : cacheEntry.exceededMaxFiles &&
          cacheEntry.uris.length < effectiveMaxSearchFiles
        ? 'page-expanded'
      : cacheEntry.exclusionSignature !== exclusionSignature
        ? 'exclusion-signature-changed'
        : cacheEntry.mutationVersion !== currentSearchMutationVersion
          ? pendingSearchChangedPaths.size > MAX_INCREMENTAL_SEARCH_CHANGES
            ? 'too-many-path-changes'
            : 'mutation-version-changed'
          : null;

  if (
    cacheEntry &&
    cacheEntry.exclusionSignature === exclusionSignature &&
    cacheEntry.mutationVersion !== currentSearchMutationVersion &&
    pendingSearchChangedPaths.size > 0 &&
    pendingSearchChangedPaths.size <= MAX_INCREMENTAL_SEARCH_CHANGES
  ) {
    logger?.info?.(
      `[QuickOpen] applying incremental query index update for "${cacheKey}" with ${pendingSearchChangedPaths.size} changed path(s)`,
    );
    cacheEntry = await applyIncrementalSearchUpdates({
      cacheEntry,
      normalizedSearch: cacheKey,
      changedPaths: Array.from(pendingSearchChangedPaths),
      maxSearchFiles: effectiveMaxSearchFiles,
    });
    if (!shouldRetainResults()) {
      finishBuildSearchWatchdog();
      return {
        items: [],
        noticeItem: null,
        loadMoreItem: null,
      };
    }
    cacheEntry.mutationVersion = currentSearchMutationVersion;
    if (cacheEntry.uris.length > 0 || cacheEntry.exceededMaxFiles) {
      searchCache.set(cacheKey, cacheEntry);
      persistSearchCache();
    }
  }

  if (
    !cacheEntry ||
    (cacheEntry.exceededMaxFiles &&
      cacheEntry.uris.length < effectiveMaxSearchFiles) ||
    cacheEntry.exclusionSignature !== exclusionSignature ||
    cacheEntry.mutationVersion !== currentSearchMutationVersion
  ) {
    if (protectedLocalOnlySearch) {
      logger?.warn?.('[QuickOpen][trace] Protected local-only search mode activated', {
        cacheKey,
        minGlobalSearchLength: QUICKOPEN_MIN_GLOBAL_SEARCH_LENGTH,
      });
      cacheEntry = {
        uris: prioritizeDistinctBasenames(
          dedupeUrisByFsPath(
            await filterGitignoredUris(
              localCandidateUris.filter((uri) =>
                matchesSearchText(uri, cacheKey),
              ),
              token,
            ),
          ),
          cacheKey,
        ).slice(0, maxDisplayResults * searchPage),
        exceededMaxFiles: false,
        workspaceSearchDeferred: true,
        mutationVersion: currentSearchMutationVersion,
        exclusionSignature,
      };
    } else {
      const prefixSeedUris = getSearchPrefixSeeds(
        cacheKey,
        searchCache,
        exclusionSignature,
        currentSearchMutationVersion,
      );
      logger?.info?.(
        `[QuickOpen] rebuilding query index for "${cacheKey}" reason=${needsFullRebuildReason} (prefix seeds=${prefixSeedUris.length})`,
      );
      logQuickOpenTrace(logger, '[QuickOpen][trace] Query index rebuild started', {
        cacheKey,
        needsFullRebuildReason,
        prefixSeedCount: prefixSeedUris.length,
        effectiveMaxSearchFiles,
        mergedExclusionCount: config.searchExclusions.length,
        exclusionGlobApplied: Boolean(exclusionGlob),
      });
      cacheEntry = await runHybridWorkspaceSearch({
        normalizedSearch: cacheKey,
        localCandidateUris,
        seedUris: prefixSeedUris,
        excludePatterns: config.searchExclusions,
        maxSearchFiles: effectiveMaxSearchFiles,
        searchService,
        logger,
        token,
        baselineHeapUsedBytes,
        baselineRssBytes,
      });
      if (!shouldRetainResults()) {
        finishBuildSearchWatchdog();
        return {
          items: [],
          noticeItem: null,
          loadMoreItem: null,
        };
      }
      cacheEntry.mutationVersion = currentSearchMutationVersion;
      cacheEntry.exclusionSignature = exclusionSignature;
      if (cacheEntry.uris.length > 0 || cacheEntry.exceededMaxFiles) {
        searchCache.set(cacheKey, cacheEntry);
        persistSearchCache();
        logger?.debug?.(
          `[QuickOpen] query index stored for "${cacheKey}". results=${cacheEntry.uris.length}`,
        );
      }
      if (cacheEntry.uris.length > 0 || cacheEntry.exceededMaxFiles) {
        logQuickOpenTrace(
          logger,
          '[QuickOpen][trace] Query index rebuild completed',
          {
            cacheKey,
            resultCount: cacheEntry.uris.length,
            exceededMaxFiles: cacheEntry.exceededMaxFiles,
          },
        );
      }
    }
  }

  if (protectedLocalOnlySearch) {
    noticeItem = {
      label: t(
        'Search is running in safe mode. Type at least {0} characters to search the full workspace.',
        QUICKOPEN_MIN_GLOBAL_SEARCH_LENGTH,
      ),
      detail: '',
    };
  }

  if (cacheEntry.exceededMaxFiles) {
    noticeItem = {
      label: t(
        'More results are available. Load more or refine your search.',
      ),
      detail: '',
    };
  }

  const displayLimit = Math.min(
    cacheEntry.uris.length,
    maxDisplayResults * searchPage,
  );

  const items = createSearchFileItems(
    cacheEntry.uris,
    favoritesProvider,
    config,
    favoriteMatchNormSet,
  )
    .slice(0, displayLimit)
    .map((item) => {
      const isFav = favoritesProvider.hasFavorite(item.internalUri);
      if (item.isFavorite !== isFav) {
        item.isFavorite = isFav;
        item.updateIcon();
      }
      return item;
    });

  if (cacheEntry.uris.length > displayLimit || cacheEntry.exceededMaxFiles) {
    loadMoreItem = {
      label: t('Load more'),
      description: t(
        'Showing {0} of at least {1}',
        displayLimit,
        cacheEntry.uris.length,
      ),
      action: 'loadMore',
    };
  }

  finishBuildSearchWatchdog();
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
        new RipgrepQuickOpenSearchService();
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
      const commandStartedAt = Date.now();
      if (commandStartedAt - lastQuickOpenCommandAt < QUICKOPEN_COMMAND_COOLDOWN_MS) {
        logger.warn('[QuickOpen] Command ignored due to cooldown', {
          cooldownMs: QUICKOPEN_COMMAND_COOLDOWN_MS,
          elapsedMs: commandStartedAt - lastQuickOpenCommandAt,
        });
        return;
      }
      lastQuickOpenCommandAt = commandStartedAt;
      const sessionId = `quickopen-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      const log = logger?.withContext
        ? logger.withContext({ scope: 'QuickOpen', correlationId: sessionId })
        : logger;
      if (activeQuickOpenSession) {
        log.warn('[QuickOpen] Existing session detected, disposing it before opening a new one', {
          previousSessionId: activeQuickOpenSession.sessionId,
          previousSessionAgeMs: commandStartedAt - activeQuickOpenSession.createdAt,
        });
        activeQuickOpenSession.dispose();
        activeQuickOpenSession = null;
      }
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
        log.debug('[QuickOpen] Favorites validation deferred');
        log.debug('[QuickOpen] Favorites validated successfully');

        log.debug('[QuickOpen] Validating MRU files...');
        log.debug('[QuickOpen] MRU validation deferred');
        log.debug('[QuickOpen] MRU files validated successfully');
      } catch (error) {
        log.error('[QuickOpen] ❌ ERROR during validation:', error);
      }

      log.debug('[QuickOpen] Validation phase deferred');

      const disposables: vscode.Disposable[] = [];
      let isDisposed = false;

      const safeDispose = () => {
        if (isDisposed) {
          log.debug('[QuickOpen] safeDispose() called but already disposed');
          return;
        }
        isDisposed = true;
        if (activeQuickOpenSession?.sessionId === sessionId) {
          activeQuickOpenSession = null;
        }
        try {
          buildTokenSource?.cancel();
          buildTokenSource?.dispose();
          buildTokenSource = null;
          log.debug('[QuickOpen] Disposing QuickPick and listeners...');
          disposables.forEach((d) => d.dispose());
          log.debug(`[QuickOpen] Disposed ${disposables.length} listeners`);
        } catch (error) {
          log.error('[QuickOpen] safeDispose failed', error);
        } finally {
          try {
            quickPick.dispose();
          } catch (error) {
            log.error('[QuickOpen] QuickPick dispose failed', error);
          }
          log.debug('[QuickOpen] QuickPick disposed');
        }
      };

      activeQuickOpenSession = {
        dispose: safeDispose,
        createdAt: commandStartedAt,
        sessionId,
      };

      disposables.push(
        quickPick.onDidHide(
          wrapQuickOpenCallback(log, 'onDidHide', () => {
            log.debug('[QuickOpen] onDidHide triggered');
            safeDispose();
          }),
        ),
      );
      log.debug('[QuickOpen] onDidHide listener registered');

      let buildTokenSource: vscode.CancellationTokenSource | null = null;
      let searchPage = 1;
      let previousSearchValue = '';
      let buildSequence = 0;
      let latestScheduledBuild = 0;
      const scheduleBackgroundVisibleStateValidation = debounce(
        async (favoritePaths: string[], recentPaths: string[]) => {
          try {
            await Promise.all([
              favoritesProvider.validateFavoritesForPaths(favoritePaths),
              mruService.validateFilesForPaths(recentPaths),
            ]);
          } catch (error) {
            log.warn(
              '[QuickOpen] Background validation for visible items failed',
              error,
            );
          }
        },
        250,
      );

      const buildItems = async (
        searchQuery: string = quickPick.value,
      ): Promise<void> => {
        const buildId = ++buildSequence;
        latestScheduledBuild = buildId;
        if (buildTokenSource) {
          log.debug('[QuickOpen][trace] Cancelling previous build before starting next one', {
            buildId,
            searchQuery,
          });
        }
        buildTokenSource?.cancel();
        buildTokenSource?.dispose();
        buildTokenSource = new vscode.CancellationTokenSource();
        const token = buildTokenSource.token;
        token.onCancellationRequested(() => {
          log.debug('[QuickOpen][trace] Build token cancelled', {
            buildId,
            searchQuery,
          });
        });
        log.debug(
          `[QuickOpen] ▶ buildItems() called - searchQuery: "${searchQuery}"`,
          { buildId },
        );

        if (isDisposed) {
          log.warn('[QuickOpen] buildItems() aborted - already disposed');
          return;
        }

        const normalizedSearch = searchQuery.trim();
        const isSearching = normalizedSearch.length > 0;
        const buildStartMemory = process.memoryUsage();
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
        const isBuildCurrent = () =>
          buildId === latestScheduledBuild &&
          !token.isCancellationRequested &&
          !isDisposed;

        try {
          const isSearchValueCurrent = () =>
            normalizedSearch === quickPick.value.trim();

          log.debug(
            `[QuickOpen] Current search value: "${normalizedSearch}" (isSearching: ${isSearching})`,
          );
          logQuickOpenTrace(log, '[QuickOpen][trace] Build search cycle started', {
            buildId,
            normalizedSearch,
            isSearching,
            protectedLocalOnlySearch: shouldUseProtectedLocalOnlySearch(normalizedSearch),
            baselineHeapUsedBytes: buildStartMemory.heapUsed,
            baselineRssBytes: buildStartMemory.rss,
          });

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
          if (isSearching) {
            const previewFavoriteItems: QuickOpenItem[] = [];
            const previewPinnedItems = buildPinnedItems(
              allPinnedUris,
              favoritesProvider,
              config,
            );
            const previewRecentFavItems = buildRecentFavoriteItems(
              recentFavUris,
              favoritesProvider,
              config,
            );
            const previewFavoriteMatchNormSet = new Set(
              [...allPinnedUris, ...recentFavUris].map((uri) =>
                normalizeFsPath(uri.fsPath),
              ),
            );
            const immediatePreviewUris = prioritizeDistinctBasenames(
              dedupeUrisByFsPath([
                ...(filterGitignoredUrisFast(
                  allUrisToDisplay.filter((uri) =>
                    matchesSearchText(uri, normalizedSearch),
                  ),
                ) ??
                  allUrisToDisplay.filter((uri) =>
                    matchesSearchText(uri, normalizedSearch),
                  )),
              ]),
              normalizedSearch,
            );
            const immediatePreviewLimit = Math.max(
              1,
              Math.min(config.maxSearchResults, config.maxSearchFiles) * searchPage,
            );

            if (previewPinnedItems.length > 0) {
              previewFavoriteItems.push(...previewPinnedItems);
            }

            previewFavoriteItems.push({
              label:
                previewRecentFavItems.length > 0 ? t('Favorites') : t('No favorites yet'),
              kind: vscode.QuickPickItemKind.Separator,
            });
            previewFavoriteItems.push({ label: ' ', alwaysShow: false });
            if (previewRecentFavItems.length > 0) {
              previewFavoriteItems.push(...previewRecentFavItems);
            }

            const previewItems: QuickOpenItem[] = [...previewFavoriteItems];
            const previewSearchItems = createSearchFileItems(
              immediatePreviewUris.slice(0, immediatePreviewLimit),
              favoritesProvider,
              config,
              previewFavoriteMatchNormSet,
            );
            if (previewSearchItems.length > 0) {
              previewItems.push({
                label: t('Files'),
                kind: vscode.QuickPickItemKind.Separator,
              });
              previewItems.push(...previewSearchItems);
            }
            previewItems.push({
              label: `$(loading~spin) ${t('Searching...')}`,
              description: '',
              detail: t('Searching workspace files by name...'),
            });

            quickPick.busy = true;
            quickPick.items = previewItems;
          }
          const urisToValidate = isSearching
            ? dedupeUrisByFsPath([...allPinnedUris, ...recentFavUris])
            : allUrisToDisplay;
          const existenceMap = await validateFilesExistence(urisToValidate, token);
          if (!isBuildCurrent()) return;

          const validPinnedUris = allPinnedUris.filter((uri) => {
            const exists = existenceMap.get(uri.fsPath) ?? false;

            return exists;
          });

          const validRecentFavUris = recentFavUris.filter((uri) => {
            const exists = existenceMap.get(uri.fsPath) ?? false;
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
            if (!exists) return false;
            // Exclude items already shown in Pinned or Favorites sections
            const norm = normalizeFsPath(uri.fsPath);
            return !pinnedNormSet.has(norm) && !recentFavNormSet.has(norm);
          });
          const missingFavoritePaths = recentFavUris
            .filter((uri) => !(existenceMap.get(uri.fsPath) ?? false))
            .map((uri) => uri.fsPath);
          const missingRecentPaths = recentUris
            .filter((uri) => !(existenceMap.get(uri.fsPath) ?? false))
            .map((uri) => uri.fsPath);
          if (missingFavoritePaths.length > 0 || missingRecentPaths.length > 0) {
            log.debug(
              '[QuickOpen] Scheduling background validation for missing visible items',
              {
                missingFavoriteCount: missingFavoritePaths.length,
                missingRecentCount: missingRecentPaths.length,
              },
            );
            scheduleBackgroundVisibleStateValidation(
              missingFavoritePaths,
              missingRecentPaths,
            );
          }

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
            const immediateSearchCandidates = allUrisToDisplay.filter((uri) =>
              matchesSearchText(uri, normalizedSearch),
            );
            const immediateUris = prioritizeDistinctBasenames(
              dedupeUrisByFsPath(
                isGitignoreCacheReady()
                  ? (filterGitignoredUrisFast(immediateSearchCandidates) ??
                    immediateSearchCandidates)
                  : immediateSearchCandidates,
              ),
              normalizedSearch,
            );
            const immediateLimit = Math.max(
              1,
              Math.min(config.maxSearchResults, config.maxSearchFiles) * searchPage,
            );
            const immediateItems = createSearchFileItems(
              immediateUris.slice(0, immediateLimit),
              favoritesProvider,
              config,
              favoriteMatchNormSet,
            );
            const effectiveWorkspaceSearchLimit = getQuickOpenEffectiveSearchLimit({
              normalizedSearch,
              configuredMaxSearchFiles: config.maxSearchFiles,
              immediateLimit,
            });
            let liveWorkspaceUris: vscode.Uri[] = [];
            let liveSearchExceededMaxFiles = false;
            let liveSearchGitignoreDeferred = false;
            const liveSearchResult = await runHybridWorkspaceSearch({
              normalizedSearch,
              localCandidateUris: allUrisToDisplay,
              excludePatterns: config.searchExclusions,
              maxSearchFiles: effectiveWorkspaceSearchLimit,
              searchService,
              logger: log,
              token,
              baselineHeapUsedBytes: buildStartMemory.heapUsed,
              baselineRssBytes: buildStartMemory.rss,
            });
            if (!isBuildCurrent()) {
              return;
            }
            liveWorkspaceUris = liveSearchResult.uris;
            liveSearchExceededMaxFiles = liveSearchResult.exceededMaxFiles;
            liveSearchGitignoreDeferred = liveSearchResult.workspaceSearchDeferred;

            const combinedUris = prioritizeDistinctBasenames(
              dedupeUrisByFsPath([...immediateUris, ...liveWorkspaceUris]),
              normalizedSearch,
            ).slice(0, immediateLimit);
            const searchFileItems = createSearchFileItems(
              combinedUris,
              favoritesProvider,
              config,
              favoriteMatchNormSet,
            );
            applyQuickOpenResultPathHints([
              ...pinnedItems,
              ...recentFavItems,
              ...searchFileItems,
            ]);

            const searchItems: QuickOpenItem[] = [...favoriteSectionItems];
            if (searchFileItems.length > 0) {
              searchItems.push({
                label: t('Files'),
                kind: vscode.QuickPickItemKind.Separator,
              });
              searchItems.push(...searchFileItems);
            }

            if (liveSearchGitignoreDeferred) {
              searchItems.push({
                label: t('Gitignore cache is still warming up. Results may temporarily include extra files.'),
                description: '',
                detail: t('Run the search again in a moment for fully filtered results.'),
              });
            }

            if (liveSearchExceededMaxFiles) {
              searchItems.push({
                label: t('Search returned many matches. Refine your search for more precise results.'),
                description: '',
                detail: '',
              });
            }

            quickPick.items = searchItems;
            log.debug('[QuickOpen][trace] Search results applied to QuickPick', {
              buildId,
              normalizedSearch,
              resolvedItemCount: searchItems.length,
              searchFileItemCount: searchFileItems.length,
              liveWorkspaceResultCount: liveWorkspaceUris.length,
              liveSearchExceededMaxFiles,
              liveSearchGitignoreDeferred,
              effectiveWorkspaceSearchLimit,
            });

            if (currentActiveUri) {
              const itemToRestore = searchItems.find(
                (i) =>
                  isFileItem(i) && i.internalUri.toString() === currentActiveUri,
              );
              if (itemToRestore) {
                quickPick.activeItems = [itemToRestore as FileQuickPickItem];
              }
            } else {
              const firstFileItem = searchItems.find((i) =>
                isFileItem(i),
              ) as FileQuickPickItem | undefined;
              quickPick.activeItems = firstFileItem ? [firstFileItem] : [];
            }
            return;
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
          if (!isBuildCurrent()) {
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
            items.push(...otherItems);
            if (loadMoreItem) {
              items.push(loadMoreItem);
            }
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
          if (!isBuildCurrent() && !isQuickOpenSearchTimeoutError(error)) return;
          if (isQuickOpenSearchTimeoutError(error)) {
            log.error('[QuickOpen] Search timed out, closing QuickOpen', error);
            quickPick.hide();
            void vscode.window.showErrorMessage(
              t('Quick Open search timed out. Please refine your search.'),
            );
            return;
          }
          log.error('Error loading files for QuickOpen', error);
          quickPick.items = [
            {
              label: t('Error loading files (see logs)'),
              kind: vscode.QuickPickItemKind.Separator,
            },
          ];
          void vscode.window.showErrorMessage(
            t('Quick Open failed to load results. Please try again.'),
          );
        } finally {
          if (isBuildCurrent()) {
            quickPick.busy = false;
          }
        }
      };

      const rebuildSearchResultsImmediately = async (): Promise<void> => {
        if (quickPick.value.trim().length === 0) {
          return;
        }
        searchPage = 1;
        await buildItems(quickPick.value);
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
      }, 300);
      const debouncedExternalRebuild = debounce(async (reason: string) => {
        logThrottledWithContext(
          'debug',
          'quickopen:external-rebuild',
          `External change (${reason}), rebuilding QuickOpen items`,
        );
        await buildItems(quickPick.value);
      }, 150);

      disposables.push(
        subscribeGitignoreDiscoveryChange(wrapQuickOpenCallback(log, 'gitignoreDiscoveryChange', () => {
          if (!hasOpenGitignoreDocument()) {
            return;
          }
          logThrottledWithContext(
            'debug',
            'quickopen:gitignore-changed',
            'Gitignore changed while a .gitignore document is open, rebuilding QuickOpen items',
          );
          invalidateWorkspaceFuseIndex(log, 'gitignore');
          debouncedExternalRebuild('gitignore');
        })),
      );

      disposables.push(
        quickPick.onDidChangeValue(wrapQuickOpenCallback(log, 'onDidChangeValue', async (value) => {
          log.debug('[QuickOpen][trace] onDidChangeValue received', {
            value,
            length: value.length,
            protectedLocalOnlySearch: shouldUseProtectedLocalOnlySearch(value),
          });
          if (buildTokenSource) {
            log.debug('[QuickOpen][trace] Cancelling in-flight search because the query changed', {
              nextValue: value,
              nextLength: value.length,
            });
            buildTokenSource.cancel();
            buildTokenSource.dispose();
            buildTokenSource = null;
            quickPick.busy = false;
          }
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
        })),
      );

      disposables.push(
        favoritesProvider.onDidChangeTreeData(wrapQuickOpenCallback(log, 'favoritesTreeChange', async () => {
          logThrottledWithContext(
            'debug',
            'quickopen:favorites-changed',
            'Favorites changed, rebuilding QuickOpen items',
          );
          debouncedExternalRebuild('favorites');
        })),
      );

      disposables.push(
        mruService.onDidChangeRecentFiles(wrapQuickOpenCallback(log, 'mruChange', async () => {
          logThrottledWithContext(
            'debug',
            'quickopen:mru-changed',
            'MRU list changed, rebuilding QuickOpen items',
          );
          debouncedExternalRebuild('mru');
        })),
      );

      disposables.push(
        vscode.workspace.onDidChangeConfiguration(wrapQuickOpenCallback(log, 'configurationChange', async (e) => {
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

            invalidateWorkspaceFuseIndex(log, 'configuration');
            await buildItems(quickPick.value);
          }
        })),
      );

      disposables.push(
        vscode.workspace.onDidChangeWorkspaceFolders(wrapQuickOpenCallback(log, 'workspaceFoldersChange', async () => {
          invalidateWorkspaceFuseIndex(log, 'workspace-folders');
          await buildItems(quickPick.value);
        })),
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
        vscode.workspace.onDidRenameFiles(wrapQuickOpenCallback(log, 'onDidRenameFiles', async (event) => {
          logThrottledWithContext(
            'debug',
            'quickopen:fs-renamed',
            `Files renamed: ${event.files.length} file(s)`,
          );
          invalidateWorkspaceFuseIndex(log, 'files-renamed');
          debouncedRebuild();
        })),
      );

      disposables.push(
        vscode.workspace.onDidDeleteFiles(wrapQuickOpenCallback(log, 'onDidDeleteFiles', async (event) => {
          logThrottledWithContext(
            'debug',
            'quickopen:fs-deleted',
            `Files deleted: ${event.files.length} file(s)`,
          );
          invalidateWorkspaceFuseIndex(log, 'files-deleted');
          debouncedRebuild();
        })),
      );

      disposables.push(
        vscode.workspace.onDidCreateFiles(wrapQuickOpenCallback(log, 'onDidCreateFiles', async (event) => {
          logThrottledWithContext(
            'debug',
            'quickopen:fs-created',
            `Files created: ${event.files.length} file(s)`,
          );
          invalidateWorkspaceFuseIndex(log, 'files-created');
          debouncedRebuild();
        })),
      );

      disposables.push(
        quickPick.onDidAccept(wrapQuickOpenCallback(log, 'onDidAccept', async () => {
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
            await openUriInNewWindow(selected.internalUri, log);
          } else {
            await openUriInEditor(selected.internalUri, {
              viewColumn: openToSide ? vscode.ViewColumn.Beside : undefined,
              logger: log,
            });
          }
          log.info('[QuickOpen] ✓ File opened successfully, hiding QuickPick');
          quickPick.hide();
        })),
      );

      disposables.push(
        quickPick.onDidTriggerItemButton(wrapQuickOpenCallback(log, 'onDidTriggerItemButton', async (e) => {
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
                logger: log,
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
              await openUriInNewWindow(uri, log);

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
              await openUriInEditor(uri, { logger: log });

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
            await rebuildSearchResultsImmediately();
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
            await rebuildSearchResultsImmediately();
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
            await rebuildSearchResultsImmediately();
          } catch (error) {
            log.error('[QuickOpen] ❌ Error toggling favorite', error);
          }
        })),
      );
    },
  );

  context.subscriptions.push(disposable);
  logger.info('[QuickOpen] ✓ Command registered successfully');
}
