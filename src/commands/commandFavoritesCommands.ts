import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../logging/logger';
import {
  CommandFavoritesTreeDataProvider,
  CommandItem,
  resolveWorkspaceCwd,
} from '../views/CommandFavoritesTreeDataProvider';
import { t } from '../utils/l10n';

// Directories excluded from the directory picker
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  '.cache',
  '.parcel-cache',
  '.turbo',
  '.next',
  '.nuxt',
  '.vite',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  'ENV',
  'target',
  '.gradle',
  '.idea',
  'bin',
  'obj',
  '.vs',
  '.history',
  'TestResults',
  'artifacts',
]);

// ── Back sentinel ───────────────────────────────────────────────────────────
const BACK = Object.freeze({ type: 'back' as const });
type Back = typeof BACK;
function isBack(v: unknown): v is Back {
  return v === BACK;
}

// ── Shared button definitions ───────────────────────────────────────────────

/** Appears on the LEFT side of the title bar (VS Code built-in back button). */
const BACK_BUTTON = vscode.QuickInputButtons.Back;

/** Appears on the RIGHT side of the title bar. Shown when step value is valid. */
const NEXT_BUTTON: vscode.QuickInputButton = {
  iconPath: new vscode.ThemeIcon('arrow-right'),
  tooltip: t('Next step'),
};

/**
 * Builds the buttons array for an InputBox step.
 * Back goes to the left (built-in), Next goes to the right (custom).
 */
function inputButtons(
  showBack: boolean,
  hasValue: boolean,
): readonly vscode.QuickInputButton[] {
  const btns: vscode.QuickInputButton[] = [];
  if (showBack) btns.push(BACK_BUTTON);
  if (hasValue) btns.push(NEXT_BUTTON);
  return btns;
}

// ── Step helpers ────────────────────────────────────────────────────────────

/**
 * Shows an InputBox step with optional back button (left) and conditional
 * next button (right, shown only when value is non-empty).
 * Returns:
 *   • string    → user submitted a non-empty value
 *   • BACK      → user pressed the back button
 *   • undefined → user cancelled (Escape)
 */
async function createTextStep(opts: {
  title: string;
  prompt: string;
  placeholder: string;
  emptyWarning: string;
  currentValue?: string;
  showBack?: boolean;
}): Promise<string | Back | undefined> {
  return new Promise<string | Back | undefined>((resolve) => {
    const inputBox = vscode.window.createInputBox();
    inputBox.title = opts.title;
    inputBox.prompt = opts.prompt;
    inputBox.placeholder = opts.placeholder;
    inputBox.value = opts.currentValue ?? '';
    inputBox.ignoreFocusOut = true;

    const showBack = opts.showBack ?? false;

    // Set initial buttons based on pre-filled value
    inputBox.buttons = inputButtons(showBack, !!opts.currentValue?.trim());

    let finished = false;
    const disposables: vscode.Disposable[] = [];

    function done(result: string | Back | undefined) {
      if (finished) return;
      finished = true;
      disposables.forEach((d) => d.dispose());
      inputBox.dispose();
      resolve(result);
    }

    // Update Next button visibility as user types
    disposables.push(
      inputBox.onDidChangeValue((value) => {
        inputBox.buttons = inputButtons(showBack, !!value.trim());
      }),
    );

    disposables.push(
      inputBox.onDidAccept(() => {
        const value = inputBox.value.trim();
        if (!value) {
          vscode.window.showWarningMessage(opts.emptyWarning);
          return;
        }
        done(value);
      }),
    );

    // Distinguish back (left, built-in) from next (right, custom)
    disposables.push(
      inputBox.onDidTriggerButton((button) => {
        if (button === BACK_BUTTON) {
          done(BACK);
        } else {
          // NEXT_BUTTON — same effect as pressing Enter
          const value = inputBox.value.trim();
          if (value) {
            done(value);
          } else {
            vscode.window.showWarningMessage(opts.emptyWarning);
          }
        }
      }),
    );

    disposables.push(
      inputBox.onDidHide(() => {
        done(undefined);
      }),
    );

    inputBox.show();
  });
}

