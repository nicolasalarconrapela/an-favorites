import * as vscode from 'vscode';

export interface SearchCacheEntry {
  uris: vscode.Uri[];
  exceededMaxFiles: boolean;
}

export interface QuickOpenConfig {
  maxRecentFavorites: number;
  maxPinned: number;
  maxRecentFiles: number;
  maxSearchResults: number;
  maxSearchFiles: number;
  searchCacheSize: number;
  openToSide: boolean;
  showIcons: boolean;
  pathDetailLocation: 'description' | 'detail';
  showPathWhen: 'always' | 'onConflict';
  searchExclusions: string[];
}

export type FavoritesAction = 'clearRecents' | 'loadMore';

export interface ActionQuickPickItem extends vscode.QuickPickItem {
  action: FavoritesAction;
}

export class LruCache<K, V> {
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

export function buildSearchPattern(searchValue: string): string {
  const normalized = searchValue.trim();
  if (!normalized) return '**/*';
  return `**/*${normalized}*`;
}

export function getQuickOpenConfig(): QuickOpenConfig {
  const configMaxItems = vscode.workspace.getConfiguration(
    'anfavorites.maxItems',
  );
  const configSearch = vscode.workspace.getConfiguration('anfavorites.search');
  const configQuickOpen =
    vscode.workspace.getConfiguration('anfavorites.quickOpen');
  const openToSide = configQuickOpen.get<boolean>('openToSide', false);

  const maxRecentFavorites = configMaxItems.get<number>('favorites', 3);
  const maxPinned = configMaxItems.get<number>('pinned', 3);
  const maxRecentFiles = configMaxItems.get<number>('recentFiles', 5);
  const maxSearchResults = configQuickOpen.get<number>(
    'maxSearchResults',
    200,
  );
  const maxSearchFiles = configQuickOpen.get<number>('maxSearchFiles', 1000);
  const searchCacheSize = configQuickOpen.get<number>('searchCacheSize', 30);

  const isAnGravity = vscode.env.appName.includes('AnGravity');
  const defaultShowIcons = isAnGravity ? false : true;
  const showIcons = configQuickOpen.get<boolean>('showIcons', defaultShowIcons);
  const pathDetailLocation = configQuickOpen.get<'description' | 'detail'>(
    'pathDetailLocation',
    'detail',
  );
  const showPathWhen = configQuickOpen.get<'always' | 'onConflict'>(
    'showPathWhen',
    'onConflict',
  );
  const searchExclusions = configSearch.get<string[]>('exclusions', [
    '**/node_modules/**',
  ]);

  return {
    maxRecentFavorites,
    maxPinned,
    maxRecentFiles,
    maxSearchResults,
    maxSearchFiles,
    searchCacheSize,
    openToSide,
    showIcons,
    pathDetailLocation,
    showPathWhen,
    searchExclusions,
  };
}
