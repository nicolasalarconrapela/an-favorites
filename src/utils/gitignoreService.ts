import ignore, { type Ignore } from 'ignore';
import * as path from 'path';
import * as vscode from 'vscode';
import { startLoggedAction } from '../logging/loggingModule';
import { Logger } from '../logging/logger';
import { t } from '../utils/l10n';

const INTERNAL_FILES_STATE_KEY = 'anfavorites.gitignore.filesState';
const GITIGNORE_DISCOVERY_LIMIT = 4000;
const GITIGNORE_DISCOVERY_DEFAULT_EXCLUSIONS = [
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/vendor/**',
  '**/bin/**',
  '**/obj/**',
];

function getGitignoreFilesSettings(): Record<string, boolean> {
  return { ..._gitignoreFilesState };
}

async function updateGitignoreFilesSettings(
  paths: Record<string, boolean>,
): Promise<void> {
  _gitignoreFilesState = { ...paths };
  if (!_context) {
    return;
  }

  try {
    await _context.workspaceState.update(INTERNAL_FILES_STATE_KEY, {
      ..._gitignoreFilesState,
    });
  } catch {
    // Ignore workspaceState persistence errors and keep the in-memory state.
  }
}

async function syncGitignoreFilesToSettings(
  discoveredOverride?: vscode.Uri[],
  token?: vscode.CancellationToken,
): Promise<boolean> {
  const settings = getGitignoreFilesSettings();
  let changed = false;
  _logger?.debug?.('[gitignore] sync starting');

  const discovered = discoveredOverride ?? (await discoverGitignoreFiles(token));
  _logger?.debug?.(`[gitignore] discovered ${discovered.length} files`);
  const discoveredRelPaths = new Set(discovered.map((uri) => gitignoreRelPath(uri)));

  // 1. Add new discovered files
  for (const uri of discovered) {
    const rel = gitignoreRelPath(uri);
    if (!(rel in settings)) {
      settings[rel] = true;
      changed = true;
    }
  }

  // 2. Cleanup settings based on current discovery
  for (const rel of Object.keys(settings)) {
    if (!discoveredRelPaths.has(rel)) {
      delete settings[rel];
      changed = true;
    }
  }

  if (changed) {
    await updateGitignoreFilesSettings(settings);
    return true;
  }
  return false;
}

/** Returns the path used to identify/persist a gitignore Uri (relative to workspace). */
export function gitignoreRelPath(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, true);
}

// ---------------------------------------------------------------------------
// Parse helpers
// ---------------------------------------------------------------------------

function gitignoreLineToGlobs(line: string, dir: string): string[] {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return [];
  if (trimmed.startsWith('!')) return [];

  const raw = trimmed.startsWith('\\') ? trimmed.slice(1) : trimmed;
  const prefix = dir && dir !== '.' ? `${dir}/` : '';

  const isDirOnly = raw.endsWith('/');
  const patternBody = isDirOnly ? raw.slice(0, -1) : raw;

  if (patternBody.startsWith('/')) {
    const cleanRel = patternBody.slice(1);
    if (isDirOnly) return [`${prefix}${cleanRel}/**`];
    return [`${prefix}${cleanRel}`, `${prefix}${cleanRel}/**`];
  }

  if (patternBody.includes('**')) {
    const p = `${prefix}${patternBody}`;
    return isDirOnly ? [p + '/**'] : [p, p + '/**'];
  }

  const hasMultipleSlashes = patternBody.includes('/');

  if (hasMultipleSlashes) {
    if (isDirOnly) return [`${prefix}${patternBody}/**`];
    return [`${prefix}${patternBody}`, `${prefix}${patternBody}/**`];
  } else {
    // Matches anywhere inside prefix
    if (isDirOnly) return [`${prefix}**/${patternBody}/**`];
    return [`${prefix}**/${patternBody}`, `${prefix}**/${patternBody}/**`];
  }
}

async function parseGitignoreFile(
  uri: vscode.Uri,
  token?: vscode.CancellationToken,
): Promise<string[]> {
  return (await readParsedGitignoreFile(uri, token)).patterns;
}

async function readGitignoreLines(
  uri: vscode.Uri,
  token?: vscode.CancellationToken,
): Promise<string[]> {
  return (await readParsedGitignoreFile(uri, token)).lines;
}

