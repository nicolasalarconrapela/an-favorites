#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../lib/diff_excludes.sh"

DATE="$(date +%d%m%Y)"
TIME="$(date +%H%M%S)"

GIT_REMOTE_URL="$(git remote get-url origin)"
REPOWN="$(printf '%s\n' "$GIT_REMOTE_URL" | sed -E 's#(git@github.com:|https://github.com/)##' | sed 's/\.git$//')"

RELEASE_LATEST="$(gh release view --repo "$REPOWN" --json tagName --jq .tagName)"

RAMA_ACTUAL="$(git branch --show-current)"

# â”€â”€ ValidaciÃ³n de rama â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
# La rama debe cumplir exactamente ^releases/[0-9]+\.[0-9]+\.[0-9]+$
BRANCH_PATTERN='^releases/[0-9]+\.[0-9]+\.[0-9]+$'
if ! echo "$RAMA_ACTUAL" | grep -qE "$BRANCH_PATTERN"; then
  echo "Error (Caso C): la rama actual '$RAMA_ACTUAL' no es una rama de release vÃ¡lida."
  echo "Se requiere una rama con el patrÃ³n: releases/X.Y.Z (ej. releases/1.3.0)"
  echo "Flujo abortado."
  exit 1
fi

# Extraer la versiÃ³n embebida en el nombre de la rama (ej. releases/1.3.0 â†’ 1.3.0)
RELEASE_VERSION_FROM_BRANCH="$(echo "$RAMA_ACTUAL" | sed -E 's|^releases/||')"

VERSION_ACTUAL="$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' package.json | head -n 1)"

if [[ -z "${VERSION_ACTUAL}" ]]; then
  echo "Error: no se pudo obtener VERSION_ACTUAL desde package.json"
  exit 1
fi

# â”€â”€ ValidaciÃ³n de consonancia versiÃ³n â†” rama â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
if [[ "$VERSION_ACTUAL" != "$RELEASE_VERSION_FROM_BRANCH" ]]; then
  echo "Error (Caso C): la versiÃ³n en package.json ('${VERSION_ACTUAL}') no coincide"
  echo "con la versiÃ³n embebida en la rama ('${RELEASE_VERSION_FROM_BRANCH}')."
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
DIFF_EXCLUDES_FILE="$(get_diff_excludes_file)"
load_diff_excludes "$DIFF_EXCLUDES_FILE"
DIFF_EXCLUDE_PATTERNS_COUNT="${#DIFF_EXCLUDE_DIRS[@]}"
DIFF_EXCLUDE_PATTERNS_JOINED="$(join_diff_excludes)"
DIFF_EXCLUDE_PATTERNS_JOINED="${DIFF_EXCLUDE_PATTERNS_JOINED%|}"

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
DIFF_EXCLUDES_FILE=$DIFF_EXCLUDES_FILE
DIFF_EXCLUDE_PATTERNS_COUNT=$DIFF_EXCLUDE_PATTERNS_COUNT
DIFF_EXCLUDE_PATTERNS=$DIFF_EXCLUDE_PATTERNS_JOINED
EOF

DIFF_ARGS=(git diff "$RELEASE_RANGE" -- .)
for exclude_dir in "${DIFF_EXCLUDE_DIRS[@]}"; do
  DIFF_ARGS+=(":(exclude)$exclude_dir")
done
"${DIFF_ARGS[@]}" > "$DIFF_FILE"

if [[ ! -s "$DIFF_FILE" ]]; then
  echo "Error: no se generÃ³ correctamente el archivo diff en $DIFF_FILE"
  exit 1
fi

echo "âœ… ValidaciÃ³n superada: rama '$RAMA_ACTUAL' Â· package.json versiÃ³n '${VERSION_ACTUAL}' âœ“"
echo "Variables guardadas en: $VAR_S1_FILE"
echo "Diff generado en: $DIFF_FILE"
echo "Archivo de exclusiones: $DIFF_EXCLUDES_FILE"
echo "Patrones de exclusion aplicados: ${DIFF_EXCLUDE_PATTERNS_COUNT}"
