import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

type CliOptions = {
  version: string;
  repository: string;
  cacheDir: string;
  destinationRoot: string;
  dryRun: boolean;
  keepCache: boolean;
};

const DEFAULT_VERSION = 'v5.33.1';
const DEFAULT_REPOSITORY =
  'https://github.com/material-extensions/vscode-material-icon-theme.git';
const DEFAULT_CACHE_DIR = path.join('.tmp', 'material-icon-theme');
const DEFAULT_DESTINATION_ROOT = path.join(
  'resources',
  'icons',
  'material-icon-theme',
);

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    version: process.env.MATERIAL_ICON_THEME_VERSION ?? DEFAULT_VERSION,
    repository: process.env.MATERIAL_ICON_THEME_REPOSITORY ?? DEFAULT_REPOSITORY,
    cacheDir: DEFAULT_CACHE_DIR,
    destinationRoot: DEFAULT_DESTINATION_ROOT,
    dryRun: false,
    keepCache: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--version' || arg === '-v') {
      options.version = argv[++i] ?? '';
      continue;
    }

    if (arg === '--repository' || arg === '--repo' || arg === '-r') {
      options.repository = argv[++i] ?? '';
      continue;
    }

    if (arg === '--cache-dir') {
      options.cacheDir = argv[++i] ?? '';
      continue;
    }

    if (arg === '--destination' || arg === '-d') {
      options.destinationRoot = argv[++i] ?? '';
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--keep-cache') {
      options.keepCache = true;
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.version.trim()) {
    throw new Error('Missing --version value.');
  }

  if (!options.repository.trim()) {
    throw new Error('Missing --repository value.');
  }

  return {
    ...options,
    cacheDir: path.resolve(process.cwd(), options.cacheDir),
    destinationRoot: path.resolve(process.cwd(), options.destinationRoot),
  };
}

function printHelp(): void {
  console.log(`Usage: npm run sync:template-icons -- [options]

Clones a Material Icon Theme release/tag and copies the complete icons folder
into a versioned AnFavorites asset directory.

Options:
  -v, --version <tag>       Release tag to clone. Default: ${DEFAULT_VERSION}
  -r, --repo <url>          Git repository URL. Default: ${DEFAULT_REPOSITORY}
      --cache-dir <path>    Clone cache directory. Default: ${DEFAULT_CACHE_DIR}
  -d, --destination <path>  Destination root. Default: ${DEFAULT_DESTINATION_ROOT}
      --dry-run            Show planned actions without writing files.
      --keep-cache         Keep cloned release checkout after syncing.
  -h, --help               Show this help.

Example:
  npm run sync:template-icons -- --version v5.33.1
`);
}

function runGit(args: string[], cwd?: string): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'inherit',
  });
}

function removeDirectory(directory: string): void {
  if (fs.existsSync(directory)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function copyDirectory(source: string, destination: string): number {
  let copiedFiles = 0;
  fs.mkdirSync(destination, { recursive: true });

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const destinationPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      copiedFiles += copyDirectory(sourcePath, destinationPath);
      continue;
    }

    if (entry.isFile()) {
      fs.copyFileSync(sourcePath, destinationPath);
      copiedFiles++;
    }
  }

  return copiedFiles;
}

function findLicenseFile(sourceRoot: string): string | undefined {
  return ['LICENSE.md', 'LICENSE', 'LICENSE.txt']
    .map((fileName) => path.join(sourceRoot, fileName))
    .find((filePath) => fs.existsSync(filePath));
}

function writeManifest(options: CliOptions): void {
  const manifestPath = path.join(options.destinationRoot, 'manifest.json');
  const manifest = {
    name: 'vscode-material-icon-theme',
    repository: options.repository,
    version: options.version,
    iconsPath: `${options.version}/icons`,
    licensePath: `${options.version}/LICENSE.material-icon-theme.md`,
    syncedAt: new Date().toISOString(),
  };

  fs.mkdirSync(options.destinationRoot, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

function syncRelease(options: CliOptions): void {
  const releaseCachePath = path.join(options.cacheDir, options.version);
  const destinationVersionPath = path.join(
    options.destinationRoot,
    options.version,
  );
  const sourceIconsPath = path.join(releaseCachePath, 'icons');
  const destinationIconsPath = path.join(destinationVersionPath, 'icons');

  if (options.dryRun) {
    console.log(`[dry-run] clone ${options.repository}#${options.version}`);
    console.log(
      `[dry-run] copy ${path.relative(process.cwd(), sourceIconsPath)} -> ${path.relative(process.cwd(), destinationIconsPath)}`,
    );
    console.log(
      `[dry-run] write ${path.relative(process.cwd(), path.join(options.destinationRoot, 'manifest.json'))}`,
    );
    return;
  }

  removeDirectory(releaseCachePath);
  fs.mkdirSync(path.dirname(releaseCachePath), { recursive: true });

  runGit([
    'clone',
    '--depth',
    '1',
    '--branch',
    options.version,
    options.repository,
    releaseCachePath,
  ]);

  if (!fs.existsSync(sourceIconsPath)) {
    throw new Error(`Cloned release does not contain an icons folder: ${sourceIconsPath}`);
  }

  removeDirectory(destinationVersionPath);
  const copiedFiles = copyDirectory(sourceIconsPath, destinationIconsPath);

  const licensePath = findLicenseFile(releaseCachePath);
  if (licensePath) {
    fs.copyFileSync(
      licensePath,
      path.join(destinationVersionPath, 'LICENSE.material-icon-theme.md'),
    );
  } else {
    console.warn('Material Icon Theme license file was not found in the release checkout.');
  }

  writeManifest(options);

  if (!options.keepCache) {
    removeDirectory(releaseCachePath);
  }

  console.log(
    `Synced Material Icon Theme ${options.version}: ${copiedFiles} icon files -> ` +
      path.relative(process.cwd(), destinationIconsPath),
  );
}

try {
  syncRelease(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
