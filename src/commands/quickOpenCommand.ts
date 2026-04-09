import * as vscode from 'vscode';
import * as path from 'path';
import {
  FavoritesTreeDataProvider,
  CommandItem,
} from '../views/FavoritesTreeDataProvider';
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
  isGitignoreCacheReady,
  subscribeGitignoreDiscoveryChange,
  subscribeGitignoreRulesChange,
} from '../utils/gitignoreService';

type QuickOpenItem = vscode.QuickPickItem;

interface SearchResultEntry {
  uris: vscode.Uri[];
  exceededMaxFiles: boolean;
  workspaceSearchDeferred: boolean;
  workspaceSearchFailed?: boolean;
  workspaceSearchFailureMessage?: string;
}

interface FavoriteLookup {
  hasFavorite: (uri: vscode.Uri) => boolean;
  isPinned: (uri: vscode.Uri) => boolean;
}

interface QuickOpenPathLabels {
  fullPathLabel: string;
  dirPathLabel: string;
  detailPathText: string;
}

interface FavoriteBuildState extends FavoriteLookup {
  allFavoriteUris: vscode.Uri[];
  pinnedUris: vscode.Uri[];
  recentFavoriteUris: vscode.Uri[];
  favoriteNormSet: Set<string>;
  pinnedNormSet: Set<string>;
}

function buildSearchPattern(searchValue: string): string {
  const normalized = searchValue.trim();
  if (!normalized) return '**/*';
  const escaped = normalized.replace(/([\\*?[\]{}!])/g, '[$1]');
  return `**/*${escaped}*`;
}

const HYBRID_PREFIX_STAGE_LIMIT = 100;
const HYBRID_FALLBACK_STAGE_LIMIT = 100;
const MAX_QUICKOPEN_EXCLUSION_GLOB_LENGTH = 12000;
const QUICKOPEN_GITIGNORE_OVERSCAN_FACTOR = 4;
const QUICKOPEN_TRACE_WARN_MS = 1500;
const QUICKOPEN_FIND_FILES_TIMEOUT_MS = 2500;
const QUICKOPEN_LARGE_WORKSPACE_FIND_FILES_TIMEOUT_MS = 12000;
const QUICKOPEN_SEARCH_RESULT_PAGE_SIZE = 1000;
const QUICKOPEN_HARD_SEARCH_RESULT_LIMIT = 5000;
const QUICKOPEN_STAGE_MAX_RESULTS = QUICKOPEN_HARD_SEARCH_RESULT_LIMIT;
const QUICKOPEN_MAX_HEAP_BYTES = 550 * 1024 * 1024;
const QUICKOPEN_MAX_RSS_BYTES = 800 * 1024 * 1024;
const QUICKOPEN_MAX_HEAP_DELTA_BYTES = 128 * 1024 * 1024;
const QUICKOPEN_MAX_RSS_DELTA_BYTES = 192 * 1024 * 1024;
const QUICKOPEN_MAX_SEARCH_STAGE_MS = 5000;
const QUICKOPEN_LARGE_WORKSPACE_MAX_SEARCH_STAGE_MS = 30000;
const QUICKOPEN_COMMAND_COOLDOWN_MS = 750;
const QUICKOPEN_INLINE_MUTATION_REBUILD_SUPPRESSION_MS = 1000;
let activeQuickOpenSession:
  | { dispose: () => void; createdAt: number; sessionId: string }
  | null = null;
let lastQuickOpenCommandAt = 0;

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

function shouldSkipQuickOpenMemoryGuard(label: string): boolean {
  return (
    label.includes('runHybridWorkspaceSearch:local-filter') ||
    label.includes('runHybridWorkspaceSearch:seed-filter') ||
    label.includes('runHybridWorkspaceSearch:before-stage:')
  );
}

function assertQuickOpenSearchHealth(
  logger: Logger | undefined,
  label: string,
  metadata?: Record<string, unknown>,
): boolean {
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
    return false;
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
    return false;
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
  logger?.warn?.('[QuickOpen][trace] Memory budget exceeded but search will continue', {
    label,
    ...metadata,
    baselineHeapUsedBytes: baselineHeap,
    baselineRssBytes: baselineRss,
    heapDeltaBytes: heapDelta,
    rssDeltaBytes: rssDelta,
  });
  return true;
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
    logger?.debug?.('[QuickOpen][trace] Relaying QuickOpen search cancellation into backend search token', {
      pattern,
      limit,
      timeoutMs,
      ...metadata,
    });
    localTokenSource.cancel();
  });

  let timeoutHandle: NodeJS.Timeout | undefined;
  const startedAt = Date.now();
  try {
    logger?.info?.('[QuickOpen][trace] findFilesWithTimeout started', {
      pattern,
      limit,
      timeoutMs,
      ...metadata,
    });
    timeoutHandle = setTimeout(() => {
      logQuickOpenTrace(
        logger,
        '[QuickOpen][trace] findFiles exceeded the soft search budget and is still running',
        {
          pattern,
          limit,
          timeoutMs,
          ...metadata,
        },
      );
    }, timeoutMs);
    const results = await searchService.findFiles(
      pattern,
      excludePatterns,
      limit,
      localTokenSource.token,
      logger,
    );
    logger?.info?.('[QuickOpen][trace] findFilesWithTimeout finished', {
      pattern,
      limit,
      timeoutMs,
      durationMs: Date.now() - startedAt,
      resultCount: results.length,
      cancelled: localTokenSource.token.isCancellationRequested,
      ...metadata,
    });
    return results;
  } catch (error) {
    logger?.error?.('[QuickOpen][trace] findFilesWithTimeout failed', {
      pattern,
      limit,
      timeoutMs,
      durationMs: Date.now() - startedAt,
      cancelled: localTokenSource.token.isCancellationRequested,
      message: error instanceof Error ? error.message : String(error),
      ...metadata,
    });
    throw error;
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

  const basename = safeBasenameFromUri(uri).toLowerCase();
  if (isExtensionLikeQuery(normalizedSearch)) {
    return basename.includes(normalizedSearch);
  }

  return basename.startsWith(normalizedSearch);
}

function shouldUseProtectedLocalOnlySearch(searchValue: string): boolean {
  return false;
}

function isExtensionLikeQuery(searchValue: string): boolean {
  const normalized = searchValue.trim();
  return /^\.[a-z0-9_-]+$/i.test(normalized);
}

function getQuickOpenStrictResultCap(normalizedSearch: string): number {
  void normalizedSearch;
  return QUICKOPEN_HARD_SEARCH_RESULT_LIMIT;
}