// ── Directory picker ────────────────────────────────────────────────────────

interface NavItem extends vscode.QuickPickItem {
  navType?: 'goUp' | 'selectCurrent' | 'enterFolder' | 'manual';
  navFolder?: vscode.WorkspaceFolder;
  navAbsPath?: string;
  navCwd?: string | null;
}

/**
 * Shows an interactive QuickPick directory browser with drill-down navigation.
 * Returns:
 *   • BACK      → user pressed the step-back button/item
 *   • undefined → user cancelled (Escape)
 *   • null      → workspace root (no explicit cwd)
 *   • string    → relative or absolute path
 */
async function promptCwd(
  currentCwd?: string,
  totalSteps: number = 5,
  stepNumber: number = 3,
): Promise<string | null | undefined | Back> {
  const folders = vscode.workspace.workspaceFolders;
  const isMultiRoot = folders && folders.length > 1;
  const workspaceType = isMultiRoot ? t('Multi-root') : t('Workspace');
  const stepTitle = `${t('Add Command Favorite')} (${stepNumber}/${totalSteps}) — ${t('Select working directory')} [${workspaceType}]`;

  // No workspace folders: fallback to manual InputBox with back + next buttons
  if (!folders || folders.length === 0) {
    return new Promise<string | null | undefined | Back>((resolve) => {
      const inputBox = vscode.window.createInputBox();
      inputBox.title = stepTitle;
      inputBox.prompt = t(
        'Working directory (relative to workspace root, leave empty for root)',
      );
      inputBox.placeholder = t(
        'e.g.: backend  or  /absolute/path  or  leave empty',
      );
      inputBox.value = currentCwd ?? '';
      inputBox.ignoreFocusOut = true;
      // For directory: empty is valid → Next always shown. Back always shown.
      inputBox.buttons = [BACK_BUTTON, NEXT_BUTTON];

      let finished = false;
      const disposables: vscode.Disposable[] = [];

      function done(result: string | null | undefined | Back) {
        if (finished) return;
        finished = true;
        disposables.forEach((d) => d.dispose());
        inputBox.dispose();
        resolve(result);
      }

      disposables.push(
        inputBox.onDidAccept(() => {
          done(inputBox.value.trim() || null);
        }),
      );
      disposables.push(
        inputBox.onDidTriggerButton((button) => {
          if (button === BACK_BUTTON) {
            done(BACK);
          } else {
            done(inputBox.value.trim() || null);
          }
        }),
      );
      disposables.push(inputBox.onDidHide(() => done(undefined)));

      inputBox.show();
    });
  }

  // Removed duplicate const isMultiRoot = folders.length > 1;

  // Navigation state — null means "multi-root top level"
  let currentFolder: vscode.WorkspaceFolder | null = isMultiRoot
    ? null
    : folders[0];
  let currentAbsPath: string | null = isMultiRoot
    ? null
    : folders[0].uri.fsPath;

  if (currentCwd) {
    const resolved = resolveWorkspaceCwd(currentCwd);
    if (resolved) {
      currentAbsPath = resolved;
      const folder = vscode.workspace.getWorkspaceFolder(
        vscode.Uri.file(resolved),
      );
      if (folder) {
        currentFolder = folder;
      }
    }
  }

  const initialValue = currentAbsPath ?? '';

  const quickPick = vscode.window.createQuickPick<NavItem>();
  quickPick.title = stepTitle;
  quickPick.placeholder = t('Choose a directory where the command will run');
  quickPick.value = initialValue;
  quickPick.matchOnDescription = true;
  quickPick.ignoreFocusOut = true;

  let userMovedSelection = false;
  let ignoreNextActiveChange = false;

  async function buildItems() {
    quickPick.busy = true;
    const items: NavItem[] = [];

    if (currentAbsPath === null && folders) {
      // Multi-root top level: show each workspace folder as navigable entry
      for (const folder of folders) {
        items.push({
          label: `$(root-folder) ${folder.name}`,
          description: folder.uri.fsPath,
          detail: t('Navigate into folder'),
          navType: 'enterFolder',
          navFolder: folder,
          navAbsPath: folder.uri.fsPath,
        });
      }
    } else if (currentAbsPath !== null && currentFolder) {
      const isAtFolderRoot = currentAbsPath === currentFolder.uri.fsPath;

      // [↑] Go up — shown when inside a subfolder OR at folder root in multi-root
      if (!isAtFolderRoot || isMultiRoot) {
        const upDesc =
          isMultiRoot && isAtFolderRoot
            ? t('Back to workspace root list')
            : path.dirname(currentAbsPath);
        items.push({
          label: `$(arrow-up) ..`,
          description: `${upDesc}  [${currentAbsPath}]`,
          navType: 'goUp',
        });
      }

      // Removed selectCurrent item (redundant with Next button and path in textbox)

      items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });

      // Subdirectories
      try {
        const uri = vscode.Uri.file(currentAbsPath);
        const entries = await vscode.workspace.fs.readDirectory(uri);
        const subdirs = entries
          .filter(
            ([name, type]) =>
              type === vscode.FileType.Directory && !EXCLUDED_DIRS.has(name),
          )
          .map(([name]) => name)
          .sort();
        for (const subdir of subdirs) {
          const absSubdir = path.join(currentAbsPath, subdir);
          items.push({
            label: `$(folder) ${subdir}`,
            description: absSubdir,
            navType: 'enterFolder',
            navFolder: currentFolder,
            navAbsPath: absSubdir,
          });
        }
      } catch {
        // ignore read errors (permissions, etc.)
      }
    }

    // Manual entry
    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
    items.push({
      label: `$(edit) ${t('Enter directory manually...')}`,
      description: t('Type a relative or absolute path'),
      navType: 'manual',
    });

    quickPick.items = items;

    if (currentAbsPath !== null) {
      quickPick.value = currentAbsPath;
    }
    quickPick.activeItems = [];
    ignoreNextActiveChange = true;
    userMovedSelection = false;

    // Update buttons based on selection: always include Back (left), add Next (right) if valid selection
    updateButtons();

    quickPick.busy = false;
  }

  function updateButtons() {
    const selectedItem = quickPick.selectedItems[0] as NavItem | undefined;
    const buttons: vscode.QuickInputButton[] = [];

    // Back button (left): always show to go back to previous step
    buttons.push(BACK_BUTTON);

    // Next button (right): show when a valid selectable item is chosen
    // Next button (right): show when we have any path to accept
    if (currentAbsPath !== null || quickPick.value.trim().length > 0) {
      buttons.push(NEXT_BUTTON);
    }

    quickPick.buttons = buttons;
  }

  function goUp() {
    if (isMultiRoot && currentAbsPath === currentFolder!.uri.fsPath) {
      // At workspace folder root in multi-root → back to top
      currentFolder = null;
      currentAbsPath = null;
    } else if (currentAbsPath !== null) {
      const parent = path.dirname(currentAbsPath);
      // Don't navigate above the workspace folder root
      if (currentFolder && !parent.startsWith(currentFolder.uri.fsPath)) {
        currentAbsPath = currentFolder.uri.fsPath;
      } else {
        currentAbsPath = parent;
      }
    }
  }

  // Tracks the full absolute path of the currently highlighted QuickPick item,
  // so it can be pre-filled in the InputBox when the user opens manual entry.
  let syncedInputValue: string = currentCwd ?? '';

  return new Promise<string | null | undefined | Back>((resolve) => {
    let finished = false;
    const disposables: vscode.Disposable[] = [];

    function done(result: string | null | undefined | Back) {
      if (finished) return;
      finished = true;
      disposables.forEach((d) => d.dispose());
      quickPick.dispose();
      resolve(result);
    }

    function getStoredCwd(absPath: string): string | null {
      if (!folders) return absPath;
      const folder = vscode.workspace.getWorkspaceFolder(
        vscode.Uri.file(absPath),
      );
      if (!folder) return absPath;
      const rel = path.relative(folder.uri.fsPath, absPath).replace(/\\/g, '/');
      const isMultiRoot = folders.length > 1;
      if (isMultiRoot) {
        return rel === '' || rel === '.'
          ? folder.name
          : `${folder.name}/${rel}`;
      }
      return rel === '' || rel === '.' ? null : rel;
    }

    disposables.push(
      quickPick.onDidAccept(async () => {
        if (finished) return;

        // If Enter was pressed on the input box (value matches path and selection hasn't moved),
        // we accept the path in the box.
        const currentVal = quickPick.value.trim();
        const comparisonVal = currentAbsPath || '';
        if (
          currentVal === comparisonVal &&
          !userMovedSelection &&
          currentAbsPath !== null
        ) {
          done(getStoredCwd(currentAbsPath));
          return;
        }

        const item = quickPick.selectedItems[0] as NavItem | undefined;

        if (item && item.kind !== vscode.QuickPickItemKind.Separator) {
          if ((item as any).navType === 'stepBack') {
            done(BACK);
            return;
          }

          if (item && item.navType === 'enterFolder') {
            currentFolder = item.navFolder!;
            currentAbsPath = item.navAbsPath!;
            quickPick.value = currentAbsPath;
            await buildItems();
            return;
          }

          if (item && item.navType === 'goUp') {
            goUp();
            quickPick.value = currentAbsPath ?? '';
            await buildItems();
            return;
          }

          if (item && item.navType === 'manual') {
            // ... manual logic remains the same
            // (I will keep the manual logic for now as it's a useful fallback)
            // Hide the QuickPick temporarily (do NOT dispose — we may need to re-show it)
            finished = true; // prevent onDidHide from resolving
            quickPick.hide();

            // Open an InputBox for manual entry with back (left) + next (right) buttons
            const manual = await new Promise<string | null | Back | undefined>(
              (resolveManual) => {
                const inputBox = vscode.window.createInputBox();
                inputBox.title = stepTitle;
                inputBox.prompt = t(
                  'Working directory (relative to workspace root, leave empty for root)',
                );
                inputBox.placeholder = t(
                  'e.g.: backend  or  /absolute/path  or  leave empty',
                );
                inputBox.value = quickPick.value || (currentAbsPath ?? '');
                inputBox.ignoreFocusOut = true;
                // Directory: empty is valid → Next always shown. Back always shown.
                inputBox.buttons = [BACK_BUTTON, NEXT_BUTTON];

                let manualFinished = false;
                const manualDisposables: vscode.Disposable[] = [];

                function doneManual(result: string | null | Back | undefined) {
                  if (manualFinished) return;
                  manualFinished = true;
                  manualDisposables.forEach((d) => d.dispose());
                  inputBox.dispose();
                  resolveManual(result);
                }

                manualDisposables.push(
                  inputBox.onDidAccept(() => {
                    doneManual(inputBox.value.trim() || null);
                  }),
                );

                manualDisposables.push(
                  inputBox.onDidTriggerButton((button) => {
                    if (button === BACK_BUTTON) {
                      doneManual(BACK);
                    } else {
                      doneManual(inputBox.value.trim() || null);
                    }
                  }),
                );

                manualDisposables.push(
                  inputBox.onDidHide(() => {
                    doneManual(undefined);
                  }),
                );

                inputBox.show();
              },
            );

            if (isBack(manual)) {
              // User pressed back → return to directory QuickPick
              finished = false;
              await buildItems();
              quickPick.show();
            } else {
              disposables.forEach((d) => d.dispose());
              quickPick.dispose();
              resolve(manual === undefined ? undefined : manual);
            }
            return;
          }
        }

        // If no item is selected (or Enter pressed on search/path box), accept the current path
        const value = quickPick.value.trim();
        const finalPath = value || currentAbsPath;
        if (finalPath) {
          done(getStoredCwd(finalPath));
        }
      }),
    );

    // Back button (left, in title): go back to previous step
    // Next button (right): performs action for selected item
    disposables.push(
      quickPick.onDidTriggerButton(async (button) => {
        if (finished) return;
        if (button === BACK_BUTTON) {
          // Back button always goes to previous step
          done(BACK);
        } else if (button === NEXT_BUTTON) {
          const value = quickPick.value.trim();
          const finalPath = value || currentAbsPath;
          if (finalPath) {
            done(getStoredCwd(finalPath));
          }
        }
      }),
    );

    // Track if user moved selection or if it was automatic
    disposables.push(
      quickPick.onDidChangeActive((active) => {
        if (ignoreNextActiveChange) {
          ignoreNextActiveChange = false;
          return;
        }
        if (active.length > 0) {
          userMovedSelection = true;
        }
        updateButtons();
      }),
    );

    // Sync selected item's absolute path to QuickPick value field and InputBox pre-fill
    disposables.push(
      quickPick.onDidChangeSelection(() => {
        const selection = quickPick.selectedItems;
        const item = selection[0] as NavItem | undefined;
        if (
          item &&
          item.navType !== 'manual' &&
          item.kind !== vscode.QuickPickItemKind.Separator
        ) {
          const fullPath =
            item.navAbsPath ??
            ((item as any).navType === 'selectCurrent' &&
            currentAbsPath !== null
              ? currentAbsPath
              : undefined);
          if (fullPath !== undefined) {
            quickPick.value = fullPath;
            userMovedSelection = true; // Selecting an item counts as moving
            ignoreNextActiveChange = true;
            quickPick.activeItems = [...selection];
            syncedInputValue = fullPath;
          }
        }
        updateButtons();
      }),
    );

    disposables.push(
      quickPick.onDidChangeValue((val) => {
        // If the user manually types the current path, reset the "moved" flag
        if (val.trim() === (currentAbsPath || '')) {
          userMovedSelection = false;
          ignoreNextActiveChange = true;
        }
        updateButtons();
      }),
    );

    disposables.push(
      quickPick.onDidHide(() => {
        done(undefined); // Escape or focus lost
      }),
    );

    buildItems().then(() => {
      if (!finished) quickPick.show();
    });
  });
}

