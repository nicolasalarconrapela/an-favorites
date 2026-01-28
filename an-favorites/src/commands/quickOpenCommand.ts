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

interface SearchCacheEntry {
  uris: vscode.Uri[];
  exceededMaxFiles: boolean;
}

class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  private maxEntries: number;

  constructor(maxEntries: number) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (!value) return undefined;
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    this.evictIfNeeded();
  }

  clear(): void {
    this.map.clear();
  }

  setLimit(maxEntries: number): void {
    this.maxEntries = Math.max(1, maxEntries);
    this.evictIfNeeded();
  }

  private evictIfNeeded(): void {
    while (this.map.size > this.maxEntries) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey === undefined) return;
      this.map.delete(oldestKey);
    }
  }
}

function buildSearchPattern(searchValue: string): string {
  const normalized = searchValue.trim();
  if (!normalized) return '**/*';
  return `**/*${normalized}*`;
}

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

/**
 * Helper para crear ThemeIcon con fallback
 * Intenta usar el icono principal, si falla usa el fallback
 */
function createIconWithFallback(
  primaryIconId: string,
  fallbackIconId: string = 'file',
): vscode.ThemeIcon {
  try {
    return new vscode.ThemeIcon(primaryIconId);
  } catch {
    return new vscode.ThemeIcon(fallbackIconId);
  }
}

/**
 * Helper para crear iconos de botones con fallback
 */
function createButtonIcon(
  iconId: string,
  fallbackIconId: string = 'circle-outline',
): vscode.ThemeIcon {
  // Lista de iconos conocidos y confiables en VS Code
  const knownIcons = new Set([
    'star-full',
    'star-empty',
    'pin',
    'pinned',
    'split-horizontal',
    'close',
    'file',
    'folder',
    'symbol-file',
    'bookmark',
    'heart',
    'trash',
    'x',
    'circle-filled',
    'circle-outline',
  ]);

  // Si el icono está en la lista conocida, úsalo directamente
  if (knownIcons.has(iconId)) {
    return new vscode.ThemeIcon(iconId);
  }

  // Si no, usa el fallback
  try {
    return new vscode.ThemeIcon(iconId);
  } catch {
    return new vscode.ThemeIcon(fallbackIconId);
  }
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
  isPinned: boolean;
  isRecentlyOpened: boolean;
  isIndividualPinned: boolean;

  private _fullPathLabel: string;
  private _dirPathLabel: string;

  private _openToSide: boolean;
  public showIcons: boolean;

  constructor(params: {
    uri: vscode.Uri;
    isFavorite: boolean;
    isPinned?: boolean;
    isRecentlyOpened?: boolean;
    openToSide?: boolean;
    isIndividualPinned?: boolean;
    showIcons?: boolean;
  }) {
    const {
      uri,
      isFavorite,
      isPinned = false,
      isRecentlyOpened = false,
      openToSide = false,
      isIndividualPinned = false,
      showIcons = true,
    } = params;

    this.resourceUri = uri;
    this.isFavorite = isFavorite;
    this.isPinned = isPinned;
    this.isRecentlyOpened = isRecentlyOpened;
    this._openToSide = openToSide;
    this.isIndividualPinned = isIndividualPinned;
    this.showIcons = showIcons;

    // Label base: nombre fichero
    const baseName = safeBasenameFromUri(uri);

    // Alineación visual: SIEMPRE mostramos una estrella (llena o vacía)
    // Esto crea una "columna" virtual uniforme junto al icono de archivo
    // TODO : Revisar
    let iconPrefix = isFavorite ? '$(star-full)' : '$(star-empty)';
    if (isPinned) iconPrefix = '$(pin)';

    this.label = `${iconPrefix} ${baseName}`;

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

    this.updateIcon(this.showIcons);

    // Default to no-duplicate mode
    this.setShowDescription(false);
  }

  public setShowDescription(isDuplicate: boolean): void {
    const text = isDuplicate ? this._fullPathLabel : '';
    this.description = text || '';
  }

  updateIcon(showIcons: boolean = true): void {
    // 1. Icono Izquierdo: usar icono de archivo con fallback (o undefined si showIcons es false)
    if (showIcons) {
      this.iconPath = createIconWithFallback('file', 'symbol-file');
    } else {
      this.iconPath = undefined;
    }

    // 2. Label: Actualizamos para mostrar estrella llena o vacía
    const baseName = safeBasenameFromUri(this.resourceUri);
    let iconPrefix = this.isFavorite ? '$(star-full) ' : '     ';
    if (this.isPinned) iconPrefix = '$(pin) ';
    this.label = `${iconPrefix} ${baseName}`;

    // 3. Derecha: botones interactivos con fallback
    const buttons: vscode.QuickInputButton[] = [];

    // Botón Pin (Fijar/Desfijar) con fallback a bookmark
    const isPinnedState = this.isIndividualPinned;
    let pinTooltip = isPinnedState ? 'Desfijar' : 'Fijar';

    if (!this.isRecentlyOpened) {
      buttons.push({
        iconPath: createButtonIcon(
          isPinnedState ? 'pinned' : 'pin',
          'bookmark',
        ),
        tooltip: pinTooltip,
      });
    }

    // Botón de favoritos con fallback a heart
    buttons.push({
      iconPath: createButtonIcon(
        this.isFavorite ? 'star-full' : 'star-empty',
        this.isFavorite ? 'heart' : 'circle-outline',
      ),
      tooltip: this.isFavorite ? 'Quitar de favoritos' : 'Añadir a favoritos',
    });

    // Botón "Abrir al lado" con fallback
    if (!this._openToSide) {
      buttons.push({
        iconPath: createButtonIcon('split-horizontal', 'symbol-file'),
        tooltip: 'Abrir al lado',
      });
    }

    // Botón eliminar solo para recientes con fallback
    if (this.isRecentlyOpened) {
      buttons.push({
        iconPath: createButtonIcon('close', 'x'),
        tooltip: 'Eliminar de recientes',
      });
    }

    this.buttons = buttons;
  }
}

