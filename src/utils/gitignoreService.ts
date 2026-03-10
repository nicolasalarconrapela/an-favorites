import * as vscode from 'vscode';
import { t } from '../utils/l10n';

const GITIGNORE_CFG = 'anfavorites.gitignore';
const FILES_PROP = 'files';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getGitignoreConfig(): { enabled: boolean; includeNested: boolean } {
  const cfg = vscode.workspace.getConfiguration(GITIGNORE_CFG);
  const inspectEnabled = cfg.inspect<boolean>('enabled');
  const inspectNested = cfg.inspect<boolean>('includeNested');

  // We explicitly ignore global (user) values for these settings
  // because the user wants this to be a workspace-only feature.
  const enabled =
    inspectEnabled?.workspaceFolderValue ??
    inspectEnabled?.workspaceValue ??
    false;
  const includeNested =
    inspectNested?.workspaceFolderValue ??
    inspectNested?.workspaceValue ??
    false;

  return { enabled, includeNested };
}

function getGitignoreFilesSettings(): Record<string, boolean> {
  const cfg = vscode.workspace.getConfiguration(GITIGNORE_CFG);
  const inspect = cfg.inspect<Record<string, boolean>>(FILES_PROP);
  // We strictly use workspace-level settings because files are local to the repo
  const val = inspect?.workspaceFolderValue ?? inspect?.workspaceValue ?? {};
  return { ...val };
}

async function updateGitignoreFilesSettings(
  paths: Record<string, boolean>,
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration(GITIGNORE_CFG);
  try {
    await cfg.update(FILES_PROP, paths, vscode.ConfigurationTarget.Workspace);
  } catch {
    // Intentionally ignore. Storing workspace file paths globally (User settings)
    // is an anti-pattern as they would pollute other unrelated projects.
  }
}

async function syncGitignoreFilesToSettings(
  token?: vscode.CancellationToken,
): Promise<boolean> {
  const { enabled, includeNested } = getGitignoreConfig();
  const settings = getGitignoreFilesSettings();
  let changed = false;

  if (!enabled) {
    if (Object.keys(settings).length > 0) {
      await updateGitignoreFilesSettings({});
      return true;
    }
    return false;
  }

  _logger?.debug?.(
    `[gitignore] sync starting. enabled=${enabled}, includeNested=${includeNested}`,
  );

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

  // 2. Cleanup settings based on current discovery and nesting rules
  for (const rel of Object.keys(settings)) {
    const normalizedRel = rel.replace(/\\/g, '/');
    const isRoot =
      normalizedRel === '.gitignore' ||
      /^[^/]+\/\.gitignore$/.test(normalizedRel);

    // If includeNested is false, remove anything that isn't a workspace-root .gitignore
    if (!includeNested && !isRoot) {
      delete settings[rel];
      changed = true;
      continue;
    }

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
let _cache: GitignoreCache | null = null;
let _watcher: vscode.FileSystemWatcher | null = null;
let _folderListener: vscode.Disposable | null = null;
let _configListener: vscode.Disposable | null = null;
let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
let _onDiscoveryChange: (() => void) | undefined;

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
      const { enabled, includeNested } = getGitignoreConfig();

      if (!enabled) {
        // If disabled, just sync immediately (which will clear the list) without progress
        void syncGitignoreFilesToSettings().then(() => {
          _onDiscoveryChange?.();
        });
        return;
      }

      const title = includeNested
        ? t('Scanning for all .gitignore files...')
        : t('Scanning workspace roots for .gitignore...');

      void vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title,
          cancellable: false,
        },
        async () => {
          // Perform the actual work
          await syncGitignoreFilesToSettings();
          _onDiscoveryChange?.();

          // Artificially keep the progress visible for at least 5 seconds as requested
          await new Promise((resolve) => setTimeout(resolve, 5000));
        },
      );
    } else {
      void syncGitignoreFilesToSettings().then(() => {
        _onDiscoveryChange?.();
      });
    }
  }, 400);
}

