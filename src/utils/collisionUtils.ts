import * as fs from 'fs';
import * as vscode from 'vscode';
import * as path from 'path';

export function isWindows(): boolean {
  return process.platform === 'win32';
}

const caseSensitivityCache = new Map<string, boolean>();

function toggleCaseCharacter(value: string): string {
  return value === value.toLowerCase()
    ? value.toUpperCase()
    : value.toLowerCase();
}

function buildAlternateCasePath(existingPath: string): string | null {
  let current = path.normalize(existingPath);

  while (true) {
    const basename = path.basename(current);
    const alphaIndex = basename.search(/[a-zA-Z]/);
    if (alphaIndex >= 0) {
      const alternateBasename =
        basename.slice(0, alphaIndex) +
        toggleCaseCharacter(basename.charAt(alphaIndex)) +
        basename.slice(alphaIndex + 1);
      return path.join(path.dirname(current), alternateBasename);
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function findExistingProbePath(fsPath: string): string | null {
  let current = path.normalize(fsPath);

  while (true) {
    if (fs.existsSync(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function isPathCaseSensitive(fsPath: string): boolean {
  const probePath = findExistingProbePath(fsPath);
  if (!probePath) {
    return process.platform !== 'win32';
  }

  const cached = caseSensitivityCache.get(probePath);
  if (cached !== undefined) {
    return cached;
  }

  const alternatePath = buildAlternateCasePath(probePath);
  if (!alternatePath || alternatePath === probePath) {
    const fallback = process.platform !== 'win32';
    caseSensitivityCache.set(probePath, fallback);
    return fallback;
  }

  let caseSensitive = true;
  try {
    const originalRealPath = fs.realpathSync.native(probePath);
    const alternateRealPath = fs.realpathSync.native(alternatePath);
    caseSensitive = originalRealPath !== alternateRealPath;
  } catch {
    caseSensitive = true;
  }

  caseSensitivityCache.set(probePath, caseSensitive);
  return caseSensitive;
}

export function normalizeFsPath(p: string): string {
  const normalized = path.normalize(p);
  return isPathCaseSensitive(normalized) ? normalized : normalized.toLowerCase();
}

export function invalidateCollisionIndex(
  _logger?: any,
  _reason = 'settings / exclusions changed',
): void {}

export function disposeCollisionIndex(): void {}

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

function detectVisibleListCollisions(uris: vscode.Uri[]): Set<string> {
  const collisions = new Set<string>();
  const counts = new Map<string, number>();

  for (const uri of uris) {
    const basename = safeBasenameFromUri(uri);
    counts.set(basename, (counts.get(basename) ?? 0) + 1);
  }

  for (const [basename, count] of counts.entries()) {
    if (count > 1) {
      collisions.add(basename);
    }
  }

  return collisions;
}

export async function detectCollisions(
  uris: vscode.Uri[],
  _exclusionPatterns: string[],
  token?: vscode.CancellationToken,
  _logger?: any,
): Promise<Set<string>> {
  if (token?.isCancellationRequested || uris.length === 0) {
    return new Set<string>();
  }

  return detectVisibleListCollisions(uris);
}

export async function applyCollisionLabels<T>(
  items: T[],
  getUri: (item: T) => vscode.Uri,
  onCollision: (item: T, basename: string) => void,
  onNoCollision: (item: T) => void,
  exclusionPatterns: string[],
  token?: vscode.CancellationToken,
  logger?: any,
): Promise<void> {
  const uris = items.map((item) => getUri(item));
  const collisions = await detectCollisions(
    uris,
    exclusionPatterns,
    token,
    logger,
  );

  for (const item of items) {
    if (token?.isCancellationRequested) {
      return;
    }

    const basename = safeBasenameFromUri(getUri(item));
    if (collisions.has(basename)) {
      onCollision(item, basename);
    } else {
      onNoCollision(item);
    }
  }
}
