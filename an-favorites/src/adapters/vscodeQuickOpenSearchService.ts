import * as vscode from 'vscode';
import { QuickOpenSearchService } from '../commands/quickOpen/quickOpenSearchService';

export class VscodeQuickOpenSearchService implements QuickOpenSearchService {
  findFiles(
    pattern: string,
    exclude: string | undefined,
    limit: number,
    token?: vscode.CancellationToken,
  ): Thenable<vscode.Uri[]> {
    return vscode.workspace.findFiles(pattern, exclude, limit, token);
  }
}
