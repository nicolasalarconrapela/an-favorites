import * as vscode from 'vscode';
import { Logger } from '../logging/logger';
import { FavoritesTreeDataProvider } from './FavoritesTreeDataProvider';

export class LineFavoritesDecoration implements vscode.Disposable {
  private readonly decorationType: vscode.TextEditorDecorationType;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    context: vscode.ExtensionContext,
    private favoritesProvider: FavoritesTreeDataProvider,
    private logger: Logger,
  ) {
    const gutterIconPath = vscode.Uri.joinPath(
      context.extensionUri,
      'resources',
      'line-favorite.svg',
    );

    this.decorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath,
      gutterIconSize: '14px',
    });

    this.disposables.push(this.decorationType);
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor) {
          this.updateEditor(editor);
        }
      }),
    );

    this.disposables.push(
      vscode.window.onDidChangeVisibleTextEditors((editors) => {
        editors.forEach((editor) => this.updateEditor(editor));
      }),
    );

    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        const editors = vscode.window.visibleTextEditors.filter(
          (editor) => editor.document === event.document,
        );
        editors.forEach((editor) => this.updateEditor(editor));
      }),
    );

    this.disposables.push(
      this.favoritesProvider.onDidChangeTreeData(() => {
        vscode.window.visibleTextEditors.forEach((editor) =>
          this.updateEditor(editor),
        );
      }),
    );

    vscode.window.visibleTextEditors.forEach((editor) =>
      this.updateEditor(editor),
    );
  }

  public dispose(): void {
    this.disposables.forEach((disposable) => disposable.dispose());
    this.disposables.length = 0;
  }

  private updateEditor(editor: vscode.TextEditor): void {
    if (editor.document.uri.scheme !== 'file') {
      return;
    }

    const lines = this.favoritesProvider.getLineFavoritesLines(
      editor.document.uri,
    );

    if (lines.length === 0) {
      editor.setDecorations(this.decorationType, []);
      return;
    }

    const maxLine = editor.document.lineCount;
    const ranges = lines
      .filter((line) => line >= 1 && line <= maxLine)
      .map((line) => new vscode.Range(line - 1, 0, line - 1, 0));

    editor.setDecorations(this.decorationType, ranges);
    this.logger.debug?.(
      `[lineFavorites] Updated decorations for ${editor.document.uri.fsPath}`,
      { count: ranges.length },
    );
  }
}
