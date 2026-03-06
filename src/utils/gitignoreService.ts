import * as vscode from 'vscode';

const GITIGNORE_CFG = 'anfavorites.gitignore';
const FILES_PROP = 'files';

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

function getGitignoreConfig(): { enabled: boolean; includeNested: boolean } {
  const cfg = vscode.workspace.getConfiguration(GITIGNORE_CFG);
  return {
    enabled: cfg.get<boolean>('enabled', true),
    includeNested: cfg.get<boolean>('includeNested', false),
  };
}

function getGitignoreFilesSettings(): Record<string, boolean> {
  const cfg = vscode.workspace.getConfiguration(GITIGNORE_CFG);
  const inspect = cfg.inspect<Record<string, boolean>>(FILES_PROP);
  // We strictly use workspace-level settings because files are local to the repo
  return inspect?.workspaceFolderValue ?? inspect?.workspaceValue ?? {};
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
): Promise<void> {
  const { enabled, includeNested } = getGitignoreConfig();
  if (!enabled) return;

  const discovered = await discoverGitignoreFiles(token);
  if (discovered.length === 0) return;

  const settings = getGitignoreFilesSettings();
  let changed = false;

  for (const uri of discovered) {
    const rel = gitignoreRelPath(uri);
    if (!(rel in settings)) {
      settings[rel] = true;
      changed = true;
    }
  }

  if (changed) {
    await updateGitignoreFilesSettings(settings);
  }
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

function invalidateCache(): void {
  _cache = null;
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    void syncGitignoreFilesToSettings();
    _onDiscoveryChange?.();
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

  _configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('anfavorites.gitignore')) {
      logger?.debug?.('[gitignore] Settings changed');
      invalidateCache();
    }
  });
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * Finds all .gitignore files in the workspace.
 * Respects the 'includeNested' setting.
 */
export async function discoverGitignoreFiles(
  token?: vscode.CancellationToken,
): Promise<vscode.Uri[]> {
  const { enabled, includeNested } = getGitignoreConfig();
  if (!enabled) return [];

  const folders = vscode.workspace.workspaceFolders ?? [];
  const uris: vscode.Uri[] = [];

  if (includeNested) {
    const configSearch =
      vscode.workspace.getConfiguration('anfavorites.search');
    const globalExclusions = configSearch.get<string[]>('exclusions', []);

    for (const folder of folders) {
      if (token?.isCancellationRequested) break;

      const excludePatterns = [...globalExclusions];

      // Merge root .gitignore to avoid scanning its ignored folders
      const rootGitignoreUri = vscode.Uri.joinPath(folder.uri, '.gitignore');
      const rootPatterns = await parseGitignoreFile(rootGitignoreUri, token);
      for (const p of rootPatterns) {
        if (!excludePatterns.includes(p)) excludePatterns.push(p);
      }

      // Convert array of patterns to a single glob format {a,b,c}
      let excludeGlob: string | undefined;
      if (excludePatterns.length === 1) excludeGlob = excludePatterns[0];
      else if (excludePatterns.length > 1)
        excludeGlob = `{${excludePatterns.join(',')}}`;

      const found = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, '**/.gitignore'),
        excludeGlob,
        5000,
        token,
      );
      uris.push(...found);
    }
  } else {
    for (const folder of folders) {
      if (token?.isCancellationRequested) break;
      const uri = vscode.Uri.joinPath(folder.uri, '.gitignore');
      try {
        await vscode.workspace.fs.stat(uri);
        uris.push(uri);
      } catch {
        // does not exist — skip
      }
    }
  }

  // Sort by relative path for stable ordering
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
  ensureWatcher(logger);
  await syncGitignoreFilesToSettings();
  logger?.info?.(
    '[gitignore] Service started — watching for .gitignore changes',
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
