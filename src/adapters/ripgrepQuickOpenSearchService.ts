import { spawn } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { rgPath } from '@vscode/ripgrep';
import { QuickOpenSearchService } from '../commands/quickOpen/quickOpenSearchService';
import { Logger } from '../logging/logger';
import { normalizeFsPath } from '../utils/collisionUtils';
import { getCompiledRipgrepIgnoreFiles } from '../utils/gitignoreService';

function normalizeGlobPattern(pattern: string): string {
  const trimmed = pattern.trim();
  return trimmed || '**/*';
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
let activeRipgrepProcessCount = 0;
const RIPGREP_STDERR_LIMIT = 4096;

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
    let finishRequested = false;
    let requestedFinishReason = 'completed';
    let requestedFinishError: Error | undefined;
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

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(rgPath, args, {
        cwd: folder.uri.fsPath,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(
        new Error(
          `ripgrep search failed to spawn for "${folder.name}": ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }
    activeRipgrepProcessCount += 1;
    logger?.info?.('[QuickOpen][trace] ripgrep process spawned', {
      searchId,
      folder: folder.name,
      pid: child.pid ?? null,
      pattern,
      limit,
      activeRipgrepProcessCount,
    });

    const settle = (error?: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      cancellationDisposable.dispose();
      activeRipgrepProcessCount = Math.max(0, activeRipgrepProcessCount - 1);
      const durationMs = Date.now() - startedAt;
      const cancelled = token?.isCancellationRequested ?? false;
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
          requestedFinishReason,
          activeRipgrepProcessCount,
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
        requestedFinishReason,
        activeRipgrepProcessCount,
      });
      resolve(results);
    };

    const requestFinish = (reason: string, error?: Error): void => {
      if (settled || finishRequested) {
        return;
      }
      finishRequested = true;
      requestedFinishReason = reason;
      requestedFinishError = error;
      const shouldKill = !child.killed && child.exitCode === null;
      const killRequested = shouldKill ? child.kill() : false;
      logger?.info?.('[QuickOpen][trace] ripgrep search finish requested', {
        searchId,
        folder: folder.name,
        pattern,
        limit,
        reason,
        pid: child.pid ?? null,
        childKilled: child.killed,
        exitCode: child.exitCode,
        killRequested,
        partialResultCount: results.length,
        activeRipgrepProcessCount,
      });
      if (!shouldKill) {
        settle(requestedFinishError);
      }
    };

    const flushBuffer = (): void => {
      if (settled || finishRequested) {
        buffer = '';
        return;
      }
      const parts = buffer.split('\u0000');
      buffer = parts.pop() ?? '';
      for (const relativePath of parts) {
        if (settled || finishRequested) {
          buffer = '';
          return;
        }
        if (!relativePath) {
          continue;
        }
        results.push(toWorkspaceUri(folder, relativePath));
        if (results.length >= limit) {
          requestFinish('result-limit-reached');
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
        requestFinish('cancellation-requested');
      }) ?? new vscode.Disposable(() => {});

    child.on('error', (error) => {
      settle(
        new Error(
          `ripgrep search failed to start for "${folder.name}": ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });

    const stdout = child.stdout;
    const stderrStream = child.stderr;
    if (!stdout || !stderrStream) {
      settle(
        new Error(
          `ripgrep search failed for "${folder.name}": stdout/stderr pipe was not available`,
        ),
      );
      return;
    }

    stdout.setEncoding('utf8');
    stdout.on('data', (chunk: string) => {
      if (settled) {
        return;
      }
      buffer += chunk;
      flushBuffer();
    });

    stderrStream.setEncoding('utf8');
    stderrStream.on('data', (chunk: string) => {
      if (stderr.length >= RIPGREP_STDERR_LIMIT) {
        return;
      }
      stderr += chunk.slice(0, RIPGREP_STDERR_LIMIT - stderr.length);
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
        finishRequested,
        requestedFinishReason,
        cancelled: token?.isCancellationRequested ?? false,
        activeRipgrepProcessCount,
      });
      if (settled) {
        return;
      }
      flushBuffer();
      if (finishRequested) {
        settle(requestedFinishError);
        return;
      }
      if (signal || code === 0 || code === 1) {
        settle();
        return;
      }

      settle(
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
    const compiledIgnoreFilesByFolder = await getCompiledRipgrepIgnoreFiles(
      token,
    );

    const startedAt = Date.now();
    logger?.info?.('[QuickOpen][trace] ripgrep workspace search started', {
      workspaceSearchId,
      folderCount: folders.length,
      pattern,
      limit,
      excludeCount: excludePatterns.length,
      compiledIgnoreFolderCount: compiledIgnoreFilesByFolder.size,
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
        compiledIgnoreFileCount:
          compiledIgnoreFilesByFolder.get(normalizeFsPath(folder.uri.fsPath))
            ?.length ?? 0,
      });
      const folderResults = await searchFolderWithRipgrep({
        folder,
        pattern,
        excludePatterns,
        gitignoreFilePaths:
          compiledIgnoreFilesByFolder.get(normalizeFsPath(folder.uri.fsPath)) ??
          [],
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
        const key = normalizeFsPath(uri.fsPath);
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
