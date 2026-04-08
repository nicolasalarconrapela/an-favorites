import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from '../logging/logger';
import {
  FavoritesTreeDataProvider,
  CommandItem,
  resolveWorkspaceCwd,
} from '../views/FavoritesTreeDataProvider';
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
  navType?: 'goUp' | 'enterFolder';
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

  // Navigation state — null means "multi-root top level" or "workspace root"
  let currentFolder: vscode.WorkspaceFolder | null =
    !isMultiRoot && currentCwd ? folders[0] : null;
  let currentAbsPath: string | null =
    !isMultiRoot && currentCwd ? folders[0].uri.fsPath : null;

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

    // Next button (right): show when we have a navigated path to accept
    if (currentAbsPath !== null) {
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

    function getStoredCwd(absPath: string | null): string | null {
      if (!absPath) return null;
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
        if (!userMovedSelection && currentAbsPath !== null) {
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

        }

        // If no item is selected, accept the current navigated path only.
        done(getStoredCwd(currentAbsPath));
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
          done(getStoredCwd(currentAbsPath));
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
        if (item && item.kind !== vscode.QuickPickItemKind.Separator) {
          const fullPath =
            item.navAbsPath ??
            undefined;
          if (fullPath !== undefined) {
            quickPick.value = fullPath;
            userMovedSelection = true; // Selecting an item counts as moving
            ignoreNextActiveChange = true;
            quickPick.activeItems = [...selection];
          }
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

// ── Preview step (step 4) ───────────────────────────────────────────────────

/**
 * Shows the preview step with Save / Test / Edit / Cancel options.
 * Returns:
 *   • 'save'    → user chose Save
 *   • 'test'    → user chose Test (execute command and stay in preview)
 *   • 'edit'    → user chose Edit (restart from step 1)
 *   • undefined → user cancelled (Escape or Cancel)
 */
type PreviewResult =
  | { action: 'save'; command: string; background: boolean }
  | { action: 'edit' }
  | undefined;

const COMMAND_SCOPE_OPTIONS: Array<{
  value: 'local' | 'global';
  label: string;
  description: string;
}> = [
  {
    value: 'local',
    label: t('Local'),
    description: t('Only visible in this workspace'),
  },
  {
    value: 'global',
    label: t('Global'),
    description: t('Available in other workspaces in this VS Code profile'),
  },
];

const COMMAND_LANGUAGE_OPTIONS: Array<{
  value: string;
  label: string;
}> = [
  { value: 'python', label: t('Python') },
  { value: 'node', label: t('Node') },
  { value: 'java', label: t('Java') },
  { value: 'generic', label: t('Generic') },
];

async function promptCommandScope(
  currentScope: 'local' | 'global' = 'local',
  totalSteps: number,
  stepNumber: number,
): Promise<'local' | 'global' | Back | undefined> {
  interface ScopeItem extends vscode.QuickPickItem {
    scope: 'local' | 'global';
  }

  return new Promise<'local' | 'global' | Back | undefined>((resolve) => {
    const quickPick = vscode.window.createQuickPick<ScopeItem>();
    quickPick.title = `${t('Add Command Favorite')} (${stepNumber}/${totalSteps})`;
    quickPick.placeholder = t('Select command scope');
    quickPick.ignoreFocusOut = true;
    quickPick.buttons = stepNumber > 1 ? [BACK_BUTTON] : [];
    quickPick.items = COMMAND_SCOPE_OPTIONS.map((option) => ({
      label: option.label,
      description: option.description,
      scope: option.value,
      picked: option.value === currentScope,
    }));

    let finished = false;
    const disposables: vscode.Disposable[] = [];
    const done = (result: 'local' | 'global' | Back | undefined) => {
      if (finished) return;
      finished = true;
      disposables.forEach((d) => d.dispose());
      quickPick.dispose();
      resolve(result);
    };

    disposables.push(
      quickPick.onDidAccept(() => done(quickPick.selectedItems[0]?.scope)),
    );
    disposables.push(
      quickPick.onDidTriggerButton((button) => {
        if (button === BACK_BUTTON) done(BACK);
      }),
    );
    disposables.push(quickPick.onDidHide(() => done(undefined)));
    quickPick.show();
  });
}

async function promptCommandLanguage(
  currentLanguage: string = 'generic',
  totalSteps: number,
  stepNumber: number,
): Promise<string | Back | undefined> {
  interface LanguageItem extends vscode.QuickPickItem {
    language: string;
  }

  return new Promise<string | Back | undefined>((resolve) => {
    const quickPick = vscode.window.createQuickPick<LanguageItem>();
    quickPick.title = `${t('Add Command Favorite')} (${stepNumber}/${totalSteps})`;
    quickPick.placeholder = t('Select command language');
    quickPick.ignoreFocusOut = true;
    quickPick.buttons = [BACK_BUTTON];
    quickPick.items = COMMAND_LANGUAGE_OPTIONS.map((option) => ({
      label: option.label,
      language: option.value,
      picked: option.value === currentLanguage,
    }));

    let finished = false;
    const disposables: vscode.Disposable[] = [];
    const done = (result: string | Back | undefined) => {
      if (finished) return;
      finished = true;
      disposables.forEach((d) => d.dispose());
      quickPick.dispose();
      resolve(result);
    };

    disposables.push(
      quickPick.onDidAccept(() => done(quickPick.selectedItems[0]?.language)),
    );
    disposables.push(
      quickPick.onDidTriggerButton((button) => {
        if (button === BACK_BUTTON) done(BACK);
      }),
    );
    disposables.push(quickPick.onDidHide(() => done(undefined)));
    quickPick.show();
  });
}

async function runPreviewStep(
  title: string,
  command: string,
  cwd: string | undefined,
  background: boolean,
): Promise<PreviewResult | Back> {
  const SAVE_BTN: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('save'),
    tooltip: t('Save'),
  };
  const TEST_BTN: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('debug-start'),
    tooltip: t('Test Command'),
  };
  const MODE_BG_BTN: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('server-process'),
    tooltip: t('Mode: Background'),
  };
  const MODE_FG_BTN: vscode.QuickInputButton = {
    iconPath: new vscode.ThemeIcon('terminal'),
    tooltip: t('Mode: Foreground'),
  };

  let internalCommand = command;
  let internalBackground = background;

  return new Promise<PreviewResult | Back>((resolve) => {
    const inputBox = vscode.window.createInputBox();
    inputBox.title = title;
    inputBox.placeholder = t('Shell command to execute');
    inputBox.value = internalCommand;
    inputBox.ignoreFocusOut = true;

    function updateUI() {
      inputBox.prompt = undefined;

      inputBox.buttons = [
        BACK_BUTTON,
        internalBackground ? MODE_BG_BTN : MODE_FG_BTN,
        TEST_BTN,
        SAVE_BTN,
      ];
    }

    updateUI();

    const disposables: vscode.Disposable[] = [];

    disposables.push(
      inputBox.onDidAccept(() => {
        const val = inputBox.value.trim();
        if (!val) {
          vscode.window.showWarningMessage(t('Command cannot be empty.'));
          return;
        }
        internalCommand = val;
        disposables.forEach((d) => d.dispose());
        inputBox.dispose();
        resolve({
          action: 'save',
          command: internalCommand,
          background: internalBackground,
        });
      }),
    );

    disposables.push(
      inputBox.onDidTriggerButton(async (btn) => {
        if (btn === BACK_BUTTON) {
          disposables.forEach((d) => d.dispose());
          inputBox.dispose();
          resolve(BACK);
          return;
        }

        if (btn === SAVE_BTN) {
          const val = inputBox.value.trim();
          if (!val) {
            vscode.window.showWarningMessage(t('Command cannot be empty.'));
            return;
          }
          internalCommand = val;
          disposables.forEach((d) => d.dispose());
          inputBox.dispose();
          resolve({
            action: 'save',
            command: internalCommand,
            background: internalBackground,
          });
          return;
        }

        if (btn === TEST_BTN) {
          const val = inputBox.value.trim();
          if (!val) {
            vscode.window.showWarningMessage(t('Command cannot be empty.'));
            return;
          }
          const resolvedCwd = resolveWorkspaceCwd(cwd);
          const terminal = vscode.window.createTerminal({
            name: t('Test Command'),
            cwd: resolvedCwd,
          });
          terminal.sendText(val);
          terminal.show();
          return;
        }

        if (btn === MODE_BG_BTN || btn === MODE_FG_BTN) {
          internalBackground = !internalBackground;
          updateUI();
          return;
        }
      }),
    );

    disposables.push(
      inputBox.onDidHide(() => {
        disposables.forEach((d) => d.dispose());
        inputBox.dispose();
        resolve(undefined);
      }),
    );

    inputBox.show();
  });
}

