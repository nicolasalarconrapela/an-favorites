import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../logging/logger';
import { t } from '../utils/l10n';

export interface TemplateCommandData {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  background: boolean;
  addedAt: number;
  type?: 'shell' | 'vscode';
  scope: 'local' | 'global' | 'opensource';
  language: string;
  readonly?: boolean;
  source?: 'builtin' | 'file';
  templateSourceId?: string;
  iconFile?: string;
  extension?: string;
  subgroup?: string;
  templateGroup?: string;
}

type TemplateCatalogEntry = Partial<TemplateCommandData> & {
  id: string;
  label: string;
  command: string;
};

type TemplateCatalogGroupNode = {
  language?: string;
  extension?: string;
  iconFile?: string;
} & Record<string, string | TemplateCatalogEntry[] | undefined>;

type TemplateCatalogTree = Record<
  string,
  TemplateCatalogEntry[] | TemplateCatalogGroupNode
>;

type TemplateCatalogSplitFile = {
  language?: string;
  extension?: string;
  subgroup?: string;
  iconFile?: string;
  commands?: TemplateCatalogEntry[];
};

function getSyntheticIconFileName(
  language: string,
  label?: string,
  iconFile?: string,
  extension?: string,
): string {
  const resolvedExtension = extension?.trim();
  const resolvedLanguage = iconFile?.trim() || language.trim().toLowerCase();
  if (resolvedExtension) {
    if (resolvedExtension.startsWith('.')) {
      return `template-${(label ?? 'file')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')}${resolvedExtension}`;
    }

    return path.join(
      (label ?? resolvedLanguage).trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-'),
      `placeholder.${resolvedExtension}`,
    );
  }

  switch (resolvedLanguage) {
    case 'javascript':
      return 'index.js';
    case 'typescript':
      return 'index.ts';
    case 'python':
      return 'main.py';
    case 'java':
      return 'Main.java';
    case 'json':
      return 'package.json';
    case 'xml':
      return 'pom.xml';
    case 'yaml':
      return 'application.yml';
    case 'properties':
      return 'application.properties';
    case 'markdown':
      return 'README.md';
    case 'gitignore':
    case 'git':
      return '.gitignore';
    case 'dotenv':
      return '.env';
    case 'shell':
      return 'script.sh';
    case 'powershell':
      return 'script.ps1';
    case 'go':
      return 'main.go';
    case 'rust':
      return 'main.rs';
    case 'groovy':
      return 'build.gradle';
    case 'kotlin':
      return 'build.gradle.kts';
    case 'docker':
      return 'Dockerfile';
    case 'kubernetes':
      return 'deployment.yaml';
    case 'html':
      return 'index.html';
    case 'css':
      return 'styles.css';
    case 'scss':
      return 'styles.scss';
    case 'sql':
      return 'query.sql';
    case 'generic':
    default:
      return 'file.txt';
  }
}

function getSyntheticIconResourceUri(
  language: string,
  label?: string,
  iconFile?: string,
  extension?: string,
): vscode.Uri {
  const fakeFileName = getSyntheticIconFileName(
    language,
    label,
    iconFile,
    extension,
  );
  const basePath =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  return vscode.Uri.file(path.join(basePath, '.anfavorites-icons', fakeFileName));
}

export function getCommandLanguageDisplayName(language: string): string {
  const normalized = language.trim().toLowerCase();

  switch (normalized) {
    case 'python':
      return t('Python');
    case 'node':
      return t('Node');
    case 'javascript':
      return 'JavaScript';
    case 'typescript':
      return 'TypeScript';
    case 'java':
      return t('Java');
    case 'json':
      return 'JSON';
    case 'xml':
      return 'XML';
    case 'dart':
    case 'flutter':
      return 'Flutter';
    case 'yaml':
    case 'yml':
      return 'YAML';
    case 'properties':
      return 'Properties';
    case 'markdown':
    case 'md':
      return 'Markdown';
    case 'gitignore':
      return '.gitignore';
    case 'git':
      return 'Git';
    case 'shell':
    case 'bash':
      return 'Shell';
    case 'powershell':
      return 'PowerShell';
    case 'go':
      return 'Go';
    case 'rust':
      return 'Rust';
    case 'kubernetes':
    case 'kubernates':
    case 'k8s':
      return 'Kubernetes';
    case 'generic':
      return t('Personalized');
    default:
      return language.trim() || t('Personalized');
  }
}

