const vscode = require('vscode'); vscode.commands.getCommands(true).then(cmds => console.log(cmds.filter(c => c.toLowerCase().includes('window'))));
