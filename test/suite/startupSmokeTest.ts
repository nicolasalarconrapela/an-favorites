import * as assert from 'assert';
import * as vscode from 'vscode';

export async function runExtensionStartSmokeTest(): Promise<void> {
  const expectedExtensionId = 'AnAppWilos.an-favorites';
  console.log('[startupSmokeTest] Looking for extension:', expectedExtensionId);

  const installedExtensions = vscode.extensions.all.map((extension) => ({
    id: extension.id,
    isActive: extension.isActive,
  }));
  const matchingExtensions = installedExtensions.filter((extension) =>
    extension.id.toLowerCase().includes('an-favorites'),
  );

  console.log(
    '[startupSmokeTest] Matching installed extensions:',
    JSON.stringify(matchingExtensions, null, 2),
  );

  const extension = vscode.extensions.getExtension(expectedExtensionId);

  if (extension) {
    console.log(
      `[startupSmokeTest] RESULT: INSTALADA - id=${extension.id} isActive=${extension.isActive}`,
    );
  } else {
    console.error(
      `[startupSmokeTest] RESULT: NO INSTALADA - expected id=${expectedExtensionId}`,
    );
  }

  assert.ok(
    extension,
    `The extension under test must be available. Expected id: ${expectedExtensionId}`,
  );

  await extension.activate();

  console.log('[startupSmokeTest] Extension activated:', extension.id);
  console.log(
    `[startupSmokeTest] RESULT: ACTIVADA - id=${extension.id} isActive=${extension.isActive}`,
  );

  assert.strictEqual(
    extension.isActive,
    true,
    'The extension must activate successfully.',
  );

  const commands = await vscode.commands.getCommands(true);
  console.log(
    '[startupSmokeTest] Registered anfavorites commands:',
    commands.filter((command) => command.startsWith('anfavorites.')),
  );
  assert.ok(
    commands.includes('anfavorites.quickOpen'),
    'The extension must register its commands after activation.',
  );
  console.log(
    '[startupSmokeTest] RESULT: COMANDOS OK - anfavorites.quickOpen registrado',
  );
}
