import * as vscode from 'vscode';
import * as path from 'path';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { MRUService } from '../services/mruService';

type QuickOpenItem = vscode.QuickPickItem;

/**
 * Type guard: separadores y QuickPickItem genéricos no tienen resourceUri.
 */
function isFileItem(item: QuickOpenItem): item is FileQuickPickItem {
  return typeof (item as any)?.resourceUri?.fsPath === 'string';
}

function isWindows(): boolean {
  return process.platform === 'win32';
}

function normalizeFsPath(p: string): string {
  const n = path.normalize(p);
  return isWindows() ? n.toLowerCase() : n;
}

/**
 * Convierte un valor cualquiera del MRU en Uri file segura (o null si es inválida).
 */
function toSafeFileUri(value: unknown, logger?: any): vscode.Uri | null {
  if (typeof value !== 'string') {
    logger?.warn?.('MRU entry is not a string', { value });
    return null;
  }

  const p = value.trim();
  if (!p) return null;

  try {
    return vscode.Uri.file(p);
  } catch (e) {
    logger?.warn?.('Failed to build Uri.file from MRU entry', { value: p, error: e });
    return null;
  }
}

/**
 * Basename a prueba de bombas: evita crashear si uri.fsPath es undefined.
 */
function safeBasenameFromUri(uri: vscode.Uri): string {
  const fsPath = (uri as any)?.fsPath;
  if (typeof fsPath === 'string' && fsPath.length > 0) {
    return path.basename(fsPath);
  }

  const uriPath = (uri as any)?.path;
  if (typeof uriPath === 'string' && uriPath.length > 0) {
    return path.posix.basename(uriPath);
  }

  return '(sin nombre)';
}

/**
 * Ruta relativa al workspace (y si es multi-root, prefija con el nombre del root).
 */
function workspaceRelativeLabel(uri: vscode.Uri): { rel: string; rootName?: string } {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    // Sin workspace abierto: muestra lo que haya
    const fsPath = (uri as any)?.fsPath;
    return { rel: typeof fsPath === 'string' && fsPath ? fsPath : uri.toString() };
  }

  const folder = vscode.workspace.getWorkspaceFolder(uri);

  // asRelativePath puede devolver absoluto si está fuera del workspace
  const rel = vscode.workspace.asRelativePath(uri, false);

  if (folders.length > 1 && folder) {
    return { rel, rootName: folder.name };
  }

  return { rel };
}

/**
 * (Opcional) Filtra URIs que no existen (evita MRU con rutas muertas).
 * Si no lo quieres, deja la función pero no la uses.
 */
async function filterExistingFiles(uris: vscode.Uri[]): Promise<vscode.Uri[]> {
  const results: vscode.Uri[] = [];
  for (const u of uris) {
    if (u.scheme !== 'file') continue;
    try {
      await vscode.workspace.fs.stat(u);
      results.push(u);
    } catch {
      // ignorar
    }
  }
  return results;
}

class FileQuickPickItem implements vscode.QuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  buttons?: vscode.QuickInputButton[];
  iconPath?: vscode.ThemeIcon;
  kind?: vscode.QuickPickItemKind;

  // Props propias
  resourceUri: vscode.Uri;
  isFavorite: boolean;

  constructor(params: { uri: vscode.Uri; isFavorite: boolean; isRecentlyOpened?: boolean }) {
    const { uri, isFavorite, isRecentlyOpened = false } = params;

    this.resourceUri = uri;
    this.isFavorite = isFavorite;

    // Label: nombre fichero (a prueba de bombas)
    this.label = safeBasenameFromUri(uri);

    // Description/detail: RELATIVO al proyecto (workspace)
    const { rel, rootName } = workspaceRelativeLabel(uri);

    // Aquí mandas lo importante: ruta relativa para el usuario
    this.description = rootName ? `${rootName} • ${rel}` : rel;

    // Detail opcional útil para búsquedas: carpeta padre relativa
    const relNorm = rel.replace(/\\/g, '/');
    const parentRel = relNorm.includes('/') ? relNorm.slice(0, relNorm.lastIndexOf('/')) : '';
    // this.detail = parentRel ? `Carpeta: ${parentRel}` : undefined;

    // Indicador de “reciente”
    if (isRecentlyOpened) {
      this.description = `🕘 ${this.description}`;
    }

    this.updateIcon();
  }

  updateIcon(): void {
    // Izquierda: estrella o fichero
    this.iconPath = this.isFavorite ? new vscode.ThemeIcon('star-full') : new vscode.ThemeIcon('file');

    // Derecha: botón interactivo
    this.buttons = [
      {
        iconPath: this.isFavorite ? new vscode.ThemeIcon('star-full') : new vscode.ThemeIcon('star-empty'),
        tooltip: this.isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos',
      },
    ];
  }
}

