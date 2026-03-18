---
description: CHANGELOG & RELEASE
---

# Flujo de IA – Preparación de Release

Este flujo valida el estado del repositorio y genera la documentación de una nueva versión.
El proceso debe ejecutarse de forma secuencial.
Si algún paso falla, detener el flujo inmediatamente.

---

# 1 Validar el estado del repositorio

Ejecutar comprobaciones para asegurar que el proyecto está en un estado correcto.

## 1.1 Lint

`npm run lint`

## 1.2 Compilación

`npm run compile`

## 1.3 Tests

`npm run test`

Si todo es correcto, continuar.

---

## 2 Obtener contexto del repositorio

### Rama actual

`RAMA_ACTUAL=$(git branch --show-current)`

### Propietario y repositorio

`REPOWN=$(git remote get-url origin | sed -E 's#(git@github.com:|https://github.com/)##' | sed 's/.git$//')`

Salida esperada: `owner/repositorio`

### Última release

`RELEASE_LATEST=$(gh release view --repo "$REPOWN" --json tagName --jq .tagName)`

Ejemplo: `v1.4.2`

---

## 3 Generar diff

### Variables de tiempo

`DATE=$(date +%d%m%Y)`
`TIME=$(date +%H%M%S)`

### Ruta de salida

`OUTPUT_DIR="out_tmp/${RELEASE_LATEST}...${RAMA_ACTUAL}/${DATE}/${TIME}"`

Ejemplo: `out_tmp/v1.4.2...main/14032026/104512/`

### Crear directorio

`mkdir -p "$OUTPUT_DIR"`

### Generar diff

`git diff "$RELEASE_LATEST...$RAMA_ACTUAL" > "$OUTPUT_DIR/diffs.txt"`

---

## 4 Analizar cambios

Archivo: `"$OUTPUT_DIR/diffs.txt"`

Identificar:

* nuevas funcionalidades
* nuevos comandos enlazables en `RELEASE_NOTES.md`
* mejoras
* correcciones
* eliminaciones
* cambios de seguridad

Reglas:

* no inventar cambios
* usar solo el diff

Guardar:

Archivo: `$OUTPUT_DIR/Analisis.txt`
Archivo: `$OUTPUT_DIR/Var_S1.txt` -> Variables actuales

Preguntar a usuario si el analisis es el correcto y esperar respuesta.

---

## 5 Generar documentación

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

* lenguaje técnico y conciso
* evitar texto de marketing
* no inventar cambios
* mantener Markdown limpio

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

* lenguaje claro y fácil de leer
* enfocado en impacto para el usuario
* enlazar comandos o funcionalidades si aplica
* no agregar agradecimientos
* mantener Markdown limpio

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

   * `CHANGELOG.md`
   * `RELEASE_NOTES.md`

4. Incluir siempre:

   * `{VERSION}`
   * `{DATE}`

5. La salida debe ser Markdown válido
