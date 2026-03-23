import * as vscode from 'vscode';
import * as path from 'path';

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function normalizeFsPath(p: string): string {
  const normalized = path.normalize(p);
  return isWindows() ? normalized.toLowerCase() : normalized;
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
