---
description: CHANGELOG & RELEASE
---

# Flujo de IA – Preparación de Release

Este flujo valida el estado del repositorio y genera la documentación de una nueva versión.

El proceso debe ejecutarse **de forma secuencial**.  
Si algún paso falla, **detener el flujo inmediatamente**.

# 1. Validar el estado del repositorio

Ejecutar todas las comprobaciones para asegurar que el proyecto está en un estado correcto.

## 1.1 Ejecutar lint del código

```bash
npm run lint
```

## 1.2 Compilar el proyecto

```bash
npm run compile
```

## 1.3 Ejecutar tests unitarios

```bash
npm run test
```

Si todos los comandos se ejecutan correctamente, continuar al siguiente paso.

# 2. Obtener contexto del repositorio

Extraer las variables necesarias para generar la release.

## Rama actual

```bash
RAMA_ACTUAL=$(git branch --show-current)
```

## Propietario y repositorio

```bash
REPOWN=$(git remote get-url origin \
  | sed -E 's#(git@github.com:|https://github.com/)##' \
  | sed 's/.git$//')
```

Ejemplo de salida:

```
owner/repositorio
```

## Última release publicada :

```bash
RELEASE_LATEST=$(gh release view --repo "$REPOWN" --json tagName --jq .tagName)
```

Ejemplo: `v1.4.2`

# 3. Generar el diff

Comparar la última release con la rama actual.

Crear variables de tiempo:

```bash
DATE=$(date +%d%m%Y)
TIME=$(date +%H%M%S)
```

Crear ruta de salida: `out_tmp/{release...rama_actual}/DATE/TIME/`

Ejemplo: `out_tmp/v1.4.2...main/14032026/104512/`

Generar archivo diff:

```bash
git diff "$RELEASE_LATEST...$RAMA_ACTUAL" > "out_tmp/${RELEASE_LATEST}...${RAMA_ACTUAL}/${DATE}/${TIME}/diffs.txt"
```

# 4. Analizar cambios

Archivo de entrada: `out_tmp/{release...rama_actual}/DATE/TIME/diffs.txt`

Analizar el diff para identificar:

- nuevas funcionalidades
- nuevos comandos que eran integrados en RELEASE_notes.md como un link
- mejoras
- correcciones de errores
- funcionalidades eliminadas
- cambios de seguridad

**Reglas**

- No inventar cambios.
- Solo utilizar información presente en el diff.

# 5. Generar documentación de la release

Actuar como un **mantenedor de proyectos open-source**.

A partir del análisis del diff, generar **dos documentos en Markdown**.

Directorio de salida:

```txt
out_tmp/{release...rama_actual}/DATE/TIME/
```

Ejemplo: `out_tmp/v1.4.2...main/14032026/104512/`

## 5.1 CHANGELOG.md (Inglés y Español)

Si ya existe copiar a la carpeta `out_tmp/{release...rama_actual}/DATE/TIME/` y agregar al principio.

Propósito: **historial técnico de la versión**

Formato: **Keep a Changelog**

Estructura:

```markdown
# Changelog

## [VERSION] - DATE

### Added

- Nuevas funcionalidades

### Changed

- Cambios en comportamiento existente

### Fixed

- Correcciones de errores

### Removed

- Funcionalidad eliminada o deprecada

### Security

- Cambios relacionados con seguridad
```

Reglas:

- lenguaje técnico y conciso
- evitar texto de marketing
- no inventar cambios
- formato Markdown limpio

## 5.2 RELEASE_NOTES.md (Inglés y Español)

Propósito: **explicación de la release para usuarios**

El archivo siempre debe comenzar con esta cabecera:

Después incluir las siguientes secciones (inglés y español):

```markdown
# {Funcionalidad más importante} - vX.Y.Z

_Fecha de lanzamiento: Mes dd, yyyy_

### Resume

En el resumen de las funcionalidades más importante si hubiera alguna comando nuevo agregar un link. Por ejemplo : `nuevo comando [**"Gestionar archivos .gitignore"**](comando de ejecución vscode)

### Highlights

Principales novedades de la versión.

### Improvements

Mejoras sobre funcionalidades existentes.

### Bug Fixes

Errores corregidos.

### Migration Notes (opcional)

Cambios importantes que los usuarios deben conocer.
```

Reglas:

- lenguaje claro y fácil de leer
- enfocado en el impacto para el usuario
- enlazar comandos o funcionalidades si aplica
- formato Markdown limpio
- no agregar ningún agradecimiento

---

## 5.3. Generar Mensaje de Pull Request y merge commit apartir del diff.txt guardar en :

out_tmp/{release...rama_actual}/DATE/TIME/pr&merge.txt con :

Titulo de PR
Body de PR

Titulo del merge commit
Body del merge commit


# 6. Revisión de documentación Walkthrough

Revisar las guías de uso del proyecto.

Si existen **nuevas funcionalidades o comandos** en la versión, actualizar los archivos:

```
docs/walkthrough_en.md
docs/walkthrough_es.md
```

---

# 7. Crear paquete VS Code (VSIX)

Generar el paquete de la extensión.

```bash
MY_VSIX_FILE="$(vsce package \
  | sed -n 's/^.*Packaged:[[:space:]]*//p' \
  | sed -E 's/(\.vsix).*/\1/' \
  | tail -n 1)"
```

Mostrar la ruta del paquete generado:

```bash
echo "Paquete creado en: $MY_VSIX_FILE"
```

Instalar la extensión localmente:

```bash
code --install-extension "$MY_VSIX_FILE"
```

## Reglas estrictas

1. Nunca inventar cambios.
2. Siempre usar el diff como fuente única de verdad.
3. Siempre generar ambos archivos:
   - `CHANGELOG.md`
   - `RELEASE_NOTES.md`

4. Incluir siempre:
   - versión `{VERSION}`
   - fecha `{DATE}`

5. La salida debe ser **Markdown válido**.

```

```
