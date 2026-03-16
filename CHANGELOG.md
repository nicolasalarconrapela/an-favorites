# Changelog

## [1.2.38] - 2026-03-16

### Added
- **.gitignore Integration**: Automatically apply `.gitignore` rules as search exclusions in Quick Open.
- **Commands**: New `Manage .gitignore Files`, `Clear Extension Cache`, and `View Release Notes` commands.
- **Notifications**: Automatic update notifications with quick access to release changes.
- **Maintenance**: Added `anfavorites.advanced.clearCacheAction` setting for manual index purging.

### Changed
- **Migration**: Full move to ESLint v10 "Flat Config" and updated `typescript-eslint` rules.
- **UX**: Improved `.gitignore` scanning with clean status bar feedback.
- **Docs**: Updated README with Open VSX status and modernized asset URLs.

### Fixed
- **Collision Index**: Improved invalidation logic when workspace configuration or directory structures change.
- **Search Reliability**: Corrected tracking and cleanup logic for repositories without `.gitignore` files.

## [1.1.5] - 2026-03-05

### Fixed

- Search: Fixed omissions in Quick Open search result aggregation to ensure full result sets are returned.
- Search: Corrected cancellation token handling during command execution to prevent inconsistent search behavior.

### Changed

- Marketplace: Updated extension package naming and publish-related configuration.
- Development: Added `.devcontainer/devcontainer.json` to standardize local development environments.
- Maintenance: Applied dependency updates and security patches via `npm audit fix`.

## [1.0.5] - 2026-02-24

### Changed

- Documentation: Unified and translated the complete Changelog to English.
- Documentation: Reformatted version history for better readability and structure.
- Maintenance: General repository cleanup and version synchronization.

## [1.0.3] - 2026-02-24

### Changed

- Logging: General refactor to reduce verbosity in the output channel.
- Logging: Internal process logs (Quick Open, tree refresh, command execution) now use the `debug` level by default.
- Logging: Support for dynamically updating the log level when changing settings without requiring a restart.
- Logging: A confirmation message is displayed in the output when the logging level is changed.
- UI: Automatic opening of the output channel when activating the extension has been removed.

## [1.0.0] - 2026-02-23

### Added

- **Core Strategy**: Official release of the stable version with a robust architecture for favorites management.
- **Quick Open (CTRL+ALT+F)**: New ultra-fast search interface that integrates favorites, recent files, and global search across the workspace.
- **Group System**: Allows you to organize favorites into custom folders with full drag-and-drop support for reordering items and groups.
- **Favorites by Line**: Unique ability to save not only files, but also specific lines of code (advanced bookmarks) with integration into the tree and Quick Open.
- **Multi-IDE Synchronization**: New shared storage system that allows you to automatically synchronize your favorites between VS Code, Cursor, Windsurf, and other IDEs based on the same workspace.
- **Collision Detection**: Intelligent identification of files with duplicate names in the tree and Quick Open, adding path tags only when necessary to avoid ambiguity.
- **Multi-root Support**: Advanced workspace management with multiple root folders, allowing you to separate favorites by project name.
- **Internalization**: Full bilingual support (Spanish and English) and interactive walkthroughs for new users.
- **Advanced Logging**: Professional logging system with file rotation, configurable levels, and metadata-enriched output.

### Changed

- Complete refactoring of the repository structure to meet production standards.
- Dramatic performance improvement in file validation using concurrency pools.
- UX: Optimized context menus in the editor, browser, and tree view.
- UI: Implementation of dynamic icons and visual states (pinned, grouped).

## [0.8.86] - 2026-01-30

### Added

- Storage: aplica cambios en caliente al activar/desactivar la sincronización compartida

## [0.4.1] - 2026-01-15

### Changed

- Cache del índice de colisiones por workspace con refresco debounced y reaccionando a eventos del filesystem
- Reutilización del índice de colisiones en árbol de favoritos y Quick Open para evitar búsquedas repetidas

## [0.4.0] - 2026-01-15

### Added

- Bilingual support: English for OpenSource, Spanish for user functionality
- Enhanced logging system with UTF-8 encoding and dual output (TXT + JSON)
- Custom VS Code output channel with visual indicators
- Show logs command for manual channel display
- Automatic log file rotation
- Improved error handling and metadata serialization

### Changed

- Updated documentation to English for OpenSource compliance
- Improved logging module with better performance and reliability

## [0.3.0] - 2026-01-15

### Changed

- Translated all OpenSource documentation to English
- Maintained Spanish for user-facing functionality

## [0.2.0] - 2026-01-15

### Added

- Basic logging system with VS Code output channel
- Hello command functionality
- Webview command

## [0.1.0] - 2026-01-13

### Added

- Initial version with basic extension structure
- Hello command
- Webview functionality
