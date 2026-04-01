#!/usr/bin/env bash
set -euo pipefail

DATE="$(date +%d%m%Y)"
TIME="$(date +%H%M%S)"

confirm() {
  local message="$1"
  local response
  read -r -p "$message [y/N]: " response
  [[ "$response" =~ ^([yY]([eE][sS])?|[sS][iI]?)$ ]]
}

update_package_version() {
  local new_version="$1"

  if [[ ! -f package.json ]]; then
    echo "Error: no existe package.json"
    exit 1
  fi

  py - "$new_version" <<'PY'
import json
import sys
from pathlib import Path

new_version = sys.argv[1]
path = Path("package.json")

data = json.loads(path.read_text(encoding="utf-8"))
data["version"] = new_version
path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
PY
}

ensure_clean_worktree_for_push() {
  local status
  status="$(git status --porcelain)"

  if [[ -n "$status" ]]; then
    echo "Error: hay cambios locales pendientes. No se puede hacer push hasta dejar el arbol limpio."
    git status --short
    exit 1
  fi
}

GIT_REMOTE_URL="$(git remote get-url origin)"
REPOWN="$(printf '%s\n' "$GIT_REMOTE_URL" | sed -E 's#(git@github.com:|https://github.com/)##' | sed 's/\.git$//')"

RELEASE_LATEST="$(gh release view --repo "$REPOWN" --json tagName --jq .tagName 2>/dev/null || git describe --tags --abbrev=0 2>/dev/null || echo "1.2.40")"

RAMA_ACTUAL="$(git branch --show-current)"
CURRENT_BRANCH="$RAMA_ACTUAL"
TARGET_BRANCH=""

VERSION_ACTUAL="$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' package.json | head -n 1)"

if [[ -z "${VERSION_ACTUAL}" ]]; then
  echo "Error: no se pudo obtener VERSION_ACTUAL desde package.json"
  exit 1
fi

if [[ "$CURRENT_BRANCH" != "develop" ]]; then
  echo "Error: la rama actual ($CURRENT_BRANCH) no es 'develop'. El Caso B requiere partir desde develop."
  exit 1
fi

LAST_COMMIT_MESSAGE="$(git log -1 --pretty=%s)"
BUMP_COMMIT_VERSION=""

if [[ "$LAST_COMMIT_MESSAGE" =~ ^chore:\ bump\ version\ to\ ([0-9]+\.[0-9]+\.[0-9]+)$ ]]; then
  BUMP_COMMIT_VERSION="${BASH_REMATCH[1]}"
fi

if [[ -n "$BUMP_COMMIT_VERSION" && "$BUMP_COMMIT_VERSION" == "$VERSION_ACTUAL" ]]; then
  RELEASE_VERSION="$VERSION_ACTUAL"
else
  MAJOR="$(echo "$VERSION_ACTUAL" | cut -d. -f1)"
  MINOR="$(echo "$VERSION_ACTUAL" | cut -d. -f2)"
  NEXT_MINOR=$(( MINOR + 1 ))
  RELEASE_VERSION="${MAJOR}.${NEXT_MINOR}.0"
fi

RELEASE_LATEST_NORMALIZED="${RELEASE_LATEST#v}"