// ── Main wizard flow ────────────────────────────────────────────────────────

interface CommandFlowResult {
  label: string;
  command: string;
  cwd?: string;
  background: boolean;
  scope: 'local' | 'global';
  language: string;
}

async function promptCommandFlow(
  provider: FavoritesTreeDataProvider,
  existing?: {
    label: string;
    command: string;
    cwd?: string;
    background: boolean;
    scope?: 'local' | 'global';
    language?: string;
  },
): Promise<CommandFlowResult | undefined> {
  const TOTAL = 6;
  let step = 1;

  // Accumulated state — pre-populated from existing when editing
  let stepLabel = existing?.label ?? '';
  let stepScope: 'local' | 'global' = existing?.scope ?? 'local';
  let stepLanguage = existing?.language ?? 'generic';
  let stepCommand = existing?.command ?? '';
  let stepCwd: string | null = existing?.cwd ?? null;
  let stepBackground = existing?.background ?? false;

  while (step >= 1 && step <= TOTAL) {
    switch (step) {
      case 1: {
        const r = await createTextStep({
          title: `${t('Add Command Favorite')} (1/${TOTAL})`,
          prompt: t('Name as it will appear in the favorites list'),
          placeholder: t('e.g.: Start Dev Server'),
          emptyWarning: t('Label cannot be empty.'),
          currentValue: stepLabel,
          showBack: false,
        });
        if (r === undefined) return undefined; // cancelled
        if (isBack(r)) return undefined; // step 1 has no real back
        stepLabel = r;
        step = 2;
        break;
      }
      case 2: {
        const r = await promptCommandScope(stepScope, TOTAL, 2);
        if (r === undefined) return undefined;
        if (isBack(r)) {
          step = 1;
          break;
        }
        stepScope = r;
        step = 3;
        break;
      }
      case 3: {
        const r = await promptCommandLanguage(stepLanguage, TOTAL, 3);
        if (r === undefined) return undefined;
        if (isBack(r)) {
          step = 2;
          break;
        }
        stepLanguage = r;
        step = 4;
        break;
      }
      case 4: {
        const cwd = stepCwd === null ? undefined : stepCwd;
        const r = await runPreviewStep(
          `${t('Add Command Favorite')} (4/${TOTAL}) — ${t('Command & Preview')}`,
          stepCommand,
          cwd,
          stepBackground,
        );

        if (r === undefined) return undefined; // cancelled
        if (isBack(r)) {
          step = 3; // Return to Directory selection
          break;
        }

        if (r.action === 'edit') {
          step = 1;
          break;
        }

        // action === 'save'
        return {
          label: stepLabel.trim(),
          command: r.command.trim(),
          cwd,
          background: r.background,
          scope: stepScope,
          language: stepLanguage,
        };
      }
    }
  }
  return undefined;
}

