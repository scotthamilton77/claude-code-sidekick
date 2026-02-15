#!/bin/bash
# PostToolUse hook for Edit|Write: runs prettier, eslint --fix, and tsc
# on the modified file only.
#
# - prettier + eslint (modify the file) run in series
# - tsc (read-only) runs in parallel with them
# - Only processes .ts/.tsx source files under packages/
# - Skips dist/, node_modules/, .d.ts, config files, etc.

set -u

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')

# No file path or file doesn't exist → nothing to do
[ -z "$FILE_PATH" ] && exit 0
[ -f "$FILE_PATH" ] || exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-.}"
REL_PATH="${FILE_PATH#"$PROJECT_DIR"/}"

# --- Filters: only process applicable source files ---

# Must be under packages/
case "$REL_PATH" in
  packages/*) ;;
  *) exit 0 ;;
esac

# Skip generated/build output
case "$REL_PATH" in
  */dist/*|*/node_modules/*|*/coverage/*) exit 0 ;;
esac

# Only .ts/.tsx source files (skip .d.ts, configs)
case "$REL_PATH" in
  *.d.ts)            exit 0 ;;
  *.config.ts|*.config.js) exit 0 ;;
  *.ts|*.tsx)        ;; # process these
  *)                 exit 0 ;;
esac

# --- Setup ---
BIN="$PROJECT_DIR/node_modules/.bin"
ERRORS=""
TSC_TMPFILE="/tmp/claude/tsc_check_$$"
mkdir -p /tmp/claude

# --- tsc in background (read-only → runs parallel) ---
(
  "$BIN/tsc" -p "$PROJECT_DIR/tsconfig.lint.json" --noEmit --pretty false 2>&1 \
    | grep -F "$REL_PATH" > "$TSC_TMPFILE" 2>/dev/null
) &
TSC_PID=$!

# --- prettier --write (modifies file → serial, first) ---
PRETTIER_OUT=$("$BIN/prettier" --write "$FILE_PATH" 2>&1) || {
  ERRORS="${ERRORS}prettier: ${REL_PATH}
${PRETTIER_OUT}

"
}

# --- eslint --fix (modifies file → serial, second) ---
ESLINT_OUT=$("$BIN/eslint" --fix "$FILE_PATH" 2>&1) || {
  ERRORS="${ERRORS}eslint: ${REL_PATH}
${ESLINT_OUT}

"
}

# --- Collect tsc results ---
wait "$TSC_PID" 2>/dev/null || true
if [ -s "$TSC_TMPFILE" ]; then
  TSC_CONTENT=$(cat "$TSC_TMPFILE")
  ERRORS="${ERRORS}tsc: ${REL_PATH}
${TSC_CONTENT}

"
fi
rm -f "$TSC_TMPFILE"

# --- Report errors to Claude via stderr ---
if [ -n "$ERRORS" ]; then
  echo "$ERRORS" >&2
  exit 2
fi

exit 0
