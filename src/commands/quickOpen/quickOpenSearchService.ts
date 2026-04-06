import * as vscode from 'vscode';
import { Logger } from '../../logging/logger';

export interface QuickOpenSearchService {
  readonly providesFilteredResults?: boolean;

  findFiles(
    pattern: string,
    excludePatterns: string[],
    limit: number,
    token?: vscode.CancellationToken,
    logger?: Logger,
  ): Thenable<vscode.Uri[]>;
}