// ── Mode step (step 4) ──────────────────────────────────────────────────────

/**
 * Shows a QuickPick for execution mode (Foreground/Background).
 * Back button (left, built-in) goes to the previous step.
 * Returns:
 *   • true      → Background
 *   • false     → Foreground
 *   • BACK      → user pressed the back button
 *   • undefined → user cancelled (Escape)
 */
async function runModeStep(
  title: string,
  currentBackground?: boolean,
): Promise<boolean | Back | undefined> {
  return new Promise<boolean | Back | undefined>((resolve) => {
    interface ModeItem extends vscode.QuickPickItem {
      isBackground: boolean;
    }

    const quickPick = vscode.window.createQuickPick<ModeItem>();
    quickPick.title = title;
    quickPick.placeholder = t('How should this command run?');
    quickPick.ignoreFocusOut = true;
    // Built-in back button → appears on the LEFT
    quickPick.buttons = [BACK_BUTTON];
    quickPick.items = [
      {
        label: `$(terminal) ${t('Foreground')}`,
        description: t('Opens a new terminal — default shell (like Ctrl+`)'),
        isBackground: false,
        picked: !(currentBackground ?? false),
      },
      {
        label: `$(server-process) ${t('Background')}`,
        description: t('Runs as a VS Code task — no freeze risk'),
        isBackground: true,
        picked: currentBackground ?? false,
      },
    ];

    let finished = false;
    const disposables: vscode.Disposable[] = [];

    function done(result: boolean | Back | undefined) {
      if (finished) return;
      finished = true;
      disposables.forEach((d) => d.dispose());
      quickPick.dispose();
      resolve(result);
    }

    disposables.push(
      quickPick.onDidAccept(() => {
        const item = quickPick.selectedItems[0] as ModeItem | undefined;
        if (!item) return;
        done(item.isBackground);
      }),
    );

    disposables.push(
      quickPick.onDidTriggerButton((button) => {
        if (button === BACK_BUTTON) done(BACK);
      }),
    );

    disposables.push(
      quickPick.onDidHide(() => {
        done(undefined);
      }),
    );

    quickPick.show();
  });
}

