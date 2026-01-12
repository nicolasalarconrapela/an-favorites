import * as vscode from 'vscode';

export function registerWebviewCommand(
  context: vscode.ExtensionContext,
): void {
  
  const command = vscode.commands.registerCommand(
    'anfavorites.openWebview',
    () => {
      const panel = vscode.window.createWebviewPanel(
        'anfavorites.webview',
        'AnFavorites Webview',
        vscode.ViewColumn.One,
        {},
      );
      panel.webview.html = '<h1>AnFavorites</h1>';
    },
  );
  context.subscriptions.push(command);
  
}
