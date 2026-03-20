---
description: DIFF
---

## 4 Análisis de los cambios

Archivo fuente: `"$DIFF_FILE"`

Identificar:

- nuevas funcionalidades
- nuevos comandos enlazables en `RELEASE_NOTES.md`
- mejoras
- correcciones
- eliminaciones
- cambios de seguridad

Reglas:

- no inventar cambios
- usar solo `"$DIFF_FILE"`

Guardar:

- Archivo: `"$ANALYSIS_FILE"`
- Archivo: `"$VAR_S1_FILE"` -> Variables actuales

Preguntar al usuario si el análisis es correcto y esperar respuesta.
