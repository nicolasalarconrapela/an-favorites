---
description: Version bump, rama y commit · Caso B (develop → releases/1.X.0)
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
- `OUTPUT_DIR`
- `VAR_S1_FILE`

---

## B.1 Previsualización de operaciones

Objetivo:

Mostrar al usuario la secuencia exacta de operaciones que se realizarán antes de ejecutar ninguna.

Acción (solo lectura, sin ejecutar nada):

- leer `CURRENT_BRANCH` desde `"$VAR_S1_FILE"`
- leer `VERSION_ACTUAL` desde `"$VAR_S1_FILE"`
- leer `RELEASE_VERSION` desde `"$VAR_S1_FILE"`
- leer `TARGET_BRANCH` desde `"$VAR_S1_FILE"`

Mostrar la previsualización:

```text
Operaciones previstas (en este orden):
  1. Bump de versión en package.json:
       "version": "<VERSION_ACTUAL>" → "version": "<RELEASE_VERSION>"
  2. Commit del bump:
       chore: bump version to <RELEASE_VERSION>
  3. Crear rama de release:
       git branch <TARGET_BRANCH>
  4. Publicar rama en origin:
       git push -u origin <TARGET_BRANCH>

  - Rama actual:     develop
  - Versión actual:  <VERSION_ACTUAL>
  - Versión nueva:   <RELEASE_VERSION>
  - Rama destino:    <TARGET_BRANCH>
```

Abortar si:

- `CURRENT_BRANCH` no es exactamente `develop`
- `VERSION_ACTUAL` está vacía o no sigue el patrón `X.Y.Z`
- `RELEASE_VERSION` está vacía o no sigue el patrón `X.Y.Z`
- `TARGET_BRANCH` está vacío o no cumple `^releases/1\.[0-9]+\.0$`

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

## B.4 Crear rama de release

Objetivo:

Crear la rama `TARGET_BRANCH` localmente a partir del estado actual de `develop`, **después** de que el commit del bump haya sido confirmado.

Regla crítica:

- no ejecutar este paso si el commit de B.3 no existe en el log
- no ejecutar sin autorización explícita del usuario

Comando permitido:

```bash
git branch <TARGET_BRANCH>
```

Verificación requerida:

```bash
git branch --list <TARGET_BRANCH>
```

La salida debe confirmar que la rama `<TARGET_BRANCH>` existe.

Abortar si:

- el commit de B.3 no existe en el log
- el comando `git branch` falla
- la rama no aparece en `git branch --list` tras la ejecución

Salida requerida:

- mostrar confirmación de que la rama fue creada
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
- confirmación de que `package.json` contiene la nueva versión
- confirmación de que el commit fue creado correctamente
- confirmación de que la rama `TARGET_BRANCH` existe localmente y en origin
- resumen de comandos ejecutados

Abortar si:

- `package.json` no contiene `RELEASE_VERSION`
- el commit no existe en el log
- la rama `TARGET_BRANCH` no existe localmente o no está en origin

Esperar confirmación explícita del usuario antes de continuar con el siguiente paso.

---

## Paso anterior

- [7. Generación de textos de Merge](.agent/workflows/Caso%20B/7.md)

## Siguiente paso

- [8. Creación de PR](.agent/workflows/Caso%20B/8.md)
