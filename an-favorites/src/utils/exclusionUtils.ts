import * as path from 'path';
import * as vscode from 'vscode';
import { minimatch } from 'minimatch';
import { isWindows } from './collisionUtils';

function normalizeForMatch(value: string): string {
  return path.normalize(value).split(path.sep).join('/');
}

function normalizePattern(pattern: string): string {
  return pattern.split(path.sep).join('/');
}

export function isExcludedPath(
  fsPath: string,
  patterns: string[],
): boolean {
  if (patterns.length === 0) {
    return false;
  }

  const normalized = normalizeForMatch(fsPath);
  const relative = vscode.workspace.asRelativePath(fsPath, false);
  const candidates = new Set<string>([normalized]);

  if (relative && relative !== fsPath) {
    candidates.add(normalizeForMatch(relative));
  }

  const options = { nocase: isWindows(), dot: true };

  return patterns.some((pattern) => {
    const normalizedPattern = normalizePattern(pattern);
    for (const candidate of candidates) {
      if (minimatch(candidate, normalizedPattern, options)) {
        return true;
      }
    }
    return false;
  });
}
