import * as vscode from 'vscode';

export interface ExtensionSettings {
  enableGreeting: boolean;
}

export function loadSettings(): ExtensionSettings {
  const config = vscode.workspace.getConfiguration('anfavorites');
  return {
    enableGreeting: config.get<boolean>('enableGreeting', true),
  };
}
