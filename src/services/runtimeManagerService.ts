import * as path from 'path';
import * as vscode from 'vscode';

export type RuntimeId = string;

export type RuntimeStatus = 'default' | 'custom' | 'incomplete';

export interface RuntimeOption {
  label: string;
  command: string;
}

export interface RuntimeDefinition {
  id: RuntimeId;
  label: string;
  defaultCommand: string;
  options: RuntimeOption[];
  testArgument: string;
  executableKeys: string[];
  languageKeys: string[];
  readonly?: boolean;
}

export interface CustomRuntimeInput {
  id: string;
  label: string;
  aliases: string;
  defaultCommand: string;
  testArgument: string;
  languageKeys: string;
}

export interface CustomRuntimeSetting {
  id?: string;
  label?: string;
  aliases?: string[] | string;
  defaultCommand?: string;
  testArgument?: string;
  languageKeys?: string[] | string;
}

export interface RuntimePreference {
  command?: string;
  customCommand?: string;
}

export interface RuntimeAliasesSetting {
  language?: string;
  runtime?: string;
  aliases?: string[] | string;
  types?: string[] | string;
}

export interface RuntimeState extends RuntimeDefinition {
  selectedCommand: string;
  customCommand: string;
  activeCommand: string;
  allowCustomCommand: boolean;
  status: RuntimeStatus;
}

type ParsedShellCommand = {
  leading: string;
  executable: string;
  rest: string;
};

type LanguageExecutableSetting = {
  language?: string;
  alias?: string;
  path?: string;
  executable?: string;
  executablePath?: string;
};

const RUNTIMES_CONFIG_KEY = 'runtimes';
const RUNTIME_ALIASES_CONFIG_KEY = 'runtimeAliases';
const CUSTOM_RUNTIMES_CONFIG_KEY = 'customRuntimes';
const CUSTOM_COMMAND = 'custom';
const EXEC_ALIAS = 'exec';

export const RUNTIME_DEFINITIONS: RuntimeDefinition[] = [
  {
    id: 'python',
    label: 'Python',
    defaultCommand: process.platform === 'win32' ? 'py' : 'python3',
    options: [
      { label: 'py', command: 'py' },
      { label: 'python', command: 'python' },
      { label: 'py3', command: 'py3' },
      { label: 'python3', command: 'python3' },
    ],
    testArgument: '--version',
    executableKeys: ['python', 'py', 'py3', 'python2', 'python3', 'pythonw'],
    languageKeys: ['python'],
  },
  {
    id: 'node',
    label: 'Node.js',
    defaultCommand: 'node',
    options: [
      { label: 'node', command: 'node' },
      { label: 'nodejs', command: 'nodejs' },
    ],
    testArgument: '--version',
    executableKeys: ['node', 'nodejs'],
    languageKeys: ['node', 'javascript', 'typescript'],
  },
  {
    id: 'java',
    label: 'Java',
    defaultCommand: 'java',
    options: [{ label: 'java', command: 'java' }],
    testArgument: '-version',
    executableKeys: ['java'],
    languageKeys: ['java'],
  },
  {
    id: 'maven',
    label: 'Maven',
    defaultCommand: 'mvn',
    options: [
      { label: 'mvn', command: 'mvn' },
      { label: 'mvnw', command: 'mvnw' },
    ],
    testArgument: '--version',
    executableKeys: ['mvn', 'mvnw'],
    languageKeys: ['java', 'maven'],
  },
  {
    id: 'gradle',
    label: 'Gradle',
    defaultCommand: 'gradle',
    options: [
      { label: 'gradle', command: 'gradle' },
      { label: 'gradlew', command: 'gradlew' },
    ],
    testArgument: '--version',
    executableKeys: ['gradle', 'gradlew'],
    languageKeys: ['java', 'gradle'],
  },
];

