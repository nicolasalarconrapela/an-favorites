import * as vscode from 'vscode';
import { Logger } from '../logging/logger';
import { SharedStorageService } from './sharedStorageService';
import { runWithConcurrency } from '../utils/concurrency';

const VALIDATION_CONCURRENCY = 12;

interface LineFavoriteEntry {
  path: string;
  line: number;
  addedAt: number;
}

type LineFavoriteMap = Map<number, number>;

export class LineFavoritesService implements vscode.Disposable {
  private static readonly STORAGE_KEY = 'anfavorites.lineFavorites.v1';
  private readonly favorites = new Map<string, LineFavoriteMap>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(
    private storage: SharedStorageService,
    private logger: Logger,
  ) {
    this.loadFavorites();
    this.disposables.push(
      this.storage.onDidChange((key) => {
        if (!key || key === LineFavoritesService.STORAGE_KEY) {
          this.logger.info('[lineFavorites] External change detected -> reload');
          this.reload();
        }
      }),
    );
    this.logger.info(
      `[lineFavorites] Service initialized. entries=${this.favorites.size}`,
    );
  }

  public reload(emitEvent: boolean = true): void {
    this.favorites.clear();
    this.loadFavorites();
    if (emitEvent) {
      this._onDidChange.fire();
    }
  }

  public toggleLineFavorite(uri: vscode.Uri, line: number): boolean {
    if (line < 1) {
      this.logger.warn('[lineFavorites] Ignoring invalid line', { line });
      return false;
    }

    const filePath = uri.fsPath;
    const existing = this.favorites.get(filePath);

    if (existing?.has(line)) {
      existing.delete(line);
      if (existing.size === 0) {
        this.favorites.delete(filePath);
      }
      this.saveFavorites();
      this._onDidChange.fire();
      return false;
    }

    const lineMap = existing ?? new Map<number, number>();
    lineMap.set(line, Date.now());
    this.favorites.set(filePath, lineMap);

    this.saveFavorites();
    this._onDidChange.fire();
    return true;
  }

  public hasLineFavorite(uri: vscode.Uri, line: number): boolean {
    return this.favorites.get(uri.fsPath)?.has(line) ?? false;
  }

  public getLineFavorites(uri: vscode.Uri): number[] {
    const entries = this.favorites.get(uri.fsPath);
    if (!entries) return [];
    return Array.from(entries.keys()).sort((a, b) => a - b);
  }

  public getAllFavorites(): LineFavoriteEntry[] {
    const result: LineFavoriteEntry[] = [];
    this.favorites.forEach((lineMap, filePath) => {
      lineMap.forEach((addedAt, line) => {
        result.push({ path: filePath, line, addedAt });
      });
    });

    return result.sort((a, b) => b.addedAt - a.addedAt);
  }

  public getFavoritePaths(): string[] {
    return Array.from(this.favorites.keys());
  }

  public removeLineFavorite(uri: vscode.Uri, line: number): void {
    const filePath = uri.fsPath;
    const entries = this.favorites.get(filePath);
    if (!entries || !entries.has(line)) {
      return;
    }

    entries.delete(line);
    if (entries.size === 0) {
      this.favorites.delete(filePath);
    }

    this.saveFavorites();
    this._onDidChange.fire();
  }

  public updatePath(oldPath: string, newPath: string): void {
    const entries = this.favorites.get(oldPath);
    if (!entries) {
      return;
    }

    this.favorites.delete(oldPath);
    this.favorites.set(newPath, entries);
    this.saveFavorites();
    this._onDidChange.fire();
  }

  public async validateLineFavorites(): Promise<void> {
    await this.validateLineFavoritesForPaths(this.getFavoritePaths());
  }

  public async validateLineFavoritesForPaths(
    filePaths: string[],
  ): Promise<void> {
    const uniquePaths = Array.from(
      new Set(filePaths.filter((filePath) => this.favorites.has(filePath))),
    );

    if (uniquePaths.length === 0) {
      return;
    }

    const toDelete: string[] = [];
    const t0 = Date.now();

    await runWithConcurrency(
      uniquePaths,
      VALIDATION_CONCURRENCY,
      async (filePath) => {
        try {
          const uri = vscode.Uri.file(filePath);
          await vscode.workspace.fs.stat(uri);
        } catch {
          toDelete.push(filePath);
        }
      },
    );

    this.logger.info(
      `[lineFavorites] validateLineFavoritesForPaths done. processed=${uniquePaths.length} missing=${toDelete.length} durationMs=${Date.now() - t0}`,
    );

    if (toDelete.length > 0) {
      toDelete.forEach((filePath) => this.favorites.delete(filePath));
      this.saveFavorites();
      this._onDidChange.fire();
    }
  }

  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables.length = 0;
    this._onDidChange.dispose();
  }

  private loadFavorites(): void {
    const stored = this.storage.get<LineFavoriteEntry[]>(
      LineFavoritesService.STORAGE_KEY,
    );

    if (!stored || stored.length === 0) {
      this.logger.info('[lineFavorites] No stored line favorites found');
      return;
    }

    stored.forEach((entry) => {
      if (!entry.path || !entry.line || entry.line < 1) {
        return;
      }
      const lineMap = this.favorites.get(entry.path) ?? new Map();
      lineMap.set(entry.line, entry.addedAt ?? Date.now());
      this.favorites.set(entry.path, lineMap);
    });

    this.logger.info(
      `[lineFavorites] Loaded line favorites. entries=${stored.length}`,
    );
  }

  private saveFavorites(): void {
    const serialized: LineFavoriteEntry[] = [];

    this.favorites.forEach((lineMap, filePath) => {
      lineMap.forEach((addedAt, line) => {
        serialized.push({ path: filePath, line, addedAt });
      });
    });

    this.storage.update(LineFavoritesService.STORAGE_KEY, serialized);
  }
}
