# Changelog

## [0.8.52] - 2026-01-17

### Changed
- Nivel de logs configurable por settings y por defecto en info
- Escritura de logs asíncrona con cola y limpieza de logs rotados
- Throttling de logs repetitivos en Quick Open y watchers

## [0.8.51] - 2026-01-16

### Changed
- Búsqueda incremental en Quick Open con límites configurables y aviso al superar el umbral de archivos
- Límite de resultados mostrados y caché LRU por sesión para evitar crecimiento indefinido

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
