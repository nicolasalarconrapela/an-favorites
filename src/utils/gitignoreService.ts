import * as vscode from 'vscode';
import { t } from '../utils/l10n';

const INTERNAL_FILES_STATE_KEY = 'anfavorites.gitignore.filesState';

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
  token?: vscode.CancellationToken,
): Promise<boolean> {
  const settings = getGitignoreFilesSettings();
  let changed = false;
  _logger?.debug?.('[gitignore] sync starting');

  const discovered = await discoverGitignoreFiles(token);
  _logger?.debug?.(`[gitignore] discovered ${discovered.length} files`);

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
    // Remove files that no longer exist on disk
    const exists = discovered.some((d) => gitignoreRelPath(d) === rel);
    if (!exists) {
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
  if (token?.isCancellationRequested) return [];

  let relFile = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
  // If it's outside the workspace, ignore the relative path mapping
  if (/^[a-zA-Z]:/.test(relFile) || relFile.startsWith('/')) {
    relFile = '';
  }
  const dir = relFile.includes('/')
    ? relFile.substring(0, relFile.lastIndexOf('/'))
    : '';

  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const text = Buffer.from(bytes).toString('utf8');
    const patterns: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      for (const g of gitignoreLineToGlobs(line, dir)) {
        if (!patterns.includes(g)) patterns.push(g);
      }
    }
    return patterns;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

interface GitignoreCache {
  folderKey: string;
  discovered: vscode.Uri[];
  patterns: string[];
}

let _logger: any | null = null;
let _context: vscode.ExtensionContext | null = null;
let _cache: GitignoreCache | null = null;
let _watcher: vscode.FileSystemWatcher | null = null;
let _folderListener: vscode.Disposable | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _onDiscoveryChange: (() => void) | undefined;
let _gitignoreFilesState: Record<string, boolean> = {};

function currentFolderKey(): string {
  return (vscode.workspace.workspaceFolders ?? [])
    .map((f) => f.uri.fsPath)
    .sort()
    .join('|');
}

function invalidateCache(showProgress: boolean = false): void {
  _cache = null;
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
          await syncGitignoreFilesToSettings();
          _onDiscoveryChange?.();

        },
      );
    } else {
      void syncGitignoreFilesToSettings().then(() => {
        _onDiscoveryChange?.();
      });
    }
  }, 400);
}

