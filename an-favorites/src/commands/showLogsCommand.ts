import * as vscode from 'vscode';

import { Logger } from '../logging/logger';

export function registerShowLogsCommand(
  context: vscode.ExtensionContext
): void {
  const command = vscode.commands.registerCommand(
    'anfavorites.showLogs',
    () => {
      vscode.commands.executeCommand('workbench.action.output.show');
    },
  );

  context.subscriptions.push(command);
}
