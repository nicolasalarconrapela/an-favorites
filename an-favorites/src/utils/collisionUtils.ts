import * as vscode from 'vscode';
import * as path from 'path';

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function normalizeFsPath(p: string): string {
  const n = path.normalize(p);
  return isWindows() ? n.toLowerCase() : n;
}

/**
 * Basename a prueba de bombas: evita crashear si uri.fsPath es undefined.
 */
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

/**
 * Detects name collisions for a set of file URIs using findFiles (Ripgrep).
 * Returns a Set of basenames that have collisions (appear more than once in workspace).
 * Uses configured exclusion patterns.
 */
export async function detectCollisions(
  uris: vscode.Uri[],
  exclusionPatterns: string[],
  logger?: any,
): Promise<Set<string>> {
  const collisions = new Set<string>();
  if (uris.length === 0) return collisions;

  // Group URIs by basename
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

  // Generate exclusion glob
  const exclusionGlob =
    exclusionPatterns.length > 0
      ? `{${exclusionPatterns.join(',')}}`
      : undefined;

  for (const [basename, urisWithName] of byBasename.entries()) {
    // Si ya tenemos más de una URI con este nombre en nuestro set, es colisión automática
    if (urisWithName.length > 1) {
      logger?.debug(
        `[collision] ${basename}: múltiples en display list (${urisWithName.length})`,
      );
      collisions.add(basename);
      continue;
    }

    // Buscar en todo el workspace archivos con este nombre
    try {
      const pattern = `**/${basename}`;
      const found = await vscode.workspace.findFiles(pattern, exclusionGlob);

      logger?.debug(
        `[collision] ${basename}: findFiles found ${found.length} file(s)`,
        found.map((u) => u.fsPath),
      );

      const target = normalizeFsPath(urisWithName[0].fsPath);
      const uniqueOthers = new Set(
        found.map((u) => normalizeFsPath(u.fsPath)).filter((p) => p !== target),
      );

      if (uniqueOthers.size > 0) collisions.add(basename);
    } catch (error) {
      logger?.warn(`[collision] Error searching for ${basename}:`, error);
      // En caso de error, asumimos no hay colisión
    }
  }

  return collisions;
}
