---
description: Release - Textos de PR
---

# Textos de PR

## Pull Request

Está permitido leer `"$VAR_S1_FILE"` únicamente para obtener variables necesarias de este paso.

Está permitido leer `"$ANALYSIS_FILE"` únicamente como fuente de verdad para el contenido funcional y técnico de este paso.

No está permitido usar ninguna otra fuente.

Objetivo:

Generar `PR_TITLE.txt` y `PR.txt` dentro de `"$OUTPUT_DIR"` usando exclusivamente `"$ANALYSIS_FILE"` como fuente de verdad para el contenido de cambios.

- `PR_TITLE.txt` debe contener únicamente el título del Pull Request
- `PR.txt` debe contener únicamente el cuerpo del Pull Request

El contenido debe estar orientado a revisión funcional y técnica. Su propósito es explicar con claridad qué cambios relevantes introduce el Pull Request y agrupar correctamente el conjunto del trabajo realizado.

Las variables del flujo solo podrán utilizarse para metadatos estrictamente necesarios como ramas, versión y nombres de archivo. Queda prohibido inferir cambios desde otras fuentes.

### 5.1 Validar directorio de salida de PR

Leer `"$VAR_S1_FILE"` para obtener:

- `OUTPUT_DIR`
- `CURRENT_BRANCH`
- `TARGET_BRANCH`
- `RELEASE_VERSION`

Reglas:

- no inventar variables
- `OUTPUT_DIR` debe venir definido desde pasos anteriores
- si `TARGET_BRANCH` no existe, usar literalmente `develop`

Definir:

- `PR_TITLE_FILE="$OUTPUT_DIR/PR_TITLE.txt"`
- `PR_FILE="$OUTPUT_DIR/PR.txt"`

Acción:

`mkdir -p "$OUTPUT_DIR"`

Abortar si:

- `OUTPUT_DIR` no existe o está vacío
- `CURRENT_BRANCH` no existe o está vacío
- `RELEASE_VERSION` no existe o está vacío
- no puede crearse `"$OUTPUT_DIR"`

### 5.2 Leer análisis para PR

Leer `"$ANALYSIS_FILE"` y usarlo como única fuente de verdad para identificar exclusivamente:

- nuevas funcionalidades
- mejoras
- correcciones
- eliminaciones
- cambios de seguridad
- comandos nuevos o modificados enlazables en la documentación, si aparecen reflejados
- notas técnicas explícitas relevantes para la revisión del Pull Request

Reglas:

- no usar `"$DIFF_FILE"`
- no usar archivos actuales del proyecto
- no usar historial de conversación
- no inferir cambios no escritos explícitamente en `"$ANALYSIS_FILE"`
- omitir categorías vacías
- no convertir dudas o ambigüedades en hechos
- centrar el contenido en lo que cambia dentro del Pull Request
- no tratar este paso como guía de integración o post-merge

Abortar si:

- `"$ANALYSIS_FILE"` no existe
- `"$ANALYSIS_FILE"` está vacío
- `"$ANALYSIS_FILE"` no contiene información utilizable para redactar `PR_TITLE.txt` o `PR.txt`

---

### 5.3 Generar borrador de PR_TITLE.txt y PR.txt

Objetivo:

Crear el contenido textual del Pull Request orientado a revisión funcional y técnica, siguiendo una estructura habitual en proyectos Open Source.

`PR_TITLE.txt` debe contener únicamente el título del Pull Request.

`PR.txt` debe explicar qué introduce el Pull Request y cómo se agrupan los cambios principales dentro del conjunto del trabajo.

Separación obligatoria de salida:

- `PR_TITLE.txt` debe contener una única línea con el título del Pull Request
- `PR.txt` debe contener únicamente el cuerpo del Pull Request
- el título no debe escribirse dentro de `PR.txt`
- el cuerpo no debe duplicar literalmente el título
- si el Pull Request se crea mediante un comando con `--title` y `--body-file`, cada fichero debe contener exclusivamente su parte correspondiente

Formato de salida requerido para `PR_TITLE.txt`:

```text
Frase breve en inglés que represente el conjunto del Pull Request
````

Formato de salida requerido para `PR.txt`:

```markdown
## Summary

Breve resumen neutral del propósito del Pull Request, redactado exclusivamente a partir de `"$ANALYSIS_FILE"`.

## Changes included

Incluir solo las secciones que existan realmente en `"$ANALYSIS_FILE"`:

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

## Commands added or updated

- ...

## Notes

