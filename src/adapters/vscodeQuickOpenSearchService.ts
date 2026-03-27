import * as vscode from 'vscode';
import { QuickOpenSearchService } from '../commands/quickOpen/quickOpenSearchService';
import { buildExclusionGlobFromPatterns } from '../utils/gitignoreService';
import { Logger } from '../logging/logger';

export class VscodeQuickOpenSearchService implements QuickOpenSearchService {
  findFiles(
    pattern: string,
    excludePatterns: string[],
    limit: number,
    token?: vscode.CancellationToken,
    _logger?: Logger,
  ): Thenable<vscode.Uri[]> {
    return vscode.workspace.findFiles(
      pattern,
      buildExclusionGlobFromPatterns(excludePatterns),
      limit,
      token,
    );
  }
}
