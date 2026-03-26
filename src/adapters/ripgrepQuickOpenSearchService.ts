import { spawn } from 'child_process';
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

  return trimmed.startsWith('!') ? trimmed : `!${trimmed}`;
}

function toWorkspaceUri(
  folder: vscode.WorkspaceFolder,
  relativePath: string,
): vscode.Uri {
  const normalized = relativePath.replace(/\//g, path.sep);
  return vscode.Uri.file(path.join(folder.uri.fsPath, normalized));
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

  const args = ['--files', '--hidden', '--null', '--glob', normalizeGlobPattern(pattern)];
  const normalizedExcludePatterns = new Set<string>([
    '!.git',
    '!.git/**',
    ...excludePatterns
      .map((value) => normalizeExcludePattern(value))
      .filter((value): value is string => Boolean(value)),
  ]);

  for (const excludePattern of normalizedExcludePatterns) {
    args.push('--glob', excludePattern);
  }

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
      if (signal || code === 0) {
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
