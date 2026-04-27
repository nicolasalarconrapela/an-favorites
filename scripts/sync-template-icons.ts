import * as fs from 'fs';
import * as path from 'path';

type IconMapping = {
  target: string;
  candidates: string[];
};

type CliOptions = {
  source: string;
  destination: string;
  dryRun: boolean;
};

const DEFAULT_SOURCE = path.join(
  'vendor',
  'vscode-material-icon-theme',
);
const DEFAULT_DESTINATION = path.join('resources', 'icons', 'templates');

const ICON_MAPPINGS: IconMapping[] = [
  { target: 'angular', candidates: ['angular'] },
  { target: 'c', candidates: ['c'] },
  { target: 'cpp', candidates: ['cpp'] },
  { target: 'devops', candidates: ['tools', 'console', 'config'] },
  { target: 'docker', candidates: ['docker'] },
  { target: 'dotnet', candidates: ['dotnet', 'csharp'] },
  { target: 'flutter', candidates: ['flutter', 'folder-flutter', 'dart'] },
  { target: 'git', candidates: ['git'] },
  { target: 'go', candidates: ['go', 'go_gopher'] },
  { target: 'java', candidates: ['java'] },
  { target: 'kubernetes', candidates: ['kubernetes', 'k8s'] },
  { target: 'node', candidates: ['nodejs', 'node'] },
  { target: 'php', candidates: ['php'] },
  { target: 'powershell', candidates: ['powershell'] },
  { target: 'python', candidates: ['python'] },
  { target: 'ruby', candidates: ['ruby'] },
  { target: 'rust', candidates: ['rust'] },
  { target: 'shell', candidates: ['console', 'shell', 'bash'] },
  { target: 'sql', candidates: ['database', 'sql'] },
  { target: 'typescript', candidates: ['typescript'] },
];

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    source: process.env.MATERIAL_ICON_THEME_PATH ?? DEFAULT_SOURCE,
    destination: DEFAULT_DESTINATION,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--source' || arg === '-s') {
      options.source = argv[++i] ?? '';
      continue;
    }

    if (arg === '--destination' || arg === '-d') {
      options.destination = argv[++i] ?? '';
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.source.trim()) {
    throw new Error('Missing --source path.');
  }

  if (!options.destination.trim()) {
    throw new Error('Missing --destination path.');
  }

  return {
    ...options,
    source: path.resolve(process.cwd(), options.source),
    destination: path.resolve(process.cwd(), options.destination),
  };
}

function printHelp(): void {
  console.log(`Usage: npm run sync:template-icons -- [options]

Copies selected SVG icons from vscode-material-icon-theme into AnFavorites.

Options:
  -s, --source <path>       Path to material-extensions/vscode-material-icon-theme.
                            Default: ${DEFAULT_SOURCE}
  -d, --destination <path>  Destination for copied SVGs.
                            Default: ${DEFAULT_DESTINATION}
      --dry-run            Show what would be copied without writing files.
  -h, --help               Show this help.

Example:
  git submodule add https://github.com/material-extensions/vscode-material-icon-theme vendor/vscode-material-icon-theme
  npm run sync:template-icons
`);
}

function listSvgFiles(root: string): string[] {
  const results: string[] = [];
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git' || entry.name === 'node_modules') {
          continue;
        }
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile() && entry.name.toLowerCase().endsWith('.svg')) {
        results.push(fullPath);
      }
    }
  }

  return results;
}

function toIconKey(filePath: string): string {
  return path.basename(filePath, '.svg').toLowerCase();
}

function indexSvgFiles(svgFiles: string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();

  for (const filePath of svgFiles) {
    const key = toIconKey(filePath);
    const existing = index.get(key) ?? [];
    existing.push(filePath);
    index.set(key, existing);
  }

  return index;
}

function pickBestMatch(matches: string[]): string {
  return [...matches].sort((a, b) => scorePath(b) - scorePath(a))[0];
}

function scorePath(filePath: string): number {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  let score = 0;

  if (normalized.includes('/icons/')) score += 30;
  if (normalized.includes('/src/')) score += 10;
  if (normalized.includes('/dist/')) score += 10;
  if (normalized.includes('/light/')) score -= 20;
  if (normalized.includes('/folder')) score -= 15;

  return score;
}

function syncIcons(options: CliOptions): void {
  if (!fs.existsSync(options.source)) {
    throw new Error(
      `Source path does not exist: ${options.source}\n` +
        'Clone or add the Material Icon Theme repo first.',
    );
  }

  const svgFiles = listSvgFiles(options.source);
  if (svgFiles.length === 0) {
    throw new Error(`No SVG files found under: ${options.source}`);
  }

  const svgIndex = indexSvgFiles(svgFiles);
  const copied: string[] = [];
  const missing: string[] = [];

  if (!options.dryRun) {
    fs.mkdirSync(options.destination, { recursive: true });
  }

  for (const mapping of ICON_MAPPINGS) {
    const source = findIcon(mapping, svgIndex);
    if (!source) {
      missing.push(`${mapping.target} (${mapping.candidates.join(', ')})`);
      continue;
    }

    const destination = path.join(options.destination, `${mapping.target}.svg`);
    copied.push(`${path.relative(process.cwd(), source)} -> ${path.relative(process.cwd(), destination)}`);

    if (!options.dryRun) {
      fs.copyFileSync(source, destination);
    }
  }

  for (const line of copied) {
    console.log(options.dryRun ? `[dry-run] ${line}` : `[copied] ${line}`);
  }

  if (missing.length > 0) {
    console.warn(`Missing icons:\n- ${missing.join('\n- ')}`);
  }

  copyLicenseFile(options);

  console.log(
    `${options.dryRun ? 'Checked' : 'Synced'} ${copied.length} template icons` +
      ` from ${path.relative(process.cwd(), options.source) || options.source}`,
  );
}

function copyLicenseFile(options: CliOptions): void {
  const licenseCandidates = ['LICENSE.md', 'LICENSE', 'LICENSE.txt'];
  const sourceLicense = licenseCandidates
    .map((fileName) => path.join(options.source, fileName))
    .find((filePath) => fs.existsSync(filePath));

  if (!sourceLicense) {
    console.warn('Material Icon Theme license file was not found in the source path.');
    return;
  }

  const destinationLicense = path.join(
    options.destination,
    'LICENSE.material-icon-theme.md',
  );

  console.log(
    options.dryRun
      ? `[dry-run] ${path.relative(process.cwd(), sourceLicense)} -> ${path.relative(process.cwd(), destinationLicense)}`
      : `[copied] ${path.relative(process.cwd(), sourceLicense)} -> ${path.relative(process.cwd(), destinationLicense)}`,
  );

  if (!options.dryRun) {
    fs.copyFileSync(sourceLicense, destinationLicense);
  }
}

function findIcon(
  mapping: IconMapping,
  svgIndex: Map<string, string[]>,
): string | undefined {
  for (const candidate of mapping.candidates) {
    const matches = svgIndex.get(candidate.toLowerCase());
    if (matches && matches.length > 0) {
      return pickBestMatch(matches);
    }
  }

  return undefined;
}

try {
  syncIcons(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
