import * as vscode from 'vscode';
import { Logger } from '../logging/logger';

/**
 * Registers the command to open the VS Code keyboard shortcuts editor
 * filtered by the extension's name.
 */
export function registerKeyboardShortcutCommand(
  context: vscode.ExtensionContext,
  logger: Logger,
): void {
  const log = logger.withContext?.({ scope: 'KeyboardShortcutCommand' }) ?? logger;
  const disposable = vscode.commands.registerCommand(
    'anfavorites.configureKeybindings',
    () => {
      log.info('Opening keyboard shortcuts editor', {
        query: 'anfavorites',
      });

      // Opens the global keybindings editor with the extension's name as a filter
      vscode.commands.executeCommand(
        'workbench.action.openGlobalKeybindings',
        'anfavorites',
      );
    },
  );

  context.subscriptions.push(disposable);
}
