import * as vscode from 'vscode';
import {
  CustomRuntimeInput,
  RuntimeId,
  RuntimeManagerService,
  RuntimePreference,
} from '../services/runtimeManagerService';

type WebviewMessage =
  | { type: 'ready' }
  | {
      type: 'updateRuntime';
      runtimeId: RuntimeId;
      preference: RuntimePreference;
    }
  | { type: 'addCustomRuntime'; runtime: CustomRuntimeInput }
  | { type: 'removeCustomRuntime'; runtimeId: RuntimeId }
  | { type: 'resetRuntime'; runtimeId: RuntimeId }
  | { type: 'testRuntime'; runtimeId: RuntimeId };

export class CommandCenterPanel {
  private static currentPanel: CommandCenterPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly runtimeManager: RuntimeManagerService,
    private readonly getAvailableLanguages: () => string[],
  ) {
    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => {
        void this.handleMessage(message);
      },
      undefined,
      this.disposables,
    );
  }

  static open(
    context: vscode.ExtensionContext,
    runtimeManager: RuntimeManagerService,
    getAvailableLanguages: () => string[],
  ): void {
    if (CommandCenterPanel.currentPanel) {
      CommandCenterPanel.currentPanel.panel.reveal(vscode.ViewColumn.One);
      CommandCenterPanel.currentPanel.postState();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'anfavorites.commandCenter',
      'AnFavorites Command Center',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [context.extensionUri],
      },
    );

    CommandCenterPanel.currentPanel = new CommandCenterPanel(
      panel,
      runtimeManager,
      getAvailableLanguages,
    );
    panel.webview.html = CommandCenterPanel.currentPanel.getHtml(panel.webview);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'ready':
        this.postState();
        return;
      case 'updateRuntime':
        await this.runtimeManager.updateRuntime(
          message.runtimeId,
          message.preference,
        );
        this.postState();
        return;
      case 'addCustomRuntime':
        try {
          await this.runtimeManager.addCustomRuntime(message.runtime);
          this.postState();
        } catch (error) {
          await vscode.window.showErrorMessage(String(error));
        }
        return;
      case 'removeCustomRuntime':
        await this.runtimeManager.removeCustomRuntime(message.runtimeId);
        this.postState();
        return;
      case 'resetRuntime':
        await this.runtimeManager.resetRuntime(message.runtimeId);
        this.postState();
        return;
      case 'testRuntime':
        this.runtimeManager.testRuntime(message.runtimeId);
        return;
    }
  }

  private postState(): void {
    void this.panel.webview.postMessage({
      type: 'state',
      runtimes: this.runtimeManager.getRuntimeStates(
        this.getAvailableLanguages(),
      ),
      availableLanguages: this.getAvailableLanguages(),
    });
  }

  private dispose(): void {
    CommandCenterPanel.currentPanel = undefined;
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AnFavorites Command Center</title>
  <style>
    :root {
      color-scheme: light dark;
    }

    body {
      margin: 0;
      padding: 24px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .shell {
      max-width: 980px;
      margin: 0 auto;
    }

    header {
      margin-bottom: 20px;
    }

    .toolbar {
      display: flex;
      justify-content: flex-start;
      margin-bottom: 12px;
    }

    h1 {
      margin: 0 0 6px;
      font-size: 24px;
      font-weight: 600;
      letter-spacing: 0;
    }

    .subtitle {
      margin: 0;
      color: var(--vscode-descriptionForeground);
      line-height: 1.45;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px;
    }

    .card {
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-sideBar-background);
      padding: 16px;
      min-width: 0;
    }

    .card.disabled {
      opacity: 0.58;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 12px;
      margin-bottom: 14px;
    }

    h2 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      letter-spacing: 0;
    }

    .active {
      margin-top: 4px;
      color: var(--vscode-descriptionForeground);
      word-break: break-word;
    }

    .badge {
      flex: 0 0 auto;
      border: 1px solid var(--vscode-badge-background);
      border-radius: 999px;
      padding: 2px 8px;
      color: var(--vscode-badge-foreground);
      background: var(--vscode-badge-background);
      font-size: 11px;
      line-height: 18px;
    }

    .badge.incomplete {
      border-color: var(--vscode-inputValidation-warningBorder);
      color: var(--vscode-editorWarning-foreground);
      background: transparent;
    }

    .badge.disabled {
      border-color: var(--vscode-disabledForeground);
      color: var(--vscode-disabledForeground);
      background: transparent;
    }

    label {
      display: block;
      margin-bottom: 6px;
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }

    select,
    input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--vscode-input-border);
      border-radius: 4px;
      padding: 7px 8px;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font-family: var(--vscode-font-family);
    }

    select:focus,
    input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }

    .field {
      margin-bottom: 12px;
    }

    .runtime-form {
      display: none;
      border: 1px solid var(--vscode-panel-border);
      border-radius: 6px;
      background: var(--vscode-sideBar-background);
      padding: 16px;
      margin-bottom: 12px;
    }

    .runtime-form.open {
      display: block;
    }

    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }

    .actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 14px;
    }

    button {
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 4px;
      padding: 6px 11px;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      font-family: var(--vscode-font-family);
      cursor: pointer;
    }

    button:hover {
      background: var(--vscode-button-hoverBackground);
    }

    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }

    button.secondary:hover {
      background: var(--vscode-button-secondaryHoverBackground);
    }

    .empty {
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <main class="shell">
    <header>
      <h1>Runtime Manager</h1>
      <p class="subtitle">Choose the command AnFavorites sends to the terminal for each runtime.</p>
    </header>
    <div class="toolbar">
      <button id="addRuntimeButton" type="button">Add Runtime</button>
    </div>
    <section id="runtimeForm" class="runtime-form" aria-label="Add custom runtime">
      <div class="form-grid">
        <div class="field">
          <label for="runtimeId">Runtime id</label>
          <input id="runtimeId" type="text" placeholder="java">
        </div>
        <div class="field">
          <label for="runtimeLabel">Name</label>
          <input id="runtimeLabel" type="text" placeholder="Java">
        </div>
        <div class="field">
          <label for="runtimeAliases">Aliases</label>
          <input id="runtimeAliases" type="text" placeholder="java, exec">
        </div>
        <div class="field">
          <label for="runtimeDefault">Default command</label>
          <input id="runtimeDefault" type="text" placeholder="java">
        </div>
        <div class="field">
          <label for="runtimeTest">Test argument</label>
          <input id="runtimeTest" type="text" placeholder="-version">
        </div>
        <div class="field">
          <label for="runtimeLanguages">Language keys</label>
          <input id="runtimeLanguages" type="text" placeholder="java">
        </div>
      </div>
      <div class="actions">
        <button id="saveRuntimeButton" type="button">Save Runtime</button>
        <button id="cancelRuntimeButton" class="secondary" type="button">Cancel</button>
      </div>
    </section>
    <section id="runtimeGrid" class="grid" aria-live="polite">
      <p class="empty">Loading runtimes...</p>
    </section>
  </main>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const grid = document.getElementById('runtimeGrid');
    const addRuntimeButton = document.getElementById('addRuntimeButton');
    const runtimeForm = document.getElementById('runtimeForm');
    const saveRuntimeButton = document.getElementById('saveRuntimeButton');
    const cancelRuntimeButton = document.getElementById('cancelRuntimeButton');
    const runtimeIdInput = document.getElementById('runtimeId');
    const runtimeLabelInput = document.getElementById('runtimeLabel');
    const runtimeAliasesInput = document.getElementById('runtimeAliases');
    const runtimeDefaultInput = document.getElementById('runtimeDefault');
    const runtimeTestInput = document.getElementById('runtimeTest');
    const runtimeLanguagesInput = document.getElementById('runtimeLanguages');

    addRuntimeButton.addEventListener('click', () => {
      runtimeForm.classList.add('open');
      runtimeIdInput.focus();
    });

    cancelRuntimeButton.addEventListener('click', () => {
      clearRuntimeForm();
      runtimeForm.classList.remove('open');
    });

    saveRuntimeButton.addEventListener('click', () => {
      const id = runtimeIdInput.value.trim();
      const aliases = runtimeAliasesInput.value.trim();
      if (!id || !aliases) {
        return;
      }

      vscode.postMessage({
        type: 'addCustomRuntime',
        runtime: {
          id,
          label: runtimeLabelInput.value.trim(),
          aliases,
          defaultCommand: runtimeDefaultInput.value.trim(),
          testArgument: runtimeTestInput.value.trim(),
          languageKeys: runtimeLanguagesInput.value.trim(),
        },
      });
      clearRuntimeForm();
      runtimeForm.classList.remove('open');
    });

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'state') {
        render(event.data.runtimes || []);
      }
    });

    function render(runtimes) {
      grid.innerHTML = '';
      for (const runtime of runtimes) {
        grid.appendChild(createRuntimeCard(runtime));
      }
    }

    function createRuntimeCard(runtime) {
      const card = document.createElement('article');
      card.className = 'card';
      if (!runtime.enabled) {
        card.classList.add('disabled');
      }

      const header = document.createElement('div');
      header.className = 'card-header';

      const titleWrap = document.createElement('div');
      const title = document.createElement('h2');
      title.textContent = runtime.label;
      const active = document.createElement('div');
      active.className = 'active';
      active.textContent = runtime.activeCommand
        ? 'Active command: ' + runtime.activeCommand
        : 'Active command: not configured';
      if (!runtime.enabled && runtime.disabledReason) {
        const reason = document.createElement('div');
        reason.className = 'active';
        reason.textContent = runtime.disabledReason;
        titleWrap.append(title, active, reason);
      } else {
        titleWrap.append(title, active);
      }

      const badge = document.createElement('span');
      badge.className = 'badge ' + (runtime.enabled ? runtime.status : 'disabled');
      badge.textContent = runtime.enabled ? statusLabel(runtime.status) : 'Disabled';
      header.append(titleWrap, badge);

      const commandField = document.createElement('div');
      commandField.className = 'field';
      const commandLabel = document.createElement('label');
      commandLabel.textContent = 'Command';
      const select = document.createElement('select');
      for (const option of runtime.options) {
        const item = document.createElement('option');
        item.value = option.command;
        item.textContent = option.label;
        select.appendChild(item);
      }
      if (runtime.allowCustomCommand) {
        const customOption = document.createElement('option');
        customOption.value = 'custom';
        customOption.textContent = 'Custom path or command';
        select.appendChild(customOption);
      }
      select.value = runtime.selectedCommand;
      select.disabled = !runtime.enabled;
      commandField.append(commandLabel, select);

      const customField = document.createElement('div');
      customField.className = 'field';
      const customLabel = document.createElement('label');
      customLabel.textContent = 'Custom path or command';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = runtime.customCommand || '';
      input.placeholder = placeholderFor(runtime.id);
      input.disabled = !runtime.enabled || select.value !== 'custom';
      customField.append(customLabel, input);
      customField.style.display =
        runtime.allowCustomCommand && select.value === 'custom' ? '' : 'none';

      select.addEventListener('change', () => {
        input.disabled = !runtime.enabled || select.value !== 'custom';
        customField.style.display =
          runtime.allowCustomCommand && select.value === 'custom' ? '' : 'none';
        save(runtime.id, select.value, input.value);
      });
      let inputSaveTimer;
      input.addEventListener('input', () => {
        clearTimeout(inputSaveTimer);
        inputSaveTimer = setTimeout(() => {
          save(runtime.id, select.value, input.value);
        }, 300);
      });
      input.addEventListener('change', () => {
        clearTimeout(inputSaveTimer);
        save(runtime.id, select.value, input.value);
      });

      const actions = document.createElement('div');
      actions.className = 'actions';
      const testButton = document.createElement('button');
      testButton.textContent = 'Test';
      testButton.disabled = !runtime.enabled;
      testButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'testRuntime', runtimeId: runtime.id });
      });
      const resetButton = document.createElement('button');
      resetButton.className = 'secondary';
      resetButton.textContent = 'Reset';
      resetButton.addEventListener('click', () => {
        vscode.postMessage({ type: 'resetRuntime', runtimeId: runtime.id });
      });
      actions.append(testButton, resetButton);
      if (!runtime.readonly) {
        const removeButton = document.createElement('button');
        removeButton.className = 'secondary';
        removeButton.textContent = 'Remove';
        removeButton.addEventListener('click', () => {
          vscode.postMessage({
            type: 'removeCustomRuntime',
            runtimeId: runtime.id,
          });
        });
        actions.append(removeButton);
      }

      card.append(header, commandField, customField, actions);
      return card;
    }

    function save(runtimeId, command, customCommand) {
      vscode.postMessage({
        type: 'updateRuntime',
        runtimeId,
        preference: { command, customCommand },
      });
    }

    function statusLabel(status) {
      if (status === 'incomplete') return 'Incomplete';
      if (status === 'custom') return 'Custom';
      return 'Default';
    }

    function placeholderFor(runtimeId) {
      if (runtimeId === 'python') return 'C:\\\\Python312\\\\python.exe';
      if (runtimeId === 'node') return '/usr/local/bin/node';
      if (runtimeId === 'java') return '/usr/bin/java';
      if (runtimeId === 'maven') return './mvnw';
      if (runtimeId === 'gradle') return './gradlew';
      return 'Command or executable path';
    }

    function clearRuntimeForm() {
      runtimeIdInput.value = '';
      runtimeLabelInput.value = '';
      runtimeAliasesInput.value = '';
      runtimeDefaultInput.value = '';
      runtimeTestInput.value = '';
      runtimeLanguagesInput.value = '';
    }

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i += 1) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}
