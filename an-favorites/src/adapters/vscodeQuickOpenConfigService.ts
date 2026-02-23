import * as vscode from 'vscode';
import {
  QuickOpenConfig,
  QuickOpenConfigService,
} from '../commands/quickOpen/quickOpenHelpers';

export class VscodeQuickOpenConfigService implements QuickOpenConfigService {
  getConfig(): QuickOpenConfig {
    const configMaxItems = vscode.workspace.getConfiguration(
      'anfavorites.maxItems',
    );
    const configSearch =
      vscode.workspace.getConfiguration('anfavorites.search');
    const configQuickOpen = vscode.workspace.getConfiguration(
      'anfavorites.quickOpen',
    );
    const openToSide = configQuickOpen.get<boolean>(
      'actions.openToSide',
      false,
    );
    const openInNewWindow = configQuickOpen.get<boolean>(
      'actions.openInNewWindow',
      false,
    );
    const showOpenToSideButton = configQuickOpen.get<boolean>(
      'actions.showOpenToSideButton',
      true,
    );
    const showOpenInNewWindowButton = configQuickOpen.get<boolean>(
      'actions.showOpenInNewWindowButton',
      true,
    );

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
    const showIcons = configQuickOpen.get<boolean>(
      'showIcons',
      defaultShowIcons,
    );
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
      openInNewWindow,
      showOpenToSideButton,
      showOpenInNewWindowButton,
      showIcons,
      pathDetailLocation,
      showPathWhen,
      searchExclusions,
    };
  }
}
