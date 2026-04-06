#!/usr/bin/env bash

get_diff_excludes_file() {
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  printf '%s\n' "${script_dir%/lib}/diff-excludes.txt"
}

trim_diff_exclude_line() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

load_diff_excludes() {
  local excludes_file="$1"
  local line trimmed

  DIFF_EXCLUDE_DIRS=()

  if [[ ! -f "$excludes_file" ]]; then
    echo "Error: no existe el archivo de exclusiones $excludes_file" >&2
    return 1
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    trimmed="$(trim_diff_exclude_line "$line")"

    if [[ -z "$trimmed" || "$trimmed" == \#* ]]; then
      continue
    fi

    DIFF_EXCLUDE_DIRS+=("$trimmed")
  done < "$excludes_file"
}

join_diff_excludes() {
  if [[ "${#DIFF_EXCLUDE_DIRS[@]}" -eq 0 ]]; then
    printf '%s' ""
    return 0
  fi

  printf '%s|' "${DIFF_EXCLUDE_DIRS[@]}"
}
