---
description: Documentación
---

## 5 Generar documentación

En este paso nos encargaremos de la generación de la documentación.

A partir de "$VAR_S1_FILE".

Actuar como mantenedor open-source.

Directorio de salida: `"$OUTPUT_DIR"`

Fuente única de verdad para toda la documentación:
`"$DIFF_FILE"`

---

## 5.1 CHANGELOG.md

Si ya existe un `CHANGELOG.md` en la raíz del proyecto, copiarlo a `"$OUTPUT_DIR/CHANGELOG.md"` y agregar la nueva entrada al principio.
Si no existe, crear uno nuevo en `"$OUTPUT_DIR/CHANGELOG.md"`.
Recuerda que el CHANGELOG 

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