const DEFAULT_LANGUAGE_EXECUTABLE_ALIASES: Record<string, string> = {
  python: 'auto',
  node: 'node',
  javascript: 'node',
  typescript: 'node',
  java: 'java',
  maven: 'mvn',
  gradle: 'gradle',
  go: 'go',
  rust: 'cargo',
  dotnet: 'dotnet',
  php: 'php',
  ruby: 'ruby',
  shell: process.platform === 'win32' ? 'bash' : 'sh',
  powershell: process.platform === 'win32' ? 'powershell' : 'pwsh',
  docker: 'docker',
  kubernetes: 'kubectl',
};

const DEFAULT_LANGUAGE_EXECUTABLE_KEYS: Record<string, string[]> = {
  python: ['python', 'py', 'py3', 'python2', 'python3', 'pythonw'],
  node: ['node'],
  javascript: ['node'],
  typescript: ['node'],
  java: ['java'],
  maven: ['mvn', 'mvnw'],
  gradle: ['gradle', 'gradlew'],
  go: ['go'],
  rust: ['cargo', 'rustc'],
  dotnet: ['dotnet'],
  php: ['php'],
  ruby: ['ruby'],
  shell: ['sh', 'bash', 'zsh'],
  powershell: ['pwsh', 'powershell'],
  docker: ['docker'],
  kubernetes: ['kubectl', 'helm'],
};

export class RuntimeManagerService {
  getRuntimeStates(): RuntimeState[] {
    return this.getRuntimeDefinitions().map((definition) =>
      this.getRuntimeState(definition.id),
    );
  }

  getRuntimeState(runtimeId: RuntimeId): RuntimeState {
    const definition = this.getRuntimeDefinition(runtimeId);
    const preference = this.getRuntimePreference(runtimeId);
    const selectedCommand = preference.command?.trim() || definition.defaultCommand;
    const customCommand = preference.customCommand?.trim() ?? '';
    const configuredAliases = this.getConfiguredRuntimeAliases(runtimeId);
    const allowCustomCommand =
      selectedCommand === CUSTOM_COMMAND ||
      configuredAliases.length === 0 ||
      configuredAliases.some((alias) => isCustomAlias(alias));
    const activeCommand =
      selectedCommand === CUSTOM_COMMAND ? customCommand : selectedCommand;
    const status: RuntimeStatus =
      selectedCommand === CUSTOM_COMMAND
        ? activeCommand
          ? 'custom'
          : 'incomplete'
        : selectedCommand === definition.defaultCommand
          ? 'default'
          : 'custom';

    return {
      ...definition,
      selectedCommand,
      customCommand,
      activeCommand,
      allowCustomCommand,
      status,
    };
  }

  async updateRuntime(
    runtimeId: RuntimeId,
    preference: RuntimePreference,
  ): Promise<void> {
    const definition = this.getRuntimeDefinition(runtimeId);
    const selectedCommand = normalizeRuntimeCommand(
      preference.command?.trim() || definition.defaultCommand,
    );
    const customCommand = preference.customCommand?.trim() ?? '';
    const runtimes = this.getConfiguredRuntimes();

    runtimes[runtimeId] = {
      command: selectedCommand,
      customCommand,
    };

    await this.updateRuntimes(runtimes);
  }

  async resetRuntime(runtimeId: RuntimeId): Promise<void> {
    const runtimes = this.getConfiguredRuntimes();
    delete runtimes[runtimeId];
    await this.updateRuntimes(runtimes);
  }

  async addCustomRuntime(input: CustomRuntimeInput): Promise<void> {
    const id = normalizeCustomRuntimeId(input.id);
    if (!id) {
      throw new Error('Runtime id is required.');
    }

    if (RUNTIME_DEFINITIONS.some((definition) => definition.id === id)) {
      throw new Error(`Runtime "${id}" already exists.`);
    }

    const aliases = uniqueAliases(parseRuntimeAliases(input.aliases));
    const defaultCommand =
      input.defaultCommand.trim() ||
      aliases.find((alias) => !isCustomAlias(alias)) ||
      id;
    const runtime: CustomRuntimeSetting = {
      id,
      label: input.label.trim() || id,
      aliases: aliases.join(', '),
      defaultCommand,
      testArgument: input.testArgument.trim() || '--version',
      languageKeys:
        uniqueAliases(parseRuntimeAliases(input.languageKeys)).join(', ') || id,
    };
    const customRuntimes = this.getConfiguredCustomRuntimeSettings().filter(
      (item) => normalizeCustomRuntimeId(item.id) !== id,
    );
    customRuntimes.push(runtime);
    await this.updateCustomRuntimes(customRuntimes);
  }

