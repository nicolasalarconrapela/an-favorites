# Changelog

## [0.8.82] - 2026-01-29

### Changed
- Quick Open: introduce servicio de búsqueda con adaptador VS Code para mejorar testabilidad

## [0.8.81] - 2026-01-29

### Changed
- Quick Open: introduce servicio de configuración con adaptador VS Code

## [0.8.80] - 2026-01-29

### Changed
- Quick Open: extrae helpers y tipos puros a un módulo dedicado

## [0.8.79] - 2026-01-29

### Changed
- Quick Open: refactor de la construcción de items y configuración para separar responsabilidades

## [0.8.78] - 2026-01-29

### Fixed
- Quick Open: corrige la paginación para mostrar aviso de límite y botón Load More a la vez

## [0.8.77] - 2026-01-29

### Changed
- Quick Open: añade botón Load More cuando se supera el máximo de resultados mostrados

## [0.8.76] - 2026-01-29

### Changed
- Quick Open: añade cancelación a búsquedas/validaciones y sube el debounce a 150ms
- Colisiones: el índice respeta un límite máximo de archivos y soporta cancelación

## [0.8.75] - 2026-01-29

### Changed
- Quick Open: reduce logs de hot path a nivel debug para evitar ruido
- Quick Open: tipado del logger fuerte para mejorar consistencia y tests
- Colisiones: se unifica la aplicación de etiquetas de colisión entre árbol y Quick Open

## [0.8.74] - 2026-01-29

### Fixed
- Lifecycle: el índice de colisiones puede reactivarse correctamente tras un deactivate

## [0.8.73] - 2026-01-29

### Fixed
- Lifecycle: se liberan listeners internos de MRU y TreeDataProvider para evitar fugas en recarga
- Lifecycle: se añade limpieza del índice global de colisiones y sus watchers en deactivate

## [0.8.71] - 2026-01-28

### Changed
- Logging: Quick Open ahora usa correlationId por sesión y reduce ruido en logs de entorno/validaciones
- Logging: TreeDataProvider baja a debug logs de refresh/getChildren para producción

## [0.8.70] - 2026-01-28

### Changed
- Código TypeScript: limpieza de comentarios innecesarios

## [0.8.69] - 2026-01-28

### Changed
- Logging: soporte de contexto (scope/correlationId), sanitización y redacción de metadatos sensibles, serialización segura y lazy evaluation
- Logging: helper de timers, opción de salida a consola y JSON de una línea para archivos

## [0.8.62] - 2026-01-27

### Changed
- Quick Open: al eliminar un favorito durante una búsqueda, el icono se actualiza sin reconstruir la lista

## [0.8.61] - 2026-01-27

### Changed
- Quick Open: no reconstruye la lista de favoritos cuando se está buscando para mantener la posición actual

## [0.8.60] - 2026-01-27

### Changed
- Quick Open: los favoritos recientes ahora respetan el orden de adición para evitar que el último añadido aparezca primero

## [0.8.59] - 2026-01-27

### Changed
- Quick Open: debounce de reconstrucciones por cambios externos para reducir microparpadeos al alternar favoritos

## [0.8.58] - 2026-01-27

### Changed
- La detección de exclusiones considera rutas relativas por carpeta en workspaces multi-root

## [0.8.57] - 2026-01-27

### Changed
- Los reportes de nombres duplicados ahora respetan los patrones de `anfavorites.search.exclusions`

## [0.8.56] - 2026-01-21

### Changed
- MRU: limpieza de rutas vacías al cargar y validación de updatePath para descartar entradas vacías
- Quick Open: eliminación directa de rutas inexistentes del MRU

## [0.8.55] - 2026-01-20

### Changed
- Validación de favoritos y MRU con pool de concurrencia limitado y métricas de duración/procesados

## [0.8.54] - 2026-01-19

### Changed
- Watcher acotado a rutas de favoritos y recientes con sincronización automática
- Validación específica por archivo eliminado y debounce para ráfagas

## [0.8.53] - 2026-01-18

### Changed
- Escritura transaccional con archivo temporal y rename atómico en el almacenamiento compartido
- Control de versión por etag, merge simple por clave y emisión de onDidChange en cambios locales
- Registro de conflictos de escritura para diagnóstico

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
