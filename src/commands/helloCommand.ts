import * as vscode from 'vscode';

import { HelloService } from '../services/helloService';
import { Logger } from '../logging/logger';
import { ExtensionSettings } from '../config/settings';

export function registerHelloCommand(
  context: vscode.ExtensionContext,
  service: HelloService,
  logger: Logger,
  settings: ExtensionSettings,
): void {
  const log = logger.withContext?.({ scope: 'HelloCommand' }) ?? logger;
  const command = vscode.commands.registerCommand(
    'anfavorites.hello',
    () => {
      if (!settings.enableGreeting) {
        log.info('Greeting command skipped because it is disabled in settings');
        return;
      }
      const message = service.getMessage();
      log.info('Showing greeting message');
      vscode.window.showInformationMessage(message);
    },
  );

  context.subscriptions.push(command);
}