  async removeCustomRuntime(runtimeId: RuntimeId): Promise<void> {
    const customRuntimes = this.getConfiguredCustomRuntimeSettings().filter(
      (item) => normalizeCustomRuntimeId(item.id) !== runtimeId,
    );
    await Promise.all([
      this.updateCustomRuntimes(customRuntimes),
      this.resetRuntime(runtimeId),
    ]);
  }

  testRuntime(runtimeId: RuntimeId): void {
    const runtime = this.getRuntimeState(runtimeId);
    if (!runtime.activeCommand) {
      void vscode.window.showWarningMessage(
        `${runtime.label} needs a custom command before it can be tested.`,
      );
      return;
    }

    const terminal = vscode.window.createTerminal({
      name: `AnFavorites ${runtime.label}`,
    });
    terminal.sendText(
      `${formatExecutableReplacement(runtime.activeCommand)} ${runtime.testArgument}`,
    );
    terminal.show();
  }

  resolveRuntimeCommand(runtimeId: RuntimeId): string {
    return this.getRuntimeState(runtimeId).activeCommand;
  }

  resolveCommandExecutable(command: string, language?: string): string {
    const parsed = parseShellCommandExecutable(command);
    if (!parsed) {
      return command;
    }

    const executableKey = normalizeExecutableKey(parsed.executable);
    if (!executableKey) {
      return command;
    }

    const replacement =
      this.resolveConfiguredRuntimeExecutable(language, executableKey) ??
      this.resolveConfiguredLanguageExecutable(language, executableKey) ??
      this.resolveConfiguredPythonExecutable(executableKey) ??
      getConfiguredExecutableAliases()[executableKey];

    if (!replacement) {
      return command;
    }

    return `${parsed.leading}${formatExecutableReplacement(replacement)}${parsed.rest}`;
  }

  private resolveConfiguredRuntimeExecutable(
    language: string | undefined,
    executableKey: string,
  ): string | undefined {
    const runtime = this.getRuntimeDefinitions().find((definition) => {
      if (!this.getRuntimeExecutableKeys(definition.id).includes(executableKey)) {
        return false;
      }

      const languageKey = normalizeLanguageKey(language);
      return !languageKey || definition.languageKeys.includes(languageKey);
    });

    if (!runtime) {
      return undefined;
    }

    const inspected = vscode.workspace
      .getConfiguration('anfavorites.commands')
      .inspect<Record<string, RuntimePreference>>(RUNTIMES_CONFIG_KEY);
    const hasExplicitRuntime =
      !!inspected?.globalValue?.[runtime.id] ||
      !!inspected?.workspaceValue?.[runtime.id] ||
      !!inspected?.workspaceFolderValue?.[runtime.id];

    return hasExplicitRuntime || !runtime.readonly
      ? this.getRuntimeState(runtime.id).activeCommand
      : undefined;
  }

  private resolveConfiguredLanguageExecutable(
    language: string | undefined,
    executableKey: string,
  ): string | undefined {
    const languageKey = normalizeLanguageKey(language);
    if (!languageKey) {
      return undefined;
    }

    const executableKeys = uniqueAliases([
      ...(DEFAULT_LANGUAGE_EXECUTABLE_KEYS[languageKey] ?? [languageKey]),
      ...this.getRuntimeDefinitions().flatMap((definition) =>
        definition.languageKeys.includes(languageKey)
          ? this.getRuntimeExecutableKeys(definition.id)
          : [],
      ),
    ]);
    if (!executableKeys.includes(executableKey)) {
      return undefined;
    }

    const runtime = this.getRuntimeDefinitions().find((definition) =>
      this.getRuntimeExecutableKeys(definition.id).includes(executableKey),
    );
    if (!runtime) {
      return undefined;
    }

    if (runtime.id === 'python' && !hasExplicitLanguageExecutableSetting('python')) {
      return undefined;
    }

    const setting = readLanguageExecutableSetting(languageKey);
    const alias = setting?.alias?.trim();

    if (alias === CUSTOM_COMMAND) {
      return setting?.path?.trim() || undefined;
    }

    if (alias === 'auto') {
      return runtime.defaultCommand;
    }

    return alias || setting?.path?.trim() || undefined;
  }

