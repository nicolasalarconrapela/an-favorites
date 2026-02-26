import * as vscode from 'vscode';
import {
  QuickOpenConfig,
  QuickOpenConfigService,
} from '../commands/quickOpen/quickOpenHelpers';

export class VscodeQuickOpenConfigService implements QuickOpenConfigService {
  getConfig(): QuickOpenConfig {
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

    const configLimits =
      vscode.workspace.getConfiguration('anfavorites.limits');

    const maxRecentFavorites = configLimits.get<number>(
      'quickOpen.maxFavorites',
      3,
    );
    const maxPinned = configLimits.get<number>('maxPinned', 3);
    const maxRecentFiles = configLimits.get<number>(
      'quickOpen.maxRecentFiles',
      3,
    );
    const maxSearchResults = configSearch.get<number>('maxSearchResults', 200);
    const maxSearchFiles = configSearch.get<number>('maxSearchFiles', 1000);
    const searchCacheSize = configQuickOpen.get<number>('searchCacheSize', 30);

    const appName = (vscode.env.appName || '').toLowerCase();
    const uriScheme = (vscode.env.uriScheme || '').toLowerCase();
    const isAnGravity =
      appName.includes('angravity') ||
      appName.includes('antigravity') ||
      uriScheme.includes('angravity') ||
      uriScheme.includes('antigravity');
    const defaultShowIcons = true;
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
