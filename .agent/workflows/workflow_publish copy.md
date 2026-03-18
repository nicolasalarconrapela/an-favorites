---
description: PUBLISH RUNBOOK (MANUAL + AGENT SAFE)
---

# Publish

En este workflow vamos a realizar una workflow de publicación en producción por tanto todos los comandos
van a necesitar que se le solicite confirmación por parte del agente.

Este documento nunca podrá ser ejecutado en modo automaticamente. Deberá de ser invocado de forma explicita por un usuario real.

## GIT

1. mergear la rama actual contra develop

Confirmar si todo ha ido bien
Si va todo bien :

2. crear nuevo tag :

Ejemplo :

git tag -a v1.0.0 -m "Release v1.0.0"
git push origin v1.0.0

3. Crear release

gh release create v1.0.0 --title "v1.0.0" --notes "Primera release estable"

Necesito que notes sea: el archivo de RELEASE_notes.md

Y subir el archivo vsix correspondiente a la version

## PUBLICACION EN VSIX
