import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { downloadAndUnzipVSCode } from '@vscode/test-electron';

function resolveRealPath(targetPath: string): string {
  return typeof fs.realpathSync.native === 'function' ? fs.realpathSync.native(targetPath) : fs.realpathSync(targetPath);
}

function assertPathExists(targetPath: string, description: string): void {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${description} not found: ${targetPath}`);
  }
}

async function launchExtensionTests(vscodeExecutablePath: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = cp.spawn(vscodeExecutablePath, args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: 'inherit',
    });

    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(signal ? `Test run terminated with signal ${signal}` : `Test run failed with code ${code}`));
    });
  });
}

async function main(): Promise<void> {
  const extensionDevelopmentPath = resolveRealPath(path.resolve(__dirname, '..', '..'));
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const extensionEntryPoint = path.join(extensionDevelopmentPath, 'dist', 'bootstrap', 'extension.js');
  const vscodeExecutablePath = await downloadAndUnzipVSCode('1.96.2');
  const testRunRoot = fs.mkdtempSync(path.join(extensionDevelopmentPath, '.vscode-test', 'run-'));
  const userDataDir = path.join(testRunRoot, 'user-data');
  const extensionsDir = path.join(testRunRoot, 'extensions');

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(extensionsDir, { recursive: true });

  assertPathExists(extensionTestsPath + '.js', 'Compiled extension test runner');
  assertPathExists(extensionEntryPoint, 'Compiled extension entry point');

  await launchExtensionTests(
    vscodeExecutablePath,
    [
      '--no-sandbox',
      '--disable-gpu-sandbox',
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
      '--disable-workspace-trust',
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      `--extensionTestsPath=${extensionTestsPath}`,
      `--extensionDevelopmentPath=${extensionDevelopmentPath}`,
    ],
    extensionDevelopmentPath,
  );
}

main().catch((error) => {
  console.error('Error running tests');
  console.error(error);
  process.exit(1);
});
