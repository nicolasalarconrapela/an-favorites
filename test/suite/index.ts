import * as fs from 'fs/promises';
import * as path from 'path';

import Mocha from 'mocha';

async function collectTestFiles(directoryPath: string): Promise<string[]> {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directoryPath, entry.name);

      if (entry.isDirectory()) {
        return collectTestFiles(entryPath);
      }

      return entry.name.endsWith('.test.js') ? [entryPath] : [];
    }),
  );

  return nestedFiles.flat().sort();
}

export async function run(): Promise<void> {
  const mocha = new Mocha({
    color: true,
    ui: 'tdd',
  });

  const testsRoot = __dirname;
  const testFiles = await collectTestFiles(testsRoot);

  for (const testFile of testFiles) {
    mocha.addFile(testFile);
  }

  await new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${failures} tests failed.`));
        return;
      }

      resolve();
    });
  });
}
