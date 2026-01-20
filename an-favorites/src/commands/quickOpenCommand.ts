import * as vscode from 'vscode';
import * as path from 'path';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { MRUService } from '../services/mruService';

type QuickOpenItem = vscode.QuickPickItem;

/**
 * Type guard: separadores y QuickPickItem genéricos no tienen resourceUri.
 */
function isFileItem(item: vscode.QuickPickItem): item is FileQuickPickItem {
  return typeof (item as any)?.resourceUri?.fsPath === 'string';
}

type FavoritesAction = 'clearRecents';

interface ActionQuickPickItem extends vscode.QuickPickItem {
  action: FavoritesAction;
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
  isRecentlyOpened: boolean;

  private _fullPathLabel: string;
  private _dirPathLabel: string;

  constructor(params: { uri: vscode.Uri; isFavorite: boolean; isRecentlyOpened?: boolean }) {
    const { uri, isFavorite, isRecentlyOpened = false } = params;

    this.resourceUri = uri;
    this.isFavorite = isFavorite;
    this.isRecentlyOpened = isRecentlyOpened;

    // Label base: nombre fichero
    const baseName = safeBasenameFromUri(uri);

    // Alineación visual: SIEMPRE mostramos una estrella (llena o vacía)
    // Esto crea una "columna" virtual uniforme junto al icono de archivo
    const starIcon = isFavorite ? '$(star-full)' : '$(star-empty)';
    this.label = `${starIcon} ${baseName}`;

    // Description/detail: RELATIVO al proyecto (workspace)
    const { rel, rootName } = workspaceRelativeLabel(uri);

    // Ruta completa
    this._fullPathLabel = rootName ? `${rootName} • ${rel}` : rel;

    // Ruta solo directorio (si es root, queda vacío o solo rootName)
    const dir = path.dirname(rel);
    // Si dirname es '.' (archivo en raíz) o vacío, mostrar cadena vacía para evitar '.'
    const cleanDir = (dir === '.' || dir === '') ? '' : dir;

    this._dirPathLabel = rootName
      ? (cleanDir ? `${rootName} • ${cleanDir}` : rootName)
      : cleanDir;

    // Default to dir path
    this.description = this._dirPathLabel;

    this.updateIcon();

    // Default to no-duplicate mode
    this.setShowDescription(false);
  }

  public setShowDescription(isDuplicate: boolean): void {
    const text = isDuplicate ? this._fullPathLabel : this._dirPathLabel;

    // Si hay texto, lo mostramos. Si es reciente, añadimos reloj.
    // Si no hay texto (archivo en raiz sin duplicado), y es reciente, solo reloj.
    // Si no hay texto y no es reciente, undefined (oculto).

    if (this.isRecentlyOpened) {
      this.description = text ? `🕘 ${text}` : '🕘';
    } else {
      this.description = text || undefined;
    }
  }