function ensureWatcher(logger?: any): void {
  if (_watcher) return;

  _watcher = vscode.workspace.createFileSystemWatcher('**/.gitignore');
  _watcher.onDidChange(() => {
    logger?.debug?.('[gitignore] .gitignore changed');
    invalidateCache();
  });
  _watcher.onDidCreate(() => {
    logger?.debug?.('[gitignore] .gitignore created');
    invalidateCache();
  });
  _watcher.onDidDelete(() => {
    logger?.debug?.('[gitignore] .gitignore deleted');
    invalidateCache();
  });

  _folderListener = vscode.workspace.onDidChangeWorkspaceFolders(() =>
    invalidateCache(),
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
  const folders = vscode.workspace.workspaceFolders ?? [];
  const uris: vscode.Uri[] = [];
  const folderNames = folders.map((f) => f.name).join(', ');
  _logger?.debug?.(
    `[gitignore] discoverGitignoreFiles: scanning ${folderNames} folders`,
  );

  const configSearch = vscode.workspace.getConfiguration('anfavorites.search');
  const globalExclusions = configSearch.get<string[]>('exclusions', []);

  for (const folder of folders) {
    if (token?.isCancellationRequested) break;

    const excludePatterns = [...globalExclusions];
    const rootGitignoreUri = vscode.Uri.joinPath(folder.uri, '.gitignore');
    _logger?.debug?.(`[gitignore] Checking root file: ${rootGitignoreUri.fsPath}`);

    try {
      await vscode.workspace.fs.stat(rootGitignoreUri);
      if (!uris.some((u) => u.fsPath === rootGitignoreUri.fsPath)) {
        uris.push(rootGitignoreUri);
      }
      _logger?.debug?.(`[gitignore] Root file exists: ${rootGitignoreUri.fsPath}`);
    } catch {
      _logger?.debug?.(`[gitignore] Root file NOT found: ${rootGitignoreUri.fsPath}`);
    }

    const rootPatterns = await parseGitignoreFile(rootGitignoreUri, token);
    for (const p of rootPatterns) {
      if (!excludePatterns.includes(p)) excludePatterns.push(p);
    }

    let excludeGlob: string | undefined;
    if (excludePatterns.length === 1) excludeGlob = excludePatterns[0];
    else if (excludePatterns.length > 1)
      excludeGlob = `{${excludePatterns.join(',')}}`;

    _logger?.debug?.(
      `[gitignore] Scanning folder ${folder.name} recursively. Excludes: ${excludeGlob}`,
    );

    const found = await vscode.workspace.findFiles(
      new vscode.RelativePattern(folder, '**/.gitignore'),
      excludeGlob,
      5000,
      token,
    );

    _logger?.debug?.(`[gitignore] Found in ${folder.name}: ${found.length} files`);

    for (const uri of found) {
      if (!uris.some((u) => u.fsPath === uri.fsPath)) {
        uris.push(uri);
      }
    }
  }

  return uris.sort((a, b) =>
    gitignoreRelPath(a).localeCompare(gitignoreRelPath(b)),
  );
}

// ---------------------------------------------------------------------------
// Patterns (used by search / collision index)
// ---------------------------------------------------------------------------

/**
 * Returns the merged glob patterns from all ENABLED .gitignore files.
 * Results are cached and invalidated when any .gitignore changes.
 */
export async function getGitignorePatterns(
  token?: vscode.CancellationToken,
): Promise<string[]> {
  const folderKey = currentFolderKey();
  if (_cache && _cache.folderKey === folderKey) {
    return _cache.patterns;
  }

  const settings = getGitignoreFilesSettings();
  const discovered = await discoverGitignoreFiles(token);
  const allPatterns: string[] = [];

  for (const uri of discovered) {
    if (token?.isCancellationRequested) break;
    const rel = gitignoreRelPath(uri);

    // Explicitly check for === false to skip disabled files
    if (settings[rel] === false) continue;

    const filePatterns = await parseGitignoreFile(uri, token);
    for (const p of filePatterns) {
      if (!allPatterns.includes(p)) allPatterns.push(p);
    }
  }

  _cache = { folderKey, discovered, patterns: allPatterns };
  return allPatterns;
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
  const seen = new Set<string>(userExclusions);
  const merged = [...userExclusions];
  for (const p of gitignorePatterns) {
    if (!seen.has(p)) {
      seen.add(p);
      merged.push(p);
    }
  }
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
  invalidateCache(); // force re-read on next search
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
  invalidateCache();
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
  _onDiscoveryChange = cb;
}

export async function initGitignoreSync(
  context: vscode.ExtensionContext,
  logger?: any,
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
    'hasScannedGitignore',
    false,
  );
  const isFirstRun = hasWorkspaceFolders && !hasScanned;

  const doSync = async (): Promise<void> => {
    // Record that we have completed the initial scan for this workspace
    await context.workspaceState.update('hasScannedGitignore', true);

    const didUpdate = await syncGitignoreFilesToSettings();

    if (didUpdate) {
      // If we updated settings, we must await the VS Code config event propagation
      // to avoid the event listener wiping our freshly warmed cache.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    // Warm up the cache by doing an initial scan/parse
    await getGitignorePatterns();
    logger?.info?.(
      '[gitignore] Service started — scanning and watching for .gitignore changes',
    );
  };

  if (isFirstRun) {
    void vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: t('Scanning workspace for .gitignore files...'),
      },
      async () => {
        await doSync();
        // Keep progress visible for a short moment to ensure the user notices it
        await new Promise((resolve) => setTimeout(resolve, 2000));
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
  _onDiscoveryChange = undefined;
}
