import * as path from 'path';
import * as vscode from 'vscode';
import { Logger } from '../logging/logger';
import { t } from '../utils/l10n';

//#region Types
export interface TemplateCommandData {
  id: string;
  label: string;
  command: string;
  description?: string;
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
  iconType?: string;
  resourceIconName?: string;
  resourceIconType?: string;
  templateCategory?: string;
  subgroup?: string;
  templateGroup?: string;
}

type TemplateCatalogEntry = Partial<TemplateCommandData> & {
  id: string;
  label?: string;
  labelKey?: string;
  descriptionKey?: string;
  command: string;
};

type TemplateCatalogGroupNode = {
  language?: string;
  extension?: string;
  iconFile?: string;
  resourceIconName?: string;
  resourceIconType?: string;
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
  resourceIconName?: string;
  resourceIconType?: string;
  commands?: TemplateCatalogEntry[];
};

type TemplateFolderSettingsItem = {
  id?: string;
  archivo?: string;
  nombre?: string;
  description?: string;
  iconType?: string;
  resourceIconName?: string;
  resourceIconType?: string;
};

type TemplateFolderSettingsGroup = {
  id?: string;
  nombre?: string;
  description?: string;
  iconType?: string;
  resourceIconName?: string;
  resourceIconType?: string;
  items?: TemplateFolderSettingsItem[];
};

type TemplateFolderSettings = {
  language?: string;
  extension?: string;
  iconType?: string;
  resourceIconName?: string;
  resourceIconType?: string;
  description?: string;
  commandGroups?: TemplateFolderSettingsGroup[];
};

type LocalizedStringMap = Record<string, string>;

type JsonObject = Record<string, unknown>;

type LocalizedTemplateSubgroup = {
  id?: string;
  name?: string;
  nameKey?: string;
  description?: string;
  descriptionKey?: string;
  iconType?: string;
  resourceIconName?: string;
  resourceIconType?: string;
  commands?: TemplateCatalogEntry[];
};

type LocalizedTemplateGroup = {
  id?: string;
  name?: string;
  nameKey?: string;
  description?: string;
  descriptionKey?: string;
  iconType?: string;
  resourceIconName?: string;
  resourceIconType?: string;
  commands?: TemplateCatalogEntry[];
  subgroups?: LocalizedTemplateSubgroup[];
};

type LocalizedTemplateCatalogFile = {
  language?: string;
  extension?: string;
  iconType?: string;
  resourceIconName?: string;
  resourceIconType?: string;
  description?: string;
  descriptionKey?: string;
  groups?: LocalizedTemplateGroup[];
};
//#endregion

//#region Icon helpers

let templateIconBasePath: string | undefined;