  private resolveConfiguredPythonExecutable(
    executableKey: string,
  ): string | undefined {
    if (!this.getRuntimeExecutableKeys('python').includes(executableKey)) {
      return undefined;
    }

    const commandsConfig = vscode.workspace.getConfiguration('anfavorites.commands');
    const configured = commandsConfig.get<string>('pythonExecutable', 'auto').trim();

    switch (configured) {
      case CUSTOM_COMMAND: {
        const customPath = commandsConfig
          .get<string>('pythonExecutablePath', '')
          .trim();
        return customPath || undefined;
      }
      case 'auto':
        return this.getRuntimeDefinition('python').defaultCommand;
      default:
        return configured || undefined;
    }
  }

  private getRuntimePreference(runtimeId: RuntimeId): RuntimePreference {
    return this.getConfiguredRuntimes()[runtimeId] ?? {};
  }

  private getRuntimeDefinition(runtimeId: RuntimeId): RuntimeDefinition {
    const baseDefinition = this.getBaseRuntimeDefinition(runtimeId);
    const configuredOptions = this.getConfiguredRuntimeOptions(baseDefinition);

    return {
      ...baseDefinition,
      options: configuredOptions,
      executableKeys: this.getRuntimeExecutableKeys(runtimeId),
    };
  }

  private getConfiguredRuntimeOptions(
    definition: RuntimeDefinition,
  ): RuntimeOption[] {
    const configuredAliases = this.getConfiguredRuntimeAliases(definition.id);
    const sourceAliases =
      configuredAliases.length > 0
        ? configuredAliases
        : definition.options.map((option) => option.command);
    const options = uniqueAliases(sourceAliases)
      .filter((alias) => !isCustomAlias(alias))
      .map((alias) => ({ label: alias, command: alias }));
    const preference = this.getRuntimePreference(definition.id);
    const selectedCommand = normalizeRuntimeCommand(preference.command);

    if (
      selectedCommand &&
      selectedCommand !== CUSTOM_COMMAND &&
      !options.some((option) => option.command === selectedCommand)
    ) {
      options.push({ label: selectedCommand, command: selectedCommand });
    }

    return options.length > 0 ? options : definition.options;
  }

  private getRuntimeExecutableKeys(runtimeId: RuntimeId): string[] {
    const definition = this.getBaseRuntimeDefinition(runtimeId);
    return uniqueAliases([
      ...definition.executableKeys,
      ...this.getConfiguredRuntimeAliases(runtimeId),
    ]).filter((alias) => !isCustomAlias(alias));
  }

  private getConfiguredRuntimeAliases(runtimeId: RuntimeId): string[] {
    const visualAliases = this.getConfiguredVisualRuntimeAliases(runtimeId);
    if (visualAliases.length > 0) {
      return visualAliases;
    }

    const configured = vscode.workspace
      .getConfiguration('anfavorites.commands')
      .get<RuntimeAliasesSetting[]>(RUNTIME_ALIASES_CONFIG_KEY, []);

    if (!Array.isArray(configured)) {
      return [];
    }

    const aliases: string[] = [];
    for (const row of configured) {
      if (!row || typeof row !== 'object') {
        continue;
      }

      const rowRuntime = normalizeCustomRuntimeId(row.runtime ?? row.language);
      if (rowRuntime !== runtimeId) {
        continue;
      }

      const rowAliases = parseRuntimeAliases(row.aliases ?? row.types);
      aliases.push(...rowAliases);
    }

    return uniqueAliases(aliases);
  }

