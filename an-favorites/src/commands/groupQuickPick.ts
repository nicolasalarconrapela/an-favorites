import * as vscode from 'vscode';
import { FavoritesTreeDataProvider } from '../views/FavoritesTreeDataProvider';

interface GroupQuickPickItem extends vscode.QuickPickItem {
  groupName?: string;
  isCreate?: boolean;
  createValue?: string;
}

interface GroupQuickPickParams {
  groups: string[];
  favoritesProvider: FavoritesTreeDataProvider;
  placeHolder?: string;
  title?: string;
  activeItem?: string;
}

export async function showGroupQuickPickWithCreate(
  params: GroupQuickPickParams,
): Promise<string | undefined> {
  const { groups, favoritesProvider, placeHolder, title, activeItem } = params;
  const groupList = [...groups];

  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<GroupQuickPickItem>();
    let resolved = false;

    const finish = (value?: string) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
      quickPick.dispose();
    };

    const buildItems = (value: string): GroupQuickPickItem[] => {
      const trimmed = value.trim();
      const items: GroupQuickPickItem[] = groupList.map((group) => ({
        label: group,
        description:
          group === FavoritesTreeDataProvider.DEFAULT_GROUP
            ? 'Grupo por defecto'
            : undefined,
        groupName: group,
      }));

      if (trimmed && !groupList.includes(trimmed)) {
        items.unshift({
          label: `$(add) Crear grupo "${trimmed}"`,
          description: 'Crear y usar este grupo',
          isCreate: true,
          createValue: trimmed,
        });
      }

      return items;
    };

    const updateItems = (value: string) => {
      const items = buildItems(value);
      quickPick.items = items;
      if (activeItem) {
        const activeMatch = items.find(
          (item) => item.groupName === activeItem,
        );
        if (activeMatch) {
          quickPick.activeItems = [activeMatch];
        }
      }
    };

    quickPick.placeholder = placeHolder;
    quickPick.title = title;
    updateItems('');

    quickPick.onDidChangeValue((value) => {
      updateItems(value);
    });

    quickPick.onDidAccept(() => {
      const selection = quickPick.selectedItems[0];
      if (!selection) {
        quickPick.hide();
        return;
      }

      if (selection.isCreate && selection.createValue) {
        const name = selection.createValue.trim();
        const existing = groupList.find(
          (group) => group.toLowerCase() === name.toLowerCase(),
        );
        const targetGroup = existing ?? name;
        if (!existing) {
          favoritesProvider.addGroup(targetGroup);
          groupList.push(targetGroup);
        }
        finish(targetGroup);
        quickPick.hide();
        return;
      }

      if (selection.groupName) {
        finish(selection.groupName);
        quickPick.hide();
        return;
      }

      quickPick.hide();
    });

    quickPick.onDidHide(() => {
      finish(undefined);
    });

    quickPick.show();
  });
}
