---
description: Prompt maestro para generar textos de PR y merge según transición de release
---

Actúa como generador de textos de Pull Request y Merge para un workflow de release.

## Fuentes permitidas

Está permitido leer únicamente:

- `"$VAR_S1_FILE"` para obtener variables reales del flujo
- `"$ANALYSIS_FILE"` como única fuente de verdad para el contenido funcional y técnico de los cambios

No está permitido usar ninguna otra fuente.

No está permitido:

- usar `"$DIFF_FILE"` directamente
- usar archivos actuales del proyecto
- usar historial conversacional
- inferir cambios no escritos explícitamente en `"$ANALYSIS_FILE"`
- inventar funcionalidades, impacto, alcance, riesgos o validaciones no reflejadas en el análisis
- usar nombres de rama como título
- generar títulos genéricos
- convertir dudas o ambigüedades en hechos

## Objetivo

Generar los textos de Pull Request y Merge para la transición actual del flujo.

La salida debe adaptarse automáticamente a uno de estos 4 casos:

### Caso A
`release/x.y → develop`

### Caso B
`develop → release/x.y+1.0`

### Caso C
`release/x.y.x → main`

### Caso D
`main → develop`

Debes detectar el caso exclusivamente a partir de:

- `CURRENT_BRANCH`
- `TARGET_BRANCH`
- `RELEASE_VERSION`

Si no puede determinarse el caso de forma inequívoca, abortar.

## Variables requeridas

Leer de `"$VAR_S1_FILE"` al menos:

- `OUTPUT_DIR`
- `CURRENT_BRANCH`
- `TARGET_BRANCH`
- `RELEASE_VERSION`

Para el **Caso C** además:

- `PR_NUMBER` → número del Pull Request de release (usado en el merge body como `#PR_NUMBER`)

Definir obligatoriamente:

- `PR_TITLE_FILE="$OUTPUT_DIR/PR_TITLE.txt"`
- `PR_FILE="$OUTPUT_DIR/PR.txt"`
- `MERGE_TITLE_FILE="$OUTPUT_DIR/MERGE_TITLE.txt"`
- `MERGE_FILE="$OUTPUT_DIR/merge.txt"`

## Reglas globales de salida

- `PR_TITLE.txt` debe contener una única línea
- `PR.txt` debe contener únicamente el body del Pull Request
- `MERGE_TITLE.txt` debe contener una única línea
- `merge.txt` debe contener únicamente el body del merge
- el título del PR no debe duplicarse dentro de `PR.txt`
- el título del merge no debe duplicarse dentro de `merge.txt`
- omitir secciones vacías
- mantener redacción clara, técnica y mantenible
- usar inglés técnico natural
- evitar lenguaje comercial o promocional

## Detección del caso

### Caso A · release → develop
Aplicar si:

- `CURRENT_BRANCH` cumple `^release/[0-9]+\.[0-9]+\.x$`
- `TARGET_BRANCH` es exactamente `develop`

### Caso B · develop → release
Aplicar si:

- `CURRENT_BRANCH` es exactamente `develop`
- `TARGET_BRANCH` cumple `^release/[0-9]+\.[0-9]+\.x$`

### Caso C · release → main
Aplicar si:

- `CURRENT_BRANCH` cumple `^release/[0-9]+\.[0-9]+\.x$`
- `TARGET_BRANCH` es exactamente `main`

### Caso D · main → develop
Aplicar si:

- `CURRENT_BRANCH` es exactamente `main`
- `TARGET_BRANCH` es exactamente `develop`

---

## Reglas específicas por caso

---

# Caso A · release/x.y → develop

Interpretación:
Este PR integra una rama release ya consolidada de vuelta hacia develop.
No debe sonar a feature aislada ni a publicación final.
Debe sonar a integración técnica de una release ya preparada.

### PR_TITLE
Construirlo a partir de los cambios principales de `"$ANALYSIS_FILE"`.
Debe sonar a integración técnica de release hacia develop.

Patrones permitidos:
- `Integrate release <CURRENT_BRANCH> into develop`
- `Merge release <CURRENT_BRANCH> back into develop`
- `Integrate release stabilization changes into develop`

Patrón recomendado:
- `Integrate release <CURRENT_BRANCH> into develop`

### PR_BODY
Formato recomendado:

```md
## Summary

This PR integrates the changes from `<CURRENT_BRANCH>` back into `develop`.

## Changes included

Incluir solo las secciones reales que existan en `"$ANALYSIS_FILE"`:

### Features
- ...

### Improvements
- ...

### Fixes
- ...

### Removals
- ...

### Security
- ...

## Notes
- Only notes explicitly supported by `"$ANALYSIS_FILE"`
```

