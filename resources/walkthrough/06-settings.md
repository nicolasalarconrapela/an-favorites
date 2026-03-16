# Explore Settings ⚙️

AnFavorites is highly configurable. Here are the most useful settings to customize your experience.

## 🔍 Search

- **Exclusion patterns** (`anfavorites.search.exclusions`): Exclude folders like `node_modules`, `dist`, etc. from Quick Open searches
- **Gitignore integration** (`anfavorites.gitignore.enabled`): Automatically use `.gitignore` rules to exclude files from search.
- **Nested gitignores** (`anfavorites.gitignore.includeNested`): Support `.gitignore` files in subdirectories.
- **Max search files** (`anfavorites.search.maxSearchFiles`): Maximum files retrieved per search before showing a warning (default: 1000)
- **Max search results** (`anfavorites.search.maxSearchResults`): Maximum results displayed (default: 200)

## 🧿 .gitignore Integration

AnFavorites can automatically respect your repository's `.gitignore` files to exclude files and folders from Quick Open and searches. Key points:

- **Enable / Disable**: Toggle `anfavorites.gitignore.enabled` to turn `.gitignore` support on or off.
- **Nested `.gitignore` files**: Use `anfavorites.gitignore.includeNested` to include `.gitignore` files located in subdirectories.
- **Per-file control**: Discovered `.gitignore` files are tracked in the workspace setting `anfavorites.gitignore.files` so you can enable/disable individual `.gitignore` files.
- **Merged exclusions**: `.gitignore` patterns are merged with your `anfavorites.search.exclusions` and used when scanning for files.

This integration helps keep Quick Open focused on relevant files without manually maintaining exclusion lists.

## 🎨 Quick Open

- **Show icons** (`anfavorites.quickOpen.showIcons`): Toggle file icons in the Quick Open list
- **Path detail location** (`anfavorites.quickOpen.pathDetailLocation`): Show file paths below (**detail**) or beside (**description**) the file name
- **Show path when** (`anfavorites.quickOpen.showPathWhen`): Always show paths or only on name conflicts
- **Open to side** (`anfavorites.quickOpen.actions.openToSide`): Automatically open files in a side editor
- **Open in new window** (`anfavorites.quickOpen.actions.openInNewWindow`): Open files in a new VS Code window by default
- **Button visibility**: Toggle the "Open to Side" and "Open in New Window" buttons in the list

## 📊 Limits

- **Max pinned** (`anfavorites.limits.maxPinned`): Maximum pinned favorites allowed (default: 3)
- **Max favorites in Quick Open** (`anfavorites.limits.quickOpen.maxFavorites`): Number of recent favorites shown (default: 3)
- **Max recent files** (`anfavorites.limits.quickOpen.maxRecentFiles`): Number of recent files shown (default: 3)
- **Search cache size** (`anfavorites.quickOpen.searchCacheSize`): Number of recent searches kept in memory

## 🌍 Language

Choose between **English**, **Español**, or **Auto** (follows VS Code's language setting):

`anfavorites.language`

## 💾 Storage

- **Share across IDEs** (`anfavorites.storage.shareAcrossIdes`): Enable/disable cross-IDE synchronization. This allows sharing favorites between VS Code, Cursor, Windsurf, etc. if they share the same workspace.

## 🛠️ Maintenance

- **Clear cache** (`anfavorites.advanced.clearCacheAction`): Use this setting to manually purge search indexes and troubleshooting data from the extension.

## Pro Tip 💡

Try different configurations to find the workflow that suits you best. Start with the defaults and adjust as you discover your preferences!
