import * as vscode from 'vscode';
import * as path from 'path';

const DEFAULT_INDEX_DEBOUNCE_MS = 300;

let cachedIndex: Map<string, Set<string>> | null = null;
let cachedExclusionKey: string | null = null;
let buildPromise: Promise<Map<string, Set<string>>> | null = null;
let rebuildTimer: NodeJS.Timeout | null = null;
let indexWatcher: vscode.FileSystemWatcher | null = null;
let workspaceFolderListener: vscode.Disposable | null = null;
let lastExclusionPatterns: string[] = [];

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function normalizeFsPath(p: string): string {
  const n = path.normalize(p);
  return isWindows() ? n.toLowerCase() : n;
}

function exclusionKeyFromPatterns(patterns: string[]): string {
  return [...patterns].sort().join('|');
}

function buildExclusionGlob(patterns: string[]): string | undefined {
  return patterns.length > 0 ? `{${patterns.join(',')}}` : undefined;
}

function scheduleIndexRebuild(reason: string, logger?: any): void {
  if (lastExclusionPatterns.length === 0) {
    return;
  }
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
  }
  rebuildTimer = setTimeout(() => {
    logger?.debug?.(`[collision-index] Rebuilding due to ${reason} (debounced)`);
    void rebuildWorkspaceIndex(lastExclusionPatterns, logger);
  }, DEFAULT_INDEX_DEBOUNCE_MS);
}

function ensureWorkspaceIndexWatcher(logger?: any): void {
  if (indexWatcher) {
    return;
  }

  indexWatcher = vscode.workspace.createFileSystemWatcher('**/*');
  indexWatcher.onDidCreate(() => {
    scheduleIndexRebuild('create', logger);
  });
  indexWatcher.onDidDelete(() => {
    scheduleIndexRebuild('delete', logger);
  });
  indexWatcher.onDidChange(() => {
    scheduleIndexRebuild('change', logger);
  });

  workspaceFolderListener =
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      logger?.info?.(
        '[collision-index] Workspace folders changed -> clearing index cache',
      );
      cachedIndex = null;
      cachedExclusionKey = null;
      scheduleIndexRebuild('workspace-folders', logger);
    });
}

export function disposeCollisionIndex(): void {
  if (rebuildTimer) {
    clearTimeout(rebuildTimer);
    rebuildTimer = null;
  }
  indexWatcher?.dispose();
  indexWatcher = null;
  workspaceFolderListener?.dispose();
  workspaceFolderListener = null;
  cachedIndex = null;
  cachedExclusionKey = null;
  buildPromise = null;
  lastExclusionPatterns = [];
}

async function buildWorkspaceIndex(
  exclusionPatterns: string[],
  logger?: any,
): Promise<Map<string, Set<string>>> {
  const exclusionGlob = buildExclusionGlob(exclusionPatterns);
  const files = await vscode.workspace.findFiles('**/*', exclusionGlob);
  const index = new Map<string, Set<string>>();

  for (const uri of files) {
    const basename = safeBasenameFromUri(uri);
    const normalized = normalizeFsPath(uri.fsPath);
    const bucket = index.get(basename);
    if (bucket) {
      bucket.add(normalized);
    } else {
      index.set(basename, new Set([normalized]));
    }
  }

  logger?.debug?.(
    `[collision-index] Built index. files=${files.length} basenames=${index.size}`,
  );
  return index;
}

async function rebuildWorkspaceIndex(
  exclusionPatterns: string[],
  logger?: any,
): Promise<Map<string, Set<string>>> {
  const key = exclusionKeyFromPatterns(exclusionPatterns);
  cachedExclusionKey = key;
  buildPromise = buildWorkspaceIndex(exclusionPatterns, logger)
    .then((index) => {
      cachedIndex = index;
      buildPromise = null;
      return index;
    })
    .catch((error) => {
      buildPromise = null;
      throw error;
    });
  return buildPromise;
}

async function getWorkspaceIndex(
  exclusionPatterns: string[],
  logger?: any,
): Promise<Map<string, Set<string>>> {
  const key = exclusionKeyFromPatterns(exclusionPatterns);
  lastExclusionPatterns = exclusionPatterns;
  ensureWorkspaceIndexWatcher(logger);

  if (cachedIndex && cachedExclusionKey === key) {
    return cachedIndex;
  }

  if (buildPromise && cachedExclusionKey === key) {
    return buildPromise;
  }

  return rebuildWorkspaceIndex(exclusionPatterns, logger);
}




export function safeBasenameFromUri(uri: vscode.Uri): string {
  const fsPath = (uri as any)?.fsPath;
  if (typeof fsPath === 'string' && fsPath.length > 0) {
    return path.basename(fsPath);
  }

  const uriPath = (uri as any)?.path;
  if (typeof uriPath === 'string' && uriPath.length > 0) {
    return path.posix.basename(uriPath);
  }

  return '(sin nombre)';
}






export async function detectCollisions(
  uris: vscode.Uri[],
  exclusionPatterns: string[],
  logger?: any,
): Promise<Set<string>> {
  const collisions = new Set<string>();
  if (uris.length === 0) return collisions;

  const index = await getWorkspaceIndex(exclusionPatterns, logger);


  const byBasename = new Map<string, vscode.Uri[]>();
  for (const uri of uris) {
    const basename = safeBasenameFromUri(uri);
    const arr = byBasename.get(basename);
    if (arr) {
      arr.push(uri);
    } else {
      byBasename.set(basename, [uri]);
    }
  }

  for (const [basename, urisWithName] of byBasename.entries()) {

    if (urisWithName.length > 1) {
      logger?.debug(
        `[collision] ${basename}: múltiples en display list (${urisWithName.length})`,
      );
      collisions.add(basename);
      continue;
    }

    try {
      const target = normalizeFsPath(urisWithName[0].fsPath);
      const pathsInIndex = index.get(basename);

      if (pathsInIndex && pathsInIndex.size > 0) {
        logger?.debug?.(
          `[collision] ${basename}: index entries=${pathsInIndex.size}`,
          Array.from(pathsInIndex),
        );

        if (pathsInIndex.size > 1 || !pathsInIndex.has(target)) {
          collisions.add(basename);
        }
      }
    } catch (error) {
      logger?.warn(`[collision] Error searching for ${basename}:`, error);

    }
  }

  return collisions;
}

export async function applyCollisionLabels<T>(
  items: T[],
  getUri: (item: T) => vscode.Uri,
  onCollision: (item: T, basename: string) => void,
  onNoCollision: (item: T) => void,
  exclusionPatterns: string[],
  logger?: any,
): Promise<void> {
  const uris = items.map((item) => getUri(item));
  const collisions = await detectCollisions(uris, exclusionPatterns, logger);

  for (const item of items) {
    const uri = getUri(item);
    const basename = safeBasenameFromUri(uri);
    if (collisions.has(basename)) {
      onCollision(item, basename);
    } else {
      onNoCollision(item);
    }
  }
}