function getSyntheticIconFileName(
  language: string,
  label?: string,
  iconFile?: string,
  extension?: string,
): string {
  const resolvedExtension = extension?.trim();
  const resolvedLanguage = iconFile?.trim() || language.trim().toLowerCase();

  // Folder-like templates use a synthetic nested path so VS Code resolves a folder icon.
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
    case 'angular':
      return 'angular.json';
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

type TemplateIconType = 'folder' | 'icon';
type TemplateIconRole = 'root' | 'command';

function getBundledTemplateIconUri(
  iconName: string,
  iconType?: string,
): vscode.Uri | undefined {
  if (!templateIconBasePath) {
    return undefined;
  }

  const normalized = normalizeMaterialIconKey(iconName);
  if (!normalized) {
    return undefined;
  }
  const normalizedIconType = normalizeTemplateIconType(iconType);

  try {
    const fs = require('fs') as typeof import('fs');
    const materialIconPath = getMaterialIconThemeIconPath(
      templateIconBasePath,
      normalized,
      normalizedIconType,
      fs,
    );
    if (materialIconPath) {
      return vscode.Uri.file(materialIconPath);
    }

    const legacyIconPath = path.join(
      templateIconBasePath,
      'resources',
      'icons',
      'templates',
      `${normalized}.svg`,
    );
    return fs.existsSync(legacyIconPath) ? vscode.Uri.file(legacyIconPath) : undefined;
  } catch {
    return undefined;
  }
}

function getMaterialIconThemeIconPath(
  extensionPath: string,
  normalizedIconName: string,
  iconType: TemplateIconType,
  fs: typeof import('fs'),
): string | undefined {
  const manifestPath = path.join(
    extensionPath,
    'resources',
    'icons',
    'material-icon-theme',
    'manifest.json',
  );

  if (!fs.existsSync(manifestPath)) {
    return undefined;
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
    iconsPath?: string;
  };
  const iconsPath = manifest.iconsPath?.trim();
  if (!iconsPath) {
    return undefined;
  }

  const iconsDirectory = path.join(
    extensionPath,
    'resources',
    'icons',
    'material-icon-theme',
    iconsPath,
  );

  for (const iconFileName of getMaterialIconThemeCandidates(normalizedIconName, iconType)) {
    const iconPath = path.join(iconsDirectory, iconFileName);
    if (fs.existsSync(iconPath)) {
      return iconPath;
    }
  }

  return undefined;
}

function normalizeTemplateIconType(iconType?: unknown): TemplateIconType {
  return typeof iconType === 'string' &&
    iconType.trim().toLowerCase() === 'folder'
    ? 'folder'
    : 'icon';
}

export function resolveTemplateIconType(
  iconType: unknown,
  role: TemplateIconRole,
): TemplateIconType {
  if (typeof iconType !== 'string') {
    return 'icon';
  }

  const parts = iconType
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  const index = role === 'root' ? 0 : 1;
  const selected = parts[index] ?? parts[0];

  return selected === 'folder' ? 'folder' : 'icon';
}

function normalizeMaterialIconKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function getMaterialIconThemeCandidates(
  iconName: string,
  iconType: TemplateIconType,
): string[] {
  const iconCandidates = getMaterialIconThemeBaseCandidates(iconName);

  if (iconType === 'folder') {
    return [
      ...iconCandidates.map((candidate) => `folder-${candidate}.svg`),
      ...iconCandidates.map((candidate) => `folder-${candidate}-open.svg`),
      'folder-base.svg',
      'folder-src.svg',
    ];
  }

  return iconCandidates.map((candidate) => `${candidate}.svg`);
}

function getMaterialIconThemeBaseCandidates(iconName: string): string[] {
  switch (iconName) {
    case 'devops':
      return ['tools', 'console', 'config'];
    case 'dotnet':
      return ['dotnet', 'csharp'];
    case 'flutter':
      return ['flutter', 'dart'];
    case 'node':
      return ['nodejs', 'node'];
    case 'shell':
      return ['shell', 'bash', 'console'];
    case 'sql':
      return ['sql', 'database'];
    default:
      return [iconName];
  }
}

export function getTemplateResourceIconUri(
  resourceIconName?: unknown,
  resourceIconType?: unknown,
  role: TemplateIconRole = 'root',
): vscode.Uri | undefined {
  if (typeof resourceIconName !== 'string' || !resourceIconName.trim()) {
    return undefined;
  }

  return getBundledTemplateIconUri(
    resourceIconName,
    resolveTemplateIconType(resourceIconType, role),
  );
}

function getForcedResourceIconUri(
  resourceIconName?: unknown,
  resourceIconType?: unknown,
): vscode.Uri | undefined {
  return getTemplateResourceIconUri(resourceIconName, resourceIconType, 'root');
}
//#endregion

//#region Labels

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
//#endregion

//#region Localization helpers

function getConfiguredCatalogLocale(): 'es' | 'en' {
  const configured = vscode.workspace
    .getConfiguration('anfavorites')
    .get<string>('language', 'auto');

  if (configured === 'auto') {
    return vscode.env.language.toLowerCase().startsWith('es') ? 'es' : 'en';
  }

  return configured.toLowerCase() === 'es' ? 'es' : 'en';
}

function readJsonFile<T>(filePath: string): T {
  const fs = require('fs') as typeof import('fs');
  const raw = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw) as T;
}

function resolveLocalizedCatalogFilePath(baseFilePath: string): string {
  const fs = require('fs') as typeof import('fs');
  const locale = getConfiguredCatalogLocale();
  const extension = path.extname(baseFilePath);
  const basename = baseFilePath.slice(0, -extension.length);
  const localizedFilePath = `${basename}.${locale}${extension}`;

  if (fs.existsSync(localizedFilePath)) {
    return localizedFilePath;
  }

  return baseFilePath;
}