let _lastGlobalEnabled: boolean | undefined = undefined;
let _lastGlobalNested: boolean | undefined = undefined;
let _lastEffectiveEnabled: boolean | undefined = undefined;
let _lastEffectiveNested: boolean | undefined = undefined;

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

  // Initialize tracking state
  const initialCfg = vscode.workspace.getConfiguration('anfavorites.gitignore');
  _lastGlobalEnabled = initialCfg.inspect<boolean>('enabled')?.globalValue;
  _lastGlobalNested = initialCfg.inspect<boolean>('includeNested')?.globalValue;

  const initialEffective = getGitignoreConfig();
  _lastEffectiveEnabled = initialEffective.enabled;
  _lastEffectiveNested = initialEffective.includeNested;

  _configListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (e.affectsConfiguration('anfavorites.gitignore')) {
      logger?.debug?.('[gitignore] Settings changed');

      const cfg = vscode.workspace.getConfiguration('anfavorites.gitignore');
      const inspectEnabled = cfg.inspect<boolean>('enabled');
      const inspectNested = cfg.inspect<boolean>('includeNested');

      const currentGlobalEnabled = inspectEnabled?.globalValue;
      const currentGlobalNested = inspectNested?.globalValue;

      // 1. Detect if user modified settings in the "User" tab specifically
      const globalEnabledChanged = currentGlobalEnabled !== _lastGlobalEnabled;
      const globalNestedChanged = currentGlobalNested !== _lastGlobalNested;

      _lastGlobalEnabled = currentGlobalEnabled;
      _lastGlobalNested = currentGlobalNested;

      if (globalEnabledChanged || globalNestedChanged) {
        if (currentGlobalEnabled === true || currentGlobalNested === true) {
          void vscode.window.showWarningMessage(
            t(
              'The .gitignore integration can only be enabled/configured at the Workspace level. Global (User) configuration for this feature is ignored.',
            ),
            { modal: true },
          );
        }
      }

      // 2. Decide if we should show progress. ONLY if effective (workspace-level) settings changed.
      const {
        enabled: currentEffectiveEnabled,
        includeNested: currentEffectiveNested,
      } = getGitignoreConfig();

      const effectiveEnabledChanged =
        currentEffectiveEnabled !== _lastEffectiveEnabled;
      const effectiveNestedChanged =
        currentEffectiveNested !== _lastEffectiveNested;

      _lastEffectiveEnabled = currentEffectiveEnabled;
      _lastEffectiveNested = currentEffectiveNested;

      const showProgress = effectiveEnabledChanged || effectiveNestedChanged;
      invalidateCache(showProgress);
    }
  });
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Finds all .gitignore files in the workspace.
 * - If 'Enabled' is true, it always looks for the root .gitignore.
 * - If 'Include Nested' is true, it also scans for .gitignore files in subdirectories.
 */
export async function discoverGitignoreFiles(
  token?: vscode.CancellationToken,
): Promise<vscode.Uri[]> {
  const { enabled, includeNested } = getGitignoreConfig();
  if (!enabled) return [];

  const folders = vscode.workspace.workspaceFolders ?? [];
  const uris: vscode.Uri[] = [];
  const folderNames = folders.map((f) => f.name).join(', ');
  _logger?.debug?.(
    `[gitignore] discoverGitignoreFiles: scanning ${folderNames} folders`,
  );

  if (includeNested) {
    const configSearch =
      vscode.workspace.getConfiguration('anfavorites.search');
    const globalExclusions = configSearch.get<string[]>('exclusions', []);

    for (const folder of folders) {
      if (token?.isCancellationRequested) break;

      const excludePatterns = [...globalExclusions];

      // Always check root .gitignore explicitly
      const rootGitignoreUri = vscode.Uri.joinPath(folder.uri, '.gitignore');
      _logger?.debug?.(
        `[gitignore] Checking root file: ${rootGitignoreUri.fsPath}`,
      );
      _logger?.debug?.(
        `[gitignore] Exclude patterns: ${excludePatterns.join(', ')}`,
      );

      try {
        await vscode.workspace.fs.stat(rootGitignoreUri);
        if (!uris.some((u) => u.fsPath === rootGitignoreUri.fsPath)) {
          uris.push(rootGitignoreUri);
        }
        _logger?.debug?.(
          `[gitignore] Root file exists: ${rootGitignoreUri.fsPath}`,
        );
      } catch {
        _logger?.debug?.(
          `[gitignore] Root file NOT found: ${rootGitignoreUri.fsPath}`,
        );
      }

      // Merge root .gitignore patterns to avoid scanning ignored folders
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

      _logger?.debug?.(
        `[gitignore] Found in ${folder.name}: ${found.length} files`,
      );

      for (const uri of found) {
        if (!uris.some((u) => u.fsPath === uri.fsPath)) {
          uris.push(uri);
        }
      }
    }
  } else {
    for (const folder of folders) {
      if (token?.isCancellationRequested) break;

      const rootGitignoreUri = vscode.Uri.joinPath(folder.uri, '.gitignore');
      _logger?.debug?.(
        `[gitignore] Checking root file: ${rootGitignoreUri.fsPath}`,
      );

      try {
        await vscode.workspace.fs.stat(rootGitignoreUri);
        if (!uris.some((u) => u.fsPath === rootGitignoreUri.fsPath)) {
          uris.push(rootGitignoreUri);
        }
        _logger?.debug?.(
          `[gitignore] Root file exists: ${rootGitignoreUri.fsPath}`,
        );
      } catch {
        _logger?.debug?.(
          `[gitignore] Root file NOT found: ${rootGitignoreUri.fsPath}`,
        );
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
  const { enabled } = getGitignoreConfig();
  if (!enabled) return [];

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

export async function initGitignoreSync(logger?: any): Promise<void> {
  _logger = logger;
  ensureWatcher(logger);
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
  _configListener?.dispose();
  _configListener = null;
  _cache = null;
  _onDiscoveryChange = undefined;
}