// ── Preview step (step 5) ───────────────────────────────────────────────────

/**
 * Shows the preview step with Save / Test / Edit / Cancel options.
 * Returns:
 *   • 'save'    → user chose Save
 *   • 'test'    → user chose Test (execute command and stay in preview)
 *   • 'edit'    → user chose Edit (restart from step 1)
 *   • undefined → user cancelled (Escape or Cancel)
 */
async function runPreviewStep(
  title: string,
  previewCommand: string,
  command: string,
  cwd: string | undefined,
  background: boolean,
): Promise<'save' | 'test' | 'edit' | undefined> {
  interface PreviewItem extends vscode.QuickPickItem {
    action?: 'save' | 'test' | 'edit' | 'cancel';
  }

  // Show command preview in an InputBox first
  await new Promise<void>((resolve) => {
    const inputBox = vscode.window.createInputBox();
    inputBox.title = title;
    inputBox.prompt = t('Preview');
    inputBox.value = previewCommand;
    // inputBox.readOnly = true; // Removed because it doesn't exist on InputBox
    inputBox.ignoreFocusOut = true;

    let finished = false;
    const disposables: vscode.Disposable[] = [];

    function done() {
      if (finished) return;
      finished = true;
      disposables.forEach((d) => d.dispose());
      inputBox.dispose();
      resolve();
    }

    disposables.push(
      inputBox.onDidAccept(() => {
        done();
      }),
    );

    disposables.push(
      inputBox.onDidHide(() => {
        done();
      }),
    );

    inputBox.show();
  });

  // Now show the action options
  const items: PreviewItem[] = [
    {
      label: `$(save) ${t('Save')}`,
      description: t('Save without running'),
      action: 'save',
    },
    {
      label: `$(debug-start) ${t('Test')}`,
      description: t('Run command in a terminal and return'),
      action: 'test',
    },
    {
      label: `$(edit) ${t('Edit')}`,
      description: t('Back to beginning to edit all fields'),
      action: 'edit',
    },
    {
      label: `$(close) ${t('Cancel')}`,
      description: t('Discard this command'),
      action: 'cancel',
    },
  ];

  const selection = (await vscode.window.showQuickPick(items, {
    title: `${title} — ${t('Choose action')}`,
    ignoreFocusOut: true,
  })) as PreviewItem | undefined;

  if (!selection) return undefined;

  // Handle Test action
  if (selection.action === 'test') {
    // Execute the command in a terminal
    const resolvedCwd = resolveWorkspaceCwd(cwd);
    const terminal = vscode.window.createTerminal({
      name: `Test Command`,
      cwd: resolvedCwd,
    });
    terminal.sendText(command);
    terminal.show();

    // Wait a moment then re-show the preview
    await new Promise((resolve) => setTimeout(resolve, 500));
    return runPreviewStep(title, previewCommand, command, cwd, background);
  }

  if (selection.action === 'cancel') return undefined;
  return selection.action;
}

