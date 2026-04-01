---
description: Version bump, rama y commit · Caso B (develop → releases/1.X.0)
---
## Paso anterior

- [7. Generación de textos de Merge](.agent/workflows/Caso%20B/7.md)

---

# Version bump, rama y commit

Este paso continúa el flujo anterior.  
Usar el contexto generado en el workflow previo.  
Continuar con las variables generadas en el paso anterior.

Este paso es crítico. Cada acción requiere confirmación explícita del usuario antes de ejecutarse.  
Si cualquier validación falla → ABORTAR inmediatamente.

---

## Fuente única de variables

Está permitido leer `"$VAR_S1_FILE"` únicamente para obtener las variables necesarias de este paso.

`"$VAR_S1_FILE"` es la única fuente válida para variables de este workflow.

Queda prohibido:

- inventar variables
- redefinir variables manualmente
- usar historial conversacional
- usar valores recordados de pasos anteriores si no están en `"$VAR_S1_FILE"`
- corregir automáticamente valores aunque parezcan inconsistentes

Si `"$VAR_S1_FILE"` no existe, no puede leerse o no contiene una variable obligatoria, detener el flujo e informar del bloqueo.

---

## Variables requeridas

Leer de `"$VAR_S1_FILE"`:

- `CURRENT_BRANCH` → debe ser exactamente `develop`
- `VERSION_ACTUAL` → versión actual en `package.json` (ej. `1.2.5`)
- `RELEASE_VERSION` → versión objetivo calculada (ej. `1.3.0`)
- `TARGET_BRANCH` → rama destino calculada (ej. `releases/1.3.0`)
- `RELEASE_LATEST` → último tag/release existente que servirá como base real para crear la rama
- `OUTPUT_DIR`
- `VAR_S1_FILE`

---

## B.0 Verificación de idempotencia

Objetivo:

Comprobar si el bump de versión ya fue realizado en un paso anterior para no repetirlo.

Ejecuta las siguientes comprobaciones --sin solicitar confirmación al usuario-- y --sin modificar ningún archivo--:

```bash
git log --oneline -1
````

```bash
grep '"version"' package.json
```

Condición de salto:

Si se cumplen --todas-- las condiciones siguientes simultáneamente:

- el último commit (`git log --oneline -1`) contiene exactamente el mensaje `chore: bump version to <RELEASE_VERSION>`
- `package.json` contiene exactamente `"version": "<RELEASE_VERSION>"`

Entonces:

- informar al usuario: `⚠️ El bump de versión ya estaba aplicado. package.json y el último commit coinciden con <RELEASE_VERSION>. Se omiten los pasos B.1, B.2 y B.3.`
- continuar directamente en --B.4-- (Crear rama de release)
- no ejecutar ningún comando de modificación de `package.json`
- no crear un nuevo commit
- no preguntar confirmación adicional para saltar al B.4

Si --no-- se cumplen todas las condiciones simultáneamente:

- continuar normalmente en --B.1-- (Previsualización)
- no omitir ningún paso

---

## B.1 Previsualización de operaciones

Objetivo:

Mostrar al usuario la secuencia exacta de operaciones que se realizarán antes de ejecutar ninguna.

Acción (solo lectura, sin ejecutar nada):

- leer `CURRENT_BRANCH` desde `"$VAR_S1_FILE"`
- leer `VERSION_ACTUAL` desde `"$VAR_S1_FILE"`
- leer `RELEASE_VERSION` desde `"$VAR_S1_FILE"`
- leer `TARGET_BRANCH` desde `"$VAR_S1_FILE"`
- leer `RELEASE_LATEST` desde `"$VAR_S1_FILE"`

Mostrar la previsualización:

```text
Operaciones previstas (en este orden):
  1. Bump de versión en package.json:
       "version": "<VERSION_ACTUAL>" → "version": "<RELEASE_VERSION>"
  2. Commit del bump:
       chore: bump version to <RELEASE_VERSION>
  3. Publicar el commit del bump en develop:
       git push origin develop
  4. Crear rama de release desde el commit del último tag:
       git branch <TARGET_BRANCH> <RELEASE_LATEST>^{commit}
  5. Publicar rama en origin:
       git push -u origin <TARGET_BRANCH>

  - Rama actual:     develop
  - Versión actual:  <VERSION_ACTUAL>
  - Versión nueva:   <RELEASE_VERSION>
  - Rama destino:    <TARGET_BRANCH>
  - Tag base real:   <RELEASE_LATEST>
