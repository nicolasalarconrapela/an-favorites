---
description: Generación de contenido de Pull Request y Merge Request desde Analisis.txts
---

# Pull Request y Merge Request

## Pull Request

Está permitido leer `"$VAR_S1_FILE"` únicamente para obtener variables necesarias de este paso.

Está permitido leer `"$ANALYSIS_FILE"` únicamente como fuente de verdad para el contenido funcional y técnico de este paso.

No está permitido usar ninguna otra fuente.

Objetivo:

Generar `PR.txt` dentro de `"$OUTPUT_DIR"` usando exclusivamente `"$ANALYSIS_FILE"` como fuente de verdad para el contenido de cambios.

`PR.txt` debe estar orientado a revisión funcional y técnica. Su propósito es explicar con claridad qué cambios relevantes introduce el Pull Request y agrupar correctamente el conjunto del trabajo realizado.

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
- `"$ANALYSIS_FILE"` no contiene información utilizable para redactar `PR.txt`

---

### 5.3 Generar borrador de PR.txt

Objetivo:

Crear el contenido textual del Pull Request orientado a revisión funcional y técnica, siguiendo una estructura habitual en proyectos Open Source.

`PR.txt` debe explicar qué introduce el Pull Request y cómo se agrupan los cambios principales dentro del conjunto del trabajo.

Formato de salida requerido para `PR.txt`:

```markdown
(Título) Frase breve en inglés que resuma 1 o 2 cambios funcionales o técnicos relevantes y que represente el conjunto del Pull Request

(Cuerpo)

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
````

#### Reglas para el título del PR

- no usar como título `release: merge <CURRENT_BRANCH> into <TARGET_BRANCH>`
- no usar nombres de rama como título
- no usar títulos genéricos como `Update project`, `Misc fixes` o equivalentes
- el título debe representar el conjunto del Pull Request, no un detalle menor
- debe englobar preferentemente 1 o 2 cambios funcionales o técnicos importantes reflejados en `"$ANALYSIS_FILE"`
- si existe una funcionalidad dominante, priorizarla
- si existen dos bloques estrechamente relacionados, pueden aparecer juntos
- no listar más de dos ejes principales
- si no hay un eje dominante claro, usar un título agrupador basado en el objetivo principal del conjunto
- no inventar funcionalidades, impacto ni alcance
- redactar el título en inglés técnico natural y mantenible
- evitar lenguaje comercial o promocional
- evitar prefijos automáticos como `feat:`, `fix:` o `chore:` salvo exigencia explícita
- priorizar estructuras del tipo:

  - verbo + objeto principal
  - verbo + objeto principal + and + segundo eje relacionado
- el título debe ser conciso
- no debe sonar a merge ni a commit interno
- no debe superar 90 caracteres salvo necesidad justificada

#### Criterio de selección del título

- identificar primero el bloque de cambio más relevante
- identificar después, solo si aporta contexto real, un segundo cambio estrechamente relacionado
- construir el título agrupando ambos bajo una única intención clara
- si el segundo cambio no aporta claridad, usar solo el principal
- si no existe bloque dominante claro, usar un título agrupador que represente el objetivo principal del conjunto

#### Reglas para el cuerpo del PR

- no inventar cambios
- no añadir lenguaje comercial o promocional
- no añadir impacto no verificado
- no añadir checklist de QA no respaldado por el análisis
- no añadir riesgos, breaking changes o migraciones si no aparecen explícitamente
- redactar de forma profesional, clara y revisable
- priorizar frases cortas y directas
- usar listas con verbos de cambio concretos
- omitir secciones vacías
- no enfocar este documento como guía de integración
- evitar frases tipo `after merge`, `post-merge`, `once integrated` salvo que aparezcan explícitamente en el análisis
- `Summary` debe resumir el propósito global sin repetir literalmente el título
- `Changes included` debe recoger el detalle organizado por categorías reales del análisis
- `Commands added or updated` solo debe aparecer si el análisis contiene comandos nuevos o modificados
- `Notes` solo debe aparecer si existen observaciones explícitas y útiles
- no crear bloques vacíos
- no repetir la misma idea en varias secciones
- no convertir hipótesis del análisis en afirmaciones

Abortar si:

- no puede generarse un título fiel al análisis
- no puede generarse un contenido fiel al análisis

---

### 5.4 Escribir PR.txt

Crear o sobrescribir `"$PR_FILE"` con el contenido generado.

Abortar si:

- no puede escribirse `"$PR_FILE"`

---

### 5.5 Resultado de PR

Mostrar:

- `"$PR_FILE"`

Mostrar además un resumen breve indicando:

- título del Pull Request generado
- rama origen
- rama destino
- directorio de salida utilizado
- categorías incluidas realmente en base a `"$ANALYSIS_FILE"`

---

## Merge

Está permitido leer `"$VAR_S1_FILE"` únicamente para obtener variables necesarias de este paso.

Está permitido leer `"$ANALYSIS_FILE"` únicamente como fuente de verdad para el contenido funcional y técnico de este paso.

No está permitido usar ninguna otra fuente.

Objetivo:

Generar `merge.txt` dentro de `"$OUTPUT_DIR"` usando exclusivamente `"$ANALYSIS_FILE"` como fuente de verdad para el contenido de cambios.

`merge.txt` debe ser ultra compacto y orientado a integración técnica de release.
Su propósito es resumir en una sola frase el alcance técnico más importante de la release y acompañarlo, si aplica, con viñetas breves de apoyo.

Las variables del flujo solo podrán utilizarse para metadatos estrictamente necesarios. Queda prohibido inferir cambios desde otras fuentes.

### 6.1 Validar directorio de salida de merge

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

- `MERGE_FILE="$OUTPUT_DIR/merge.txt"`

Acción:

`mkdir -p "$OUTPUT_DIR"`

Abortar si:

- `OUTPUT_DIR` no existe o está vacío
- `CURRENT_BRANCH` no existe o está vacío
- `RELEASE_VERSION` no existe o está vacío
- no puede crearse `"$OUTPUT_DIR"`

---

### 6.2 Leer análisis para merge

Leer `"$ANALYSIS_FILE"` y usarlo como única fuente de verdad para identificar exclusivamente:

- nuevas funcionalidades
- mejoras
- correcciones
- eliminaciones
- cambios de seguridad
- comandos nuevos o modificados enlazables en la documentación, si aparecen reflejados

Reglas:

- no usar `"$DIFF_FILE"`
- no usar archivos actuales del proyecto
- no usar historial de conversación
- no inferir cambios no escritos explícitamente en `"$ANALYSIS_FILE"`
- omitir categorías vacías
- no convertir dudas o ambigüedades en hechos

Abortar si:

- `"$ANALYSIS_FILE"` no existe
- `"$ANALYSIS_FILE"` está vacío
- `"$ANALYSIS_FILE"` no contiene información utilizable para redactar `merge.txt`

---

### 6.3 Generar borrador de merge.txt

Objetivo:

Crear un contenido de merge ultra compacto y técnico basado exclusivamente en `"$ANALYSIS_FILE"`.

El resultado debe tener formato de mensaje breve de integración de release, no de commit tipado ni de documento descriptivo.

Formato de salida requerido para `merge.txt`:

Primera línea:
frase técnica breve en inglés que englobe los cambios más importantes de la release

Cuerpo:
viñetas breves con los cambios clave, solo si están claramente respaldados por `"$ANALYSIS_FILE"`

Reglas para la primera línea:

- no usar prefijos como `feat:`, `fix:`, `chore:`, `refactor:` o equivalentes
- no usar formato `type(scope): descripción`
- debe ser una frase técnica natural y mantenible
- debe englobar el cambio principal o, como máximo, los 2 ejes más relevantes de la release
- debe representar el conjunto del merge, no un detalle menor
- debe estar redactada en inglés técnico natural
- debe ser concisa
- no debe sonar a título comercial ni promocional
- no debe sonar a nombre de rama
- no debe enumerar demasiados cambios
- no debe incluir punto final
- no debe superar 100 caracteres salvo necesidad justificada por el análisis
- si existe un cambio dominante claro, priorizarlo
- si existen dos bloques estrechamente relacionados, pueden agruparse en la misma frase
- si no existe un eje dominante claro, construir una frase agrupadora basada en el objetivo técnico principal del conjunto

Reglas para el cuerpo:

- el cuerpo es opcional
- si se incluye, debe contener solo viñetas con cambios reales respaldados por `"$ANALYSIS_FILE"`
- cada viñeta debe ser breve, directa y basada en hechos
- no duplicar literalmente la primera línea
- no añadir secciones markdown como `##`, `###`, `Summary` o similares
- no añadir metadatos como versión, ramas o directorio dentro de `merge.txt`
- no añadir validaciones, riesgos, impacto, dependencias ni contexto no explícito
- no inventar categorías ni cambios
- no crear viñetas vacías
- mantener el contenido ultra compacto
- usar una idea por línea
- comenzar cada viñeta con `- `

Criterio de construcción de la primera línea:

- identificar el bloque de cambio más relevante del análisis
- identificar, solo si aporta contexto real, un segundo bloque estrechamente relacionado
- construir una frase agrupadora que represente la integración técnica de la release
- si el segundo bloque no aporta claridad, usar solo el principal
- evitar frases genéricas como `Update release contents`, `Apply several improvements` o equivalentes

Abortar si:

- no puede generarse una primera línea fiel al análisis
- si se incluye cuerpo, no puede generarse al menos una viñeta respaldada por `"$ANALYSIS_FILE"`

### 6.4 Escribir merge.txt

Crear o sobrescribir `"$MERGE_FILE"` con el contenido generado.

Abortar si:

- no puede escribirse `"$MERGE_FILE"`


Detener el flujo.
