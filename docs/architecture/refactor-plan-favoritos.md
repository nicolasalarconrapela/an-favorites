# Plan de refactorización: motor reutilizable de favoritos

## Objetivo
Unificar las funcionalidades de **favoritos**, **pinned** y **árbol** en un núcleo reutilizable para acelerar la integración de nuevos tipos de objeto (por ejemplo: comandos VS Code, archivos por línea, snippets, URLs internas).

## Patrón de diseño recomendado

Se recomienda una combinación de:

1. **Arquitectura Hexagonal (Ports & Adapters)** para desacoplar dominio de VS Code/UI/storage.
2. **Strategy** para comportamiento por tipo de favorito (`file`, `line`, `command`, etc.).
3. **Composite + Visitor liviano** para representar y renderizar nodos del árbol homogéneamente.

## Diseño propuesto

### 1) Núcleo de dominio (`favorites-core`)
Responsabilidades:

- Modelo canónico de favorito (`FavoriteItem`) con metadatos comunes: `id`, `kind`, `label`, `pinned`, `groupId`, `workspaceId`, `createdAt`, `updatedAt`.
- Casos de uso transversales:
  - `addFavorite`
  - `removeFavorite`
  - `togglePin`
  - `moveFavorite`
  - `listFavorites`
- Reglas de ordenamiento centralizadas: `pinned > grupo > orden manual > label`.

### 2) Puerto de comportamiento por tipo (`FavoriteKindStrategy`)
Cada tipo implementa su estrategia:

- `serialize/deserialize`
- `validate`
- `execute/open`
- `buildTreePresentation`

Ejemplos:

- `FileFavoriteStrategy`
- `LineFavoriteStrategy`
- `CommandFavoriteStrategy`

Esto evita condicionales repetidos (`if kind === ...`) distribuidos en árbol, quick open y comandos.

### 3) Árbol desacoplado (`TreeNodeComposite`)
Normalizar nodos de árbol con una jerarquía común:

- `GroupNode`
- `FavoriteNode`
- `PinnedSectionNode` (virtual)

El provider de VS Code solo adapta este árbol al `TreeDataProvider`, sin lógica de negocio.

### 4) Adaptadores de infraestructura

- `StorageAdapter` (local/shared)
- `VsCodeCommandAdapter` (ejecución de comandos)
- `UriResolverAdapter` (archivos y líneas)
- `TelemetryAdapter`

Todos implementan puertos del dominio, permitiendo pruebas de dominio sin VS Code real.

## Plan de migración incremental

### Fase 1: Contratos y modelo canónico
- Introducir `FavoriteItem` y `FavoriteKindStrategy`.
- Agregar mapeadores desde el formato actual sin romper compatibilidad.

### Fase 2: Casos de uso unificados
- Extraer operaciones de favoritos/pin/movimiento a servicios de dominio.
- Reusar los casos de uso desde comandos existentes.

### Fase 3: Refactor del árbol
- Reemplazar lógica específica del provider por `TreeNodeComposite`.
- Consumir `buildTreePresentation` por estrategia.

### Fase 4: Integración de nuevos tipos
- Implementar `CommandFavoriteStrategy` y `LineFavoriteStrategy` como casos piloto.
- Validar que alta/edición/ejecución/listado no requieran cambios en el core.

### Fase 5: Endurecimiento
- Pruebas unitarias del dominio y contract tests de adaptadores.
- Métricas de tiempo de integración de un nuevo `kind`.

## Criterios de éxito

- Agregar un nuevo tipo de favorito en <= 1 día.
- Reducir duplicación en tree/quick open/comandos.
- Mantener compatibilidad del almacenamiento existente.
- Disminuir regresiones en pinned y orden manual.

## Riesgos y mitigaciones

- **Riesgo:** migración de datos heterogéneos.
  - **Mitigación:** capa de compatibilidad con versionado de esquema.
- **Riesgo:** sobre-ingeniería.
  - **Mitigación:** aplicar Strategy solo para tipos activos (`file`, `line`, `command`).
- **Riesgo:** acoplamiento accidental a UI.
  - **Mitigación:** prohibir tipos de VS Code en `favorites-core`.

## Estructura sugerida

- `src/domain/favorites/`
  - `models/FavoriteItem.ts`
  - `ports/FavoriteRepository.ts`
  - `ports/FavoriteKindStrategy.ts`
  - `useCases/*.ts`
- `src/application/tree/`
  - `TreeNodeComposite.ts`
  - `TreeBuilder.ts`
- `src/infrastructure/`
  - `storage/*Adapter.ts`
  - `vscode/*Adapter.ts`

## Nota de implementación
Antes de mover código en bloque, conviene introducir una fachada `FavoritesFacade` para enrutar comandos actuales al nuevo core y migrar por feature flags internas.