async function readParsedGitignoreFile(
  uri: vscode.Uri,
  token?: vscode.CancellationToken,
): Promise<{ lines: string[]; patterns: string[] }> {
  if (token?.isCancellationRequested) {
    return { lines: [], patterns: [] };
  }

  let relFile = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(relFile) || relFile.startsWith('/')) {
    relFile = '';
  }
  const dir = relFile.includes('/')
    ? relFile.substring(0, relFile.lastIndexOf('/'))
    : '';

  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const lines = Buffer.from(bytes)
      .toString('utf8')
      .split(/\r?\n/);
    const seen = new Set<string>();
    const patterns: string[] = [];
    for (const line of lines) {
      for (const glob of gitignoreLineToGlobs(line, dir)) {
        if (seen.has(glob)) {
          continue;
        }
        seen.add(glob);
        patterns.push(glob);
      }
    }
    return { lines, patterns };
  } catch {
    return { lines: [], patterns: [] };
  }
}

function workspaceRelativePathParts(uri: vscode.Uri): {
  folder: vscode.WorkspaceFolder | null;
  relativePath: string;
} {
  const folder = vscode.workspace.getWorkspaceFolder(uri) ?? null;
  if (!folder) {
    return { folder: null, relativePath: '' };
  }

  return {
    folder,
    relativePath: path
      .relative(folder.uri.fsPath, uri.fsPath)
      .replace(/\\/g, '/'),
  };
}

function isPathUnderBase(relativePath: string, baseDir: string): boolean {
  if (!baseDir) {
    return true;
  }

  return relativePath === baseDir || relativePath.startsWith(`${baseDir}/`);
}

function toMatcherRelativePath(relativePath: string, baseDir: string): string {
  if (!baseDir) {
    return relativePath;
  }

  if (relativePath === baseDir) {
    return '';
  }

  return relativePath.startsWith(`${baseDir}/`)
    ? relativePath.slice(baseDir.length + 1)
    : relativePath;
}

async function buildGitignoreMatchers(
  discovered: vscode.Uri[],
  settings: Record<string, boolean>,
  token?: vscode.CancellationToken,
): Promise<{ matchers: GitignoreMatcher[]; patternsByRel: Map<string, string[]> }> {
  const matchers: GitignoreMatcher[] = [];
  const patternsByRel = new Map<string, string[]>();

  for (const uri of discovered) {
    if (token?.isCancellationRequested) break;

    const rel = gitignoreRelPath(uri);
    if (settings[rel] === false) {
      continue;
    }

    const { relativePath } = workspaceRelativePathParts(uri);
    const baseDir = relativePath.includes('/')
      ? relativePath.substring(0, relativePath.lastIndexOf('/'))
      : '';
    const parsed = await readParsedGitignoreFile(uri, token);
    patternsByRel.set(rel, parsed.patterns);
    matchers.push({
      baseDir,
      matcher: ignore().add(parsed.lines),
    });
  }

  return {
    matchers: matchers.sort((left, right) => left.baseDir.length - right.baseDir.length),
    patternsByRel,
  };
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface GitignoreCache {
  folderKey: string;
  discovered: vscode.Uri[];
  patterns: string[];
  signature: string;
  matchers: GitignoreMatcher[];
}

interface MergedExclusionsCache {
  userSignature: string;
  gitignoreSignature: string;
  merged: string[];
}

interface GitignoreMatcher {
  baseDir: string;
  matcher: Ignore;
}

let _logger: Logger | null = null;
let _context: vscode.ExtensionContext | null = null;
let _cache: GitignoreCache | null = null;
let _gitignoredPathCache = new Map<string, boolean>();
let _watcher: vscode.FileSystemWatcher | null = null;
let _folderListener: vscode.Disposable | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _onDiscoveryChange = new Set<() => void>();
let _gitignoreFilesState: Record<string, boolean> = {};
let _mergedExclusionsCache: MergedExclusionsCache | null = null;
let _discoveryPromise: Promise<vscode.Uri[]> | null = null;
let _patternsPromise: Promise<string[]> | null = null;

function emitDiscoveryChange(): void {
  for (const cb of _onDiscoveryChange) {
    try {
      cb();
    } catch (error) {
      _logger?.warn?.('[gitignore] discovery listener failed', { error });
    }
  }
}

function currentFolderKey(): string {
  return (vscode.workspace.workspaceFolders ?? [])
    .map((f) => f.uri.fsPath)
    .sort()
    .join('|');
}

function workspaceScanStateKey(): string {
  const folderKey = currentFolderKey();
  return folderKey
    ? `hasScannedGitignore:${folderKey}`
    : 'hasScannedGitignore:no-workspace';
}

function buildPatternsSignature(patterns: string[]): string {
  return [...patterns].sort().join('|');
}

function buildGitignoreDiscoveryExcludeGlob(
  userExclusions: string[],
): string | undefined {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const pattern of [
    ...GITIGNORE_DISCOVERY_DEFAULT_EXCLUSIONS,
    ...userExclusions,
  ]) {
    const normalized = pattern.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    merged.push(normalized);
  }

  if (merged.length === 0) {
    return undefined;
  }
  if (merged.length === 1) {
    return merged[0];
  }
  return `{${merged.join(',')}}`;
}

