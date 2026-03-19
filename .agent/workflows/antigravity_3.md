---
description: DIFF
---

## 3 Generar diff

Un diff va a ser único y por tanto esta seccion va a estar en un unico subdirectorio.

## 3.1 Crear directorio de salida

`mkdir -p "$OUTPUT_DIR_DIFF"`

## 3.2 Generar diff

`git diff "$RELEASE_RANGE" > "$OUTPUT_DIR/diffs_$RELEASE_RANGE.txt"`

El archivo generado en este paso será la fuente única de verdad para todo el análisis posterior.

Si no se genera correctamente `"$OUTPUT_DIR/diffs_$RELEASE_RANGE.txt"`, detener el flujo inmediatamente.

---

## 4 Analizar cambios

Archivo: `"$OUTPUT_DIR/diffs.txt"`

Identificar:

- nuevas funcionalidades
- nuevos comandos enlazables en `RELEASE_NOTES.md`
- mejoras
- correcciones
- eliminaciones
- cambios de seguridad

Reglas:

- no inventar cambios
- usar solo el $OUTPUT_DIR/diff.txt

Guardar:

Archivo: `$OUTPUT_DIR/Analisis.txt`
Archivo: `$OUTPUT_DIR/Var_S1.txt` -> Variables actuales

Preguntar a usuario si el analisis es el correcto y esperar respuesta.
