import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../logging/logger';

export class MRUService {
  private static readonly STORAGE_KEY = 'anfavorites.mru.history';
  private static readonly MAX_ENTRIES = 50;
  private mruList: string[] = [];

  private _onDidChangeRecentFiles = new vscode.EventEmitter<void>();
  public readonly onDidChangeRecentFiles = this._onDidChangeRecentFiles.event;

  constructor(private context: vscode.ExtensionContext, private logger: Logger) {
    this.load();

    // Listen for file changes to update MRU
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === 'file') {
        this.add(editor.document.uri.fsPath);
      }
    });

    this.logger.info(`[init] MRUService created (Local Storage). items=${this.mruList.length}`);
  }



  private load(): void {
    const stored = this.context.globalState.get<string[]>(
      MRUService.STORAGE_KEY,
    );

    if (stored && stored.length > 0) {
      this.mruList = stored;
      this.logger.info(`[mru] Loaded from globalState. count=${stored.length}`);
    } else {
      this.mruList = [];
      this.logger.info('[mru] No history in globalState.');
    }

    this.checkForDuplicateNames();
  }

  /**
   * Verifica y reporta nombres duplicados después de cargar recientes
   */
  private checkForDuplicateNames(): void {
    const nameMap = new Map<string, string[]>();

    this.mruList.forEach((filePath) => {
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
      this.logger.warn(`[duplicates] Found ${duplicates.length} duplicate basenames in MRU`, duplicates);
    } else {
      this.logger.info('[duplicates] No duplicate basenames in MRU');
    }
  }

  private save(): void {
    this.context.globalState.update(MRUService.STORAGE_KEY, this.mruList);
  }

  public add(fsPath: string): void {
    // Remove if already exists to move it to top
    this.mruList = this.mruList.filter((p) => p !== fsPath);

    // Add to top
    this.mruList.unshift(fsPath);

    // Trim
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

    this.logger.info(`[validate] validateFiles start. size=${originalLength}`);

    for (const fsPath of this.mruList) {
      try {
        const uri = vscode.Uri.file(fsPath);
        await vscode.workspace.fs.stat(uri);
        validFiles.push(fsPath);
      } catch (error) {
        this.logger.error(`[validate] Skipping invalid file: ${fsPath}`);
      }
    }

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

  public updatePath(oldPath: string, newPath: string): void {
    const index = this.mruList.indexOf(oldPath);
    if (index !== -1) {
      this.logger.info(`[mru] updatePath -> ${oldPath} => ${newPath}`);
      this.mruList[index] = newPath;
      this.save();
      this._onDidChangeRecentFiles.fire();
    } else {
      this.logger.warn(`[mru] updatePath FAILED (not found) -> ${oldPath}`);
    }
  }
}
