---
description: Documentación
---

## 5 Generar documentación

En este paso nos encargaremos de la generación de la documentación de la release.
Trabajar siempre a partir de las variables definidas en: `"$VAR_S1_FILE"`
Actuar como mantenedor open-source.
Directorio de salida: `"$OUTPUT_DIR"`
Fuente única de verdad para toda la documentación: `"$DIFF_FILE"`

Reglas generales:

- ignorar los cambios en la carpeta .agent a menos que se indique lo contrario
- no inventar cambios
- usar exclusivamente `"$DIFF_FILE"` como fuente de verdad del contenido
- mantener redacción profesional, clara y orientada a proyecto open-source
- no analizar código fuera del diff
- toda la documentación generada en este paso debe guardarse dentro de `"$OUTPUT_DIR"`

---

## 5.1 CHANGELOG.md

Objetivo: generar el historial técnico de la nueva versión.
Archivo de salida: `"$OUTPUT_DIR/CHANGELOG.md"`
Idiomas: solo español

Reglas:

- si ya existe un `CHANGELOG.md` en la raíz del proyecto, copiarlo primero a `"$OUTPUT_DIR/CHANGELOG.md"`
- sobre esa copia, agregar la nueva entrada al principio, justo después del título principal
- si no existe un `CHANGELOG.md` en la raíz, crear uno nuevo en `"$OUTPUT_DIR/CHANGELOG.md"`
- no sobrescribir directamente el `CHANGELOG.md` original de la raíz en este paso
- el contenido nuevo debe construirse únicamente a partir de `"$DIFF_FILE"`
- la versión a documentar debe ser `"$VERSION_ACTUAL"`
- la fecha a usar debe corresponder a la ejecución actual

Formato obligatorio: Keep a Changelog

Estructura obligatoria si existe algunas de las secciones:

```markdown
# Changelog

## [VERSION] - DATE

### Added

(Nuevas funcionalidades incorporadas)

### Changed

(Cambios de comportamiento, mejoras o ajustes relevantes)

### Fixed

(Correcciones de errores)

### Removed

(Eliminaciones o retiradas de funcionalidades, comandos o comportamientos)

### Security

(Cambios relacionados con seguridad)
```

Reglas de redacción:

- escribir entradas breves, técnicas y verificables
- no duplicar el mismo cambio en varias categorías salvo que sea estrictamente necesario
- si una categoría no tiene cambios reales, omitirla
- no incluir secciones vacías
- no inventar tickets, issues, decisiones ni impactos que no estén visibles en el diff
- si un cambio no es claramente deducible desde `"$DIFF_FILE"`, no incluirlo

Guardar resultado en: `"$OUTPUT_DIR/CHANGELOG.md"`

---

## 5.2 RELEASE_NOTES.md

Objetivo: generar documentación orientada al usuario final y a la publicación de la release.

Idiomas: inglés y traducir al español

Archivo de salida:

- si ya existe un `RELEASE_NOTES.md` o/y en la raíz del proyecto, copiarlo primero a : `"$OUTPUT_DIR/RELEASE_NOTES.md"` y `"$OUTPUT_DIR/RELEASE_NOTES.es.md"`
- `"$OUTPUT_DIR/RELEASE_NOTES.md"` y `"$OUTPUT_DIR/RELEASE_NOTES.es.md"`

Fuente única de verdad: `"$DIFF_FILE"`

Enfoque: actuar como mantenedor open-source explicando de forma clara qué trae la versión destacando las nuevas funcionalidades.

Contenido esperado:

- resumen general de la release
- nuevas funcionalidades destacadas
- mejoras relevantes
- correcciones importantes
- comandos nuevos enlazables en `RELEASE_NOTES.md`, si existen realmente en el diff
- cambios que afecten al uso del usuario
- eliminaciones importantes, si aplican
- cambios de seguridad visibles en el diff, si aplican

Reglas:

- no inventar funcionalidades ni beneficios
- no prometer comportamiento no verificable
- redactar en tono profesional y entendible
- priorizar valor para el usuario
- si existen comandos nuevos visibles en el diff, incluirlos en una sección específica
- si no existen comandos nuevos, no crear esa sección

Estructura sugerida:

```markdown
# Release Notes

## vX.Y.Z - Mes dd, yyyy {Funcionalidad más importante}

### Highlights

Debe resumir lo más importante de la release. Si hubiera alguna comando nuevo agregar un link. Por ejemplo : `nuevo comando [**"Gestionar archivos .gitignore"**](comando de ejecución vscode)

## Commands

Solo si se han creado nuevos comandos

### New Features

### Improvements

### Fixes

### Breaking Changes

(Solo debe aparecer si el diff evidencia un cambio rompedor)

### Securityç

(Solo debe aparecer si hay cambios reales de seguridad)
```

Reglas de secciones:

- omitir secciones vacías

Guardar resultado en: `"$OUTPUT_DIR/RELEASE_NOTES.md"`

## 6 Walkthrough

Si existen nuevas funcionalidades o comandos en la versión, actualizar:

`docs/walkthrough_en.md` y `docs/walkthrough_es.md`


---

Preguntar al usuario si la documentación generada es correcta antes de continuar con cualquier paso posterior.
