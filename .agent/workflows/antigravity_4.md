---
description: CHANGELOG Y RELEASE
---

## 5 Generar documentación

## 5.1 Variables de tiempo

`DATE=$(date +%d%m%Y)`
`TIME=$(date +%H%M%S)`

Actuar como mantenedor open-source.

Directorio: `"$OUTPUT_DIR"`

## 5.1 CHANGELOG.md

Si ya existe, copiarlo a `"$OUTPUT_DIR"` y agregar la nueva entrada al principio.

Propósito:
historial técnico de la versión

Formato:
Keep a Changelog

Estructura:

```markdown
# Changelog

## [VERSION] - DATE

### Added

### Changed

### Fixed

### Removed

### Security
```

Reglas:

- lenguaje técnico y conciso
- evitar texto de marketing
- no inventar cambios
- mantener Markdown limpio

---

## 5.2 RELEASE_NOTES.md

Propósito:
explicación de la release para usuarios

Estructura:

```markdown
# {Funcionalidad más importante} - vX.Y.Z

_Fecha de lanzamiento: Mes dd, yyyy_

### Resume

En el resumen, si existe algún comando nuevo, incluir un enlace.  
Ejemplo: `nuevo comando [**"Gestionar archivos .gitignore"**](comando de ejecución vscode)`

### Highlights

### Improvements

### Bug Fixes

### Migration Notes
```

Reglas:

- lenguaje claro y fácil de leer
- enfocado en impacto para el usuario
- enlazar comandos o funcionalidades si aplica
- no agregar agradecimientos
- mantener Markdown limpio

---

## 5.3 PR y merge commit

Generar archivo:

`"$OUTPUT_DIR/pr&merge.txt"`

Contenido: Título del PR,Body del PR, Título de merge commit y Body de merge commit

Fuente única:

`"$OUTPUT_DIR/diffs.txt"`

---

# 6 Walkthrough

Si existen nuevas funcionalidades o comandos en la versión, actualizar:

`docs/walkthrough_en.md`
`docs/walkthrough_es.md`

---

# Reglas estrictas

1. No inventar cambios

2. Usar solo el diff como fuente única de verdad

3. Generar siempre:
   - `CHANGELOG.md`
   - `RELEASE_NOTES.md`

4. Incluir siempre:
   - `{VERSION}`
   - `{DATE}`

5. La salida debe ser Markdown válido
