import * as vscode from 'vscode';
import * as path from 'path';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';
import { MRUService } from '../services/mruService';
import {
  detectCollisions,
  normalizeFsPath,
  safeBasenameFromUri,
} from '../utils/collisionUtils';

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
    logger?.warn?.('Failed to build Uri.file from MRU entry', {
      value: p,
      error: e,
    });
    return null;
  }
}

/**
 * Ruta relativa al workspace (y si es multi-root, prefija con el nombre del root).
 */
function workspaceRelativeLabel(uri: vscode.Uri): {
  rel: string;
  rootName?: string;
} {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) {
    // Sin workspace abierto: muestra lo que haya
    const fsPath = (uri as any)?.fsPath;
    return {
      rel: typeof fsPath === 'string' && fsPath ? fsPath : uri.toString(),
    };
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
 * Generic debounce utility
 */
function debounce<T extends (...args: any[]) => any>(
  func: T,
  waitMs: number,
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout | undefined;
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, waitMs);
  };
}

/**
 * Validates existence of files and returns a map of Uri -> exists boolean
 */
async function validateFilesExistence(
  uris: vscode.Uri[],
): Promise<Map<string, boolean>> {
  const results = new Map<string, boolean>();
  await Promise.all(
    uris.map(async (uri) => {
      if (uri.scheme !== 'file') {
        results.set(uri.fsPath, false);
        return;
      }
      try {
        await vscode.workspace.fs.stat(uri);
        results.set(uri.fsPath, true);
      } catch {
        results.set(uri.fsPath, false);
      }
    }),
  );
  return results;
}

