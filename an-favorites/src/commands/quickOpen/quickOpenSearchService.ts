import * as vscode from 'vscode';

export interface QuickOpenSearchService {
  findFiles(
    pattern: string,
    exclude: string | undefined,
    limit: number,
    token?: vscode.CancellationToken,
  ): Thenable<vscode.Uri[]>;
}