### MERGE_TITLE
Debe sonar a integración técnica hacia develop.

Patrones permitidos:
- `Integrate release stabilization changes into develop`
- `Integrate release branch updates into develop`
- `Merge release changes back into develop`

Patrón recomendado:
- `Integrate release stabilization changes into develop`

### MERGE_BODY
Viñetas breves respaldadas por `"$ANALYSIS_FILE"`. Sin secciones markdown. Puede quedar vacío si no hay cambios clave adicionales.

```markdown
- key release stabilization change 1
- key integration update 2
- key fix or adjustment 3
```

---

# Caso B · develop → release/x.y+1.0

Interpretación:
Este PR no es una feature pura.
Es una consolidación de release.

### PR_TITLE
Debe dejar clarísimo que es preparación de versión.

Patrones permitidos:
- `Prepare release <RELEASE_VERSION>`
- `Prepare VSIX release <RELEASE_VERSION>`
- `Stabilize release <RELEASE_VERSION>`

Patrón recomendado:
- `Prepare release <RELEASE_VERSION>`

### PR_BODY
Debe estar orientado a preparación de release.

Formato recomendado:

```md
## Summary

This PR prepares release <RELEASE_VERSION> for publication.

## Included scope
- Final version alignment in package.json
- Release notes and changelog updates
- VSIX packaging adjustments
- Final fixes required for publication

## Changes included

Incluir únicamente las categorías reales que existan en `"$ANALYSIS_FILE"`:

### Features
- ...

### Improvements
- ...

### Fixes
- ...

### Removals
- ...

### Security
- ...

## Validation
- npm run lint
- npm run compile
- npm run test
- VSIX generated successfully
```

Notas:
- `Included scope` debe mantenerse como bloque fijo de orientación release
- `Changes included` debe reflejar únicamente cambios explícitos del análisis
- si no hay contenido suficiente para alguna categoría, omitirla

### MERGE_TITLE
Debe sonar a consolidación técnica de release.

Patrones permitidos:
- `Prepare release <RELEASE_VERSION> for publication`
- `Stabilize <RELEASE_VERSION> release for publication`
- `Consolidate release <RELEASE_VERSION> changes`

Patrón recomendado:
- `Prepare release <RELEASE_VERSION> for publication`

### MERGE_BODY
Breve y técnico, con viñetas compactas:

```markdown
- Final version alignment in package.json
- Release notes and changelog updates
- VSIX packaging adjustments
- Final fixes required for publication
```

Si el análisis aporta detalles técnicos adicionales relevantes, sustituir o complementar esas viñetas sin inventar información.

---

# Caso C · release/x.y.x → main

Interpretación:
Este PR representa la publicación oficial de la release.
Debe sonar a promoción o publicación final, no a preparación.
El merge commit tiene carácter editorial técnico: describe con precisión qué se publica, referencia el PR de release y acompaña bullets con los puntos clave.

### PR_TITLE
Debe dejar claro que esta release se publica en `main`.

Patrones permitidos:
- `Publish release <RELEASE_VERSION>`
- `Release <RELEASE_VERSION> to main`
- `Promote release <RELEASE_VERSION> to main`

Patrón recomendado:
- `Publish release <RELEASE_VERSION>`

### PR_BODY
Debe estar orientado a publicación final.

Formato recomendado:

```md
## Summary

This PR publishes release <RELEASE_VERSION> to `main`.

## Release highlights

Incluir solo bloques reales y relevantes de `"$ANALYSIS_FILE"`:

### Features
- ...

### Improvements
- ...

### Fixes
- ...

### Removals
- ...

### Security
- ...

## Release scope
- Final release branch promotion to main
- Publication-ready release contents
- VSIX artifact and documentation alignment
```

Notas:
- `Release scope` debe sonar a salida oficial
- no redactarlo como si todavía estuviera en preparación

### MERGE_TITLE
Debe sonar a publicación final de release.

Patrones permitidos:
- `Publish release <RELEASE_VERSION> to main`
- `Promote release <RELEASE_VERSION> to main`
- `Finalize release <RELEASE_VERSION> publication`

Patrón recomendado:
- `Publish release <RELEASE_VERSION> to main`

### MERGE_BODY
Formato **editorial técnico**: bullets con los puntos clave de la release más referencia al PR.

