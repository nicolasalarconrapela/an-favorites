import * as fs from 'fs';
import * as path from 'path';

const { runTests } = require('@vscode/test-electron') as {
  runTests: (options: {
    extensionDevelopmentPath: string;
    extensionTestsPath: string;
    launchArgs?: string[];
  }) => Promise<void>;
};

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '..', '..', '..');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');
  const packageJsonPath = path.join(extensionDevelopmentPath, 'package.json');
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
    publisher?: string;
    name?: string;
    version?: string;
  };
  const expectedExtensionId = `${packageJson.publisher}.${packageJson.name}`;

  console.log('[test:integration] extensionDevelopmentPath =', extensionDevelopmentPath);
  console.log('[test:integration] extensionTestsPath =', extensionTestsPath);
  console.log('[test:integration] expectedExtensionId =', expectedExtensionId);
  console.log('[test:integration] extensionVersion =', packageJson.version);

  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ['--disable-gpu', '--disable-updates', '--skip-welcome'],
  });
}

main().catch((error) => {
  console.error('Error running integration tests');
  console.error(error);
  process.exit(1);
});
