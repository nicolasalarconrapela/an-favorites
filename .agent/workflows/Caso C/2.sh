#!/bin/bash
set -euo pipefail

DATE="$(date +%d%m%Y)"
TIME="$(date +%H%M%S)"

GIT_REMOTE_URL="$(git remote get-url origin)"
REPOWN="$(printf '%s\n' "$GIT_REMOTE_URL" | sed -E 's#(git@github.com:|https://github.com/)##' | sed 's/\.git$//')"

RELEASE_LATEST="$(gh release view --repo "$REPOWN" --json tagName --jq .tagName 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || echo "")"

RAMA_ACTUAL="$(git branch --show-current)"

# ── Validación de rama ──────────────────────────────────────────────────────
# La rama debe cumplir exactamente ^releases/[0-9]+\.[0-9]+\.[0-9]+$
BRANCH_PATTERN='^releases/[0-9]+\.[0-9]+\.[0-9]+$'
if ! echo "$RAMA_ACTUAL" | grep -qE "$BRANCH_PATTERN"; then
  echo "Error (Caso C): la rama actual '$RAMA_ACTUAL' no es una rama de release válida."
  echo "Se requiere una rama con el patrón: releases/X.Y.Z (ej. releases/1.3.0)"
  echo "Flujo abortado."
  exit 1
fi

# Extraer la versión embebida en el nombre de la rama (ej. releases/1.3.0 → 1.3.0)
RELEASE_VERSION_FROM_BRANCH="$(echo "$RAMA_ACTUAL" | sed -E 's|^releases/||')"

VERSION_ACTUAL="$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' package.json | head -n 1)"

if [[ -z "${VERSION_ACTUAL}" ]]; then
  echo "Error: no se pudo obtener VERSION_ACTUAL desde package.json"
  exit 1
fi

# ── Validación de consonancia versión ↔ rama ───────────────────────────────
if [[ "$VERSION_ACTUAL" != "$RELEASE_VERSION_FROM_BRANCH" ]]; then
  echo "Error (Caso C): la versión en package.json ('${VERSION_ACTUAL}') no coincide"
  echo "con la versión embebida en la rama ('${RELEASE_VERSION_FROM_BRANCH}')."
  echo "Ajusta package.json o la rama antes de continuar."
  echo "Flujo abortado."
  exit 1
fi

RELEASE_RANGE_BRANCH="${RELEASE_LATEST}...${RAMA_ACTUAL}"
RELEASE_RANGE_VERSION="${RELEASE_LATEST}...${VERSION_ACTUAL}"
RELEASE_RANGE="${RELEASE_RANGE_BRANCH}"

OUTPUT_DIR_DIFF="out_tmp/casoC/${RELEASE_RANGE_VERSION}"
OUTPUT_DIR="${OUTPUT_DIR_DIFF}/${DATE}/${TIME}"

DIFF_FILE="${OUTPUT_DIR}/diffs.txt"
ANALYSIS_FILE="${OUTPUT_DIR}/Analisis.txt"
VAR_S1_FILE="${OUTPUT_DIR}/Var_S1.txt"

PWD_EXECUTION="$(pwd)"
USER_EXECUTION="$(whoami)"

mkdir -p "$OUTPUT_DIR"

cat > "$VAR_S1_FILE" <<EOF
RAMA_ACTUAL=$RAMA_ACTUAL
CURRENT_BRANCH=$RAMA_ACTUAL
TARGET_BRANCH=main
RELEASE_VERSION=$VERSION_ACTUAL
GIT_REMOTE_URL=$GIT_REMOTE_URL
REPOWN=$REPOWN
RELEASE_LATEST=$RELEASE_LATEST
VERSION_ACTUAL=$VERSION_ACTUAL
RELEASE_RANGE_BRANCH=$RELEASE_RANGE_BRANCH
RELEASE_RANGE_VERSION=$RELEASE_RANGE_VERSION
RELEASE_RANGE=$RELEASE_RANGE
DATE=$DATE
TIME=$TIME
OUTPUT_DIR_DIFF=$OUTPUT_DIR_DIFF
OUTPUT_DIR=$OUTPUT_DIR
DIFF_FILE=$DIFF_FILE
ANALYSIS_FILE=$ANALYSIS_FILE
VAR_S1_FILE=$VAR_S1_FILE
PWD_EXECUTION=$PWD_EXECUTION
USER_EXECUTION=$USER_EXECUTION
EOF

git diff "$RELEASE_RANGE" > "$DIFF_FILE"

if [[ ! -s "$DIFF_FILE" ]]; then
  echo "Error: no se generó correctamente el archivo diff en $DIFF_FILE"
  exit 1
fi

echo "✅ Validación superada: rama '$RAMA_ACTUAL' · package.json versión '${VERSION_ACTUAL}' ✓"
echo "Variables guardadas en: $VAR_S1_FILE"
echo "Diff generado en: $DIFF_FILE"
