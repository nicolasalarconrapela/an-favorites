import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../logging/logger';
import { SharedStorageService } from './sharedStorageService';

export class MRUService {
  private static readonly STORAGE_KEY = 'anfavorites.mru.history';
  private static readonly MAX_ENTRIES = 50;
  private mruList: string[] = [];

  private _onDidChangeRecentFiles = new vscode.EventEmitter<void>();
  public readonly onDidChangeRecentFiles = this._onDidChangeRecentFiles.event;

  constructor(private context: vscode.ExtensionContext, private logger: Logger, private storage: SharedStorageService) {
    this.load();
    this.storage.onDidChange(() => {
      this.logger.info('[mru] External change detected -> reloading');
      this.load();
      this._onDidChangeRecentFiles.fire();
    });

    // Listen for file changes to update MRU
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === 'file') {
        this.add(editor.document.uri.fsPath);
      }
    });

    this.logger.info(`[init] MRUService created. items=${this.mruList.length}`);
  }



  private load(): void {
    // 1. Try shared storage first
    const sharedData = this.storage.get<string[]>(MRUService.STORAGE_KEY);
    if (sharedData) {
      this.mruList = sharedData;
      this.logger.info(
        `[storage] loadMRU (shared) -> count=${sharedData.length}`,
      );
      this.checkForDuplicateNames();
      return;
    }

    // 2. Migration: Check workspace state
    const workspaceStored = this.context.workspaceState.get<string[]>(
      MRUService.STORAGE_KEY,
    );
    if (workspaceStored && workspaceStored.length > 0) {
      this.logger.info(
        `[storage] Migrating MRU from workspace -> shared. Total=${workspaceStored.length}`,
      );
      this.mruList = workspaceStored;
      this.save(); // Save to shared storage immediately
      this.checkForDuplicateNames();
      return;
    }

    // 3. Migration: Check global state (legacy)
    const globalStored = this.context.globalState.get<string[]>(
      MRUService.STORAGE_KEY,
    );
    if (globalStored && globalStored.length > 0) {
      this.logger.info(`[storage] Migrating MRU from global -> shared. Total global=${globalStored.length}`);

      // Filter items belonging to current workspace
      const migrated: string[] = [];
      for (const filePath of globalStored) {
        const uri = vscode.Uri.file(filePath);
        if (vscode.workspace.getWorkspaceFolder(uri)) {
          migrated.push(filePath);
        }
      }

      if (migrated.length > 0) {
        this.mruList = migrated;
        this.save(); // Save to shared storage immediately
        this.logger.info(`[storage] Migration complete. Imported ${migrated.length} items for this workspace.`);
      } else {
        this.logger.info('[storage] Migration: No global items belong to this workspace.');
      }
    } else {
      this.logger.info('[storage] No MRU history found (shared, workspace or global)');
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
    this.storage.update(MRUService.STORAGE_KEY, this.mruList);
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