export function registerQuickOpenCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any,
  mruService: MRUService
): void {
  const disposable = vscode.commands.registerCommand('anfavorites.quickOpen', async () => {
    const quickPick = vscode.window.createQuickPick<QuickOpenItem>();

    quickPick.placeholder = 'Buscar archivos por nombre';
    quickPick.matchOnDescription = true;
    quickPick.matchOnDetail = true;
    quickPick.canSelectMany = false;

    logger.debug('QuickOpen triggered');

    const disposables: vscode.Disposable[] = [];

    const safeDispose = () => {
      try {
        disposables.forEach(d => d.dispose());
      } finally {
        quickPick.dispose();
      }
    };

    disposables.push(
      quickPick.onDidHide(() => {
        safeDispose();
      })
    );

    quickPick.show();
    quickPick.busy = true;

    try {
      // 1) Recientes (MRU) — sanitize total
      const rawRecent: unknown[] = (mruService.getRecentFiles?.() as any) ?? [];
      const recentUrisUnsafe = rawRecent
        .map(v => toSafeFileUri(v, logger))
        .filter((u): u is vscode.Uri => !!u);

      // Filtrar: SOLO archivos que pertenezcan al workspace abierto actualmente.
      // Esto evita ver archivos recientes de otros proyectos.
      const recentUris = recentUrisUnsafe.filter(u => {
        return u.scheme === 'file' && !!vscode.workspace.getWorkspaceFolder(u);
      });

      const recentNormSet = new Set(recentUris.map(u => normalizeFsPath(u.fsPath)));

      // 2) Todos los ficheros del workspace (findFiles ya respeta el workspace)
      const allUris = await vscode.workspace.findFiles('**/*', '**/node_modules/**');

      // 3) Items
      const recentItems: FileQuickPickItem[] = recentUris.map(uri => {
        const isFav = favoritesProvider.hasFavorite(uri);
        return new FileQuickPickItem({ uri, isFavorite: isFav, isRecentlyOpened: true });
      });

      const otherItems: FileQuickPickItem[] = allUris
        .filter(uri => !recentNormSet.has(normalizeFsPath(uri.fsPath)))
        .map(uri => {
          const isFav = favoritesProvider.hasFavorite(uri);
          return new FileQuickPickItem({ uri, isFavorite: isFav, isRecentlyOpened: false });
        });

      // 4) Combinar con separadores (SIN any)
      const items: QuickOpenItem[] = [];

      if (recentItems.length > 0) {
        items.push({ label: 'Recientemente abiertos', kind: vscode.QuickPickItemKind.Separator });
        items.push(...recentItems);
      }

      items.push({ label: 'Archivos', kind: vscode.QuickPickItemKind.Separator });
      items.push(...otherItems);

      quickPick.items = items;
    } catch (error) {
      logger.error('Error loading files for QuickOpen', error);
      quickPick.items = [
        { label: 'Error cargando archivos (ver logs)', kind: vscode.QuickPickItemKind.Separator },
      ];
    } finally {
      quickPick.busy = false;
    }

    // Enter: abrir fichero
    disposables.push(
      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        if (!selected || !isFileItem(selected)) return;

        try {
          mruService.add(selected.resourceUri.fsPath);
        } catch (e) {
          logger.warn?.('Failed to add MRU item', e);
        }

        await vscode.window.showTextDocument(selected.resourceUri);
        quickPick.hide();
      })
    );

    // Botón estrella: toggle favorito
    disposables.push(
      quickPick.onDidTriggerItemButton(async e => {
        const item = e.item;
        if (!isFileItem(item)) return;

        const uri = item.resourceUri;

        try {
          if (item.isFavorite) {
            favoritesProvider.removeFavorite(uri);
            item.isFavorite = false;
          } else {
            favoritesProvider.addFavorite(uri);
            item.isFavorite = true;
          }

          item.updateIcon();

          // Mantener scroll/posición: refrescar lista + marcar como activo
          const currentItems = quickPick.items;
          const index = currentItems.indexOf(item);
          if (index !== -1) {
            const newItems = [...currentItems];
            newItems[index] = item;
            quickPick.items = newItems;
            quickPick.activeItems = [item];
          }
        } catch (error) {
          logger.error('Error toggling favorite', error);
        }
      })
    );
  });

  context.subscriptions.push(disposable);
  logger.debug('quickOpen command registered');
}
