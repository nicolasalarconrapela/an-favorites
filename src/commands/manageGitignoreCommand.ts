import * as vscode from 'vscode';
import {
  discoverGitignoreFiles,
  isGitignoreFileEnabled,
  setGitignoreFileEnabled,
  gitignoreRelPath,
  onGitignoreDiscoveryChange,
} from '../utils/gitignoreService';
import { t } from '../utils/l10n';

// ---------------------------------------------------------------------------
// Buttons used in the QuickPick items
// ---------------------------------------------------------------------------

const BTN_OPEN: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('go-to-file'),
  tooltip: 'Open file',
};

const BTN_DISABLE: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('eye-closed'),
  tooltip: 'Disable (exclude from search)',
};

const BTN_ENABLE: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('eye'),
  tooltip: 'Enable (include in search)',
};

// ---------------------------------------------------------------------------
// QuickPickItem for a single .gitignore file
// ---------------------------------------------------------------------------

interface GitignoreItem extends vscode.QuickPickItem {
  uri: vscode.Uri;
  isEnabled: boolean;
}

function buildItem(uri: vscode.Uri): GitignoreItem {
  const enabled = isGitignoreFileEnabled(uri);
  const rel = gitignoreRelPath(uri);

  return {
    uri,
    isEnabled: enabled,
    label: `$(${enabled ? 'check' : 'circle-slash'}) ${rel}`,
    description: enabled ? t('Active') : t('Disabled'),
    buttons: [BTN_OPEN, enabled ? BTN_DISABLE : BTN_ENABLE],
  };
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

export function registerManageGitignoreCommand(
  context: vscode.ExtensionContext,
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.manageGitignore',
    async () => {
      // Ensure we are in a workspace
      if (
        !vscode.workspace.workspaceFolders ||
        vscode.workspace.workspaceFolders.length === 0
      ) {
        void vscode.window.showWarningMessage(
          t(
            'The .gitignore management feature is only available within a Workspace. Use Workspace settings to enable it.',
          ),
          { modal: true },
        );
        return;
      }

      const quickPick = vscode.window.createQuickPick<GitignoreItem>();
      quickPick.title = t('.gitignore Files');
      quickPick.placeholder = t('Detected .gitignore files in your workspace');
      quickPick.canSelectMany = false;
      quickPick.ignoreFocusOut = false;
      quickPick.busy = true;
      quickPick.show();

      // -----------------------------------------------------------------------
      // Refresh helper — rebuilds items from current state
      // -----------------------------------------------------------------------
      async function refresh(): Promise<void> {
        quickPick.busy = true;
        const uris = await discoverGitignoreFiles();

        if (uris.length === 0) {
          quickPick.items = [
            {
              uri: vscode.Uri.file(''),
              isEnabled: false,
              label: `$(info) ${t('No .gitignore files found in this workspace')}`,
              description: '',
              buttons: [],
            },
          ];
        } else {
          quickPick.items = uris.map(buildItem);
        }
        quickPick.busy = false;
      }

      await refresh();

      // Re-refresh when .gitignore files appear / disappear on disk
      onGitignoreDiscoveryChange(() => {
        void refresh();
      });

      // -----------------------------------------------------------------------
      // Item selection → toggle enable/disable
      // -----------------------------------------------------------------------
      quickPick.onDidAccept(async () => {
        const [selected] = quickPick.selectedItems;
        if (!selected || !selected.uri.fsPath) return;

        await setGitignoreFileEnabled(selected.uri, !selected.isEnabled);
        await refresh();
      });

      // -----------------------------------------------------------------------
      // Button clicks
      // -----------------------------------------------------------------------
      quickPick.onDidTriggerItemButton(async (e) => {
        const item = e.item as GitignoreItem;
        if (!item.uri.fsPath) return;

        if (e.button === BTN_OPEN) {
          await vscode.window.showTextDocument(item.uri);
          return;
        }

        if (e.button === BTN_ENABLE || e.button === BTN_DISABLE) {
          await setGitignoreFileEnabled(item.uri, e.button === BTN_ENABLE);
          await refresh();
        }
      });

      quickPick.onDidHide(() => quickPick.dispose());
    },
  );

  context.subscriptions.push(disposable);
}