  private getConfiguredVisualRuntimeAliases(runtimeId: RuntimeId): string[] {
    const configured = vscode.workspace
      .getConfiguration('anfavorites.commands.aliases')
      .get<string>(runtimeId, '');

    return uniqueAliases(parseRuntimeAliases(configured));
  }

  private getRuntimeDefinitions(): RuntimeDefinition[] {
    return [
      ...RUNTIME_DEFINITIONS.map((definition) => ({
        ...definition,
        readonly: true,
      })),
      ...this.getConfiguredCustomRuntimeDefinitions(),
    ];
  }

  private getBaseRuntimeDefinition(runtimeId: RuntimeId): RuntimeDefinition {
    const definition = this.getRuntimeDefinitions().find(
      (item) => item.id === runtimeId,
    );
    if (!definition) {
      throw new Error(`Unknown runtime: ${runtimeId}`);
    }

    return definition;
  }

  private getConfiguredCustomRuntimeDefinitions(): RuntimeDefinition[] {
    return this.getConfiguredCustomRuntimeSettings()
      .map((runtime) => normalizeCustomRuntime(runtime))
      .filter((runtime): runtime is RuntimeDefinition => !!runtime);
  }

  private getConfiguredCustomRuntimeSettings(): CustomRuntimeSetting[] {
    const configured = vscode.workspace
      .getConfiguration('anfavorites.commands')
      .get<CustomRuntimeSetting[]>(CUSTOM_RUNTIMES_CONFIG_KEY, []);

    return Array.isArray(configured) ? configured : [];
  }

  private getConfiguredRuntimes(): Record<string, RuntimePreference> {
    const configured = vscode.workspace
      .getConfiguration('anfavorites.commands')
      .get<Record<string, RuntimePreference>>(RUNTIMES_CONFIG_KEY, {});

    return { ...(configured ?? {}) };
  }

  private async updateRuntimes(
    runtimes: Record<string, RuntimePreference>,
  ): Promise<void> {
    await vscode.workspace
      .getConfiguration('anfavorites.commands')
      .update(RUNTIMES_CONFIG_KEY, runtimes, getRuntimeConfigurationTarget());
  }

  private async updateCustomRuntimes(
    runtimes: CustomRuntimeSetting[],
  ): Promise<void> {
    await vscode.workspace
      .getConfiguration('anfavorites.commands')
      .update(
        CUSTOM_RUNTIMES_CONFIG_KEY,
        runtimes,
        getCustomRuntimeConfigurationTarget(),
      );
  }
}

function getRuntimeConfigurationTarget(): vscode.ConfigurationTarget {
  const inspected = vscode.workspace
    .getConfiguration('anfavorites.commands')
    .inspect<Record<string, RuntimePreference>>(RUNTIMES_CONFIG_KEY);

  if (inspected?.workspaceFolderValue !== undefined) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }

  if (inspected?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }

  return vscode.ConfigurationTarget.Global;
}

function getCustomRuntimeConfigurationTarget(): vscode.ConfigurationTarget {
  const inspected = vscode.workspace
    .getConfiguration('anfavorites.commands')
    .inspect<CustomRuntimeSetting[]>(CUSTOM_RUNTIMES_CONFIG_KEY);

  if (inspected?.workspaceFolderValue !== undefined) {
    return vscode.ConfigurationTarget.WorkspaceFolder;
  }

  if (inspected?.workspaceValue !== undefined) {
    return vscode.ConfigurationTarget.Workspace;
  }

  return vscode.ConfigurationTarget.Global;
}

