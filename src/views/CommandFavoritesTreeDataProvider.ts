import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../logging/logger';
import { SharedStorageService } from '../services/sharedStorageService';
import { t } from '../utils/l10n';

export interface CommandFavoriteData {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  background: boolean;
  addedAt: number;
}

const STORAGE_KEY = 'anfavorites.commands.v1';

export class CommandItem extends vscode.TreeItem {
  constructor(public readonly data: CommandFavoriteData) {
    super(data.label, vscode.TreeItemCollapsibleState.None);

    this.id = `command:${data.id}`;
    this.tooltip = data.background
      ? `${data.command}${data.cwd ? ` (${data.cwd})` : ''} — ${t('Background')}`
      : `${data.command}${data.cwd ? ` (${data.cwd})` : ''} — ${t('Foreground')}`;
    this.description = data.cwd
      ? `${data.command}  [${data.cwd}]`
      : data.command;
    this.iconPath = new vscode.ThemeIcon(
      data.background ? 'server-process' : 'terminal',
    );
    this.contextValue = data.background
      ? 'commandItem:background'
      : 'commandItem';
    this.command = {
      command: 'anfavorites.runCommandFavorite',
      title: t('Run Command'),
      arguments: [this],
    };
  }
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function resolveWorkspaceCwd(cwd?: string): string | undefined {
  if (!cwd) return undefined;

  if (path.isAbsolute(cwd)) return cwd;

  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return cwd;

  // Multi-root: paths are stored as "FolderName/subdir" — resolve against the matching root
  if (folders.length > 1) {
    const slashIdx = cwd.indexOf('/');
    if (slashIdx !== -1) {
      const folderName = cwd.slice(0, slashIdx);
      const subdir = cwd.slice(slashIdx + 1);
      const matchingFolder = folders.find((f) => f.name === folderName);
      if (matchingFolder) {
        return path.join(matchingFolder.uri.fsPath, subdir);
      }
    }
  }

  return path.join(folders[0].uri.fsPath, cwd);
}

export class CommandFavoritesTreeDataProvider
  implements vscode.TreeDataProvider<CommandItem>, vscode.Disposable
{
  private readonly disposables: vscode.Disposable[] = [];
  private _onDidChangeTreeData = new vscode.EventEmitter<
    CommandItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private commands: CommandFavoriteData[] = [];
  private _isSaving = false;

  constructor(
    private readonly logger: Logger,
    private readonly storage: SharedStorageService,
  ) {
    this.loadCommands();

    this.disposables.push(
      this.storage.onDidChange(() => {
        if (this._isSaving) return;
        this.logger.debug('[commands] External storage change -> reload');
        this.loadCommands();
        this.refresh();
      }),
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: CommandItem): vscode.TreeItem {
    return element;
  }

  getChildren(_element?: CommandItem): CommandItem[] {
    return this.commands
      .sort((a, b) => b.addedAt - a.addedAt)
      .map((cmd) => new CommandItem(cmd));
  }

  getCommands(): CommandFavoriteData[] {
    return [...this.commands];
  }

  addCommand(
    data: Omit<CommandFavoriteData, 'id' | 'addedAt'>,
  ): CommandFavoriteData {
    const newCmd: CommandFavoriteData = {
      ...data,
      id: generateId(),
      addedAt: Date.now(),
    };
    this.commands.push(newCmd);
    this.saveCommands();
    this.refresh();
    this.logger.debug(`[commands] addCommand -> "${newCmd.label}"`);
    return newCmd;
  }

  removeCommand(id: string): void {
    const before = this.commands.length;
    this.commands = this.commands.filter((c) => c.id !== id);
    if (this.commands.length !== before) {
      this.saveCommands();
      this.refresh();
      this.logger.debug(`[commands] removeCommand -> id=${id}`);
    }
  }

  editCommand(id: string, data: Partial<Omit<CommandFavoriteData, 'id' | 'addedAt'>>): boolean {
    const idx = this.commands.findIndex((c) => c.id === id);
    if (idx === -1) {
      this.logger.warn(`[commands] editCommand FAILED (not found) -> id=${id}`);
      return false;
    }
    this.commands[idx] = { ...this.commands[idx], ...data };
    this.saveCommands();
    this.refresh();
    this.logger.debug(`[commands] editCommand -> id=${id}`);
    return true;
  }

  runCommand(item: CommandItem): void {
    const data = item.data;
    const resolvedCwd = resolveWorkspaceCwd(data.cwd);

    this.logger.debug(
      `[commands] runCommand -> "${data.label}" background=${data.background} cwd=${resolvedCwd ?? '(none)'}`,
    );

    if (data.background) {
      const task = new vscode.Task(
        { type: 'anfavorites-command', id: data.id },
        vscode.TaskScope.Workspace,
        data.label,
        'AnFavorites',
        new vscode.ShellExecution(data.command, {
          cwd: resolvedCwd,
        }),
      );
      task.presentationOptions = {
        reveal: vscode.TaskRevealKind.Silent,
        panel: vscode.TaskPanelKind.Dedicated,
        showReuseMessage: false,
        clear: false,
      };
      vscode.tasks.executeTask(task).then(
        () => {
          this.logger.debug(`[commands] Background task started: "${data.label}"`);
        },
        (err) => {
          this.logger.error(`[commands] Error starting background task`, err);
          vscode.window.showErrorMessage(
            t('Error executing command: {0}', String(err)),
          );
        },
      );
    } else {
      const terminal = vscode.window.createTerminal({
        name: data.label,
        cwd: resolvedCwd,
      });
      terminal.sendText(data.command);
      terminal.show();
      this.logger.debug(`[commands] Foreground terminal created: "${data.label}"`);
    }
  }

  private loadCommands(): void {
    const stored = this.storage.get<CommandFavoriteData[]>(STORAGE_KEY);
    if (stored && Array.isArray(stored)) {
      this.commands = stored;
      this.logger.debug(`[commands] loadCommands -> count=${this.commands.length}`);
    } else {
      this.commands = [];
      this.logger.debug('[commands] loadCommands -> no data found');
    }
  }

  private saveCommands(): void {
    this._isSaving = true;
    try {
      this.storage.update(STORAGE_KEY, this.commands);
      this.logger.debug(`[commands] saveCommands -> count=${this.commands.length}`);
    } finally {
      this._isSaving = false;
    }
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
    this._onDidChangeTreeData.dispose();
  }
}

export { resolveWorkspaceCwd };
