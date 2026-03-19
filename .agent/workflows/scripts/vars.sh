#!/usr/bin/env bash
set -euo pipefail

RAMA_ACTUAL="$(git branch --show-current)"
GIT_REMOTE_URL="$(git remote get-url origin)"
REPOWN="$(printf '%s\n' "$GIT_REMOTE_URL" | sed -E 's#(git@github.com:|https://github.com/)##' | sed 's/\.git$//')"
RELEASE_LATEST="$(gh release view --repo "$REPOWN" --json tagName --jq .tagName)"

DATE="$(date +%d%m%Y)"
TIME="$(date +%H%M%S)"

RELEASE_RANGE="${RELEASE_LATEST}...${RAMA_ACTUAL}"
OUTPUT_DIR_DIFF="out_tmp/${RELEASE_RANGE}/"
OUTPUT_DIR="out_tmp/${RELEASE_RANGE}/${DATE}/${TIME}"
DIFF_FILE="${OUTPUT_DIR}/diffs.txt"
ANALYSIS_FILE="${OUTPUT_DIR}/Analisis.txt"
VAR_S1_FILE="${OUTPUT_DIR}/Var_S1.txt"
PWD_EXECUTION="$(pwd)"
USER_EXECUTION="$(whoami)"

mkdir -p "$OUTPUT_DIR"

cat > "$VAR_S1_FILE" <<EOF
RAMA_ACTUAL=$RAMA_ACTUAL
GIT_REMOTE_URL=$GIT_REMOTE_URL
REPOWN=$REPOWN
RELEASE_LATEST=$RELEASE_LATEST
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

echo "Variables guardadas en: $VAR_S1_FILE"