// ── Preview command builder ─────────────────────────────────────────────────

function buildPreviewCommand(command: string, cwd?: string): string {
  if (!cwd) return command;
  return `cd "${cwd}" && ${command}`;
}

// ── Main wizard flow ────────────────────────────────────────────────────────

interface CommandFlowResult {
  label: string;
  command: string;
  cwd?: string;
  background: boolean;
}

async function promptCommandFlow(existing?: {
  label: string;
  command: string;
  cwd?: string;
  background: boolean;
}): Promise<CommandFlowResult | undefined> {
  const TOTAL = 5;
  let step = 1;

  // Accumulated state — pre-populated from existing when editing
  let stepLabel = existing?.label ?? '';
  let stepCommand = existing?.command ?? '';
  let stepCwd: string | null = existing?.cwd ?? null;
  let stepBackground = existing?.background ?? false;

  while (step >= 1 && step <= 5) {
    switch (step) {
      case 1: {
        const r = await createTextStep({
          title: `${t('Add Command Favorite')} (1/${TOTAL})`,
          prompt: t('Command name (shown in the list)'),
          placeholder: t('e.g.: Start backend'),
          emptyWarning: t('Command name cannot be empty.'),
          currentValue: stepLabel,
          showBack: false,
        });
        if (r === undefined) return undefined; // cancelled
        if (isBack(r)) return undefined; // step 1 has no real back — treat as cancel
        stepLabel = r;
        step = 2;
        break;
      }
      case 2: {
        const r = await createTextStep({
          title: `${t('Add Command Favorite')} (2/${TOTAL})`,
          prompt: t('Shell command to execute'),
          placeholder: t('e.g.: npm run dev'),
          emptyWarning: t('Command cannot be empty.'),
          currentValue: stepCommand,
          showBack: true,
        });
        if (r === undefined) return undefined;
        if (isBack(r)) {
          step = 1;
          break;
        }
        stepCommand = r;
        step = 3;
        break;
      }
      case 3: {
        const r = await promptCwd(stepCwd ?? undefined, TOTAL, 3);
        if (r === undefined) return undefined;
        if (isBack(r)) {
          step = 2;
          break;
        }
        stepCwd = r; // null = workspace root, string = path
        step = 4;
        break;
      }
      case 4: {
        const r = await runModeStep(
          `${t('Add Command Favorite')} (4/${TOTAL})`,
          stepBackground,
        );
        if (r === undefined) return undefined;
        if (isBack(r)) {
          step = 3;
          break;
        }
        stepBackground = r;
        step = 5;
        break;
      }
      case 5: {
        const cwd = stepCwd === null ? undefined : stepCwd;
        const preview = buildPreviewCommand(stepCommand, cwd);
        const r = await runPreviewStep(
          `${t('Add Command Favorite')} (5/${TOTAL}) — ${t('Preview')}`,
          preview,
          stepCommand,
          cwd,
          stepBackground,
        );
        if (r === undefined) return undefined; // cancelled
        if (r === 'edit') {
          step = 1;
          break;
        } // restart from step 1
        // r === 'save'
        return {
          label: stepLabel.trim(),
          command: stepCommand.trim(),
          cwd,
          background: stepBackground,
        };
      }
    }
  }
  return undefined;
}