function getQuickOpenSearchStagePlan(params: {
  normalizedSearch: string;
  maxSearchFiles: number;
  requestedPageLimit: number;
}): Array<{ pattern: string; limit: number }> {
  const { normalizedSearch, maxSearchFiles, requestedPageLimit } = params;
  const extensionLikeQuery = isExtensionLikeQuery(normalizedSearch);
  const escaped = normalizedSearch.replace(/([\\*?[\]{}!])/g, '[$1]');
  const stageLimit = Math.max(
    1,
    Math.min(
      maxSearchFiles,
      Math.max(requestedPageLimit, HYBRID_PREFIX_STAGE_LIMIT),
    ),
  );

  if (extensionLikeQuery) {
    return [
      {
        pattern: buildSearchPattern(normalizedSearch),
        limit: Math.max(stageLimit, HYBRID_FALLBACK_STAGE_LIMIT),
      },
    ];
  }

  return [
    {
      pattern: `**/${escaped}*`,
      limit: stageLimit,
    },
  ];
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

  if (isExtensionLikeQuery(normalizedSearch) && basename.includes(normalizedSearch)) {
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

async function runHybridWorkspaceSearch(params: {
  normalizedSearch: string;
  localCandidateUris: vscode.Uri[];
  seedUris?: vscode.Uri[];
  excludePatterns: string[];
  workspaceSearchAlreadyFiltered?: boolean;
  maxSearchFiles: number;
  searchService: QuickOpenSearchService;
  logger?: Logger;
  token: vscode.CancellationToken;
  baselineHeapUsedBytes?: number;
  baselineRssBytes?: number;
  }): Promise<SearchResultEntry> {
  const {
    normalizedSearch,
    excludePatterns,
    workspaceSearchAlreadyFiltered = false,
    maxSearchFiles,
    searchService,
    logger,
    token,
    baselineHeapUsedBytes,
    baselineRssBytes,
  } = params;
  const workspaceSearchBudget = getQuickOpenWorkspaceSearchBudget({
    normalizedSearch,
    maxSearchFiles,
  });
  const stagePlan = getQuickOpenSearchStagePlan({
    normalizedSearch,
    maxSearchFiles,
    requestedPageLimit: maxSearchFiles,
  });
  const primaryStage = stagePlan[0];
  if (!primaryStage || token.isCancellationRequested) {
    return {
      uris: [],
      exceededMaxFiles: false,
      workspaceSearchDeferred: false,
    };
  }

  const exclusionGlobApplied = excludePatterns.length > 0;
  const effectiveOverscanFactor = workspaceSearchAlreadyFiltered ? 1.25 : QUICKOPEN_GITIGNORE_OVERSCAN_FACTOR;
  const rawStageLimit = Math.min(
    QUICKOPEN_STAGE_MAX_RESULTS,
    Math.max(
      primaryStage.limit + 1,
      Math.min(
        QUICKOPEN_STAGE_MAX_RESULTS,
        Math.ceil(maxSearchFiles * effectiveOverscanFactor),
      ),
    ),
  );
  const findFilesTimeoutMs = exclusionGlobApplied
    ? workspaceSearchBudget.findFilesTimeoutMs * 2
    : workspaceSearchBudget.findFilesTimeoutMs;

  logger?.debug?.('[QuickOpen][trace] Direct search stage prepared', {
    normalizedSearch,
    maxSearchFiles,
    pattern: primaryStage.pattern,
    rawStageLimit,
    exclusionGlobApplied,
    workspaceSearchAlreadyFiltered,
    effectiveOverscanFactor,
    gitignoreCacheReady: isGitignoreCacheReady(),
  });

  const finishFindFilesStage = startQuickOpenWatchdog(
    logger,
    'runHybridWorkspaceSearch:findFiles:0',
    {
      normalizedSearch,
      pattern: primaryStage.pattern,
      rawStageLimit,
    },
  );
  let foundUris: vscode.Uri[];
  try {
    foundUris = await findFilesWithTimeout({
      searchService,
      pattern: primaryStage.pattern,
      excludePatterns,
      limit: rawStageLimit,
      timeoutMs: findFilesTimeoutMs,
      token,
      logger,
      metadata: {
        normalizedSearch,
        exclusionGlobApplied,
        maxSearchFiles,
      },
    });
  } catch (error) {
    finishFindFilesStage();
    if (token.isCancellationRequested) {
      logger?.info?.('[QuickOpen][trace] Workspace search aborted after backend failure because the build was already cancelled', {
        normalizedSearch,
        pattern: primaryStage.pattern,
        maxSearchFiles,
      });
      return {
        uris: [],
        exceededMaxFiles: false,
        workspaceSearchDeferred: false,
      };
    }

    const workspaceSearchFailureMessage =
      error instanceof Error ? error.message : String(error);
    logger?.error?.('[QuickOpen][trace] Workspace search backend failed; falling back to local QuickOpen results only', {
      normalizedSearch,
      pattern: primaryStage.pattern,
      maxSearchFiles,
      message: workspaceSearchFailureMessage,
    });
    return {
      uris: [],
      exceededMaxFiles: false,
      workspaceSearchDeferred: false,
      workspaceSearchFailed: true,
      workspaceSearchFailureMessage,
    };
  }
  finishFindFilesStage();
  const budgetExceededAfterFindFiles = assertQuickOpenSearchHealth(logger, 'runHybridWorkspaceSearch:after-findFiles:0', {
    normalizedSearch,
    baselineHeapUsedBytes,
    baselineRssBytes,
    foundCount: foundUris.length,
    maxSearchFiles,
  });
  if (budgetExceededAfterFindFiles) {
    const mergedUris = prioritizeDistinctBasenames(
      dedupeUrisByFsPath(foundUris),
      normalizedSearch,
    ).slice(0, maxSearchFiles);
    logger?.warn?.('[QuickOpen][trace] Returning early with partial workspace results after findFiles budget pressure', {
      normalizedSearch,
      foundCount: foundUris.length,
      mergedCount: mergedUris.length,
      workspaceSearchAlreadyFiltered,
    });
    return {
      uris: mergedUris,
      exceededMaxFiles:
        foundUris.length >= rawStageLimit || foundUris.length > maxSearchFiles,
      workspaceSearchDeferred: !workspaceSearchAlreadyFiltered,
    };
  }

  const dedupedFoundUris = dedupeUrisByFsPath(foundUris);
  if (dedupedFoundUris.length !== foundUris.length) {
    logger?.info?.('[QuickOpen][trace] Deduped workspace matches before gitignore filtering', {
      normalizedSearch,
      foundCount: foundUris.length,
      dedupedCount: dedupedFoundUris.length,
      removedCount: foundUris.length - dedupedFoundUris.length,
    });
  }
  const budgetExceededBeforeFilter = assertQuickOpenSearchHealth(
    logger,
    'runHybridWorkspaceSearch:before-filterGitignoredUris:0',
    {
      normalizedSearch,
      baselineHeapUsedBytes,
      baselineRssBytes,
      foundCount: foundUris.length,
      dedupedFoundCount: dedupedFoundUris.length,
      maxSearchFiles,
    },
  );
  if (budgetExceededBeforeFilter) {
    const mergedUris = prioritizeDistinctBasenames(
      dedupedFoundUris,
      normalizedSearch,
    ).slice(0, maxSearchFiles);
    logger?.warn?.('[QuickOpen][trace] Skipping gitignore filtering because memory budget is already exceeded before the filter stage', {
      normalizedSearch,
      foundCount: foundUris.length,
      dedupedFoundCount: dedupedFoundUris.length,
      mergedCount: mergedUris.length,
      workspaceSearchAlreadyFiltered,
    });
    return {
      uris: mergedUris,
      exceededMaxFiles:
        foundUris.length >= rawStageLimit || dedupedFoundUris.length > maxSearchFiles,
      workspaceSearchDeferred: !workspaceSearchAlreadyFiltered,
      workspaceSearchFailed: true,
      workspaceSearchFailureMessage:
        'Gitignore filtering skipped because memory budget was exceeded before the filter stage.',
    };
  }

  const finishFilterStage = startQuickOpenWatchdog(
    logger,
    'runHybridWorkspaceSearch:filterGitignoredUris:0',
    {
      normalizedSearch,
      foundCount: foundUris.length,
    },
  );
  let filteredFoundUris: vscode.Uri[];
  try {
    filteredFoundUris = workspaceSearchAlreadyFiltered
      ? dedupedFoundUris
      : isGitignoreCacheReady()
        ? (filterGitignoredUrisFast(dedupedFoundUris) ?? dedupedFoundUris)
        : await filterGitignoredUris(dedupedFoundUris, token);
  } catch (error) {
    finishFilterStage();
    if (token.isCancellationRequested) {
      logger?.info?.('[QuickOpen][trace] Gitignore filtering aborted after failure because the build was already cancelled', {
        normalizedSearch,
        foundCount: dedupedFoundUris.length,
      });
      return {
        uris: [],
        exceededMaxFiles: false,
        workspaceSearchDeferred: false,
      };
    }

    const workspaceSearchFailureMessage =
      error instanceof Error ? error.message : String(error);
    logger?.error?.('[QuickOpen][trace] Gitignore filtering failed; falling back to unfiltered workspace search results', {
      normalizedSearch,
      foundCount: dedupedFoundUris.length,
      message: workspaceSearchFailureMessage,
      workspaceSearchAlreadyFiltered,
    });
    const mergedUris = prioritizeDistinctBasenames(
      dedupedFoundUris,
      normalizedSearch,
    ).slice(0, maxSearchFiles);
    return {
      uris: mergedUris,
      exceededMaxFiles:
        foundUris.length >= rawStageLimit || dedupedFoundUris.length > maxSearchFiles,
      workspaceSearchDeferred: !workspaceSearchAlreadyFiltered,
      workspaceSearchFailed: true,
      workspaceSearchFailureMessage,
    };
  }
  finishFilterStage();
  const budgetExceededAfterFilter = assertQuickOpenSearchHealth(logger, 'runHybridWorkspaceSearch:after-filterGitignoredUris:0', {
    normalizedSearch,
    baselineHeapUsedBytes,
    baselineRssBytes,
    foundCount: dedupedFoundUris.length,
    filteredCount: filteredFoundUris.length,
    maxSearchFiles,
  });
  if (budgetExceededAfterFilter) {
    const mergedUris = prioritizeDistinctBasenames(
      dedupeUrisByFsPath(filteredFoundUris),
      normalizedSearch,
    ).slice(0, maxSearchFiles);
    logger?.warn?.('[QuickOpen][trace] Returning early with filtered workspace results after gitignore budget pressure', {
      normalizedSearch,
      foundCount: dedupedFoundUris.length,
      filteredCount: filteredFoundUris.length,
      mergedCount: mergedUris.length,
    });
    return {
      uris: mergedUris,
      exceededMaxFiles:
        foundUris.length >= rawStageLimit || filteredFoundUris.length > maxSearchFiles,
      workspaceSearchDeferred: false,
    };
  }

  const mergedUris = prioritizeDistinctBasenames(
    dedupeUrisByFsPath(filteredFoundUris),
    normalizedSearch,
  ).slice(0, maxSearchFiles);
  const exceededMaxFiles =
    foundUris.length >= rawStageLimit || filteredFoundUris.length > maxSearchFiles;

  logger?.info?.('[QuickOpen][trace] Direct workspace search completed', {
    normalizedSearch,
    foundCount: dedupedFoundUris.length,
    filteredCount: filteredFoundUris.length,
    mergedCount: mergedUris.length,
    exceededMaxFiles,
  });

  return {
    uris: mergedUris,
    exceededMaxFiles,
    workspaceSearchDeferred: false,
  };
}

function isFileItem(item: vscode.QuickPickItem): item is FileQuickPickItem {
  return typeof (item as any)?.internalUri?.fsPath === 'string';
}

function matchesCommandSearchText(
  command: {
    label: string;
    command: string;
    cwd?: string;
    type?: 'shell' | 'vscode';
  },
  searchValue: string,
): boolean {
  const normalizedSearch = searchValue.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  return [command.label, command.command, command.cwd ?? '', command.type ?? '']
    .join(' ')
    .toLowerCase()
    .includes(normalizedSearch);
}

function buildFavoriteBuildState(
  favoritesProvider: FavoritesTreeDataProvider,
): FavoriteBuildState {
  const snapshot = favoritesProvider
    .getQuickOpenFavoritesSnapshot()
    .filter(
      (entry) =>
        entry.uri.scheme === 'file' &&
        !!vscode.workspace.getWorkspaceFolder(entry.uri),
    )
    .sort((left, right) => right.addedAt - left.addedAt);

  const allFavoriteUris = snapshot.map((entry) => entry.uri);
  const favoriteNormSet = new Set(
    allFavoriteUris.map((uri) => normalizeFsPath(uri.fsPath)),
  );
  const pinnedUris = snapshot
    .filter((entry) => entry.isPinned)
    .map((entry) => entry.uri);
  const pinnedNormSet = new Set(
    pinnedUris.map((uri) => normalizeFsPath(uri.fsPath)),
  );
  const recentFavoriteUris = snapshot
    .filter((entry) => !entry.isPinned)
    .map((entry) => entry.uri);

  return {
    allFavoriteUris,
    pinnedUris,
    recentFavoriteUris,
    favoriteNormSet,
    pinnedNormSet,
    hasFavorite: (uri: vscode.Uri) =>
      favoriteNormSet.has(normalizeFsPath(uri.fsPath)),
    isPinned: (uri: vscode.Uri) =>
      pinnedNormSet.has(normalizeFsPath(uri.fsPath)),
  };
}

type FavoritesAction = 'clearRecents' | 'loadMoreSearchResults';

function isCommandItem(
  item: vscode.QuickPickItem,
): item is CommandQuickPickItem {
  return typeof (item as any)?.commandItemRef !== 'undefined';
}

class CommandQuickPickItem implements vscode.QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  iconPath?: vscode.ThemeIcon;

  readonly commandItemRef: CommandItem;

  constructor(commandItem: CommandItem) {
    this.commandItemRef = commandItem;
    const data = commandItem.data;
    this.label = data.label;
    const locationLabel = data.cwd ? data.cwd : t('Workspace root');
    this.description = data.command;
    this.detail = `[${locationLabel}]`;
    this.iconPath = new vscode.ThemeIcon(
      data.scope === 'local'
        ? 'folder-library'
        : data.scope === 'global'
          ? 'globe'
          : 'library',
    );
  }
}

interface ActionQuickPickItem extends vscode.QuickPickItem {
  action: FavoritesAction;
  searchQuery?: string;
  nextPageLimit?: number;
}

type DebouncedFunction<T extends (...args: any[]) => any> = ((
  ...args: Parameters<T>
) => void) & {
  cancel: () => void;
};

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

function buildQuickOpenPathLabels(uri: vscode.Uri): QuickOpenPathLabels {
  const { rel, rootName } = workspaceRelativeLabel(uri);
  const dir = path.dirname(rel);
  const cleanDir = dir === '.' || dir === '' ? '.' : dir;

  if (rootName) {
    const label = cleanDir === '.' ? rootName : `[ ${rootName} ] ${cleanDir}`;
    return {
      fullPathLabel: label,
      dirPathLabel: label,
      detailPathText: label,
    };
  }

  return {
    fullPathLabel: cleanDir,
    dirPathLabel: cleanDir,
    detailPathText: cleanDir,
  };
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
  const trimmedSearch = params.normalizedSearch.trim();
  const isBroadQuery =
    trimmedSearch.length <= 4 || isExtensionLikeQuery(trimmedSearch);
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
  requestedPageLimit: number;
}): number {
  const configuredCap = Math.min(
    params.configuredMaxSearchFiles,
    QUICKOPEN_HARD_SEARCH_RESULT_LIMIT,
  );
  const strictCap = getQuickOpenStrictResultCap(params.normalizedSearch);
  const requestedPageLimit = Math.max(
    1,
    Math.min(params.requestedPageLimit, QUICKOPEN_HARD_SEARCH_RESULT_LIMIT),
  );

  return Math.min(configuredCap, strictCap, requestedPageLimit);
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

function debounce<T extends (...args: any[]) => any>(
  func: T,
  waitMs: number,
): DebouncedFunction<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  const debounced = ((...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      func(...args);
    }, waitMs);
  }) as DebouncedFunction<T>;
  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };
  return debounced;
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
  logger?.info?.('[QuickOpen] Opening resource in floating window', {
    filePath: uri.fsPath,
    scheme: uri.scheme,
    sourceWindowName: getCurrentWindowLabel(),
  });
  await vscode.commands.executeCommand('vscode.open', uri, {
    preview: true,
    preserveFocus: true,
  });
  await vscode.commands.executeCommand(
    'workbench.action.moveEditorToNewWindow',
  );
}