- Solo observaciones respaldadas explícitamente por `"$ANALYSIS_FILE"` y relevantes para la revisión del Pull Request
```

#### Reglas para `PR_TITLE.txt`

* no usar como título `release: merge <CURRENT_BRANCH> into <TARGET_BRANCH>`
* no usar nombres de rama como título
* no usar títulos genéricos como `Update project`, `Misc fixes`, `Several improvements` o equivalentes
* el título debe representar el conjunto del Pull Request, no un detalle menor
* el título debe construirse a partir de los cambios principales reflejados en `"$ANALYSIS_FILE"`
* el título debe agrupar los cambios más importantes del análisis, con un máximo de 5 ejes principales
* no debe convertirse en una enumeración mecánica de cambios
* debe priorizar los bloques funcionales o técnicos más relevantes y representativos del conjunto
* si existe un cambio claramente dominante, debe liderar el título
* si existen varios cambios principales relacionados, deben agruparse de forma natural bajo una intención común
* si el análisis contiene muchos cambios heterogéneos, seleccionar únicamente los más importantes, con un máximo de 5
* no inventar funcionalidades, impacto ni alcance
* redactar el título en inglés técnico natural y mantenible
* evitar lenguaje comercial o promocional
* evitar prefijos automáticos como `feat:`, `fix:` o `chore:` salvo exigencia explícita
* priorizar estructuras del tipo:

  * verbo + objeto principal
  * verbo + objeto principal + and + segundo bloque agrupado
  * verbo + área principal + with + principales mejoras agrupadas
* el título debe ser conciso
* no debe sonar a merge ni a commit interno
* no debe superar 120 caracteres salvo necesidad justificada
* `PR_TITLE.txt` debe contener una única línea y sin bloque markdown

#### Criterio de selección del título

* identificar todos los bloques de cambio principales del análisis
* ordenarlos por relevancia funcional o técnica
* seleccionar como máximo los 5 cambios más importantes
* agruparlos en una única intención clara y natural
* si algunos cambios son secundarios o redundantes respecto a otro bloque mayor, omitirlos
* si el título pierde claridad por exceso de información, reducir el número de ejes hasta mantener una frase legible
* el título debe resumir el conjunto, no actuar como changelog

#### Reglas para `PR.txt`

* `PR.txt` debe contener únicamente el cuerpo del Pull Request
* no debe incluir el título del Pull Request en la primera línea ni en ninguna otra parte salvo que aparezca citado de forma estrictamente necesaria
* si el Pull Request se crea con `--title`, `PR.txt` debe comenzar directamente por `## Summary`
* queda prohibido duplicar el título dentro del body
* no inventar cambios
* no añadir lenguaje comercial o promocional
* no añadir impacto no verificado
* no añadir checklist de QA no respaldado por el análisis
* no añadir riesgos, breaking changes o migraciones si no aparecen explícitamente
* redactar de forma profesional, clara y revisable
* priorizar frases cortas y directas
* usar listas con verbos de cambio concretos
* omitir secciones vacías
* no enfocar este documento como guía de integración
* evitar frases tipo `after merge`, `post-merge`, `once integrated` salvo que aparezcan explícitamente en el análisis
* `Summary` debe resumir el propósito global sin repetir literalmente el título
* `Changes included` debe recoger el detalle organizado por categorías reales del análisis
* `Commands added or updated` solo debe aparecer si el análisis contiene comandos nuevos o modificados
* `Notes` solo debe aparecer si existen observaciones explícitas y útiles
* no crear bloques vacíos
* no repetir la misma idea en varias secciones
* no convertir hipótesis del análisis en afirmaciones

Abortar si:

* no puede generarse un título fiel al análisis
* no puede generarse un cuerpo fiel al análisis
* `PR_TITLE.txt` contiene más de una línea
* `PR.txt` incluye el título del Pull Request dentro del body

---

### 5.4 Escribir PR_TITLE.txt y PR.txt

Crear o sobrescribir:

* `"$PR_TITLE_FILE"`
* `"$PR_FILE"`

Abortar si:

* no puede escribirse `"$PR_TITLE_FILE"`
* no puede escribirse `"$PR_FILE"`

---

### 5.5 Resultado de PR

Mostrar:

* `"$PR_TITLE_FILE"`
* `"$PR_FILE"`

Mostrar además un resumen breve indicando:

* título del Pull Request generado
* rama origen
* rama destino
* directorio de salida utilizado
* categorías incluidas realmente en base a `"$ANALYSIS_FILE"`