function flattenTemplateCatalog(
  rawCatalog: TemplateCatalogEntry[] | TemplateCatalogTree,
): TemplateCatalogEntry[] {
  if (Array.isArray(rawCatalog)) {
    return rawCatalog;
  }

  const entries: TemplateCatalogEntry[] = [];
  for (const [languageKey, value] of Object.entries(rawCatalog)) {
    if (Array.isArray(value)) {
      for (const command of value) {
        entries.push({
          ...command,
          language: command.language ?? languageKey,
        });
      }
      continue;
    }

    const groupLanguage = value?.language;
    const groupExtension = value?.extension;
    const groupIconFile = value?.iconFile;

    for (const [subgroupKey, commands] of Object.entries(value ?? {})) {
      if (
        subgroupKey === 'language' ||
        subgroupKey === 'extension' ||
        subgroupKey === 'iconFile' ||
        !Array.isArray(commands)
      ) {
        continue;
      }

      for (const command of commands) {
        entries.push({
          ...command,
          language: command.language ?? groupLanguage ?? languageKey,
          extension: command.extension ?? groupExtension,
          iconFile: command.iconFile ?? groupIconFile,
          subgroup: command.subgroup ?? subgroupKey,
        });
      }
    }
  }

  return entries;
}

function flattenTemplateCatalogDirectory(rootPath: string): TemplateCatalogEntry[] {
  const fs = require('fs') as typeof import('fs');
  if (!fs.existsSync(rootPath)) {
    return [];
  }

  const entries: TemplateCatalogEntry[] = [];
  const languageDirectories = fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());

  for (const languageDirectory of languageDirectories) {
    const languageKey = languageDirectory.name;
    const languagePath = path.join(rootPath, languageKey);
    const subgroupFiles = fs
      .readdirSync(languagePath, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'));

    for (const subgroupFile of subgroupFiles) {
      const subgroupPath = path.join(languagePath, subgroupFile.name);
      const rawFile = fs.readFileSync(subgroupPath, 'utf8').replace(/^\uFEFF/, '');
      const parsedFile = JSON.parse(rawFile) as TemplateCatalogSplitFile;
      const subgroupKey =
        parsedFile.subgroup ?? path.basename(subgroupFile.name, '.json');

      for (const command of parsedFile.commands ?? []) {
        entries.push({
          ...command,
          language: command.language ?? parsedFile.language ?? languageKey,
          extension: command.extension ?? parsedFile.extension,
          iconFile: command.iconFile ?? parsedFile.iconFile,
          subgroup: command.subgroup ?? subgroupKey,
          templateGroup: languageKey,
        });
      }
    }
  }

  return entries;
}

export function loadTemplateCatalog(
  extensionPath: string,
  logger: Logger,
): TemplateCommandData[] {
  const fs = require('fs') as typeof import('fs');
  let builtins: TemplateCommandData[] = [];

  try {
    const splitCatalogPath = path.join(extensionPath, 'resources', 'command');
    let parsedBuiltins = flattenTemplateCatalogDirectory(splitCatalogPath);

    if (parsedBuiltins.length === 0) {
      const internalCatalogPath = path.join(
        extensionPath,
        'resources',
        'template-commands.json',
      );
      const rawBuiltins = fs.readFileSync(internalCatalogPath, 'utf8').replace(/^\uFEFF/, '');
      parsedBuiltins = flattenTemplateCatalog(
        JSON.parse(rawBuiltins) as TemplateCatalogEntry[] | TemplateCatalogTree,
      );
    }

    builtins = parsedBuiltins.map((command) => ({
      id: command.id,
      label: command.label,
      command: command.command,
      background:
        command.id === 'opensource:mvn-clean-install-package'
          ? true
          : command.background ?? false,
      addedAt: 0,
      type: command.type ?? 'shell',
      scope: 'opensource',
      language: command.language ?? 'generic',
      readonly: true,
      source: 'builtin',
      iconFile: command.iconFile,
      extension: command.extension,
      subgroup: command.subgroup,
      templateGroup: command.templateGroup,
    }));
  } catch (error) {
    logger.warn('[commands] Failed to load internal Template catalog', {
      error,
    });
    builtins = [
      {
        id: 'opensource:npm-init',
        label: 'npm init',
        command: 'npm init',
        background: false,
        addedAt: 0,
        type: 'shell',
        scope: 'opensource',
        language: 'node',
        readonly: true,
        source: 'builtin',
      },
      {
        id: 'opensource:mvn-clean-install-package',
        label: 'mvn clean install package',
        command: 'mvn clean install package',
        background: true,
        addedAt: 0,
        type: 'shell',
        scope: 'opensource',
        language: 'java',
        readonly: true,
        source: 'builtin',
      },
      {
        id: 'opensource:py-env',
        label: 'py env',
        command: 'py env',
        background: false,
        addedAt: 0,
        type: 'shell',
        scope: 'opensource',
        language: 'python',
        readonly: true,
        source: 'builtin',
      },
    ];
  }

  return builtins;
}

