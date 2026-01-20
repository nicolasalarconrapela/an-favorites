import * as vscode from 'vscode';

export class MRUService {
  private static readonly STORAGE_KEY = 'anfavorites.mru.history';
  private static readonly MAX_ENTRIES = 50;
  private mruList: string[] = [];

  private _onDidChangeRecentFiles = new vscode.EventEmitter<void>();
  public readonly onDidChangeRecentFiles = this._onDidChangeRecentFiles.event;

  constructor(private context: vscode.ExtensionContext) {
    this.load();

    // Listen for file changes to update MRU
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && editor.document.uri.scheme === 'file') {
        this.add(editor.document.uri.fsPath);
      }
    });
  }

  private load(): void {
    const stored = this.context.globalState.get<string[]>(MRUService.STORAGE_KEY);
    if (stored) {
      this.mruList = stored;
    }
  }

  private save(): void {
    this.context.globalState.update(MRUService.STORAGE_KEY, this.mruList);
  }

  public add(fsPath: string): void {
    // Remove if already exists to move it to top
    this.mruList = this.mruList.filter(p => p !== fsPath);

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
    this.mruList = [];
    this.save();
    this._onDidChangeRecentFiles.fire();
  }

  public async validateFiles(): Promise<void> {
    const originalLength = this.mruList.length;
    const validFiles: string[] = [];

    for (const fsPath of this.mruList) {
      try {
        const uri = vscode.Uri.file(fsPath);
        await vscode.workspace.fs.stat(uri);
        validFiles.push(fsPath);
      } catch (error) {
      }
    }

    if (validFiles.length !== originalLength) {
      this.mruList = validFiles;
      this.save();
      this._onDidChangeRecentFiles.fire();
    }
  }
}
