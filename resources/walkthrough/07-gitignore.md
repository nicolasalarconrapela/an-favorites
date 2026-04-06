# Manage .gitignore Files 🧿

AnFavorites automatically detects `.gitignore` files in your workspace and uses them to exclude files from Quick Open search results.

## 📋 Control Your Exclusions

You can manually manage which `.gitignore` files are active:

1. Open the Command Palette (**Ctrl+Shift+P** or **Cmd+Shift+P**)
2. Type **"Manage .gitignore Files"**
3. A list of all detected files will appear.
4. Toggle files on or off to enable or disable their rules.
5. The changes will be applied when you invoke the command **"AnFavorites"** again.

[Manage .gitignore Files](command:anfavorites.manageGitignore)

## ️⚡ Native Ripgrep Acceleration

Thanks to native **Ripgrep** integration under the hood, AnFavorites natively explores your entire workspace hierarchy. Nested `.gitignore` files inside your subdirectories are evaluated at lightning speeds without requiring any additional configuration.

This ensures your search results stay clean and focused only on the files that matter.