```

Abortar si:

- `CURRENT_BRANCH` no es exactamente `develop`
- `VERSION_ACTUAL` está vacía o no sigue el patrón `X.Y.Z`
- `RELEASE_VERSION` está vacía o no sigue el patrón `X.Y.Z`
- `TARGET_BRANCH` está vacío o no cumple `^releases/1\.[0-9]+\.0$`
- `RELEASE_LATEST` está vacío

Salida requerida:

- mostrar la previsualización completa
- indicar explícitamente que no se ha ejecutado ningún comando
- preguntar al usuario si confirma todas las operaciones
- esperar autorización explícita antes de continuar

---

## B.2 Actualizar versión en package.json

Objetivo:

Actualizar el campo `version` en `package.json` con el valor de `RELEASE_VERSION`.

Reglas:

- solo está permitido modificar el campo `"version"` en `package.json`
- no modificar ningún otro archivo
- no ejecutar este paso sin autorización explícita del usuario obtenida en B.1

Comando permitido:

```bash
sed -i "s/\"version\": \"${VERSION_ACTUAL}\"/\"version\": \"${RELEASE_VERSION}\"/" package.json
```

Verificación requerida tras la ejecución:

```bash
grep '"version"' package.json
```

La salida debe mostrar exactamente `"version": "<RELEASE_VERSION>"`.

Abortar si:

- el comando falla
- `package.json` no contiene el nuevo valor tras la ejecución
- el valor resultante no coincide exactamente con `RELEASE_VERSION`

Salida requerida:

- mostrar el resultado de la verificación
- confirmar que `package.json` contiene la versión correcta
- preguntar al usuario si confirma el commit

---

## B.3 Commit del bump de versión

Objetivo:

Realizar el commit del cambio de versión en `package.json`.

Reglas:

- solo se incluirá `package.json` en el commit
- no hacer stage de ningún otro archivo
- no ejecutar este paso sin autorización explícita del usuario
- el mensaje de commit es fijo y no puede modificarse

Comandos permitidos (uno por vez, cada uno con autorización previa):

```bash
git add package.json
```

```bash
git commit -m "chore: bump version to <RELEASE_VERSION>"
```

Abortar si:

- `git add` falla
- `git commit` falla
- el commit no aparece en `git log --oneline -1`
- se intenta encadenar más de un comando a la vez
- se intenta ejecutar sin autorización explícita

Salida requerida:

- tras `git add`: confirmar que `package.json` está en stage
- tras `git commit`: mostrar la salida del commit y `git log --oneline -1`
- preguntar al usuario si desea continuar con la creación de la rama

---

## B.3.1 Publicar commit del bump en la rama actual

Objetivo:

Publicar en `origin` el commit `chore: bump version to <RELEASE_VERSION>` para alinear la rama actual antes de crear la rama de release.

Reglas:

- no ejecutar este paso sin autorización explícita del usuario
- validar antes del push que no existen cambios locales pendientes
- el push debe hacerse únicamente sobre `CURRENT_BRANCH`

Comandos permitidos:

```bash
git status --short
```

```bash
git push origin "${CURRENT_BRANCH}"
```

Abortar si:

- `git status --short` muestra cambios pendientes
- `git push origin "${CURRENT_BRANCH}"` falla

Salida requerida:

- mostrar el estado previo del repositorio
- mostrar la salida del push
- confirmar que la rama actual quedó alineada con origin
- preguntar al usuario si desea continuar con la creación de la rama

---

## B.4 Crear rama de release

Objetivo:

Crear la rama `TARGET_BRANCH` localmente a partir del commit referenciado por el tag `RELEASE_LATEST`.

Reglas críticas:

- no ejecutar este paso sin autorización explícita del usuario
- `RELEASE_LATEST` debe existir y haberse obtenido en el paso previo
- el tag `RELEASE_LATEST` debe existir en git
- la rama `TARGET_BRANCH` debe crearse desde el commit del tag `RELEASE_LATEST`, no desde `HEAD`
- si en B.3 se creó el commit `chore: bump version to <RELEASE_VERSION>`, ese commit no debe usarse como base para la rama
- no cambiarse de rama
- no ejecutar ningún otro comando adicional

Comandos permitidos:

Verificación previa obligatoria del tag:

```bash
git rev-parse --verify "refs/tags/${RELEASE_LATEST}"
```

Creación de la rama desde el commit del tag:

```bash
git branch "${TARGET_BRANCH}" "${RELEASE_LATEST}^{commit}"
```

Verificación requerida:

```bash
git branch --list "${TARGET_BRANCH}"
```

```bash
git rev-parse "${TARGET_BRANCH}^{commit}"
```

```bash
git rev-parse "${RELEASE_LATEST}^{commit}"
```

La verificación final debe demostrar que:

- la rama `${TARGET_BRANCH}` existe
- el commit de `${TARGET_BRANCH}` coincide exactamente con el commit de `${RELEASE_LATEST}`

Abortar si:

- `RELEASE_LATEST` no existe o está vacío
- el tag `RELEASE_LATEST` no existe en git
- el comando `git branch "${TARGET_BRANCH}" "${RELEASE_LATEST}^{commit}"` falla
- la rama no aparece en `git branch --list` tras la ejecución
- el commit de `TARGET_BRANCH` no coincide exactamente con el commit del tag `RELEASE_LATEST`

Salida requerida:

- mostrar el tag base utilizado: `RELEASE_LATEST`
- mostrar confirmación de que la rama fue creada desde el commit del tag
- mostrar ambos commits comparados en la verificación
- preguntar al usuario si desea publicar la rama en origin

---

## B.5 Publicar rama en origin

Objetivo:

Publicar la rama `TARGET_BRANCH` en el repositorio remoto y configurar el tracking.

Regla crítica:

- no ejecutar sin autorización explícita del usuario
- solo ejecutar si B.4 completó correctamente

Comando permitido:

```bash
git push -u origin <TARGET_BRANCH>
```

Verificación requerida:

- la salida del comando debe confirmar que la rama fue publicada en origin con tracking configurado

Abortar si:

- el comando falla
- la salida no confirma la publicación en origin
- se intenta modificar ningún otro comando ni agregar argumentos adicionales

Salida requerida:

- mostrar la salida del push
- confirmar que la rama `TARGET_BRANCH` está en origin con tracking configurado
- preguntar al usuario si desea continuar al siguiente paso

---

## B.6 Resultado

Mostrar:

- `CURRENT_BRANCH` (rama de trabajo)
- `VERSION_ACTUAL` (versión anterior)
- `RELEASE_VERSION` (versión nueva)
- `TARGET_BRANCH` (rama creada y publicada)
- `RELEASE_LATEST` (tag base usado para crear la rama)
- confirmación de que `package.json` contiene la nueva versión
- confirmación de que el commit fue creado correctamente
- confirmación de que la rama `TARGET_BRANCH` existe localmente y en origin
- confirmación de que la rama `TARGET_BRANCH` fue creada desde el commit del tag `RELEASE_LATEST`
- resumen de comandos ejecutados

Abortar si:

- `package.json` no contiene `RELEASE_VERSION`
- el commit no existe en el log
- la rama `TARGET_BRANCH` no existe localmente o no está en origin
- la rama `TARGET_BRANCH` no apunta al mismo commit que `RELEASE_LATEST`

Esperar confirmación explícita del usuario antes de continuar con el siguiente paso.

---

## Siguiente paso

- [8. Creación de PR](.agent/workflows/Caso%20B/8.md)