function loadLocalizedStringMap(baseFilePath: string): LocalizedStringMap {
  const localizedFilePath = resolveLocalizedCatalogFilePath(baseFilePath);
  if (localizedFilePath === baseFilePath) {
    return {};
  }

  return readJsonFile<LocalizedStringMap>(localizedFilePath);
}

function collectInlineLocalizedStrings(
  value: unknown,
  locale: 'es' | 'en',
  localizedStrings: LocalizedStringMap = {},
): LocalizedStringMap {
  if (!value || typeof value !== 'object') {
    return localizedStrings;
  }

  for (const [key, nestedValue] of Object.entries(value as JsonObject)) {
    if (Array.isArray(nestedValue)) {
      for (const item of nestedValue) {
        collectInlineLocalizedStrings(item, locale, localizedStrings);
      }
      continue;
    }

    if (key.endsWith(`.${locale}`) && typeof nestedValue === 'string') {
      localizedStrings[key.slice(0, -(`.${locale}`).length)] = nestedValue;
      continue;
    }

    collectInlineLocalizedStrings(nestedValue, locale, localizedStrings);
  }

  return localizedStrings;
}

function resolveCatalogText(
  literalValue: string | undefined,
  key: string | undefined,
  localizedStrings: LocalizedStringMap,
  fallbackValue: string,
): string {
  if (literalValue?.trim()) {
    return literalValue;
  }

  if (key?.trim()) {
    return localizedStrings[key] ?? key;
  }

  return fallbackValue;
}
//#endregion

//#region Catalog flattening

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
    const groupResourceIconName = value?.resourceIconName;
    const groupResourceIconType = value?.resourceIconType;

    // Group metadata acts as defaults for every command inside each subgroup.
    for (const [subgroupKey, commands] of Object.entries(value ?? {})) {
      if (
        subgroupKey === 'language' ||
        subgroupKey === 'extension' ||
        subgroupKey === 'iconFile' ||
        subgroupKey === 'resourceIconName' ||
        subgroupKey === 'resourceIconType' ||
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
          resourceIconName: command.resourceIconName ?? groupResourceIconName,
          resourceIconType: command.resourceIconType ?? groupResourceIconType,
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
          resourceIconName: command.resourceIconName ?? parsedFile.resourceIconName,
          resourceIconType: command.resourceIconType ?? parsedFile.resourceIconType,
          subgroup: command.subgroup ?? subgroupKey,
          templateGroup: languageKey,
        });
      }
    }
  }

  return entries;
}

function flattenTemplateCatalogFromSettings(rootPath: string): TemplateCatalogEntry[] {
  const fs = require('fs') as typeof import('fs');
  const entries: TemplateCatalogEntry[] = [];
  const languageDirectories = fs
    .readdirSync(rootPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory());

  for (const languageDirectory of languageDirectories) {
    const languagePath = path.join(rootPath, languageDirectory.name);
    const settingsPath = path.join(languagePath, 'settings.json');
    if (!fs.existsSync(settingsPath)) {
      continue;
    }

    const rawSettings = fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, '');
    const parsedSettings = JSON.parse(rawSettings) as TemplateFolderSettings;

    for (const commandGroup of parsedSettings.commandGroups ?? []) {
      for (const item of commandGroup.items ?? []) {
        if (!item.archivo) {
          continue;
        }

        const commandFilePath = path.join(languagePath, item.archivo);
        if (!fs.existsSync(commandFilePath)) {
          continue;
        }

        const rawCommandFile = fs.readFileSync(commandFilePath, 'utf8').replace(/^\uFEFF/, '');
        const parsedCommandFile = JSON.parse(rawCommandFile) as TemplateCatalogSplitFile;
        const subgroupName =
          item.nombre ??
          parsedCommandFile.subgroup ??
          commandGroup.nombre ??
          path.basename(item.archivo, '.json');

        for (const command of parsedCommandFile.commands ?? []) {
          entries.push({
            ...command,
            language:
              command.language ??
              parsedCommandFile.language ??
              parsedSettings.language ??
              languageDirectory.name,
            extension:
              command.extension ??
              parsedCommandFile.extension ??
              parsedSettings.extension,
            iconFile: command.iconFile ?? parsedCommandFile.iconFile,
            iconType:
              command.iconType ??
              item.iconType ??
              commandGroup.iconType ??
              parsedSettings.iconType,
            resourceIconName:
              command.resourceIconName ??
              item.resourceIconName ??
              commandGroup.resourceIconName ??
              parsedCommandFile.resourceIconName ??
              parsedSettings.resourceIconName,
            resourceIconType:
              command.resourceIconType ??
              item.resourceIconType ??
              commandGroup.resourceIconType ??
              parsedCommandFile.resourceIconType ??
              parsedSettings.resourceIconType,
            subgroup: command.subgroup ?? subgroupName,
            templateGroup: languageDirectory.name,
          });
        }
      }
    }
  }

  return entries;
}

