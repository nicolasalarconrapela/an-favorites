import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import * as vscode from 'vscode';
import { Logger } from '../logging/logger';

/**
 * Servicio de almacenamiento persistente Cross-IDE.
 *
 * Permite guardar favoritos en una ubicación global del SO (AppData, etc.),
 * garantizando que distintos IDEs (VS Code, Cursor) vean los mismos datos para el mismo proyecto.
 */
export class SharedStorageService {
  private static readonly SHARED_SETTING_KEY =
    'anfavorites.storage.shareAcrossIdes';

  private _onDidChange = new vscode.EventEmitter<string | undefined>();
  public readonly onDidChange = this._onDidChange.event;

  private sharedFilePath: string | null = null;
  private useSharedFile = false;

  private fileWatcher: vscode.FileSystemWatcher | null = null;
  private nodeFileWatcher: fs.FSWatcher | null = null;

  private lastWriteTime = 0;
  private debounceTimer: NodeJS.Timeout | null = null;

  // Listener de configuración para reaccionar a cambios en User Settings
  private configListener: vscode.Disposable | null = null;

  constructor(
    private context: vscode.ExtensionContext,
    private logger: Logger,
  ) {
    // Inicialización
    this.applyConfig(false);

    // Reaccionar a cambios en el setting 'anfavorites.storage.shareAcrossIdes'
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SharedStorageService.SHARED_SETTING_KEY)) {
        this.logger.info(
          '[SharedStorage] Configuración cambiada. Reevaluando.',
        );
        this.applyConfig(true);
      }
    });

    // Reaccionar a cambios de carpetas del workspace
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.logger.info(
          '[SharedStorage] Workspace folders cambiaron. Reevaluando.',
        );
        this.applyConfig(true);
      }),
    );
  }

  public get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.useSharedFile && this.sharedFilePath) {
      const data = this.readSharedData();
      const value = data[key] as T | undefined;
      if (value === undefined && defaultValue !== undefined) {
        return defaultValue;
      }
      return value ?? defaultValue;
    }

    if (defaultValue !== undefined) {
      return this.context.workspaceState.get<T>(key, defaultValue as T);
    }
    return this.context.workspaceState.get<T>(key);
  }

  public update(key: string, value: any): void {
    if (this.useSharedFile && this.sharedFilePath) {
      try {
        const data = this.readSharedData();
        data[key] = value;
        this.writeSharedData(data);
        this._onDidChange.fire(key);
      } catch (error) {
        this.logger.error(
          `[SharedStorage] Error al actualizar almacenamiento: ${key}`,
          error,
        );
      }
      return;
    }

    this.context.workspaceState.update(key, value).then(() => {
      this._onDidChange.fire(key);
    });
  }

  public dispose(): void {
    this._onDidChange.dispose();
    this.stopWatchers();
    this.configListener?.dispose();
    this.configListener = null;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }

  private stopWatchers(): void {
    this.fileWatcher?.dispose();
    this.fileWatcher = null;
    this.nodeFileWatcher?.close();
    this.nodeFileWatcher = null;
  }

  private applyConfig(forceReload: boolean): void {
    this.stopWatchers();

    const config = vscode.workspace.getConfiguration('anfavorites.storage');
    const inspect = config.inspect<boolean>('shareAcrossIdes');

    // Mover configuración del Workspace a Global si existe para no ensuciar .vscode
    if (
      inspect?.workspaceValue !== undefined ||
      inspect?.workspaceFolderValue !== undefined
    ) {
      const val = inspect.workspaceValue ?? inspect.workspaceFolderValue;
      config.update('shareAcrossIdes', val, vscode.ConfigurationTarget.Global);
      config.update(
        'shareAcrossIdes',
        undefined,
        vscode.ConfigurationTarget.Workspace,
      );
      config.update(
        'shareAcrossIdes',
        undefined,
        vscode.ConfigurationTarget.WorkspaceFolder,
      );
      this.logger.info(
        '[SharedStorage] Configuración movida a Global (User Settings) para mantener limpio el .vscode',
      );
    }

    const shouldShare = config.get<boolean>('shareAcrossIdes', true);

    this.sharedFilePath = this.resolveWorkspaceStoragePath();

    if (shouldShare && this.sharedFilePath) {
      this.ensureStorageFile();
      this.seedSharedStorageFromWorkspaceStateIfNeeded();
      this.startFileWatcher();
      this.useSharedFile = true;
      this.logger.info('[SharedStorage] Modo Cross-IDE ACTIVADO.', {
        path: this.sharedFilePath,
      });
    } else {
      this.useSharedFile = false;
      this.logger.info(
        '[SharedStorage] Modo Cross-IDE DESACTIVADO. Usando workspaceState.',
      );
    }

    if (forceReload) {
      this._onDidChange.fire(undefined);
    }
  }

  private resolveWorkspaceStoragePath(): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let workspaceIdString: string;

    if (vscode.workspace.workspaceFile) {
      workspaceIdString = vscode.workspace.workspaceFile.fsPath;
    } else if (workspaceFolders && workspaceFolders.length > 0) {
      workspaceIdString = workspaceFolders[0].uri.fsPath;
    } else {
      return null;
    }

    const normalizedPath =
      process.platform === 'win32'
        ? workspaceIdString.toLowerCase()
        : workspaceIdString;

    const hash = crypto.createHash('md5').update(normalizedPath).digest('hex');

    const homedir = os.homedir();
    const platform = process.platform;
    let basePath: string;

    if (platform === 'win32') {
      basePath =
        process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
    } else if (platform === 'darwin') {
      basePath = path.join(homedir, 'Library', 'Application Support');
    } else {
      basePath = path.join(homedir, '.config');
    }

    return path.join(
      basePath,
      'AnAppWiLos',
      'AnFavorites',
      'workspaces',
      `workspace_${hash}.json`,
    );
  }

  private ensureStorageFile(): void {
    if (!this.sharedFilePath) {
      return;
    }

    const dir = path.dirname(this.sharedFilePath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        this.logger.error(
          `[SharedStorage] No se pudo crear directorio: ${dir}`,
          error,
        );
      }
    }

    if (!fs.existsSync(this.sharedFilePath)) {
      try {
        fs.writeFileSync(this.sharedFilePath, JSON.stringify({}, null, 2));
      } catch (error) {
        this.logger.error(
          `[SharedStorage] No se pudo iniciar archivo: ${this.sharedFilePath}`,
          error,
        );
      }
    }
  }

  private seedSharedStorageFromWorkspaceStateIfNeeded(): void {
    if (!this.sharedFilePath) {
      return;
    }

    const sharedData = this.readSharedData();
    if (Object.keys(sharedData).length > 0) {
      return;
    }

    const favorites = this.context.workspaceState.get(
      'anfavorites.favorites.v2',
    );
    const groups = this.context.workspaceState.get('anfavorites.groups');

    if (favorites === undefined && groups === undefined) {
      return;
    }

    const hydratedData: Record<string, unknown> = {};
    if (favorites !== undefined) {
      hydratedData['anfavorites.favorites.v2'] = favorites;
    }
    if (groups !== undefined) {
      hydratedData['anfavorites.groups'] = groups;
    }

    this.writeSharedData(hydratedData);
    this.logger.info('[SharedStorage] WorkspaceState migrado a almacenamiento compartido.', {
      path: this.sharedFilePath,
      keys: Object.keys(hydratedData),
    });
  }

  private startFileWatcher(): void {
    if (!this.sharedFilePath) {
      return;
    }

    try {
      const dir = path.dirname(this.sharedFilePath);
      const fileName = path.basename(this.sharedFilePath);
      const pattern = new vscode.RelativePattern(
        vscode.Uri.file(dir),
        fileName,
      );
      this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

      const fireChange = () => {
        try {
          this.handleExternalChange('VS Code Watcher');
        } catch (error) {
          this.logger.error('[SharedStorage] File watcher callback failed', error);
        }
      };

      this.fileWatcher.onDidChange(fireChange);
      this.fileWatcher.onDidCreate(fireChange);
      this.fileWatcher.onDidDelete(fireChange);
    } catch (error) {
      // Ignorar
    }

    try {
      if (fs.existsSync(this.sharedFilePath)) {
        this.nodeFileWatcher = fs.watch(this.sharedFilePath, (eventType) => {
          if (eventType === 'change' || eventType === 'rename') {
            try {
              this.handleExternalChange('Node fs.watch');
            } catch (error) {
              this.logger.error('[SharedStorage] Node watcher callback failed', error);
            }
          }
        });
      }
    } catch (error) {
      // Ignorar
    }
  }

  private handleExternalChange(source: string): void {
    const now = Date.now();
    if (now - this.lastWriteTime < 250) {
      return;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      try {
        this.logger.info(
          `[SharedStorage] Cambio externo detectado (${source}). Recargando.`,
        );
        this._onDidChange.fire(undefined);
      } catch (error) {
        this.logger.error('[SharedStorage] External change notification failed', {
          source,
          error,
        });
      } finally {
        this.debounceTimer = null;
      }
    }, 100);
  }

  private readSharedData(): Record<string, unknown> {
    if (!this.sharedFilePath) return {};
    try {
      if (!fs.existsSync(this.sharedFilePath)) return {};
      const raw = fs.readFileSync(this.sharedFilePath, 'utf8');
      if (!raw.trim()) return {};
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object')
        return parsed as Record<string, unknown>;
    } catch (error) {
      this.logger.warn('[SharedStorage] Error lectura', { error });
    }
    return {};
  }

  private writeSharedData(data: Record<string, unknown>): void {
    if (!this.sharedFilePath) return;

    const dir = path.dirname(this.sharedFilePath);
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch {}
    }

    const tempPath = path.join(
      dir,
      `.tmp_${path.basename(this.sharedFilePath)}_${Date.now()}`,
    );

    try {
      const serialized = JSON.stringify(data, null, 2);
      fs.writeFileSync(tempPath, serialized, 'utf8');
      try {
        fs.renameSync(tempPath, this.sharedFilePath);
      } catch {
        fs.copyFileSync(tempPath, this.sharedFilePath);
        fs.unlinkSync(tempPath);
      }
      this.lastWriteTime = Date.now();
    } catch (error) {
      this.logger.error('[SharedStorage] Error escritura', error);
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch {}
    }
  }
}