export function getTemplateGroupKey(command: Pick<TemplateCommandData, 'templateGroup' | 'language'>): string {
  return (command.templateGroup ?? command.language.trim().toLowerCase()) || 'generic';
}

export function getTemplateSubgroupKey(
  command: Pick<TemplateCommandData, 'subgroup'>,
): string {
  return command.subgroup ?? 'general';
}

export function getTemplateGroups(commands: TemplateCommandData[]): string[] {
  return Array.from(new Set(commands.map((command) => getTemplateGroupKey(command)).sort()));
}

export function getTemplateSubgroups(
  commands: TemplateCommandData[],
  groupName: string,
): string[] {
  return Array.from(
    new Set(
      commands
        .filter((command) => getTemplateGroupKey(command) === groupName)
        .map((command) => getTemplateSubgroupKey(command))
        .sort(),
    ),
  );
}

export function getRepresentativeTemplateCommand(
  commands: TemplateCommandData[],
  groupName: string,
  subgroupName?: string,
): TemplateCommandData | undefined {
  return commands.find(
    (command) =>
      getTemplateGroupKey(command) === groupName &&
      (subgroupName === undefined || getTemplateSubgroupKey(command) === subgroupName),
  );
}

export function getTemplateCommandsForSubgroup(
  commands: TemplateCommandData[],
  groupName: string,
  subgroupName: string,
): TemplateCommandData[] {
  return commands
    .filter(
      (command) =>
        getTemplateGroupKey(command) === groupName &&
        getTemplateSubgroupKey(command) === subgroupName,
    )
    .sort((a, b) => b.addedAt - a.addedAt || a.label.localeCompare(b.label));
}

export class CommandTemplateGroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupName: string,
    public readonly extension?: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
  ) {
    super(getCommandLanguageDisplayName(groupName), collapsibleState);
    this.id = `command-template-group:${groupName}`;
    this.contextValue = `commandTemplateGroupItem:${groupName}`;
    this.resourceUri = getSyntheticIconResourceUri(
      groupName,
      groupName,
      undefined,
      extension ?? groupName,
    );
    this.iconPath =
      (extension ?? groupName).trim() && !(extension ?? groupName).trim().startsWith('.')
        ? vscode.ThemeIcon.Folder
        : vscode.ThemeIcon.File;
  }
}

export class CommandTemplateSubgroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupName: string,
    public readonly subgroupName: string,
    public readonly extension?: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
  ) {
    super(subgroupName, collapsibleState);
    this.id = `command-template-subgroup:${groupName}:${subgroupName}`;
    this.contextValue = `commandTemplateSubgroupItem:${groupName}:${subgroupName}`;
    this.resourceUri = getSyntheticIconResourceUri(
      groupName,
      subgroupName,
      undefined,
      extension,
    );
    this.iconPath =
      extension?.trim() && !extension.trim().startsWith('.')
        ? vscode.ThemeIcon.Folder
        : vscode.ThemeIcon.File;
  }
}