  updateIcon(): void {
    // 1. Icono Izquierdo: SIEMPRE el de archivo (ThemeIcon.File) para respetar el tema de iconos del usuario
    this.iconPath = vscode.ThemeIcon.File;

    // 2. Label: Actualizamos para mostrar estrella llena o vacía
    const baseName = safeBasenameFromUri(this.resourceUri);
    const starIcon = this.isFavorite ? '$(star-full) ' : '     ';
    this.label = `${starIcon} ${baseName}`;

    // 3. Derecha: botón interactivo (acción al hacer hover)
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

    // Configurar ignoreFocusOut desde settings
    const config = vscode.workspace.getConfiguration('anfavorites.quickOpen');
    quickPick.ignoreFocusOut = config.get<boolean>('ignoreFocusOut', false);

    logger.debug('QuickOpen triggered');

    await Promise.all([
      favoritesProvider.validateFavorites(),
      mruService.validateFiles()
    ]);

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

    // Cache de archivos para no volver a buscar en disco cada vez que se actualiza la UI
    // Esto es vital para que al borrar el texto de búsqueda la respuesta sea instantánea
    let cachedAllFileItems: FileQuickPickItem[] | null = null;

    // Function to build/rebuild items
    const buildItems = async (loadAllFiles: boolean = false): Promise<void> => {
      // No poner busy true si estamos tecleando para evitar parpadeos,
      // a menos que sea la carga pesada inicial
      if (loadAllFiles && !cachedAllFileItems) {
        quickPick.busy = true;
      }

      try {
        const isSearching = quickPick.value.length > 0;

        // 0) Reload favorites from storage to ensure we have the latest data
        favoritesProvider.reloadFavorites();

        // 0.1) Read configuration values
        const config = vscode.workspace.getConfiguration('anfavorites.quickOpen');
        const maxRecentFavorites = config.get<number>('maxRecentFavorites', 3);
        const maxRecentFiles = config.get<number>('maxRecentFiles', 3);

        logger.debug(`QuickOpen config: maxRecentFavorites=${maxRecentFavorites}, maxRecentFiles=${maxRecentFiles}`);

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

        // 2) Get recent favorites (usar configuración)
        const recentFavUris = favoritesProvider.getRecentFavorites(maxRecentFavorites).filter(uri => {
          return uri.scheme === 'file' && !!vscode.workspace.getWorkspaceFolder(uri);
        });
        const recentFavNormSet = new Set(recentFavUris.map(u => normalizeFsPath(u.fsPath)));

        // 3) Items
        const recentFavItems: FileQuickPickItem[] = recentFavUris.map(uri => {
          return new FileQuickPickItem({ uri, isFavorite: true, isRecentlyOpened: false });
        });

        const recentItems: FileQuickPickItem[] = recentUris
          .filter(uri => !recentFavNormSet.has(normalizeFsPath(uri.fsPath))) // Exclude if already in recent favorites
          .slice(0, maxRecentFiles) // Limitar a la cantidad configurada
          .map(uri => {
            const isFav = favoritesProvider.hasFavorite(uri);
            return new FileQuickPickItem({ uri, isFavorite: isFav, isRecentlyOpened: true });
          });

        // 4) Combinar con separadores (SIN any)
        const items: QuickOpenItem[] = [];

        // First section: Favoritos (Siempre visible)
        const hasFavoriteItems = recentFavItems.length > 0;
        items.push({
          label: hasFavoriteItems ? 'Favoritos' : 'Aún no hay favoritos',
          kind: vscode.QuickPickItemKind.Separator
        });

        if (hasFavoriteItems) {
          items.push(...recentFavItems);
        } else if (!isSearching) {
          // Solo mostrar el placeholder si NO se está buscando
          items.push({ label: 'Busque un archivo para añadirlo a favoritos en icono de la derecha', description: '', detail: '' });
        }

        // Second section: Recientes (Recientemente Abierto) - Siempre visible
        const hasRecentFiles = recentUris.length > 0;

        items.push({
          label: hasRecentFiles ? 'Recientes' : 'No hay recientes nuevos',
          kind: vscode.QuickPickItemKind.Separator
        });

        if (hasRecentFiles) {
          // Acción "Limpiar" - solo mostrar si hay archivos en MRU
          const clearRecentsItem: ActionQuickPickItem = {
            label: '\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t       $(trash) Limpiar',
            action: 'clearRecents'
          };

          items.push(clearRecentsItem);

          // Luego los ítems recientes reales
          items.push(...recentItems);
        } else if (!isSearching) {
           // Solo mostrar el placeholder si NO se está buscando
          items.push({ label: '', description: '', detail: '' });
        }

        // Third section: Archivos (All other files) - Solo cargar si se solicita Y estamos buscando
        let otherItems: FileQuickPickItem[] = [];

        if (loadAllFiles && isSearching) {
          // Usar caché si está disponible
          if (!cachedAllFileItems) {
             const allUris = await vscode.workspace.findFiles('**/*', '**/node_modules/**');
             cachedAllFileItems = allUris.map(uri => {
                // Creamos los items base, el estado de favorito se actualiza abajo dinámicamente
                // Nota: para la caché inicial asumimos isFavorite false, luego se recalcula
                return new FileQuickPickItem({ uri, isFavorite: false, isRecentlyOpened: false });
             });
          }

          if (cachedAllFileItems) {
            // Filtrar y actualizar estado favorito en tiempo real
            otherItems = cachedAllFileItems
              .filter(item => {
                const normalizedPath = normalizeFsPath(item.resourceUri.fsPath);
                return !recentNormSet.has(normalizedPath) && !recentFavNormSet.has(normalizedPath);
              })
              .map(item => {
                 // Actualizar estado de favorito antes de mostrar
                 const isFav = favoritesProvider.hasFavorite(item.resourceUri);
                 if (item.isFavorite !== isFav) {
                    item.isFavorite = isFav;
                    item.updateIcon(); // Regenerar label e icono
                 }
                 return item;
              });
          }
        }

        // --- Collision detection to toggle path visibility ---
        const allFileItems = [...recentFavItems, ...recentItems, ...otherItems];
        const nameCounts = new Map<string, number>();

        for (const item of allFileItems) {
          const name = safeBasenameFromUri(item.resourceUri);
          nameCounts.set(name, (nameCounts.get(name) || 0) + 1);
        }

        for (const item of allFileItems) {
          const name = safeBasenameFromUri(item.resourceUri);
          item.setShowDescription((nameCounts.get(name) || 0) > 1);
        }
        // ----------------------------------------------------

        if (otherItems.length > 0) {
          items.push({ label: 'Archivos', kind: vscode.QuickPickItemKind.Separator });
          items.push(...otherItems);
        }

        quickPick.items = items;
      } catch (error) {
        logger.error('Error loading files for QuickOpen', error);
        quickPick.items = [
          { label: 'Error cargando archivos (ver logs)', kind: vscode.QuickPickItemKind.Separator },
        ];
      } finally {
        quickPick.busy = false;
      }
    };

    // Initial load - NO cargamos todos los archivos al inicio
    quickPick.show();
    await buildItems(false);

    // Listen to user input to load all files when searching OR toggle placeholders
    let allFilesLoaded = false;
    let previousValue = '';

    disposables.push(
      quickPick.onDidChangeValue(async (value) => {
        const wasEmpty = previousValue.length === 0;
        const isEmpty = value.length === 0;
        previousValue = value;

        // 1. Carga diferida de archivos (primera búsqueda)
        if (!isEmpty && !allFilesLoaded) {
          logger.debug('User started searching, loading all files...');
          allFilesLoaded = true;
          // Esto ocultará placeholders y cargará archivos
          await buildItems(true);
          return;
        }

        // 2. Si cambia el estado (empezó a buscar O borró la búsqueda)
        // reconstruimos para mostrar/ocultar los placeholders
        if (wasEmpty !== isEmpty) {
           await buildItems(allFilesLoaded);
        }
      })
    );

    // Listen to favorites changes and rebuild items in real-time
    disposables.push(
      favoritesProvider.onDidChangeTreeData(async () => {
        logger.debug('Favorites changed, rebuilding QuickOpen items');
        await buildItems(allFilesLoaded);
      })
    );

    // Listen to MRU changes and rebuild items in real-time
    disposables.push(
      mruService.onDidChangeRecentFiles(async () => {
        logger.debug('MRU list changed, rebuilding QuickOpen items');
        await buildItems(allFilesLoaded);
      })
    );

    // Enter: abrir fichero o ejecutar acción
    disposables.push(
      quickPick.onDidAccept(async () => {
        const selected = quickPick.selectedItems[0];
        if (!selected) return;

        const actionItem = selected as unknown as ActionQuickPickItem;
        if (actionItem.action === 'clearRecents') {
          mruService.clear();
          logger.info('Recent files list cleared from Quick Open');
          // Rebuild the picker without closing it
          allFilesLoaded = false; // Reset to avoid loading all files again
          await buildItems(false);
          vscode.window.showInformationMessage('Lista de archivos recientes limpiada');
          return;
        }


        // Normal file selection
        if (!isFileItem(selected)) return;

        // Verify file exists before attempting to open
        try {
          await vscode.workspace.fs.stat(selected.resourceUri);
        } catch (error) {
          // File doesn't exist
          logger.warn(`File no longer exists: ${selected.resourceUri.fsPath}`);
          vscode.window.showErrorMessage(`El archivo no existe: ${selected.resourceUri.fsPath}`);

          // Clean up both lists
          await Promise.all([
            favoritesProvider.validateFavorites(),
            mruService.validateFiles()
          ]);

          // Rebuild the picker to reflect the cleanup
          await buildItems(allFilesLoaded);
          return;
        }

        // File exists, proceed to add to MRU and open
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

          // The list will be automatically rebuilt by the onDidChangeTreeData listener
          // But we update the current item immediately for instant feedback
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
