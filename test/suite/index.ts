import { runExtensionStartSmokeTest } from './startupSmokeTest';

export async function run(): Promise<void> {
  await runExtensionStartSmokeTest();
}
