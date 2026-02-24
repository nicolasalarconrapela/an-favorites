To avoid noise
- Quick Open: Strong logger typing to improve consistency and testing
- Collisions: Unified collision tag application between TreeDataProvider and Quick Open

## [0.8.74] - 2026-01-29

### Fixed

- Lifecycle: The collision index can now be correctly reactivated after a deactivate

## [0.8.73] - 2026-01-29

### Fixed

- Lifecycle: Internal listeners for MRU and TreeDataProvider are now freed to prevent leaks on reload
- Lifecycle: Added cleanup of the global collision index and its watchers on deactivate

## [0.8.71] - 2026-01-28

### Changed

- Logging: Quick Open now uses correlationId per session and reduces noise in environment/validation logs
- Logging: TreeDataProvider now moves logs to debug refresh/getChildren for production

## [0.8.70] - 2026-01-28

### Changed

- TypeScript code: cleaning up unnecessary comments

## [0.8.69] - 2026-01-28

### Changed

- Logging: context support (scope/correlationId), sanitization and redaction of sensitive metadata, safe serialization, and lazy evaluation
- Logging: timer helper, console output option, and one-line JSON for files

## [0.8.62] - 2026-01-27

### Changed

- Quick Open: when deleting a favorite during a search, the icon updates without rebuilding the list

## [0.8.61] - 2026-01-27

### Changed

- Quick Open: does not rebuild the favorites list when searching to maintain the Current position

## [0.8.60] - 2026-01-27

### Changed

- Quick Open: Recent favorites now respect the order in which they were added to prevent the most recently added favorite from appearing first.

## [0.8.59] - 2026-01-27

### Changed

- Quick Open: Debounces rebuilds for external changes to reduce micro-flickers when toggling favorites.

## [0.8.58] - 2026-01-27

### Changed

- Exclusion detection now considers relative folder paths in multi-root workspaces.

## [0.8.57] - 2026-01-27

### Changed

- Duplicate name reports now respect the patterns in `anfavorites.search.exclusions`.

## [0.8.56] - 2026-01-21

### Changed

- MRU: Clean up empty paths on load and validate updatePath to discard empty entries
- Quick Open: Direct removal of non-existent paths from the MRU

## [0.8.55] - 2026-01-20

### Changed

- Validation of favorites and MRU with limited concurrency pool and duration/processed metrics

## [0.8.54] - 2026-01-19

### Changed

- Watcher limited to favorites and recent paths with automatic synchronization
- Specific validation per deleted file and debounce for bursts

## [0.8.53] - 2026-01-18

### Changed

- Transactional write with temporary file and atomic rename on shared storage
- Version control by etag, simple merge by key, and issuance of onDidChange in local changes
- Write conflict logging for diagnostics

## [0.8.52] - 2026-01-17

### Changed

- Configurable log level via settings and default in info
- Asynchronous log writing with queuing and cleaning of rotated logs
- Throttling of repetitive logs in Quick Open and watchers

## [0.8.51] - 2026-01-16

### Changed

- Incremental search in Quick Open with configurable limits and warning when exceeding the file threshold
- Limit on displayed results and LRU caching per session to prevent indefinite growth

## [0.4.1] - 2026-01-15

### Changed

- Collision index caching per workspace with debounced refresh and reaction to filesystem events
- Reuse of the collision index in the favorites tree and Quick Open to avoid repeated searches

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
-Hello command functionality
- Webview command

## [0.1.0] - 2026-01-13

### Added

- Initial version with basic extension structure
-Hello command
- Webview functionality
