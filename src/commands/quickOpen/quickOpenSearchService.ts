import * as vscode from 'vscode';

export interface QuickOpenSearchService {
  readonly providesFilteredResults?: boolean;

  findFiles(
    pattern: string,
    excludePatterns: string[],
    limit: number,
    token?: vscode.CancellationToken,
  ): Thenable<vscode.Uri[]>;
}
