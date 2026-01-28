import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../logging/logger';
import { runWithConcurrency } from '../utils/concurrency';
import { isExcludedPath } from '../utils/exclusionUtils';

const VALIDATION_CONCURRENCY = 12;

export class MRUService {
  private static readonly STORAGE_KEY = 'anfavorites.mru.history';
  private static readonly MAX_ENTRIES = 50;
  private mruList: string[] = [];

  private _onDidChangeRecentFiles = new vscode.EventEmitter<void>();
  public readonly onDidChangeRecentFiles = this._onDidChangeRecentFiles.event;

  constructor(
    private context: vscode.ExtensionContext,
    private logger: Logger,
  ) {
    this.load();

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === 'file') {
        this.add(editor.document.uri.fsPath);
      }
    });

    this.logger.info(
      `[init] MRUService created (Local Storage). items=${this.mruList.length}`,
    );
  }

  private load(): void {
    const stored = this.context.workspaceState.get<string[]>(
      MRUService.STORAGE_KEY,
    );

    if (stored && stored.length > 0) {
      this.mruList = stored;
      this.removeEmptyEntries(
        '[mru] Removed empty entries from loaded history',
      );
      this.logger.info(`[mru] Loaded from globalState. count=${stored.length}`);
    } else {
      this.mruList = [];
      this.logger.info('[mru] No history in globalState.');
    }

    this.checkForDuplicateNames();
  }

  private removeEmptyEntries(logMessage: string): void {
    const originalLength = this.mruList.length;
    this.mruList = this.mruList.filter((entry) => entry.trim() !== '');
    if (this.mruList.length !== originalLength) {
      const removed = originalLength - this.mruList.length;
      this.logger.info(`${logMessage}. removed=${removed}`);
      this.save();
    }
  }

  private checkForDuplicateNames(): void {
    const nameMap = new Map<string, string[]>();
    const configSearch =
      vscode.workspace.getConfiguration('anfavorites.search');
    const searchExclusions = configSearch.get<string[]>('exclusions') ?? [];

    this.mruList.forEach((filePath) => {
      if (isExcludedPath(filePath, searchExclusions)) {
        return;
      }
      const basename = path.basename(filePath);
      const existing = nameMap.get(basename);
      if (existing) {
        existing.push(filePath);
      } else {
        nameMap.set(basename, [filePath]);
      }
    });

    const duplicates = Array.from(nameMap.entries())
      .filter(([_, paths]) => paths.length > 1)
      .map(([name, paths]) => ({ name, count: paths.length, paths }));

    if (duplicates.length > 0) {
      this.logger.warn(
        `[duplicates] Found ${duplicates.length} duplicate basenames in MRU`,
        duplicates,
      );
    } else {
      this.logger.info('[duplicates] No duplicate basenames in MRU');
    }
  }

  private save(): void {
    this.context.workspaceState.update(MRUService.STORAGE_KEY, this.mruList);
  }

  public add(fsPath: string): void {
    this.mruList = this.mruList.filter((p) => p !== fsPath);

    this.mruList.unshift(fsPath);

    if (this.mruList.length > MRUService.MAX_ENTRIES) {
      this.mruList = this.mruList.slice(0, MRUService.MAX_ENTRIES);
    }

    this.save();
    this._onDidChangeRecentFiles.fire();
  }

  public getRecentFiles(): string[] {
    return [...this.mruList];
  }

  public clear(): void {
    this.logger.info('[mru] clear() called');
    this.mruList = [];
    this.save();
    this._onDidChangeRecentFiles.fire();
  }

  public async validateFiles(): Promise<void> {
    const originalLength = this.mruList.length;
    const validFiles: string[] = [];
    const t0 = Date.now();

    this.logger.info(`[validate] validateFiles start. size=${originalLength}`);

    await runWithConcurrency(
      this.mruList,
      VALIDATION_CONCURRENCY,
      async (fsPath) => {
        try {
          const uri = vscode.Uri.file(fsPath);
          await vscode.workspace.fs.stat(uri);
          validFiles.push(fsPath);
        } catch (error) {
          this.logger.error(`[validate] Skipping invalid file: ${fsPath}`);
        }
      },
    );

    this.logger.info(
      `[validate] validateFiles done. processed=${this.mruList.length} valid=${validFiles.length} durationMs=${Date.now() - t0}`,
    );

    if (validFiles.length !== originalLength) {
      const removed = originalLength - validFiles.length;
      this.logger.info(`[validate] Removing ${removed} missing files from MRU`);
      this.mruList = validFiles;
      this.save();
      this._onDidChangeRecentFiles.fire();
    } else {
      this.logger.info('[validate] No missing files in MRU');
    }
  }

  public async validateFilesForPaths(filePaths: string[]): Promise<void> {
    const uniquePaths = Array.from(
      new Set(filePaths.filter((filePath) => this.mruList.includes(filePath))),
    );

    if (uniquePaths.length === 0) {
      return;
    }

    const toRemove: string[] = [];
    const t0 = Date.now();

    await runWithConcurrency(
      uniquePaths,
      VALIDATION_CONCURRENCY,
      async (fsPath) => {
        try {
          const uri = vscode.Uri.file(fsPath);
          await vscode.workspace.fs.stat(uri);
        } catch {
          toRemove.push(fsPath);
        }
      },
    );

    this.logger.info(
      `[validate] validateFilesForPaths done. processed=${uniquePaths.length} missing=${toRemove.length} durationMs=${Date.now() - t0}`,
    );

    if (toRemove.length > 0) {
      this.logger.info(
        `[validate] Removing ${toRemove.length} missing files from MRU`,
        toRemove,
      );
      const toRemoveSet = new Set(toRemove);
      this.mruList = this.mruList.filter((fsPath) => !toRemoveSet.has(fsPath));
      this.save();
      this._onDidChangeRecentFiles.fire();
    }
  }

  public updatePath(oldPath: string, newPath: string): void {
    const normalizedPath = newPath.trim();
    if (!normalizedPath) {
      this.logger.warn(
        `[mru] updatePath ignored empty destination for ${oldPath}`,
      );
      return;
    }

    const index = this.mruList.indexOf(oldPath);
    if (index !== -1) {
      this.logger.info(`[mru] updatePath -> ${oldPath} => ${normalizedPath}`);
      this.mruList[index] = normalizedPath;
      this.save();
      this._onDidChangeRecentFiles.fire();
    } else {
      this.logger.warn(`[mru] updatePath FAILED (not found) -> ${oldPath}`);
    }
  }
  public remove(fsPath: string): void {
    const originalLength = this.mruList.length;
    this.mruList = this.mruList.filter((p) => p !== fsPath);

    if (this.mruList.length !== originalLength) {
      this.logger.info(`[mru] Removed file: ${fsPath}`);
      this.save();
      this._onDidChangeRecentFiles.fire();
    }
  }
}