/**
 * (Deprecated - replaced by validateFilesExistence)
 * Filtra URIs que no existen (evita MRU con rutas muertas).
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

  constructor(params: {
    uri: vscode.Uri;
    isFavorite: boolean;
    isRecentlyOpened?: boolean;
  }) {
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

    // Extraer directorio de la ruta relativa (sin nombre de archivo)
    const dir = path.dirname(rel);
    // Si dirname es '.' (archivo en raíz) o vacío, mostrar '.'
    const cleanDir = dir === '.' || dir === '' ? '.' : dir;

    // Ruta completa (solo directorio, sin archivo)
    this._fullPathLabel = rootName
      ? cleanDir === '.'
        ? rootName
        : `${rootName} • ${cleanDir}`
      : cleanDir;

    // Ruta solo directorio (mismo que fullPath, ya que ambos muestran solo directorio)
    this._dirPathLabel = this._fullPathLabel;

    // Default to dir path
    this.description = this._dirPathLabel;

    this.updateIcon();

    // Default to no-duplicate mode
    this.setShowDescription(false);
  }

  public setShowDescription(isDuplicate: boolean): void {
    const text = isDuplicate ? this._fullPathLabel : '';
    this.description = text || '';
  }

  updateIcon(): void {
    // 1. Icono Izquierdo: SIEMPRE el de archivo (ThemeIcon.File) para respetar el tema de iconos del usuario
    this.iconPath = new vscode.ThemeIcon('file');

    // 2. Label: Actualizamos para mostrar estrella llena o vacía
    const baseName = safeBasenameFromUri(this.resourceUri);
    const starIcon = this.isFavorite ? '$(star-full) ' : '     ';
    this.label = `${starIcon} ${baseName}`;

    // 3. Derecha: botón interactivo (acción al hacer hover)
    this.buttons = [
      {
        iconPath: this.isFavorite
          ? new vscode.ThemeIcon('star-full')
          : new vscode.ThemeIcon('star-empty'),
        tooltip: this.isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos',
      },
    ];
  }
}

export function registerQuickOpenCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any,
  mruService: MRUService,
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.quickOpen',
    async () => {
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('🔍 [QuickOpen] COMMAND STARTED - ALT+SHIFT+F');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const quickPick = vscode.window.createQuickPick<QuickOpenItem>();
      logger.info('[QuickOpen] QuickPick instance created');

      quickPick.placeholder = 'Buscar archivos por nombre';
      quickPick.matchOnDescription = true;
      quickPick.matchOnDetail = true;
      quickPick.canSelectMany = false;

      // ✅ Always keep QuickPick open even when focus is lost
      // This provides better UX - users can switch windows and come back without losing their search
      quickPick.ignoreFocusOut = true;
      logger.info('[QuickOpen] ignoreFocusOut set to true (hardcoded)');

      // ⚠️ DO NOT show() here! If ignoreFocusOut=false, the picker will close immediately
      // during async operations. We show() AFTER buildItems completes.
      logger.info(
        '[QuickOpen] Preparing QuickPick (not showing yet to avoid focus loss)...',
      );

      try {
        logger.info('[QuickOpen] Validating favorites...');
        await favoritesProvider.validateFavorites();
        logger.info('[QuickOpen] Favorites validated successfully');

        logger.info('[QuickOpen] Validating MRU files...');
        await mruService.validateFiles();
        logger.info('[QuickOpen] MRU files validated successfully');
      } catch (error) {
        logger.error('[QuickOpen] ❌ ERROR during validation:', error);
        // Continue anyway, as buildItems performs its own existence checks
      }

      logger.info('[QuickOpen] Validation phase complete');

      const disposables: vscode.Disposable[] = [];
      let isDisposed = false;

      const safeDispose = () => {
        if (isDisposed) {
          logger.debug('[QuickOpen] safeDispose() called but already disposed');
          return;
        }
        isDisposed = true;
        logger.info('[QuickOpen] Disposing QuickPick and listeners...');
        try {
          disposables.forEach((d) => d.dispose());
          logger.info(`[QuickOpen] Disposed ${disposables.length} listeners`);
        } finally {
          quickPick.dispose();
          logger.info('[QuickOpen] QuickPick disposed');
        }
      };

      disposables.push(
        quickPick.onDidHide(() => {
          logger.info('[QuickOpen] onDidHide triggered');
          safeDispose();
        }),
      );
      logger.info('[QuickOpen] onDidHide listener registered');

      // Cache de archivos para no volver a buscar en disco cada vez que se actualiza la UI
      // Esto es vital para que al borrar el texto de búsqueda la respuesta sea instantánea
      let cachedAllFileItems: FileQuickPickItem[] | null = null;

      // Function to build/rebuild items
      const buildItems = async (
        loadAllFiles: boolean = false,
      ): Promise<void> => {
        logger.info(
          `[QuickOpen] ▶ buildItems() called - loadAllFiles: ${loadAllFiles}`,
        );

        if (isDisposed) {
          logger.warn('[QuickOpen] buildItems() aborted - already disposed');
          return;
        }

        // No poner busy true si estamos tecleando para evitar parpadeos,
        // a menos que sea la carga pesada inicial
        if (loadAllFiles && !cachedAllFileItems) {
          quickPick.busy = true;
        }

        try {
          const isSearching = quickPick.value.length > 0;
          logger.info(
            `[QuickOpen] Current search value: "${quickPick.value}" (isSearching: ${isSearching})`,
          );

          // 0) Reload favorites from storage to ensure we have the latest data
          logger.debug('[QuickOpen] Reloading favorites from storage...');
          favoritesProvider.reloadFavorites();
          logger.debug('[QuickOpen] Favorites reloaded');

          // 0.1) Read configuration values
          const configMaxItems = vscode.workspace.getConfiguration(
            'anfavorites.maxItems',
          );
          const configSearch =
            vscode.workspace.getConfiguration('anfavorites.search');

          const folders = vscode.workspace.workspaceFolders ?? [];
          const hasWorkspace = folders.length > 0;

          logger.debug(
            `[QuickOpen] Workspace state: hasWorkspace=${hasWorkspace}, folders=${folders.length}`,
          );
          if (folders.length > 0) {
            folders.forEach((f, i) =>
              logger.debug(
                `[QuickOpen] Folder[${i}]: name=${f.name}, uri=${f.uri.toString()}`,
              ),
            );
          }
          const maxRecentFavorites = configMaxItems.get<number>('favorites', 3);
          const maxRecentFiles = configMaxItems.get<number>('recentFiles', 3);
          const searchExclusions = configSearch.get<string[]>('exclusions', [
            '**/node_modules/**',
          ]);

          logger.info(
            `[QuickOpen] Config: maxRecentFav=${maxRecentFavorites}, maxRecentFiles=${maxRecentFiles}, exclusions=${searchExclusions.length}`,
          );

          // 1) Recientes (MRU) — sanitize total
          logger.debug('[QuickOpen] Fetching recent files from MRU...');
          const rawRecent: unknown[] =
            (mruService.getRecentFiles?.() as any) ?? [];
          logger.debug(`[QuickOpen] Raw MRU entries: ${rawRecent.length}`);
          const recentUrisUnsafe = rawRecent
            .map((v) => toSafeFileUri(v, logger))
            .filter((u): u is vscode.Uri => !!u);

          // Filtrar: SOLO archivos que pertenezcan al workspace abierto actualmente.
          const recentUris = recentUrisUnsafe.filter((u) => {
            return (
              u.scheme === 'file' && !!vscode.workspace.getWorkspaceFolder(u)
            );
          });

          const recentNormSet = new Set(
            recentUris.map((u) => normalizeFsPath(u.fsPath)),
          );

          // 2) Get recent favorites (usar configuración)
          const recentFavUris = favoritesProvider
            .getRecentFavorites(maxRecentFavorites)
            .filter((uri) => {
              return (
                uri.scheme === 'file' &&
                !!vscode.workspace.getWorkspaceFolder(uri)
              );
            });
          const recentFavNormSet = new Set(
            recentFavUris.map((u) => normalizeFsPath(u.fsPath)),
          );

          // ✅ VALIDACIÓN SIEMPRE ACTIVA: Validar todos los archivos que vamos a mostrar
          const allUrisToDisplay = [...recentFavUris, ...recentUris];
          const existenceMap = await validateFilesExistence(allUrisToDisplay);

          // Eliminar archivos que no existen de las listas y del almacenamiento
          const validRecentFavUris = recentFavUris.filter((uri) => {
            const exists = existenceMap.get(uri.fsPath) ?? false;
            if (!exists) {
              logger.warn(
                `[validation] Removing non-existent favorite: ${uri.fsPath}`,
              );
              favoritesProvider.removeFavorite(uri);
            }
            return exists;
          });

          const validRecentUris = recentUris.filter((uri) => {
            const exists = existenceMap.get(uri.fsPath) ?? false;
            if (!exists) {
              logger.warn(
                `[validation] Removing non-existent recent file: ${uri.fsPath}`,
              );
              mruService.updatePath(uri.fsPath, ''); // Forzar eliminación
            }
            return exists;
          });

          // 3) Items
          const recentFavItems: FileQuickPickItem[] = validRecentFavUris.map(
            (uri) => {
              return new FileQuickPickItem({
                uri,
                isFavorite: true,
                isRecentlyOpened: false,
              });
            },
          );

          const recentItems: FileQuickPickItem[] = validRecentUris
            .filter((uri) => !recentFavNormSet.has(normalizeFsPath(uri.fsPath))) // Exclude if already in recent favorites
            .slice(0, maxRecentFiles) // Limitar a la cantidad configurada
            .map((uri) => {
              const isFav = favoritesProvider.hasFavorite(uri);
              return new FileQuickPickItem({
                uri,
                isFavorite: isFav,
                isRecentlyOpened: true,
              });
            });

          // 4) Combinar con separadores
          const items: QuickOpenItem[] = [];

          // First section: Favoritos (Siempre visible)
          const hasFavoriteItems = recentFavItems.length > 0;
          items.push({
            label: hasFavoriteItems ? 'Favoritos' : 'Aún no hay favoritos',
            kind: vscode.QuickPickItemKind.Separator,
          });

          if (hasFavoriteItems) {
            items.push(...recentFavItems);
          } else if (!isSearching) {
            items.push({
              label:
                'Busque un archivo para añadirlo a favoritos en icono de la derecha',
              description: '',
              detail: '',
            });
          }

          // Second section: Recientes
          const hasRecentFiles = validRecentUris.length > 0;

          items.push({
            label: hasRecentFiles ? 'Recientes' : 'No hay recientes nuevos',
            kind: vscode.QuickPickItemKind.Separator,
          });

          if (hasRecentFiles) {
            const clearRecentsItem: ActionQuickPickItem = {
              label: '\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t  $(trash) Limpiar',
              action: 'clearRecents',
            };

            items.push(clearRecentsItem);
            items.push(...recentItems);
          } else if (!isSearching) {
            items.push({ label: '', description: '', detail: '' });
          }

          // Third section: Archivos (All other files) - Solo cargar si se solicita Y estamos buscando
          let otherItems: FileQuickPickItem[] = [];

          if (loadAllFiles && isSearching) {
            if (!cachedAllFileItems) {
              const exclusionGlob = searchExclusions.length
                ? `{${searchExclusions.join(',')}}`
                : undefined;
              const allUris = await vscode.workspace.findFiles(
                '**/*',
                exclusionGlob,
              );
              cachedAllFileItems = allUris.map((uri) => {
                return new FileQuickPickItem({
                  uri,
                  isFavorite: false,
                  isRecentlyOpened: false,
                });
              });
            }

            if (cachedAllFileItems) {
              otherItems = cachedAllFileItems
                .filter((item) => {
                  const normalizedPath = normalizeFsPath(
                    item.resourceUri.fsPath,
                  );
                  return (
                    !recentNormSet.has(normalizedPath) &&
                    !recentFavNormSet.has(normalizedPath)
                  );
                })
                .map((item) => {
                  const isFav = favoritesProvider.hasFavorite(item.resourceUri);
                  if (item.isFavorite !== isFav) {
                    item.isFavorite = isFav;
                    item.updateIcon();
                  }
                  return item;
                });
            }
          }

          // ✅ DETECCIÓN DE COLISIONES con Ripgrep (findFiles)
          const allFileItems = [
            ...recentFavItems,
            ...recentItems,
            ...otherItems,
          ];
          const allUris = allFileItems.map((item) => item.resourceUri);

          logger.debug(
            `[QuickOpen] Checking collisions for ${allUris.length} items...`,
          );
          const collisions = await detectCollisions(
            allUris,
            searchExclusions,
            logger,
          );
          logger.debug(
            `[QuickOpen] Collisions detected: ${collisions.size}`,
            Array.from(collisions),
          );

          if (isDisposed) return;

          for (const item of allFileItems) {
            const basename = safeBasenameFromUri(item.resourceUri);
            const hasCollision = collisions.has(basename);
            item.setShowDescription(hasCollision);
          }
          if (otherItems.length > 0) {
            items.push({
              label: 'Archivos',
              kind: vscode.QuickPickItemKind.Separator,
            });
            items.push(...otherItems);
          }

          quickPick.items = items;
        } catch (error) {
          if (isDisposed) return;
          logger.error('Error loading files for QuickOpen', error);
          quickPick.items = [
            {
              label: 'Error cargando archivos (ver logs)',
              kind: vscode.QuickPickItemKind.Separator,
            },
          ];
        } finally {
          if (!isDisposed) {
            quickPick.busy = false;
          }
        }
      };

      // Initial load - NO cargamos todos los archivos al inicio
      logger.info('[QuickOpen] Starting initial buildItems(false)...');
      await buildItems(false);
      logger.info('[QuickOpen] ✓ Initial buildItems complete');

      // ✅ NOW show the QuickPick - items are ready, no risk of premature focus loss
      logger.info('[QuickOpen] Showing QuickPick UI NOW (items ready)...');
      quickPick.show();
      logger.info(
        '[QuickOpen] ✓ QuickPick visible and ready for user interaction',
      );

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
            logger.info(
              '[QuickOpen] User started searching, loading ALL files...',
            );
            allFilesLoaded = true;
            // Esto ocultará placeholders y cargará archivos
            await buildItems(true);
            logger.info('[QuickOpen] All files loaded and displayed');
            return;
          }

          // 2. Si cambia el estado (empezó a buscar O borró la búsqueda)
          // reconstruimos para mostrar/ocultar los placeholders
          if (wasEmpty !== isEmpty) {
            await buildItems(allFilesLoaded);
          }
        }),
      );

      // Listen to favorites changes and rebuild items in real-time
      disposables.push(
        favoritesProvider.onDidChangeTreeData(async () => {
          logger.debug('Favorites changed, rebuilding QuickOpen items');
          await buildItems(allFilesLoaded);
        }),
      );

      // Listen to MRU changes and rebuild items in real-time
      disposables.push(
        mruService.onDidChangeRecentFiles(async () => {
          logger.debug('MRU list changed, rebuilding QuickOpen items');
          await buildItems(allFilesLoaded);
        }),
      );

      // ✅ Listen to file system changes (rename, delete, create) with debouncing
      const debouncedRebuild = debounce(async () => {
        logger.debug(
          'File system changed (debounced), rebuilding QuickOpen items',
        );
        // Invalidar caché para reflejar cambios del FS
        cachedAllFileItems = null;
        await buildItems(allFilesLoaded);
      }, 200);

      disposables.push(
        vscode.workspace.onDidRenameFiles((event) => {
          logger.debug(`Files renamed: ${event.files.length} file(s)`);
          debouncedRebuild();
        }),
      );

      disposables.push(
        vscode.workspace.onDidDeleteFiles((event) => {
          logger.debug(`Files deleted: ${event.files.length} file(s)`);
          debouncedRebuild();
        }),
      );

      disposables.push(
        vscode.workspace.onDidCreateFiles((event) => {
          logger.debug(`Files created: ${event.files.length} file(s)`);
          debouncedRebuild();
        }),
      );

      // Enter: abrir fichero o ejecutar acción
      disposables.push(
        quickPick.onDidAccept(async () => {
          logger.info('[QuickOpen] onDidAccept triggered');
          const selected = quickPick.selectedItems[0];
          if (!selected) {
            logger.warn('[QuickOpen] No item selected');
            return;
          }
          logger.info(
            `[QuickOpen] Selected item: ${(selected as any).label || '(no label)'}`,
          );

          const actionItem = selected as unknown as ActionQuickPickItem;
          if (actionItem.action === 'clearRecents') {
            logger.info('[QuickOpen] Executing action: clearRecents');
            mruService.clear();
            logger.info(
              '[QuickOpen] Recent files list cleared from Quick Open',
            );
            // Rebuild the picker without closing it
            allFilesLoaded = false; // Reset to avoid loading all files again
            await buildItems(false);
            return;
          }

          // Normal file selection
          if (!isFileItem(selected)) {
            logger.debug(
              '[QuickOpen] Selected item is not a file item (separator or action)',
            );
            return;
          }

          logger.info(
            `[QuickOpen] Opening file: ${selected.resourceUri.fsPath}`,
          );

          // Verify file exists before attempting to open
          try {
            await vscode.workspace.fs.stat(selected.resourceUri);
            logger.debug('[QuickOpen] File exists, proceeding to open');
          } catch (error) {
            // File doesn't exist
            logger.warn(
              `[QuickOpen] ❌ File no longer exists: ${selected.resourceUri.fsPath}`,
            );
            vscode.window.showErrorMessage(
              `El archivo no existe: ${selected.resourceUri.fsPath}`,
            );

            // Clean up both lists
            logger.info(
              '[QuickOpen] Cleaning up favorites and MRU after missing file detection',
            );
            await Promise.all([
              favoritesProvider.validateFavorites(),
              mruService.validateFiles(),
            ]);

            // Rebuild the picker to reflect the cleanup
            await buildItems(allFilesLoaded);
            return;
          }

          // File exists, proceed to add to MRU and open
          try {
            mruService.add(selected.resourceUri.fsPath);
            logger.debug('[QuickOpen] File added to MRU');
          } catch (e) {
            logger.warn('[QuickOpen] Failed to add MRU item', e);
          }

          logger.info('[QuickOpen] Showing text document...');
          await vscode.window.showTextDocument(selected.resourceUri, {
            preview: false,
          });
          logger.info(
            '[QuickOpen] ✓ File opened successfully, hiding QuickPick',
          );
          quickPick.hide();
        }),
      );

      // Botón estrella: toggle favorito
      disposables.push(
        quickPick.onDidTriggerItemButton(async (e) => {
          logger.debug('[QuickOpen] onDidTriggerItemButton triggered');
          const item = e.item;
          if (!isFileItem(item)) {
            logger.debug('[QuickOpen] Button triggered on non-file item');
            return;
          }

          const uri = item.resourceUri;
          logger.info(`[QuickOpen] Toggling favorite for: ${uri.fsPath}`);

          try {
            if (item.isFavorite) {
              logger.debug('[QuickOpen] Removing from favorites');
              favoritesProvider.removeFavorite(uri);
              item.isFavorite = false;
            } else {
              logger.debug('[QuickOpen] Adding to favorites');
              favoritesProvider.addFavorite(uri);
              item.isFavorite = true;
            }

            item.updateIcon();
            logger.debug('[QuickOpen] Favorite toggled successfully');

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
            logger.error('[QuickOpen] ❌ Error toggling favorite', error);
          }
        }),
      );
    },
  );

  context.subscriptions.push(disposable);
  logger.info('[QuickOpen] ✓ Command registered successfully');
}