function flattenLocalizedTemplateCatalog(rootPath: string): TemplateCatalogEntry[] {
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
    const baseCatalogPath = path.join(languagePath, `${languageKey}.json`);
    if (!fs.existsSync(baseCatalogPath)) {
      continue;
    }

    const parsedCatalog = readJsonFile<LocalizedTemplateCatalogFile>(baseCatalogPath);
    const locale = getConfiguredCatalogLocale();
    const localizedStrings = {
      ...collectInlineLocalizedStrings(parsedCatalog, locale),
      ...loadLocalizedStringMap(baseCatalogPath),
    };

    for (const group of parsedCatalog.groups ?? []) {
      const groupName = resolveCatalogText(
        group.name,
        group.nameKey,
        localizedStrings,
        group.id ?? 'general',
      );

      for (const command of group.commands ?? []) {
        entries.push({
          ...command,
          label: resolveCatalogText(
            command.label,
            command.labelKey,
            localizedStrings,
            command.command,
          ),
          description: resolveCatalogText(
            command.description,
            command.descriptionKey,
            localizedStrings,
            '',
          ),
          language: command.language ?? parsedCatalog.language ?? languageKey,
          extension: command.extension ?? parsedCatalog.extension,
          iconType: command.iconType ?? group.iconType ?? parsedCatalog.iconType,
          resourceIconName:
            command.resourceIconName ??
            group.resourceIconName ??
            parsedCatalog.resourceIconName,
          resourceIconType:
            command.resourceIconType ??
            group.resourceIconType ??
            parsedCatalog.resourceIconType,
          templateCategory: groupName,
          subgroup: command.subgroup ?? groupName,
          templateGroup: languageKey,
        });
      }

      for (const subgroup of group.subgroups ?? []) {
        const subgroupName = resolveCatalogText(
          subgroup.name,
          subgroup.nameKey,
          localizedStrings,
          subgroup.id ?? groupName,
        );

        for (const command of subgroup.commands ?? []) {
          entries.push({
            ...command,
            label: resolveCatalogText(
              command.label,
              command.labelKey,
              localizedStrings,
              command.command,
            ),
            description: resolveCatalogText(
              command.description,
              command.descriptionKey,
              localizedStrings,
              '',
            ),
            language: command.language ?? parsedCatalog.language ?? languageKey,
            extension: command.extension ?? parsedCatalog.extension,
            iconType:
              command.iconType ??
              subgroup.iconType ??
              group.iconType ??
              parsedCatalog.iconType,
            resourceIconName:
              command.resourceIconName ??
              subgroup.resourceIconName ??
              group.resourceIconName ??
              parsedCatalog.resourceIconName,
            resourceIconType:
              command.resourceIconType ??
              subgroup.resourceIconType ??
              group.resourceIconType ??
              parsedCatalog.resourceIconType,
            templateCategory: groupName,
            subgroup: command.subgroup ?? subgroupName,
            templateGroup: languageKey,
          });
        }
      }
    }
  }

  return entries;
}
//#endregion

//#region Catalog loading

