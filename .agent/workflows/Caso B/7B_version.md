---
description: Version bump y commit · Caso B (develop → releases/1.X.0)
---

# Version bump y commit

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

## B.1 Previsualización del bump de versión

Objetivo:

Mostrar al usuario la operación exacta que se realizará antes de ejecutarla.

Acción (solo lectura, sin ejecutar nada):

- leer `CURRENT_BRANCH` desde `"$VAR_S1_FILE"`
- leer `VERSION_ACTUAL` desde `"$VAR_S1_FILE"`
- leer `RELEASE_VERSION` desde `"$VAR_S1_FILE"`
- leer `TARGET_BRANCH` desde `"$VAR_S1_FILE"`

Mostrar la previsualización:

```text
Operación prevista:
  - Rama actual:        develop
  - Versión actual:     <VERSION_ACTUAL>
  - Versión objetivo:   <RELEASE_VERSION>
  - Rama destino:       <TARGET_BRANCH>
  - Cambio en package.json: "version": "<VERSION_ACTUAL>" → "version": "<RELEASE_VERSION>"
  - Commit previsto:    chore: bump version to <RELEASE_VERSION>
```

Abortar si:

- `CURRENT_BRANCH` no es exactamente `develop`
- `VERSION_ACTUAL` está vacía o no sigue el patrón `X.Y.Z`
- `RELEASE_VERSION` está vacía o no sigue el patrón `X.Y.Z`
- `TARGET_BRANCH` está vacío

Salida requerida:

- mostrar la previsualización completa
- indicar explícitamente que no se ha ejecutado ningún comando
- preguntar al usuario si confirma el bump de versión y el commit
- esperar autorización explícita antes de continuar

---

## B.2 Actualizar version en package.json

Objetivo:

Actualizar el campo `version` en `package.json` con el valor de `RELEASE_VERSION`.

Reglas:

- solo está permitido modificar el campo `"version"` en `package.json`
- no modificar ningún otro archivo
- no ejecutar este paso sin autorización explícita del usuario obtenida en B.1
- la modificación debe hacerse con el comando exacto mostrado a continuación

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
- indicar que no se ha ejecutado ningún otro archivo
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

Comandos permitidos (en este orden exacto, uno por vez, cada uno con autorización):

```bash
git add package.json
```

```bash
git commit -m "chore: bump version to <RELEASE_VERSION>"
```

Reglas de ejecución:

- mostrar cada comando antes de ejecutarlo
- preguntar autorización para cada comando por separado
- no encadenar los dos comandos en una sola ejecución
- si cualquier comando falla, detener el flujo inmediatamente
- no corregir automáticamente ni reintentar

Abortar si:

- `git add` falla
- `git commit` falla
- el commit no aparece en `git log --oneline -1`
- se intenta ejecutar más de un comando a la vez
- se intenta ejecutar sin autorización explícita

Salida requerida:

- tras `git add`: confirmar que `package.json` está en stage
- tras `git commit`: mostrar la salida del commit
- mostrar `git log --oneline -1` para confirmar que el commit existe
- preguntar al usuario si desea continuar al siguiente paso

---

## B.4 Resultado del bump

Mostrar:

- `CURRENT_BRANCH`
- `VERSION_ACTUAL` (versión anterior)
- `RELEASE_VERSION` (versión nueva)
- `TARGET_BRANCH` (rama destino del PR)
- confirmación de que `package.json` contiene la nueva versión
- confirmación de que el commit fue creado correctamente
- resumen del commit realizado

Abortar si:

- `package.json` no contiene `RELEASE_VERSION`
- el commit no existe en el log

Esperar confirmación explícita del usuario antes de continuar con el siguiente paso.

---

## Paso anterior

- [7. Generación de textos de Merge](file:///c:/Users/Developer/Desktop/@anappwilos/afav_TEST/.agent/workflows/Caso%20B/7.md)

## Siguiente paso

- [8. Creación de PR](file:///c:/Users/Developer/Desktop/@anappwilos/afav_TEST/.agent/workflows/Caso%20B/8.md)