if [[ ! "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: RELEASE_VERSION no tiene formato semver valido: $RELEASE_VERSION"
  exit 1
fi

if [[ ! "$RELEASE_LATEST_NORMALIZED" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Error: RELEASE_LATEST no tiene formato semver valido: $RELEASE_LATEST"
  exit 1
fi

RELEASE_MAJOR="$(echo "$RELEASE_VERSION" | cut -d. -f1)"
RELEASE_MINOR="$(echo "$RELEASE_VERSION" | cut -d. -f2)"
RELEASE_PATCH="$(echo "$RELEASE_VERSION" | cut -d. -f3)"

LATEST_MAJOR="$(echo "$RELEASE_LATEST_NORMALIZED" | cut -d. -f1)"
LATEST_MINOR="$(echo "$RELEASE_LATEST_NORMALIZED" | cut -d. -f2)"
LATEST_PATCH="$(echo "$RELEASE_LATEST_NORMALIZED" | cut -d. -f3)"

if [[ "$RELEASE_PATCH" != "0" ]]; then
  echo "Error: la release candidata debe terminar en .0 para este flujo. RELEASE_VERSION=$RELEASE_VERSION"
  exit 1
fi

if [[ "$RELEASE_MINOR" -eq 0 ]]; then
  echo "Error: no se puede validar una release candidata con minor 0 contra una release previa inmediata. RELEASE_VERSION=$RELEASE_VERSION"
  exit 1
fi

EXPECTED_PREVIOUS_MAJOR="$RELEASE_MAJOR"
EXPECTED_PREVIOUS_MINOR=$(( RELEASE_MINOR - 1 ))
EXPECTED_PREVIOUS_PATCH="0"
EXPECTED_PREVIOUS_RELEASE="${EXPECTED_PREVIOUS_MAJOR}.${EXPECTED_PREVIOUS_MINOR}.${EXPECTED_PREVIOUS_PATCH}"

RELEASE_VERSION_ORIGINAL="$RELEASE_VERSION"
RELEASE_VERSION_ADJUSTED="false"

if [[ "$LATEST_MAJOR" != "$EXPECTED_PREVIOUS_MAJOR" || "$LATEST_MINOR" != "$EXPECTED_PREVIOUS_MINOR" || "$LATEST_PATCH" != "$EXPECTED_PREVIOUS_PATCH" ]]; then
  ADJUSTED_MAJOR="$LATEST_MAJOR"
  ADJUSTED_MINOR=$(( LATEST_MINOR + 1 ))
  ADJUSTED_PATCH="0"
  RELEASE_VERSION="${ADJUSTED_MAJOR}.${ADJUSTED_MINOR}.${ADJUSTED_PATCH}"
  RELEASE_VERSION_ADJUSTED="true"

  echo "Aviso: la ultima release publicada es $RELEASE_LATEST_NORMALIZED y no coincide con la inmediata anterior esperada para $RELEASE_VERSION_ORIGINAL."
  echo "Aviso: se esperaba la release previa $EXPECTED_PREVIOUS_RELEASE."
  echo "Aviso: se reajusta RELEASE_VERSION a $RELEASE_VERSION."

  if ! confirm "¿Deseas continuar con la version reajustada $RELEASE_VERSION?"; then
    echo "Cancelado por el usuario."
    exit 1
  fi
fi

PACKAGE_JSON_UPDATED="false"
PACKAGE_LOCK_UPDATED="false"
VERSION_COMMIT_CREATED="false"
VERSION_COMMIT_PUSHED="false"

CURRENT_PACKAGE_VERSION="$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' package.json | head -n 1)"

if [[ "$CURRENT_PACKAGE_VERSION" != "$RELEASE_VERSION" ]]; then
  echo "Se propone actualizar package.json de $CURRENT_PACKAGE_VERSION a $RELEASE_VERSION"

  if ! confirm "¿Deseas actualizar package.json a $RELEASE_VERSION?"; then
    echo "Actualización de versión cancelada por el usuario."
    exit 1
  fi

  update_package_version "$RELEASE_VERSION"
  PACKAGE_JSON_UPDATED="true"

  echo "Ejecutando npm install..."
  npm install

  if [[ -f package-lock.json ]] && ! git diff --quiet -- package-lock.json; then
    PACKAGE_LOCK_UPDATED="true"
  fi

  echo "### 1.1 Lint"
  if ! confirm "¿Deseas ejecutar npm run lint?"; then
    echo "Lint cancelado por el usuario."
    exit 1
  fi
  npm run lint

  echo "### 1.2 Compilación"
  if ! confirm "¿Deseas ejecutar npm run compile?"; then
    echo "Compilación cancelada por el usuario."
    exit 1
  fi
  npm run compile

  echo "### 1.3 Tests"
  if ! confirm "¿Deseas ejecutar npm run test?"; then
    echo "Tests cancelados por el usuario."
    exit 1
  fi
  npm run test

  echo "Todas las validaciones han finalizado correctamente."

  if confirm "¿Deseas crear un commit solo con package.json y package-lock.json?"; then
    git add package.json

    if [[ -f package-lock.json ]] && ! git diff --quiet -- package-lock.json; then
      git add package-lock.json
    fi

    git commit -m "chore: bump version to $RELEASE_VERSION"
    VERSION_COMMIT_CREATED="true"
    ensure_clean_worktree_for_push

    if confirm "Â¿Deseas hacer push del commit de version a $CURRENT_BRANCH?"; then
      git push origin "$CURRENT_BRANCH"
      VERSION_COMMIT_PUSHED="true"
    else
      echo "Push del commit de versiÃ³n omitido por el usuario."
    fi

    LAST_COMMIT_MESSAGE="$(git log -1 --pretty=%s)"
    BUMP_COMMIT_VERSION="$RELEASE_VERSION"
  else
    echo "Commit de versión omitido por el usuario."
  fi
fi

TARGET_BRANCH="releases/${RELEASE_VERSION}"

RELEASE_RANGE_BRANCH="${RELEASE_LATEST}...${RAMA_ACTUAL}"
RELEASE_RANGE_VERSION="${RELEASE_LATEST}...${RELEASE_VERSION}"
RELEASE_RANGE="${RELEASE_RANGE_BRANCH}"

OUTPUT_DIR_DIFF="out_tmp/casoB/${RELEASE_RANGE_VERSION}"
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
RELEASE_VERSION_ORIGINAL=$RELEASE_VERSION_ORIGINAL
RELEASE_VERSION=$RELEASE_VERSION
RELEASE_VERSION_ADJUSTED=$RELEASE_VERSION_ADJUSTED
LAST_COMMIT_MESSAGE=$LAST_COMMIT_MESSAGE
BUMP_COMMIT_VERSION=$BUMP_COMMIT_VERSION
EXPECTED_PREVIOUS_RELEASE=$EXPECTED_PREVIOUS_RELEASE
PACKAGE_JSON_UPDATED=$PACKAGE_JSON_UPDATED
PACKAGE_LOCK_UPDATED=$PACKAGE_LOCK_UPDATED
VERSION_COMMIT_CREATED=$VERSION_COMMIT_CREATED
VERSION_COMMIT_PUSHED=$VERSION_COMMIT_PUSHED
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
echo "Ultimo commit detectado: $LAST_COMMIT_MESSAGE"
echo "Version actual inicial en package.json: $VERSION_ACTUAL"
echo "Ultima release publicada: $RELEASE_LATEST_NORMALIZED"
echo "Release previa esperada inicialmente: $EXPECTED_PREVIOUS_RELEASE"
echo "Version objetivo final de release: $RELEASE_VERSION"
echo "Rama destino calculada: $TARGET_BRANCH"
echo "package.json actualizado: $PACKAGE_JSON_UPDATED"
echo "package-lock.json actualizado: $PACKAGE_LOCK_UPDATED"
echo "Commit de version creado: $VERSION_COMMIT_CREATED"
echo "Commit de version publicado: $VERSION_COMMIT_PUSHED"
echo "Diff generado en: $DIFF_FILE"
