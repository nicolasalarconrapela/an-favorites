# Release Notes

## v1.3.1 - Faster Quick Open & Performance Fixes

_Release Date: April 08, 2026_

After receiving reports that **Quick Open** was taking too long to appear, especially in large projects, we've redesigned how your files are processed to ensure that opening is **instant and smooth**.

### Improvements 🛠️

- **Instant Opening**: We've eliminated the delay when launching Quick Open, making it significantly faster even in the most demanding workspaces.

- **Improved Reliability**: Internal adjustments to ensure smoother navigation through your favorites and recent files.

- **Transparent Monitoring**: Added diagnostic tools to help us keep the extension performing at its best in future updates.

## v1.3.0 - Native Ripgrep Search & Interactive gitignore Manager

_Release Date: April 06, 2026_

Welcome to **AnFavorites v1.3.0**! We're upgrading search speed by introducing **Native Ripgrep** integration to Quick Open, resulting in unprecedented performance when handling deep workspaces. The update pairs this with a brand-new [**Manage .gitignore Files**](command:anfavorites.manageGitignore) manager, giving you interactive visual control over your search exclusion logic. Finally, we've optimized graphics to `.webp` scaling down the extension size significantly!

## Commands

- **[Manage .gitignore Files](command:anfavorites.manageGitignore)**: Select and manage which `.gitignore` files apply to your workspace.
- **[View Release Notes](command:anfavorites.openReleaseChanges)**: Launch the release preview directly.

### New Features ✨

- **Native Ripgrep Integration**: Under-the-hood acceleration driving Quick Open search.
- **Notification Controls**: Take command over update popups via our new notification preferences logic.

### Improvements 🛠️

- **Sleek Graphics & Size Drops**: Extracted old MP4 tutorials to remote streams and transitioned high resolution imagery to efficient `.webp` equivalents.
- **Rock-solid Packaging**: We've drastically tightened our VS Code publish pipeline (`validate:vsix`) ensuring zero bundled garbage payloads.

### Fixes 🐛

- **Typos Squashed**: Corrected `Zearch.exclusions` key error.

### Security 🔒

- **Audited Dependencies**: Enforced a sanitized whitelisting step so VSIX files remain completely resilient against indirect dependency threats.

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
