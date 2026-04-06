import * as vscode from 'vscode';
import { ReleaseChangesPanel } from '../panels/ReleaseChangesPanel';

export function registerOpenReleaseChangesCommand(
  context: vscode.ExtensionContext,
) {
  context.subscriptions.push(
    vscode.commands.registerCommand('anfavorites.openReleaseChanges', async () => {
      await ReleaseChangesPanel.render(context.extensionUri);
    }),
  );
}
