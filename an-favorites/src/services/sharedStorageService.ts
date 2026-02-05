import fs from 'fs';
import path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../logging/logger';

/**
 * Servicio de almacenamiento que usa workspaceState por defecto para garantizar
 * aislamiento por espacio de trabajo (Root/Multi-root).
 * Si se habilita la opción de compartir entre IDEs, usa un archivo JSON dentro
 * del workspace para que distintos clientes vean los mismos datos.
 */
export class SharedStorageService {
  private static readonly SHARED_SETTING_KEY =
    'anfavorites.storage.shareAcrossIdes';
  private _onDidChange = new vscode.EventEmitter<string | undefined>();
  public readonly onDidChange = this._onDidChange.event;
  private sharedFilePath: string | null = null;
  private useSharedFile = false;
  private fileWatcher: fs.FSWatcher | null = null;
  private lastWriteTime = 0;
  private configListener: vscode.Disposable | null = null;

  constructor(
    private context: vscode.ExtensionContext,
    private logger: Logger,
  ) {
    this.applyConfig(false);
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(SharedStorageService.SHARED_SETTING_KEY)) {
        this.logger.info(
          '[SharedStorage] Configuración cambiada: reevaluando almacenamiento.',
        );
        this.applyConfig(true);
      }
    });
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
          `[SharedStorage] Error al actualizar almacenamiento compartido: ${key}`,
          error,
        );
      }
      return;
    }

    this.context.workspaceState.update(key, value).then(() => {
      // Notificar cambio interno para que las vistas se actualicen
      this._onDidChange.fire(key);
    });
  }

  public dispose(): void {
    this._onDidChange.dispose();
    this.fileWatcher?.close();
    this.fileWatcher = null;
    this.configListener?.dispose();
    this.configListener = null;
  }

  private applyConfig(forceReload: boolean): void {
    const config = vscode.workspace.getConfiguration('anfavorites.storage');
    const configExplicit = this.getExplicitSharedSetting(config);
    this.sharedFilePath = this.resolveSharedFilePath();
    const sharedEnabled =
      this.sharedFilePath && this.readSharedSetting() === true;
    const nextUseShared =
      configExplicit === true
        ? true
        : configExplicit === false
          ? false
          : sharedEnabled;

    if (nextUseShared) {
      if (this.sharedFilePath) {
        this.ensureStorageFile();
        this.writeSharedSetting(true);
        if (!this.fileWatcher) {
          this.startFileWatcher();
        }
        this.useSharedFile = true;
        this.logger.info('[SharedStorage] Usando almacenamiento compartido.', {
          filePath: this.sharedFilePath,
          source: configExplicit === true ? 'config' : 'shared-file',
        });
      } else {
        this.useSharedFile = false;
        this.logger.warn(
          '[SharedStorage] No se pudo resolver ruta para compartir entre IDEs; usando WorkspaceState.',
        );
      }
    } else {
      if (this.sharedFilePath) {
        this.ensureStorageFile();
        this.writeSharedSetting(false);
      }
      if (this.fileWatcher) {
        this.fileWatcher.close();
        this.fileWatcher = null;
      }
      this.useSharedFile = false;
      this.logger.info(
        '[SharedStorage] Compartir entre IDEs desactivado; usando WorkspaceState.',
      );
    }

    if (forceReload) {
      this._onDidChange.fire(undefined);
    }
  }

  private resolveSharedFilePath(): string | null {
    const workspaceFile = vscode.workspace.workspaceFile;
    if (workspaceFile) {
      const baseName = path.basename(workspaceFile.fsPath);
      return path.join(
        path.dirname(workspaceFile.fsPath),
        `${baseName}.anfavorites.json`,
      );
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return null;
    }

    return path.join(
      workspaceFolder.uri.fsPath,
      '.vscode',
      'anfavorites.shared.json',
    );
  }

  private ensureStorageFile(): void {
    if (!this.sharedFilePath) {
      return;
    }

    const dir = path.dirname(this.sharedFilePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (!fs.existsSync(this.sharedFilePath)) {
      fs.writeFileSync(this.sharedFilePath, JSON.stringify({}, null, 2));
    }
  }

  private startFileWatcher(): void {
    if (!this.sharedFilePath) {
      return;
    }

    const dir = path.dirname(this.sharedFilePath);
    const fileName = path.basename(this.sharedFilePath);

    this.fileWatcher = fs.watch(dir, (eventType, filename) => {
      const resolved = filename?.toString?.() ?? filename;
      if (resolved !== fileName) {
        return;
      }

      const now = Date.now();
      if (now - this.lastWriteTime < 50) {
        return;
      }

      this.logger.info('[SharedStorage] Cambio externo detectado.');
      this._onDidChange.fire(undefined);
    });
  }

  private readSharedData(): Record<string, unknown> {
    if (!this.sharedFilePath) {
      return {};
    }

    try {
      if (!fs.existsSync(this.sharedFilePath)) {
        return {};
      }

      const raw = fs.readFileSync(this.sharedFilePath, 'utf8');
      if (!raw.trim()) {
        return {};
      }
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch (error) {
      this.logger.warn('[SharedStorage] No se pudo leer el archivo compartido.', {
        error,
      });
    }

    return {};
  }

  private readSharedSetting(): boolean | undefined {
    const data = this.readSharedData();
    const settings = data?.settings;
    if (settings && typeof settings === 'object') {
      const value = (settings as Record<string, unknown>)[
        SharedStorageService.SHARED_SETTING_KEY
      ];
      if (typeof value === 'boolean') {
        return value;
      }
    }
    return undefined;
  }

  private getExplicitSharedSetting(
    config: vscode.WorkspaceConfiguration,
  ): boolean | undefined {
    const inspected = config.inspect<boolean>('shareAcrossIdes');
    if (!inspected) {
      return undefined;
    }

    if (inspected.workspaceFolderValue !== undefined) {
      return inspected.workspaceFolderValue;
    }

    if (inspected.workspaceValue !== undefined) {
      return inspected.workspaceValue;
    }

    if (inspected.globalValue !== undefined) {
      return inspected.globalValue;
    }

    return undefined;
  }

  private writeSharedSetting(value: boolean): void {
    const data = this.readSharedData();
    const settings = data.settings;
    const nextSettings =
      settings && typeof settings === 'object'
        ? (settings as Record<string, unknown>)
        : {};
    nextSettings[SharedStorageService.SHARED_SETTING_KEY] = value;
    data.settings = nextSettings;
    this.writeSharedData(data);
  }

  private writeSharedData(data: Record<string, unknown>): void {
    if (!this.sharedFilePath) {
      return;
    }

    const dir = path.dirname(this.sharedFilePath);
    const tempPath = path.join(
      dir,
      `.anfavorites.tmp.${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );

    try {
      const serialized = JSON.stringify(data, null, 2);
      fs.writeFileSync(tempPath, serialized, 'utf8');
      fs.renameSync(tempPath, this.sharedFilePath);
      this.lastWriteTime = Date.now();
    } catch (error) {
      this.logger.error(
        '[SharedStorage] No se pudo escribir el archivo compartido.',
        error,
      );
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (cleanupError) {
        this.logger.warn(
          '[SharedStorage] No se pudo limpiar el archivo temporal.',
          cleanupError,
        );
      }
    }
  }
}
