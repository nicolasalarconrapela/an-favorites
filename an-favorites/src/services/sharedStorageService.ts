import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Logger } from '../logging/logger';

/**
 * Servicio que gestiona un almacenamiento persistente compartido entre instancias (VS Code / AnGravity).
 * Utiliza un archivo JSON en el directorio home del usuario (~/.an-favorites/storage.json).
 */
export class SharedStorageService {
  private static readonly DIR_NAME = '.an-favorites';
  private static readonly FILE_NAME = 'storage.json';

  private storagePath: string;
  private data: Record<string, any> = {};
  private watcher: fs.FSWatcher | null = null;

  // Emisor de eventos para notificar cambios externos
  private _onDidChange = new vscode.EventEmitter<string | undefined>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(private logger: Logger) {
    const homeDir = os.homedir();
    const storageDir = path.join(homeDir, SharedStorageService.DIR_NAME);
    this.storagePath = path.join(storageDir, SharedStorageService.FILE_NAME);

    this.logger.info(`[SharedStorage] Inicializando en: ${this.storagePath}`);

    this.ensureStorageExists(storageDir);
    this.load();
    this.watchFile();
  }

  private ensureStorageExists(dir: string): void {
    try {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!fs.existsSync(this.storagePath)) {
        fs.writeFileSync(this.storagePath, JSON.stringify({}, null, 2), 'utf8');
      }
    } catch (error) {
      this.logger.error(
        '[SharedStorage] Error asegurando existencia del archivo',
        error,
      );
    }
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const content = fs.readFileSync(this.storagePath, 'utf8');
        this.data = JSON.parse(content);
      } else {
        this.data = {};
      }
      this.logger.debug(
        `[SharedStorage] Datos cargados. Keys: ${Object.keys(this.data).length}`,
      );
    } catch (error) {
      this.logger.error('[SharedStorage] Error cargando datos', error);
      this.data = {};
    }
  }

  private watchFile(): void {
    try {
      let fsWait: NodeJS.Timeout | null = null;
      this.watcher = fs.watch(this.storagePath, (eventType) => {
        if (eventType === 'change') {
          // Debounce simple para evitar lecturas múltiples rápidas
          if (fsWait) return;
          fsWait = setTimeout(() => {
            fsWait = null;
            this.logger.info(
              '[SharedStorage] Cambio detectado en disco, recargando...',
            );
            this.load();
            // Notificar que TODO ha cambiado (undefined key implica refresh general)
            this._onDidChange.fire(undefined);
          }, 100);
        }
      });
    } catch (error) {
      this.logger.warn(
        '[SharedStorage] No se pudo establecer watcher (puede ser normal en algunos FS)',
        error,
      );
    }
  }

  /**
   * Obtiene un valor del almacenamiento compartido.
   * @param key Clave a recuperar
   * @param defaultValue Valor por defecto si no existe
   */
  public get<T>(key: string, defaultValue?: T): T | undefined {
    return this.data[key] !== undefined ? this.data[key] : defaultValue;
  }

  /**
   * Guarda un valor en el almacenamiento compartido y lo persiste a disco.
   * @param key Clave a guardar
   * @param value Valor a guardar
   */
  public update(key: string, value: any): void {
    this.data[key] = value;
    this.save();
    // No disparamos onDidChange aquí porque el cambio es local y síncrono,
    // quien llama a update ya sabe que actualizó.
  }

  private save(): void {
    try {
      // Escritura atómica (no garantizada 100% sin librerías extra, pero suficiente aquí)
      const content = JSON.stringify(this.data, null, 2);
      fs.writeFileSync(this.storagePath, content, 'utf8');
    } catch (error) {
      this.logger.error('[SharedStorage] Error guardando datos', error);
    }
  }

  public dispose(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
