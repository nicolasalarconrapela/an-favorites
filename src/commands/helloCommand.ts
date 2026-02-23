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
  const command = vscode.commands.registerCommand(
    'anfavorites.hello',
    () => {
      if (!settings.enableGreeting) {
        logger.info('Greeting disabled by configuration');
        return;
      }
      const message = service.getMessage();
      logger.info('Mostrando mensaje');
      vscode.window.showInformationMessage(message);
    },
  );

  context.subscriptions.push(command);
}
