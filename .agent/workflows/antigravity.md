---
description: CHANGELOG & RELEASE
---

This workflow runs all checks to ensure the codebase is in a good state.

1. Lint the codebase
   // turbo
2. `npm run lint`

3. Compile the code
   // turbo
4. `npm run compile`

5. Run unit tests
   // turbo
6. `npm run test`

Si todo funciono correctamente continuamos a :

7. ejecutar `git diff` ultima version en release y la rama actual (`git branch --show-current`) > 'out/release...rama_actual}/ddmmyyyy/hhmmss/diffs.txt`

8. Analizar '{release...rama_actual}/ddmmyyyy/hhmmss/diffs.txt' :

Actúa como un mantenedor de proyectos open-source.

A partir de los cambios proporcionados, genera dos documentos en Markdown(en inglés, traducido al español en archivos diferentes):

En carpeta 'out/{release...rama_actual}/ddmmyyyy/hhmmss/'
8.1. CHANGELOG.md:

Estructura principal:

---

# {Linea del feature mas importante} - vX.Z.Y

_Release date: MM dd,yyyy_

## Resumen

## ...etcétera

- Historial técnico completo de la versión.
- Seguir estructura tipo _Keep a Changelog_.
- Secciones: `Added`, `Changed`, `Fixed`, `Removed`, `Security`.
- Lenguaje técnico y conciso.
- Incluir número de versión y fecha.
- Formato Markdown

  8.2. RELEASE_NOTES.md:

- Resumen claro para usuarios.
- Explicar las mejoras más importantes de la versión.
- Usar secciones: `Highlights`, `Improvements`, `Bug Fixes`.
- Lenguaje más narrativo y fácil de leer.
- Formato Markdown

Reglas:

- No inventar cambios.
- Usar Markdown limpio.
- Generar ambos documentos completos.
- Versión: {VERSION}
- Fecha: {DATE}

10. Revisar si hay FEATURES necesarias de agregar a los Archivos del Walkthrough (tanto en inglés como en español).

11. Creación de VSIX con :

MY_VSIX_FILE="$(vsce package \
  | sed -n 's/^.*Packaged:[[:space:]]*//p' \
  | sed -E 's/(\.vsix).*/\1/' \
  | tail -n 1)" \
&& echo "Paquete creado en: $MY_VSIX_FILE" \
&& code --install-extension "$MY_VSIX_FILE"