```markdown
- <punto clave 1 respaldado por "$ANALYSIS_FILE">
- <punto clave 2>
- <punto clave 3>

Closes #<PR_NUMBER>
```

Reglas:
- priorizar los cambios más relevantes del análisis (máximo 5 bullets)
- incluir siempre la línea `Closes #<PR_NUMBER>` al final, separada por una línea en blanco
- si `PR_NUMBER` no está disponible en `"$VAR_S1_FILE"`, incluir `Closes #<PR>` como marcador y notificar al usuario
- sin secciones markdown (`##`, `###`)
- sin metadatos de ramas, versión ni directorio fuera de los bullets

---

# Caso D · main → develop

Interpretación:
Este PR sincroniza main de vuelta hacia develop después de que una release ha sido publicada en main.
Su propósito es garantizar que develop no queda desactualizado respecto a los commits de merge y ajustes que ocurrieron directamente en main durante la publicación de la release.
No debe sonar a feature ni a publicación; debe sonar a sincronización técnica post-release.

> Para este caso no se requiere `"$ANALYSIS_FILE"` porque no hay nuevos cambios funcionales: el contenido del PR y el merge es fijo y depende exclusivamente de la versión.
> Si `"$ANALYSIS_FILE"` estuviera disponible y contuviera información relevante, puede usarse opcionalmente para enriquecer las viñetas del merge body.

### PR_TITLE
Debe dejar claro que es una sincronización post-release de main hacia develop.

Título fijo recomendado:
- `Sync main back into develop after release <RELEASE_VERSION>`

### PR_BODY
Formato recomendado:

```md
## Summary

This PR syncs `main` back into `develop` after release <RELEASE_VERSION> was published.

## Purpose

- Ensures `develop` includes the merge commits and post-release adjustments applied to `main`
- Keeps the development branch aligned with the published state of the project

## Notes

- No new functional changes are introduced by this PR
- This is a standard back-merge after a release publication
```

Notas:
- el contenido es fijo; no requiere análisis funcional adicional
- si hubiera alguna nota técnica real observable (p. ej. conflictos resueltos), añadirla en `Notes` sin inventar

### MERGE_TITLE
Debe sonar a back-merge técnico post-release.

Título fijo recomendado:
- `Back-merge main into develop after release <RELEASE_VERSION>`

### MERGE_BODY
Viñetas fijas técnicas:

```markdown
- Syncs main post-release state back into develop
- Includes merge commits from release <RELEASE_VERSION> publication
- Keeps develop aligned with the published project state
```

Reglas:
- sin secciones markdown (`##`, `###`)
- sin metadatos de ramas, versión ni directorio fuera de los bullets
- si hubiera conflictos relevantes resueltos, añadir una viñeta específica

---

## Criterio de selección del contenido

Tanto para PR como para merge:

- identificar todos los bloques de cambio principales del análisis
- ordenarlos por relevancia funcional o técnica
- seleccionar como máximo los 5 ejes más importantes
- agruparlos de forma natural
- omitir cambios secundarios si empeoran claridad
- no convertir el título en changelog
- no duplicar la misma idea entre título y body

## Escritura de ficheros

Crear o sobrescribir:

- `"$PR_TITLE_FILE"`
- `"$PR_FILE"`
- `"$MERGE_TITLE_FILE"`
- `"$MERGE_FILE"`

Abortar si no puede escribirse cualquiera de ellos.

## Resultado esperado

Mostrar:

- caso detectado (A / B / C / D)
- `CURRENT_BRANCH`
- `TARGET_BRANCH`
- `RELEASE_VERSION`
- contenido de `"$PR_TITLE_FILE"`
- contenido de `"$PR_FILE"`
- contenido de `"$MERGE_TITLE_FILE"`
- contenido de `"$MERGE_FILE"`

Mostrar además un resumen breve indicando:

- título del PR generado
- título del merge generado
- estilo aplicado según el caso detectado
- categorías incluidas realmente en base a `"$ANALYSIS_FILE"` (si aplica)

## Mapeo rápido

| Caso | Transición | PR title | Merge title |
|------|------------|----------|-------------|
| A | `release/x.y → develop` | Descriptivo desde análisis | `Integrate release stabilization changes into develop` |
| B | `develop → release/x.y+1.0` | `Prepare release <VERSION>` | `Prepare release <VERSION> for publication` |
| C | `release/x.y.x → main` | `Publish release <VERSION>` | `Publish release <VERSION> to main` + bullets + `Closes #PR` |
| D | `main → develop` | `Sync main back into develop after release <VERSION>` | `Back-merge main into develop after release <VERSION>` |
