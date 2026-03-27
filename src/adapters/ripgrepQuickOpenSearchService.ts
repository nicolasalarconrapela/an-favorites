import { createHash } from 'crypto';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { rgPath } from '@vscode/ripgrep';
import { QuickOpenSearchService } from '../commands/quickOpen/quickOpenSearchService';

function normalizeGlobPattern(pattern: string): string {
  const trimmed = pattern.trim();
  return trimmed || '*';
}

function normalizeExcludePattern(pattern: string): string | null {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return null;
  }

  const withoutNegation = trimmed.startsWith('!') ? trimmed.slice(1) : trimmed;
  const normalized = withoutNegation.trim().replace(/\\/g, '/');
  return normalized || null;
}

function toWorkspaceUri(
  folder: vscode.WorkspaceFolder,
  relativePath: string,
): vscode.Uri {
  const normalized = relativePath.replace(/\//g, path.sep);
  return vscode.Uri.file(path.join(folder.uri.fsPath, normalized));
}

const RIPGREP_IGNORE_FILE_DIR = path.join(
  os.tmpdir(),
  'an-favorites-ripgrep-ignore',
);
const ripgrepIgnoreFileByPatternIdentity = new WeakMap<
  readonly string[],
  Promise<string | undefined>
>();
const ripgrepIgnoreFileCache = new Map<string, Promise<string>>();
const ripgrepIgnoreFilesForCleanup = new Set<string>();
let ripgrepIgnoreCleanupRegistered = false;

function ensureRipgrepIgnoreCleanupRegistered(): void {
  if (ripgrepIgnoreCleanupRegistered) {
    return;
  }

  ripgrepIgnoreCleanupRegistered = true;
  process.once('exit', () => {
    for (const filePath of ripgrepIgnoreFilesForCleanup) {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Best-effort cleanup of temp ignore files.
      }
    }
  });
}

async function getRipgrepIgnoreFilePath(
  excludePatterns: string[],
): Promise<string | undefined> {
  const identityCachedFilePromise =
    ripgrepIgnoreFileByPatternIdentity.get(excludePatterns);
  if (identityCachedFilePromise) {
    return identityCachedFilePromise;
  }

  const normalizedExcludePatterns = Array.from(
    new Set<string>([
      '.git/',
      ...excludePatterns
        .map((value) => normalizeExcludePattern(value))
        .filter((value): value is string => Boolean(value)),
    ]),
  ).sort();

  if (normalizedExcludePatterns.length === 0) {
    return undefined;
  }

  const fileContents = `${normalizedExcludePatterns.join('\n')}\n`;
  const fileHash = createHash('sha1').update(fileContents).digest('hex');
  const cachedFilePromise = ripgrepIgnoreFileCache.get(fileHash);
  if (cachedFilePromise) {
    ripgrepIgnoreFileByPatternIdentity.set(excludePatterns, cachedFilePromise);
    return cachedFilePromise;
  }

  const filePromise = (async (): Promise<string> => {
    await fsPromises.mkdir(RIPGREP_IGNORE_FILE_DIR, { recursive: true });
    const filePath = path.join(RIPGREP_IGNORE_FILE_DIR, `${fileHash}.ignore`);

    try {
      await fsPromises.access(filePath, fs.constants.F_OK);
    } catch {
      await fsPromises.writeFile(filePath, fileContents, 'utf8');
    }

    ripgrepIgnoreFilesForCleanup.add(filePath);
    ensureRipgrepIgnoreCleanupRegistered();
    return filePath;
  })();

  ripgrepIgnoreFileCache.set(fileHash, filePromise);
  ripgrepIgnoreFileByPatternIdentity.set(excludePatterns, filePromise);
  try {
    return await filePromise;
  } catch (error) {
    ripgrepIgnoreFileCache.delete(fileHash);
    ripgrepIgnoreFileByPatternIdentity.delete(excludePatterns);
    throw error;
  }
}

async function searchFolderWithRipgrep(params: {
  folder: vscode.WorkspaceFolder;
  pattern: string;
  excludePatterns: string[];
  limit: number;
  token?: vscode.CancellationToken;
}): Promise<vscode.Uri[]> {
  const { folder, pattern, excludePatterns, limit, token } = params;
  if (limit <= 0) {
    return [];
  }

  const ignoreFilePath = await getRipgrepIgnoreFilePath(excludePatterns);
  const args = [
    '--files',
    '--hidden',
    '--no-ignore',
    '--null',
    '--glob-case-insensitive',
  ];

  if (ignoreFilePath) {
    args.push('--ignore-file', ignoreFilePath);
    if (process.platform === 'win32') {
      args.push('--ignore-file-case-insensitive');
    }
  }

  args.push('--glob', normalizeGlobPattern(pattern));

  return new Promise<vscode.Uri[]>((resolve, reject) => {
    const results: vscode.Uri[] = [];
    let buffer = '';
    let stderr = '';
    let settled = false;

    const child = spawn(rgPath, args, {
      cwd: folder.uri.fsPath,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cancellationDisposable.dispose();
      if (!child.killed && child.exitCode === null) {
        child.kill();
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(results);
    };

    const flushBuffer = (): void => {
      const parts = buffer.split('\u0000');
      buffer = parts.pop() ?? '';
      for (const relativePath of parts) {
        if (!relativePath) {
          continue;
        }
        results.push(toWorkspaceUri(folder, relativePath));
        if (results.length >= limit) {
          finish();
          return;
        }
      }
    };

    const cancellationDisposable =
      token?.onCancellationRequested(() => {
        finish();
      }) ?? new vscode.Disposable(() => {});

    child.on('error', (error) => {
      finish(
        new Error(
          `ripgrep search failed to start for "${folder.name}": ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (settled) {
        return;
      }
      buffer += chunk;
      flushBuffer();
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    child.on('close', (code, signal) => {
      if (settled) {
        return;
      }
      flushBuffer();
      if (signal || code === 0 || code === 1) {
        finish();
        return;
      }

      finish(
        new Error(
          `ripgrep search failed for "${folder.name}" (code=${code ?? 'unknown'}): ${stderr.trim() || 'no stderr output'}`,
        ),
      );
    });
  });
}

export class RipgrepQuickOpenSearchService implements QuickOpenSearchService {
  readonly providesFilteredResults = false;

  async findFiles(
    pattern: string,
    excludePatterns: string[],
    limit: number,
    token?: vscode.CancellationToken,
  ): Promise<vscode.Uri[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0 || limit <= 0) {
      return [];
    }

    const results: vscode.Uri[] = [];
    const seen = new Set<string>();

    for (const folder of folders) {
      if (token?.isCancellationRequested || results.length >= limit) {
        break;
      }

      const folderResults = await searchFolderWithRipgrep({
        folder,
        pattern,
        excludePatterns,
        limit: limit - results.length,
        token,
      });

      for (const uri of folderResults) {
        const key = uri.fsPath.toLowerCase();
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        results.push(uri);
        if (results.length >= limit) {
          break;
        }
      }
    }

    return results;
  }
}
