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
        vscode.l10n.t('Preview Release'),
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

    const tabTitle = `v${version} - AnFavorites`;
    if (this._panel) {
      this._panel.title = tabTitle;
    }

    const bannerUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', 'banner_logo.png'),
    );

    const iconUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'resources', 'icon_no_bg.svg'),
    );

    const backgroundDarkUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'resources',
        'background_mosaic_dark.png',
      ),
    );

    const backgroundLightUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'resources',
        'background_mosaic_light.png',
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

    const shareText = vscode.l10n.t(
      "Hey everyone! I'd like to share this new extension with you!",
    );
    const marketplaceUrl =
      'https://marketplace.visualstudio.com/items?itemName=AnAppWilos.an-favorites';
    const openVsxUrl = 'https://open-vsx.org/extension/AnAppWilos/an-favorites';
    const hashtags = '#anfavorites #vscode';

    const fullMessage = `${shareText}\n\nMarketplace: ${marketplaceUrl}\nOpen VSX: ${openVsxUrl}\n\n${hashtags}`;
    const encodedFullMessage = encodeURIComponent(fullMessage);
    const encodedMarketplaceUrl = encodeURIComponent(marketplaceUrl);

    // X (Twitter)
    const twitterShareUrl = `https://twitter.com/intent/tweet?text=${encodedFullMessage}`;
    // LinkedIn
    const linkedinShareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodedMarketplaceUrl}`;
    // Reddit
    const redditShareUrl = `https://www.reddit.com/submit?url=${encodedMarketplaceUrl}&title=${encodeURIComponent(shareText)}`;

    return /* html */ `<!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline' ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src * data: vscode-resource: https: ${webview.cspSource};">
          <title>${tabTitle}</title>
          <style>
              body {
                font-family: var(--vscode-font-family);
                font-size: var(--vscode-font-size);
                color: var(--vscode-editor-foreground);
                background-color: var(--vscode-editor-background);
                background-image: url('${backgroundDarkUri}');
                background-repeat: repeat;
                background-size: 400px;
                padding: 0;
                margin: 0;
                line-height: 1.6;
              }

              body.vscode-light {
                background-image: url('${backgroundLightUri}');
              }

              .overlay {
                min-height: 100vh;
                background-color: var(--vscode-editor-background);
                opacity: 0.92;
                padding: 60px 40px;
              }

              .content-wrapper {
                max-width: 800px;
                margin: 0 auto;
                position: relative;
                z-index: 1;
                padding: 0 20px;
              }

              h1.release-title {
                font-size: 2.6em;
                font-weight: 700;
                margin-top: 0;
                margin-bottom: 1em;
                color: var(--vscode-editor-foreground);
                letter-spacing: -0.5px;
              }

              .summary-content {
                font-size: 1.4em;
                line-height: 1.4;
                color: var(--vscode-foreground);
                opacity: 0.85;
                margin-bottom: 35px;
                font-weight: 400;
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

              .brand-header {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-bottom: 35px;
              }

              .brand-icon {
                width: 32px;
                height: 32px;
                object-fit: contain;
              }

              .brand-name {
                font-size: 1.4em;
                font-weight: 600;
                color: var(--vscode-editor-foreground);
                letter-spacing: -0.2px;
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



              .cta-container {
                  display: flex;
                  gap: 15px;
                  margin-top: 50px;
                  padding: 25px;
                  background: var(--vscode-welcomePage-tileBackground, rgba(128, 128, 128, 0.1));
                  border-radius: 12px;
                  border: 1px solid var(--vscode-panel-border);
                  justify-content: center;
                  flex-wrap: wrap;
                  text-align: center;
              }

              .cta-container h3 {
                  width: 100%;
                  margin-top: 0;
                  margin-bottom: 15px;
                  font-size: 1.1em;
                  opacity: 0.9;
              }

              .cta-button {
                  display: flex;
                  align-items: center;
                  gap: 8px;
                  padding: 10px 20px;
                  background: var(--vscode-button-background);
                  color: var(--vscode-button-foreground) !important;
                  border-radius: 6px;
                  text-decoration: none !important;
                  font-size: 13px;
                  font-weight: 500;
                  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
                  width: fit-content;
                  margin: 0 auto;
              }

              .cta-button:hover {
                  background: var(--vscode-button-hoverBackground);
                  transform: translateY(-2px);
                  box-shadow: 0 4px 8px rgba(0,0,0,0.2);
              }

              .cta-button.secondary {
                  background: var(--vscode-button-secondaryBackground);
                  color: var(--vscode-button-secondaryForeground) !important;
                  margin: 0;
              }

              .cta-button.secondary:hover {
                  background: var(--vscode-button-secondaryHoverBackground);
              }

              .cta-button svg {
                  width: 16px;
                  height: 16px;
                  fill: currentColor;
                  flex-shrink: 0;
              }

              .release-footer {
                  margin-top: 60px;
                  padding-top: 30px;
                  border-top: 1px solid var(--vscode-panel-border);
                  font-size: 0.9em;
                  color: var(--vscode-descriptionForeground);
                  line-height: 1.8;
                  font-style: italic;
              }

              .release-footer p {
                  margin-bottom: 10px;
              }
          </style>
      </head>
      <body>
          <div class="overlay">
          <div class="content-wrapper">

          <h1 class="release-title">${this._releaseTitle || `${monthName} ${year} (version ${version})`}</h1>

          <div class="release-meta">
            Fecha de lanzamiento: ${formattedDate}
          </div>

          <div class="summary-content">
              ${this._summaryHtml}
          </div>

          <div class="markdown-body">
              ${this._detailsHtml}
          </div>
          <div class="release-footer">
              <p>${vscode.l10n.t('Dear user:')}</p>
              <p>${vscode.l10n.t('Thank you for trusting this application.')}</p>
              <p>${vscode.l10n.t('Whether you are one or a thousand: THANK YOU. And thank you for those first 500 downloads :).')}</p>
              <p>${vscode.l10n.t("I apologize if something doesn't work as it should.")}</p>
              <p>${vscode.l10n.t('I appreciate feedback (constructive criticism) as this extension is not mine, but yours.')}</p>
              <p>${vscode.l10n.t('Sincerely:')}</p>
              <p><strong>${vscode.l10n.t('@anappwilos')}</strong></p>
          </div>

          <div class="cta-container">
              <h4 style="text-align: center; width: 100%; margin-top: 0;">${vscode.l10n.t('Do you like AnFavorites?')}</h4>
              <a href="https://marketplace.visualstudio.com/items?itemName=AnAppWilos.an-favorites&ssr=false#review-details" target="_blank" style="text-decoration: none; width: 100%; display: block; text-align: center;">
                  <div style="display: flex; gap: 6px; justify-content: center; margin-bottom: 15px;">
                      <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 22px; height: 22px; fill: var(--vscode-editor-background); stroke: var(--vscode-foreground); stroke-width: 1.5;"><path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279L12 18.896l-7.416 4.517 1.48-8.279-6.064-5.828 8.332-1.151z"/></svg>
                      <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 22px; height: 22px; fill: var(--vscode-editor-background); stroke: var(--vscode-foreground); stroke-width: 1.5;"><path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279L12 18.896l-7.416 4.517 1.48-8.279-6.064-5.828 8.332-1.151z"/></svg>
                      <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 22px; height: 22px; fill: var(--vscode-editor-background); stroke: var(--vscode-foreground); stroke-width: 1.5;"><path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279L12 18.896l-7.416 4.517 1.48-8.279-6.064-5.828 8.332-1.151z"/></svg>
                      <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 22px; height: 22px; fill: var(--vscode-editor-background); stroke: var(--vscode-foreground); stroke-width: 1.5;"><path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279L12 18.896l-7.416 4.517 1.48-8.279-6.064-5.828 8.332-1.151z"/></svg>
                      <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" style="width: 22px; height: 22px; fill: var(--vscode-editor-background); stroke: var(--vscode-foreground); stroke-width: 1.5;"><path d="M12 .587l3.668 7.568 8.332 1.151-6.064 5.828 1.48 8.279L12 18.896l-7.416 4.517 1.48-8.279-6.064-5.828 8.332-1.151z"/></svg>
                  </div>
              </a>
              <a href="${linkedinShareUrl}" class="cta-button secondary" target="_blank">
                  <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>LinkedIn</title><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                  ${vscode.l10n.t('Share on LinkedIn')}
              </a>
              <a href="${redditShareUrl}" class="cta-button secondary" target="_blank">
                  <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Reddit</title><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.688-.56-.1.249-1.249-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>
                  ${vscode.l10n.t('Share on Reddit')}
              </a>
              <a href="${twitterShareUrl}" class="cta-button secondary" target="_blank">
                  <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>X</title><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>
                  ${vscode.l10n.t('Share on X')}
              </a>
              <a href="https://github.com/nicolasalarconrapela/an-favorites" class="cta-button secondary" target="_blank">
                  <svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>GitHub</title><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
                  ${vscode.l10n.t('Contribute')}
              </a>
          </div>
          </div>
          </div>
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
