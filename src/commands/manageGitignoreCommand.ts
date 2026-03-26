import * as vscode from 'vscode';
import {
  discoverGitignoreFiles,
  isGitignoreFileEnabled,
  setGitignoreFileEnabled,
  setGitignoreFilesEnabled,
  gitignoreRelPath,
  subscribeGitignoreDiscoveryChange,
  subscribeGitignoreRulesChange,
} from '../utils/gitignoreService';
import { t } from '../utils/l10n';

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

interface GitignoreItem extends vscode.QuickPickItem {
  uri: vscode.Uri;
  isEnabled: boolean;
  itemType?: 'file' | 'group';
  groupUris?: vscode.Uri[];
}

function isWorkspaceRootGitignore(uri: vscode.Uri): boolean {
  const rel = gitignoreRelPath(uri).replace(/\\/g, '/');
  return rel === '.gitignore' || /^[^/]+\/\.gitignore$/.test(rel);
}

function formatGitignoreLabel(uri: vscode.Uri): string {
  const rel = gitignoreRelPath(uri).replace(/\\/g, '/');
  const workspaceFolders = vscode.workspace.workspaceFolders ?? [];

  if (workspaceFolders.length > 1) {
    const slashIndex = rel.indexOf('/');
    return slashIndex >= 0 ? rel.slice(slashIndex + 1) : rel;
  }

  if (workspaceFolders.length <= 1 && rel.endsWith('/.gitignore')) {
    const slashIndex = rel.indexOf('/');
    return slashIndex >= 0 ? rel.slice(slashIndex + 1) : rel;
  }

  return rel;
}

function buildWorkspaceHeaderItem(label: string): GitignoreItem {
  return {
    uri: vscode.Uri.file(''),
    isEnabled: false,
    itemType: 'group',
    label: `$(folder) ${label}`,
    description: '',
    buttons: [],
  };
}

function buildItem(uri: vscode.Uri): GitignoreItem {
  const enabled = isGitignoreFileEnabled(uri);
  const rel = formatGitignoreLabel(uri);

  return {
    uri,
    isEnabled: enabled,
    itemType: 'file',
    label: `   ${enabled ? '$(check) ' : '$(blank) '}${rel}`,
    description: enabled ? t('Active') : t('Disabled'),
    buttons: [BTN_OPEN, enabled ? BTN_DISABLE : BTN_ENABLE],
  };
}

function buildGroupItem(label: string, uris: vscode.Uri[]): GitignoreItem {
  const allEnabled = uris.every((uri) => isGitignoreFileEnabled(uri));
  const enabledCount = uris.filter((uri) => isGitignoreFileEnabled(uri)).length;
  const iconPrefix =
    enabledCount === 0
      ? '$(blank) '
      : enabledCount === uris.length
        ? '$(check) '
        : '$(dash) ';

  return {
    uri: vscode.Uri.file(''),
    isEnabled: allEnabled,
    itemType: 'group',
    groupUris: uris,
    label: `${iconPrefix}${label} ${enabledCount}/${uris.length}`,
    description: '',
    buttons: [],
  };
}

export function registerManageGitignoreCommand(
  context: vscode.ExtensionContext,
): void {
  const disposable = vscode.commands.registerCommand(
    'anfavorites.manageGitignore',
    async () => {
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

      async function refresh(): Promise<void> {
        quickPick.busy = true;
        const uris = await discoverGitignoreFiles();
        const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
        const isMultiRoot = workspaceFolders.length > 1;

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
          const items: GitignoreItem[] = [];

          const groups = isMultiRoot
            ? workspaceFolders.map((folder) => ({
                label: folder.name,
                uris: uris.filter(
                  (uri) =>
                    vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath ===
                    folder.uri.fsPath,
                ),
              }))
            : [{ label: '', uris }];

          for (const group of groups) {
            if (group.uris.length === 0) {
              continue;
            }

            if (isMultiRoot) {
              items.push(buildWorkspaceHeaderItem(group.label));
            }

            const rootItems = group.uris
              .filter(isWorkspaceRootGitignore)
              .map(buildItem);
            const subdirectoryItems = group.uris
              .filter((uri) => !isWorkspaceRootGitignore(uri))
              .map(buildItem);

            if (rootItems.length > 0) {
              items.push(
                buildGroupItem(
                  t('Workspace Root'),
                  rootItems.map((item) => item.uri),
                ),
              );
              items.push(...rootItems);
            }

            if (subdirectoryItems.length > 0) {
              items.push(
                buildGroupItem(
                  t('Subdirectory'),
                  subdirectoryItems.map((item) => item.uri),
                ),
              );
              items.push(...subdirectoryItems);
            }
          }

          quickPick.items = items;
        }

        quickPick.busy = false;
      }

      await refresh();

      const discoverySubscription = subscribeGitignoreDiscoveryChange(() => {
        void refresh();
      });
      const rulesSubscription = subscribeGitignoreRulesChange(() => {
        void refresh();
      });

      quickPick.onDidAccept(async () => {
        const [selected] = quickPick.selectedItems;
        if (!selected) return;

        if (selected.itemType === 'group' && selected.groupUris) {
          await setGitignoreFilesEnabled(
            selected.groupUris,
            !selected.isEnabled,
          );
          await refresh();
          return;
        }

        if (!selected.uri.fsPath) return;
        await setGitignoreFileEnabled(selected.uri, !selected.isEnabled);
        await refresh();
      });

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

      quickPick.onDidHide(() => {
        discoverySubscription.dispose();
        rulesSubscription.dispose();
        quickPick.dispose();
      });
    },
  );

  context.subscriptions.push(disposable);
}