export function loadTemplateCatalog(
  extensionPath: string,
  logger: Logger,
): TemplateCommandData[] {
  const fs = require('fs') as typeof import('fs');
  let builtins: TemplateCommandData[] = [];
  templateIconBasePath = extensionPath;

  try {
    const splitCatalogPath = path.join(extensionPath, 'resources', 'command');
    let parsedBuiltins = flattenLocalizedTemplateCatalog(splitCatalogPath);

    if (parsedBuiltins.length === 0) {
      parsedBuiltins = flattenTemplateCatalogFromSettings(splitCatalogPath);
    }

    if (parsedBuiltins.length === 0) {
      parsedBuiltins = flattenTemplateCatalogDirectory(splitCatalogPath);
    }

    // Keep compatibility with the previous single-file catalog while the new split format rolls out.
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
      label: command.label ?? command.command,
      command: command.command,
      description: command.description,
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
      iconType: command.iconType,
      resourceIconName: command.resourceIconName,
      resourceIconType: command.resourceIconType,
      subgroup: command.subgroup,
      templateGroup: command.templateGroup,
      templateCategory: command.templateCategory,
    }));
  } catch (error) {
    logger.warn('[commands] Failed to load internal Template catalog', {
      error,
    });
    // Minimal hardcoded fallback so the commands section still renders if catalog files fail to load.
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
//#endregion

//#region Grouping helpers

export function getTemplateGroupKey(
  command: Pick<TemplateCommandData, 'templateGroup' | 'language'>,
): string {
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
  categoryName?: string,
): string[] {
  return Array.from(
    new Set(
      commands
        .filter(
          (command) =>
            getTemplateGroupKey(command) === groupName &&
            (categoryName === undefined || command.templateCategory === categoryName),
        )
        .map((command) => getTemplateSubgroupKey(command))
        .sort(),
    ),
  );
}

export function getRepresentativeTemplateCommand(
  commands: TemplateCommandData[],
  groupName: string,
  categoryName?: string,
  subgroupName?: string,
): TemplateCommandData | undefined {
  return commands.find(
    (command) =>
      getTemplateGroupKey(command) === groupName &&
      (categoryName === undefined || command.templateCategory === categoryName) &&
      (subgroupName === undefined || getTemplateSubgroupKey(command) === subgroupName),
  );
}

export function getTemplateCategories(
  commands: TemplateCommandData[],
  groupName: string,
): string[] {
  return Array.from(
    new Set(
      commands
        .filter((command) => getTemplateGroupKey(command) === groupName)
        .map((command) => command.templateCategory ?? getTemplateSubgroupKey(command))
        .sort(),
    ),
  );
}

export function getTemplateCommandsForSubgroup(
  commands: TemplateCommandData[],
  groupName: string,
  categoryName: string,
  subgroupName: string,
): TemplateCommandData[] {
  return commands
    .filter(
      (command) =>
        getTemplateGroupKey(command) === groupName &&
        (command.templateCategory ?? getTemplateSubgroupKey(command)) === categoryName &&
        getTemplateSubgroupKey(command) === subgroupName,
    )
    .sort((a, b) => b.addedAt - a.addedAt || a.label.localeCompare(b.label));
}
//#endregion

//#region Tree items

export class CommandTemplateGroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupName: string,
    public readonly extension?: string,
    public readonly iconType?: string,
    public readonly resourceIconName?: string,
    public readonly resourceIconType?: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
  ) {
    super(getCommandLanguageDisplayName(groupName), collapsibleState);
    this.id = `command-template-group:${groupName}`;
    this.contextValue = `commandTemplateGroupItem:${groupName}`;
    this.iconPath = getForcedResourceIconUri(resourceIconName, resourceIconType);
    if (!this.iconPath) {
      this.iconPath = getTemplateResourceIconUri(groupName, iconType, 'root');
    }
  }
}
//#endregion

export class CommandTemplateSubgroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupName: string,
    public readonly categoryName: string,
    public readonly subgroupName: string,
    public readonly extension?: string,
    public readonly iconType?: string,
    public readonly resourceIconName?: string,
    public readonly resourceIconType?: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
  ) {
    super(subgroupName, collapsibleState);
    this.id = `command-template-subgroup:${groupName}:${subgroupName}`;
    this.contextValue = `commandTemplateSubgroupItem:${groupName}:${subgroupName}`;
    this.iconPath = getForcedResourceIconUri(resourceIconName, resourceIconType);
  }
}

export class CommandTemplateCategoryItem extends vscode.TreeItem {
  constructor(
    public readonly groupName: string,
    public readonly categoryName: string,
    public readonly extension?: string,
    public readonly iconType?: string,
    public readonly resourceIconName?: string,
    public readonly resourceIconType?: string,
    collapsibleState: vscode.TreeItemCollapsibleState = vscode.TreeItemCollapsibleState.Collapsed,
  ) {
    super(categoryName, collapsibleState);
    this.id = `command-template-category:${groupName}:${categoryName}`;
    this.contextValue = `commandTemplateCategoryItem:${groupName}:${categoryName}`;
    this.iconPath = getForcedResourceIconUri(resourceIconName, resourceIconType);
  }
}
