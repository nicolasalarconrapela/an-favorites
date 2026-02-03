# Quick Open - Lightning Fast Access ⚡

The Quick Open feature is your command center for navigating favorites and recent files.

## Access Quick Open

Press **Alt+Shift+F** (or run **"AnFavorites: Quick Open"** from the Command Palette)

## What You'll See

The Quick Open dialog shows three sections:

### 📌 Pinned Favorites

Your most important favorites, always at the top. Pin any favorite from the tree view for instant access.

### ⭐ Recent Favorites

The favorites you've accessed most recently, automatically tracked.

### 📂 Recent Files

Recently opened files from your workspace, making it easy to return to your work.

## Power Features

- **Search as you type**: Filter favorites by filename or path
- **Keyboard navigation**: Use arrow keys to navigate, Enter to open
- **Open to side**: Automatically open files in a split editor (configurable)
- **Smart filtering**: Respects your exclusion patterns for node_modules, dist, etc.

## Configuration

Customize how many items appear in each section:

- `anfavorites.maxItems.favorites`: Recent favorites to show (default: 3)
- `anfavorites.maxItems.pinned`: Maximum pinned favorites (default: 3)
- `anfavorites.maxItems.recentFiles`: Recent files to show (default: 3)
- `anfavorites.quickOpen.openToSide`: Auto-open in side editor (default: true)

## Pro Tip 💡

Pin your most-used files for one-keypress access: **Alt+Shift+F** → **Enter**
