#!/usr/bin/env bash
set -euo pipefail

DATE="$(date +%d%m%Y)"
TIME="$(date +%H%M%S)"

GIT_REMOTE_URL="$(git remote get-url origin)"
REPOWN="$(printf '%s\n' "$GIT_REMOTE_URL" | sed -E 's#(git@github.com:|https://github.com/)##' | sed 's/\.git$//')"

RELEASE_LATEST="$(gh release view --repo "$REPOWN" --json tagName --jq .tagName 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || echo "")"
RELEASE_LATEST_NORMALIZED="${RELEASE_LATEST#v}"

RAMA_ACTUAL="$(git branch --show-current)"
CURRENT_BRANCH="$RAMA_ACTUAL"
TARGET_BRANCH="develop"
VERSION_ACTUAL="$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' package.json | head -n 1)"
RELEASE_VERSION="$RELEASE_LATEST_NORMALIZED"

if [[ -z "${VERSION_ACTUAL}" ]]; then
  echo "Error: no se pudo obtener VERSION_ACTUAL desde package.json"
  exit 1
fi

if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "Error: la rama actual ($CURRENT_BRANCH) no es 'main'. El Caso D requiere partir desde main."
  exit 1
fi

if [[ -z "${RELEASE_LATEST}" ]]; then
  echo "Error: no se pudo obtener RELEASE_LATEST desde GitHub Releases o tags locales"
  exit 1
fi

if [[ -z "${RELEASE_VERSION}" ]]; then
  echo "Error: no se pudo normalizar RELEASE_VERSION desde RELEASE_LATEST=$RELEASE_LATEST"
  exit 1
fi

RELEASE_RANGE_BRANCH="${RELEASE_LATEST}...${RAMA_ACTUAL}"
RELEASE_RANGE_VERSION="${RELEASE_LATEST}...${RELEASE_VERSION}"
RELEASE_RANGE="${RELEASE_RANGE_BRANCH}"

OUTPUT_DIR_DIFF="out_tmp/${RELEASE_RANGE_VERSION}"
OUTPUT_DIR="${OUTPUT_DIR_DIFF}/${DATE}/${TIME}"

DIFF_FILE="${OUTPUT_DIR}/diffs.txt"
ANALYSIS_FILE="${OUTPUT_DIR}/Analisis.txt"
VAR_S1_FILE="${OUTPUT_DIR}/Var_S1.txt"

PWD_EXECUTION="$(pwd)"
USER_EXECUTION="$(whoami)"

mkdir -p "$OUTPUT_DIR"

cat > "$VAR_S1_FILE" <<EOF
RAMA_ACTUAL=$RAMA_ACTUAL
CURRENT_BRANCH=$CURRENT_BRANCH
TARGET_BRANCH=$TARGET_BRANCH
GIT_REMOTE_URL=$GIT_REMOTE_URL
REPOWN=$REPOWN
RELEASE_LATEST=$RELEASE_LATEST
RELEASE_LATEST_NORMALIZED=$RELEASE_LATEST_NORMALIZED
VERSION_ACTUAL=$VERSION_ACTUAL
RELEASE_VERSION=$RELEASE_VERSION
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

echo "Variables guardadas en: $VAR_S1_FILE"
echo "Ultima release publicada: $RELEASE_LATEST"
echo "Version de release sincronizada: $RELEASE_VERSION"
echo "Diff generado en: $DIFF_FILE"
