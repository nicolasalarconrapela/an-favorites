import * as vscode from 'vscode';
import { marked } from 'marked';

export class ReleaseChangesPanel {
  public static currentPanel: ReleaseChangesPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];

  private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
    this._panel = panel;

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.html = this._getWebviewContent(
      this._panel.webview,
      extensionUri,
    );

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'refresh':
            this._panel.webview.html = this._getWebviewContent(
              this._panel.webview,
              extensionUri,
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

  private _getMarkdownSource(): string {
    // Aquí puedes cargar dinámicamente el CHANGELOG.md o RELEASE_NOTES.md
    // Por ahora usamos un mock con formato real
    return `
# Release v1.2.14

Publicado: 2026-03-10

## Destacados 🚀
- **Integración \`.gitignore\` más inteligente**: AnFavorites ahora aísla perfectamente su comportamiento con \`.gitignore\`. Aunque actúe globalmente por defecto, su **activación real** recae completamente en la configuración de *Workspace* actual, impidiendo descuidos globales en todos tus futuros proyectos.
- **Seguridad Reforzada**: Se han solucionado vulnerabilidades de alta gravedad (ReDoS) relacionadas con la librería \`minimatch\`, protegiendo tu entorno de desarrollo.

## Mejoras ✨
- **Progreso en Segundo Plano sin Interrupciones**: Al entrar en nuevos proyectos por primera vez, verás ahora una animación en la barra de estado de *"Escaneando el workspace en busca de archivos .gitignore..."*.
- **Claridad Transparente**: Al mover la configuración de los Archivos Ocultos desde la pestaña Global del Usuario observarás mensajes y alertas explicando que las configuraciones Globales "no tienen ningún efecto hasta pasarse a un Workspace", ahorrando mucho tiempo de dudas sobre sus impactos.
- **Infraestructura Moderna**: Migración completa a la configuración "Flat" de ESLint v10 y actualización de reglas internas de TypeScript.

## Solución de Bugs 🐛
- Corrección de la lógica de rastreo inicial: la ausencia de archivos \`.gitignore\` se reconoce ahora correctamente, finalizando el proceso de escaneo de forma limpia.
- Se eliminó un falso disparo del indicador de progreso que ocurría al navegar por las pestañas de ajustes globales sin que existiera un cambio real en el espacio de trabajo.
- Corrección de la lógica de evaluación y rastreo interno. A partir de ahora, la ausencia real de los ficheros \`.gitignore\` en tu código será catalogada silenciosamente en VS Code, evitando re-intentar iniciar rastreos que rompan o atrofien instalaciones.
`;
  }

  private _getWebviewContent(
    webview: vscode.Webview,
    _extensionUri: vscode.Uri,
  ): string {
    const nonce = getNonce();
    const markdownSource = this._getMarkdownSource();

    // Renderizar Markdown a HTML de forma segura
    const rawHtml = marked.parse(markdownSource) as string;

    return /* html */ `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src * data: vscode-resource: https:;">
          <title>Últimos cambios de la release</title>
          <style>
              body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-editor-foreground);
                background-color: var(--vscode-editor-background);
                padding: 20px 40px;
                line-height: 1.6;
                max-width: 800px;
                margin: 0 auto;
              }

              h1, h2, h3, h4, h5, h6 {
                  color: var(--vscode-editor-foreground);
                  font-weight: 600;
                  margin-top: 24px;
                  margin-bottom: 16px;
                  line-height: 1.25;
              }

              h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid var(--vscode-panel-border); }
              h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid var(--vscode-panel-border); }
              h3 { font-size: 1.25em; }

              a { color: var(--vscode-textLink-foreground); text-decoration: none; }
              a:hover { text-decoration: underline; color: var(--vscode-textLink-activeForeground); }

              ul, ol { padding-left: 2em; margin-top: 0; margin-bottom: 16px; }
              li { margin-top: 0.25em; }

              p { margin-top: 0; margin-bottom: 16px; }

              blockquote {
                  padding: 0 1em;
                  color: var(--vscode-textBlockQuote-foreground);
                  border-left: 0.25em solid var(--vscode-textBlockQuote-border);
                  background: var(--vscode-textBlockQuote-background);
                  margin: 0;
                  margin-bottom: 16px;
              }

              code {
                  padding: 0.2em 0.4em;
                  margin: 0;
                  font-size: 85%;
                  background-color: var(--vscode-textCodeBlock-background);
                  border-radius: 6px;
                  font-family: var(--vscode-editor-font-family);
              }

              pre {
                  padding: 16px;
                  overflow: auto;
                  font-size: 85%;
                  line-height: 1.45;
                  background-color: var(--vscode-textCodeBlock-background);
                  border-radius: 6px;
              }

              pre code {
                  display: inline;
                  max-width: auto;
                  padding: 0;
                  margin: 0;
                  overflow: visible;
                  line-height: inherit;
                  word-wrap: normal;
                  background-color: transparent;
                  border: 0;
              }

              hr {
                  height: 0.25em;
                  padding: 0;
                  margin: 24px 0;
                  background-color: var(--vscode-panel-border);
                  border: 0;
              }

              .header-actions {
                  display: flex;
                  justify-content: flex-end;
                  margin-bottom: 20px;
                  border-bottom: 1px solid var(--vscode-panel-border);
                  padding-bottom: 10px;
              }

              button {
                  background-color: var(--vscode-button-background);
                  color: var(--vscode-button-foreground);
                  border: none;
                  padding: 6px 14px;
                  font-size: var(--vscode-font-size);
                  cursor: pointer;
                  border-radius: 4px;
              }

              button:hover {
                  background-color: var(--vscode-button-hoverBackground);
              }
          </style>
      </head>
      <body>
          <div class="header-actions">
              <button id="refreshBtn">Actualizar</button>
          </div>
          <div class="markdown-body">
              ${rawHtml}
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
