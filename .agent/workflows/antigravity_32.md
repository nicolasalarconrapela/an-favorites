---
description: DIFF - Analisis [2/2]
---

## 4 Análisis de los cambios

Archivo fuente único: `"$DIFF_FILE"`

Identificar únicamente, si aparecen de forma explícita en `"$DIFF_FILE"`:

- nuevas funcionalidades
- nuevos comandos enlazables en `RELEASE_NOTES.md`
- mejoras
- correcciones
- eliminaciones
- cambios de seguridad

Reglas:

- usar solo `"$DIFF_FILE"`
- no inventar cambios
- no inventar variables
- no usar historial de conversación ni contexto previo, salvo que este workflow indique continuidad explícita
- no analizar otros archivos distintos de `"$DIFF_FILE"`
- no asumir valores, rutas o resultados no definidos explícitamente
- si un cambio no puede determinarse con claridad desde `"$DIFF_FILE"`, indicarlo como ambiguo y guardar par preguntar al final
- si `"$DIFF_FILE"` no existe, está vacío o no puede leerse, detener el flujo y preguntar al usuario qué desea hacer
- si `"$ANALYSIS_FILE"` o `"$VAR_S1_FILE"` no están definidos, detener el flujo y preguntar al usuario qué desea hacer

Guardar:

- Archivo: `"$ANALYSIS_FILE"`
- Archivo: `"$VAR_S1_FILE"` -> Variables actuales reales del flujo, sin inventar valores

Preguntar al usuario si el análisis es correcto y esperar respuesta antes de continuar.