export function registerQuickOpenCommand(
  context: vscode.ExtensionContext,
  favoritesProvider: FavoritesTreeDataProvider,
  logger: any,
  mruService: MRUService,
): void {
  const throttleIntervalMs = 2000;
  const logThrottled = (
    level: 'debug' | 'info' | 'warn' | 'error',
    key: string,
    message: string,
    metadata?: unknown,
  ) => {
    if (logger?.throttle) {
      logger.throttle(level, key, message, metadata, throttleIntervalMs);
      return;
    }
    logger?.[level]?.(message, metadata);
  };

  const disposable = vscode.commands.registerCommand(
    'anfavorites.quickOpen',
    async () => {
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('🔍 [QuickOpen] COMMAND STARTED - ALT+SHIFT+F');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      // Environment detection
      logger.info(`[QuickOpen] Environment: ${vscode.env.appName} (${vscode.version})`);
      logger.info(`[QuickOpen] URI Scheme: ${vscode.env.uriScheme}`);
      logger.info(`[QuickOpen] Platform: ${process.platform}`);
      logger.info(`[QuickOpen] Language: ${vscode.env.language}`);

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
      const searchCache = new LruCache<string, SearchCacheEntry>(30);

      // Function to build/rebuild items
      const buildItems = async (
        searchQuery: string = quickPick.value,
      ): Promise<void> => {
        logger.info(
          `[QuickOpen] ▶ buildItems() called - searchQuery: "${searchQuery}"`,
        );

        if (isDisposed) {
          logger.warn('[QuickOpen] buildItems() aborted - already disposed');
          return;
        }

        // Guardar selección actual para restaurarla después
        // Esto evita que el foco salte incorrectamente cuando un item se mueve (ej: de Recientes a Favoritos)
        const normalizedSearch = searchQuery.trim();
        const isSearching = normalizedSearch.length > 0;

        // Guardar selección actual (tanto en búsqueda como fuera) para mantener posición
        const currentActiveUri =
          quickPick.activeItems.length > 0 &&
          isFileItem(quickPick.activeItems[0])
            ? (
                quickPick.activeItems[0] as FileQuickPickItem
              ).resourceUri.toString()
            : null;

        try {
          const isSearchValueCurrent = () =>
            normalizedSearch === quickPick.value.trim();

          logger.info(
            `[QuickOpen] Current search value: "${normalizedSearch}" (isSearching: ${isSearching})`,
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
          const configQuickOpen = vscode.workspace.getConfiguration(
            'anfavorites.quickOpen',
          );
          const openToSide = vscode.workspace
            .getConfiguration('anfavorites.quickOpen')
            .get<boolean>('openToSide', false);

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
          const maxPinned = configMaxItems.get<number>('pinned', 3);
          const maxRecentFiles = configMaxItems.get<number>('recentFiles', 5);
          const maxSearchResults = configQuickOpen.get<number>(
            'maxSearchResults',
            200,
          );
          const maxSearchFiles = configQuickOpen.get<number>(
            'maxSearchFiles',
            1000,
          );
          const searchCacheSize = configQuickOpen.get<number>(
            'searchCacheSize',
            30,
          );
          const showIcons = configQuickOpen.get<boolean>('showIcons', true);
          const searchExclusions = configSearch.get<string[]>('exclusions', [
            '**/node_modules/**',
          ]);

          searchCache.setLimit(searchCacheSize);

          logger.info(
            `[QuickOpen] Config: maxRecentFav=${maxRecentFavorites}, maxPinned=${maxPinned}, maxRecentFiles=${maxRecentFiles}, showIcons=${showIcons}, exclusions=${searchExclusions.length}`,
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

          // 1.5) Pinned items
          const pinnedFavUris = favoritesProvider
            .getPinnedFavorites()
            .slice(0, maxPinned);

          // Merge pinned items
          const allPinnedUrisUnsafe = [...pinnedFavUris];

          // Deduplicate based on normalized path
          const uniquePinnedUris: vscode.Uri[] = [];
          const seenPinned = new Set<string>();
          for (const u of allPinnedUrisUnsafe) {
            const norm = normalizeFsPath(u.fsPath);
            if (!seenPinned.has(norm)) {
              seenPinned.add(norm);
              uniquePinnedUris.push(u);
            }
          }

          // Filter to workspace
          const allPinnedUris = uniquePinnedUris.filter((u) => {
            return (
              u.scheme === 'file' && !!vscode.workspace.getWorkspaceFolder(u)
            );
          });
          const pinnedNormSet = new Set(
            allPinnedUris.map((u) => normalizeFsPath(u.fsPath)),
          );

          // 2) Get recent favorites
          // Fetch more candidates (e.g. 100) to ensure we can fill the quota
          const recentFavUris = favoritesProvider
            .getRecentFavorites(20)
            .filter((uri) => {
              return (
                uri.scheme === 'file' &&
                !!vscode.workspace.getWorkspaceFolder(uri) &&
                !pinnedNormSet.has(normalizeFsPath(uri.fsPath))
              );
            })
            .slice(0, maxRecentFavorites);
          const recentFavNormSet = new Set(
            recentFavUris.map((u) => normalizeFsPath(u.fsPath)),
          );

          // ✅ VALIDACIÓN SIEMPRE ACTIVA: Validar todos los archivos que vamos a mostrar
          const allUrisToDisplay = [
            ...allPinnedUris,
            ...recentFavUris,
            ...recentUris,
          ];
          const existenceMap = await validateFilesExistence(allUrisToDisplay);

          // Validar Pinned
          const validPinnedUris = allPinnedUris.filter((uri) => {
            const exists = existenceMap.get(uri.fsPath) ?? false;
            // if (!exists) { ... }
            return exists;
          });

          // Validar y Eliminar Favoritos
          const validRecentFavUris = recentFavUris.filter((uri) => {
            const exists = existenceMap.get(uri.fsPath) ?? false;
            if (!exists) {
              favoritesProvider.removeFavorite(uri);
            }
            return exists;
          });

          // Validar y Eliminar Recientes
          const validRecentUris = recentUris.filter((uri) => {
            const exists = existenceMap.get(uri.fsPath) ?? false;
            if (!exists) {
              mruService.remove(uri.fsPath);
            }
            return exists;
          });

          // 3) Items construction

          // Pinned Items
          const pinnedItems: FileQuickPickItem[] = validPinnedUris.map(
            (uri) => {
              const isIndividual = favoritesProvider.isPinned(uri);

              return new FileQuickPickItem({
                uri,
                isFavorite: favoritesProvider.hasFavorite(uri),
                isPinned: true,
                isRecentlyOpened: false,
                openToSide,
                isIndividualPinned: isIndividual,
                showIcons,
              });
            },
          );

          const recentFavItems: FileQuickPickItem[] = validRecentFavUris.map(
            (uri) => {
              const isPinned = favoritesProvider.isPinned(uri);
              return new FileQuickPickItem({
                uri,
                isFavorite: true,
                isPinned: false, // Keep label as Star
                isIndividualPinned: isPinned,
                isRecentlyOpened: false,
                openToSide,
                showIcons,
              });
            },
          );

          const recentItems: FileQuickPickItem[] = validRecentUris
            .slice(0, maxRecentFiles) // Limitar a la cantidad configurada
            .map((uri) => {
              const isFav = favoritesProvider.hasFavorite(uri);
              const isPinned = favoritesProvider.isPinned(uri);
              return new FileQuickPickItem({
                uri,
                isFavorite: isFav,
                isPinned: false, // Keep label as Star
                isIndividualPinned: isPinned,
                isRecentlyOpened: true,
                openToSide,
                showIcons,
              });
            });

          // 4) Combinar con separadores
          const items: QuickOpenItem[] = [];

          // Section 0: Fijados (Pinned)
          if (pinnedItems.length > 0) {
            items.push(...pinnedItems);
          }

          // First section: Favoritos (Siempre visible)
          const hasFavoriteItems = recentFavItems.length > 0;
          items.push({
            label: hasFavoriteItems ? 'Favoritos' : 'Aún no hay favoritos',
            kind: vscode.QuickPickItemKind.Separator,
          });
          items.push({ label: ' ', alwaysShow: false });

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
          const hasRecentFiles = recentItems.length > 0;

          items.push({
            label: hasRecentFiles ? 'Recientes' : 'No hay recientes nuevos',
            kind: vscode.QuickPickItemKind.Separator,
          });

          if (hasRecentFiles) {
            const clearRecentsItem: ActionQuickPickItem = {
              label: '$(trash) Limpiar todo',
              action: 'clearRecents',
            };

            items.push(clearRecentsItem);
            items.push(...recentItems);
          } else if (!isSearching) {
            items.push({ label: '', description: '', detail: '' });
          }

          // Third section: Archivos (All other files) - Solo cargar si se solicita Y estamos buscando
          let otherItems: FileQuickPickItem[] = [];
          let searchNoticeItem: QuickOpenItem | null = null;

          if (isSearching) {
            const exclusionGlob = searchExclusions.length
              ? `{${searchExclusions.join(',')}}`
              : undefined;
            const cacheKey = normalizedSearch;
            let cacheEntry = searchCache.get(cacheKey);

            if (!cacheEntry) {
              quickPick.busy = true;
              const searchPattern = buildSearchPattern(cacheKey);
              const searchLimit = Math.max(1, maxSearchFiles) + 1;
              const foundUris = await vscode.workspace.findFiles(
                searchPattern,
                exclusionGlob,
                searchLimit,
              );
              const exceededMaxFiles = foundUris.length > maxSearchFiles;
              cacheEntry = {
                uris: foundUris.slice(0, maxSearchFiles),
                exceededMaxFiles,
              };
              searchCache.set(cacheKey, cacheEntry);
            }

            if (cacheEntry.exceededMaxFiles) {
              searchNoticeItem = {
                label: `Se alcanzó el máximo de ${maxSearchFiles} archivos. Refina la búsqueda.`,
                detail: '',
              };
            }

            const maxDisplayResults = Math.max(
              1,
              Math.min(maxSearchResults, maxSearchFiles),
            );

            otherItems = cacheEntry.uris
              .map((uri) => {
                return new FileQuickPickItem({
                  uri,
                  isFavorite: false,
                  isPinned: false,
                  isRecentlyOpened: false,
                  openToSide,
                  showIcons,
                });
              })
              .filter((item) => {
                const normalizedPath = normalizeFsPath(item.resourceUri.fsPath);
                return (
                  !recentNormSet.has(normalizedPath) &&
                  !recentFavNormSet.has(normalizedPath) &&
                  !pinnedNormSet.has(normalizedPath)
                );
              })
              .slice(0, maxDisplayResults)
              .map((item) => {
                const isFav = favoritesProvider.hasFavorite(item.resourceUri);
                if (item.isFavorite !== isFav) {
                  item.isFavorite = isFav;
                  item.updateIcon(showIcons);
                }
                return item;
              });
          }

          // ✅ DETECCIÓN DE COLISIONES con Ripgrep (findFiles)
          const allFileItems = [
            ...pinnedItems,
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
          if (!isSearchValueCurrent()) {
            logger.debug(
              '[QuickOpen] Search value changed while building items, skipping update',
            );
            return;
          }

          if (otherItems.length > 0 || searchNoticeItem) {
            items.push({
              label: 'Archivos',
              kind: vscode.QuickPickItemKind.Separator,
            });
            if (searchNoticeItem) {
              items.push(searchNoticeItem);
            }
            items.push(...otherItems);
          }

          quickPick.items = items;

          if (isSearching) {
            // ✅ En búsqueda:
            // Si había una selección previa (por ejemplo, después de toggle), mantenerla
            // Si no, seleccionar el primer item de archivo para acceso rápido con Enter
            if (currentActiveUri) {
              const itemToRestore = items.find(
                (i) =>
                  isFileItem(i) &&
                  i.resourceUri.toString() === currentActiveUri,
              );
              if (itemToRestore) {
                quickPick.activeItems = [itemToRestore as FileQuickPickItem];
              } else {
                // Item ya no está visible, seleccionar el primero
                const firstFileItem = items.find((i) => isFileItem(i)) as
                  | FileQuickPickItem
                  | undefined;
                if (firstFileItem) {
                  quickPick.activeItems = [firstFileItem];
                } else {
                  quickPick.activeItems = [];
                }
              }
            } else {
              // No había selección previa, seleccionar el primer item en búsqueda
              const firstFileItem = items.find((i) => isFileItem(i)) as
                | FileQuickPickItem
                | undefined;
              if (firstFileItem) {
                quickPick.activeItems = [firstFileItem];
              } else {
                quickPick.activeItems = [];
              }
            }
          } else if (currentActiveUri) {
            // ✅ Fuera de búsqueda: restauramos foco anterior (UX estable)
            const itemToSelect = items.find(
              (i) => isFileItem(i) && i.resourceUri.toString() === currentActiveUri,
            );
            if (itemToSelect) {
              quickPick.activeItems = [itemToSelect as FileQuickPickItem];
            }
          } else {
            // ✅ Fuera de búsqueda, sin selección previa: seleccionar el segundo item si no hay pinneds
            const fileItems = items.filter((i) =>
              isFileItem(i),
            ) as FileQuickPickItem[];
            if (fileItems.length > 0) {
              // Si no hay pinned items, seleccionar el segundo (índice 1)
              // Si hay pinned items, seleccionar el primero después de los pinneds
              const hasPinned = pinnedItems.length > 0;
              const indexToSelect = hasPinned ? 0 : 1;

              // Detectar entorno: VS Code usa indexToSelect, AnGravity siempre usa 1
              const isAnGravity = vscode.env.appName.includes('angravity') || vscode.env.uriScheme.includes('angravity');
              const isCursor = vscode.env.appName.includes('cursor') || vscode.env.uriScheme.includes('cursor');

              const forceIndexOne = isAnGravity || isCursor;

              const finalIndex = forceIndexOne ? 1 : indexToSelect;

              quickPick.activeItems = [fileItems[finalIndex]];
            }
          }
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
      await buildItems('');
      logger.info('[QuickOpen] ✓ Initial buildItems complete');

      // ✅ NOW show the QuickPick - items are ready, no risk of premature focus loss
      logger.info('[QuickOpen] Showing QuickPick UI NOW (items ready)...');
      quickPick.show();
      logger.info(
        '[QuickOpen] ✓ QuickPick visible and ready for user interaction',
      );

      // Listen to user input to load all files when searching OR toggle placeholders
      let previousValue = '';
      const debouncedSearchRebuild = debounce(async (value: string) => {
        await buildItems(value);
      }, 200);
      const debouncedExternalRebuild = debounce(
        async (reason: string) => {
        logThrottled(
          'debug',
          'quickopen:external-rebuild',
          `External change (${reason}), rebuilding QuickOpen items`,
        );
        await buildItems(quickPick.value);
      },
      20,
    );

      disposables.push(
        quickPick.onDidChangeValue(async (value) => {
          const wasEmpty = previousValue.length === 0;
          const isEmpty = value.length === 0;
          previousValue = value;
          // if (!isEmpty) {
          //   quickPick.activeItems = []; // evita Enter accidental sobre selección previa
          //   debouncedSearchRebuild(value);
          // }
          // 2. Si cambia el estado (empezó a buscar O borró la búsqueda)
          // reconstruimos para mostrar/ocultar los placeholders
          if (wasEmpty !== isEmpty) {
            if (isEmpty) {
              await buildItems('');
            } else {
              debouncedSearchRebuild(value);
            }
            return;
          }

          if (!isEmpty) {
            debouncedSearchRebuild(value);
          }
        }),
      );

      // Listen to favorites changes and rebuild items in real-time
      disposables.push(
        favoritesProvider.onDidChangeTreeData(async () => {
          const isSearching = quickPick.value.trim().length > 0;
          if (isSearching) {
            logThrottled(
              'debug',
              'quickopen:favorites-changed',
              'Favorites changed while searching, skipping rebuild',
            );
            return;
          }
          logThrottled(
            'debug',
            'quickopen:favorites-changed',
            'Favorites changed, rebuilding QuickOpen items',
          );
          debouncedExternalRebuild('favorites');
        }),
      );

      // Listen to MRU changes and rebuild items in real-time
      disposables.push(
        mruService.onDidChangeRecentFiles(async () => {
          logThrottled(
            'debug',
            'quickopen:mru-changed',
            'MRU list changed, rebuilding QuickOpen items',
          );
          debouncedExternalRebuild('mru');
        }),
      );

      // Listen to Configuration changes
      disposables.push(
        vscode.workspace.onDidChangeConfiguration(async (e) => {
          if (
            e.affectsConfiguration('anfavorites.maxItems') ||
            e.affectsConfiguration('anfavorites.quickOpen') ||
            e.affectsConfiguration('anfavorites.search')
          ) {
            logThrottled(
              'debug',
              'quickopen:config-changed',
              'Configuration changed (quick open), rebuilding QuickOpen items',
            );
            // Rebuild items to reflect new limits
            searchCache.clear();
            await buildItems(quickPick.value);
          }
        }),
      );

      // ✅ Listen to file system changes (rename, delete, create) with debouncing
      const debouncedRebuild = debounce(async () => {
        logThrottled(
          'debug',
          'quickopen:fs-changed',
          'File system changed (debounced), rebuilding QuickOpen items',
        );
        // Invalidar caché para reflejar cambios del FS
        searchCache.clear();
        await buildItems(quickPick.value);
      }, 200);

      disposables.push(
        vscode.workspace.onDidRenameFiles((event) => {
          logThrottled(
            'debug',
            'quickopen:fs-renamed',
            `Files renamed: ${event.files.length} file(s)`,
          );
          debouncedRebuild();
        }),
      );

      disposables.push(
        vscode.workspace.onDidDeleteFiles((event) => {
          logThrottled(
            'debug',
            'quickopen:fs-deleted',
            `Files deleted: ${event.files.length} file(s)`,
          );
          debouncedRebuild();
        }),
      );

      disposables.push(
        vscode.workspace.onDidCreateFiles((event) => {
          logThrottled(
            'debug',
            'quickopen:fs-created',
            `Files created: ${event.files.length} file(s)`,
          );
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
            await buildItems('');
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
            await buildItems(quickPick.value);
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

          const openToSide = vscode.workspace
            .getConfiguration('anfavorites.quickOpen')
            .get<boolean>('openToSide', false);

          await vscode.window.showTextDocument(selected.resourceUri, {
            preview: false,
            viewColumn: openToSide ? vscode.ViewColumn.Beside : undefined,
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

          // Botón estrella: Favoritos
          // Botón split: Abrir al lado
          // Usamos la propiedad `tooltip` para distinguir los botones

          const button = e.button; // El botón pulsado
          const uri = item.resourceUri;

          if (button.tooltip === 'Abrir al lado') {
            logger.info(`[QuickOpen] Opening to side: ${uri.fsPath}`);
            try {
              // Add to MRU as well
              mruService.add(uri.fsPath);

              await vscode.window.showTextDocument(uri, {
                viewColumn: vscode.ViewColumn.Beside,
                preview: false,
              });

              quickPick.hide();
            } catch (err) {
              logger.error(`[QuickOpen] Error opening to side`, err);
            }
            return;
          }

          if (button.tooltip === 'Eliminar de recientes') {
            logger.info(`[QuickOpen] Removing from recents: ${uri.fsPath}`);
            mruService.remove(uri.fsPath);
            // No hide(), let the list rebuild automatically via event listener
            return;
          }

          if (button.tooltip === 'Eliminar de favoritos') {
            logger.info(`[QuickOpen] Removing from favorites: ${uri.fsPath}`);
            favoritesProvider.removeFavorite(uri);
            item.isFavorite = false;
            item.isPinned = false;
            item.isIndividualPinned = false;
            item.updateIcon(item.showIcons);
            const currentItems = quickPick.items;
            const index = currentItems.indexOf(item);
            if (index !== -1) {
              const newItems = [...currentItems];
              newItems[index] = item;
              quickPick.items = newItems;
              quickPick.activeItems = [item];
            }
            return;
          }

          if (
            button.tooltip?.startsWith('Fijar') ||
            button.tooltip === 'Desfijar'
          ) {
            logger.info(`[QuickOpen] Toggling pin for: ${uri.fsPath}`);
            favoritesProvider.togglePin(uri);

            if (!favoritesProvider.hasFavorite(uri)) {
              favoritesProvider.addFavorite(uri);
              // defaults to unpinned, so we toggle it to true
              favoritesProvider.togglePin(uri);
            }

            // Update UI immediately (optimistic)
            item.isIndividualPinned = !item.isIndividualPinned;
            // If it was only pinned by group, and we pinned it individually, isPinned remains true.
            // If it was individually pinned, and we unpin, check if still pinned by group
            if (!item.isIndividualPinned) {
              item.isPinned = false;
            } else {
              item.isPinned = true;
            }

            item.isFavorite = true; // Implied
            item.updateIcon(item.showIcons);
            return;
          }

          // Si no es "Abrir al lado" ni "Eliminar de recientes", asumimos que es Toggle Favorito
          logger.info(`[QuickOpen] Toggling favorite for: ${uri.fsPath}`);

          try {
            if (item.isFavorite) {
              logger.debug('[QuickOpen] Removing from favorites');
              favoritesProvider.removeFavorite(uri);
              item.isFavorite = false;
            } else {
              logger.debug('[QuickOpen] Adding to favorites');
              favoritesProvider.addFavorite(uri);
              // Si se añade a favoritos, lo eliminamos de recientes para evitar duplicados inmediatos
              mruService.remove(uri.fsPath);
              item.isFavorite = true;
            }

            item.updateIcon(item.showIcons);
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
