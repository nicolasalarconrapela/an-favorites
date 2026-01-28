import * as vscode from 'vscode';
import { Logger } from '../logging/logger';

/**
 * Servicio de almacenamiento que ahora usa workspaceState para garantizar
 * aislamiento por espacio de trabajo (Root/Multi-root).
 * Anteriormente usaba un archivo JSON global, pero se ha migrado a
 * memoria por workspace a petición del usuario.
 */
export class SharedStorageService {
  private _onDidChange = new vscode.EventEmitter<string | undefined>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(
    private context: vscode.ExtensionContext,
    private logger: Logger,
  ) {
    this.logger.info(
      '[SharedStorage] Inicializado con WorkspaceState (Memoria por Root).',
    );
  }

  public get<T>(key: string, defaultValue?: T): T | undefined {
    if (defaultValue !== undefined) {
      return this.context.workspaceState.get<T>(key, defaultValue as T);
    }
    return this.context.workspaceState.get<T>(key);
  }

  public update(key: string, value: any): void {
    this.context.workspaceState.update(key, value).then(() => {
      // Notificar cambio interno para que las vistas se actualicen
      this._onDidChange.fire(key);
    });
  }

  public dispose(): void {
    this._onDidChange.dispose();
  }
}
