import * as vscode from 'vscode';
import { Logger } from '../logging/logger';
import {
  CommandFavoritesTreeDataProvider,
  CommandItem,
} from '../views/CommandFavoritesTreeDataProvider';
import { t } from '../utils/l10n';

async function promptCommandFlow(
  existing?: { label: string; command: string; cwd?: string; background: boolean },
): Promise<{ label: string; command: string; cwd?: string; background: boolean } | undefined> {
  const label = await vscode.window.showInputBox({
    title: t('Add Command Favorite') + ' (1/4)',
    prompt: t('Command name (shown in the list)'),
    placeHolder: t('e.g.: Start backend'),
    value: existing?.label ?? '',
    ignoreFocusOut: true,
  });
  if (label === undefined) return undefined;
  if (!label.trim()) {
    vscode.window.showWarningMessage(t('Command name cannot be empty.'));
    return undefined;
  }

  const command = await vscode.window.showInputBox({
    title: t('Add Command Favorite') + ' (2/4)',
    prompt: t('Shell command to execute'),
    placeHolder: t('e.g.: npm run dev'),
    value: existing?.command ?? '',
    ignoreFocusOut: true,
  });
  if (command === undefined) return undefined;
  if (!command.trim()) {
    vscode.window.showWarningMessage(t('Command cannot be empty.'));
    return undefined;
  }

  const cwd = await vscode.window.showInputBox({
    title: t('Add Command Favorite') + ' (3/4)',
    prompt: t('Working directory (relative to workspace root, leave empty for root)'),
    placeHolder: t('e.g.: backend  or  /absolute/path  or  leave empty'),
    value: existing?.cwd ?? '',
    ignoreFocusOut: true,
  });
  if (cwd === undefined) return undefined;

  const modeItems: vscode.QuickPickItem[] = [
    {
      label: `$(terminal) ${t('Foreground')}`,
      description: t('Opens a visible interactive terminal'),
      picked: !(existing?.background ?? false),
    },
    {
      label: `$(server-process) ${t('Background')}`,
      description: t('Runs as a VS Code task — no freeze risk'),
      picked: existing?.background ?? false,
    },
  ];

  const modeSelection = await vscode.window.showQuickPick(modeItems, {
    title: t('Add Command Favorite') + ' (4/4)',
    placeHolder: t('How should this command run?'),
    ignoreFocusOut: true,
  });
  if (!modeSelection) return undefined;

  const background = modeSelection.label.includes(t('Background'));

  return {
    label: label.trim(),
    command: command.trim(),
    cwd: cwd.trim() || undefined,
    background,
  };
}

export function registerCommandFavoritesCommands(
  context: vscode.ExtensionContext,
  commandsProvider: CommandFavoritesTreeDataProvider,
  logger: Logger,
): void {
  // Run command (from tree or programmatically)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.runCommandFavorite',
      (item?: CommandItem) => {
        if (!item) {
          logger.warn('[commandFavorites] runCommandFavorite called without item');
          return;
        }
        commandsProvider.runCommand(item);
      },
    ),
  );

  // Add command
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.addCommandFavorite',
      async () => {
        const result = await promptCommandFlow();
        if (!result) return;

        commandsProvider.addCommand(result);
        vscode.window.showInformationMessage(
          t('Command "{0}" added.', result.label),
        );
        logger.info(`[commandFavorites] Added command: "${result.label}"`);
      },
    ),
  );

  // Edit command (from tree context menu)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.editCommandFavorite',
      async (item?: CommandItem) => {
        if (!item) return;

        const result = await promptCommandFlow({
          label: item.data.label,
          command: item.data.command,
          cwd: item.data.cwd,
          background: item.data.background,
        });

        if (!result) return;

        const ok = commandsProvider.editCommand(item.data.id, result);
        if (ok) {
          vscode.window.showInformationMessage(
            t('Command "{0}" updated.', result.label),
          );
          logger.info(`[commandFavorites] Edited command id=${item.data.id}`);
        }
      },
    ),
  );

  // Remove command (from tree context menu)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.removeCommandFavorite',
      async (item?: CommandItem) => {
        if (!item) return;

        const confirm = await vscode.window.showWarningMessage(
          t('Remove command "{0}"?', item.data.label),
          { modal: true },
          t('Remove'),
        );

        if (confirm !== t('Remove')) return;

        commandsProvider.removeCommand(item.data.id);
        logger.info(`[commandFavorites] Removed command id=${item.data.id}`);
      },
    ),
  );

  logger.debug('[commandFavorites] Commands registered');
}