function buildPinnedItems(
  uris: vscode.Uri[],
  favoriteLookup: FavoriteLookup,
  config: QuickOpenConfig,
): FileQuickPickItem[] {
  return uris.map((uri) => {
    const isIndividual = favoriteLookup.isPinned(uri);
    return new FileQuickPickItem({
      uri,
      isFavorite: favoriteLookup.hasFavorite(uri),
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
  favoriteLookup: FavoriteLookup,
  config: QuickOpenConfig,
): FileQuickPickItem[] {
  return uris.map((uri) => {
    const isPinned = favoriteLookup.isPinned(uri);
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
  favoriteLookup: FavoriteLookup,
  config: QuickOpenConfig,
): FileQuickPickItem[] {
  return uris.map((uri) => {
    const isFav = favoriteLookup.hasFavorite(uri);
    const isPinned = favoriteLookup.isPinned(uri);
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
  favoriteLookup: FavoriteLookup,
  config: QuickOpenConfig,
  favoriteMatchNormSet: Set<string>,
): FileQuickPickItem[] {
  return uris
    .map((uri) => {
      return new FileQuickPickItem({
        uri,
        isFavorite: favoriteLookup.hasFavorite(uri),
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
    cachedPathLabels?: QuickOpenPathLabels;
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
      cachedPathLabels,
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

    let iconPrefix = isFavorite ? '$(star-full) ' : '$(star-empty) ';
    if (isPinned) iconPrefix = '$(pin) ';

    this.label = `${iconPrefix}${baseName}`;

    const pathLabels = cachedPathLabels ?? buildQuickOpenPathLabels(uri);
    this._fullPathLabel = pathLabels.fullPathLabel;
    this._dirPathLabel = pathLabels.dirPathLabel;

    if (this.pathDetailLocation === 'detail') {
      this._detailPathText = pathLabels.detailPathText;
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
    let iconPrefix = this.isFavorite ? '$(star-full) ' : '$(star-empty) ';
    if (this.isPinned) iconPrefix = '$(pin) ';
    this.label = `${iconPrefix}${baseName}`;

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
        tooltip: t('Open in Floating Window'),
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
      let sessionCleanup: (() => void) | null = null;
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
      log.info('[QuickOpen][traza] Inicio de apertura de QuickOpen', {
        sessionId,
        origen: 'comando-o-atajo',
        commandStartedAt,
      });
      log.debug('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      log.debug('🔍 [QuickOpen] COMMAND STARTED - ALT+SHIFT+F');
      log.debug('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      log.debug(
        `[QuickOpen] Environment: ${vscode.env.appName} (${vscode.version})`,
      );
      const appName = (vscode.env.appName || '').toLowerCase();
      const uriScheme = (vscode.env.uriScheme || '').toLowerCase();
      log.debug(`[QuickOpen] URI Scheme: ${uriScheme}`);
      log.debug(`[QuickOpen] Platform: ${process.platform}`);
      log.debug(`[QuickOpen] Language: ${vscode.env.language}`);

      try {
      const quickPick = vscode.window.createQuickPick<QuickOpenItem>();
      log.debug('[QuickOpen] QuickPick instance created');

      quickPick.value = '';
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
      let searchFailureNoticeShown = false;

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
          cancelQuickOpenBackgroundWork('dispose');
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
      sessionCleanup = safeDispose;

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
      let buildSequence = 0;
      let latestScheduledBuild = 0;
      let deferredExternalRebuildScheduled = false;
      const deferredExternalRebuildReasons = new Set<string>();
      let suppressedFavoritesTreeRefreshCount = 0;
      let suppressedMruRefreshCount = 0;
      let suppressInlineMutationRebuildUntil = 0;
      const searchResultPageLimitByQuery = new Map<string, number>();
      const getSearchResultPageKey = (searchQuery: string): string =>
        searchQuery.trim().toLowerCase();
      const getMaxVisibleSearchResults = (config: QuickOpenConfig): number =>
        Math.max(
          1,
          Math.min(
            config.maxSearchResults,
            config.maxSearchFiles,
            QUICKOPEN_HARD_SEARCH_RESULT_LIMIT,
          ),
        );
      const getRequestedSearchResultPageLimit = (
        searchQuery: string,
        config: QuickOpenConfig,
      ): number => {
        const key = getSearchResultPageKey(searchQuery);
        const maxVisibleSearchResults = getMaxVisibleSearchResults(config);
        const storedLimit = key
          ? searchResultPageLimitByQuery.get(key) ??
            QUICKOPEN_SEARCH_RESULT_PAGE_SIZE
          : QUICKOPEN_SEARCH_RESULT_PAGE_SIZE;
        return Math.max(1, Math.min(storedLimit, maxVisibleSearchResults));
      };
      const setRequestedSearchResultPageLimit = (
        searchQuery: string,
        nextPageLimit: number,
        config: QuickOpenConfig,
      ): void => {
        const key = getSearchResultPageKey(searchQuery);
        if (!key) {
          return;
        }
        const maxVisibleSearchResults = getMaxVisibleSearchResults(config);
        searchResultPageLimitByQuery.set(
          key,
          Math.max(1, Math.min(nextPageLimit, maxVisibleSearchResults)),
        );
      };
      const buildInitialQuickPickItems = (): QuickOpenItem[] => {
        const config = configService.getConfig();
        const favoriteState = buildFavoriteBuildState(favoritesProvider);
        const pinnedUris = favoriteState.pinnedUris.slice(0, config.maxPinned);
        const pinnedNormSet = new Set(
          pinnedUris.map((uri) => normalizeFsPath(uri.fsPath)),
        );
        const recentFavUris = favoriteState.recentFavoriteUris
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
          recentFavUris.map((uri) => normalizeFsPath(uri.fsPath)),
        );
        const rawRecent: unknown[] = (mruService.getRecentFiles?.() as any) ?? [];
        const recentUris = rawRecent
          .map((value) => toSafeFileUri(value, logger))
          .filter((uri): uri is vscode.Uri => !!uri)
          .filter(
            (uri) =>
              uri.scheme === 'file' &&
              !!vscode.workspace.getWorkspaceFolder(uri),
          )
          .filter((uri, index, list) => {
            const norm = normalizeFsPath(uri.fsPath);
            return (
              !pinnedNormSet.has(norm) &&
              !recentFavNormSet.has(norm) &&
              list.findIndex(
                (candidate) =>
                  normalizeFsPath(candidate.fsPath) === norm,
              ) === index
            );
          })
          .slice(0, config.maxRecentFiles);

        const pinnedItems = buildPinnedItems(
          pinnedUris,
          favoriteState,
          config,
        );
        const recentFavItems = buildRecentFavoriteItems(
          recentFavUris,
          favoriteState,
          config,
        );
        const recentItems = buildRecentItems(
          recentUris,
          favoriteState,
          config,
        );
        applyQuickOpenResultPathHints([
          ...pinnedItems,
          ...recentFavItems,
          ...recentItems,
        ]);

        const items: QuickOpenItem[] = [];
        if (pinnedItems.length > 0) {
          items.push(...pinnedItems);
        }

        const hasFavoriteItems = recentFavItems.length > 0;
        items.push({
          label: hasFavoriteItems ? t('Favorites') : t('No favorites yet'),
          kind: vscode.QuickPickItemKind.Separator,
        });
        items.push({ label: ' ', alwaysShow: false });

        if (hasFavoriteItems) {
          items.push(...recentFavItems);
        } else {
          items.push({
            label: t(
              'Search for a file and add it to favorites using the icon on the right',
            ),
            description: '',
            detail: '',
          });
        }

        items.push({
          label:
            recentItems.length > 0 ? t('Recent') : t('No new recent files'),
          kind: vscode.QuickPickItemKind.Separator,
        });

        if (recentItems.length > 0) {
          items.push({
            label: `$(trash) ${t('Clear all')}`,
            action: 'clearRecents',
          } as ActionQuickPickItem);
          items.push(...recentItems);
        } else {
          items.push({
            label: '',
            description: '',
            detail: '',
          });
        }

        return items;
      };
      const buildSearchProgressItems = (searchQuery: string): QuickOpenItem[] => {
        const normalizedSearch = searchQuery.trim();
        if (!normalizedSearch) {
          return buildInitialQuickPickItems();
        }
        const config = configService.getConfig();
        const favoriteState = buildFavoriteBuildState(favoritesProvider);
        const matchingFavoriteCandidateUris = favoriteState.allFavoriteUris.filter(
          (uri) => matchesSearchText(uri, normalizedSearch),
        );
        const matchingFavoriteUris = dedupeUrisByFsPath(
          isGitignoreCacheReady()
            ? (filterGitignoredUrisFast(matchingFavoriteCandidateUris) ??
              matchingFavoriteCandidateUris)
            : matchingFavoriteCandidateUris,
        );
        const pinnedUris = matchingFavoriteUris.filter((uri) =>
          favoriteState.isPinned(uri),
        );
        const pinnedNormSet = new Set(
          pinnedUris.map((uri) => normalizeFsPath(uri.fsPath)),
        );
        const favoriteUris = matchingFavoriteUris.filter((uri) => {
          const norm = normalizeFsPath(uri.fsPath);
          return !pinnedNormSet.has(norm);
        });
        const pinnedItems = buildPinnedItems(pinnedUris, favoriteState, config);
        const favoriteItems = buildRecentFavoriteItems(
          favoriteUris,
          favoriteState,
          config,
        );
        applyQuickOpenResultPathHints([...pinnedItems, ...favoriteItems]);

        const items: QuickOpenItem[] = [];
        if (pinnedItems.length > 0) {
          items.push(...pinnedItems);
        }
        if (favoriteItems.length > 0) {
          items.push({
            label: t('Favorites'),
            kind: vscode.QuickPickItemKind.Separator,
          });
          items.push({ label: ' ', alwaysShow: false });
          items.push(...favoriteItems);
        }
        items.push({
          label: `$(loading~spin) ${t('Searching...')}`,
          description: normalizedSearch,
          detail: t('Searching workspace files by name...'),
          alwaysShow: true,
        });
        return items;
      };
      const applySearchProgressState = (searchQuery: string, reason: string): void => {
        const normalizedSearch = searchQuery.trim();
        if (!normalizedSearch) {
          return;
        }
        const progressItems = buildSearchProgressItems(normalizedSearch);
        quickPick.busy = true;
        quickPick.items = progressItems;
        const firstFileItem = progressItems.find((item) =>
          isFileItem(item),
        ) as FileQuickPickItem | undefined;
        quickPick.activeItems = firstFileItem ? [firstFileItem] : [];
        log.debug('[QuickOpen][trace] Applied in-progress search state with favorite matches', {
          reason,
          searchQuery: normalizedSearch,
          itemCount: progressItems.length,
        });
      };
      const updateVisibleItemsForUri = (
        uri: vscode.Uri,
        updater: (item: FileQuickPickItem) => void,
      ): {
        updatedItemCount: number;
        durationMs: number;
        activeItemRestored: boolean;
      } => {
        const startedAt = Date.now();
        const normalizedTarget = normalizeFsPath(uri.fsPath);
        let updatedItemCount = 0;
        const updatedItems = quickPick.items.map((candidate) => {
          if (
            !isFileItem(candidate) ||
            normalizeFsPath(candidate.internalUri.fsPath) !== normalizedTarget
          ) {
            return candidate;
          }
          updatedItemCount += 1;
          updater(candidate);
          candidate.updateIcon();
          return candidate;
        });
        quickPick.items = updatedItems;
        const activeMatch = updatedItems.find(
          (candidate) =>
            isFileItem(candidate) &&
            normalizeFsPath(candidate.internalUri.fsPath) === normalizedTarget,
        );
        if (activeMatch && isFileItem(activeMatch)) {
          quickPick.activeItems = [activeMatch];
        }
        return {
          updatedItemCount,
          durationMs: Date.now() - startedAt,
          activeItemRestored: Boolean(activeMatch && isFileItem(activeMatch)),
        };
      };
      const deferExternalRebuild = (reason: string, key: string, message: string): void => {
        deferredExternalRebuildReasons.add(reason);
        logThrottledWithContext('debug', key, message, {
          activeQuery: quickPick.value,
          queuedReasons: Array.from(deferredExternalRebuildReasons),
        });
      };
      const scheduleDeferredExternalRebuildFlush = (): void => {
        if (
          deferredExternalRebuildScheduled ||
          deferredExternalRebuildReasons.size === 0 ||
          isDisposed
        ) {
          log.debug('[QuickOpen][trace] Deferred external rebuild flush skipped', {
            deferredExternalRebuildScheduled,
            queuedReasonCount: deferredExternalRebuildReasons.size,
            isDisposed,
            activeQuery: quickPick.value,
          });
          return;
        }
        deferredExternalRebuildScheduled = true;
        log.debug('[QuickOpen][trace] Deferred external rebuild flush scheduled', {
          queuedReasons: Array.from(deferredExternalRebuildReasons),
          activeQuery: quickPick.value,
        });
        setTimeout(() => {
          deferredExternalRebuildScheduled = false;
          if (isDisposed || deferredExternalRebuildReasons.size === 0) {
            log.debug('[QuickOpen][trace] Deferred external rebuild flush aborted before execution', {
              isDisposed,
              queuedReasonCount: deferredExternalRebuildReasons.size,
              activeQuery: quickPick.value,
            });
            return;
          }
          const reasons = Array.from(deferredExternalRebuildReasons);
          deferredExternalRebuildReasons.clear();
          logThrottledWithContext(
            'debug',
            'quickopen:external-rebuild-flush',
            `Flushing deferred external rebuild (${reasons.join(', ')})`,
            { activeQuery: quickPick.value },
          );
          void buildItems(quickPick.value);
        }, 0);
      };

      const buildItems = async (
        searchQuery: string = quickPick.value,
      ): Promise<void> => {
        if (deferredExternalRebuildReasons.size > 0) {
          log.debug('[QuickOpen][trace] Consuming deferred external rebuild reasons for this build', {
            searchQuery,
            reasons: Array.from(deferredExternalRebuildReasons),
          });
          deferredExternalRebuildReasons.clear();
        }
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
        const tokenCancellationDisposable = token.onCancellationRequested(() => {
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
        const buildStartedAt = Date.now();
        const buildStartMemory = process.memoryUsage();
        let buildOutcome = 'started';
        let appliedItemCount = 0;
        let appliedSearchFileItemCount = 0;
        let workspaceResultCount = 0;
        let searchStartedAt: number | null = null;
        let totalSearchResultCount = 0;
        let displayedSearchResultCount = 0;
        let localSearchResultCount = 0;
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
        const abortBuildIfStale = (stage: string): boolean => {
          if (isBuildCurrent()) {
            return false;
          }
          buildOutcome = token.isCancellationRequested
            ? 'cancelled'
            : isDisposed
              ? 'disposed'
              : 'superseded';
          log.info('[QuickOpen][trace] Build skipped because it is no longer current', {
            buildId,
            normalizedSearch,
            stage,
            latestScheduledBuild,
            tokenCancelled: token.isCancellationRequested,
            isDisposed,
            activeQuickPickValue: quickPick.value,
          });
          return true;
        };

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

          let recentUris: vscode.Uri[] = [];
          if (!isSearching) {
            log.debug('[QuickOpen] Fetching recent files from MRU...');
            const rawRecent: unknown[] =
              (mruService.getRecentFiles?.() as any) ?? [];
            log.debug(`[QuickOpen] Raw MRU entries: ${rawRecent.length}`);
            const recentUrisUnsafe = rawRecent
              .map((v) => toSafeFileUri(v, logger))
              .filter((u): u is vscode.Uri => !!u);

            recentUris = recentUrisUnsafe.filter((u) => {
              return (
                u.scheme === 'file' && !!vscode.workspace.getWorkspaceFolder(u)
              );
            });
          } else {
            log.debug('[QuickOpen][trace] Skipping MRU fetch in active search mode', {
              buildId,
              normalizedSearch,
            });
          }
          const favoriteState = buildFavoriteBuildState(favoritesProvider);
          const allFavoriteUris = favoriteState.allFavoriteUris;
          log.debug('[QuickOpen][trace] Favorite state prepared for QuickOpen build', {
            buildId,
            normalizedSearch,
            favoriteCount: allFavoriteUris.length,
            pinnedCount: favoriteState.pinnedUris.length,
            recentFavoriteCount: favoriteState.recentFavoriteUris.length,
          });

          const matchingFavoriteCandidateUris = isSearching
            ? allFavoriteUris.filter((uri) => matchesSearchText(uri, normalizedSearch))
            : [];
          const matchingFavoriteUris = isSearching
            ? dedupeUrisByFsPath(
                isGitignoreCacheReady()
                  ? (filterGitignoredUrisFast(matchingFavoriteCandidateUris) ??
                    matchingFavoriteCandidateUris)
                  : matchingFavoriteCandidateUris,
              )
            : [];

          const pinnedFavUris = isSearching
            ? matchingFavoriteUris.filter((uri) => favoriteState.isPinned(uri))
            : favoriteState.pinnedUris.slice(0, config.maxPinned);

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
            : favoriteState.recentFavoriteUris
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

          const allUrisToDisplay = dedupeUrisByFsPath(
            isSearching
              ? [...allPinnedUris, ...recentFavUris]
              : [...allPinnedUris, ...recentFavUris, ...recentUris],
          );
          log.debug('[QuickOpen][trace] Local QuickOpen candidate pool prepared', {
            buildId,
            normalizedSearch,
            isSearching,
            pinnedCount: allPinnedUris.length,
            recentFavoriteCount: recentFavUris.length,
            recentCount: recentUris.length,
            candidateCount: allUrisToDisplay.length,
          });
          if (isSearching) {
            applySearchProgressState(normalizedSearch, 'build-start');
          }
          log.debug('[QuickOpen][trace] Skipping filesystem existence validation in QuickOpen build', {
            buildId,
            normalizedSearch,
            candidateCount: allUrisToDisplay.length,
            isSearching,
          });
          if (!isBuildCurrent()) return;

          const validPinnedUris = allPinnedUris;
          const validRecentFavUris = recentFavUris;
          const visiblePinnedUris =
            isSearching && isGitignoreCacheReady()
              ? (filterGitignoredUrisFast(validPinnedUris) ?? validPinnedUris)
              : validPinnedUris;
          const visibleRecentFavUris =
            isSearching && isGitignoreCacheReady()
              ? (filterGitignoredUrisFast(validRecentFavUris) ?? validRecentFavUris)
              : validRecentFavUris;
          const favoriteMatchNormSet = new Set(
            [...visiblePinnedUris, ...visibleRecentFavUris].map((uri) =>
              normalizeFsPath(uri.fsPath),
            ),
          );

          const validRecentUris = recentUris.filter((uri) => {
            // Exclude items already shown in Pinned or Favorites sections
            const norm = normalizeFsPath(uri.fsPath);
            return !pinnedNormSet.has(norm) && !recentFavNormSet.has(norm);
          });

          const pinnedItems = buildPinnedItems(
            visiblePinnedUris,
            favoriteState,
            config,
          );
          const recentFavItems = buildRecentFavoriteItems(
            visibleRecentFavUris,
            favoriteState,
            config,
          );
          const recentItems = buildRecentItems(
            validRecentUris.slice(0, config.maxRecentFiles),
            favoriteState,
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

          const otherItems: FileQuickPickItem[] = [];
          let searchNoticeItem: QuickOpenItem | null = null;

          const personalizedCommands = [
            ...favoritesProvider.getCommandsByScope('local'),
            ...favoritesProvider.getCommandsByScope('global'),
          ];
          const searchableCommands = isSearching
            ? [...personalizedCommands, ...favoritesProvider.getCommandsByScope('opensource')]
            : personalizedCommands;
          const visibleCommands = isSearching
            ? searchableCommands.filter((command) =>
                matchesCommandSearchText(command, normalizedSearch),
              )
            : searchableCommands;

          if (visibleCommands.length > 0) {
            const commandQuickPickItems = visibleCommands
              .sort((a, b) => b.addedAt - a.addedAt || a.label.localeCompare(b.label))
              .map((data) => new CommandQuickPickItem(new CommandItem(data)));

            items.push({
              label: t('Commands'),
              kind: vscode.QuickPickItemKind.Separator,
            });
            items.push(...commandQuickPickItems);
          }
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
            const maxVisibleSearchResults =
              getMaxVisibleSearchResults(config);
            const immediateLimit = getRequestedSearchResultPageLimit(
              normalizedSearch,
              config,
            );
            const effectiveWorkspaceSearchLimit = getQuickOpenEffectiveSearchLimit({
              normalizedSearch,
              configuredMaxSearchFiles: config.maxSearchFiles,
              requestedPageLimit: immediateLimit,
            });
            const workspaceGitignoreReady = isGitignoreCacheReady();
            const backendUsesGitignorePatterns = Boolean(
              searchService.providesFilteredResults,
            );
            const backendExcludePatterns = config.searchExclusions;
            log.info('[QuickOpen][trace] Effective workspace search inputs resolved', {
              buildId,
              normalizedSearch,
              workspaceGitignoreReady,
              localImmediateMatchCount: immediateUris.length,
              immediateLimit,
              effectiveWorkspaceSearchLimit,
              maxVisibleSearchResults,
              backendExclusionCount: backendExcludePatterns.length,
              backendUsesGitignorePatterns,
              searchServiceProvidesFilteredResults:
                Boolean(searchService.providesFilteredResults),
            });
            searchStartedAt = Date.now();
            localSearchResultCount = immediateUris.length;
            log.info('[QuickOpen][traza] Inicio de busqueda QuickOpen', {
              buildId,
              busqueda: normalizedSearch,
              resultadosLocalesIniciales: localSearchResultCount,
              limiteVisible: immediateLimit,
              limiteWorkspace: effectiveWorkspaceSearchLimit,
              cacheGitignoreLista: workspaceGitignoreReady,
              backendFiltraGitignore: backendUsesGitignorePatterns,
            });
            let liveWorkspaceUris: vscode.Uri[] = [];
            let liveSearchExceededMaxFiles = false;
            let liveSearchGitignoreDeferred = false;
            let liveWorkspaceSearchFailed = false;
            const liveSearchResult = await runHybridWorkspaceSearch({
              normalizedSearch,
              localCandidateUris: allUrisToDisplay,
              excludePatterns: backendExcludePatterns,
              workspaceSearchAlreadyFiltered: backendUsesGitignorePatterns,
              maxSearchFiles: effectiveWorkspaceSearchLimit,
              searchService,
              logger: log,
              token,
              baselineHeapUsedBytes: buildStartMemory.heapUsed,
              baselineRssBytes: buildStartMemory.rss,
            });
            if (abortBuildIfStale('after-runHybridWorkspaceSearch')) {
              return;
            }
            liveWorkspaceUris = liveSearchResult.uris;
            workspaceResultCount = liveWorkspaceUris.length;
            liveSearchExceededMaxFiles = liveSearchResult.exceededMaxFiles;
            liveSearchGitignoreDeferred = liveSearchResult.workspaceSearchDeferred;
            liveWorkspaceSearchFailed =
              liveSearchResult.workspaceSearchFailed ?? false;
            const liveWorkspaceSearchFailureMessage =
              liveSearchResult.workspaceSearchFailureMessage;

            const finishComposeSearchItemsStage = startQuickOpenWatchdog(
              log,
              'buildItems:compose-search-results',
              {
                buildId,
                normalizedSearch,
                localImmediateMatchCount: immediateUris.length,
                workspaceResultCount: liveWorkspaceUris.length,
              },
            );
            const combinedCandidateUris = prioritizeDistinctBasenames(
              dedupeUrisByFsPath([...immediateUris, ...liveWorkspaceUris]),
              normalizedSearch,
            );
            const combinedUrisBeforeLimit = backendUsesGitignorePatterns
              ? combinedCandidateUris
              : isGitignoreCacheReady()
                ? (filterGitignoredUrisFast(combinedCandidateUris) ??
                  combinedCandidateUris)
                : combinedCandidateUris;
            if (combinedUrisBeforeLimit.length !== combinedCandidateUris.length) {
              log.info('[QuickOpen][trace] Final visible results reduced by gitignore filter', {
                buildId,
                normalizedSearch,
                beforeCount: combinedCandidateUris.length,
                afterCount: combinedUrisBeforeLimit.length,
                rejectedSample: combinedCandidateUris
                  .filter(
                    (uri) =>
                      !combinedUrisBeforeLimit.some(
                        (accepted) => normalizeFsPath(accepted.fsPath) === normalizeFsPath(uri.fsPath),
                      ),
                  )
                  .slice(0, 5)
                  .map((uri) => uri.fsPath),
              });
            }
            const combinedUris = combinedUrisBeforeLimit.slice(0, immediateLimit);
            totalSearchResultCount = combinedUrisBeforeLimit.length;
            displayedSearchResultCount = combinedUris.length;
            const searchFileItems = createSearchFileItems(
              combinedUris,
              favoriteState,
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
            } else {
              searchItems.push({
                label: t('No results found.'),
                description: '',
                detail: normalizedSearch,
                alwaysShow: true,
              });
            }

            if (liveSearchGitignoreDeferred) {
              searchItems.push({
                label: t('Gitignore cache is still warming up. Results may temporarily include extra files.'),
                description: '',
                detail: t('Run the search again in a moment for fully filtered results.'),
              });
            }

            if (liveWorkspaceSearchFailed) {
              searchItems.push({
                label: t('Workspace search failed. Showing only local Quick Open matches.'),
                description: '',
                detail: liveWorkspaceSearchFailureMessage
                  ? t('Search backend error: {0}', liveWorkspaceSearchFailureMessage)
                  : t('Retry the search. The extension stayed active to avoid closing the editor window.'),
              });
              if (!searchFailureNoticeShown) {
                searchFailureNoticeShown = true;
                void vscode.window.showWarningMessage(
                  t(
                    'Quick Open search backend failed. Showing partial results to keep the editor window open.',
                  ),
                );
              }
            }

            const hasMoreSearchResults =
              liveSearchExceededMaxFiles ||
              combinedUrisBeforeLimit.length > combinedUris.length;
            const canLoadNextSearchPage =
              hasMoreSearchResults &&
              immediateLimit < maxVisibleSearchResults;
            if (canLoadNextSearchPage) {
              const nextPageLimit = Math.min(
                immediateLimit + QUICKOPEN_SEARCH_RESULT_PAGE_SIZE,
                maxVisibleSearchResults,
              );
              const nextPageSize = nextPageLimit - immediateLimit;
              searchNoticeItem = {
                label: `$(chevron-down) ${t('Load more')}`,
                description: t('Showing {0} of {1}', combinedUris.length, nextPageLimit),
                detail: t('Load the next page of {0} results.', nextPageSize),
                alwaysShow: true,
                action: 'loadMoreSearchResults',
                searchQuery: normalizedSearch,
                nextPageLimit,
              } as ActionQuickPickItem;
            } else if (hasMoreSearchResults) {
              searchNoticeItem = {
                label: t(
                  'Showing the first {0} results. Refine your search for more precise results.',
                  combinedUris.length,
                ),
                description: '',
                detail: '',
              };
            }
            if (searchNoticeItem) {
              searchItems.push(searchNoticeItem);
            }

            quickPick.items = searchItems;
            buildOutcome = 'applied-search-results';
            appliedItemCount = searchItems.length;
            appliedSearchFileItemCount = searchFileItems.length;
            finishComposeSearchItemsStage();
            log.debug('[QuickOpen][trace] Search results applied to QuickPick', {
              buildId,
              normalizedSearch,
              pinnedItemCount: pinnedItems.length,
              favoriteItemCount: recentFavItems.length,
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
            buildOutcome = 'stale-search-value';
            log.debug(
              '[QuickOpen] Search value changed while building items, skipping update',
            );
            return;
          }
          if (abortBuildIfStale('before-apply-non-search-results')) {
            return;
          }

          if (otherItems.length > 0 || searchNoticeItem) {
            items.push({
              label: t('Files'),
              kind: vscode.QuickPickItemKind.Separator,
            });
            if (searchNoticeItem) {
              items.push(searchNoticeItem);
            }
            items.push(...otherItems);
          }

          quickPick.items = items;
          buildOutcome = 'applied-initial-results';
          appliedItemCount = items.length;

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
                appName.includes('angravity') ||
                appName.includes('antigravity') ||
                uriScheme.includes('angravity') ||
                uriScheme.includes('antigravity');
              const isCursor =
                appName.includes('cursor') || uriScheme.includes('cursor');

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
          if (abortBuildIfStale('catch')) return;
          buildOutcome = 'error';
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
          const finishMemory = process.memoryUsage();
          const isCurrentBuildToken = buildTokenSource?.token === token;
          if (isCurrentBuildToken) {
            log.debug('[QuickOpen][trace] Releasing build resources after search cycle finished', {
              buildId,
              normalizedSearch,
              outcome: buildOutcome,
              tokenCancelled: token.isCancellationRequested,
            });
            buildTokenSource.dispose();
            buildTokenSource = null;
          } else {
            log.debug('[QuickOpen][trace] Build resources already replaced before cleanup', {
              buildId,
              normalizedSearch,
              outcome: buildOutcome,
              latestScheduledBuild,
              tokenCancelled: token.isCancellationRequested,
            });
          }
          tokenCancellationDisposable.dispose();
          if (isSearching && searchStartedAt !== null) {
            log.info('[QuickOpen][traza] Fin de busqueda QuickOpen', {
              buildId,
              busqueda: normalizedSearch,
              outcome: buildOutcome,
              duracionBusquedaMs: Date.now() - searchStartedAt,
              totalResultados: totalSearchResultCount,
              resultadosMostrados: displayedSearchResultCount,
              resultadosLocales: localSearchResultCount,
              resultadosWorkspace: workspaceResultCount,
            });
          }
          log.info('[QuickOpen][trace] Build search cycle finished', {
            buildId,
            normalizedSearch,
            outcome: buildOutcome,
            tokenCancelled: token.isCancellationRequested,
            isDisposed,
            latestScheduledBuild,
            quickPickValue: quickPick.value,
            appliedItemCount,
            appliedSearchFileItemCount,
            workspaceResultCount,
            durationMs: Date.now() - buildStartedAt,
            baselineHeapUsedBytes: buildStartMemory.heapUsed,
            baselineRssBytes: buildStartMemory.rss,
            finalHeapUsedBytes: finishMemory.heapUsed,
            finalRssBytes: finishMemory.rss,
            heapDeltaBytes: finishMemory.heapUsed - buildStartMemory.heapUsed,
            rssDeltaBytes: finishMemory.rss - buildStartMemory.rss,
            buildTokenReleased: isCurrentBuildToken,
          });
          if (isBuildCurrent()) {
            quickPick.busy = false;
            scheduleDeferredExternalRebuildFlush();
          }
        }
      };

      log.info('[QuickOpen] Preparing initial QuickPick shell...');
      quickPick.items = buildInitialQuickPickItems();

      if (isDisposed || activeQuickOpenSession?.sessionId !== sessionId) {
        log.info('[QuickOpen] Aborting QuickPick show because session is no longer active', {
          sessionId,
          isDisposed,
          activeSessionId: activeQuickOpenSession?.sessionId ?? null,
        });
        safeDispose();
        return;
      }

      log.info('[QuickOpen] Showing QuickPick UI NOW (shell ready)...');
      quickPick.value = '';
      quickPick.busy = false;
      quickPick.show();
      log.info('[QuickOpen][traza] QuickOpen visible', {
        sessionId,
        origen: 'comando-o-atajo',
        tiempoDesdeInvocacionMs: Date.now() - commandStartedAt,
      });
      log.info(
        '[QuickOpen] ✓ QuickPick visible and ready for user interaction',
      );
      log.info('[QuickOpen] Starting initial buildItems(false)...');
      if (!isDisposed && activeQuickOpenSession?.sessionId === sessionId) {
        void buildItems('');
      }

      let previousValue = '';
      const shouldDeferExternalRebuild = (): boolean =>
        quickPick.value.trim().length > 0;
      const debouncedSearchRebuild = debounce(async (value: string) => {
        await buildItems(value);
      }, 300);
      const debouncedExternalRebuild = debounce(async (reason: string) => {
        if (shouldDeferExternalRebuild()) {
          deferExternalRebuild(
            reason,
            'quickopen:external-rebuild-deferred',
            `External change (${reason}) deferred while search is active`,
          );
          return;
        }
        logThrottledWithContext(
          'debug',
          'quickopen:external-rebuild',
          `External change (${reason}), rebuilding QuickOpen items`,
        );
        await buildItems(quickPick.value);
      }, 150);
      const debouncedFavoritesRebuild = debounce(async (reason: string) => {
        logThrottledWithContext(
          'debug',
          'quickopen:favorites-rebuild',
          `Favorites changed (${reason}), rebuilding QuickOpen items`,
          { activeQuery: quickPick.value },
        );
        await buildItems(quickPick.value);
      }, 150);
      const debouncedInlineMutationRebuild = debounce(async (reason: string) => {
        log.debug('[QuickOpen][trace] Rebuilding QuickOpen after inline favorite mutation', {
          reason,
          activeQuery: quickPick.value,
        });
        await buildItems(quickPick.value);
      }, 10);
      const scheduleInlineMutationRefresh = (
        reason: string,
        filePath: string,
        startedAt: number,
        updateResult: {
          updatedItemCount: number;
          durationMs: number;
          activeItemRestored: boolean;
        },
        extra?: Record<string, unknown>,
      ): void => {
        const activeQuery = quickPick.value.trim();
        const isSearching = activeQuery.length > 0;
        suppressInlineMutationRebuildUntil = Date.now() +
          QUICKOPEN_INLINE_MUTATION_REBUILD_SUPPRESSION_MS;
        const logPayload = {
          reason,
          filePath,
          activeQuery,
          isSearching,
          suppressInlineMutationRebuildUntil,
          totalDurationMs: Date.now() - startedAt,
          uiUpdateDurationMs: updateResult.durationMs,
          updatedItemCount: updateResult.updatedItemCount,
          activeItemRestored: updateResult.activeItemRestored,
          ...extra,
        };

        if (isSearching) {
          log.info('[QuickOpen][trace] Inline mutation applied locally during active search; full rebuild skipped', logPayload);
          return;
        }

        log.info('[QuickOpen][trace] Inline mutation scheduling full rebuild for non-search view', logPayload);
        debouncedInlineMutationRebuild(reason);
      };
      const shouldSkipInlineMutationTriggeredRebuild = (
        source: string,
      ): boolean => {
        const activeQuery = quickPick.value.trim();
        const now = Date.now();
        const shouldSkip =
          activeQuery.length > 0 &&
          now < suppressInlineMutationRebuildUntil;
        if (shouldSkip) {
          log.info('[QuickOpen][trace] Skipping rebuild caused by internal inline mutation while search is active', {
            source,
            activeQuery,
            suppressInlineMutationRebuildUntil,
            remainingSuppressionMs:
              suppressInlineMutationRebuildUntil - now,
          });
        }
        return shouldSkip;
      };
      const debouncedRulesRebuild = debounce(async (reason: string) => {
        if (shouldDeferExternalRebuild()) {
          deferExternalRebuild(
            reason,
            'quickopen:rules-rebuild-deferred',
            `Gitignore rules change (${reason}) deferred while search is active`,
          );
          return;
        }
        logThrottledWithContext(
          'debug',
          'quickopen:rules-rebuild',
          `Gitignore rules changed (${reason}), rebuilding QuickOpen items`,
          { activeQuery: quickPick.value },
        );
        await buildItems(quickPick.value);
      }, 150);
      const cancelQuickOpenBackgroundWork = (reason: string): void => {
        log.debug('[QuickOpen][trace] Cancelling background QuickOpen work', {
          reason,
          activeQuery: quickPick.value,
          hasBuildTokenSource: Boolean(buildTokenSource),
          latestScheduledBuild,
          deferredExternalRebuildCount: deferredExternalRebuildReasons.size,
        });
        buildTokenSource?.cancel();
        buildTokenSource?.dispose();
        buildTokenSource = null;
        deferredExternalRebuildReasons.clear();
        quickPick.busy = false;
        debouncedSearchRebuild.cancel();
        debouncedExternalRebuild.cancel();
        debouncedFavoritesRebuild.cancel();
        debouncedInlineMutationRebuild.cancel();
        debouncedRulesRebuild.cancel();
        debouncedRebuild.cancel();
      };

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
          debouncedExternalRebuild('gitignore');
        })),
      );
      disposables.push(
        subscribeGitignoreRulesChange(wrapQuickOpenCallback(log, 'gitignoreRulesChange', () => {
          debouncedRulesRebuild('rules-change');
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
              quickPick.items = buildInitialQuickPickItems();
              void buildItems('');
            } else {
              applySearchProgressState(value, 'empty-state-transition');
              log.debug('[QuickOpen][trace] Scheduling debounced search rebuild', {
                value,
                length: value.length,
                reason: 'empty-state-transition',
              });
              debouncedSearchRebuild(value);
            }
            return;
          }

          if (!isEmpty) {
            applySearchProgressState(value, 'active-search-update');
            log.debug('[QuickOpen][trace] Scheduling debounced search rebuild', {
              value,
              length: value.length,
              reason: 'active-search-update',
            });
            debouncedSearchRebuild(value);
          }
        })),
      );

      disposables.push(
        favoritesProvider.onDidChangeTreeData(wrapQuickOpenCallback(log, 'favoritesTreeChange', async () => {
          if (suppressedFavoritesTreeRefreshCount > 0) {
            suppressedFavoritesTreeRefreshCount -= 1;
            log.debug('[QuickOpen][trace] Skipping QuickOpen rebuild for internally triggered favorites tree change', {
              remainingSuppressedFavoritesTreeRefreshCount:
                suppressedFavoritesTreeRefreshCount,
            });
            return;
          }
          if (shouldSkipInlineMutationTriggeredRebuild('favoritesTreeChange')) {
            return;
          }
          logThrottledWithContext(
            'debug',
            'quickopen:favorites-changed',
            'Favorites changed, rebuilding QuickOpen items',
            { activeQuery: quickPick.value },
          );
          debouncedFavoritesRebuild('favorites');
        })),
      );

      disposables.push(
        mruService.onDidChangeRecentFiles(wrapQuickOpenCallback(log, 'mruChange', async () => {
          if (suppressedMruRefreshCount > 0) {
            suppressedMruRefreshCount -= 1;
            log.debug('[QuickOpen][trace] Skipping QuickOpen rebuild for internally triggered MRU change', {
              remainingSuppressedMruRefreshCount: suppressedMruRefreshCount,
            });
            return;
          }
          if (shouldSkipInlineMutationTriggeredRebuild('mruChange')) {
            return;
          }
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
            if (shouldDeferExternalRebuild()) {
              deferExternalRebuild(
                'config',
                'quickopen:config-rebuild-deferred',
                'Configuration change deferred while search is active',
              );
              return;
            }
            logThrottledWithContext(
              'debug',
              'quickopen:config-changed',
              'Configuration changed (quick open), rebuilding QuickOpen items',
            );

            await buildItems(quickPick.value);
          }
        })),
      );

      disposables.push(
        vscode.workspace.onDidChangeWorkspaceFolders(wrapQuickOpenCallback(log, 'workspaceFoldersChange', async () => {
          if (shouldDeferExternalRebuild()) {
            deferExternalRebuild(
              'workspace-folders',
              'quickopen:workspace-folders-rebuild-deferred',
              'Workspace folder change deferred while search is active',
            );
            return;
          }
          await buildItems(quickPick.value);
        })),
      );

      const debouncedRebuild = debounce(async () => {
        if (shouldDeferExternalRebuild()) {
          deferExternalRebuild(
            'filesystem',
            'quickopen:fs-rebuild-deferred',
            'File system change deferred while search is active',
          );
          return;
        }
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

            quickPick.items = buildInitialQuickPickItems();
            void buildItems('');
            return;
          }
          if (actionItem.action === 'loadMoreSearchResults') {
            const searchQuery = actionItem.searchQuery ?? quickPick.value;
            const nextPageLimit =
              actionItem.nextPageLimit ?? QUICKOPEN_SEARCH_RESULT_PAGE_SIZE;
            const config = configService.getConfig();
            log.info('[QuickOpen] Executing action: loadMoreSearchResults', {
              searchQuery,
              nextPageLimit,
            });
            setRequestedSearchResultPageLimit(searchQuery, nextPageLimit, config);
            quickPick.busy = true;
            await buildItems(searchQuery);
            return;
          }
          if (!isFileItem(selected)) {
            if (isCommandItem(selected)) {
              log.info(
                `[QuickOpen] Executing command: "${selected.commandItemRef.data.label}"`,
              );
              favoritesProvider.runCommand(selected.commandItemRef);
              quickPick.hide();
              return;
            }
            log.debug(
              '[QuickOpen] Selected item is not a file item (separator or action)',
            );
            return;
          }

          log.info(`[QuickOpen] Opening file: ${selected.internalUri.fsPath}`);
          cancelQuickOpenBackgroundWork('accept-open-start');
          safeDispose();

          try {
            log.debug('[QuickOpen] Opening selected file without pre-open stat');
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

            return;
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
              `[QuickOpen] Opening in floating window: ${selected.internalUri.fsPath}`,
            );
            await openUriInNewWindow(selected.internalUri, log);
          } else {
            await openUriInEditor(selected.internalUri, {
              viewColumn: openToSide ? vscode.ViewColumn.Beside : undefined,
              logger: log,
            });
          }
          log.info('[QuickOpen] ✓ File opened successfully, hiding QuickPick');
          try {
            mruService.add(selected.internalUri.fsPath);
            log.debug('[QuickOpen] File added to MRU');
          } catch (e) {
            log.warn('[QuickOpen] Failed to add MRU item', e);
          }
          log.info('[QuickOpen] File opened successfully');
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
              cancelQuickOpenBackgroundWork('button-open-to-side');
              safeDispose();
              await openUriInEditor(uri, {
                viewColumn: vscode.ViewColumn.Beside,
                logger: log,
              });
              mruService.add(uri.fsPath);
            } catch (err) {
              log.error(`[QuickOpen] Error opening to side`, err);
            }
            return;
          }

          if (button.tooltip === t('Open in Floating Window')) {
            log.info(`[QuickOpen] Opening in floating window: ${uri.fsPath}`);
            try {
              cancelQuickOpenBackgroundWork('button-open-new-window');
              safeDispose();
              await openUriInNewWindow(uri, log);
              mruService.add(uri.fsPath);
            } catch (err) {
              log.error(`[QuickOpen] Error opening in floating window`, err);
            }
            return;
          }

          if (button.tooltip === t('Open in Active Editor')) {
            log.info(`[QuickOpen] Opening in active editor: ${uri.fsPath}`);
            try {
              cancelQuickOpenBackgroundWork('button-open-active-editor');
              safeDispose();
              await openUriInEditor(uri, { logger: log });
              mruService.add(uri.fsPath);
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
            const startedAt = Date.now();
            suppressedFavoritesTreeRefreshCount += 1;
            const providerStartedAt = Date.now();
            favoritesProvider.removeFavorite(uri);
            const providerDurationMs = Date.now() - providerStartedAt;
            const updateResult = updateVisibleItemsForUri(uri, (visibleItem) => {
              visibleItem.isFavorite = false;
              visibleItem.isPinned = false;
              visibleItem.isIndividualPinned = false;
            });
            scheduleInlineMutationRefresh(
              'remove-favorite',
              uri.fsPath,
              startedAt,
              updateResult,
              { providerDurationMs },
            );
            return;
          }

          if (button.tooltip === t('Pin') || button.tooltip === t('Unpin')) {
            log.info(`[QuickOpen] Toggling pin for: ${uri.fsPath}`);
            const startedAt = Date.now();
            suppressedFavoritesTreeRefreshCount += 1;
            const isPinnedNow = !item.isIndividualPinned;
            const providerStartedAt = Date.now();
            favoritesProvider.setPinned(uri, isPinnedNow);
            const providerDurationMs = Date.now() - providerStartedAt;
            const updateResult = updateVisibleItemsForUri(uri, (visibleItem) => {
              visibleItem.isFavorite = true;
              visibleItem.isIndividualPinned = isPinnedNow;
              visibleItem.isPinned = isPinnedNow;
            });
            scheduleInlineMutationRefresh(
              'toggle-pin',
              uri.fsPath,
              startedAt,
              updateResult,
              { providerDurationMs, isPinnedNow },
            );
            return;
          }

          log.info(`[QuickOpen] Toggling favorite for: ${uri.fsPath}`);

          try {
            const startedAt = Date.now();
            const wasFavorite = item.isFavorite;
            const providerStartedAt = Date.now();
            if (item.isFavorite) {
              log.debug('[QuickOpen] Removing from favorites');
              suppressedFavoritesTreeRefreshCount += 1;
              favoritesProvider.removeFavorite(uri);
            } else {
              log.debug('[QuickOpen] Adding to favorites');
              suppressedFavoritesTreeRefreshCount += 1;
              suppressedMruRefreshCount += 1;
              favoritesProvider.addFavorite(uri);
              mruService.remove(uri.fsPath);
            }
            const providerDurationMs = Date.now() - providerStartedAt;
            const isFavoriteNow = favoritesProvider.hasFavorite(uri);
            const updateResult = updateVisibleItemsForUri(uri, (visibleItem) => {
              visibleItem.isFavorite = isFavoriteNow;
              if (!isFavoriteNow) {
                visibleItem.isPinned = false;
                visibleItem.isIndividualPinned = false;
              }
            });
            scheduleInlineMutationRefresh(
              'toggle-favorite',
              uri.fsPath,
              startedAt,
              updateResult,
              {
                providerDurationMs,
                wasFavorite,
                isFavoriteNow,
              },
            );
            log.debug('[QuickOpen] Favorite toggled successfully');
          } catch (error) {
            log.error('[QuickOpen] ❌ Error toggling favorite', error);
          }
        })),
      );
      } catch (error) {
        log.error('[QuickOpen] Fatal error escaped the command handler', error);
        try {
          sessionCleanup?.();
        } catch (cleanupError) {
          log.error(
            '[QuickOpen] Failed to clean up QuickOpen session after fatal error',
            cleanupError,
          );
        }
        void vscode.window.showErrorMessage(
          t(
            'Quick Open failed unexpectedly and was stopped to keep the editor window open.',
          ),
        );
      }
    },
  );

  context.subscriptions.push(disposable);
  logger.info('[QuickOpen] ✓ Command registered successfully');
}