// ── Command registration ────────────────────────────────────────────────────

async function promptSaveOpenSourceFlow(
  provider: FavoritesTreeDataProvider,
  item: CommandItem,
  scope: 'local' | 'global',
): Promise<CommandFlowResult | undefined> {
  const result = await promptCommandFlow(provider, {
    label: item.data.label,
    command: item.data.command,
    cwd: item.data.cwd,
    background: item.data.background,
    scope,
    language: item.data.language,
  });

  if (!result) {
    return undefined;
  }

  return { ...result, scope };
}

export function registerCommandFavoritesCommands(
  context: vscode.ExtensionContext,
  commandsProvider: FavoritesTreeDataProvider,
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
        const result = await promptCommandFlow(commandsProvider);

        if (result) {
          const scope = await promptCommandScope(result.scope ?? 'local', 2, 1);
          if (!scope || isBack(scope)) {
            return;
          }
          const language = await promptCommandLanguage(
            result.language ?? 'generic',
            2,
            2,
          );
          if (!language || isBack(language)) {
            return;
          }
          commandsProvider.addCommand({
            label: result.label,
            command: result.command,
            cwd: result.cwd,
            background: result.background,
            scope,
            language,
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

        const result = await promptCommandFlow(commandsProvider, {
          label: item.data.label,
          command: item.data.command,
          cwd: item.data.cwd,
          background: item.data.background,
          scope: item.data.scope === 'global' ? 'global' : 'local',
          language: item.data.language,
        });

        if (result) {
          const ok = commandsProvider.editCommand(item.data.id, {
            label: result.label,
            command: result.command,
            cwd: result.cwd,
            background: result.background,
            scope: result.scope,
            language: result.language,
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
  // ── Add VS Code command as favorite ─────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.addVSCodeCommandFavorite',
      async () => {
        logger.debug('[commandFavorites] addVSCodeCommandFavorite started');

        // Get all available VS Code commands
        const allCommands = await vscode.commands.getCommands(true);
        const filtered = allCommands
          .filter((cmd) => !cmd.startsWith('_'))
          .sort();

        const items: vscode.QuickPickItem[] = filtered.map((cmd) => ({
          label: cmd,
          description: '',
        }));

        const selected = await vscode.window.showQuickPick(items, {
          placeHolder: t('Search and select a VS Code command'),
          matchOnDescription: true,
          matchOnDetail: true,
        });

        if (!selected) return;

        const commandId = selected.label;

        // Ask for a custom label
        const label = await vscode.window.showInputBox({
          prompt: t('Command name (shown in the list)'),
          placeHolder: t('e.g.: Start backend'),
          value: commandId,
          validateInput: (value) => {
            if (!value || value.trim().length === 0) {
              return t('Command name cannot be empty.');
            }
            return null;
          },
        });

        if (!label) return;

        const scope = await promptCommandScope('local', 2, 1);
        if (!scope || isBack(scope)) return;

        const language = await promptCommandLanguage('generic', 2, 2);
        if (!language || isBack(language)) return;

        commandsProvider.addCommand({
          label: label.trim(),
          command: commandId,
          background: false,
          type: 'vscode',
          scope,
          language,
        });

        vscode.window.showInformationMessage(
          t('Command "{0}" added.', label.trim()),
        );
        logger.info(
          `[commandFavorites] Added VS Code command: "${label.trim()}" (${commandId})`,
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.saveOpenSourceCommandAsLocal',
      async (item?: CommandItem) => {
        if (!item || item.data.scope !== 'opensource') return;

        const result = await promptSaveOpenSourceFlow(
          commandsProvider,
          item,
          'local',
        );
        if (!result) return;

        commandsProvider.addCommand({
          label: result.label,
          command: result.command,
          cwd: result.cwd,
          background: result.background,
          type: item.data.type,
          scope: 'local',
          language: result.language,
        });
        vscode.window.showInformationMessage(
          t('Command "{0}" added.', result.label),
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.saveOpenSourceCommandAsGlobal',
      async (item?: CommandItem) => {
        if (!item || item.data.scope !== 'opensource') return;

        const result = await promptSaveOpenSourceFlow(
          commandsProvider,
          item,
          'global',
        );
        if (!result) return;

        commandsProvider.addCommand({
          label: result.label,
          command: result.command,
          cwd: result.cwd,
          background: result.background,
          type: item.data.type,
          scope: 'global',
          language: result.language,
        });
        vscode.window.showInformationMessage(
          t('Command "{0}" added.', result.label),
        );
      },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand(
      'anfavorites.hideOpenSourceCommand',
      async (item?: CommandItem) => {
        if (!item || item.data.scope !== 'opensource') return;

        const confirm = await vscode.window.showWarningMessage(
          t('Hide command "{0}"?', item.data.label),
          { modal: true },
          t('Hide'),
        );
        if (confirm !== t('Hide')) return;

        commandsProvider.hideOpenSourceCommand(item.data.id);
      },
    ),
  );

  logger.debug('[commandFavorites] Commands registered');
}
