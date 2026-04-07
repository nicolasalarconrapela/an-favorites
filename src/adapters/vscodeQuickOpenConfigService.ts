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
    const maxSearchResults = 5000;
    const maxSearchFiles = 20000;
    const searchCacheSize = 50;
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
      pathDetailLocation,
      showPathWhen,
      searchExclusions,
    };
  }
}
