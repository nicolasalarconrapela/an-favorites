---
description:
---

Este proceso NO es automático.
Cada paso requiere confirmación explícita antes de ejecutarse.
Si alguna validación falla → ABORTAR inmediatamente.

---

VARIABLES

CURRENT_BRANCH=""
PR_NUMBER=""
RELEASE_COMMIT=""
RELEASE_VERSION=""
VSIX_FILE=""

## VALIDACIÓN INICIAL

Acción: `git branch --show-current`

Resultado esperado:

Rama válida que no sea ni 'develop' ni 'main'

Confirmación requerida:

Confirmar que 'CURRENT_BRANCH' es correcta

Abortar si:

- Rama incorrecta
- Cambios sin commitear (excepto : .agent/workflows)
