import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

type LanguageBundle = Record<string, string>;

let enBundle: LanguageBundle | null = null;
let esBundle: LanguageBundle | null = null;
let extensionPath: string | undefined;

export function initializeL10n(context: vscode.ExtensionContext): void {
  extensionPath = context.extensionPath;

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('anfavorites.language')) {
        reloadBundles();
      }
    }),
  );
}

function loadBundle(locale: string): LanguageBundle | null {
  try {
    if (!extensionPath) {
      const extension = vscode.extensions.getExtension('anappwilos.an-favorites');
      extensionPath = extension?.extensionPath;
    }

    if (!extensionPath) {
      return null;
    }

    const bundlePath = path.join(
      extensionPath,
      'l10n',
      `bundle.l10n${locale === 'es' ? '.es' : ''}.json`,
    );

    if (fs.existsSync(bundlePath)) {
      const content = fs.readFileSync(bundlePath, 'utf-8');
      return JSON.parse(content) as LanguageBundle;
    }
  } catch (error) {
    console.error(`Error loading bundle for locale ${locale}:`, error);
  }
  return null;
}

function getConfiguredLanguage(): string {
  const config = vscode.workspace.getConfiguration('anfavorites');
  const language = config.get<string>('language', 'auto');

  if (language === 'auto') {
    const vscodeLanguage = vscode.env.language.toLowerCase();
    if (vscodeLanguage.startsWith('es')) {
      return 'es';
    }
    return 'en';
  }

  return language;
}

function formatMessage(message: string, ...args: (string | number)[]): string {
  let formatted = message;
  args.forEach((arg, index) => {
    formatted = formatted.replace(`{${index}}`, String(arg));
  });
  return formatted;
}

export function t(
  message: string,
  ...args: (string | number)[]
): string {
  const language = getConfiguredLanguage();
  let bundle: LanguageBundle | null = null;

  if (language === 'es') {
    if (!esBundle) {
      esBundle = loadBundle('es');
    }
    bundle = esBundle;
  } else {
    if (!enBundle) {
      enBundle = loadBundle('en');
    }
    bundle = enBundle;
  }

  const translated = bundle?.[message] || message;

  if (args.length > 0) {
    return formatMessage(translated, ...args);
  }

  return translated;
}

export function reloadBundles(): void {
  enBundle = null;
  esBundle = null;
}
