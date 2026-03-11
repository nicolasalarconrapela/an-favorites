import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { marked } from 'marked';

export class ReleaseChangesPanel {
  public static currentPanel: ReleaseChangesPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;
    this._extensionUri = extensionUri;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.iconPath = vscode.Uri.joinPath(
      extensionUri,
      'resources',
      'icon_no_bg.svg',
    );

    this._panel.webview.html = this._getWebviewContent(
      this._panel.webview,
      this._extensionUri,
    );

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'refresh':
            this._panel.webview.html = this._getWebviewContent(
              this._panel.webview,
              this._extensionUri,
            );
            vscode.window.showInformationMessage('Release notes refreshed!');
            return;
        }
      },
      null,
      this._disposables,
    );
  }

  public static render(extensionUri: vscode.Uri) {
    if (ReleaseChangesPanel.currentPanel) {
      ReleaseChangesPanel.currentPanel._panel.reveal(vscode.ViewColumn.One);
      ReleaseChangesPanel.currentPanel._panel.webview.html =
        ReleaseChangesPanel.currentPanel._getWebviewContent(
          ReleaseChangesPanel.currentPanel._panel.webview,
          extensionUri,
        );
    } else {
      const panel = vscode.window.createWebviewPanel(
        'releaseChanges',
        'Últimos cambios de la release',
        vscode.ViewColumn.One,
        {
          enableScripts: true,
          localResourceRoots: [extensionUri],
        },
      );

      ReleaseChangesPanel.currentPanel = new ReleaseChangesPanel(
        panel,
        extensionUri,
      );
    }
  }

  public dispose() {
    ReleaseChangesPanel.currentPanel = undefined;

    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _releaseTitle: string | undefined;
  private _lastReleaseDate: string | undefined;
  private _summaryHtml: string = '';
  private _detailsHtml: string = '';

  private _getMarkdownSource(): void {
    try {
      const releaseNotePath = path.join(
        this._extensionUri.fsPath,
        'RELEASE_NOTES.md',
      );

      if (fs.existsSync(releaseNotePath)) {
        let content = fs.readFileSync(releaseNotePath, 'utf8');

        // 1. Extraer título
        const titleMatch = content.match(/^(?:#|##)\s+(.+)$/m);
        if (titleMatch) {
          this._releaseTitle = titleMatch[1].trim();
          content = content.replace(/^(?:#|##)\s+.+\r?\n?/, '');
        }

        // 2. Extraer fecha (Busca "Fecha de lanzamiento")
        const dateMatch = content.match(
          /_\s*Fecha de lanzamiento:\s*([^_\n\r]+)_/i,
        );
        if (dateMatch) {
          this._lastReleaseDate = dateMatch[1].trim();
          content = content.replace(
            /_\s*Fecha de lanzamiento:\s*[^_\n\r]+_\r?\n?/i,
            '',
          );
        }

        // 3. Dividir contenido: Resumen vs Detalles (###)
        const splitMatch = content.match(/^###\s+/m);
        if (splitMatch && splitMatch.index !== undefined) {
          let summaryPart = content.substring(0, splitMatch.index).trim();
          const detailsPart = content.substring(splitMatch.index).trim();

          // Eliminar específicamente el encabezado "## Resumen" si existe
          summaryPart = summaryPart.replace(/^##\s+Resumen\r?\n?/i, '');

          this._summaryHtml = marked.parse(summaryPart) as string;
          this._detailsHtml = marked.parse(detailsPart) as string;
        } else {
          // Si no hay división, intentar quitar el encabezado de resumen de todo el contenido
          const cleanContent = content.replace(/^##\s+Resumen\r?\n?/i, '');
          this._summaryHtml = marked.parse(cleanContent) as string;
          this._detailsHtml = '';
        }
      }
    } catch (error) {
      this._summaryHtml = `<p>Error: ${error}</p>`;
    }
  }

  private _getWebviewContent(
    webview: vscode.Webview,
    _extensionUri: vscode.Uri,
  ): string {
    const nonce = getNonce();
    this._getMarkdownSource();

    // Obtener información de la versión
    let version = '1.0.0';
    try {
      const packagePath = path.join(this._extensionUri.fsPath, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      version = pkg.version;
    } catch (e) {}

    const bannerUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'resources',
        'banner_logo_v1.png',
      ),
    );

    // Formatear la fecha
    const releaseDateStr =
      this._lastReleaseDate || new Date().toISOString().split('T')[0];
    const dateObj = new Date(releaseDateStr);

    // Si la fecha extraída ya es legible (como "29 de marzo, 2027"), usarla directamente.
    // De lo contrario, intentar formatearla normalmente.
    const formattedDate = !isNaN(dateObj.getTime())
      ? dateObj.toLocaleDateString('en-US', {
          month: 'long',
          day: 'numeric',
          year: 'numeric',
        })
      : releaseDateStr;

    const monthName = !isNaN(dateObj.getTime())
      ? dateObj.toLocaleString('en-US', { month: 'long' })
      : '';
    const year = !isNaN(dateObj.getTime()) ? dateObj.getFullYear() : '';

    return /* html */ `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src * data: vscode-resource: https: ${webview.cspSource};">
          <title>Últimos cambios de la release</title>
          <style>
              body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-editor-foreground);
                background-color: var(--vscode-editor-background);
                padding: 30px 20px;
                line-height: 1.6;
                max-width: 900px;
                margin: 0 auto;
              }

              h1.release-title {
                font-size: 2.3em;
                font-weight: 300;
                margin-top: 0;
                margin-bottom: 20px;
                color: var(--vscode-editor-foreground);
              }

              .release-meta {
                color: var(--vscode-descriptionForeground);
                font-size: 0.95em;
                margin-bottom: 20px;
                font-style: italic;
              }

              hr {
                  height: 1px;
                  border: 0;
                  background-color: var(--vscode-panel-border);
                  margin: 20px 0 30px 0;
              }

              .banner-container {
                width: 100%;
                margin: 0 0 40px 0;
                border-radius: 8px;
                overflow: hidden;
                box-shadow: 0 4px 15px rgba(0,0,0,0.25);
                border: 1px solid var(--vscode-panel-border);
                position: relative;
                background-color: #0d1117;
              }

              .banner-img {
                width: 100%;
                display: block;
                max-height: 350px;
                object-fit: cover;
              }

              /* Markdown styles */
              h1, h2, h3, h4, h5, h6 {
                  color: var(--vscode-editor-foreground);
                  font-weight: 600;
                  margin-top: 30px;
                  margin-bottom: 16px;
                  line-height: 1.25;
              }

              h2 {
                  font-size: 1.6em;
                  padding-bottom: 0.3em;
                  border-bottom: 1px solid var(--vscode-panel-border);
                  margin-top: 25px;
                  font-weight: 500;
                  color: var(--vscode-editor-foreground);
              }
              h3 { font-size: 1.3em; }

              a { color: var(--vscode-textLink-foreground); text-decoration: none; }
              a:hover { text-decoration: underline; color: var(--vscode-textLink-activeForeground); }

              ul, ol { padding-left: 20px; margin-top: 0; margin-bottom: 20px; }
              li { margin-top: 0.5em; }

              p { margin-top: 0; margin-bottom: 16px; }

              code {
                  padding: 0.2em 0.4em;
                  margin: 0;
                  font-size: 90%;
                  background-color: var(--vscode-textCodeBlock-background);
                  border-radius: 4px;
                  font-family: var(--vscode-editor-font-family);
              }

              .header-actions {
                  position: absolute;
                  top: 35px;
                  right: 20px;
              }

              button {
                  background-color: transparent;
                  color: var(--vscode-button-secondaryForeground);
                  border: 1px solid var(--vscode-button-secondaryBackground);
                  padding: 6px 12px;
                  font-size: 12px;
                  cursor: pointer;
                  border-radius: 4px;
                  transition: background-color 0.2s;
              }

              button:hover {
                  background-color: var(--vscode-button-secondaryHoverBackground);
              }
          </style>
      </head>
      <body>
          <div class="banner-container">
              <img src="${bannerUri}" class="banner-img" alt="AnFavorites Update">
          </div>
          <div class="header-actions">
              <button id="refreshBtn">Refresh Notes</button>
          </div>

          <h1 class="release-title">${this._releaseTitle || `${monthName} ${year} (version ${version})`}</h1>

          <div class="release-meta">
            Fecha de lanzamiento: ${formattedDate}
          </div>

          <h2>
              ${this._summaryHtml}
          </h2>

          <div class="markdown-body">
              ${this._detailsHtml}
          </div>

          <script nonce="${nonce}">
              const vscode = acquireVsCodeApi();
              document.getElementById('refreshBtn').addEventListener('click', () => {
                  vscode.postMessage({ command: 'refresh' });
              });
          </script>
      </body>
      </html>`;
  }
}

function getNonce() {
  let text = '';
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