// ── Command registration ────────────────────────────────────────────────────

export function registerCommandFavoritesCommands(
  context: vscode.ExtensionContext,
  commandsProvider: CommandFavoritesTreeDataProvider,
  logger: Logger,
): void {
  // ── Run command (from tree click or programmatic call) ─────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.runCommandFavorite',
      (item?: CommandItem) => {
        if (!item) {
          logger.warn(
            '[commandFavorites] runCommandFavorite called without item',
          );
          return;
        }
        commandsProvider.runCommand(item);
      },
    ),
  );

  // ── Add command ────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.addCommandFavorite',
      async () => {
        const result = await promptCommandFlow();

        if (result) {
          commandsProvider.addCommand({
            label: result.label,
            command: result.command,
            cwd: result.cwd,
            background: result.background,
          });
          vscode.window.showInformationMessage(
            t('Command "{0}" added.', result.label),
          );
          logger.info(`[commandFavorites] Added command: "${result.label}"`);
        }

        vscode.commands.executeCommand('anfavorites.quickOpen');
      },
    ),
  );

  // ── Edit command (from tree context menu) ──────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.editCommandFavorite',
      async (item?: CommandItem) => {
        if (!item) return;

        const result = await promptCommandFlow({
          label: item.data.label,
          command: item.data.command,
          cwd: item.data.cwd,
          background: item.data.background,
        });

        if (result) {
          const ok = commandsProvider.editCommand(item.data.id, {
            label: result.label,
            command: result.command,
            cwd: result.cwd,
            background: result.background,
          });
          if (ok) {
            vscode.window.showInformationMessage(
              t('Command "{0}" updated.', result.label),
            );
            logger.info(`[commandFavorites] Edited command id=${item.data.id}`);
          }
        }

        vscode.commands.executeCommand('anfavorites.quickOpen');
      },
    ),
  );

  // ── Remove command (from tree context menu) ────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.removeCommandFavorite',
      async (item?: CommandItem) => {
        if (!item) return;

        const confirm = await vscode.window.showWarningMessage(
          t('Remove command "{0}"?', item.data.label),
          { modal: true },
          t('Remove'),
        );
        if (confirm !== t('Remove')) return;

        commandsProvider.removeCommand(item.data.id);
        logger.info(`[commandFavorites] Removed command id=${item.data.id}`);
      },
    ),
  );

  logger.debug('[commandFavorites] Commands registered');
}
