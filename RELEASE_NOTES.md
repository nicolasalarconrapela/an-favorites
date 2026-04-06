# Release Notes

## Intelligent Exclusions & Smart Maintenance - v1.2.40

_Release Date: March 16, 2026_

### Resume
Welcome to the latest version of **AnFavorites**! This update brings essential quality improvements to search behavior by respecting your `.gitignore` rules automatically. We've also added a new command [**"Manage .gitignore Files"**](command:anfavorites.manageGitignore) to give you full control over which rules are applied, along with a [**"Clear Extension Cache"**](command:anfavorites.clearCache) utility for smooth maintenance.

### Highlights 🚀
- **Smart .gitignore Integration**: AnFavorites now respects your project's exclusion rules. While scanning is global for performance, the **active rules** are strictly applied per-workspace, giving you granular control.
- **Proactive Maintenance**: The new "Clear Cache" feature ensures your search indexes stay fresh and helps troubleshooting legacy data from older versions.

### Improvements ✨
- **Background Scanning**: When opening projects, you'll see a discrete status bar animation: _"Scanning workspace for .gitignore files..."_.
- **Modern Infrastructure**: Full migration to **ESLint v10 Flat Config** and updated TypeScript rules for higher code reliability.
- **Enhanced Transparency**: Updated documentation and settings clearly explain that `.gitignore` management is a workspace-level feature, avoiding confusion in shared environments.

### Bug Fixes 🐛
- **Scan Optimization**: Corrected logic to gracefully handle and clean up when no `.gitignore` files are present in the workspace.
- **UI Refinement**: Fixed false progress indicator triggers when navigating global settings without changes.

- **Documentation**: Cleaned up the README by removing legacy version notes, streamlining the presentation for new users.