function parseShellCommandExecutable(command: string): ParsedShellCommand | undefined {
  const leadingMatch = command.match(/^\s*/);
  const leading = leadingMatch?.[0] ?? '';
  let index = leading.length;

  if (index >= command.length) {
    return undefined;
  }

  const quote = command[index] === '"' || command[index] === "'" ? command[index] : undefined;
  if (quote) {
    index += 1;
    const start = index;
    while (index < command.length && command[index] !== quote) {
      index += 1;
    }

    const executable = command.slice(start, index);
    const end = index < command.length ? index + 1 : index;
    return executable ? { leading, executable, rest: command.slice(end) } : undefined;
  }

  const start = index;
  while (index < command.length && !/\s/.test(command[index])) {
    index += 1;
  }

  const executable = command.slice(start, index);
  return executable ? { leading, executable, rest: command.slice(index) } : undefined;
}

function normalizeExecutableKey(value?: string): string | undefined {
  const trimmed = value?.trim().replace(/^['"]|['"]$/g, '');
  if (!trimmed) {
    return undefined;
  }

  const baseName = trimmed.split(/[\\/]/).pop() ?? trimmed;
  return baseName.replace(/\.(exe|cmd|bat|ps1|sh)$/i, '').toLowerCase();
}

function normalizeLanguageKey(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
  return normalized || undefined;
}

function isPathLikeExecutable(value: string): boolean {
  return (
    /^[a-z]:[\\/]/i.test(value) ||
    value.startsWith('/') ||
    value.startsWith('~/') ||
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.includes('\\') ||
    value.includes('/') ||
    /\.(exe|cmd|bat|ps1|sh)$/i.test(value)
  );
}

function isPowerShellLikeShell(shellPath?: string): boolean {
  const shellName = path.basename(shellPath ?? '').toLowerCase();
  return shellName === 'powershell.exe' || shellName === 'pwsh.exe' || shellName === 'pwsh';
}

function formatExecutableReplacement(value: string): string {
  const trimmed = value.trim();
  if (
    !trimmed ||
    trimmed.startsWith('& ') ||
    trimmed.startsWith('"') ||
    trimmed.startsWith("'") ||
    (!/\s/.test(trimmed) && !/[()]/.test(trimmed)) ||
    !isPathLikeExecutable(trimmed)
  ) {
    return trimmed;
  }

  const escaped = trimmed.replace(/"/g, '\\"');
  const quoted = `"${escaped}"`;
  return process.platform === 'win32' && isPowerShellLikeShell(vscode.env.shell)
    ? `& ${quoted}`
    : quoted;
}

function getConfiguredExecutableAliases(): Record<string, string> {
  const configured = vscode.workspace
    .getConfiguration('anfavorites.commands')
    .get<Record<string, unknown>>('executableAliases', {});
  const aliases: Record<string, string> = {};

  for (const [key, value] of Object.entries(configured)) {
    const normalizedKey = normalizeExecutableKey(key);
    if (!normalizedKey || typeof value !== 'string') {
      continue;
    }

    const normalizedValue = value.trim();
    if (normalizedValue) {
      aliases[normalizedKey] = normalizedValue;
    }
  }

  return aliases;
}

function readLanguageExecutableSetting(
  language?: string,
): LanguageExecutableSetting | undefined {
  const languageKey = normalizeLanguageKey(language);
  if (!languageKey) {
    return undefined;
  }

  const configured = vscode.workspace
    .getConfiguration('anfavorites.commands')
    .get<unknown>('languageExecutables', []);

  if (Array.isArray(configured)) {
    const row = configured.find((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return false;
      }

      const rowLanguage = (item as Record<string, unknown>).language;
      return (
        typeof rowLanguage === 'string' &&
        normalizeLanguageKey(rowLanguage) === languageKey
      );
    }) as Record<string, unknown> | undefined;

    if (row) {
      return {
        language: languageKey,
        alias:
          typeof row.alias === 'string'
            ? row.alias
            : typeof row.executable === 'string'
              ? row.executable
              : undefined,
        path:
          typeof row.path === 'string'
            ? row.path
            : typeof row.executablePath === 'string'
              ? row.executablePath
              : undefined,
      };
    }

    const fallbackAlias = DEFAULT_LANGUAGE_EXECUTABLE_ALIASES[languageKey];
    return fallbackAlias ? { language: languageKey, alias: fallbackAlias } : undefined;
  }

  if (!configured || typeof configured !== 'object') {
    const fallbackAlias = DEFAULT_LANGUAGE_EXECUTABLE_ALIASES[languageKey];
    return fallbackAlias ? { language: languageKey, alias: fallbackAlias } : undefined;
  }

  const value = (configured as Record<string, unknown>)[languageKey];

  if (typeof value === 'string') {
    return { language: languageKey, alias: value };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    const fallbackAlias = DEFAULT_LANGUAGE_EXECUTABLE_ALIASES[languageKey];
    return fallbackAlias ? { language: languageKey, alias: fallbackAlias } : undefined;
  }

  const record = value as Record<string, unknown>;
  return {
    language: languageKey,
    alias:
      typeof record.alias === 'string'
        ? record.alias
        : typeof record.executable === 'string'
          ? record.executable
          : undefined,
    path:
      typeof record.path === 'string'
        ? record.path
        : typeof record.executablePath === 'string'
          ? record.executablePath
          : undefined,
  };
}

function hasExplicitLanguageExecutableSetting(language?: string): boolean {
  const languageKey = normalizeLanguageKey(language);
  if (!languageKey) {
    return false;
  }

  const inspected = vscode.workspace
    .getConfiguration('anfavorites.commands')
    .inspect<unknown>('languageExecutables');
  const configuredValues = [
    inspected?.globalValue,
    inspected?.workspaceValue,
    inspected?.workspaceFolderValue,
  ];

  return configuredValues.some((value) => {
    if (Array.isArray(value)) {
      return value.some(
        (item) =>
          !!item &&
          typeof item === 'object' &&
          !Array.isArray(item) &&
          normalizeLanguageKey(String((item as Record<string, unknown>).language ?? '')) ===
            languageKey,
      );
    }

    return (
      !!value &&
      typeof value === 'object' &&
      Object.prototype.hasOwnProperty.call(value, languageKey)
    );
  });
}

function normalizeCustomRuntime(
  runtime: CustomRuntimeSetting,
): RuntimeDefinition | undefined {
  const id = normalizeCustomRuntimeId(runtime.id);
  if (!id) {
    return undefined;
  }

  const aliases = uniqueAliases(parseRuntimeAliases(runtime.aliases));
  const defaultCommand =
    runtime.defaultCommand?.trim() ||
    aliases.find((alias) => !isCustomAlias(alias)) ||
    id;
  const executableKeys = uniqueAliases([defaultCommand, ...aliases]).filter(
    (alias) => !isCustomAlias(alias),
  );

  return {
    id,
    label: runtime.label?.trim() || id,
    defaultCommand,
    options: executableKeys.map((alias) => ({ label: alias, command: alias })),
    testArgument: runtime.testArgument?.trim() || '--version',
    executableKeys,
    languageKeys:
      uniqueAliases(parseRuntimeAliases(runtime.languageKeys)).length > 0
        ? uniqueAliases(parseRuntimeAliases(runtime.languageKeys))
        : [id],
    readonly: false,
  };
}

function normalizeCustomRuntimeId(value?: string): RuntimeId | undefined {
  return value?.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-|-$/g, '') || undefined;
}

function normalizeRuntimeCommand(value?: string): string {
  const normalized = value?.trim();
  if (!normalized) {
    return '';
  }

  return isCustomAlias(normalized) ? CUSTOM_COMMAND : normalized;
}

function isCustomAlias(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === CUSTOM_COMMAND || normalized === EXEC_ALIAS;
}

function uniqueAliases(values: string[]): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];

  for (const value of values) {
    const normalized = normalizeRuntimeCommand(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    aliases.push(normalized);
  }

  return aliases;
}

function parseRuntimeAliases(value: string[] | string | undefined): string[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((alias) => alias.trim())
    .filter(Boolean);
}

const runtimeManagerService = new RuntimeManagerService();

export function resolveCommandExecutable(command: string, language?: string): string {
  return runtimeManagerService.resolveCommandExecutable(command, language);
}
