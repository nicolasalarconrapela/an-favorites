import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { rgPath } from '@vscode/ripgrep';
import { QuickOpenSearchService } from '../commands/quickOpen/quickOpenSearchService';
import { Logger } from '../logging/logger';
import { getEnabledGitignoreFilesFast } from '../utils/gitignoreService';

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

let ripgrepSearchSequence = 0;
let ripgrepWorkspaceSearchSequence = 0;

function buildFolderGitignoreFilesIndex(
  gitignoreFiles: readonly vscode.Uri[],
): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const uri of gitignoreFiles) {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || !fs.existsSync(uri.fsPath)) {
      continue;
    }

    const key = folder.uri.fsPath.toLowerCase();
    const entry = index.get(key);
    if (entry) {
      entry.push(uri.fsPath);
    } else {
      index.set(key, [uri.fsPath]);
    }
  }

  for (const filePaths of index.values()) {
    filePaths.sort(
      (left, right) => left.length - right.length || left.localeCompare(right),
    );
  }

  return index;
}

async function searchFolderWithRipgrep(params: {
  folder: vscode.WorkspaceFolder;
  pattern: string;
  excludePatterns: string[];
  gitignoreFilePaths: readonly string[];
  limit: number;
  token?: vscode.CancellationToken;
  logger?: Logger;
}): Promise<vscode.Uri[]> {
  const {
    folder,
    pattern,
    excludePatterns,
    gitignoreFilePaths,
    limit,
    token,
    logger,
  } = params;
  if (limit <= 0) {
    return [];
  }
  const searchId = ++ripgrepSearchSequence;

  const normalizedExcludePatterns = Array.from(
    new Set<string>(
      [
        '**/.git/**',
        ...excludePatterns
          .map((value) => normalizeExcludePattern(value))
          .filter((value): value is string => Boolean(value)),
      ],
    ),
  ).sort();
  const args = [
    '--files',
    '--hidden',
    '--no-ignore',
    '--null',
    '--glob-case-insensitive',
  ];

  if (gitignoreFilePaths.length > 0) {
    if (process.platform === 'win32') {
      args.push('--ignore-file-case-insensitive');
    }
    for (const gitignoreFilePath of gitignoreFilePaths) {
      args.push('--ignore-file', gitignoreFilePath);
    }
  }

  for (const excludePattern of normalizedExcludePatterns) {
    args.push('--glob', `!${excludePattern}`);
  }

  args.push('--glob', normalizeGlobPattern(pattern));

  return new Promise<vscode.Uri[]>((resolve, reject) => {
    const results: vscode.Uri[] = [];
    let buffer = '';
    let stderr = '';
    let settled = false;
    const startedAt = Date.now();

    logger?.info?.('[QuickOpen][trace] ripgrep search started', {
      searchId,
      folder: folder.name,
      cwd: folder.uri.fsPath,
      pattern,
      limit,
      excludeCount: normalizedExcludePatterns.length,
      gitignoreFileCount: gitignoreFilePaths.length,
      gitignoreFileSample: gitignoreFilePaths.slice(0, 5),
      argCount: args.length,
    });

    const child = spawn(rgPath, args, {
      cwd: folder.uri.fsPath,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    logger?.info?.('[QuickOpen][trace] ripgrep process spawned', {
      searchId,
      folder: folder.name,
      pid: child.pid ?? null,
      pattern,
      limit,
    });

    const finish = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cancellationDisposable.dispose();
      const durationMs = Date.now() - startedAt;
      const cancelled = token?.isCancellationRequested ?? false;
      let killRequested = false;
      if (!child.killed && child.exitCode === null) {
        killRequested = child.kill();
      }
      if (error) {
        logger?.error?.('[QuickOpen][trace] ripgrep search failed', {
          searchId,
          folder: folder.name,
          pattern,
          limit,
          resultCount: results.length,
          durationMs,
          cancelled,
          message: error.message,
          pid: child.pid ?? null,
          childKilled: child.killed,
          exitCode: child.exitCode,
          killRequested,
        });
        reject(error);
        return;
      }
      logger?.info?.('[QuickOpen][trace] ripgrep search finished', {
        searchId,
        folder: folder.name,
        pattern,
        limit,
        resultCount: results.length,
        durationMs,
        cancelled,
        pid: child.pid ?? null,
        childKilled: child.killed,
        exitCode: child.exitCode,
        killRequested,
      });
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
        logger?.info?.('[QuickOpen][trace] ripgrep search cancellation requested', {
          searchId,
          folder: folder.name,
          pattern,
          limit,
          pid: child.pid ?? null,
          partialResultCount: results.length,
        });
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
      logger?.info?.('[QuickOpen][trace] ripgrep process closed', {
        searchId,
        folder: folder.name,
        pattern,
        code,
        signal,
        resultCount: results.length,
        settled,
        cancelled: token?.isCancellationRequested ?? false,
      });
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
  readonly providesFilteredResults = true;

  async findFiles(
    pattern: string,
    excludePatterns: string[],
    limit: number,
    token?: vscode.CancellationToken,
    logger?: Logger,
  ): Promise<vscode.Uri[]> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0 || limit <= 0) {
      return [];
    }
    const workspaceSearchId = ++ripgrepWorkspaceSearchSequence;
    const gitignoreFiles = getEnabledGitignoreFilesFast() ?? [];
    const gitignoreFilesByFolder = buildFolderGitignoreFilesIndex(gitignoreFiles);

    const startedAt = Date.now();
    logger?.info?.('[QuickOpen][trace] ripgrep workspace search started', {
      workspaceSearchId,
      folderCount: folders.length,
      pattern,
      limit,
      excludeCount: excludePatterns.length,
      gitignoreFileCount: gitignoreFiles.length,
    });

    const results: vscode.Uri[] = [];
    const seen = new Set<string>();

    for (const folder of folders) {
      if (token?.isCancellationRequested || results.length >= limit) {
        logger?.info?.('[QuickOpen][trace] ripgrep workspace search loop stopped early', {
          workspaceSearchId,
          pattern,
          resultCount: results.length,
          cancelled: token?.isCancellationRequested ?? false,
        });
        break;
      }

      logger?.info?.('[QuickOpen][trace] ripgrep workspace folder search dispatched', {
        workspaceSearchId,
        folder: folder.name,
        remainingLimit: limit - results.length,
        pattern,
        gitignoreFileCount:
          gitignoreFilesByFolder.get(folder.uri.fsPath.toLowerCase())?.length ?? 0,
      });
      const folderResults = await searchFolderWithRipgrep({
        folder,
        pattern,
        excludePatterns,
        gitignoreFilePaths:
          gitignoreFilesByFolder.get(folder.uri.fsPath.toLowerCase()) ?? [],
        limit: limit - results.length,
        token,
        logger,
      });
      logger?.info?.('[QuickOpen][trace] ripgrep workspace folder search finished', {
        workspaceSearchId,
        folder: folder.name,
        pattern,
        folderResultCount: folderResults.length,
        accumulatedResultCount: results.length,
        cancelled: token?.isCancellationRequested ?? false,
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

    logger?.info?.('[QuickOpen][trace] ripgrep workspace search finished', {
      workspaceSearchId,
      folderCount: folders.length,
      pattern,
      limit,
      resultCount: results.length,
      durationMs: Date.now() - startedAt,
      cancelled: token?.isCancellationRequested ?? false,
    });

    return results;
  }
}
