---
description: Merge
---

## Creación de Pull Request y mergeo de release

Este paso es crítico y debe ejecutarse con validación estricta de ramas, orden de integración y fuentes permitidas.

### Objetivo

Crear y preparar los Pull Request necesarios para la integración de la release en dos fases obligatorias:

1. desde una rama `release/1.1.x` hacia `develop`
2. desde `develop` hacia `release`

Reglas generales:

- no está permitido alterar el orden de integración
- la primera integración debe ser siempre `release/1.1.x -> develop`
- la integración final debe ser siempre `develop -> release`
- el contenido del Pull Request debe provenir exclusivamente de `PR.txt`
- el contenido del merge debe provenir exclusivamente de `merge.txt`
- no está permitido regenerar manualmente el contenido del Pull Request o del merge en este paso
- no usar historial de conversación
- no usar otras fuentes distintas de las expresamente autorizadas en este paso

---

### 8.1 Validar rama actual y flujo de integración

Leer las variables necesarias del fichero autorizado del flujo.

Validar obligatoriamente:

- `CURRENT_BRANCH` existe y no está vacía
- `CURRENT_BRANCH` cumple exactamente la expresión `^release/1\.1\.[0-9]+$`
- `RELEASE_VERSION` existe y no está vacía

Reglas:

- no aceptar ramas como `main`, `master`, `feature/*`, `hotfix/*` o cualquier otra distinta de `release/1.1.x` en la primera fase
- la primera fase debe usar como rama origen una rama `release/1.1.x`
- la primera fase debe usar como rama destino exactamente `develop`
- la segunda fase debe usar como rama origen exactamente `develop`
- la segunda fase debe usar como rama destino exactamente `release`
- no está permitido saltar directamente desde `release/1.1.x` hacia `release`
- no está permitido crear primero el Pull Request `develop -> release` sin haber completado antes `release/1.1.x -> develop`

Abortar si:

- `CURRENT_BRANCH` no cumple la expresión `^release/1\.1\.[0-9]+$`
- falta cualquiera de los datos obligatorios
- el flujo de integración no respeta el orden establecido

---

## Fase 1: release/1.1.x -> develop

### 8.2 Fuente obligatoria para el Pull Request de fase 1

Está permitido leer únicamente:

- `"$PR_FILE"` como contenido del Pull Request
- `"$VAR_S1_FILE"` para validaciones de contexto y metadatos mínimos

No está permitido usar ninguna otra fuente para construir el Pull Request.

Reglas:

- el Pull Request debe usar como título y cuerpo exactamente el contenido ya generado en `"$PR_FILE"`
- no resumir de nuevo el análisis
- no rehacer el título
- no añadir bloques nuevos no presentes en `"$PR_FILE"`
- no modificar el contenido salvo ajustes estrictamente técnicos de formato si el sistema de creación del Pull Request lo exige
- si `"$PR_FILE"` no existe o está vacío, abortar

Abortar si:

- `"$PR_FILE"` no existe
- `"$PR_FILE"` está vacío
- no puede obtenerse un título y cuerpo válidos desde `"$PR_FILE"`

---

### 8.3 Crear Pull Request de fase 1

Objetivo:

Crear el Pull Request desde la rama actual `release/1.1.x` hacia `develop` utilizando exclusivamente el contenido de `"$PR_FILE"`.

Definir:

- rama origen: `CURRENT_BRANCH`
- rama destino: `develop`
- título: título definido en `"$PR_FILE"`
- cuerpo: resto del contenido de `"$PR_FILE"`

Reglas:

- no inventar título
- no inventar cuerpo
- no alterar la rama destino
- no crear el Pull Request contra otra rama distinta de `develop`
- si ya existe un Pull Request abierto con la misma rama origen y destino, no duplicarlo

Abortar si:

- no puede extraerse correctamente el título desde `"$PR_FILE"`
- no puede extraerse correctamente el cuerpo desde `"$PR_FILE"`
- no puede crearse el Pull Request
- ya existe un Pull Request abierto con la misma rama origen y destino

---

### 8.4 Fuente obligatoria para el merge de fase 1

Está permitido leer únicamente:

- `"$MERGE_FILE"` como fuente del mensaje de merge
- `"$VAR_S1_FILE"` para validaciones mínimas de contexto

No está permitido usar ninguna otra fuente.

Reglas:

- el mensaje de merge debe provenir exclusivamente de `"$MERGE_FILE"`
- no reinterpretar el análisis en este paso
- no rehacer el mensaje manualmente
- si `"$MERGE_FILE"` no existe o está vacío, abortar

Abortar si:

- `"$MERGE_FILE"` no existe
- `"$MERGE_FILE"` está vacío
- no puede obtenerse un mensaje de merge válido desde `"$MERGE_FILE"`

---

### 8.5 Mergear fase 1

Objetivo:

Ejecutar el merge del Pull Request aprobado desde `release/1.1.x` hacia `develop` usando el mensaje definido en `"$MERGE_FILE"`.

Reglas:

- no mergear directamente la rama sin Pull Request
- no cambiar la rama destino
- usar exclusivamente el mensaje definido en `"$MERGE_FILE"`
- no inventar texto adicional para el merge
- no ejecutar el merge si el Pull Request no está aprobado o no cumple las condiciones del flujo

Abortar si:

- el Pull Request no existe
- el Pull Request no está listo para merge
- no puede aplicarse correctamente el contenido de `"$MERGE_FILE"`
- no puede ejecutarse el merge contra `develop`

---

## Fase 2: develop -> release

### 8.6 Validar paso previo obligatorio

Antes de iniciar esta fase, validar que la fase 1 se ha completado correctamente.

Reglas:

- no iniciar esta fase si no se ha creado el Pull Request `release/1.1.x -> develop`
- no iniciar esta fase si no se ha completado el merge hacia `develop`
- la fase 2 depende obligatoriamente de la finalización correcta de la fase 1

Abortar si:

- la fase 1 no está completada
- no existe evidencia válida del merge previo hacia `develop`

---

### 8.7 Crear Pull Request de fase 2

Objetivo:

Crear el Pull Request final desde `develop` hacia `release`.

Fuente permitida:

- `"$PR_FILE"` como base obligatoria del contenido del Pull Request
- `"$VAR_S1_FILE"` para contexto mínimo

Reglas:

- el Pull Request debe representar la integración final de `develop` en `release`
- reutilizar el contenido de `"$PR_FILE"` solo si sigue siendo válido para esta fase
- si el contenido necesita ajuste de enfoque por tratarse de integración final, dicho ajuste debe estar explícitamente permitido por el workflow
- si el flujo exige reutilización literal, mantener el contenido sin reinterpretarlo
- no usar otras fuentes

Abortar si:

- no puede obtenerse contenido válido para el Pull Request final
- no puede crearse el Pull Request `develop -> release`

---