function invalidateCache(
  showProgress: boolean = false,
  reason: string = 'unknown',
): void {
  _logger?.info?.(`[gitignore] cache invalidated (${reason})`);
  _cache = null;
  _discoveryPromise = null;
  _patternsPromise = null;
  _gitignoredPathCache.clear();
  _mergedExclusionsCache = null;
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;

    if (showProgress) {
      void vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: t('Scanning workspace for .gitignore files...'),
          cancellable: false,
        },
        async () => {
          // Perform the actual work
          try {
            await syncGitignoreFilesToSettings();
            emitDiscoveryChange();
          } catch (error) {
            _logger?.error?.('[gitignore] cache refresh crashed (progress)', {
              reason,
              error,
            });
          }
        },
      );
    } else {
      void syncGitignoreFilesToSettings()
        .then(() => {
          emitDiscoveryChange();
        })
        .catch((error) => {
          _logger?.error?.('[gitignore] cache refresh crashed', {
            reason,
            error,
          });
        });
    }
  }, 400);
}

function ensureWatcher(logger?: Logger): void {
  if (_watcher) return;

  _watcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
  _watcher.onDidChange(() => {
    logger?.debug?.('[gitignore] .gitignore changed');
    invalidateCache(false, 'gitignore-changed');
  });
  _watcher.onDidCreate(() => {
    logger?.debug?.('[gitignore] .gitignore created');
    invalidateCache(false, 'gitignore-created');
  });
  _watcher.onDidDelete(() => {
    logger?.debug?.('[gitignore] .gitignore deleted');
    invalidateCache(false, 'gitignore-deleted');
  });

  _folderListener = vscode.workspace.onDidChangeWorkspaceFolders(() =>
    invalidateCache(false, 'workspace-folders-changed'),
  );
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Finds all .gitignore files in the workspace, including workspace roots and subdirectories.
 */
export async function discoverGitignoreFiles(
  token?: vscode.CancellationToken,
): Promise<vscode.Uri[]> {
  if (!token?.isCancellationRequested && _discoveryPromise) {
    _logger?.debug?.('[gitignore] discovery promise hit');
    return _discoveryPromise;
  }

  const discoveryPromise = (async (): Promise<vscode.Uri[]> => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    const startedAt = Date.now();
    const byPath = new Map<string, vscode.Uri>();
    const folderNames = folders.map((f) => f.name).join(', ');
    _logger?.debug?.(
      `[gitignore] discoverGitignoreFiles: scanning ${folderNames} folders`,
    );

    const configSearch = vscode.workspace.getConfiguration('anfavorites.search');
    const globalExclusions = configSearch.get<string[]>('exclusions', []);
    const excludeGlob = buildGitignoreDiscoveryExcludeGlob(globalExclusions);

    _logger?.debug?.('[gitignore] discoverGitignoreFiles: global scan started', {
      folderCount: folders.length,
      excludeGlob,
      userExclusionCount: globalExclusions.length,
      discoveryLimit: GITIGNORE_DISCOVERY_LIMIT,
    });

    const [rootChecks, found] = await Promise.all([
      Promise.all(
        folders.map(async (folder) => {
          const rootGitignoreUri = vscode.Uri.joinPath(folder.uri, '.gitignore');
          try {
            await vscode.workspace.fs.stat(rootGitignoreUri);
            return rootGitignoreUri;
          } catch {
            return null;
          }
        }),
      ),
      vscode.workspace.findFiles(
        '**/.gitignore',
        excludeGlob,
        GITIGNORE_DISCOVERY_LIMIT,
        token,
      ),
    ]);

    for (const uri of rootChecks) {
      if (uri) {
        byPath.set(uri.fsPath.toLowerCase(), uri);
      }
    }
    for (const uri of found) {
      byPath.set(uri.fsPath.toLowerCase(), uri);
    }

    const uris = Array.from(byPath.values()).sort((a, b) =>
      gitignoreRelPath(a).localeCompare(gitignoreRelPath(b)),
    );
    _logger?.info?.(
      `[gitignore] discovery completed. folders=${folders.length} files=${uris.length} durationMs=${Date.now() - startedAt}`,
      {
        folderCount: folders.length,
        discoveredCount: uris.length,
        durationMs: Date.now() - startedAt,
        excludeGlob,
        discoveryLimit: GITIGNORE_DISCOVERY_LIMIT,
      },
    );
    return uris;
  })();

  if (!token?.isCancellationRequested) {
    _discoveryPromise = discoveryPromise;
  }

  try {
    return await discoveryPromise;
  } finally {
    if (_discoveryPromise === discoveryPromise) {
      _discoveryPromise = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Patterns (used by search / collision index)
// ---------------------------------------------------------------------------

/**
 * Returns the merged glob patterns from all ENABLED .gitignore files.
 * Results are cached and invalidated when any .gitignore changes.
 */
export async function getGitignorePatterns(
  tokenOrDiscovered?: vscode.CancellationToken | vscode.Uri[],
  maybeDiscovered?: vscode.Uri[],
): Promise<string[]> {
  if (!Array.isArray(tokenOrDiscovered) && !maybeDiscovered && _patternsPromise) {
    _logger?.debug?.('[gitignore] patterns promise hit');
    return _patternsPromise;
  }

  const computePatterns = async (): Promise<string[]> => {
  const token = Array.isArray(tokenOrDiscovered) ? undefined : tokenOrDiscovered;
  const discoveredOverride = Array.isArray(tokenOrDiscovered)
    ? tokenOrDiscovered
    : maybeDiscovered;
  const folderKey = currentFolderKey();
  if (_cache && _cache.folderKey === folderKey) {
    _logger?.debug?.(
      `[gitignore] patterns cache hit. files=${_cache.discovered.length} patterns=${_cache.patterns.length}`,
    );
    return [..._cache.patterns];
  }

  const settings = getGitignoreFilesSettings();
  const discovered = discoveredOverride ?? (await discoverGitignoreFiles(token));
  const allPatterns: string[] = [];
  const seenPatterns = new Set<string>();
  const { matchers, patternsByRel } = await buildGitignoreMatchers(
    discovered,
    settings,
    token,
  );

  for (const uri of discovered) {
    if (token?.isCancellationRequested) break;
    const rel = gitignoreRelPath(uri);

    // Explicitly check for === false to skip disabled files
    if (settings[rel] === false) continue;

    const filePatterns = patternsByRel.get(rel) ?? [];
    for (const p of filePatterns) {
      if (seenPatterns.has(p)) continue;
      seenPatterns.add(p);
      allPatterns.push(p);
    }
  }

  const signature = buildPatternsSignature(allPatterns);
  _gitignoredPathCache.clear();
  _cache = {
    folderKey,
    discovered: [...discovered],
    patterns: [...allPatterns],
    signature,
    matchers,
  };
  _logger?.info?.(
    `[gitignore] patterns cache refreshed. files=${discovered.length} patterns=${allPatterns.length}`,
  );
  return [...allPatterns];
  };

  const promise = computePatterns();
  if (!Array.isArray(tokenOrDiscovered) && !maybeDiscovered) {
    _patternsPromise = promise;
  }

  try {
    return await promise;
  } finally {
    if (_patternsPromise === promise) {
      _patternsPromise = null;
    }
  }
}

export async function getGitignoreSignature(
  token?: vscode.CancellationToken,
): Promise<string> {
  if (_cache?.signature) {
    return _cache.signature;
  }
  if (_patternsPromise) {
    _logger?.debug?.(
      '[gitignore] signature requested while patterns warmup is in progress; returning current empty signature',
    );
    return '';
  }
  if (!_cache) {
    await getGitignorePatterns(token);
  }

  return _cache?.signature ?? '';
}

export function isGitignoreCacheReady(): boolean {
  return _cache !== null;
}

export async function isGitignored(
  uri: vscode.Uri,
  token?: vscode.CancellationToken,
): Promise<boolean> {
  return isGitignoredFast(uri) ?? (await isGitignoredSlow(uri, token));
}

function buildGitignoredCacheKey(
  signature: string,
  fsPath: string,
): string {
  return `${signature}::${fsPath.toLowerCase()}`;
}

function isGitignoredFast(uri: vscode.Uri): boolean | null {
  if (uri.scheme !== 'file') {
    return false;
  }

  const { folder, relativePath } = workspaceRelativePathParts(uri);
  if (!folder || !relativePath) {
    return false;
  }

  const cache = _cache;
  if (!cache) return null;

  const cacheKey = buildGitignoredCacheKey(cache.signature, uri.fsPath);
  const memoized = _gitignoredPathCache.get(cacheKey);
  if (memoized !== undefined) {
    return memoized;
  }

  let ignored = false;
  for (const entry of cache.matchers) {
    if (!isPathUnderBase(relativePath, entry.baseDir)) {
      continue;
    }

    const candidatePath = toMatcherRelativePath(relativePath, entry.baseDir);
    if (!candidatePath) {
      continue;
    }

    const result = entry.matcher.test(candidatePath);
    if (result.unignored) {
      ignored = false;
      continue;
    }
    if (result.ignored) {
      ignored = true;
    }
  }

  _gitignoredPathCache.set(cacheKey, ignored);
  return ignored;
}

async function isGitignoredSlow(
  uri: vscode.Uri,
  token?: vscode.CancellationToken,
): Promise<boolean> {
  if (!_cache) {
    await getGitignorePatterns(token);
  }

  return isGitignoredFast(uri) ?? false;
}

export function filterGitignoredUrisFast(uris: vscode.Uri[]): vscode.Uri[] | null {
  if (!_cache) {
    return null;
  }

  const accepted: vscode.Uri[] = [];
  for (const uri of uris) {
    const ignored = isGitignoredFast(uri);
    if (ignored !== true) {
      accepted.push(uri);
    }
  }
  return accepted;
}

export async function filterGitignoredUris(
  uris: vscode.Uri[],
  token?: vscode.CancellationToken,
): Promise<vscode.Uri[]> {
  const fastAccepted = filterGitignoredUrisFast(uris);
  if (fastAccepted) {
    return fastAccepted;
  }

  const accepted: vscode.Uri[] = [];
  for (const uri of uris) {
    if (token?.isCancellationRequested) {
      break;
    }
    if (!(await isGitignored(uri, token))) {
      accepted.push(uri);
    }
  }
  return accepted;
}

/**
 * Returns user exclusions merged with gitignore exclusions.
 * The gitignore exclusions are kept independent from the user list.
 */
export async function getMergedExclusions(
  userExclusions: string[],
  token?: vscode.CancellationToken,
): Promise<string[]> {
  const gitignorePatterns = await getGitignorePatterns(token);
  const userSignature = buildPatternsSignature(userExclusions);
  const gitignoreSignature = _cache?.signature ?? buildPatternsSignature(gitignorePatterns);

  if (
    _mergedExclusionsCache &&
    _mergedExclusionsCache.userSignature === userSignature &&
    _mergedExclusionsCache.gitignoreSignature === gitignoreSignature
  ) {
    _logger?.debug?.(
      `[gitignore] merged exclusions cache hit. total=${_mergedExclusionsCache.merged.length}`,
    );
    return [..._mergedExclusionsCache.merged];
  }

  const seen = new Set<string>(userExclusions);
  const merged = [...userExclusions];
  for (const p of gitignorePatterns) {
    if (!seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }
  _mergedExclusionsCache = {
    userSignature,
    gitignoreSignature,
    merged: [...merged],
  };
  _logger?.info?.(
    `[gitignore] merged exclusions cache refreshed. user=${userExclusions.length} gitignore=${gitignorePatterns.length} merged=${merged.length}`,
  );
  return merged;
}

export function buildExclusionGlobFromPatterns(
  patterns: string[],
): string | undefined {
  if (patterns.length === 0) return undefined;
  if (patterns.length === 1) return patterns[0];
  return `{${patterns.join(',')}}`;
}

// ---------------------------------------------------------------------------
// Per-file enable / disable
// ---------------------------------------------------------------------------

export async function setGitignoreFileEnabled(
  uri: vscode.Uri,
  enabled: boolean,
): Promise<void> {
  const settings = getGitignoreFilesSettings();
  const rel = gitignoreRelPath(uri);

  if (settings[rel] === enabled) return;
  settings[rel] = enabled;

  await updateGitignoreFilesSettings(settings);
  invalidateCache(false, 'gitignore-file-enabled-changed'); // force re-read on next search
}

export async function setGitignoreFilesEnabled(
  uris: vscode.Uri[],
  enabled: boolean,
): Promise<void> {
  const settings = getGitignoreFilesSettings();

  for (const uri of uris) {
    settings[gitignoreRelPath(uri)] = enabled;
  }

  await updateGitignoreFilesSettings(settings);
  invalidateCache(false, 'gitignore-files-enabled-changed');
}

export function isGitignoreFileEnabled(uri: vscode.Uri): boolean {
  const settings = getGitignoreFilesSettings();
  const rel = gitignoreRelPath(uri);
  return settings[rel] !== false;
}

// ---------------------------------------------------------------------------
// Init / Dispose
// ---------------------------------------------------------------------------

/**
 * Callback invoked whenever the list of discovered .gitignore files changes
 * (file created, deleted, or workspace folders changed).
 */
export function onGitignoreDiscoveryChange(cb: () => void): void {
  _onDiscoveryChange.add(cb);
}

export function subscribeGitignoreDiscoveryChange(
  cb: () => void,
): vscode.Disposable {
  _onDiscoveryChange.add(cb);
  return new vscode.Disposable(() => {
    _onDiscoveryChange.delete(cb);
  });
}

export async function initGitignoreSync(
  context: vscode.ExtensionContext,
  logger?: Logger,
): Promise<void> {
  _context = context;
  _logger = logger;
  _gitignoreFilesState =
    context.workspaceState.get<Record<string, boolean>>(
      INTERNAL_FILES_STATE_KEY,
      {},
    ) ?? {};
  ensureWatcher(logger);
  const hasWorkspaceFolders =
    (vscode.workspace.workspaceFolders ?? []).length > 0;

  // Use workspaceState to ensure we only show the "Scanning..." progress
  // the very first time we open this workspace.
  const hasScanned = context.workspaceState.get<boolean>(
    workspaceScanStateKey(),
    false,
  );
  const isFirstRun = hasWorkspaceFolders && !hasScanned;
  logger?.info?.(
    `[gitignore] init requested. folders=${(vscode.workspace.workspaceFolders ?? []).length} firstRun=${isFirstRun}`,
  );
  const initTrace = logger ? startLoggedAction(logger, 'sincronizacion gitignore') : null;

  const doSync = async (): Promise<void> => {
    try {
      logger?.debug?.('[gitignore] initial sync starting');
      initTrace?.step('marcando workspace como escaneado');
      // Record that we have completed the initial scan for this workspace
      await context.workspaceState.update(workspaceScanStateKey(), true);

      initTrace?.step('descubriendo archivos gitignore');
      const discovered = await discoverGitignoreFiles();

      initTrace?.step('sincronizando archivos gitignore detectados');
      const didUpdate = await syncGitignoreFilesToSettings(discovered);

      if (didUpdate) {
        // If we updated settings, we must await the VS Code config event propagation
        // to avoid the event listener wiping our freshly warmed cache.
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Warm up the cache by doing an initial scan/parse
      initTrace?.step('calentando cache de patrones');
      await getGitignorePatterns(discovered);
      logger?.info?.('[gitignore] service started, cache warmed and watcher active');
      initTrace?.success();
    } catch (error) {
      initTrace?.fail(error);
      throw error;
    }
  };

  if (isFirstRun) {
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: t('Scanning workspace for .gitignore files...'),
      },
      async () => {
        await doSync();
      },
    );
  } else {
    await doSync();
  }
}

export function disposeGitignoreService(): void {
  if (_debounceTimer) {
    clearTimeout(_debounceTimer);
    _debounceTimer = null;
  }
  _watcher?.dispose();
  _watcher = null;
  _folderListener?.dispose();
  _folderListener = null;
  _cache = null;
  _discoveryPromise = null;
  _patternsPromise = null;
  _gitignoredPathCache.clear();
  _mergedExclusionsCache = null;
  _onDiscoveryChange.clear();
}
