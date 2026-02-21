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
  openInNewWindow: boolean;
  showIcons: boolean;
  pathDetailLocation: 'description' | 'detail';
  showPathWhen: 'always' | 'onConflict';
  searchExclusions: string[];
}

export interface QuickOpenConfigService {
  getConfig(): QuickOpenConfig;
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
